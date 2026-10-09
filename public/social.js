(() => {
  'use strict';
  const I=window.KAZ_I18N,t=(key,vars)=>I.t('social.'+key,vars),$=id=>document.getElementById(id);
  const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const state={panel:null,tab:'friends',data:null,search:null,active:null,messages:[],older:false,drafts:new Map(),nonce:new Map(),epoch:0,chatEpoch:0,pendingInvite:null,loading:false};
  const socket=window.kazSocket;
  let lastFocus=null,toastTimer,refreshTimer,refreshPromise=null;
  const me=()=>window.KAZ_AUTH?.user?.id;
  const friend=id=>state.data?.friends?.find(p=>p.id===id);
  function toast(key){state.toast=key;$('socialToast').textContent=t(key);$('socialToast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{state.toast=null;$('socialToast').hidden=true;},4500);}
  function notice(error){state.notice=error;$('socialNotice').hidden=!error;$('socialNotice').textContent=error?t('error.'+(error.code||'server_error')):'';}
  function request(action,payload={}){
    return new Promise((resolve,reject)=>{
      if(!socket?.connected)return reject({code:'connection'});
      const timer=setTimeout(()=>reject({code:'connection'}),12000);
      socket.emit('social:request',{action,payload},response=>{clearTimeout(timer);response?.ok?resolve(response.data):reject({code:response?.error||'server_error'});});
    });
  }
  const button=(action,id,label,cls='')=>`<button type="button" class="${cls}" data-social-action="${action}" data-id="${h(id)}">${h(t(label))}</button>`;
  function person(p){
    const rel=friend(p.id),accepted=rel?.status==='accepted',incoming=rel?.status==='pending'&&rel.requester!==me();
    const actions=accepted?button('chat',p.id,'chat')+button('invite',p.id,'invite','social-primary')+button('remove',p.id,'remove','subtle'):
      incoming?button('accept',p.id,'accept','social-primary')+button('remove',p.id,'decline'):rel?`<small>${h(t('outgoing'))}</small>${button('remove',p.id,'cancel')}`:button('request',p.id,'add','social-primary');
    return `<article class="person-card${state.active===p.id?' selected':''}"><div class="person-top"><span class="person-avatar">${window.KAZ_AVATARS.html(p.avatar||rel?.avatar)}</span><div><strong>${h(p.name)}</strong><small>${accepted?`<span class="presence-dot${rel.online?' online':''}"></span>${h(t(rel.online?'online':'offline'))}`:h(p.friend_code||'')}${incoming?' · '+h(t('incoming')):''}</small></div>${Number(rel?.unread)>0?`<span class="unread-pill">${Number(rel.unread)}</span>`:''}</div><div class="person-actions">${actions}</div></article>`;
  }
  function render(){
    if(!state.data)return;
    $('myFriendCode').textContent=state.data.profile?.friend_code||'—';
    const accepted=state.data.friends.filter(f=>f.status==='accepted'),pending=state.data.friends.filter(f=>f.status==='pending');
    const total=accepted.reduce((n,p)=>n+Number(p.unread||0),0)+pending.filter(p=>p.requester!==me()).length+(state.data.invites?.length||0);
    document.querySelectorAll('.social-badge').forEach(b=>{b.hidden=!total;b.textContent=total>99?'99+':total;});
    document.querySelectorAll('[data-social-tab]').forEach(b=>b.setAttribute('aria-selected',String(b.dataset.socialTab===state.tab)));
    let people=state.tab==='requests'?pending:state.tab==='recent'?state.data.recent:state.tab==='search'?(state.search||[]):accepted;
    const empty=state.tab==='requests'?'emptyRequests':state.tab==='recent'?'emptyRecent':state.tab==='search'?'emptySearch':'emptyFriends';
    $('socialPeople').innerHTML=people.length?people.map(person).join(''):`<div class="social-empty"><p>${h(t(empty))}</p></div>`;
    $('socialInvites').innerHTML=state.data.invites?.length?`<h3>${h(t('invitations'))}</h3>`+state.data.invites.map(inv=>`<article class="invitation"><div><strong>${h(inv.name)}</strong><p>${h(t('room',{code:inv.code}))}</p><small>${inv.ratingMode?h(I.t('arena.'+inv.ratingMode))+' · ':''}${h(t('inviteNote'))}</small></div><div>${button('join',inv.id,'join','social-primary')}${button('decline',inv.id,'decline')}</div></article>`).join(''):'';
    const active=friend(state.active);
    if(state.active&&active?.status!=='accepted'){saveDraft();state.active=null;state.chatEpoch++;state.messages=[];}
    if(!state.active)$('friendsPanel').classList.remove('chat-mobile');
    $('chatWelcome').hidden=Boolean(state.active);$('chatActive').hidden=!state.active;
    if(state.active){let icon=$('chatActive').querySelector('.chat-header .chat-avatar');if(!icon){icon=document.createElement('span');icon.className='chat-avatar';$('chatName').parentElement.before(icon);}icon.innerHTML=window.KAZ_AVATARS.html(active.avatar);$('chatName').textContent=active.name;$('chatPresence').textContent=t(active.online?'online':'offline');}
  }
  async function refresh(){
    if(!me()||!socket?.connected)return;
    if(refreshPromise)return refreshPromise;
    const epoch=state.epoch;
    const work=(async()=>{
      const data=await request('dashboard');if(epoch!==state.epoch)return;
      state.data=data;render();
      if(state.active&&state.panel==='friends')await loadMessages(false);
    })();
    refreshPromise=work;
    try { return await work; } finally { if(refreshPromise===work)refreshPromise=null; }
  }
  function queueRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(()=>refresh().catch(e=>{if(state.panel==='friends')notice(e);}),200);}
  async function init(){
    const epoch=++state.epoch;refreshPromise=null;
    if(state.userId!==me()){state.chatEpoch++;state.data=null;state.active=null;state.messages=[];state.drafts.clear();state.nonce.clear();state.userId=me();$('chatMessages').replaceChildren();$('chatDraft').value='';$('socialPeople').replaceChildren();$('socialInvites').replaceChildren();}
    state.pendingInvite=null;
    document.querySelectorAll('.social-badge').forEach(b=>b.hidden=true);
    $('socialMember').hidden=true;$('socialGuest').hidden=Boolean(me());
    if(!me()||!socket?.connected)return;
    try{await request('init');if(epoch!==state.epoch)return;await refresh();if(epoch===state.epoch){$('socialMember').hidden=false;$('socialGuest').hidden=true;notice(null);}}
    catch(e){if(epoch===state.epoch)notice(e);}
  }
  function saveDraft(){if(state.active)state.drafts.set(state.active,$('chatDraft').value);}
  function renderMessages(){
    const area=$('chatMessages'),nearBottom=area.scrollHeight-area.scrollTop-area.clientHeight<90;
    area.innerHTML=state.messages.length?state.messages.map(m=>`<div class="message ${m.sender===me()?'mine':'theirs'}"><p>${h(m.body)}</p><time datetime="${h(m.created_at)}">${h(new Date(m.created_at).toLocaleString(I.locale,{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}))}</time></div>`).join(''):`<div class="social-empty">${h(t('firstMessage'))}</div>`;
    $('olderMessages').hidden=!state.older;
    if(nearBottom)area.scrollTop=area.scrollHeight;
  }
  async function loadMessages(older=false){
    const target=state.active,epoch=state.chatEpoch,sessionEpoch=state.epoch;if(!target)return;
    const area=$('chatMessages'),height=area.scrollHeight,scroll=area.scrollTop;
    const rows=await request('messages',{target,...(older&&state.messages.length?{before:state.messages[0].id}:{})});
    if(target!==state.active||epoch!==state.chatEpoch||sessionEpoch!==state.epoch)return;
    if(!older&&rows.length&&!rows.some(m=>state.messages.some(old=>old.id===m.id)))state.messages=[];
    const all=new Map([...state.messages,...rows].map(m=>[m.id,m]));
    state.messages=[...all.values()].sort((a,b)=>BigInt(a.id)<BigInt(b.id)?-1:1);
    if(older||state.messages.length<=50)state.older=rows.length===50;
    renderMessages();if(older)area.scrollTop=scroll+area.scrollHeight-height;
    if(document.visibilityState==='visible'&&state.panel==='friends'){
      const received=rows.filter(m=>m.recipient===me());
      if(received.length){await request('read',{target,last:received.at(-1).id});const f=friend(target);if(f)f.unread=0;render();}
    }
  }
  async function openChat(id){
    saveDraft();state.active=id;state.chatEpoch++;state.messages=[];state.older=false;
    $('chatDraft').value=state.drafts.get(id)||'';$('friendsPanel').classList.add('chat-mobile');render();
    $('chatMessages').textContent=t('loading');await loadMessages();$('chatMessages').scrollTop=$('chatMessages').scrollHeight;$('chatDraft').focus();
  }
  function updateTitle(){
    const key=state.panel==='friends'?'title':state.panel;
    $('socialTitle').textContent=key?t(key):'';
    $('socialSubtitle').textContent=state.panel==='friends'?t('subtitle'):state.panel==='support'?t('supportIntro'):'';
  }
  function open(panel){
    window.KAZ_ROOM?.close();window.KAZ_ARENA?.close();window.KAZ_APP?.closeProfile();lastFocus=document.activeElement;state.panel=panel;$('socialOverlay').hidden=false;
    document.querySelectorAll('#friendsPanel,#settingsPanel,#supportPanel').forEach(el=>el.hidden=el.id!==panel+'Panel');
    updateTitle();window.KAZ_THEME.set(window.KAZ_THEME.value);$('socialClose').focus();
    if(panel==='friends'){
      $('socialGuest').hidden=Boolean(me());$('socialMember').hidden=!me()||!state.data;
      if(me())(state.data?refresh():init()).catch(notice);
    }
  }
  function close(){saveDraft();state.panel=null;$('socialOverlay').hidden=true;lastFocus?.focus?.();}
  async function copy(value){try{await navigator.clipboard.writeText(value);toast('copied');}catch{window.prompt(t('copy'),value);}}
  async function invite(id){
    if(!window.KAZ_NET?.active){await window.KAZ_SOCIAL_GAME.createRoom();}
    await request('invite',{target:id,code:window.KAZ_NET.roomCode});toast('invited');close();
  }
  document.addEventListener('click',e=>{
    const openButton=e.target.closest('[data-open-panel]');if(openButton)open(openButton.dataset.openPanel);
    const themeButton=e.target.closest('[data-theme-choice]');if(themeButton)window.KAZ_THEME.set(themeButton.dataset.themeChoice);
    const phone=e.target.closest('[data-copy-phone]');if(phone)copy(phone.dataset.copyPhone);
  });
  $('socialClose').addEventListener('click',close);
  $('socialOverlay').addEventListener('click',e=>{if(e.target===$('socialOverlay'))close();});
  document.addEventListener('keydown',e=>{
    if($('socialOverlay').hidden)return;
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'){
      const controls=[...$('socialOverlay').querySelectorAll('button,input,textarea,select,a[href],[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
      const first=controls[0],last=controls.at(-1);
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}
    }
  });
  document.querySelectorAll('[data-social-tab]').forEach(b=>b.addEventListener('click',()=>{state.tab=b.dataset.socialTab;state.search=null;$('friendSearch').value='';render();}));
  $('friendSearchForm').addEventListener('submit',async e=>{
    e.preventDefault();const query=$('friendSearch').value.trim();if(query.length<2){toast('searchHint');return;}
    const epoch=state.epoch;
    try{const rows=await request('search',{query});if(epoch!==state.epoch||query!==$('friendSearch').value.trim())return;state.tab='search';state.search=rows;render();notice(null);}catch(e){notice(e);}
  });
  $('friendsPanel').addEventListener('click',async e=>{
    const b=e.target.closest('[data-social-action]');if(!b||b.disabled)return;
    const action=b.dataset.socialAction,id=b.dataset.id;b.disabled=true;notice(null);
    try{
      if(action==='login'){close();window.KAZ_AUTH?.openModal('login');}
      else if(action==='copy-code')await copy(state.data?.profile?.friend_code||'');
      else if(action==='refresh'){if(state.data)await refresh();else await init();}
      else if(action==='chat')await openChat(id);
      else if(action==='back'){saveDraft();$('friendsPanel').classList.remove('chat-mobile');}
      else if(action==='older')await loadMessages(true);
      else if(action==='invite'||action==='invite-active')await invite(id||state.active);
      else if(action==='join'){
        const inv=await request('invitation',{id});
        if(window.KAZ_NET?.active&&window.KAZ_NET.roomCode!==inv.code)throw{code:'leave_room'};
        state.pendingInvite={id,code:inv.code};await window.KAZ_SOCIAL_GAME.join(inv.code);if(state.pendingInvite){state.pendingInvite=null;await request('joined',{id});}close();
      }else if(action==='decline'){await request('decline',{id});await refresh();}
      else if(['request','accept','remove'].includes(action)){
        if(action==='remove'&&friend(id)?.status==='accepted'&&!confirm(t('removeConfirm')))return;
        await request(action,{target:id});await refresh();if(action==='request')toast('sent');
      }
    }catch(error){notice(error);}finally{b.disabled=false;}
  });
  $('chatDraft').addEventListener('input',saveDraft);
  $('chatDraft').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();$('messageForm').requestSubmit();}});
  $('messageForm').addEventListener('submit',async e=>{
    e.preventDefault();const target=state.active,body=$('chatDraft').value.trim();if(!target||!body||$('sendMessage').disabled)return;
    let pending=state.nonce.get(target);if(!pending||pending.body!==body){pending={body,nonce:crypto.randomUUID()};state.nonce.set(target,pending);}
    const epoch=state.epoch;$('sendMessage').disabled=true;notice(null);
    try{
      await request('send',{target,...pending});if(epoch!==state.epoch)return;
      state.nonce.delete(target);if(state.drafts.get(target)?.trim()===body)state.drafts.set(target,'');
      if(state.active===target){if($('chatDraft').value.trim()===body)$('chatDraft').value='';await loadMessages();$('chatMessages').scrollTop=$('chatMessages').scrollHeight;}
    }catch(error){notice(error);}finally{$('sendMessage').disabled=false;}
  });
  socket?.on('social:update',queueRefresh);
  socket?.on('connect',()=>init());
  socket?.on('disconnect',()=>{if(state.panel==='friends')notice({code:'connection'});});
  socket?.on('room-joined',data=>{
    if(state.pendingInvite?.code===data.code){const id=state.pendingInvite.id;state.pendingInvite=null;request('joined',{id}).then(queueRefresh).catch(notice);}
  });
  window.addEventListener('kaz-auth-changed',()=>{saveDraft();init();});
  window.addEventListener('kaz-language-changed',()=>{updateTitle();if(state.data)render();if(state.active)renderMessages();if(state.notice)notice(state.notice);if(state.toast)$('socialToast').textContent=t(state.toast);});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)queueRefresh();});
  setInterval(()=>{if(!document.hidden&&me())queueRefresh();},20000);
  window.KAZ_SOCIAL={open,close};
  window.KAZ_THEME.set(window.KAZ_THEME.value);
  if(socket?.connected)init();
})();
