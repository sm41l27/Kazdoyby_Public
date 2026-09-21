'use strict';
const {createHash}=require('node:crypto');
const ICONS=new Set(['pawn','crown','knight','star','shield','bolt','leaf','compass','moon','sun','gem','rook']);
const DEFAULT={type:'icon',value:'pawn'};
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
function validate(avatar){
 if(!avatar||typeof avatar!=='object')return false;
 if(avatar.type==='icon')return ICONS.has(avatar.value);
 if(avatar.type!=='photo'||typeof avatar.value!=='string'||avatar.value.length>68000||!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(avatar.value))return false;
 const bytes=Buffer.from(avatar.value.split(',')[1],'base64');
 if(bytes.length>50000||bytes.length<16||bytes.readUInt16BE(0)!==0xffd8||bytes.readUInt16BE(bytes.length-2)!==0xffd9)return false;
 // Accept only a JPEG with a small, bounded frame. SVG, URLs and arbitrary files are rejected.
 let offset=2;
 while(offset+4<=bytes.length){
  if(bytes[offset++]!==255)return false;
  while(bytes[offset]===255)offset++;
  const marker=bytes[offset++];if(marker===0xda||marker===0xd9)return false;
  if(marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
  if(offset+2>bytes.length)return false;
  const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)return false;
  if([0xc0,0xc1,0xc2].includes(marker)){
   if(length<8)return false;const height=bytes.readUInt16BE(offset+3),width=bytes.readUInt16BE(offset+5);
   return width>0&&height>0&&width<=256&&height<=256;
  }
  offset+=length;
 }
 return false;
}
module.exports=function({app,supabaseRest,enabled}){
 const cache=new Map();
 const remember=(id,avatar)=>{if(cache.size>=500)cache.delete(cache.keys().next().value);cache.set(id,{avatar:validate(avatar)?avatar:DEFAULT,until:Date.now()+60000});};
 const dto=(id,avatar)=>avatar?.type==='photo'?{type:'photo',value:`/avatars/${id}?v=${createHash('sha256').update(avatar.value).digest('hex').slice(0,16)}`}:{...DEFAULT,...(avatar?.type==='icon'&&ICONS.has(avatar.value)?avatar:{})};
 async function get(id){
  if(!uuid(id)||!enabled)return DEFAULT;
  const cached=cache.get(id);if(cached&&cached.until>Date.now())return cached.avatar;
  const rows=await supabaseRest('kaz_social_profiles',{query:`id=eq.${id}&select=id,avatar&limit=1`});
  const avatar=rows?.[0]?.avatar||DEFAULT;remember(id,avatar);return cache.get(id).avatar;
 }
 async function decorate(people,key='id'){
  if(!Array.isArray(people)||!enabled)return people;
  const ids=[...new Set(people.map(p=>p[key]).filter(uuid))],missing=ids.filter(id=>!cache.has(id)||cache.get(id).until<Date.now());
  if(missing.length){
   const rows=await supabaseRest('kaz_social_profiles',{query:`id=in.(${missing.join(',')})&select=id,avatar`});
   for(const id of missing)remember(id,rows?.find(p=>p.id===id)?.avatar||DEFAULT);
  }
  for(const p of people)if(uuid(p[key]))p.avatar=dto(p[key],cache.get(p[key])?.avatar||DEFAULT);
  return people;
 }
 async function attach(profile){if(!profile)return profile;await decorate([profile],'auth_user_id');return profile;}
 async function save(actor,avatar,name){
  if(!validate(avatar)){const e=new Error('ROOM:invalid_avatar');throw e;}
  if(!enabled)throw Error('ROOM:setup_required');
  const row=await supabaseRest('rpc/kaz_set_avatar',{method:'POST',body:{p_actor:actor,p_avatar:{type:avatar.type,value:avatar.value},p_name:name}});
  remember(actor,row.avatar);return dto(actor,row.avatar);
 }
 app.get('/avatars/:id',async(req,res)=>{
  if(!uuid(req.params.id))return res.sendStatus(404);
  try{const avatar=await get(req.params.id);if(avatar.type!=='photo')return res.sendStatus(404);
   res.set('Content-Type','image/jpeg');res.set('X-Content-Type-Options','nosniff');res.set('Cache-Control','public, max-age=3600');res.send(Buffer.from(avatar.value.split(',')[1],'base64'));
  }catch{res.sendStatus(503);}
 });
 return {attach,decorate,save,validate};
};
module.exports.validate=validate;
