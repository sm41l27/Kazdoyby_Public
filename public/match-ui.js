(() => {
 'use strict';
 const $=id=>document.getElementById(id),I=window.KAZ_I18N,t=(key,vars)=>I.t('play.'+key,vars),socket=window.kazSocket;
 let shown=null,tournament=null,busy=false,notice=null,focusBefore;
 const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function render(){
  const net=window.KAZ_NET,s=net?.lastStatus;
  document.querySelectorAll('#arenaGamebar [data-match-return]').forEach(b=>b.hidden=!net?.tournament||!s?.winner);
  if(!net?.active||!net.tournament){$('turnNotice').hidden=true;$('matchEndOverlay').hidden=true;shown=null;tournament=null;return;}
  const code=net.engineError||(!socket.connected?'connection':net.pendingMove?'sending':notice);
  $('turnNotice').hidden=!code;$('turnNoticeText').textContent=code?t(code):'';
  $('turnRetry').hidden=!net.engineError||(!net.isOrganizer&&net.spectator);$('turnRetry').disabled=busy||!socket.connected;
  if(!s?.winner)return;
  if(shown!==net.roomCode){
   shown=net.roomCode;tournament=null;focusBefore=document.activeElement;
   window.KAZ_ROOM?.close();window.KAZ_ARENA?.close();window.KAZ_SOCIAL?.close();window.KAZ_APP?.closeProfile();
   $('matchEndOverlay').hidden=false;loadTournament();$('matchEndOverlay').querySelector('button').focus();
  }
  const cancelled=s.endReason==='cancelled';
  $('matchEndTitle').textContent=t(cancelled?'cancelled':tournament?.status==='completed'?'tournamentFinished':'finished');
  const team=s.winner==='blue-black'||s.winner==='Көк + Қара'?['blue','black']:['red','white'];
  const color=team.find(c=>s.tournament.players[c]);
  const name=tournament?.status==='completed'?tournament.entries.find(p=>p.user_id===tournament.winner_id)?.name:s.playerNames?.[color];
  $('matchEndWinner').textContent=cancelled?'':s.winner==='draw'?t('draw'):t('win',{name:name||I.gameLabel(s.winner)});
  $('matchEndReason').textContent=s.endReason==='time'?t('time'):'';
  const scores=typeof game!=='undefined'?game?.timeResult?.entries:null;
  $('matchEndScore').innerHTML=s.endReason==='time'&&scores?`<table><thead><tr><th>${h(t('team'))}</th><th>${h(t('points'))}</th></tr></thead><tbody>${scores.map(e=>`<tr><td>${h(I.gameLabel(e.id||e.label))}</td><td>${Number(e.score)||0}</td></tr>`).join('')}</tbody></table>`:'';
  $('matchEndOverlay').querySelector('[data-match-return]').hidden=!window.KAZ_AUTH?.isAuthenticated();
 }
 function loadTournament(){
  const net=window.KAZ_NET;if(!net?.tournament||!net.lastStatus?.winner||!window.KAZ_AUTH?.isAuthenticated())return;
  const code=net.roomCode;socket.emit('tournament:request',{action:'get',payload:{id:net.tournament.id}},out=>{if(out?.ok&&KAZ_NET.roomCode===code){tournament=out.data;render();}});
 }
 async function back(home=false){
  if(busy)return;busy=true;const id=window.KAZ_NET?.tournament?.id;
  $('matchEndError').hidden=true;document.querySelectorAll('.match-end-actions button').forEach(b=>b.disabled=true);
  try{await KAZ_SOCIAL_GAME.leave();$('matchEndOverlay').hidden=true;KAZ_APP_UI.showHome();if(!home&&id)await KAZ_ARENA.open({id});}
  catch{ $('matchEndError').hidden=false;$('matchEndError').textContent=t('connection'); }
  finally{busy=false;document.querySelectorAll('.match-end-actions button').forEach(b=>b.disabled=false);}
 }
 document.addEventListener('click',event=>{
  if(event.target.closest('[data-match-return]'))back();
  if(event.target.closest('[data-match-home]'))back(true);
  if(event.target.closest('[data-match-board]')){$('matchEndOverlay').hidden=true;focusBefore?.focus?.();}
 });
 $('turnRetry').addEventListener('click',()=>{busy=true;render();socket.timeout(8000).emit('tournament:retry',{},(error,out)=>{busy=false;if(error||!out?.ok)notice='error';else {notice=null;window.KAZ_TURN_SYNC();}render();});});
 document.addEventListener('keydown',event=>{
  if($('matchEndOverlay').hidden)return;
  if(event.key==='Escape'){$('matchEndOverlay').hidden=true;return;}
  if(event.key==='Tab'){const list=[...$('matchEndOverlay').querySelectorAll('button')].filter(b=>!b.hidden&&!b.disabled);const first=list[0],last=list.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}}
 });
 socket.on('tournament:update',loadTournament);
 for(const event of ['room-status','game-start','game-state','time-expired','disconnect','connect'])socket.on(event,()=>setTimeout(render,0));
 window.addEventListener('kaz-game-state',()=>{notice=null;render();});
 window.addEventListener('kaz-room-left',()=>{notice=null;render();});
 window.addEventListener('kaz-turn-error',event=>{notice=['connection','stale','invalid_move','not_your_turn','busy','engine_paused'].includes(event.detail)?event.detail:'error';render();});
 window.addEventListener('kaz-language-changed',render);
})();
