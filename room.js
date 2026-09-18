(() => {
 'use strict';
 const I=window.KAZ_I18N,t=(key,vars)=>I.t('room.'+key,vars),$=id=>document.getElementById(id),socket=window.kazSocket;
 const COLORS=['blue','black','red','white'],paint={blue:'#648cff',black:'#777b85',red:'#ef6174',white:'#e7e9df'};
 const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let opened=false,selected=null,busy=false,focusBefore,errorCode=null;
 const status=()=>window.KAZ_NET?.lastStatus;
 const organizer=()=>Boolean(status()?.members?.some(m=>m.id===socket.id&&m.organizer));
 const label=p=>p?.name||t('guest')+' '+(p?.id||'').slice(-4);
 function notice(code){errorCode=code;$('roomNotice').hidden=!code;$('roomNotice').textContent=code?t(code==='moveDone'?'moveDone':'error.'+code):'';}
 function startProblem(s){
  if(s.started)return 'locked';
  if(s.tournament){
   const people=(s.members||[]).filter(m=>m.color),ids=people.map(p=>p.userId);
   if(people.length!==2||!s.tournament.pair?.every(id=>ids.includes(id)))return 'error.missing_players';
   if(people.filter(p=>['blue','black'].includes(p.color)).length!==1)return 'oppositeTeams';
  }
  if(s.connected!==s.needed||!s.needed)return 'error.missing_players';
  return '';
 }
 function render(){
  const s=status(),net=window.KAZ_NET;
  document.querySelectorAll('.toolbar-links [data-room-open]').forEach(b=>b.hidden=!net?.active);
  $('roomLobby').hidden=!net?.active||Boolean(s?.started);
  if(!s)return;
  const own=organizer(),people=s.members||[],problem=startProblem(s),active=people.find(p=>p.id===selected),readOnly=s.started||!own;
  $('roomLobbyHint').textContent=t(s.started?'locked':'waiting');
  $('roomHint').textContent=t(s.started?'locked':own?'pick':'readOnly');
  $('roomSubtitle').textContent=s.code+' · '+I.t('arena.viewers',{count:s.spectators||0});
  $('roomStartHint').textContent=t(problem||'waiting');
  const cards=COLORS.map(color=>{
   const p=people.find(m=>m.color===color),isAi=s.playerTypes[color]!=='human',name=p?label(p):isAi?t('ai'):t('empty');
   return `<button type="button" class="room-seat" style="--seat-color:${paint[color]}" ${p?`data-room-member="${h(p.id)}"`:'disabled'}>${window.KAZ_AVATARS.html(p?.avatar||{type:'icon',value:isAi?'knight':'pawn'})}<strong>${h(t(color))}</strong><span class="room-seat-name">${h(name)}</span><small>${p?.organizer?h(t('organizer')):p?.id===socket.id?h(t('you')):'—'}</small></button>`;
  });
  $('roomSeats').innerHTML=cards.join('');
  $('roomLobbyPreview').innerHTML=people.filter(p=>p.color).map(p=>`<button type="button" data-room-open="${h(p.id)}">${window.KAZ_AVATARS.html(p.avatar,'small')}<span><span class="room-color-dot" style="--seat-color:${paint[p.color]}"></span> ${h(label(p))}</span></button>`).join('');
  $('roomSpectators').innerHTML=people.filter(p=>!p.color).map(p=>`<button type="button" class="room-member" data-room-member="${h(p.id)}">${window.KAZ_AVATARS.html(p.avatar)}<span><strong>${h(label(p))}</strong><small>${h(p.organizer?t('organizer'):p.id===socket.id?t('you'):I.t('arena.spectator'))}</small></span></button>`).join('')||`<p class="room-hint">${h(t('emptySpectators'))}</p>`;
  $('roomEditor').hidden=!active;
  if(active){
   const focused=document.activeElement?.dataset.roomSeat;
   $('roomEditor').innerHTML=`<header>${window.KAZ_AVATARS.html(active.avatar)}<h3>${h(t('assign',{name:label(active)}))}</h3></header>${readOnly?`<p class="room-hint">${h(t(s.started?'locked':'readOnly'))}</p>`:''}<div class="room-place-buttons">${[...COLORS,'spectator'].map(color=>`<button type="button" data-room-seat="${color}" style="--seat-color:${paint[color]||'var(--social-accent)'}" aria-pressed="${(active.color||'spectator')===color}" ${readOnly||busy?'disabled':''}>${h(t(color))}</button>`).join('')}</div>${active.userId&&active.userId===window.KAZ_AUTH?.user?.id?`<div class="avatar-actions"><button type="button" data-avatar-edit>${h(t('avatarEdit'))}</button></div>`:''}`;
   if(opened&&focused)$('roomEditor').querySelector(`[data-room-seat="${focused}"]`)?.focus();
  }
  document.querySelectorAll('[data-room-start]').forEach(b=>{b.hidden=!own||s.started;b.disabled=busy||Boolean(problem);});
  if(errorCode)notice(errorCode);
 }
 function open(id){
  if(!window.KAZ_NET?.active)return;
  window.KAZ_ARENA?.close();window.KAZ_SOCIAL?.close();
  if(!opened)focusBefore=document.activeElement;
  selected=id||null;opened=true;$('roomOverlay').hidden=false;render();$('roomOverlay').querySelector('[data-room-close]').focus();
 }
 function close(){if(!opened)return;opened=false;$('roomOverlay').hidden=true;focusBefore?.focus?.();}
 function command(payload){return new Promise((resolve,reject)=>{
  if(!socket?.connected)return reject({code:'connection'});
  const timer=setTimeout(()=>reject({code:'connection'}),15000);
  socket.emit('room:command',payload,result=>{clearTimeout(timer);result?.ok?resolve(result.status):reject({code:result?.error||'server_error'});});
 });}
 document.addEventListener('click',async e=>{
  const opener=e.target.closest('[data-room-open]');if(opener){open(opener.dataset.roomOpen);return;}
  if(e.target.closest('[data-room-close]')){close();return;}
  const member=e.target.closest('[data-room-member]');if(member){selected=member.dataset.roomMember;notice(null);render();$('roomEditor').scrollIntoView({block:'nearest',behavior:'smooth'});return;}
  const seat=e.target.closest('[data-room-seat]'),start=e.target.closest('[data-room-start]');if((!seat&&!start)||busy)return;
  const s=status(),target=s?.members?.find(p=>p.id===selected);
  if(seat){
   if(!target)return;const displaced=s.members.find(p=>p.color===seat.dataset.roomSeat&&p.id!==target.id);
   if(displaced&&!confirm(t(target.color?'swapConfirm':'benchConfirm',{name:label(displaced)})))return;
  }
  busy=true;notice(null);render();
  try{await command(start?{action:'start'}:{action:'move',target:selected,seat:seat.dataset.roomSeat});if(start)close();else notice('moveDone');}
  catch(error){if(!opened)open();notice(error.code||'server_error');}
  finally{busy=false;render();}
 });
 $('roomOverlay').addEventListener('click',e=>{if(e.target===$('roomOverlay'))close();});
 document.addEventListener('keydown',e=>{
  if(!opened)return;if(e.key==='Escape'){close();return;}
  if(e.key==='Tab'){
   const list=[...$('roomOverlay').querySelectorAll('button')].filter(b=>!b.disabled&&b.getClientRects().length),first=list[0],last=list.at(-1);
   if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
  }
 });
 for(const event of ['room-created','room-joined','room-spectating','room-role','room-status','room-code-changed'])socket?.on(event,()=>render());
 socket?.on('game-start',()=>{close();render();});socket?.on('disconnect',()=>{if(opened)notice('connection');});
 window.addEventListener('kaz-language-changed',render);window.KAZ_ROOM={open,close};
})();
