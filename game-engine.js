'use strict';
// Tournament transitions run in a worker, using the same move rules as the board.
const core=require('./public/game-core');
function initial(playerTypes,timeControlSec,deadlineAt){
 const board=Array.from({length:12},()=>Array(12).fill(null));
 for(const [color,positions] of Object.entries(core.STARTING_POSITIONS))for(const [r,c] of positions)board[r][c]={player:color,isSultan:false,r,c};
 return {board,turnIndex:0,currentPlayer:'blue',activePlayers:[...core.TURN_ORDER],playerPiecesCount:Object.fromEntries(core.TURN_ORDER.map(c=>[c,8])),gameMode:'teams',playerTypes,historyLog:[],lastMove:null,captureStats:core.emptyCaptureStats(),timeControlSec,timerDeadlineAt:deadlineAt,winner:null,endReason:null};
}
function model(state){
 core.resetDeadline();core.setMode(state.gameMode);
 return {...state,board:state.board.map((row,r)=>row.map((p,c)=>{if(!p)return null;const piece=new core.Piece(r,c,p.player);piece.isSultan=Boolean(p.isSultan);return piece;}))};
}
function legal(state){const s=model(state);return core.getAllPossibleMovesForPlayer(s.board,s.currentPlayer);}
const same=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===2&&a[0]===b[0]&&a[1]===b[1];
function step(state,input,level){
 const s=model(state),moves=core.getAllPossibleMovesForPlayer(s.board,s.currentPlayer);
 if(state.winner)throw Error('finished');
 let move;
 if(level){move=level==='fallback'?moves[0]:core.chooseBestMove(s,level);}
 else move=moves.find(m=>same(m.from,input?.from)&&same(m.to,input?.to));
 core.resetDeadline();
 if(!move&&moves.length)throw Error('invalid_move');
 if(!move&&!level)throw Error('invalid_move');
 if(move){
  const color=s.currentPlayer;
  const stats={...s.captureStats[color]};
  for(const [r,c] of move.captures){const p=s.board[r][c];if(p)stats[p.isSultan?'sultans':'pawns']++;}
  s.captureStats={...s.captureStats,[color]:stats};
  const out=core.applyMoveToBoard(s.board,move,s.playerPiecesCount);s.board=out.board;s.playerPiecesCount=out.counts;
  const coord=([r,c])=>core.colLabels[c]+core.rowLabels[r];
  s.historyLog=[...s.historyLog,{player:color,text:coord(move.from)+' ➔ '+(move.path||[move.to]).map(coord).join(' ➔ ')+(move.captures.length?' (Жою: '+move.captures.length+')':'')}];
  s.lastMove={from:move.from,to:move.to};
 }
 s.activePlayers=s.activePlayers.filter(c=>s.playerPiecesCount[c]>0&&(move||c!==s.currentPlayer));
 for(let i=0;i<4;i++){
  const teams=[...new Set(s.activePlayers.map(c=>core.TEAM_MAP[c]))];
  if(teams.length<=1){s.winner=teams[0]||'draw';s.endReason='normal';break;}
  s.turnIndex=(s.turnIndex+1)%4;s.currentPlayer=core.TURN_ORDER[s.turnIndex];
  if(!s.activePlayers.includes(s.currentPlayer))continue;
  if(core.getAllPossibleMovesForPlayer(s.board,s.currentPlayer).length)break;
  s.activePlayers=s.activePlayers.filter(c=>c!==s.currentPlayer);
 }
 const teams=[...new Set(s.activePlayers.map(c=>core.TEAM_MAP[c]))];
 if(teams.length<=1){s.winner=teams[0]||'draw';s.endReason='normal';}
 s.board=s.board.map(row=>row.map(p=>p?{player:p.player,isSultan:p.isSultan,r:p.row,c:p.col}:null));
 return s;
}
module.exports={initial,legal,step};
