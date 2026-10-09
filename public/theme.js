(() => {
  let theme='dark';
  try {const saved=localStorage.getItem('kazdoiba_theme');if(['dark','light'].includes(saved))theme=saved;}catch{}
  document.documentElement.dataset.theme=theme;
  window.KAZ_THEME={get value(){return theme;},set(value){
    if(!['dark','light'].includes(value))return;
    theme=value;document.documentElement.dataset.theme=value;
    try{localStorage.setItem('kazdoiba_theme',value);}catch{}
    document.querySelectorAll('[data-theme-choice]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.themeChoice===theme)));
  }};
})();
