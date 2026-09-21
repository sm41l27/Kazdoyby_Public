'use strict';
// Clients cannot bind rooms or report tournament results; only trusted room callbacks do that.
module.exports = function ({io, rooms, fetchAuthUser, supabaseRest, enabled, createRoomRecord, makeRoomCode, avatars, closeTournamentRooms}) {
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const actions = new Set(['list','create','get','join','leave','start','cancel','enter','manage','delete','hide','configure']);
  const locks = new Map(), limits = new Map();
  const fail = code => { const error=new Error(code);error.arenaCode=code;throw error; };
  const rpc=(actor,action,payload)=>supabaseRest('rpc/kaz_tournament',{method:'POST',body:{p_actor:actor,p_action:action,p_payload:payload}});
  const roomRpc=(actor,match,action,payload={})=>supabaseRest('rpc/kaz_tournament_room',{method:'POST',body:{p_actor:actor,p_match:match,p_action:action,p_payload:payload}});
  const resultFor=(room,user,manage=false)=>({code:room.code,id:room.tournament.id,watch:manage||!Object.values(room.tournament.players).includes(user.id)});
  const notify=id=>io.to(`tournament:${id}`).emit('tournament:update',{id});
  async function enter(user, payload) {
    // Serialize room creation for both entrants clicking simultaneously.
    const previous=locks.get(payload.match)||Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const data=await roomRpc(user.id,payload.match,'inspect'),m=data.match,t=data.tournament;
      if(payload.manage&&t.owner_id!==user.id)fail('owner_only');
      const existing=m.room_code&&rooms.get(m.room_code);
      if(existing?.tournament?.match===m.id && !existing.winner)return resultFor(existing,user,payload.manage);
      if(existing?.winner){await complete(existing);if(!existing.tournamentSaved)fail('server_error');return enterRetry(user,payload);}
      return createMatch(user,m,t,payload.manage);
    });
    locks.set(payload.match,task);
    try{return await task;}finally{if(locks.get(payload.match)===task)locks.delete(payload.match);}
  }
  async function enterRetry(user,payload){const d=await roomRpc(user.id,payload.match,'inspect');return createMatch(user,d.match,d.tournament,payload.manage);}
  async function createMatch(user,m,t,manage=false){
    const code=makeRoomCode();
    const bound=await roomRpc(user.id,m.id,'bind',{room:code});
    const seats=bound.match.seats;
    const playerTypes=Object.fromEntries(['blue','black','red','white'].map(c=>[c,seats[c]?'human':'ai-'+(t.ai_level||'medium')]));
    const room=createRoomRecord({code,gameMode:'teams',timeControlSec:t.time_control,ratingMode:'tournament',allowSpectators:true,ownerId:t.owner_id,playerTypes,tournament:{id:t.id,match:m.id,pair:[m.player1,m.player2],players:seats,aiLevel:t.ai_level||'medium'}});
    rooms.set(code,room);notify(t.id);
    const expiry=setTimeout(()=>{if(rooms.get(code)===room&&!Object.values(room.slots).some(Boolean)&&!room.spectators.size)rooms.delete(code);},600000);expiry.unref?.();
    return resultFor(room,user,manage);
  }
  function complete(room){
    if(!enabled||!room?.tournament||!room.winner||room.tournamentSaved)return Promise.resolve();
    if(room.tournamentSaving)return room.tournamentSaving;
    const team=['Көк + Қара','blue-black'].includes(room.winner)?['blue','black']:['Қызыл + Ақ','red-white'].includes(room.winner)?['red','white']:[];
    const winner=room.winner==='draw'?null:team.map(c=>room.tournament.players[c]).find(Boolean);
    if(winner===undefined)return Promise.resolve();
    room.tournamentSaving=rpc(room.tournament.pair[0],'result',{match:room.tournament.match,room:room.code,winner}).then(()=>{room.tournamentSaved=true;notify(room.tournament.id);}).catch(error=>{
      console.error('Tournament result retry:',String(error.message).slice(0,300));
      const retry=setTimeout(()=>complete(room),10000);retry.unref?.();
    }).finally(()=>{room.tournamentSaving=null;});
    return room.tournamentSaving;
  }
  io.on('connection',socket=>{
    socket.on('tournament:request',async(input,ack)=>{
      if(typeof ack!=='function')return;
      try{
        if(!enabled)fail('setup_required');
        const action=input?.action,payload={...(input?.payload||{})};
        if(!actions.has(action))fail('invalid');
        const token=String(socket.handshake.auth?.token||'');
        if(!token)fail('auth_required');
        if(!socket.data.arenaAuth||socket.data.arenaAuth.token!==token||Date.now()-socket.data.arenaAuth.at>30000){
          const user=await fetchAuthUser(token);if(!user)fail('auth_required');socket.data.arenaAuth={user,token,at:Date.now()};
        }
        const user=socket.data.arenaAuth.user;
        let limit=limits.get(user.id);if(!limit||Date.now()-limit.at>60000){limit={at:Date.now(),count:0};limits.set(user.id,limit);}
        if(++limit.count>90)fail('rate_limit');
        if(limits.size>2000)for(const [id,l] of limits)if(Date.now()-l.at>60000)limits.delete(id);
        if(action==='create'){
          payload.name=String(payload.name||'').replace(/[<>]/g,'').trim().slice(0,60);
          if(payload.name.length<3||![2,4,8,16].includes(Number(payload.capacity))||![180,300,600,900].includes(Number(payload.time)))fail('invalid');
          if(!['easy','medium','hard'].includes(payload.aiLevel||'medium'))fail('invalid');
        } else if(['enter','manage'].includes(action)){if(!uuid(payload.match))fail('invalid');}
        else if(!['list'].includes(action)&&!uuid(payload.id)&&!/^[A-Z0-9]{8}$/.test(String(payload.code||'').toUpperCase()))fail('invalid');
        if(['create','join'].includes(action))payload.playerName=String(user.user_metadata?.display_name||user.user_metadata?.name||'Ойыншы').replace(/[<>]/g,'').slice(0,24);
        if(['enter','manage'].includes(action)&&socket.data.roomCode){
          const current=rooms.get(socket.data.roomCode);
          if(current?.tournament?.match===payload.match&&!current.winner){ack({ok:true,data:{code:current.code,id:current.tournament.id,watch:socket.data.spectator}});return;}
          fail('leave_room');
        }
        const data=['enter','manage'].includes(action)?await enter(user,{...payload,manage:action==='manage'}):await rpc(user.id,action,payload);
        if(['cancel','delete'].includes(action))closeTournamentRooms?.(data.id);
        if(data?.entries&&avatars)await avatars.decorate(data.entries,'user_id');
        if(data?.id&&uuid(data.id)){
          if(socket.data.watchedTournament)socket.leave(`tournament:${socket.data.watchedTournament}`);
          socket.data.watchedTournament=data.id;socket.join(`tournament:${data.id}`);
        }
        ack({ok:true,data});
        if(!['get','list','enter','manage'].includes(action))notify(data.id);
      }catch(error){
        const code=error.arenaCode||String(error.message||'').match(/(?:ARENA|ROOM):([a-z_]+)/)?.[1]||(/kaz_tournament/.test(String(error.message))?'setup_required':'server_error');
        if(!error.arenaCode&&!String(error.message).includes('ARENA:'))console.error('Tournament request:',String(error.message).slice(0,300));
        ack({ok:false,error:code});
      }
    });
  });
  return {complete,
    async authorizeJoin(actor,room){const data=await roomRpc(actor,room.tournament.match,'inspect');if(data.match.room_code!==room.code)fail('closed');},
    setSeats:(actor,room,seats)=>roomRpc(actor,room.tournament.match,'seats',{room:room.code,seats}),
    startSeats:(actor,room)=>roomRpc(actor,room.tournament.match,'start',{room:room.code,seats:room.tournament.players}),
    unlockSeats:(actor,room)=>roomRpc(actor,room.tournament.match,'unlock',{room:room.code})
  };
};
