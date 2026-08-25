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
const ALLOWED_TIME_CONTROLS = new Set([180, 300, 600, 900]);
const SCORE_WEIGHTS = { remainingPawn: 1, remainingSultan: 2, capturedPawn: 1, capturedSultan: 2 };
const rooms = new Map();

// ==================== SUPABASE ====================
// Эти значения НЕ хранятся в GitHub. Render передаёт их через Environment Variables.
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || '');
const DB_ENABLED = Boolean(SUPABASE_URL && SUPABASE_SECRET_KEY);
const SUPABASE_PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
const AUTH_ENABLED = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

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

const DEFAULT_PROFILE = {
  rating: 1000,
  games: 0,
  wins: 0,
  losses: 0,
  draws: 0
};

function cleanPlayerName(value) {
  return String(value || '')
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}

function cleanClientId(value) {
  const id = String(value || '').trim().slice(0, 80);
  return /^[A-Za-z0-9_-]{12,80}$/.test(id) ? id : '';
}

function profileDto(row) {
  if (!row) return null;
  return {
    name: String(row.name || ''),
    email: String(row.email || ''),
    rating: Number(row.rating || DEFAULT_PROFILE.rating),
    games: Number(row.games || 0),
    wins: Number(row.wins || 0),
    losses: Number(row.losses || 0),
    draws: Number(row.draws || 0)
  };
}

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

function roomPlayerName(room, color) {
  const type = room.playerTypes[color];
  if (type === 'human') {
    return room.profiles?.[color]?.name || `${COLOR_NAMES_KK[color]} ойыншы`;
  }
  const level = BOT_LEVELS_KK[type] || '';
  return level ? `${COLOR_NAMES_KK[color]} ЖИ (${level})` : `${COLOR_NAMES_KK[color]} ЖИ`;
}

function dbPlayerRow(room, color) {
  const type = room.playerTypes[color];
  const isHuman = type === 'human';
  const profile = room.profiles?.[color] || null;
  return {
    match_id: room.dbMatchId,
    player_id: isHuman && profile?.id ? profile.id : null,
    player_name: roomPlayerName(room, color),
    color,
    player_type: isHuman ? 'human' : 'ai',
    bot_level: isHuman ? null : (type.replace('ai-', '') || null),
    result: null
  };
}

async function fetchAuthUser(accessToken) {
  const token = String(accessToken || '').trim();
  if (!AUTH_ENABLED || !token) return null;

  const response = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${token}`
    }
  });
  if (!response.ok) return null;
  const user = await response.json();
  return user && user.id ? user : null;
}

async function requireSocketUser(socket) {
  const token = String(socket.handshake?.auth?.token || '').trim();
  if (!token) throw new Error('Онлайн ойын үшін аккаунтқа кіріңіз.');
  if (socket.data.authUser && socket.data.authToken === token) return socket.data.authUser;

  const user = await fetchAuthUser(token);
  if (!user) throw new Error('Сессия аяқталды. Аккаунтқа қайта кіріңіз.');
  socket.data.authToken = token;
  socket.data.authUser = user;
  socket.data.authUserId = user.id;
  return user;
}

function fallbackNameFromAuthUser(authUser) {
  const meta = authUser?.user_metadata || {};
  const candidate = cleanPlayerName(meta.display_name || meta.name || '');
  if (candidate.length >= 2) return candidate;
  const emailPrefix = String(authUser?.email || '').split('@')[0] || '';
  return cleanPlayerName(emailPrefix).slice(0, 24) || 'Ойыншы';
}

async function ensurePlayerRecord(authUser, rawProfile = {}) {
  if (!authUser?.id) throw new Error('Аккаунтқа кіріңіз.');

  const requestedName = cleanPlayerName(rawProfile?.name);
  const name = requestedName.length >= 2 ? requestedName : fallbackNameFromAuthUser(authUser);
  const clientId = cleanClientId(rawProfile?.clientId);
  const email = String(authUser.email || '').trim().toLowerCase().slice(0, 320);

  if (name.length < 2) throw new Error('Атыңыз кемінде 2 таңбадан тұруы керек.');

  if (!DB_ENABLED) {
    return { id: null, auth_user_id: authUser.id, client_id: clientId || null, email, name, ...DEFAULT_PROFILE };
  }

  const select = 'id,auth_user_id,client_id,email,name,rating,games,wins,losses,draws';
  const found = await supabaseRest('players', {
    method: 'GET',
    query: `auth_user_id=eq.${encodeURIComponent(authUser.id)}&select=${select}&limit=1`
  });

  if (Array.isArray(found) && found[0]) {
    const row = found[0];
    const patch = {};
    if (row.name !== name) patch.name = name;
    if ((row.email || '') !== email) patch.email = email;
    if (clientId && row.client_id !== clientId) patch.client_id = clientId;
    if (Object.keys(patch).length) {
      const updated = await supabaseRest('players', {
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(row.id)}&select=${select}`,
        body: patch,
        prefer: 'return=representation'
      });
      return Array.isArray(updated) && updated[0] ? updated[0] : { ...row, ...patch };
    }
    return row;
  }

  // Бір реттік көшіру: v6-v8 нұсқаларындағы осы браузердің ескі профилін аккаунтқа байланыстырамыз.
  if (clientId) {
    const legacy = await supabaseRest('players', {
      method: 'GET',
      query: `client_id=eq.${encodeURIComponent(clientId)}&auth_user_id=is.null&select=${select}&limit=1`
    });
    if (Array.isArray(legacy) && legacy[0]) {
      const linked = await supabaseRest('players', {
        method: 'PATCH',
        query: `id=eq.${encodeURIComponent(legacy[0].id)}&select=${select}`,
        body: { auth_user_id: authUser.id, email, name },
        prefer: 'return=representation'
      });
      return Array.isArray(linked) && linked[0] ? linked[0] : { ...legacy[0], auth_user_id: authUser.id, email, name };
    }
  }

  const inserted = await supabaseRest('players', {
    method: 'POST',
    query: `select=${select}`,
    body: {
      auth_user_id: authUser.id,
      client_id: clientId || null,
      email,
      name,
      rating: DEFAULT_PROFILE.rating,
      games: 0,
      wins: 0,
      losses: 0,
      draws: 0
    },
    prefer: 'return=representation'
  });

  if (!Array.isArray(inserted) || !inserted[0]) throw new Error('Ойыншы профилін сақтау мүмкін болмады.');
  return inserted[0];
}

async function getPlayerByAuthUser(authUser) {
  if (!authUser?.id || !DB_ENABLED) return null;
  const found = await supabaseRest('players', {
    method: 'GET',
    query: `auth_user_id=eq.${encodeURIComponent(authUser.id)}&select=id,auth_user_id,client_id,email,name,rating,games,wins,losses,draws&limit=1`
  });
  return Array.isArray(found) && found[0] ? found[0] : null;
}

async function loadHomeData(authUser, rawClientId = '') {
  let player = await getPlayerByAuthUser(authUser);
  if (!player) player = await ensurePlayerRecord(authUser, { clientId: rawClientId });
  if (!player) return { profile: null, matches: [] };

  const ownRows = await supabaseRest('match_players', {
    method: 'GET',
    query: `player_id=eq.${encodeURIComponent(player.id)}&select=match_id,color,result&order=id.desc&limit=10`
  });

  const own = Array.isArray(ownRows) ? ownRows : [];
  const matchIds = [...new Set(own.map(row => Number(row.match_id)).filter(Number.isFinite))];
  if (matchIds.length === 0) {
    return { profile: profileDto(player), matches: [] };
  }

  const inFilter = `(${matchIds.join(',')})`;
  const [matchRows, participantRows] = await Promise.all([
    supabaseRest('matches', {
      method: 'GET',
      query: `id=in.${inFilter}&select=id,room_code,game_mode,winner,status,started_at,finished_at&order=id.desc`
    }),
    supabaseRest('match_players', {
      method: 'GET',
      query: `match_id=in.${inFilter}&select=match_id,player_name,color,player_type,result&order=id.asc`
    })
  ]);

  const matchesById = new Map((Array.isArray(matchRows) ? matchRows : []).map(row => [Number(row.id), row]));
  const playersByMatch = new Map();
  for (const row of (Array.isArray(participantRows) ? participantRows : [])) {
    const id = Number(row.match_id);
    if (!playersByMatch.has(id)) playersByMatch.set(id, []);
    playersByMatch.get(id).push({
      name: String(row.player_name || ''),
      color: String(row.color || ''),
      playerType: String(row.player_type || ''),
      result: row.result || null
    });
  }

  const result = [];
  for (const ownRow of own) {
    const matchId = Number(ownRow.match_id);
    const match = matchesById.get(matchId);
    if (!match) continue;
    result.push({
      id: matchId,
      roomCode: match.room_code || '',
      gameMode: match.game_mode === 'teams' ? 'teams' : 'ffa',
      winner: match.winner || null,
      status: match.status || 'playing',
      startedAt: match.started_at || null,
      finishedAt: match.finished_at || null,
      myColor: ownRow.color || null,
      result: ownRow.result || null,
      participants: playersByMatch.get(matchId) || []
    });
  }

  return { profile: profileDto(player), matches: result.slice(0, 8) };
}

async function updateMatchPlayerIdentity(room, color) {
  if (!DB_ENABLED || !room?.dbMatchId || room.dbFinished) return;
  await supabaseRest('match_players', {
    method: 'PATCH',
    query: `match_id=eq.${encodeURIComponent(room.dbMatchId)}&color=eq.${encodeURIComponent(color)}`,
    body: {
      player_id: room.profiles?.[color]?.id || null,
      player_name: roomPlayerName(room, color)
    },
    prefer: 'return=minimal'
  });
}

async function updatePlayerStatistics(room, winners, isDraw = false) {
  if (!DB_ENABLED || room.dbStatsUpdated) return;
  room.dbStatsUpdated = true;

  const humanParticipants = COLORS.filter(color =>
    room.playerTypes[color] === 'human' && room.profiles?.[color]?.id
  );

  const ratingEligible = humanParticipants.length >= 2;

  for (const color of humanParticipants) {
    const profile = room.profiles[color];
    const rows = await supabaseRest('players', {
      method: 'GET',
      query: `id=eq.${encodeURIComponent(profile.id)}&select=id,auth_user_id,client_id,email,name,rating,games,wins,losses,draws&limit=1`
    });
    const current = Array.isArray(rows) && rows[0] ? rows[0] : profile;
    const won = !isDraw && winners.has(color);

    let ratingDelta = 0;
    if (ratingEligible && !isDraw) {
      if (room.gameMode === 'teams') ratingDelta = won ? 20 : -20;
      else ratingDelta = won ? 30 : -10;
    }

    const next = {
      games: Number(current.games || 0) + 1,
      wins: Number(current.wins || 0) + (won ? 1 : 0),
      losses: Number(current.losses || 0) + (!won && !isDraw ? 1 : 0),
      draws: Number(current.draws || 0) + (isDraw ? 1 : 0),
      rating: Math.max(100, Number(current.rating || DEFAULT_PROFILE.rating) + ratingDelta)
    };

    const updated = await supabaseRest('players', {
      method: 'PATCH',
      query: `id=eq.${encodeURIComponent(profile.id)}&select=id,auth_user_id,client_id,email,name,rating,games,wins,losses,draws`,
      body: next,
      prefer: 'return=representation'
    });

    const row = Array.isArray(updated) && updated[0] ? updated[0] : { ...current, ...next };
    room.profiles[color] = row;

    const socketId = room.slots[color];
    if (socketId) {
      io.to(socketId).emit('profile-updated', {
        profile: profileDto(row),
        ratingDelta,
        result: isDraw ? 'draw' : (won ? 'win' : 'loss')
      });
    }
  }
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
  room.dbStatsUpdated = false;

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
  const isDraw = String(winner) === 'draw';
  const winners = new Set(isDraw ? [] : winningColors(room, winner));
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
      body: { result: isDraw ? 'draw' : (winners.has(color) ? 'win' : 'loss') },
      prefer: 'return=minimal'
    });
  }

  if (isDraw || winners.size > 0) {
    await updatePlayerStatistics(room, winners, isDraw);
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
  room.dbStatsUpdated = false;
  queueDb(room, () => ensureDbMatch(room));
}

if (DB_ENABLED) {
  console.log('✅ Supabase бапталды: ойын нәтижелері базаға сақталады.');
} else {
  console.warn('⚠️ Supabase өшірулі: SUPABASE_URL немесе SUPABASE_SECRET_KEY табылмады.');
}
if (AUTH_ENABLED) console.log('✅ Supabase Auth бапталды.');
else console.warn('⚠️ Auth өшірулі: SUPABASE_PUBLISHABLE_KEY табылмады.');

// ==================== WEB SERVER ====================
app.get('/config.js', (_req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.KAZ_PUBLIC_CONFIG=${JSON.stringify({
    supabaseUrl: SUPABASE_URL,
    supabasePublishableKey: SUPABASE_PUBLISHABLE_KEY
  })};`);
});
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({
  ok: true,
  rooms: rooms.size,
  database: DB_ENABLED ? 'configured' : 'disabled',
  auth: AUTH_ENABLED ? 'configured' : 'disabled'
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

function cleanTimeControl(value) {
  const sec = Number(value);
  return ALLOWED_TIME_CONTROLS.has(sec) ? sec : 600;
}

function clearRoomTimer(room) {
  if (room?.timerHandle) clearTimeout(room.timerHandle);
  if (room) room.timerHandle = null;
}

function defaultCaptureStats() {
  return COLORS.reduce((out, color) => {
    out[color] = { pawns: 0, sultans: 0 };
    return out;
  }, {});
}

function calculateRoomTimeScore(room) {
  let parsed = null;
  if (room?.state) {
    try { parsed = JSON.parse(room.state); } catch (_) {}
  }

  const remaining = COLORS.reduce((out, color) => {
    out[color] = { pawns: 0, sultans: 0 };
    return out;
  }, {});

  if (parsed?.board && Array.isArray(parsed.board)) {
    for (const row of parsed.board) {
      if (!Array.isArray(row)) continue;
      for (const piece of row) {
        if (!piece || !remaining[piece.player]) continue;
        if (piece.isSultan) remaining[piece.player].sultans++;
        else remaining[piece.player].pawns++;
      }
    }
  } else {
    // Егер әлі бірде-бір күй келмесе, бастапқы позиция: әр түсте 8 жай тас.
    for (const color of COLORS) remaining[color].pawns = 8;
  }

  const captures = parsed?.captureStats || defaultCaptureStats();
  const scoreColor = color => {
    const rem = remaining[color] || { pawns: 0, sultans: 0 };
    const capRaw = captures[color] || {};
    const cap = { pawns: Number(capRaw.pawns || 0), sultans: Number(capRaw.sultans || 0) };
    return {
      id: color,
      label: COLOR_NAMES_KK[color] || color,
      remainingPawns: Number(rem.pawns || 0),
      remainingSultans: Number(rem.sultans || 0),
      capturedPawns: cap.pawns,
      capturedSultans: cap.sultans,
      remainingTotal: Number(rem.pawns || 0) + Number(rem.sultans || 0),
      score:
        Number(rem.pawns || 0) * SCORE_WEIGHTS.remainingPawn +
        Number(rem.sultans || 0) * SCORE_WEIGHTS.remainingSultan +
        cap.pawns * SCORE_WEIGHTS.capturedPawn +
        cap.sultans * SCORE_WEIGHTS.capturedSultan
    };
  };

  let entries;
  if (room.gameMode === 'teams') {
    const makeTeam = (id, label, members) => {
      const parts = members.map(scoreColor);
      return {
        id,
        label,
        members,
        remainingPawns: parts.reduce((n, x) => n + x.remainingPawns, 0),
        remainingSultans: parts.reduce((n, x) => n + x.remainingSultans, 0),
        capturedPawns: parts.reduce((n, x) => n + x.capturedPawns, 0),
        capturedSultans: parts.reduce((n, x) => n + x.capturedSultans, 0),
        remainingTotal: parts.reduce((n, x) => n + x.remainingTotal, 0),
        score: parts.reduce((n, x) => n + x.score, 0),
        eligible: parts.some(x => x.remainingTotal > 0),
        memberBreakdown: parts
      };
    };
    entries = [
      makeTeam('blue-black', 'Көк + Қара', ['blue', 'black']),
      makeTeam('red-white', 'Қызыл + Ақ', ['red', 'white'])
    ];
  } else {
    entries = COLORS.map(color => ({ ...scoreColor(color), eligible: remaining[color].pawns + remaining[color].sultans > 0 }));
  }

  const eligible = entries.filter(entry => entry.eligible);
  const maxScore = eligible.length ? Math.max(...eligible.map(entry => entry.score)) : 0;
  const leaders = eligible.filter(entry => entry.score === maxScore);
  let winner = 'draw';
  if (leaders.length === 1) winner = room.gameMode === 'teams' ? leaders[0].label : leaders[0].id;

  return {
    reason: 'time',
    winner,
    isDraw: winner === 'draw',
    gameMode: room.gameMode,
    entries,
    weights: { ...SCORE_WEIGHTS },
    endedAt: new Date().toISOString()
  };
}

async function finishRoomByTime(room) {
  if (!room || !rooms.has(room.code) || !room.started || room.winner) return;
  clearRoomTimer(room);
  const result = calculateRoomTimeScore(room);
  room.winner = result.winner;
  room.timeResult = result;
  room.endReason = 'time';

  queueDb(room, async () => {
    await ensureDbMatch(room);
    let parsed = null;
    try { parsed = room.state ? JSON.parse(room.state) : null; } catch (_) {}
    if (parsed) await saveNewMoves(room, parsed);
    await finishDbMatch(room, room.winner);
  });

  io.to(room.code).emit('time-expired', {
    deadlineAt: room.deadlineAt,
    winner: room.winner,
    result
  });
  emitStatus(room);
}

function scheduleRoomTimer(room, resetDeadline = false) {
  clearRoomTimer(room);
  if (!room?.started || room.winner) return;
  room.timeControlSec = cleanTimeControl(room.timeControlSec);
  if (resetDeadline || !Number(room.deadlineAt)) {
    room.deadlineAt = Date.now() + room.timeControlSec * 1000;
  }
  const wait = Math.max(0, room.deadlineAt - Date.now());
  room.timerHandle = setTimeout(() => {
    finishRoomByTime(room).catch(error => console.error('⏰ Таймер қатесі:', error.message));
  }, wait + 20);
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
  const playerNames = {};
  for (const color of COLORS) playerNames[color] = roomPlayerName(room, color);

  return {
    code: room.code,
    gameMode: room.gameMode,
    timeControlSec: room.timeControlSec,
    deadlineAt: room.deadlineAt || null,
    winner: room.winner || null,
    endReason: room.endReason || null,
    started: room.started,
    playerTypes: room.playerTypes,
    playerNames,
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
    room.winner = null;
    room.endReason = null;
    room.timeResult = null;
    room.deadlineAt = Date.now() + room.timeControlSec * 1000;
    scheduleRoomTimer(room);
    startFreshDbMatch(room);

    io.to(room.code).emit('game-start', {
      code: room.code,
      gameMode: room.gameMode,
      timeControlSec: room.timeControlSec,
      deadlineAt: room.deadlineAt,
      playerTypes: room.playerTypes,
      playerNames: roomStatus(room).playerNames
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
    clearRoomTimer(room);
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
  socket.on('home-data', async (payload = {}, ack) => {
    try {
      const authUser = await requireSocketUser(socket);
      const data = await loadHomeData(authUser, payload.clientId);
      if (typeof ack === 'function') ack({ ok: true, ...data });
    } catch (error) {
      console.error('❌ Басты бет деректері:', error.message);
      if (typeof ack === 'function') {
        ack({ ok: false, authRequired: true, profile: null, matches: [], message: error.message });
      }
    }
  });

  socket.on('profile-save', async (payload = {}, ack) => {
    try {
      const authUser = await requireSocketUser(socket);
      const profile = await ensurePlayerRecord(authUser, payload);
      socket.data.playerProfile = profile;
      if (typeof ack === 'function') ack({ ok: true, profile: profileDto(profile) });
    } catch (error) {
      console.error('❌ Профиль қатесі:', error.message);
      if (typeof ack === 'function') ack({ ok: false, authRequired: true, message: error.message });
    }
  });

  socket.on('create-room', async (payload = {}) => {
    if (socket.data.roomCode) return;

    const gameMode = cleanGameMode(payload.gameMode);
    const timeControlSec = cleanTimeControl(payload.timeControlSec);
    const playerTypes = cleanPlayerTypes(payload.playerTypes);
    const humans = COLORS.filter(c => playerTypes[c] === 'human');
    if (humans.length === 0) {
      socket.emit('room-error', 'Кемінде бір ойыншы «Адам» болуы керек. Қалған орындарды ЖИ-ға беруге болады.');
      return;
    }

    let profile;
    let authUser;
    try {
      authUser = await requireSocketUser(socket);
      profile = await ensurePlayerRecord(authUser, payload.profile || {});
    } catch (error) {
      socket.emit('room-error', `Аккаунт қатесі: ${error.message}`);
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
      timeControlSec,
      deadlineAt: null,
      timerHandle: null,
      endReason: null,
      timeResult: null,
      hostSocketId: socket.id,
      playerTypes,
      slots: { blue: null, black: null, red: null, white: null },
      profiles: { blue: null, black: null, red: null, white: null },
      started: false,
      expectedPlayer: 'blue',
      state: null,
      winner: null,
      createdAt: Date.now(),
      dbMatchId: null,
      dbSavedMoveCount: 0,
      dbFinished: false,
      dbStatsUpdated: false,
      dbQueue: Promise.resolve()
    };

    const color = assignHumanSlot(room, socket.id);
    room.profiles[color] = profile;
    rooms.set(code, room);

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.color = color;
    socket.data.playerProfile = profile;
    socket.data.authUserId = authUser.id;

    socket.emit('room-created', {
      code,
      color,
      isHost: true,
      gameMode,
      timeControlSec,
      deadlineAt: room.deadlineAt,
      playerTypes,
      profile: profileDto(profile),
      status: roomStatus(room)
    });

    emitStatus(room);
    maybeStart(room);
  });

  socket.on('join-room', async (payload = {}) => {
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

    let profile;
    let authUser;
    try {
      authUser = await requireSocketUser(socket);
      profile = await ensurePlayerRecord(authUser, payload.profile || {});
    } catch (error) {
      socket.emit('room-error', `Аккаунт қатесі: ${error.message}`);
      return;
    }

    const duplicateAccount = COLORS.some(c => room.profiles?.[c]?.auth_user_id === authUser.id);
    if (duplicateAccount) {
      socket.emit('room-error', 'Бұл аккаунт осы бөлмеде әлдеқашан бар. Бір аккаунтпен екі орын алуға болмайды.');
      return;
    }

    const color = assignHumanSlot(room, socket.id);
    if (!color) {
      socket.emit('room-error', 'Бұл бөлмедегі адамға арналған орындардың бәрі бос емес.');
      return;
    }

    room.profiles[color] = profile;
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.color = color;
    socket.data.playerProfile = profile;
    socket.data.authUserId = authUser.id;

    socket.emit('room-joined', {
      code,
      color,
      isHost: false,
      gameMode: room.gameMode,
      timeControlSec: room.timeControlSec,
      deadlineAt: room.deadlineAt,
      playerTypes: room.playerTypes,
      profile: profileDto(profile),
      status: roomStatus(room)
    });

    emitStatus(room);

    if (room.started) {
      queueDb(room, () => updateMatchPlayerIdentity(room, color));

      socket.emit('game-start', {
        code: room.code,
        gameMode: room.gameMode,
        timeControlSec: room.timeControlSec,
        deadlineAt: room.deadlineAt,
        playerTypes: room.playerTypes,
        playerNames: roomStatus(room).playerNames
      });
      if (room.state) {
        setTimeout(() => {
          socket.emit('game-state', { state: room.state, winner: room.winner, endReason: room.endReason || null, timeResult: room.timeResult || null });
        }, 150);
      }
      if (room.timeResult) {
        setTimeout(() => socket.emit('time-expired', { deadlineAt: room.deadlineAt, winner: room.winner, result: room.timeResult }), 220);
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
    if (!room || !room.started || room.winner) return;
    if (room.deadlineAt && Date.now() >= room.deadlineAt) {
      finishRoomByTime(room).catch(error => console.error('⏰ Таймер қатесі:', error.message));
      return;
    }
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
    room.endReason = payload.endReason || (room.winner ? 'normal' : null);
    room.timeResult = payload.timeResult || null;
    room.expectedPlayer = parsed.currentPlayer;
    if (room.winner) clearRoomTimer(room);

    // База не должна тормозить игру: операции выполняются в отдельной очереди.
    queueDb(room, async () => {
      await ensureDbMatch(room);
      await saveNewMoves(room, parsed);
      if (room.winner) await finishDbMatch(room, room.winner);
    });

    socket.to(code).emit('game-state', {
      state: room.state,
      winner: room.winner,
      endReason: room.endReason || null,
      timeResult: room.timeResult || null
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
      room.dbStatsUpdated = false;
      await ensureDbMatch(room);
    });

    room.state = null;
    room.winner = null;
    room.endReason = null;
    room.timeResult = null;
    room.expectedPlayer = 'blue';
    room.deadlineAt = Date.now() + room.timeControlSec * 1000;
    scheduleRoomTimer(room);
    io.to(code).emit('room-restart', {
      code,
      gameMode: room.gameMode,
      timeControlSec: room.timeControlSec,
      deadlineAt: room.deadlineAt,
      playerTypes: room.playerTypes,
      playerNames: roomStatus(room).playerNames
    });
  });

  socket.on('disconnect', () => {
    removeSocketFromRoom(socket, { announce: true });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Адия Қаздойбы сервері ${PORT} портында іске қосылды`);
});
