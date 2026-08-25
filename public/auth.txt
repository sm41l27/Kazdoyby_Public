(() => {
  'use strict';

  const cfg = window.KAZ_PUBLIC_CONFIG || {};
  const supabaseGlobal = window.supabase;
  const client = (supabaseGlobal && cfg.supabaseUrl && cfg.supabasePublishableKey)
    ? supabaseGlobal.createClient(cfg.supabaseUrl, cfg.supabasePublishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      })
    : null;

  let session = null;
  let recoveryMode = false;
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });

  const $ = id => document.getElementById(id);
  const modal = $('authModal');
  const title = $('authTitle');
  const subtitle = $('authSubtitle');
  const message = $('authMessage');
  const loginView = $('authLoginView');
  const registerView = $('authRegisterView');
  const recoveryView = $('authRecoveryView');
  const newPasswordView = $('authNewPasswordView');
  const accountView = $('authAccountView');
  const accountButton = $('btnAccount');
  const accountName = $('accountName');
  const accountEmail = $('accountEmail');
  const guestProfileButton = $('btnGuestProfileLogin');
  const manageAccountButton = $('btnManageAccount');

  function cleanName(value) {
    return String(value || '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  }

  function setMessage(text = '', type = '') {
    if (!message) return;
    message.textContent = text;
    message.className = `auth-message${type ? ' ' + type : ''}`;
  }

  function setView(name) {
    for (const [key, el] of Object.entries({ login: loginView, register: registerView, recovery: recoveryView, newPassword: newPasswordView, account: accountView })) {
      if (el) el.style.display = key === name ? '' : 'none';
    }
    setMessage('');
    const labels = {
      login: ['Аккаунтқа кіру', 'Онлайн ойындар мен статистика үшін аккаунтқа кіріңіз.'],
      register: ['Тіркелу', 'Жаңа Қаздойбы аккаунтын жасаңыз.'],
      recovery: ['Құпиясөзді қалпына келтіру', 'Email мекенжайыңызға қалпына келтіру сілтемесін жібереміз.'],
      newPassword: ['Жаңа құпиясөз', 'Аккаунтыңыз үшін жаңа құпиясөз орнатыңыз.'],
      account: ['Менің аккаунтым', 'Профиль, email және қауіпсіздік параметрлері.']
    };
    if (title) title.textContent = labels[name]?.[0] || 'Аккаунт';
    if (subtitle) subtitle.textContent = labels[name]?.[1] || '';
  }

  function openModal(view = null) {
    const target = view || (session ? 'account' : 'login');
    setView(target);
    modal?.classList.add('open');
    modal?.setAttribute('aria-hidden', 'false');
  }

  function closeModal() {
    modal?.classList.remove('open');
    modal?.setAttribute('aria-hidden', 'true');
  }

  function userDisplayName(user = session?.user) {
    const meta = user?.user_metadata || {};
    return cleanName(meta.display_name || meta.name || String(user?.email || '').split('@')[0] || 'Ойыншы');
  }

  function applyAuthUi() {
    const user = session?.user || null;
    const name = userDisplayName(user);
    if (user) {
      if (accountButton) {
        accountButton.textContent = `👤 ${name}`;
        accountButton.classList.add('signed-in');
      }
      if (accountName) accountName.textContent = name;
      if (accountEmail) accountEmail.textContent = user.email || '—';
      if (guestProfileButton) guestProfileButton.style.display = 'none';
      if (manageAccountButton) manageAccountButton.style.display = '';
    } else {
      if (accountButton) {
        accountButton.textContent = 'Кіру / Тіркелу';
        accountButton.classList.remove('signed-in');
      }
      if (accountName) accountName.textContent = '—';
      if (accountEmail) accountEmail.textContent = '—';
      if (guestProfileButton) guestProfileButton.style.display = '';
      if (manageAccountButton) manageAccountButton.style.display = 'none';
    }
  }

  function emitAuthChanged(event = 'SESSION') {
    applyAuthUi();
    window.dispatchEvent(new CustomEvent('kaz-auth-changed', {
      detail: { event, session, user: session?.user || null, name: userDisplayName() }
    }));
  }

  async function signIn() {
    if (!client) return setMessage('Supabase Auth бапталмаған.', 'error');
    const email = String($('loginEmail')?.value || '').trim();
    const password = String($('loginPassword')?.value || '');
    if (!email || !password) return setMessage('Email мен құпиясөзді енгізіңіз.', 'error');
    setMessage('⏳ Кіру орындалып жатыр...');
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) return setMessage(error.message || 'Кіру мүмкін болмады.', 'error');
    session = data.session;
    emitAuthChanged('SIGNED_IN');
    closeModal();
  }

  async function signUp() {
    if (!client) return setMessage('Supabase Auth бапталмаған.', 'error');
    const name = cleanName($('registerName')?.value || '');
    const email = String($('registerEmail')?.value || '').trim();
    const password = String($('registerPassword')?.value || '');
    const confirm = String($('registerPassword2')?.value || '');
    if (name.length < 2) return setMessage('Ойыншы аты кемінде 2 таңба болуы керек.', 'error');
    if (!email.includes('@')) return setMessage('Email дұрыс емес.', 'error');
    if (password.length < 8) return setMessage('Құпиясөз кемінде 8 таңба болуы керек.', 'error');
    if (password !== confirm) return setMessage('Құпиясөздер бірдей емес.', 'error');

    setMessage('⏳ Аккаунт жасалып жатыр...');
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: name },
        emailRedirectTo: location.origin
      }
    });
    if (error) return setMessage(error.message || 'Тіркелу мүмкін болмады.', 'error');

    if (data.session) {
      session = data.session;
      emitAuthChanged('SIGNED_IN');
      closeModal();
    } else {
      setMessage('✅ Тіркелу қабылданды. Email-ге келген растау сілтемесін ашыңыз, содан кейін аккаунтқа кіріңіз.', 'success');
    }
  }

  async function sendReset() {
    if (!client) return setMessage('Supabase Auth бапталмаған.', 'error');
    const email = String($('recoveryEmail')?.value || '').trim();
    if (!email.includes('@')) return setMessage('Email дұрыс емес.', 'error');
    setMessage('⏳ Хат жіберіліп жатыр...');
    const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    if (error) return setMessage(error.message || 'Хат жіберілмеді.', 'error');
    setMessage('✅ Егер бұл email тіркелген болса, құпиясөзді қалпына келтіру хаты жіберілді.', 'success');
  }

  async function setNewPassword() {
    if (!client) return setMessage('Supabase Auth бапталмаған.', 'error');
    const password = String($('newPassword')?.value || '');
    const confirm = String($('newPassword2')?.value || '');
    if (password.length < 8) return setMessage('Құпиясөз кемінде 8 таңба болуы керек.', 'error');
    if (password !== confirm) return setMessage('Құпиясөздер бірдей емес.', 'error');
    setMessage('⏳ Құпиясөз өзгертіліп жатыр...');
    const { error } = await client.auth.updateUser({ password });
    if (error) return setMessage(error.message || 'Құпиясөзді өзгерту мүмкін болмады.', 'error');
    recoveryMode = false;
    setMessage('✅ Құпиясөз өзгертілді.', 'success');
    setTimeout(() => setView('account'), 700);
  }

  async function updateAccountName() {
    if (!client || !session) return openModal('login');
    const name = cleanName($('accountDisplayName')?.value || '');
    if (name.length < 2) return setMessage('Аты кемінде 2 таңба болуы керек.', 'error');
    const { data, error } = await client.auth.updateUser({ data: { display_name: name } });
    if (error) return setMessage(error.message || 'Атты өзгерту мүмкін болмады.', 'error');
    if (data?.user && session) session = { ...session, user: data.user };
    emitAuthChanged('USER_UPDATED');
    setMessage('✅ Аккаунт аты жаңартылды.', 'success');
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
    session = null;
    emitAuthChanged('SIGNED_OUT');
    closeModal();
  }

  async function init() {
    if (!client) {
      applyAuthUi();
      readyResolve();
      return;
    }

    client.auth.onAuthStateChange((event, newSession) => {
      session = newSession;
      if (event === 'PASSWORD_RECOVERY') {
        recoveryMode = true;
        setTimeout(() => openModal('newPassword'), 0);
      }
      emitAuthChanged(event);
    });

    const { data } = await client.auth.getSession();
    session = data?.session || null;
    applyAuthUi();
    readyResolve();
    emitAuthChanged('INITIAL_SESSION');
    if (!session && new URLSearchParams(location.search).get('room')) {
      setTimeout(() => openModal('login'), 150);
    }
  }

  accountButton?.addEventListener('click', () => {
    if (session) {
      const input = $('accountDisplayName');
      if (input) input.value = userDisplayName();
      openModal('account');
    } else openModal('login');
  });
  guestProfileButton?.addEventListener('click', () => openModal('login'));
  manageAccountButton?.addEventListener('click', () => { const input = $('accountDisplayName'); if (input) input.value = userDisplayName(); openModal('account'); });
  $('btnAuthClose')?.addEventListener('click', closeModal);
  $('btnShowRegister')?.addEventListener('click', () => setView('register'));
  $('btnShowLogin')?.addEventListener('click', () => setView('login'));
  $('btnForgotPassword')?.addEventListener('click', () => setView('recovery'));
  $('btnRecoveryBack')?.addEventListener('click', () => setView('login'));
  $('btnDoLogin')?.addEventListener('click', signIn);
  $('btnDoRegister')?.addEventListener('click', signUp);
  $('btnSendRecovery')?.addEventListener('click', sendReset);
  $('btnSetNewPassword')?.addEventListener('click', setNewPassword);
  $('btnUpdateAccountName')?.addEventListener('click', updateAccountName);
  $('btnChangePassword')?.addEventListener('click', () => setView('newPassword'));
  $('btnLogout')?.addEventListener('click', signOut);

  modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal?.classList.contains('open') && !recoveryMode) closeModal(); });

  window.KAZ_AUTH = {
    ready,
    client,
    get session() { return session; },
    get user() { return session?.user || null; },
    getAccessToken: () => session?.access_token || '',
    isAuthenticated: () => Boolean(session?.user && session?.access_token),
    displayName: () => userDisplayName(),
    openModal,
    closeModal,
    requireLogin() {
      if (session?.user) return true;
      openModal('login');
      return false;
    },
    signOut
  };

  init().catch(error => {
    console.error('Auth init:', error);
    readyResolve();
    applyAuthUi();
  });
})();
