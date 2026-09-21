'use strict';
const {parentPort}=require('node:worker_threads');
const {step}=require('./game-engine');
parentPort.on('message',job=>{
 try{parentPort.postMessage({id:job.id,state:step(job.state,job.move,job.level)});}
 catch(error){parentPort.postMessage({id:job.id,error:error.message||'engine_error'});}
});
