'use strict';
const engine=require('./game-engine');
module.exports=function({io,rooms,requireSocketUser,emitStatus,persist,finishByTime,finishNormal,pauseTimer,resumeTimer}){
 const pool=require('./turn-pool')();
 const present=room=>rooms.get(room.code)===room&&room.started&&!room.winner;
 function snapshot(room){return {state:room.state,revision:room.revision||0,winner:room.winner,endReason:room.endReason,timeResult:room.timeResult,deadlineAt:room.deadlineAt,serverNow:Date.now(),authoritative:true,engineError:room.engineError||null};}
 function publish(room){io.to(room.code).emit('game-state',snapshot(room));emitStatus(room);}
 function initialize(room){room.revision=0;room.engineState=engine.initial(room.playerTypes,room.timeControlSec,room.deadlineAt);room.state=JSON.stringify(room.engineState);schedule(room);}
 function schedule(room){
  if(!present(room)||room.engineError||room.turnBusy||room.botTimer||room.playerTypes[room.expectedPlayer]==='human')return;
  room.botTimer=setTimeout(()=>{room.botTimer=null;advance(room,null,true).catch(()=>{});},200);room.botTimer.unref?.();
 }
 async function advance(room,move,bot=false){
  if(!present(room))throw Error('finished');if(room.engineError)throw Error('engine_paused');if(room.turnBusy)throw Error('busy');
  if(Date.now()>=room.deadlineAt){await finishByTime(room);throw Error('finished');}
  const revision=room.revision;room.turnBusy=true;
  try{
   let state;
   const level=bot?(room.tournament.aiLevel||'medium'):null;
   try{state=await pool.run({state:room.engineState,move,level});}
   catch(error){
    if(!bot||!['worker_timeout','worker_exit'].includes(error.message))throw error;
    state=await pool.run({state:room.engineState,level:'fallback'});
   }
   if(!present(room)||room.revision!==revision)throw Error('finished');
   if(Date.now()>=room.deadlineAt){await finishByTime(room);throw Error('finished');}
   room.engineState=state;room.state=JSON.stringify(state);room.revision++;
   room.expectedPlayer=state.currentPlayer;room.winner=state.winner||null;room.endReason=state.endReason||null;
   persist(room,state);if(room.winner)finishNormal(room);publish(room);
  }catch(error){
   if(present(room)&&!['invalid_move','finished'].includes(error.message)){
    // A compute failure must not silently consume the players' remaining time.
    room.engineError='engine_paused';room.pausedAt=Date.now();pauseTimer(room);publish(room);
    console.error('Tournament turn paused:',error.message);
   }
   throw error;
  }finally{room.turnBusy=false;schedule(room);}
 }
 io.on('connection',socket=>{
  socket.on('tournament:move',async(input,ack)=>{
   if(typeof ack!=='function')return;
   let room;
   try{
    await requireSocketUser(socket);room=rooms.get(socket.data.roomCode);
    if(!room?.tournament||!present(room))throw Error('finished');
    if(socket.data.spectator||room.slots[room.expectedPlayer]!==socket.id||room.playerTypes[room.expectedPlayer]!=='human')throw Error('not_your_turn');
    if(input?.revision!==room.revision)throw Error('stale');
    if(!['from','to'].every(k=>Array.isArray(input[k])&&input[k].length===2&&input[k].every(n=>Number.isInteger(n)&&n>=0&&n<12)))throw Error('invalid_move');
    await advance(room,{from:input.from,to:input.to});ack({ok:true,...snapshot(room)});
   }catch(error){ack({ok:false,error:error.message,...(room?.tournament?snapshot(room):{})});}
  });
  socket.on('tournament:sync',(_,ack)=>{const room=rooms.get(socket.data.roomCode);if(typeof ack==='function')ack(room?.tournament&&room.state?{ok:true,...snapshot(room)}:{ok:false});});
  socket.on('tournament:retry',async(_,ack)=>{
   if(typeof ack!=='function')return;
   try{const user=await requireSocketUser(socket),room=rooms.get(socket.data.roomCode);
    if(!room?.tournament||!present(room)||(!room.tournament.pair.includes(user.id)&&room.ownerId!==user.id))throw Error('owner_only');
    if(room.engineError){room.deadlineAt+=Date.now()-room.pausedAt;room.engineState.timerDeadlineAt=room.deadlineAt;room.state=JSON.stringify(room.engineState);room.engineError=null;room.pausedAt=null;resumeTimer(room);publish(room);schedule(room);}
    ack({ok:true,...snapshot(room)});
   }catch(error){ack({ok:false,error:error.message});}
  });
 });
 return {initialize,snapshot,close:()=>pool.close()};
};
