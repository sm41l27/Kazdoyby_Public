'use strict';
const {Worker}=require('node:worker_threads'),path=require('node:path');
// Bounded concurrency and a hard watchdog keep search away from Socket.IO's event loop.
module.exports=function(size=2){
 const slots=[],queue=[];let sequence=0,closed=false;
 function spawn(){const slot={worker:new Worker(path.join(__dirname,'turn-worker.js')),job:null,timer:null};slots.push(slot);slot.worker.unref();
  slot.worker.on('message',out=>{if(slot.job?.id!==out.id)return;finish(slot,out.error?Error(out.error):null,out.state);});
  slot.worker.on('error',error=>{const job=slot.job;retire(slot);job?.reject(error);});
  slot.worker.on('exit',code=>{if(slots.includes(slot)){const job=slot.job;retire(slot);job?.reject(Error('worker_exit'));}});
  return slot;
 }
 function retire(slot){clearTimeout(slot.timer);slots.splice(slots.indexOf(slot),1);slot.job=null;slot.worker.terminate();if(!closed)pump();}
 function finish(slot,error,value){clearTimeout(slot.timer);const job=slot.job;slot.job=null;slot.worker.unref();error?job.reject(error):job.resolve(value);pump();}
 function pump(){if(closed)return;while(queue.length){let slot=slots.find(s=>!s.job);if(!slot){if(slots.length>=size)return;slot=spawn();}
  const job=queue.shift();clearTimeout(job.queueTimer);slot.job=job;slot.worker.ref();
  slot.timer=setTimeout(()=>{retire(slot);job.reject(Error('worker_timeout'));},4000);slot.worker.postMessage(job.payload);
 }}
 return {
  run(payload){if(closed)return Promise.reject(Error('closed'));if(queue.length>=64)return Promise.reject(Error('server_busy'));
   return new Promise((resolve,reject)=>{const id=++sequence,job={id,payload:{...payload,id},resolve,reject};job.queueTimer=setTimeout(()=>{const i=queue.indexOf(job);if(i>=0){queue.splice(i,1);reject(Error('server_busy'));}},5000);queue.push(job);pump();});
  },
  async close(){closed=true;for(const job of queue){clearTimeout(job.queueTimer);job.reject(Error('closed'));}queue.length=0;await Promise.all(slots.map(slot=>{clearTimeout(slot.timer);slot.job?.reject(Error('closed'));return slot.worker.terminate();}));slots.length=0;}
 };
};
