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

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

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
      createdAt: Date.now()
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

    socket.to(code).emit('game-state', {
      state: room.state,
      winner: room.winner
    });
  });

  socket.on('restart-room', () => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room || room.hostSocketId !== socket.id) return;

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
