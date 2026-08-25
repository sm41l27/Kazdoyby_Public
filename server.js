const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: true, credentials: false },
  maxHttpBufferSize: 300_000
});

const PORT = process.env.PORT || 3000;
const COLORS = ['blue', 'black', 'red', 'white'];
const ALLOWED_TYPES = new Set(['human', 'ai-easy', 'ai-medium', 'ai-hard']);
const ALLOWED_MODES = new Set(['ffa', 'teams']);
const rooms = new Map();

// ==================== SUPABASE ====================
// Эти значения НЕ хранятся в GitHub. Render передаёт их через Environment Variables.
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || '');
const DB_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);

const COLOR_NAMES_KK = {
  blue: 'Көк',
  black: 'Қара',
  red: 'Қызыл',
  white: 'Ақ'
};

const BOT_LEVELS_KK = {
  'ai-easy': 'Жеңіл',
  'ai-medium': 'Орта',
  'ai-hard': 'Қиын'
};

async function supabaseRest(table, { method = 'GET', query = '', body = undefined, prefer = '' } = {}) {
  if (!DB_ENABLED) return null;

  const url = `${SUPABASE_URL}/rest/v1/${table}${query ? `?${query}` : ''}`;
  const headers = {
    apikey: SUPABASE_SECRET_KEY,
    'Content-Type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Supabase ${method} ${table}: ${response.status} ${text}`);
  }

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function queueDb(room, work) {
  if (!DB_ENABLED || !room) return;
  room.dbQueue = (room.dbQueue || Promise.resolve())
    .then(work)
    .catch((error) => {
      console.error('❌ Supabase қатесі:', error.message);
    });
}

function dbPlayerRow(room, color) {
  const type = room.playerTypes[color];
  const isHuman = type === 'human';
  return {
    match_id: room.dbMatchId,
    player_name: isHuman
      ? `${COLOR_NAMES_KK[color]} ойыншы`
      : `${COLOR_NAMES_KK[color]} ЖИ`,
    color,
    player_type: isHuman ? 'human' : 'ai',
    bot_level: isHuman ? null : (type.replace('ai-', '') || null),
    result: null
  };
}

async function ensureDbMatch(room) {
  if (!DB_ENABLED || room.dbMatchId) return room.dbMatchId || null;

  const inserted = await supabaseRest('matches', {
    method: 'POST',
    query: 'select=id',
    body: {
      room_code: room.code,
      game_mode: room.gameMode,
      winner: null,
      status: 'playing'
    },
    prefer: 'return=representation'
  });

  const matchId = Array.isArray(inserted) && inserted[0] ? inserted[0].id : null;
  if (!matchId) throw new Error('matches кестесінен жаңа match id алынбады.');

  room.dbMatchId = matchId;
  room.dbSavedMoveCount = 0;
  room.dbFinished = false;

  await supabaseRest('match_players', {
    method: 'POST',
    body: COLORS.map(color => dbPlayerRow(room, color)),
    prefer: 'return=minimal'
  });

  console.log(`✅ Supabase: матч #${matchId} сақталды (${room.code})`);
  return matchId;
}

function parseHistoryMove(log, index) {
  const text = String(log?.text || '');
  const squares = text.match(/[A-Z][0-9]{1,2}/g) || [];
  const captureMatch = text.match(/Жою:\s*(\d+)/i);
  const captureCount = captureMatch ? Number(captureMatch[1]) : 0;

  return {
    move_number: index + 1,
    player_color: COLORS.includes(log?.player) ? log.player : 'blue',
    from_square: squares[0] || '?',
    to_square: squares.length ? squares[squares.length - 1] : '?',
    captures: {
      count: Number.isFinite(captureCount) ? captureCount : 0,
      route: squares,
      text
    }
  };
}

async function saveNewMoves(room, parsedState) {
  const history = Array.isArray(parsedState?.historyLog) ? parsedState.historyLog : [];
  const saved = Number(room.dbSavedMoveCount || 0);
  if (history.length <= saved) return;

  await ensureDbMatch(room);

  const rows = [];
  for (let i = saved; i < history.length; i++) {
    rows.push({
      match_id: room.dbMatchId,
      ...parseHistoryMove(history[i], i)
    });
  }

  if (rows.length) {
    await supabaseRest('moves', {
      method: 'POST',
      body: rows,
      prefer: 'return=minimal'
    });
    room.dbSavedMoveCount = history.length;
  }
}

function winningColors(room, winner) {
  if (!winner) return [];

  if (room.gameMode === 'teams') {
    const normalized = String(winner);
    if (normalized === 'Көк + Қара' || normalized === 'blue-black') return ['blue', 'black'];
    if (normalized === 'Қызыл + Ақ' || normalized === 'red-white') return ['red', 'white'];
    return [];
  }

  return COLORS.includes(winner) ? [winner] : [];
}

async function finishDbMatch(room, winner) {
  if (!winner || room.dbFinished) return;
  await ensureDbMatch(room);

  room.dbFinished = true;
  const winners = new Set(winningColors(room, winner));
  const finishedAt = new Date().toISOString();

  await supabaseRest('matches', {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(room.dbMatchId)}`,
    body: {
      winner: String(winner),
      status: 'finished',
      finished_at: finishedAt
    },
    prefer: 'return=minimal'
  });

  for (const color of COLORS) {
    await supabaseRest('match_players', {
      method: 'PATCH',
      query: `match_id=eq.${encodeURIComponent(room.dbMatchId)}&color=eq.${encodeURIComponent(color)}`,
      body: { result: winners.has(color) ? 'win' : 'loss' },
      prefer: 'return=minimal'
    });
  }

  console.log(`🏆 Supabase: матч #${room.dbMatchId} аяқталды. Жеңімпаз: ${winner}`);
}

async function abandonDbMatch(room) {
  if (!room?.dbMatchId || room.dbFinished) return;
  room.dbFinished = true;
  await supabaseRest('matches', {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(room.dbMatchId)}`,
    body: {
      status: 'abandoned',
      finished_at: new Date().toISOString()
    },
    prefer: 'return=minimal'
  });
}

async function updateDbRoomCode(room) {
  if (!room?.dbMatchId || room.dbFinished) return;
  await supabaseRest('matches', {
    method: 'PATCH',
    query: `id=eq.${encodeURIComponent(room.dbMatchId)}`,
    body: { room_code: room.code },
    prefer: 'return=minimal'
  });
}

function startFreshDbMatch(room) {
  room.dbMatchId = null;
  room.dbSavedMoveCount = 0;
  room.dbFinished = false;
  queueDb(room, () => ensureDbMatch(room));
}

if (DB_ENABLED) {
  console.log('✅ Supabase бапталды: ойын нәтижелері базаға сақталады.');
} else {
  console.warn('⚠️ Supabase өшірулі: SUPABASE_URL немесе SUPABASE_SECRET_KEY табылмады.');
}

// ==================== WEB SERVER ====================
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({
  ok: true,
  rooms: rooms.size,
  database: DB_ENABLED ? 'configured' : 'disabled'
}));

app.get('/health/db', async (_req, res) => {
  if (!DB_ENABLED) {
    return res.status(503).json({ ok: false, database: 'disabled' });
  }
  try {
    await supabaseRest('matches', { method: 'GET', query: 'select=id&limit=1' });
    return res.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error('❌ Supabase тексеру қатесі:', error.message);
    return res.status(500).json({ ok: false, database: 'error' });
  }
});

function normalizeRoomCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function isValidRoomCode(code) {
  return /^[A-Z0-9]{4,12}$/.test(code);
}

function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 100; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
    if (!rooms.has(code)) return code;
  }
  return Date.now().toString(36).slice(-6).toUpperCase();
}

function cleanPlayerTypes(input) {
  const result = {};
  for (const color of COLORS) {
    const type = input && input[color];
    result[color] = ALLOWED_TYPES.has(type) ? type : 'human';
  }
  return result;
}

function cleanGameMode(value) {
  return ALLOWED_MODES.has(value) ? value : 'ffa';
}

function humanColors(room) {
  return COLORS.filter(c => room.playerTypes[c] === 'human');
}

function connectedHumans(room) {
  return humanColors(room).filter(c => room.slots[c]).length;
}

function roomStatus(room) {
  return {
    code: room.code,
    gameMode: room.gameMode,
    started: room.started,
    playerTypes: room.playerTypes,
    connected: connectedHumans(room),
    needed: humanColors(room).length,
    occupiedColors: COLORS.filter(c => room.slots[c]),
    hostColor: COLORS.find(c => room.slots[c] === room.hostSocketId) || null
  };
}

function emitStatus(room) {
  io.to(room.code).emit('room-status', roomStatus(room));
}

function maybeStart(room) {
  const needed = humanColors(room).length;
  if (!room.started && needed > 0 && connectedHumans(room) === needed) {
    room.started = true;
    room.expectedPlayer = 'blue';
    startFreshDbMatch(room);

    io.to(room.code).emit('game-start', {
      code: room.code,
      gameMode: room.gameMode,
      playerTypes: room.playerTypes
    });
    emitStatus(room);
  }
}

function assignHumanSlot(room, socketId) {
  for (const color of humanColors(room)) {
    if (!room.slots[color]) {
      room.slots[color] = socketId;
      return color;
    }
  }
  return null;
}

function authorizedToSubmit(room, socket) {
  const expected = room.expectedPlayer || 'blue';
  const type = room.playerTypes[expected];
  if (!type) return false;
  if (type === 'human') return room.slots[expected] === socket.id;
  return room.hostSocketId === socket.id;
}

function removeSocketFromRoom(socket, { announce = true } = {}) {
  const code = socket.data.roomCode;
  const room = code && rooms.get(code);
  if (!room) {
    socket.data.roomCode = null;
    socket.data.color = null;
    return null;
  }

  const leavingColor = socket.data.color || null;
  for (const color of COLORS) {
    if (room.slots[color] === socket.id) room.slots[color] = null;
  }

  socket.leave(code);
  socket.data.roomCode = null;
  socket.data.color = null;

  const remainingIds = COLORS.map(c => room.slots[c]).filter(Boolean);
  if (remainingIds.length === 0) {
    queueDb(room, () => abandonDbMatch(room));
    rooms.delete(code);
    return { room: null, color: leavingColor };
  }

  if (room.hostSocketId === socket.id) {
    room.hostSocketId = remainingIds[0];
    io.to(room.hostSocketId).emit('host-changed', { isHost: true });
  }

  emitStatus(room);
  if (announce) io.to(room.code).emit('player-left', { color: leavingColor });
  return { room, color: leavingColor };
}

function changeRoomCode(room, newCode) {
  const oldCode = room.code;
  const socketIds = COLORS.map(c => room.slots[c]).filter(Boolean);

  rooms.delete(oldCode);
  room.code = newCode;
  rooms.set(newCode, room);
  queueDb(room, () => updateDbRoomCode(room));

  for (const socketId of socketIds) {
    const member = io.sockets.sockets.get(socketId);
    if (!member) continue;
    member.leave(oldCode);
    member.join(newCode);
    member.data.roomCode = newCode;
  }

  for (const socketId of socketIds) {
    io.to(socketId).emit('room-code-changed', { oldCode, code: newCode });
  }
  emitStatus(room);
}

io.on('connection', (socket) => {
  socket.on('create-room', (payload = {}) => {
    if (socket.data.roomCode) return;

    const gameMode = cleanGameMode(payload.gameMode);
    const playerTypes = cleanPlayerTypes(payload.playerTypes);
    const humans = COLORS.filter(c => playerTypes[c] === 'human');
    if (humans.length === 0) {
      socket.emit('room-error', 'Кемінде бір ойыншы «Адам» болуы керек. Қалған орындарды ЖИ-ға беруге болады.');
      return;
    }

    const requestedCode = normalizeRoomCode(payload.code);
    if (requestedCode && !isValidRoomCode(requestedCode)) {
      socket.emit('room-error', 'Бөлме коды 4–12 таңбадан тұруы керек. Тек латын әріптері мен сандарды қолданыңыз.');
      return;
    }
    if (requestedCode && rooms.has(requestedCode)) {
      socket.emit('room-error', 'Бұл бөлме коды бос емес. Басқа код таңдаңыз.');
      return;
    }

    const code = requestedCode || makeRoomCode();
    const room = {
      code,
      gameMode,
      hostSocketId: socket.id,
      playerTypes,
      slots: { blue: null, black: null, red: null, white: null },
      started: false,
      expectedPlayer: 'blue',
      state: null,
      winner: null,
      createdAt: Date.now(),
      dbMatchId: null,
      dbSavedMoveCount: 0,
      dbFinished: false,
      dbQueue: Promise.resolve()
    };

    const color = assignHumanSlot(room, socket.id);
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.color = color;

    socket.emit('room-created', {
      code,
      color,
      isHost: true,
      gameMode,
      playerTypes,
      status: roomStatus(room)
    });

    emitStatus(room);
    maybeStart(room);
  });

  socket.on('join-room', (payload = {}) => {
    const code = normalizeRoomCode(payload.code);
    const room = rooms.get(code);

    if (!room) {
      socket.emit('room-error', 'Бөлме табылмады. Кодты тексеріңіз.');
      return;
    }
    if (socket.data.roomCode) {
      socket.emit('room-error', 'Сіз қазірдің өзінде бір бөлмеге қосылғансыз.');
      return;
    }

    const color = assignHumanSlot(room, socket.id);
    if (!color) {
      socket.emit('room-error', 'Бұл бөлмедегі адамға арналған орындардың бәрі бос емес.');
      return;
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.color = color;

    socket.emit('room-joined', {
      code,
      color,
      isHost: false,
      gameMode: room.gameMode,
      playerTypes: room.playerTypes,
      status: roomStatus(room)
    });

    emitStatus(room);

    if (room.started) {
      socket.emit('game-start', {
        code: room.code,
        gameMode: room.gameMode,
        playerTypes: room.playerTypes
      });
      if (room.state) {
        setTimeout(() => {
          socket.emit('game-state', { state: room.state, winner: room.winner });
        }, 150);
      }
    } else {
      maybeStart(room);
    }
  });

  socket.on('change-room-code', (payload = {}) => {
    const oldCode = socket.data.roomCode;
    const room = oldCode && rooms.get(oldCode);
    if (!room) {
      socket.emit('room-error', 'Алдымен бөлмеге қосылыңыз.');
      return;
    }
    if (room.hostSocketId !== socket.id) {
      socket.emit('room-error', 'Бөлме кодын тек бөлме иесі өзгерте алады.');
      return;
    }

    const newCode = normalizeRoomCode(payload.code);
    if (!isValidRoomCode(newCode)) {
      socket.emit('room-error', 'Жаңа код 4–12 таңбадан тұруы керек. Тек латын әріптері мен сандарды қолданыңыз.');
      return;
    }
    if (newCode === oldCode) {
      socket.emit('room-error', 'Жаңа код қазіргі кодпен бірдей.');
      return;
    }
    if (rooms.has(newCode)) {
      socket.emit('room-error', 'Бұл кодты басқа бөлме қолданып жатыр. Басқа код таңдаңыз.');
      return;
    }

    changeRoomCode(room, newCode);
  });

  socket.on('leave-room', (_payload = {}, ack) => {
    removeSocketFromRoom(socket, { announce: true });
    if (typeof ack === 'function') ack({ ok: true });
  });

  socket.on('game-state', (payload = {}) => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room || !room.started) return;
    if (!authorizedToSubmit(room, socket)) {
      socket.emit('room-error', 'Қазір сіздің кезегіңіз емес.');
      return;
    }

    const state = typeof payload.state === 'string' ? payload.state : '';
    if (!state || state.length > 250_000) return;

    let parsed;
    try {
      parsed = JSON.parse(state);
    } catch {
      return;
    }

    if (
      !parsed ||
      !Array.isArray(parsed.board) ||
      !COLORS.includes(parsed.currentPlayer) ||
      parsed.gameMode !== room.gameMode
    ) return;

    room.state = state;
    room.winner = payload.winner || null;
    room.expectedPlayer = parsed.currentPlayer;

    // База не должна тормозить игру: операции выполняются в отдельной очереди.
    queueDb(room, async () => {
      await ensureDbMatch(room);
      await saveNewMoves(room, parsed);
      if (room.winner) await finishDbMatch(room, room.winner);
    });

    socket.to(code).emit('game-state', {
      state: room.state,
      winner: room.winner
    });
  });

  socket.on('restart-room', () => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;

    // Старую незавершённую партию помечаем как прерванную.
    queueDb(room, async () => {
      await abandonDbMatch(room);
      room.dbMatchId = null;
      room.dbSavedMoveCount = 0;
      room.dbFinished = false;
      await ensureDbMatch(room);
    });

    room.state = null;
    room.winner = null;
    room.expectedPlayer = 'blue';
    io.to(code).emit('room-restart', {
      code,
      gameMode: room.gameMode,
      playerTypes: room.playerTypes
    });
  });

  socket.on('disconnect', () => {
    removeSocketFromRoom(socket, { announce: true });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Адия Қаздойбы сервері ${PORT} портында іске қосылды`);
});
