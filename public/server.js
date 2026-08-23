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
const rooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));

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

function humanColors(room) {
  return COLORS.filter(c => room.playerTypes[c] === 'human');
}

function connectedHumans(room) {
  return humanColors(room).filter(c => room.slots[c]).length;
}

function roomStatus(room) {
  return {
    code: room.code,
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
      gameMode: 'teams',
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

io.on('connection', (socket) => {
  socket.on('create-room', (payload = {}) => {
    if (socket.data.roomCode) return;

    const playerTypes = cleanPlayerTypes(payload.playerTypes);
    const humans = COLORS.filter(c => playerTypes[c] === 'human');
    if (humans.length === 0) {
      socket.emit('room-error', 'Нужен хотя бы один человек. Остальные места можно отдать ИИ.');
      return;
    }

    const code = makeRoomCode();
    const room = {
      code,
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
      playerTypes,
      status: roomStatus(room)
    });

    emitStatus(room);
    maybeStart(room);
  });

  socket.on('join-room', (payload = {}) => {
    const code = String(payload.code || '').trim().toUpperCase();
    const room = rooms.get(code);

    if (!room) {
      socket.emit('room-error', 'Комната не найдена. Проверьте код.');
      return;
    }
    if (socket.data.roomCode) {
      socket.emit('room-error', 'Вы уже подключены к комнате.');
      return;
    }

    const color = assignHumanSlot(room, socket.id);
    if (!color) {
      socket.emit('room-error', 'Все человеческие места в этой комнате уже заняты.');
      return;
    }

    socket.join(code);
    socket.data.roomCode = code;
    socket.data.color = color;

    socket.emit('room-joined', {
      code,
      color,
      isHost: false,
      playerTypes: room.playerTypes,
      status: roomStatus(room)
    });

    emitStatus(room);

    if (room.started) {
      socket.emit('game-start', {
        code: room.code,
        gameMode: 'teams',
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

  socket.on('game-state', (payload = {}) => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room || !room.started) return;
    if (!authorizedToSubmit(room, socket)) {
      socket.emit('room-error', 'Сейчас не ваш ход.');
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
      parsed.gameMode !== 'teams'
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
      gameMode: 'teams',
      playerTypes: room.playerTypes
    });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const room = code && rooms.get(code);
    if (!room) return;

    for (const color of COLORS) {
      if (room.slots[color] === socket.id) room.slots[color] = null;
    }

    const remainingIds = COLORS.map(c => room.slots[c]).filter(Boolean);
    if (remainingIds.length === 0) {
      rooms.delete(code);
      return;
    }

    if (room.hostSocketId === socket.id) {
      room.hostSocketId = remainingIds[0];
      io.to(room.hostSocketId).emit('host-changed', { isHost: true });
    }

    emitStatus(room);
    io.to(code).emit('player-disconnected', {
      color: socket.data.color || null
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🎮 Адия Қаздойбы public server started on port ${PORT}`);
});
