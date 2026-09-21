'use strict';
// The browser only sends actions. The actor always comes from a verified access token.
module.exports = function registerSocial({ io, rooms, fetchAuthUser, supabaseRest, enabled, avatars }) {
  const limits = new Map();
  const actions = new Set(['init','dashboard','search','request','accept','remove','messages','send','read','invite','invitation','decline','joined']);
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const userRoom = id => `social:user:${id}`;
  const fail = code => { const e = new Error(code); e.socialCode = code; throw e; };
  const rpc = (actor, action, payload) => supabaseRest('rpc/kaz_social', {method:'POST', body:{p_actor:actor,p_action:action,p_payload:payload}});
  const checkRoom = (code, actor, joining = false) => {
    const room = rooms.get(String(code || ''));
    if (!room || room.winner) fail('room_unavailable');
    const member = Object.entries(room.profiles || {}).some(([color,p]) => room.slots[color] && p?.auth_user_id === actor);
    if (!joining && !member) fail('room_membership');
    const hasSeat = Object.entries(room.playerTypes).some(([c,type])=>type==='human'&&!room.slots[c]);
    if (!hasSeat && !(joining && member)) fail('room_full');
    return room;
  };
  const rate = (id, action) => {
    const now=Date.now();let r=limits.get(id);
    if (!r || now-r.start>60000) {r={start:now,reads:0,writes:0};limits.set(id,r);}
    const write=['request','accept','remove','send','invite','decline','joined'].includes(action);
    if (++r[write?'writes':'reads'] > (write?40:180)) fail('rate_limit');
    if(limits.size>2000)for(const [key,v] of limits)if(now-v.start>60000)limits.delete(key);
  };
  io.on('connection', socket => {
    socket.on('social:request', async (input, ack) => {
      if(typeof ack!=='function')return;
      try {
        if(!enabled)fail('unavailable');
        const action=input?.action,payload=input?.payload||{};
        if(!actions.has(action)||!payload||typeof payload!=='object'||Array.isArray(payload))fail('invalid');
        const token=String(socket.handshake?.auth?.token||'');
        if(!token)fail('auth_required');
        // Revalidate regularly instead of trusting a client-supplied user ID or stale session.
        if(!socket.data.socialAuth || socket.data.socialAuth.token!==token || Date.now()-socket.data.socialAuth.at>30000){
          const user=await fetchAuthUser(token);if(!user)fail('auth_required');
          socket.data.socialAuth={user,token,at:Date.now()};
        }
        const user=socket.data.socialAuth.user;rate(user.id,action);
        await socket.join(userRoom(user.id));
        if(['request','accept','remove','messages','send','read','invite'].includes(action)&&!uuid(payload.target))fail('invalid');
        if(['invitation','decline','joined'].includes(action)&&!uuid(payload.id))fail('invalid');
        if(action==='send' && (typeof payload.body!=='string'||!payload.body.trim()||payload.body.length>2000||!uuid(payload.nonce)))fail('invalid');
        if(['messages','read'].includes(action))for(const key of ['before','last'])if(payload[key]!=null&&(!/^\d{1,19}$/.test(String(payload[key]))||BigInt(payload[key])>9223372036854775807n))fail('invalid');
        if(action==='search')payload.query=String(payload.query||'').trim().slice(0,60);
        if(action==='init')payload.name=String(user.user_metadata?.display_name||user.user_metadata?.name||'Ойыншы').replace(/[<>]/g,'').trim().slice(0,24)||'Ойыншы';
        if(action==='invite'){const room=checkRoom(payload.code,user.id);if(room.tournament&&!room.tournament.pair.includes(payload.target))fail('tournament_only');}
        if(action==='invitation'){
          const invitation=await rpc(user.id,'invitation',payload);
          const room=checkRoom(invitation.code,user.id,true);
          if(!Object.entries(room.profiles||{}).some(([color,p])=>room.slots[color]&&p?.auth_user_id===invitation.sender))fail('room_unavailable');
          ack({ok:true,data:invitation});return;
        }
        if(action==='joined'){
          const invitation=await rpc(user.id,'invitation',payload);
          const room=rooms.get(invitation.code);
          if(!room||!Object.entries(room.profiles||{}).some(([color,p])=>room.slots[color]&&p?.auth_user_id===user.id))fail('room_membership');
        }
        const data=await rpc(user.id,action,payload);
        if(data?.error)fail(data.error);
        if(action==='init'&&avatars)await avatars.decorate([data]);
        if(action==='search'&&avatars)await avatars.decorate(data);
        if(action==='dashboard'){
          if(avatars)await avatars.decorate([data.profile,...data.friends,...data.recent].filter(Boolean));
          for(const friend of data.friends||[])friend.online=Boolean(io.sockets.adapter.rooms.get(userRoom(friend.id))?.size);
          for(const inv of data.invites||[])inv.ratingMode=rooms.get(inv.code)?.ratingMode||null;
        }
        ack({ok:true,data});
        if(['request','accept','remove','send','invite','decline','joined'].includes(action)){
          io.to(userRoom(user.id)).emit('social:update');
          const target=payload.target||data?.peer;
          if(uuid(target))io.to(userRoom(target)).emit('social:update');
        }
      } catch(error) {
        const match=String(error.message||'').match(/SOCIAL:([a-z_]+)/);
        const code=error.socialCode||match?.[1]||(/kaz_social|social_profiles/.test(String(error.message))?'setup_required':'server_error');
        if(!error.socialCode&&!match)console.error('Social request failed:',String(error.message).slice(0,400));
        ack({ok:false,error:code});
      }
    });
  });
};
