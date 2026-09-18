(() => {
  'use strict';
  const I18N = window.KAZ_I18N;
  const t = I18N.t;

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
    isOrganizer: false,
    spectator: false,
    ratingMode: 'rated',
    tournament: null,
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
  const watchBtn = document.getElementById('btnWatchRoom');
  const watchLinkBtn = document.getElementById('btnCopyWatch');
  const resignBtn = document.getElementById('btnResignRoom');
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
    if (statusEl) I18N.html(statusEl, typeof html === 'function' ? html : () => escapeHtml(t(html)));
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
    if (onlineProfileLabel) {
      if (name) I18N.raw(onlineProfileLabel, name);
      else I18N.text(onlineProfileLabel, 'Атыңызды енгізіңіз');
    }
  }

  function getProfilePayload(showAlert = true) {
    if (!window.KAZ_AUTH?.isAuthenticated()) {
      if (showAlert) window.KAZ_AUTH?.openModal('login');
      return null;
    }
    let name = normalizeName(getPreferredNameValue());
    if (name.length < 2) name = normalizeName(window.KAZ_AUTH?.displayName?.() || '');
    if (name.length < 2) {
      if (showAlert) alert(t('Ойыншы атыңыз кемінде 2 таңбадан тұруы керек.'));
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
      if (homeProfileName) I18N.raw(homeProfileName, profile.name);
      if (profileAvatar) profileAvatar.innerHTML = window.KAZ_AVATARS.html(profile.avatar);
    }
    window.dispatchEvent(new CustomEvent('kaz-profile-updated',{detail:{profile}}));
    if (profileRating) profileRating.textContent = String(profile.rating ?? 1000);
    if (profileGames) profileGames.textContent = String(profile.games ?? 0);
    if (profileWins) profileWins.textContent = String(profile.wins ?? 0);
    if (profileLosses) profileLosses.textContent = String(profile.losses ?? 0);
    if (profileDraws) profileDraws.textContent = String(profile.draws ?? 0);
    if (profileMessage) I18N.text(profileMessage, () => typeof message === 'function' ? message() : (message ? t(message) : t('✅ {name} профилі жүктелді.', {name: profile.name}))); 
  }

  function renderLoggedOut() {
    NET.profile = null;
    if (homeProfileName) I18N.text(homeProfileName, 'Қонақ ойыншы');
    if (profileAvatar) profileAvatar.textContent = '?';
    if (profileRating) profileRating.textContent = '—';
    if (profileGames) profileGames.textContent = '—';
    if (profileWins) profileWins.textContent = '—';
    if (profileLosses) profileLosses.textContent = '—';
    if (profileDraws) profileDraws.textContent = '—';
    if (profileMessage) I18N.text(profileMessage, '🔐 Онлайн статистика үшін аккаунтқа кіріңіз немесе тіркеліңіз.');
    renderMatchHistory([]);
  }

  function formatMatchDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(I18N.locale, {
      day: '2-digit', month: '2-digit', year: '2-digit',
      hour: '2-digit', minute: '2-digit'
    });
  }

  function matchModeLabel(mode) {
    return t(mode === 'teams' ? '🤝 Командалық ойын' : '👤 Жеке ойын');
  }

  function renderMatchHistory(matches = []) {
    if (!historyListEl) return;
    const rows = Array.isArray(matches) ? matches : [];

    if (rows.length === 0) {
      I18N.html(historyListEl, () => `<div class="history-empty" id="homeHistoryEmpty">${t('Әзірге сақталған онлайн ойындар жоқ.')}</div>`);
      return;
    }

    I18N.html(historyListEl, () => rows.map(match => {
      const resultClass = match.result === 'win' ? 'win' : (match.result === 'loss' ? 'loss' : 'other');
      const resultText = t(match.result === 'win' ? 'ЖЕҢІС' : (match.result === 'loss' ? 'ЖЕҢІЛІС' : (match.result === 'draw' ? 'ТЕҢ' : (match.status === 'playing' ? 'ОЙЫНДА' : '—'))));
      const participants = (match.participants || [])
        .map(p => `${escapeHtml(t(LABELS[p.color] || p.color))} ${escapeHtml(I18N.playerName(p.name, p.playerType))}`)
        .join(' · ');
      const winner = match.winner === 'draw' ? t('Тең ойын') : (match.winner ? t('Жеңімпаз: {winner}', {winner: escapeHtml(I18N.gameLabel(match.winner))}) : t(match.status === 'abandoned' ? 'Ойын аяқталмады' : 'Ойын жалғасуда'));
      const code = match.roomCode ? `#${escapeHtml(match.roomCode)}` : `#${match.id}`;

      return `
        <div class="match-row">
          <div class="match-result ${resultClass}">${resultText}</div>
          <div class="match-main">
            <strong>${matchModeLabel(match.gameMode)} · ${code} · ${t('arena.'+(match.ratingMode || 'rated'))}</strong>
            <small>${participants || t('Ойыншылар туралы дерек жоқ')}</small>
          </div>
          <div class="match-meta">
            <b>${winner}</b>
            ${escapeHtml(formatMatchDate(match.finishedAt || match.startedAt))}
          </div>
        </div>`;
    }).join(''));
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
        I18N.text(profileMessage, () => `❌ ${I18N.error(response?.message, 'Деректерді жүктеу мүмкін болмады.')}`);
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
    document.getElementById('ratingMode').disabled = true;
    document.getElementById('allowSpectators').disabled = true;
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
    return t('Ойыншылар: {connected}/{needed}', {connected: status.connected, needed: status.needed});
  }

  function rosterHtml() {
    if (!NET.lastStatus) return '';
    const occupied = new Set(NET.lastStatus.occupiedColors || []);
    const types = NET.lastStatus.playerTypes || {};
    const names = NET.playerNames || {};
    return COLORS.map(color => {
      if (types[color] === 'human' && !occupied.has(color)) {
        return `${t(LABELS[color])}: ${t('⏳ Күтуде')}`;
      }
      return `${t(LABELS[color])}: ${escapeHtml(I18N.playerName(names[color] || '—', types[color]))}`;
    }).join(' &nbsp;•&nbsp; ');
  }

  function refreshButtons() {
    if (copyBtn) copyBtn.style.display = NET.active && !NET.spectator && !NET.tournament ? '' : 'none';
    if (watchBtn) watchBtn.disabled = NET.active;
    if (watchLinkBtn) watchLinkBtn.style.display = NET.active && NET.lastStatus?.allowSpectators !== false ? '' : 'none';
    if (resignBtn) resignBtn.style.display = NET.active && NET.started && NET.tournament && !NET.spectator && !NET.lastStatus?.winner ? '' : 'none';
    createBtn.disabled = NET.active; joinBtn.disabled = NET.active;
    if (leaveBtn) leaveBtn.style.display = NET.active ? '' : 'none';
    if (changeCodeBtn) changeCodeBtn.style.display = NET.active && NET.isOrganizer && !NET.tournament ? '' : 'none';
  }

  function refreshStatus(extra = '') {
    setNetStatus(() => {
      const code = NET.roomCode ? `<span class="network-code">${escapeHtml(NET.roomCode)}</span>` : '—';
      const me = NET.spectator ? t('arena.spectator') : NET.myColor ? t(LABELS[NET.myColor]) : '—';
      const host = NET.isOrganizer ? ' ' + t('👑 Сіз бөлме иесісіз.') : '';
      const wait = NET.lastStatus ? ` ${roomText(NET.lastStatus)}.` : '';
      const mode = t(MODE_LABELS[NET.gameMode] || MODE_LABELS.ffa);
      const cfg = TIME_CONTROLS[normalizeTimeControl(NET.timeControlSec)];
      const time = t('{mode} · {minutes} минут', {mode: t(cfg.label), minutes: cfg.minutes});
      const roster = rosterHtml();
      const message = typeof extra === 'function' ? extra() : t(extra);
      return t('Бөлме: {code} | Режим: {mode} | Уақыт: {time} | Сіз: {me}.', {code, mode, time, me}) + host + wait +
        `<br><span class="arena-room-badge">${escapeHtml(t('arena.'+NET.ratingMode))}</span> · ${escapeHtml(t('arena.viewers',{count:NET.lastStatus?.spectators || 0}))}` +
        (roster ? `<br><span style="font-size:.92em">${roster}</span>` : '') +
        (message ? '<br>' + escapeHtml(message) : '');
    });
    refreshButtons();
  }

  function refreshHudNames() {
    if (!NET.active) return;
    for (const color of COLORS) {
      const box = document.querySelector(`.player-box.${color}`);
      const title = box?.querySelector('div');
      const name = NET.playerNames?.[color];
      if (title && name) title.textContent = `${t(LABELS[color])} — ${I18N.playerName(name, NET.lastStatus?.playerTypes?.[color])}`;
      if(box){
        const member=NET.lastStatus?.members?.find(p=>p.color===color);
        let avatar=box.querySelector('.room-player-avatar');
        if(!avatar){avatar=document.createElement('button');avatar.type='button';avatar.className='room-player-avatar';box.prepend(avatar);}
        avatar.setAttribute('data-room-open',member?.id || '');avatar.setAttribute('aria-label',t('room.title')+': '+(name||color));
        avatar.innerHTML=window.KAZ_AVATARS.html(member?.avatar||{type:'icon',value:'knight'});
      }
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
    const watch = new URLSearchParams(location.search).get('watch');
    if (watch) codeInput.value = normalizeCode(watch);
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
      if (!silent && profileMessage) I18N.text(profileMessage, '⏳ Серверге қосылып жатырмыз...');
      reconnectSocketForAuth();
      setTimeout(() => saveProfileToServer({ silent }), 500);
      return;
    }
    if (saveProfileBtn) saveProfileBtn.disabled = true;
    if (onlineSaveProfileBtn) onlineSaveProfileBtn.disabled = true;
    if (!silent && profileMessage) I18N.text(profileMessage, '⏳ Профиль сақталып жатыр...');

    socket.emit('profile-save', payload, response => {
      if (saveProfileBtn && !NET.active) saveProfileBtn.disabled = false;
      if (onlineSaveProfileBtn && !NET.active) onlineSaveProfileBtn.disabled = false;
      if (response?.ok && response.profile) {
        renderProfile(response.profile, silent ? '' : '✅ Профиль сақталды.');
        loadHomeData({ silent: true });
      } else if (!silent && profileMessage) {
        I18N.text(profileMessage, () => `❌ ${I18N.error(response?.message, 'Профильді сақтау мүмкін болмады.')}`);
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
    if (onlineProfileLabel) {
      if (name) I18N.raw(onlineProfileLabel, name);
      else I18N.text(onlineProfileLabel, 'Атыңызды енгізіңіз');
    }
  });
  nameInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveProfileToServer({ silent: false });
  });
  onlineNameInput?.addEventListener('keydown', event => {
    if (event.key === 'Enter') saveProfileToServer({ silent: false });
  });
  refreshHistoryBtn?.addEventListener('click', () => loadHomeData({ silent: false }));

  socket.on('connect', () => {
    if (NET.active && NET.roomCode) {
      if (NET.spectator) socket.emit('watch-room',{code:NET.roomCode});
      else { const profile=getProfilePayload(false); if(profile)socket.emit('join-room',{code:NET.roomCode,profile}); }
    } else if (new URLSearchParams(location.search).get('watch')) {
      socket.emit('watch-room',{code:normalizeCode(new URLSearchParams(location.search).get('watch'))});
    }
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
        alert(t('Аккаунттан шыққандықтан онлайн бөлмеден шығасыз.'));
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
    if (!socket.connected) { reconnectSocketForAuth(); alert(t('Серверге қосылып жатырмыз. 1–2 секундтан кейін қайта басыңыз.')); return; }

    const playerTypes = readPlayerTypes();
    const humans = COLORS.filter(c => playerTypes[c] === 'human');
    if (humans.length === 0) {
      alert(t('Кемінде бір түске «Адам» таңдаңыз.'));
      return;
    }

    const requestedCode = normalizeCode(codeInput?.value || '');
    if (requestedCode && !validCode(requestedCode)) {
      alert(t('Өз кодыңызды қолдансаңыз, ол 4–12 таңбадан тұруы керек. Тек латын әріптері мен сандарды қолданыңыз. Кодты бос қалдырсаңыз, сервер өзі код береді.'));
      return;
    }

    const gameMode = readGameMode();
    const timeControlSec = readTimeControl();
    createBtn.disabled = true;
    joinBtn.disabled = true;
    setNetStatus('⏳ Бөлме құрылып жатыр...');
    socket.emit('create-room', { gameMode, timeControlSec, playerTypes, code: requestedCode || null, profile, ratingMode:document.getElementById('ratingMode').value, allowSpectators:document.getElementById('allowSpectators').checked });
  });

  joinBtn?.addEventListener('click', () => {
    const profile = getProfilePayload(true);
    if (!profile) return;
    if (!socket.connected) { reconnectSocketForAuth(); alert(t('Серверге қосылып жатырмыз. 1–2 секундтан кейін қайта басыңыз.')); return; }

    const code = normalizeCode(codeInput?.value || '');
    if (!validCode(code)) {
      alert(t('4–12 таңбалы бөлме кодын енгізіңіз.'));
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
      prompt(t('Сілтемені көшіріп алыңыз:'), inviteUrl());
    }
  });

  changeCodeBtn?.addEventListener('click', () => {
    if (!NET.active || !NET.isOrganizer) return;
    const entered = prompt(t('Жаңа бөлме кодын енгізіңіз (4–12 таңба, тек A–Z және 0–9):'), NET.roomCode || '');
    if (entered === null) return;
    const code = normalizeCode(entered);
    if (!validCode(code)) {
      alert(t('Код 4–12 таңбадан тұруы керек. Тек латын әріптері мен сандарды қолданыңыз.'));
      return;
    }
    socket.emit('change-room-code', { code });
  });

  leaveBtn?.addEventListener('click', () => {
    if (!NET.active) return;
    if (!confirm(t('Бөлмеден шығасыз ба?'))) return;
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
    NET.spectator = Boolean(data.spectator);
    NET.ratingMode = data.status?.ratingMode || 'rated';
    NET.tournament = data.status?.tournament || null;
    document.getElementById('ratingMode').value = NET.ratingMode === 'tournament' ? 'friendly' : NET.ratingMode;
    document.getElementById('allowSpectators').checked = data.status?.allowSpectators !== false;
    NET.isHost = !!data.isHost;
    NET.isOrganizer = Boolean(data.isOrganizer);
    NET.gameMode = data.gameMode === 'teams' ? 'teams' : 'ffa';
    NET.timeControlSec = Number(data.timeControlSec || data.status?.timeControlSec || 600);
    NET.deadlineAt = Number(data.deadlineAt || data.status?.deadlineAt || 0) || null;
    NET.lastStatus = data.status || null;
    NET.playerNames = data.status?.playerNames || {};

    if (data.profile) renderProfile(data.profile);
    if (codeInput) codeInput.value = data.code;
    putRoomInUrl(data.code);
    if (NET.spectator) {const url=new URL(location.href);url.searchParams.delete('room');url.searchParams.set('watch',data.code);history.replaceState(null,'',url);}
    if (window.KAZ_APP_UI) NET.spectator ? window.KAZ_APP_UI.showSpectator() : window.KAZ_APP_UI.showOnline();
    applySettings(NET.gameMode, data.playerTypes || {}, NET.timeControlSec);
    lockSetupForNetwork();
    refreshStatus('room.waiting');
  }

  socket.on('room-created', onJoined);
  socket.on('room-joined', onJoined);
  socket.on('room-spectating', onJoined);
  socket.on('room-role', onJoined);
  socket.on('avatar:updated', ({avatar}) => {if(NET.profile)renderProfile({...NET.profile,avatar});});
  socket.on('room-closed', () => { window.KAZ_MATCH_TIMER?.finish(); if(game)game.aiGeneration++; refreshStatus('arena.roomClosed'); });

  socket.on('room-code-changed', data => {
    if (!data?.code) return;
    NET.roomCode = data.code;
    if (codeInput) codeInput.value = data.code;
    putRoomInUrl(data.code);
    refreshStatus('✅ Бөлме коды өзгертілді. Ескі код енді жұмыс істемейді.');
  });

  socket.on('room-status', status => {
    NET.lastStatus = status;
    NET.isOrganizer = Boolean(status.members?.some(p=>p.id===socket.id&&p.organizer));
    NET.ratingMode = status.ratingMode || NET.ratingMode;
    NET.tournament = status.tournament || null;
    if(status.winner && game && !game.winner) {game.winner=status.winner;game.endReason=status.endReason;window.KAZ_MATCH_TIMER?.finish();game.updateHud();}
    if (status?.gameMode) NET.gameMode = status.gameMode === 'teams' ? 'teams' : 'ffa';
    if (status?.timeControlSec) NET.timeControlSec = Number(status.timeControlSec);
    if (status?.deadlineAt) NET.deadlineAt = Number(status.deadlineAt);
    if (status?.playerNames) NET.playerNames = status.playerNames;
    refreshHudNames();
    if (NET.active) {
      if (status?.winner === 'draw') refreshStatus('🤝 Ойын тең аяқталды.');
      else if (status?.winner) refreshStatus(status?.endReason === 'time' ? '⏰ Уақыт аяқталды. Ұпай бойынша жеңімпаз анықталды.' : '🏆 Ойын аяқталды.');
      else refreshStatus(status.started ? '🎮 Ойын басталды.' : 'room.waiting');
    }
  });

  socket.on('room-error', message => {
    if (!NET.active) {
      createBtn.disabled = false;
      joinBtn.disabled = false;
    }
    setNetStatus(() => `❌ ${escapeHtml(I18N.error(message))}`);
  });

  socket.on('profile-updated', data => {
    if (!data?.profile) return;
    const delta = Number(data.ratingDelta || 0);
    const message = () => {
      let text = t('✅ Ойын нәтижесі профильге сақталды.');
      if (delta !== 0) text += ' ' + t('Рейтинг {delta}.', {delta: delta > 0 ? `+${delta}` : delta});
      else if(data.ratingMode && data.ratingMode !== 'rated') text += ' ' + t('arena.noElo');
      else text += ' ' + t(data.result === 'draw' ? 'Тең ойында рейтинг өзгермейді.' : 'Бір ғана адам қатысқан матчта рейтинг өзгермейді.');
      return text;
    };
    renderProfile(data.profile, message);
    loadHomeData({ silent: true });
  });

  socket.on('host-changed', (data) => {
    NET.isHost = data?.isHost !== false;
    refreshStatus('👑 Енді сіз бөлме иесісіз және ЖИ жүрістерін сіздің браузеріңіз есептейді.');
    maybeRunAi();
  });

  socket.on('player-left', data => {
    if(NET.tournament) {refreshStatus('arena.playerDisconnected');return;}
    refreshStatus(() => t('⚠️ {player} бөлмеден шықты. Бос орынға басқа ойыншы қосыла алады.', {player: t(data?.color ? LABELS[data.color] : 'Ойыншы')}));
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
    refreshStatus(() => t('🎮 {mode} басталды.', {mode: t(MODE_LABELS[NET.gameMode])}));
    setTimeout(maybeRunAi, 180);
  }

  socket.on('game-start', data => {
    ensureGameStarted(data.gameMode, data.playerTypes || {}, data.playerNames || null, data.timeControlSec || 600, data.deadlineAt || null);
    // Серверге бастапқы позицияны бірден жібереміз. Бұл уақыт біткенде 0 жүрісте де әділ есеп жасауға мүмкіндік береді.
    if (game && (NET.myColor === 'blue' || (data.playerTypes?.blue !== 'human' && NET.isHost))) setTimeout(() => game.saveToLocalStorage(), 80);
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
    if (NET.spectator) return;
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
    if(!NET.spectator) originalSave.call(this);

    if (NET.active && NET.started && !NET.spectator && !NET.suppressSync) {
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

    const restart = document.querySelector('.controls [onclick="restartGame()"]');
    if (restart) restart.disabled = Boolean(NET.tournament) || !NET.isOrganizer;
    const undo = document.getElementById('btnUndo');
    if (undo) {
      undo.disabled = true;
      undo.title = t('Онлайн ойында ойыншылардың тақтасы әртүрлі болып кетпеуі үшін жүрісті болдырмау өшірілген.');
    }

    const hint = document.getElementById('btnHint');
    if (hint && NET.started) {
      hint.disabled = this.currentPlayer !== NET.myColor || this.playerTypes[this.currentPlayer] !== 'human';
    }
  };

  const originalRestartGame = window.restartGame || restartGame;
  window.restartGame = function() {
    if (!NET.active) return originalRestartGame();
    if (NET.tournament) {alert(t('arena.error.tournament_locked'));return;}
    if (!NET.isOrganizer) {
      alert(t('Онлайн ойынды тек бөлме иесі қайта бастай алады.'));
      return;
    }
    if (confirm(t('Онлайн ойынды барлық ойыншы үшін қайта бастаймыз ба?'))) {
      socket.emit('restart-room');
    }
  };

  window.addEventListener('kaz-language-changed', refreshHudNames);
  // Reuse the same create/join flow and all its account and room validation.
  function awaitRoom(event, trigger) {
    return new Promise((resolve, reject) => {
      if (!socket.connected) { reject({code:'connection'}); return; }
      const cleanup = () => { clearTimeout(timer); socket.off(event, success); socket.off('room-error', failure); };
      const success = data => { cleanup(); resolve(data); };
      const failure = () => { cleanup(); reject({code:'room_unavailable'}); };
      const timer = setTimeout(() => { cleanup(); reject({code:'connection'}); }, 15000);
      socket.once(event, success); socket.once('room-error', failure);
      trigger();
    });
  }
  window.KAZ_SOCIAL_GAME = {
    createRoom() {
      if (NET.active) return Promise.resolve({code:NET.roomCode});
      if (!window.KAZ_AUTH?.isAuthenticated()) return Promise.reject({code:'auth_required'});
      if (createBtn.disabled) return Promise.reject({code:'connection'});
      window.KAZ_APP_UI.showOnline();
      applySettings('teams', {blue:'human', black:'ai-medium', red:'human', white:'ai-medium'}, 600);
      if (codeInput) codeInput.value='';
      document.getElementById('ratingMode').value='friendly';
      return awaitRoom('room-created', () => createBtn.click());
    },
    watch(code) {
      if (NET.active) return NET.spectator && NET.roomCode===code ? Promise.resolve({code}) : Promise.reject({code:'leave_room'});
      return awaitRoom('room-spectating',()=>socket.emit('watch-room',{code}));
    },
    leave() {
      return new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>reject({code:'connection'}),10000);
        socket.emit('leave-room',{},()=>{
          clearTimeout(timeout); if(game)game.aiGeneration++;game=null;window.KAZ_MATCH_TIMER?.finish();
          Object.assign(NET,{active:false,started:false,myColor:null,isHost:false,isOrganizer:false,spectator:false,roomCode:null,lastStatus:null,tournament:null});
          document.querySelectorAll('#gameMode,#ratingMode,#allowSpectators,#timeControl,#setup select,#setup button,#playerNameInput,#onlinePlayerNameInput,#btnSaveProfile,#btnSaveOnlineProfile,#roomCodeInput').forEach(el=>el.disabled=false);
          document.getElementById('game').classList.remove('active');document.getElementById('setup').classList.remove('hidden');
          const url=new URL(location.href);url.searchParams.delete('room');url.searchParams.delete('watch');history.replaceState(null,'',url);
          document.getElementById('timeResultModal')?.classList.remove('open');
          document.getElementById('timeResultModal')?.setAttribute('aria-hidden','true');
          refreshButtons();resolve();
        });
      });
    },
    join(code) {
      if (NET.active) return NET.roomCode===code ? Promise.resolve({code}) : Promise.reject({code:'leave_room'});
      if (!window.KAZ_AUTH?.isAuthenticated()) return Promise.reject({code:'auth_required'});
      if (joinBtn.disabled) return Promise.reject({code:'connection'});
      window.KAZ_APP_UI.showOnline(); codeInput.value=code;
      return awaitRoom('room-joined', () => joinBtn.click());
    }
  };
  watchBtn?.addEventListener('click',()=>{
    const code=normalizeCode(codeInput.value);if(!validCode(code)){setNetStatus('arena.error.invalid');return;}
    window.KAZ_SOCIAL_GAME.watch(code).catch(()=>setNetStatus('arena.error.room_unavailable'));
  });
  watchLinkBtn?.addEventListener('click',async()=>{
    const url=`${location.origin}/?watch=${encodeURIComponent(NET.roomCode)}`;
    try{await navigator.clipboard.writeText(url);refreshStatus('arena.copied');}catch{prompt(t('Сілтемені көшіріп алыңыз:'),url);}
  });
  resignBtn?.addEventListener('click',()=>{if(confirm(t('arena.resignConfirm')))socket.emit('resign-room');});
  window.kazSocket = socket;
})();
