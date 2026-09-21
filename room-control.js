'use strict';
module.exports=function({io,rooms,requireSocketUser,avatars,tournaments,roomStatus,emitStatus,maybeStart}){
 const COLORS=['blue','black','red','white'];
 const fail=code=>{throw Error('ROOM:'+code);};
 const live=(id,room)=>{const s=io.sockets.sockets.get(id);return s?.connected&&s.data.roomCode===room.code?s:null;};
 const sendRoles=room=>{
  for(const id of [...Object.values(room.slots).filter(Boolean),...room.spectators]){
   const member=live(id,room);if(!member)continue;
   const color=COLORS.find(c=>room.slots[c]===id)||null;
   member.data.color=color;member.data.spectator=!color;
   member.emit('room-role',{code:room.code,color,spectator:!color,isHost:room.hostSocketId===id,isOrganizer:member.data.authUserId===room.ownerId,gameMode:room.gameMode,timeControlSec:room.timeControlSec,playerTypes:room.playerTypes,status:roomStatus(room)});
  }
 };
 async function move(room,target,seat){
  if(room.started||room.winner)fail('started');
  if(![...COLORS,'spectator'].includes(seat)||!target)fail('invalid');
  const person=live(target,room);if(!person)fail('member_left');
  const profile=person.data.playerProfile;
  if(seat!=='spectator'&&!profile?.auth_user_id)fail('login_to_play');
  if(seat!=='spectator'&&room.tournament&&!room.tournament.pair.includes(profile.auth_user_id))fail('pair_only');
  if(seat!=='spectator'&&COLORS.some(c=>room.slots[c]!==target&&room.slots[c]&&room.profiles[c]?.auth_user_id===profile.auth_user_id))fail('duplicate_account');
  const source=COLORS.find(c=>room.slots[c]===target),slots={...room.slots},profiles={...room.profiles},types={...room.playerTypes},spectators=new Set(room.spectators);
  if(source===seat||(!source&&seat==='spectator'))return;
  if(seat==='spectator'){
   slots[source]=null;profiles[source]=null;spectators.add(target);if(room.tournament)types[source]='ai-'+(room.tournament.aiLevel||'medium');
  }else{
   const displaced=slots[seat],displacedProfile=profiles[seat],previousType=types[seat];
   if(source){slots[source]=displaced||null;profiles[source]=displaced?displacedProfile:null;types[source]=displaced?'human':previousType;}
   else if(displaced)spectators.add(displaced);
   else if(previousType!=='human'&&!room.tournament){const empty=COLORS.find(c=>types[c]==='human'&&!slots[c]);if(empty)types[empty]=previousType;}
   slots[seat]=target;profiles[seat]=profile;types[seat]='human';spectators.delete(target);
  }
  let seats=null;
  if(room.tournament){
   seats={...room.tournament.players};
   if(seat==='spectator'){if(source)delete seats[source];}
   else{
    const displacedId=seats[seat];
    for(const c of COLORS)if(seats[c]===profile.auth_user_id)delete seats[c];
    if(source&&displacedId&&displacedId!==profile.auth_user_id)seats[source]=displacedId;
    seats[seat]=profile.auth_user_id;
   }
   for(const c of COLORS)types[c]=seats[c]?'human':'ai-'+(room.tournament.aiLevel||'medium');
   await tournaments.setSeats(room.ownerId,room,seats);
  }
  if(rooms.get(room.code)!==room)fail('closed');
  for(const c of COLORS)if(slots[c]&&!live(slots[c],room))slots[c]=null;
  for(const id of spectators)if(!live(id,room))spectators.delete(id);
  Object.assign(room,{slots,profiles,playerTypes:types,spectators});
  if(room.tournament)room.tournament.players=seats;
  if(!Object.values(slots).includes(room.hostSocketId))room.hostSocketId=Object.values(slots).find(Boolean)||null;
  sendRoles(room);emitStatus(room);
 }
 function ready(room){
  if(room.started||room.winner)fail('started');
  const humans=COLORS.filter(c=>room.playerTypes[c]==='human');
  if(!humans.length||humans.some(c=>!live(room.slots[c],room)))fail('missing_players');
  if(room.tournament){
   const seats=room.tournament.players,ids=Object.values(seats);
   if(ids.length!==2||!room.tournament.pair.every(id=>ids.includes(id))||humans.filter(c=>['blue','black'].includes(c)).length!==1)fail('opposite_teams');
  }
 }
 io.on('connection',socket=>{
  socket.on('room:command',async(input,ack)=>{
   if(typeof ack!=='function')return;
   let room;
   try{
    const user=await requireSocketUser(socket);room=rooms.get(socket.data.roomCode);
    if(!room)fail('closed');if(room.ownerId!==user.id)fail('owner_only');
    if(room.editing)fail('busy');room.editing=true;
    try{
     if(input?.action==='move')await move(room,String(input.target||''),input.seat);
     else if(input?.action==='start'){
      ready(room);if(room.tournament)await tournaments.startSeats(user.id,room);
      try{if(rooms.get(room.code)!==room)fail('closed');ready(room);}
      catch(error){if(room.tournament)await tournaments.unlockSeats(user.id,room);throw error;}
      room.manualStart=false;maybeStart(room);
     }else fail('invalid');
     ack({ok:true,status:roomStatus(room)});
    }finally{room.editing=false;}
   }catch(error){ack({ok:false,error:String(error.message||'').match(/ROOM:([a-z_]+)/)?.[1]||'server_error'});}
  });
  socket.on('avatar:save',async(input,ack)=>{
   if(typeof ack!=='function')return;
   try{
    const user=await requireSocketUser(socket);
    const now=Date.now();if(now-(socket.data.avatarSavedAt||0)<1500)fail('rate_limit');socket.data.avatarSavedAt=now;
    const avatar=await avatars.save(user.id,input?.avatar,user.user_metadata?.display_name||user.user_metadata?.name||'Ойыншы');
    const changed=new Set();
    for(const member of io.sockets.sockets.values())if(member.data.authUserId===user.id||member.data.socialAuth?.user.id===user.id){
     if(member.data.playerProfile)member.data.playerProfile.avatar=avatar;
     member.emit('avatar:updated',{avatar});if(member.data.roomCode)changed.add(member.data.roomCode);
    }
    for(const code of changed){const room=rooms.get(code);if(room){for(const c of COLORS)if(room.profiles[c]?.auth_user_id===user.id)room.profiles[c].avatar=avatar;emitStatus(room);}}
    // Refresh this session; other room members already received the new public avatar in room-status.
    socket.emit('social:update');
    ack({ok:true,avatar});
   }catch(error){ack({ok:false,error:String(error.message||'').match(/ROOM:([a-z_]+)/)?.[1]||(/kaz_set_avatar/.test(String(error.message))?'setup_required':'server_error')});}
  });
 });
 return {sendRoles};
};
