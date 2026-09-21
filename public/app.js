(() => {
 'use strict';
 const $=id=>document.getElementById(id),I=window.KAZ_I18N;
 let profileFocus;
 function closeProfile(){if($('profileOverlay').hidden)return;$('profileOverlay').hidden=true;profileFocus?.focus?.();}
 function profile(){window.KAZ_ROOM?.close();window.KAZ_ARENA?.close();window.KAZ_SOCIAL?.close();profileFocus=document.activeElement;$('profileOverlay').hidden=false;$('profileOverlay').querySelector('button').focus();}
 async function home(){
  if(window.KAZ_NET?.active){
   if(!KAZ_NET.lastStatus?.winner&&!confirm(I.t('Онлайн бөлмеден шығып, басты бетке ораласыз ба?')))return;
   try{await KAZ_SOCIAL_GAME.leave();}catch{window.dispatchEvent(new CustomEvent('kaz-turn-error',{detail:'connection'}));return;}
  }
  closeProfile();window.KAZ_ROOM?.close();window.KAZ_ARENA?.close();window.KAZ_SOCIAL?.close();$('game').classList.remove('active');KAZ_APP_UI.showHome();window.scrollTo({top:0});
 }
 document.addEventListener('click',event=>{
  const button=event.target.closest('[data-app-section]');
  if(button){
   const page=button.dataset.appSection;
   if(page==='profile'){profile();return;}
   closeProfile();
   if(page==='home'){home();return;}
   if(KAZ_NET.active){KAZ_NET.started?KAZ_APP_UI.enterGameView():KAZ_APP_UI.showSpectator();return;}
   if(page==='online')KAZ_APP_UI.showOnline();else if(page==='offline')KAZ_APP_UI.showOffline();else KAZ_APP_UI.openPlayModal();
  }
  if(event.target.closest('[data-profile-close]')||event.target===$('profileOverlay'))closeProfile();
  if(event.target.closest('[data-open-panel],[data-arena-open],[data-avatar-edit]'))closeProfile();
 });
 document.addEventListener('keydown',event=>{
  if($('profileOverlay').hidden)return;
  if(event.key==='Escape')closeProfile();
  if(event.key==='Tab'){
   const buttons=[...$('profileOverlay').querySelectorAll('button,input')].filter(e=>!e.disabled&&e.getClientRects().length),first=buttons[0],last=buttons.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
   else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
 });
 const resize=()=>document.documentElement.style.setProperty('--header-height',$('languageSelect').closest('header').offsetHeight+'px');
 new ResizeObserver(resize).observe(document.querySelector('.app-header'));resize();
 window.kazSocket?.on('game-start',()=>{const status=$('status'),area=document.querySelector('.game-area');area.before(status);window.scrollTo({top:0});});
 window.KAZ_APP={home,profile,closeProfile};
})();
