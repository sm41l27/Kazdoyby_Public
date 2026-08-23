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
  const changeCodeBtn = document.getElementById('btnChangeRoomCode');
  const leaveBtn = document.getElementById('btnLeaveRoom');

  function setNetStatus(html) {
    if (statusEl) statusEl.innerHTML = html;
  }

  function normalizeCode(value) {
    return String(value || '')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, '')
      .slice(0, 12);
  }

  function validCode(value) {
    return /^[A-Z0-9]{4,12}$/.test(value);
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
    if (codeInput) codeInput.disabled = true;
  }

  function roomText(status) {
    if (!status) return '';
    return `Ойыншылар: ${status.connected}/${status.needed}`;
  }

  function refreshButtons() {
    if (copyBtn) copyBtn.style.display = NET.active ? '' : 'none';
    if (leaveBtn) leaveBtn.style.display = NET.active ? '' : 'none';
    if (changeCodeBtn) changeCodeBtn.style.display = NET.active && NET.isHost ? '' : 'none';
  }

  function refreshStatus(extra = '') {
    const code = NET.roomCode ? `<span class="network-code">${NET.roomCode}</span>` : '—';
    const me = NET.myColor ? LABELS[NET.myColor] : '—';
    const host = NET.isHost ? ' 👑 Сіз бөлме иесісіз.' : '';
    const wait = NET.lastStatus ? ` ${roomText(NET.lastStatus)}.` : '';
    setNetStatus(`Бөлме: ${code} | Сіз: ${me}.${host}${wait}${extra ? '<br>' + extra : ''}`);
    refreshButtons();
  }

  function inviteUrl() {
    if (!NET.roomCode) return location.origin;
    return `${location.origin}/?room=${encodeURIComponent(NET.roomCode)}`;
  }

  function putRoomInUrl(code) {
    try {
      const url = new URL(location.href);
      if (code) url.searchParams.set('room', code);
      else url.searchParams.delete('room');
      history.replaceState(null, '', url);
    } catch (_) {}
  }

  if (codeInput) {
    const q = new URLSearchParams(location.search).get('room');
    if (q) codeInput.value = normalizeCode(q);
    codeInput.addEventListener('input', () => {
      codeInput.value = normalizeCode(codeInput.value);
    });
  }

  if (typeof io !== 'function') {
    setNetStatus('❌ Socket.IO жүктелмеді. Ойынды index.html файлын екі рет басып емес, Node.js сервері арқылы ашыңыз.');
    return;
  }

  const socket = io();

  socket.on('connect', () => {
    if (!NET.active) setNetStatus('✅ Серверге қосылдық. Бөлме құрыңыз немесе бөлме кодын енгізіңіз.');
  });

  socket.on('connect_error', () => {
    setNetStatus('❌ Сервермен байланыс жоқ. Бірнеше секундтан кейін бетті жаңартып көріңіз.');
  });

  createBtn?.addEventListener('click', () => {
    const playerTypes = readPlayerTypes();
    const humans = COLORS.filter(c => playerTypes[c] === 'human');
    if (humans.length === 0) {
      alert('Кемінде бір түске «Адам» таңдаңыз.');
      return;
    }

    const requestedCode = normalizeCode(codeInput?.value || '');
    if (requestedCode && !validCode(requestedCode)) {
      alert('Өз кодыңызды қолдансаңыз, ол 4–12 таңбадан тұруы керек. Тек латын әріптері мен сандарды қолданыңыз. Кодты бос қалдырсаңыз, сервер өзі код береді.');
      return;
    }

    const mode = document.getElementById('gameMode');
    if (mode) mode.value = 'teams';

    createBtn.disabled = true;
    joinBtn.disabled = true;
    setNetStatus('⏳ Бөлме құрылып жатыр...');
    socket.emit('create-room', { gameMode: 'teams', playerTypes, code: requestedCode || null });
  });

  joinBtn?.addEventListener('click', () => {
    const code = normalizeCode(codeInput?.value || '');
    if (!validCode(code)) {
      alert('4–12 таңбалы бөлме кодын енгізіңіз.');
      return;
    }
    createBtn.disabled = true;
    joinBtn.disabled = true;
    setNetStatus('⏳ Бөлмеге қосылып жатырмыз...');
    socket.emit('join-room', { code });
  });

  copyBtn?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl());
      refreshStatus('✅ Бөлме сілтемесі көшірілді.');
    } catch {
      prompt('Сілтемені көшіріп алыңыз:', inviteUrl());
    }
  });

  changeCodeBtn?.addEventListener('click', () => {
    if (!NET.active || !NET.isHost) return;
    const entered = prompt('Жаңа бөлме кодын енгізіңіз (4–12 таңба, тек A–Z және 0–9):', NET.roomCode || '');
    if (entered === null) return;
    const code = normalizeCode(entered);
    if (!validCode(code)) {
      alert('Код 4–12 таңбадан тұруы керек. Тек латын әріптері мен сандарды қолданыңыз.');
      return;
    }
    socket.emit('change-room-code', { code });
  });

  leaveBtn?.addEventListener('click', () => {
    if (!NET.active) return;
    if (!confirm('Бөлмеден шығасыз ба?')) return;
    leaveBtn.disabled = true;
    socket.emit('leave-room', {}, () => {
      location.href = location.origin;
    });
    setTimeout(() => {
      location.href = location.origin;
    }, 1200);
  });

  function onJoined(data) {
    NET.active = true;
    NET.roomCode = data.code;
    NET.myColor = data.color;
    NET.isHost = !!data.isHost;
    NET.lastStatus = data.status || null;

    if (codeInput) codeInput.value = data.code;
    putRoomInUrl(data.code);
    applySettings(data.playerTypes || {});
    lockSetupForNetwork();
    refreshStatus('⏳ Қалған адам ойыншыларын күтеміз...');
  }

  socket.on('room-created', onJoined);
  socket.on('room-joined', onJoined);

  socket.on('room-code-changed', data => {
    if (!data?.code) return;
    NET.roomCode = data.code;
    if (codeInput) codeInput.value = data.code;
    putRoomInUrl(data.code);
    refreshStatus('✅ Бөлме коды өзгертілді. Ескі код енді жұмыс істемейді.');
  });

  socket.on('room-status', status => {
    NET.lastStatus = status;
    if (NET.active) {
      refreshStatus(status.started ? '🎮 Ойын басталды.' : '⏳ Ойыншыларды күтеміз...');
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
    refreshStatus('👑 Енді сіз бөлме иесісіз және ЖИ жүрістерін сіздің браузеріңіз есептейді.');
    maybeRunAi();
  });

  socket.on('player-left', data => {
    const label = data?.color ? LABELS[data.color] : 'Ойыншы';
    refreshStatus(`⚠️ ${label} бөлмеден шықты. Бос орынға басқа ойыншы қосыла алады.`);
  });

  function ensureGameStarted(playerTypes) {
    applySettings(playerTypes || {});
    if (!game) {
      startGame(false);
    }
    NET.started = true;

    const setup = document.getElementById('setup');
    if (setup) setup.classList.add('hidden');

    refreshStatus('🎮 2×2 ойыны басталды.');
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
    refreshStatus('🔄 Ойын қайта басталды.');
    setTimeout(maybeRunAi, 180);
  });

  function maybeRunAi() {
    if (!NET.active || !NET.started || !NET.isHost || !game || game.winner) return;
    if (game.playerTypes[game.currentPlayer] !== 'human') {
      setTimeout(() => game.makeAiMove(), 120);
    }
  }

  const originalHandleClick = KazdoibaGame.prototype.handleClick;
  KazdoibaGame.prototype.handleClick = function(r, c) {
    if (NET.active && NET.started && NET.myColor !== this.currentPlayer) return;
    return originalHandleClick.call(this, r, c);
  };

  const originalMakeAiMove = KazdoibaGame.prototype.makeAiMove;
  KazdoibaGame.prototype.makeAiMove = function() {
    if (NET.active && NET.started && !NET.isHost) return;
    return originalMakeAiMove.call(this);
  };

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

  const originalUpdateHud = KazdoibaGame.prototype.updateHud;
  KazdoibaGame.prototype.updateHud = function() {
    originalUpdateHud.call(this);
    if (!NET.active) return;

    const undo = document.getElementById('btnUndo');
    if (undo) {
      undo.disabled = true;
      undo.title = 'Онлайн ойында ойыншылардың тақтасы әртүрлі болып кетпеуі үшін жүрісті болдырмау өшірілген.';
    }

    const hint = document.getElementById('btnHint');
    if (hint && NET.started) {
      hint.disabled = this.currentPlayer !== NET.myColor || this.playerTypes[this.currentPlayer] !== 'human';
    }
  };

  const originalRestartGame = window.restartGame || restartGame;
  window.restartGame = function() {
    if (!NET.active) return originalRestartGame();
    if (!NET.isHost) {
      alert('Онлайн ойынды тек бөлме иесі қайта бастай алады.');
      return;
    }
    if (confirm('Онлайн ойынды барлық ойыншы үшін қайта бастаймыз ба?')) {
      socket.emit('restart-room');
    }
  };

  window.kazSocket = socket;
})();
