(() => {
  'use strict';

  const COLORS = ['blue', 'black', 'red', 'white'];
  const LABELS = { blue: '🔵 Көк', black: '⚫ Қара', red: '🔴 Қызыл', white: '⚪ Ақ' };

  const NET = {
    active: false,
    started: false,
    roomCode: null,
    myColor: null,
    isHost: false,
    suppressSync: false,
    lastStatus: null
  };
  window.KAZ_NET = NET;

  const statusEl = document.getElementById('networkStatus');
  const codeInput = document.getElementById('roomCodeInput');
  const createBtn = document.getElementById('btnCreateRoom');
  const joinBtn = document.getElementById('btnJoinRoom');
  const copyBtn = document.getElementById('btnCopyInvite');

  function setNetStatus(html) {
    if (statusEl) statusEl.innerHTML = html;
  }

  function readPlayerTypes() {
    const result = {};
    for (const color of COLORS) {
      const el = document.getElementById(color + 'Type');
      result[color] = el ? el.value : 'human';
    }
    return result;
  }

  function applySettings(playerTypes) {
    const mode = document.getElementById('gameMode');
    if (mode) mode.value = 'teams';
    CURRENT_GAME_MODE = 'teams';

    for (const color of COLORS) {
      const el = document.getElementById(color + 'Type');
      if (el && playerTypes[color]) el.value = playerTypes[color];
    }
  }

  function lockSetupForNetwork() {
    const mode = document.getElementById('gameMode');
    if (mode) mode.disabled = true;
    for (const color of COLORS) {
      const el = document.getElementById(color + 'Type');
      if (el) el.disabled = true;
    }
    const localStart = document.querySelector('.btn-start');
    const localLoad = document.getElementById('btnLoadGame');
    if (localStart) localStart.disabled = true;
    if (localLoad) localLoad.style.display = 'none';
  }

  function roomText(status) {
    if (!status) return '';
    return `Игроки: ${status.connected}/${status.needed}`;
  }

  function refreshStatus(extra = '') {
    const code = NET.roomCode ? `<span class="network-code">${NET.roomCode}</span>` : '—';
    const me = NET.myColor ? LABELS[NET.myColor] : '—';
    const host = NET.isHost ? ' 👑 Вы хозяин комнаты.' : '';
    const wait = NET.lastStatus ? ` ${roomText(NET.lastStatus)}.` : '';
    setNetStatus(`Комната: ${code} | Вы: ${me}.${host}${wait}${extra ? '<br>' + extra : ''}`);
  }

  function inviteUrl() {
    if (!NET.roomCode) return location.origin;
    return `${location.origin}/?room=${encodeURIComponent(NET.roomCode)}`;
  }

  if (codeInput) {
    const q = new URLSearchParams(location.search).get('room');
    if (q) codeInput.value = q.toUpperCase().slice(0, 6);
    codeInput.addEventListener('input', () => {
      codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    });
  }

  if (typeof io !== 'function') {
    setNetStatus('❌ Socket.IO не загрузился. Открывайте игру через Node.js сервер, а не двойным кликом по index.html.');
    return;
  }

  const socket = io();

  socket.on('connect', () => {
    if (!NET.active) setNetStatus('✅ Сервер доступен. Создайте комнату или введите код.');
  });

  socket.on('connect_error', () => {
    setNetStatus('❌ Нет соединения с сервером. Обновите страницу через несколько секунд.');
  });

  createBtn?.addEventListener('click', () => {
    const playerTypes = readPlayerTypes();
    const humans = COLORS.filter(c => playerTypes[c] === 'human');
    if (humans.length === 0) {
      alert('Выберите хотя бы одного человека.');
      return;
    }

    const mode = document.getElementById('gameMode');
    if (mode) mode.value = 'teams';

    createBtn.disabled = true;
    joinBtn.disabled = true;
    setNetStatus('⏳ Создаю комнату...');
    socket.emit('create-room', { gameMode: 'teams', playerTypes });
  });

  joinBtn?.addEventListener('click', () => {
    const code = (codeInput?.value || '').trim().toUpperCase();
    if (code.length !== 6) {
      alert('Введите 6-значный код комнаты.');
      return;
    }
    createBtn.disabled = true;
    joinBtn.disabled = true;
    setNetStatus('⏳ Подключаюсь...');
    socket.emit('join-room', { code });
  });

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl());
      refreshStatus('✅ Ссылка скопирована.');
    } catch {
      prompt('Скопируйте ссылку:', inviteUrl());
    }
  });

  function onJoined(data) {
    NET.active = true;
    NET.roomCode = data.code;
    NET.myColor = data.color;
    NET.isHost = !!data.isHost;
    NET.lastStatus = data.status || null;

    if (codeInput) codeInput.value = data.code;
    if (copyBtn) copyBtn.style.display = '';
    applySettings(data.playerTypes || {});
    lockSetupForNetwork();
    refreshStatus('Ждём остальных человеческих игроков...');
  }

  socket.on('room-created', onJoined);
  socket.on('room-joined', onJoined);

  socket.on('room-status', status => {
    NET.lastStatus = status;
    if (NET.active) {
      refreshStatus(status.started ? '🎮 Игра запущена.' : '⏳ Ждём игроков...');
    }
  });

  socket.on('room-error', message => {
    if (!NET.active) {
      createBtn.disabled = false;
      joinBtn.disabled = false;
    }
    setNetStatus(`❌ ${message}`);
  });

  socket.on('host-changed', () => {
    NET.isHost = true;
    refreshStatus('👑 Теперь ваш браузер управляет ходами ИИ.');
    maybeRunAi();
  });

  socket.on('player-disconnected', data => {
    const label = data?.color ? LABELS[data.color] : 'Игрок';
    refreshStatus(`⚠️ ${label} отключился. Он может снова войти по тому же коду.`);
  });

  function ensureGameStarted(playerTypes) {
    applySettings(playerTypes || {});
    if (!game) {
      startGame(false);
    }
    NET.started = true;

    const setup = document.getElementById('setup');
    if (setup) setup.classList.add('hidden');

    refreshStatus('🎮 Игра 2×2 началась.');
    setTimeout(maybeRunAi, 180);
  }

  socket.on('game-start', data => {
    ensureGameStarted(data.playerTypes || {});
  });

  function applyRemoteState(payload) {
    if (!payload?.state || !game) return;

    NET.suppressSync = true;
    try {
      game.aiGeneration++;
      game._loadStateData(payload.state);
      game.winner = payload.winner || null;
      game._findAllMandatoryCaptures();
      game.updateBoard();
      game.updateHud();
      game.renderHistory();
    } finally {
      NET.suppressSync = false;
    }
    setTimeout(maybeRunAi, 180);
  }

  socket.on('game-state', applyRemoteState);

  socket.on('room-restart', data => {
    applySettings(data.playerTypes || {});
    NET.suppressSync = true;
    try {
      localStorage.removeItem('kazdoiba_save');
      game = new KazdoibaGame();
      game.updateBoard();
      game.updateHud();
      game.renderHistory();
    } finally {
      NET.suppressSync = false;
    }
    refreshStatus('🔄 Игра начата заново.');
    setTimeout(maybeRunAi, 180);
  });

  function maybeRunAi() {
    if (!NET.active || !NET.started || !NET.isHost || !game || game.winner) return;
    if (game.playerTypes[game.currentPlayer] !== 'human') {
      setTimeout(() => game.makeAiMove(), 120);
    }
  }

  // ----- Patch: only the owner of the current human color can click -----
  const originalHandleClick = KazdoibaGame.prototype.handleClick;
  KazdoibaGame.prototype.handleClick = function(r, c) {
    if (NET.active && NET.started && NET.myColor !== this.currentPlayer) return;
    return originalHandleClick.call(this, r, c);
  };

  // ----- Patch: only the host browser calculates AI moves -----
  const originalMakeAiMove = KazdoibaGame.prototype.makeAiMove;
  KazdoibaGame.prototype.makeAiMove = function() {
    if (NET.active && NET.started && !NET.isHost) return;
    return originalMakeAiMove.call(this);
  };

  // ----- Patch: at the end of each turn send the serialized game to server -----
  const originalSave = KazdoibaGame.prototype.saveToLocalStorage;
  KazdoibaGame.prototype.saveToLocalStorage = function() {
    originalSave.call(this);

    if (NET.active && NET.started && !NET.suppressSync) {
      socket.emit('game-state', {
        state: this._serializeState(),
        winner: this.winner || null
      });
    }
  };

  // ----- Patch HUD for online mode -----
  const originalUpdateHud = KazdoibaGame.prototype.updateHud;
  KazdoibaGame.prototype.updateHud = function() {
    originalUpdateHud.call(this);
    if (!NET.active) return;

    const undo = document.getElementById('btnUndo');
    if (undo) {
      undo.disabled = true;
      undo.title = 'В онлайн-режиме отмена отключена, чтобы игроки не рассинхронизировались.';
    }

    const hint = document.getElementById('btnHint');
    if (hint && NET.started) {
      hint.disabled = this.currentPlayer !== NET.myColor || this.playerTypes[this.currentPlayer] !== 'human';
    }
  };

  // ----- Online restart: host restarts for everyone -----
  const originalRestartGame = window.restartGame || restartGame;
  window.restartGame = function() {
    if (!NET.active) return originalRestartGame();
    if (!NET.isHost) {
      alert('Только хозяин комнаты может перезапустить сетевую игру.');
      return;
    }
    if (confirm('Начать сетевую игру заново для всех?')) {
      socket.emit('restart-room');
    }
  };

  // Expose for debugging
  window.kazSocket = socket;
})();
