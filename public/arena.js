(() => {
  'use strict';
  const I=window.KAZ_I18N,t=(key,vars)=>I.t('arena.'+key,vars),$=id=>document.getElementById(id),socket=window.kazSocket;
  const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const me=()=>window.KAZ_AUTH?.user?.id;
  const state={open:false,data:null,list:[],epoch:0,error:null,busy:false};
  let focusBefore,timer;
  const button=(action,label,id='',cls='')=>`<button type="button" class="${cls}" data-arena-action="${action}" data-id="${h(id)}">${h(t(label))}</button>`;
  function notice(error){
    state.error=error;$('arenaNotice').hidden=!error;
    if(!error){$('arenaNotice').textContent='';return;}
    const key=error.messageKey||'error.'+(error.code||'server_error'),message=t(key);
    const roomMessage=I.t('room.'+key);
    $('arenaNotice').textContent=message!=='arena.'+key?message:roomMessage!=='room.'+key?roomMessage:t('error.server_error');
  }
  function request(action,payload={}){return new Promise((resolve,reject)=>{
    if(!socket?.connected)return reject({code:'connection'});
    const timer=setTimeout(()=>reject({code:'connection'}),15000);
    socket.emit('tournament:request',{action,payload},result=>{clearTimeout(timer);result?.ok?resolve(result.data):reject({code:result?.error||'server_error'});});
  });}
  function render(){
    $('arenaGuest').hidden=Boolean(me());$('arenaMember').hidden=!me();
    $('arenaLobby').hidden=Boolean(state.data);$('arenaDetail').hidden=!state.data;
    if(!state.data){
      $('arenaList').innerHTML=state.list.length?state.list.map(x=>`<article class="arena-card"><span class="arena-pill">${h(t(x.status))}</span><h3>${h(x.name)}</h3><p>${Number(x.joined)}/${Number(x.capacity)} · ${h(t('minutes',{n:x.time_control/60}))} · ${h(x.code)}</p>${button('get','open',x.id)}</article>`).join(''):`<p class="social-empty">${h(t('empty'))}</p>`;
      return;
    }
    const d=state.data,owner=d.owner_id===me(),member=d.entries.some(p=>p.user_id===me()),names=new Map(d.entries.map(p=>[p.user_id,p.name]));
    const name=id=>names.get(id)||t('tbd');
    const person=id=>(id?window.KAZ_AVATARS.html(d.entries.find(e=>e.user_id===id)?.avatar,'small'):'')+h(name(id));
    const rounds=[...new Set(d.matches.map(m=>m.round))];
    $('arenaDetail').innerHTML=`${button('back','back')}<div class="arena-detail-header"><div><span class="arena-pill">${h(t(d.status))}</span><h3>${h(d.name)}</h3><p>${h(t('code'))}: <code>${h(d.code)}</code> · ${h(t('minutes',{n:d.time_control/60}))}</p></div>${button('share','share',d.code)}</div>
      ${d.winner_id?`<div class="arena-champion">🏆 ${h(t('champion',{name:name(d.winner_id)}))}</div>`:''}
      <p class="arena-format">${h(t('format'))}</p>
      ${d.status==='registration'?`<p>${h(t('startHelp',{count:d.entries.length,total:d.capacity}))}</p>`:''}
      <div class="arena-detail-actions">${d.status==='registration'?(!member&&d.entries.length<d.capacity?button('join','join',d.id,'social-primary'):member&&!owner?button('leave','leave',d.id):'')+(owner?`<button type="button" class="social-primary" data-arena-action="start" data-id="${h(d.id)}" ${d.entries.length!==d.capacity?'disabled':''}>${h(t('start'))}</button>`:''):''}${button('refresh','refresh')}${owner&&['registration','running'].includes(d.status)?button('cancel','cancel',d.id,'danger'):''}</div>
      <h4>${h(t('participants'))}</h4><div class="arena-participants">${d.entries.map(p=>`<div class="arena-participant">${window.KAZ_AVATARS.html(p.avatar,'small')}${h(p.name)}<span>${h(p.user_id===me()?t('you'):p.user_id===d.owner_id?t('host'):'')}</span></div>`).join('')}</div>
      ${rounds.length?`<h3>${h(t('bracket'))}</h3><div class="arena-bracket">${rounds.map((round,i)=>`<section class="arena-round"><h4>${h(i===rounds.length-1?t('final'):t('round',{n:round}))}</h4><div class="arena-round-matches">${d.matches.filter(m=>m.round===round).map(m=>`<article class="arena-pair">${[m.player1,m.player2].map(id=>`<div class="arena-player${id&&id===m.winner_id?' won':''}"><span>${person(id)}</span><small>${id&&id===m.winner_id?'✓':id===me()?h(t('you')):''}</small></div>`).join('')}<div class="arena-match-footer"><small>${h(t(m.status))}${m.attempts>1?' · '+h(t('replay',{n:m.attempts})):''}</small>${d.status==='running'&&['ready','playing'].includes(m.status)&&[m.player1,m.player2].includes(me())?button('enter','enter',m.id,'social-primary'):''}${d.status==='running'&&owner&&['ready','playing'].includes(m.status)?`<button type="button" data-arena-action="manage" data-id="${h(m.id)}">${h(I.t('room.manage'))}</button>`:''}${d.status==='running'&&m.room_code&&m.status==='playing'?button('watch','watch',m.room_code):''}</div></article>`).join('')}</div></section>`).join('')}</div>`:''}`;
  }
  async function refresh(){
    if(!me())return;
    const epoch=state.epoch,id=state.data?.id;
    const data=await request(id?'get':'list',id?{id}:{});
    if(epoch!==state.epoch||id!==state.data?.id)return;
    if(id)state.data=data;else state.list=data;
    render();notice(null);
  }
  async function get(query){const epoch=++state.epoch,data=await request('get',query);if(epoch!==state.epoch)return;state.pendingQuery=null;state.data=data;render();notice(null);}
  async function open(query){
    if(query)state.pendingQuery=query;window.KAZ_ROOM?.close();window.KAZ_SOCIAL?.close();focusBefore=document.activeElement;state.open=true;$('arenaOverlay').hidden=false;render();
    $('arenaOverlay').querySelector('[data-arena-action="close"]').focus();
    if(me())try{query?await get(query):await refresh();}catch(e){notice(e);}
  }
  function close(){state.open=false;$('arenaOverlay').hidden=true;focusBefore?.focus?.();}
  function gamebar(){
    const net=window.KAZ_NET;if(!net)return;
    const bar=$('arenaGamebar');bar.hidden=!net.active;
    if(!net.active)return;
    // Keep match tools in the active game, outside the setup stage.
    const game=document.getElementById('game');if(game&&bar.parentElement!==game.parentElement)game.before(bar);
    $('arenaGameLabel').textContent=t(net.spectator?'spectator':net.ratingMode)+' · '+net.roomCode+' · '+t('viewers',{count:net.lastStatus?.spectators||0});
    bar.querySelector('[data-arena-action="game-watch-link"]').hidden=net.lastStatus?.allowSpectators===false;
    bar.querySelector('[data-arena-action="game-resign"]').hidden=!net.tournament||net.spectator||!net.started||Boolean(net.lastStatus?.winner);
    bar.querySelector('[data-arena-action="game-tournament"]').hidden=!net.tournament;
  }
  async function copy(value){try{await navigator.clipboard.writeText(value);notice({messageKey:'copied'});}catch{prompt(t('share'),value);}}
  async function action(action,id){
    if(action==='close'){close();return;}
    if(action==='signin'){state.resumeLogin=true;close();window.KAZ_AUTH?.openModal('login');return;}
    if(action==='back'){state.epoch++;state.data=null;render();await refresh();return;}
    if(action==='get'){await get({id});return;}
    if(action==='refresh'){await refresh();return;}
    if(action==='share'){await copy(`${location.origin}/?tournament=${encodeURIComponent(id)}`);return;}
    if(action==='game-watch-link'){document.getElementById('btnCopyWatch').click();return;}
    if(action==='game-resign'){document.getElementById('btnResignRoom').click();return;}
    if(action==='game-tournament'){await open({id:window.KAZ_NET.tournament.id});return;}
    if(action==='enter'||action==='watch'||action==='manage'){
      if(action==='manage'&&window.KAZ_NET?.tournament?.match===id){close();window.KAZ_ROOM.open();return;}
      if(window.KAZ_NET?.active){
        if(window.KAZ_NET.spectator||window.KAZ_NET.lastStatus?.winner)await window.KAZ_SOCIAL_GAME.leave();
        else if(action==='enter'&&window.KAZ_NET.tournament?.match===id&&!window.KAZ_NET.spectator){close();return;}
        else if(action==='watch'&&window.KAZ_NET.roomCode===id){close();return;}
        else throw {code:'leave_room'};
      }
      if(action==='watch')await window.KAZ_SOCIAL_GAME.watch(id);
      else{const result=await request(action==='manage'?'manage':'enter',{match:id});await window.KAZ_SOCIAL_GAME[result.watch?'watch':'join'](result.code);}
      gamebar();close();if(action==='manage')window.KAZ_ROOM.open();return;
    }
    if(['join','leave','start','cancel'].includes(action)){
      if(['start','cancel'].includes(action)&&!confirm(t(action+'Confirm')))return;
      const epoch=state.epoch,data=await request(action,{id});if(epoch!==state.epoch)return;state.data=data;render();
    }
  }
  document.querySelectorAll('[data-arena-open]').forEach(b=>b.addEventListener('click',()=>open()));
  document.addEventListener('click',async e=>{
    const b=e.target.closest('[data-arena-action]');if(!b)return;
    if(b.dataset.arenaAction==='close'){close();return;}
    if(state.busy)return;state.busy=true;b.disabled=true;notice(null);
    try{await action(b.dataset.arenaAction,b.dataset.id);}catch(error){notice(error);}finally{state.busy=false;b.disabled=false;}
  });
  $('arenaCreateForm').addEventListener('submit',async e=>{
    e.preventDefault();if(state.busy)return;state.busy=true;
    const b=e.target.querySelector('button');b.disabled=true;const epoch=state.epoch;
    try{const data=await request('create',{name:$('arenaName').value,capacity:Number($('arenaCapacity').value),time:Number($('arenaTime').value)});if(epoch===state.epoch){state.data=data;$('arenaName').value='';render();notice(null);}}
    catch(error){notice(error);}finally{state.busy=false;b.disabled=false;}
  });
  $('arenaFindForm').addEventListener('submit',e=>{e.preventDefault();get({code:$('arenaCode').value.trim().toUpperCase()}).catch(notice);});
  $('arenaOverlay').addEventListener('click',e=>{if(e.target===$('arenaOverlay'))close();});
  document.addEventListener('keydown',e=>{
    if(!state.open)return;if(e.key==='Escape'){close();return;}
    if(e.key==='Tab'){
      const list=[...$('arenaOverlay').querySelectorAll('button,input,select,summary')].filter(x=>!x.disabled&&x.getClientRects().length),first=list[0],last=list.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  });
  socket?.on('tournament:update',()=>{if(state.open){clearTimeout(timer);timer=setTimeout(()=>refresh().catch(notice),200);}});
  for(const event of ['room-created','room-joined','room-spectating','room-role','room-status','game-start','room-code-changed','room-closed'])socket?.on(event,()=>setTimeout(gamebar,0));
  socket?.on('connect',()=>{if(state.open&&me())(state.pendingQuery?get(state.pendingQuery):refresh()).catch(notice);});
  window.addEventListener('kaz-auth-changed',()=>{state.epoch++;state.data=null;state.list=[];notice(null);render();if(me()&&(state.resumeLogin||state.open)){state.resumeLogin=false;state.open=true;$('arenaOverlay').hidden=false;if(socket.connected)(state.pendingQuery?get(state.pendingQuery):refresh()).catch(notice);}});
  window.addEventListener('kaz-language-changed',()=>{render();gamebar();if(state.error)notice(state.error);});
  setInterval(()=>{if(state.open&&me()&&document.visibilityState==='visible'&&!state.busy)refresh().catch(notice);},20000);
  window.KAZ_ARENA={open,close};
  const code=new URLSearchParams(location.search).get('tournament');
  if(code)Promise.resolve(window.KAZ_AUTH?.ready).then(()=>{if(socket.connected)open({code});else socket.once('connect',()=>open({code}));});
})();
