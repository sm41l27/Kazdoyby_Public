(() => {
  'use strict';

  const COLORS = ['blue', 'black', 'red', 'white'];
  const LABELS = { blue: '🔵 Көк', black: '⚫ Қара', red: '🔴 Қызыл', white: '⚪ Ақ' };
  const MODE_LABELS = { ffa: '👤 Жеке ойын', teams: '🤝 Командалық ойын' };
  const CLIENT_ID_KEY = 'kazdoiba_client_id';
  const PLAYER_NAME_KEY = 'kazdoiba_player_name';

  const NET = {
    active: false,
    started: false,
    roomCode: null,
    myColor: null,
    isHost: false,
    gameMode: 'ffa',
    timeControlSec: 600,
    deadlineAt: null,
    suppressSync: false,
    lastStatus: null,
    playerNames: {},
    profile: null
  };
  window.KAZ_NET = NET;

  const statusEl = document.getElementById('networkStatus');
  const codeInput = document.getElementById('roomCodeInput');
  const createBtn = document.getElementById('btnCreateRoom');
  const joinBtn = document.getElementById('btnJoinRoom');
  const copyBtn = document.getElementById('btnCopyInvite');
  const changeCodeBtn = document.getElementById('btnChangeRoomCode');
  const leaveBtn = document.getElementById('btnLeaveRoom');

  const nameInput = document.getElementById('playerNameInput');
  const saveProfileBtn = document.getElementById('btnSaveProfile');
  const profileMessage = document.getElementById('profileMessage');
  const profileRating = document.getElementById('profileRating');
  const profileGames = document.getElementById('profileGames');
  const profileWins = document.getElementById('profileWins');
  const profileLosses = document.getElementById('profileLosses');
  const profileDraws = document.getElementById('profileDraws');
  const onlineNameInput = document.getElementById('onlinePlayerNameInput');
  const onlineSaveProfileBtn = document.getElementById('btnSaveOnlineProfile');
  const onlineProfileLabel = document.getElementById('onlineProfileLabel');
  const homeProfileName = document.getElementById('homeProfileName');
  const profileAvatar = document.getElementById('profileAvatar');
  const historyListEl = document.getElementById('homeHistoryList');
  const historyEmptyEl = document.getElementById('homeHistoryEmpty');
  const refreshHistoryBtn = document.getElementById('btnRefreshHistory');

  function setNetStatus(html) {
    if (statusEl) statusEl.innerHTML = html;
  }

  function escapeHtml(value) {
    return String(value || '').replace(/[&<>'"]/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[ch]));
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

  function normalizeName(value) {
    return String(value || '')
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 24);
  }

  function makeClientId() {
    const existing = localStorage.getItem(CLIENT_ID_KEY);
    if (existing && /^[A-Za-z0-9_-]{12,80}$/.test(existing)) return existing;

    let id = '';
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      id = window.crypto.randomUUID();
    } else {
      id = `kz_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 14)}`;
    }
    localStorage.setItem(CLIENT_ID_KEY, id);
    return id;
  }

  const CLIENT_ID = makeClientId();
  const savedName = normalizeName(localStorage.getItem(PLAYER_NAME_KEY) || '');
  if (nameInput && savedName) nameInput.value = savedName;
  if (onlineNameInput && savedName) onlineNameInput.value = savedName;

  function getPreferredNameValue() {
    const onlineValue = normalizeName(onlineNameInput?.value || '');
    const homeValue = normalizeName(nameInput?.value || '');
    if (window.KAZ_APP_UI?.mode === 'online' && onlineValue) return onlineValue;
    return homeValue || onlineValue;
  }

  function syncNameInputs(name) {
    if (nameInput) nameInput.value = name;
    if (onlineNameInput) onlineNameInput.value = name;
    if (onlineProfileLabel) onlineProfileLabel.textContent = name || 'Атыңызды енгізіңіз';
  }

  function getProfilePayload(showAlert = true) {
    if (!window.KAZ_AUTH?.isAuthenticated()) {
      if (showAlert) window.KAZ_AUTH?.openModal('login');
      return null;
    }
    let name = normalizeName(getPreferredNameValue());
    if (name.length < 2) name = normalizeName(window.KAZ_AUTH?.displayName?.() || '');
    if (name.length < 2) {
      if (showAlert) alert('Ойыншы атыңыз кемінде 2 таңбадан тұруы керек.');
      return null;
    }
    syncNameInputs(name);
    localStorage.setItem(PLAYER_NAME_KEY, name);
    return { clientId: CLIENT_ID, name };
  }

  function renderProfile(profile, message = '') {
    if (!profile) return;
    NET.profile = profile;
    if (profile.name) {
      syncNameInputs(profile.name);
      localStorage.setItem(PLAYER_NAME_KEY, profile.name);
      if (homeProfileName) homeProfileName.textContent = profile.name;
      if (profileAvatar) profileAvatar.textContent = profile.name.trim().charAt(0).toUpperCase() || '?';
    }
    if (profileRating) profileRating.textContent = String(profile.rating ?? 1000);
    if (profileGames) profileGames.textContent = String(profile.games ?? 0);
    if (profileWins) profileWins.textContent = String(profile.wins ?? 0);
    if (profileLosses) profileLosses.textContent = String(profile.losses ?? 0);
    if (profileDraws) profileDraws.textContent = String(profile.draws ?? 0);
    if (profileMessage) profileMessage.textContent = message || `✅ ${profile.name} профилі жүктелді.`;
  }

  function renderLoggedOut() {
    NET.profile = null;
    if (homeProfileName) homeProfileName.textContent = 'Қонақ ойыншы';
    if (profileAvatar) profileAvatar.textContent = '?';
    if (profileRating) profileRating.textContent = '—';
    if (profileGames) profileGames.textContent = '—';
    if (profileWins) profileWins.textContent = '—';
    if (profileLosses) profileLosses.textContent = '—';
    if (profileDraws) profileDraws.textContent = '—';
    if (profileMessage) profileMessage.textContent = '🔐 Онлайн статистика үшін аккаунтқа кіріңіз немесе тіркеліңіз.';
    renderMatchHistory([]);
  }

  function formatMatchDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('kk-KZ', {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function matchModeLabel(mode) {
    return mode === 'teams' ? '🤝 Командалық ойын' : '👤 Жеке ойын';
  }

  function renderMatchHistory(matches = []) {
    if (!historyListEl) return;
    const rows = Array.isArray(matches) ? matches : [];

    if (rows.length === 0) {
      historyListEl.innerHTML = '<div class="history-empty" id="homeHistoryEmpty">Әзірге сақталған онлайн ойындар жоқ.</div>';
      return;
    }

    historyListEl.innerHTML = rows.map(match => {
      const resultClass = match.result === 'win' ? 'win' : (match.result === 'loss' ? 'loss' : 'other');
      const resultText = match.result === 'win' ? 'ЖЕҢІС' : (match.result === 'loss' ? 'ЖЕҢІЛІС' : (match.result === 'draw' ? 'ТЕҢ' : (match.status === 'playing' ? 'ОЙЫНДА' : '—')));
      const participants = (match.participants || [])
        .map(p => `${LABELS[p.color] || p.color} ${escapeHtml(p.name || '')}`)
        .join(' · ');
      const winner = match.winner === 'draw' ? 'Тең ойын' : (match.winner ? `Жеңімпаз: ${escapeHtml(match.winner)}` : (match.status === 'abandoned' ? 'Ойын аяқталмады' : 'Ойын жалғасуда'));
      const code = match.roomCode ? `#${escapeHtml(match.roomCode)}` : `#${match.id}`;

      return `
        <div class="match-row">
          <div class="match-result ${resultClass}">${resultText}</div>
          <div class="match-main">
            <strong>${matchModeLabel(match.gameMode)} · ${code}</strong>
            <small>${participants || 'Ойыншылар туралы дерек жоқ'}</small>
          </div>
          <div class="match-meta">
            <b>${winner}</b>
            ${escapeHtml(formatMatchDate(match.finishedAt || match.startedAt))}
          </div>
        </div>`;
    }).join('');
  }

  function loadHomeData({ silent = true } = {}) {
    if (!window.KAZ_AUTH?.isAuthenticated()) {
      renderLoggedOut();
      return;
    }
    if (!socket?.connected) return;
    if (refreshHistoryBtn) refreshHistoryBtn.disabled = true;

    socket.emit('home-data', { clientId: CLIENT_ID }, response => {
      if (refreshHistoryBtn) refreshHistoryBtn.disabled = false;
      if (response?.ok) {
        if (response.profile) renderProfile(response.profile, silent ? '' : '✅ Профиль мен ойындар тарихы жаңартылды.');
        renderMatchHistory(response.matches || []);
      } else if (!silent && profileMessage) {
        profileMessage.textContent = `❌ ${response?.message || 'Деректерді жүктеу мүмкін болмады.'}`;
      }
    });
  }

  function readGameMode() {
    const mode = document.getElementById('gameMode')?.value;
    return mode === 'teams' ? 'teams' : 'ffa';
  }

  function readTimeControl() {
    const sec = Number(document.getElementById('timeControl')?.value || 600);
    return [180, 300, 600, 900].includes(sec) ? sec : 600;
  }

  function readPlayerTypes() {
    const result = {};
    for (const color of COLORS) {
      const el = document.getElementById(color + 'Type');
      result[color] = el ? el.value : 'human';
    }
    return result;
  }

  function applySettings(gameMode, playerTypes, timeControlSec = NET.timeControlSec) {
    const normalizedMode = gameMode === 'teams' ? 'teams' : 'ffa';
    NET.gameMode = normalizedMode;
    NET.timeControlSec = [180,300,600,900].includes(Number(timeControlSec)) ? Number(timeControlSec) : 600;

    const mode = document.getElementById('gameMode');
    if (mode) mode.value = normalizedMode;
    CURRENT_GAME_MODE = normalizedMode;
    if (typeof window.syncTimeControlButtons === 'function') window.syncTimeControlButtons(NET.timeControlSec);
    else {
      const time = document.getElementById('timeControl');
      if (time) time.value = String(NET.timeControlSec);
    }

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
    const time = document.getElementById('timeControl');
    if (time) time.disabled = true;
    document.querySelectorAll('.time-choice').forEach(btn => btn.disabled = true);
    const localStart = document.querySelector('.btn-start');
    const localLoad = document.getElementById('btnLoadGame');
    if (localStart) localStart.style.display = 'none';
    if (localLoad) localLoad.style.display = 'none';
    if (codeInput) codeInput.disabled = true;
    if (nameInput) nameInput.disabled = true;
    if (onlineNameInput) onlineNameInput.disabled = true;
    if (saveProfileBtn) saveProfileBtn.disabled = true;
    if (onlineSaveProfileBtn) onlineSaveProfileBtn.disabled = true;
    if (window.KAZ_APP_UI) window.KAZ_APP_UI.hideEntryNavigation();
  }

  function roomText(status) {
    if (!status) return '';
    return `Ойыншылар: ${status.connected}/${status.needed}`;
  }

  function rosterHtml() {
    if (!NET.lastStatus) return '';
    const occupied = new Set(NET.lastStatus.occupiedColors || []);
    const types = NET.lastStatus.playerTypes || {};
    const names = NET.playerNames || {};
    return COLORS.map(color => {
      if (types[color] === 'human' && !occupied.has(color)) {
        return `${LABELS[color]}: ⏳ Күтуде`;
      }
      return `${LABELS[color]}: ${escapeHtml(names[color] || '—')}`;
    }).join(' &nbsp;•&nbsp; ');
  }

  function refreshButtons() {
    if (copyBtn) copyBtn.style.display = NET.active ? '' : 'none';
    if (leaveBtn) leaveBtn.style.display = NET.active ? '' : 'none';
    if (changeCodeBtn) changeCodeBtn.style.display = NET.active && NET.isHost ? '' : 'none';
  }

  function refreshStatus(extra = '') {
    const code = NET.roomCode ? `<span class="network-code">${escapeHtml(NET.roomCode)}</span>` : '—';
    const me = NET.myColor ? LABELS[NET.myColor] : '—';
    const host = NET.isHost ? ' 👑 Сіз бөлме иесісіз.' : '';
    const wait = NET.lastStatus ? ` ${roomText(NET.lastStatus)}.` : '';
    const mode = MODE_LABELS[NET.gameMode] || MODE_LABELS.ffa;
    const timeCfg = {180:'⚡ Пуля · 3 минут',300:'🔥 Блиц · 5 минут',600:'⏱ Рапид · 10 минут',900:'⏱ Рапид · 15 минут'}[NET.timeControlSec] || '⏱ Рапид · 10 мин';
    const roster = rosterHtml();
    setNetStatus(
      `Бөлме: ${code} | Режим: ${mode} | Уақыт: ${timeCfg} | Сіз: ${me}.${host}${wait}` +
      `${roster ? `<br><span style="font-size:.92em">${roster}</span>` : ''}` +
      `${extra ? '<br>' + extra : ''}`
    );
    refreshButtons();
  }

  function refreshHudNames() {
    if (!NET.active) return;
    for (const color of COLORS) {
      const box = document.querySelector(`.player-box.${color}`);
      const title = box?.querySelector('div:first-child');
      const name = NET.playerNames?.[color];
      if (title && name) title.textContent = `${LABELS[color]} — ${name}`;
    }
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
    setNetStatus('❌ Socket.IO жүктелмеді. Ойынды Node.js сервері арқылы ашыңыз.');
    return;
  }

  const socket = io({ autoConnect: false, auth: { token: '' } });
  window.kazSocket = socket;

  function reconnectSocketForAuth() {
    const token = window.KAZ_AUTH?.getAccessToken?.() || '';
    socket.auth = { token };
    if (socket.connected) socket.disconnect();
    socket.connect();
  }

  async function startSocket() {
    try { await window.KAZ_AUTH?.ready; } catch (_) {}
    reconnectSocketForAuth();
  }


  function saveProfileToServer({ silent = false } = {}) {
    const payload = getProfilePayload(!silent);
    if (!payload) return;
    if (!socket.connected) {
      if (!silent && profileMessage) profileMessage.textContent = '⏳ Серверге қосылып жатырмыз...';
      reconnectSocketForAuth();
      setTimeout(() => saveProfileToServer({ silent }), 500);
      return;
    }
    if (saveProfileBtn) saveProfileBtn.disabled = true;
    if (onlineSaveProfileBtn) onlineSaveProfileBtn.disabled = true;
    if (!silent && profileMessage) profileMessage.textContent = '⏳ Профиль сақталып жатыр...';

    socket.emit('profile-save', payload, response => {
      if (saveProfileBtn && !NET.active) saveProfileBtn.disabled = false;
      if (onlineSaveProfileBtn && !NET.active) onlineSaveProfileBtn.disabled = false;
      if (response?.ok && response.profile) {
        renderProfile(response.profile, silent ? '' : '✅ Профиль сақталды.');
        loadHomeData({ silent: true });
      } else if (!silent && profileMessage) {
        profileMessage.textContent = `❌ ${response?.message || 'Профильді сақтау мүмкін болмады.'}`;
      }
    });
  }

  saveProfileBtn?.addEventListener('click', () => saveProfileToServer({ silent: false }));
  onlineSaveProfileBtn?.addEventListener('click', () => saveProfileToServer({ silent: false }));
  nameInput?.addEventListener('input', () => {
    const name = normalizeName(nameInput.value);
    if (onlineNameInput && document.activeElement !== onlineNameInput) onlineNameInput.value = name;
  });
  onlineNameInput?.addEventListener('input', () => {
    const name = normalizeName(onlineNameInput.value);
    if (nameInput && document.activeElement !== nameInput) nameInput.value = name;
    if (onlineProfileLabel) onlineProfileLabel.textContent = name || 'Атыңызды енгізіңіз';
  });
  nameInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveProfileToServer({ silent: false });
  });
  onlineNameInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveProfileToServer({ silent: false });
  });
  refreshHistoryBtn?.addEventListener('click', () => loadHomeData({ silent: false }));

  socket.on('connect', () => {
    if (!NET.active) {
      setNetStatus(window.KAZ_AUTH?.isAuthenticated()
        ? '✅ Серверге қосылдық. Режимді және ойыншыларды таңдаңыз.'
        : '🔐 Онлайн ойын үшін аккаунтқа кіріңіз немесе тіркеліңіз.');
    }
    if (window.KAZ_AUTH?.isAuthenticated()) {
      loadHomeData({ silent: true });
      const authName = normalizeName(window.KAZ_AUTH?.displayName?.() || '');
      if (authName.length >= 2) syncNameInputs(authName);
      saveProfileToServer({ silent: true });
    } else {
      renderLoggedOut();
    }
  });

  window.addEventListener('kaz-auth-changed', event => {
    const detail = event.detail || {};
    if (detail.user) {
      const name = normalizeName(detail.name || '');
      if (name.length >= 2) syncNameInputs(name);
    } else {
      if (NET.active) {
        alert('Аккаунттан шыққандықтан онлайн бөлмеден шығасыз.');
        socket.emit('leave-room', {}, () => location.href = location.origin);
      }
      renderLoggedOut();
    }
    reconnectSocketForAuth();
  });

  startSocket();

  socket.on('connect_error', () => {
    setNetStatus('❌ Сервермен байланыс жоқ. Бірнеше секундтан кейін бетті жаңартып көріңіз.');
  });

  createBtn?.addEventListener('click', () => {
    const profile = getProfilePayload(true);
    if (!profile) return;
    if (!socket.connected) { reconnectSocketForAuth(); alert('Серверге қосылып жатырмыз. 1–2 секундтан кейін қайта басыңыз.'); return; }

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

    const gameMode = readGameMode();
    const timeControlSec = readTimeControl();
    createBtn.disabled = true;
    joinBtn.disabled = true;
    setNetStatus('⏳ Бөлме құрылып жатыр...');
    socket.emit('create-room', { gameMode, timeControlSec, playerTypes, code: requestedCode || null, profile });
  });

  joinBtn?.addEventListener('click', () => {
    const profile = getProfilePayload(true);
    if (!profile) return;
    if (!socket.connected) { reconnectSocketForAuth(); alert('Серверге қосылып жатырмыз. 1–2 секундтан кейін қайта басыңыз.'); return; }

    const code = normalizeCode(codeInput?.value || '');
    if (!validCode(code)) {
      alert('4–12 таңбалы бөлме кодын енгізіңіз.');
      return;
    }
    createBtn.disabled = true;
    joinBtn.disabled = true;
    setNetStatus('⏳ Бөлмеге қосылып жатырмыз...');
    socket.emit('join-room', { code, profile });
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
    NET.gameMode = data.gameMode === 'teams' ? 'teams' : 'ffa';
    NET.timeControlSec = Number(data.timeControlSec || data.status?.timeControlSec || 600);
    NET.deadlineAt = Number(data.deadlineAt || data.status?.deadlineAt || 0) || null;
    NET.lastStatus = data.status || null;
    NET.playerNames = data.status?.playerNames || {};

    if (data.profile) renderProfile(data.profile);
    if (codeInput) codeInput.value = data.code;
    putRoomInUrl(data.code);
    if (window.KAZ_APP_UI) window.KAZ_APP_UI.showOnline();
    applySettings(NET.gameMode, data.playerTypes || {}, NET.timeControlSec);
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
    if (status?.gameMode) NET.gameMode = status.gameMode === 'teams' ? 'teams' : 'ffa';
    if (status?.timeControlSec) NET.timeControlSec = Number(status.timeControlSec);
    if (status?.deadlineAt) NET.deadlineAt = Number(status.deadlineAt);
    if (status?.playerNames) NET.playerNames = status.playerNames;
    refreshHudNames();
    if (NET.active) {
      if (status?.winner === 'draw') refreshStatus('🤝 Ойын тең аяқталды.');
      else if (status?.winner) refreshStatus(status?.endReason === 'time' ? '⏰ Уақыт аяқталды. Ұпай бойынша жеңімпаз анықталды.' : '🏆 Ойын аяқталды.');
      else refreshStatus(status.started ? '🎮 Ойын басталды.' : '⏳ Ойыншыларды күтеміз...');
    }
  });

  socket.on('room-error', message => {
    if (!NET.active) {
      createBtn.disabled = false;
      joinBtn.disabled = false;
    }
    setNetStatus(`❌ ${escapeHtml(message)}`);
  });

  socket.on('profile-updated', data => {
    if (!data?.profile) return;
    const delta = Number(data.ratingDelta || 0);
    let message = '✅ Ойын нәтижесі профильге сақталды.';
    if (delta > 0) message += ` Рейтинг +${delta}.`;
    if (delta < 0) message += ` Рейтинг ${delta}.`;
    if (delta === 0 && data.result === 'draw') message += ' Тең ойында рейтинг өзгермейді.';
    else if (delta === 0) message += ' Бір ғана адам қатысқан матчта рейтинг өзгермейді.';
    renderProfile(data.profile, message);
    loadHomeData({ silent: true });
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

  function ensureGameStarted(gameMode, playerTypes, playerNames, timeControlSec = 600, deadlineAt = null) {
    applySettings(gameMode, playerTypes || {}, timeControlSec);
    NET.timeControlSec = Number(timeControlSec || 600);
    NET.deadlineAt = Number(deadlineAt || 0) || null;
    if (playerNames) NET.playerNames = playerNames;
    if (!game) {
      startGame(false);
    }
    NET.started = true;
    if (window.KAZ_MATCH_TIMER && NET.deadlineAt) {
      window.KAZ_MATCH_TIMER.startOnline(NET.timeControlSec, NET.deadlineAt);
    }

    const setup = document.getElementById('setup');
    if (setup) setup.classList.add('hidden');

    refreshHudNames();
    refreshStatus(`🎮 ${MODE_LABELS[NET.gameMode]} басталды.`);
    setTimeout(maybeRunAi, 180);
  }

  socket.on('game-start', data => {
    ensureGameStarted(data.gameMode, data.playerTypes || {}, data.playerNames || null, data.timeControlSec || 600, data.deadlineAt || null);
    // Серверге бастапқы позицияны бірден жібереміз. Бұл уақыт біткенде 0 жүрісте де әділ есеп жасауға мүмкіндік береді.
    if (NET.isHost && game) setTimeout(() => game.saveToLocalStorage(), 80);
  });

  function applyRemoteState(payload) {
    if (!payload?.state || !game) return;

    NET.suppressSync = true;
    try {
      game.aiGeneration++;
      game._loadStateData(payload.state);
      game.winner = payload.winner || null;
      if (payload.endReason) game.endReason = payload.endReason;
      if (payload.timeResult) game.timeResult = payload.timeResult;
      if (game.winner) window.KAZ_MATCH_TIMER?.finish();
      game._findAllMandatoryCaptures();
      game.updateBoard();
      game.updateHud();
      game.renderHistory();
    } finally {
      NET.suppressSync = false;
    }
    refreshHudNames();
    setTimeout(maybeRunAi, 180);
  }

  socket.on('time-expired', data => {
    NET.deadlineAt = Number(data?.deadlineAt || NET.deadlineAt || 0) || NET.deadlineAt;
    if (!game || !data?.result) return;
    NET.suppressSync = true;
    try {
      game.finishByTime(data.result);
    } finally {
      NET.suppressSync = false;
    }
    refreshHudNames();
    refreshStatus(data.result?.winner === 'draw' ? '⏰ Уақыт аяқталды. Ұпайлар тең.' : '⏰ Уақыт аяқталды. Ұпай бойынша жеңімпаз анықталды.');
  });

  socket.on('game-state', applyRemoteState);

  socket.on('room-restart', data => {
    NET.timeControlSec = Number(data.timeControlSec || NET.timeControlSec || 600);
    NET.deadlineAt = Number(data.deadlineAt || 0) || null;
    applySettings(data.gameMode, data.playerTypes || {}, NET.timeControlSec);
    if (data.playerNames) NET.playerNames = data.playerNames;
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
    if (window.KAZ_MATCH_TIMER && NET.deadlineAt) window.KAZ_MATCH_TIMER.startOnline(NET.timeControlSec, NET.deadlineAt);
    refreshHudNames();
    refreshStatus('🔄 Ойын қайта басталды. Таймер жаңадан қосылды.');
    setTimeout(maybeRunAi, 180);
  });

  function maybeRunAi() {
    if (!NET.active || !NET.started || !NET.isHost || !game || game.winner || window.KAZ_MATCH_TIMER?.isExpired()) return;
    if (game.playerTypes[game.currentPlayer] !== 'human') {
      setTimeout(() => game.makeAiMove(), 120);
    }
  }

  const originalHandleClick = KazdoibaGame.prototype.handleClick;
  KazdoibaGame.prototype.handleClick = function(r, c) {
    if (NET.active && NET.started && (NET.myColor !== this.currentPlayer || window.KAZ_MATCH_TIMER?.isExpired())) return;
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
        winner: this.winner || null,
        endReason: this.endReason || null,
        timeResult: this.timeResult || null
      });
    }
  };

  const originalUpdateHud = KazdoibaGame.prototype.updateHud;
  KazdoibaGame.prototype.updateHud = function() {
    originalUpdateHud.call(this);
    if (!NET.active) return;

    refreshHudNames();

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
