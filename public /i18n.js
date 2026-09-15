(() => {
  'use strict';
  const supported = ['kk', 'ru', 'en'];
  const storageKey = 'kazdoiba_language';
  let language = 'kk';
  try {
    const saved = localStorage.getItem(storageKey);
    if (supported.includes(saved)) language = saved;
  } catch (_) { /* Language switching still works when storage is unavailable. */ }
  const bindings = new Map();
  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const t = (source, values = {}) => {
    const catalog = window.KAZ_TRANSLATIONS?.[language] || {};
    const translated = Object.prototype.hasOwnProperty.call(catalog, source) ? catalog[source] : source;
    return String(translated ?? '').replace(/\{(\w+)\}/g, (token, key) =>
      Object.prototype.hasOwnProperty.call(values, key) ? String(values[key] ?? '') : token);
  };
  function bind(element, render, property = 'textContent') {
    if (!element) return;
    element.removeAttribute(property === 'textContent' ? 'data-i18n' : `data-i18n-${property}`);
    let props = bindings.get(element);
    if (!props) bindings.set(element, props = new Map());
    props.set(property, render);
    element[property] = render();
  }
  function text(element, source, values) {
    bind(element, typeof source === 'function' ? source : () => t(source, values));
  }
  function raw(element, value) {
    if (!element) return;
    element.removeAttribute('data-i18n');
    bindings.get(element)?.delete('textContent');
    element.textContent = String(value ?? '');
  }
  function applyStatic(root = document) {
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.dataset.i18n); });
    for (const attr of ['placeholder', 'title', 'aria-label']) {
      root.querySelectorAll(`[data-i18n-${attr}]`).forEach(el => {
        el.setAttribute(attr, t(el.getAttribute(`data-i18n-${attr}`)));
      });
    }
  }
  function setLanguage(next, persist = true) {
    if (!supported.includes(next)) return false;
    language = next;
    document.documentElement.lang = language;
    if (persist) { try { localStorage.setItem(storageKey, language); } catch (_) {} }
    applyStatic();
    for (const [element, props] of bindings) {
      if (!element.isConnected) { bindings.delete(element); continue; }
      for (const [property, render] of props) element[property] = render();
    }
    document.querySelectorAll('[data-language-select]').forEach(select => { select.value = language; });
    window.dispatchEvent(new CustomEvent('kaz-language-changed', { detail: { language } }));
    return true;
  }
  const colours = {blue: 'Көк', black: 'Қара', red: 'Қызыл', white: 'Ақ'};
  const teams = {'blue-black': 'Көк + Қара', 'red-white': 'Қызыл + Ақ'};
  function gameLabel(value) { return t(colours[value] || teams[value] || value || ''); }
  // Only generated bot names are translated. Human names are always preserved.
  function playerName(value, type) {
    if (!type || type === 'human') return String(value || '');
    const match = String(value || '').match(/^(Көк|Қара|Қызыл|Ақ) ЖИ(?: \((Жеңіл|Орта|Қиын)\))?$/);
    if (!match) return String(value || '');
    return t(match[2] ? '{color} ЖИ ({level})' : '{color} ЖИ', {color: t(match[1]), level: t(match[2] || '')});
  }
  function error(value, fallback = 'Авторизация қатесі. Қайта көріңіз.') {
    const code = value && typeof value === 'object' ? value.code : '';
    const message = String(value?.message || value || '');
    const errors = {
      invalid_credentials: 'Email немесе құпиясөз дұрыс емес.',
      email_not_confirmed: 'Email расталмаған. Поштаңызды тексеріңіз.',
      user_already_exists: 'Бұл email бұрын тіркелген.',
      email_exists: 'Бұл email бұрын тіркелген.',
      over_request_rate_limit: 'Сұраулар тым көп. Кейінірек қайталаңыз.',
      over_email_send_rate_limit: 'Сұраулар тым көп. Кейінірек қайталаңыз.',
      weak_password: 'Құпиясөз қауіпсіздік талаптарына сәйкес емес.',
      same_password: 'Жаңа құпиясөз бұрынғысынан өзгеше болуы керек.',
      session_not_found: 'Сессия аяқталды. Аккаунтқа қайта кіріңіз.',
      refresh_token_not_found: 'Сессия аяқталды. Аккаунтқа қайта кіріңіз.'
    };
    const messages = {
      'Invalid login credentials': errors.invalid_credentials,
      'Email not confirmed': errors.email_not_confirmed,
      'User already registered': errors.user_already_exists
    };
    if (errors[code] || messages[message]) return t(errors[code] || messages[message]);
    if (message.startsWith('Аккаунт қатесі: ')) {
      return t('Аккаунт қатесі: {message}', {message: error(message.slice('Аккаунт қатесі: '.length), fallback)});
    }
    // Keep unknown service diagnostics visible rather than inventing an explanation.
    return message ? t(message) : t(fallback);
  }
  function historyText(value) {
    return String(value ?? '').replace(/Жою:\s*(\d+)/g, (_, count) => t('Жою: {count}', {count}));
  }
  window.KAZ_I18N = {
    t, text, raw, bind, applyStatic, setLanguage, normalize, gameLabel, playerName, error, historyText,
    html: (element, render) => bind(element, render, 'innerHTML'),
    get language() { return language; },
    get locale() { return {kk: 'kk-KZ', ru: 'ru-RU', en: 'en-GB'}[language]; }
  };
  document.documentElement.lang = language;
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-language-select]').forEach(select => {
      select.addEventListener('change', () => setLanguage(select.value));
    });
    setLanguage(language, false);
  });
})();
