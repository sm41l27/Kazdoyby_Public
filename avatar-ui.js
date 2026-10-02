(() => {
 'use strict';
 const I=window.KAZ_I18N,t=(key,vars)=>I.t('room.'+key,vars),$=id=>document.getElementById(id),socket=window.kazSocket,A=window.KAZ_AVATARS;
 let draft=null,dirty=false,busy=false,source=null,message=null,uploadEpoch=0;
 const current=()=>window.KAZ_NET?.profile?.avatar||{type:'icon',value:'pawn'};
 function render(){
  if(!dirty)draft=current();
  $('avatarPreview').innerHTML=A.html(draft,'large');
  $('avatarIcons').innerHTML=A.icons.map(id=>`<button type="button" data-avatar-icon="${id}" aria-label="${t('icon.'+id)}" title="${t('icon.'+id)}" aria-pressed="${draft?.type==='icon'&&draft.value===id}" ${busy?'disabled':''}>${A.html({type:'icon',value:id})}</button>`).join('');
  $('avatarSave').disabled=busy||!dirty||!window.KAZ_AUTH?.isAuthenticated();
  $('avatarSave').textContent=t(busy?'saving':'avatarSave');$('avatarFile').disabled=busy;
  $('avatarMessage').textContent=message?t(message):!window.KAZ_AUTH?.isAuthenticated()?t('avatarLogin'):'';
 }
 function crop(){
  if(!source)return;
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;const ctx=canvas.getContext('2d');
  const size=Math.min(source.naturalWidth,source.naturalHeight)/Number($('avatarZoom').value),x=(source.naturalWidth-size)*Number($('avatarX').value)/100,y=(source.naturalHeight-size)*Number($('avatarY').value)/100;
  ctx.fillStyle='#f4f6f0';ctx.fillRect(0,0,256,256);ctx.drawImage(source,x,y,size,size,0,0,256,256);
  let data;for(const quality of [0.86,0.7,0.5]){data=canvas.toDataURL('image/jpeg',quality);if(data.length<=66000)break;}
  if(data.length>66000)throw {code:'invalid_avatar'};
  draft={type:'photo',value:data};dirty=true;message=null;render();
 }
 $('avatarFile').addEventListener('change',async()=>{
  const file=$('avatarFile').files?.[0];if(!file)return;const epoch=++uploadEpoch;
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>5*1024*1024){message='error.photo_size';render();return;}
  const url=URL.createObjectURL(file),img=new Image();
  try{
   await new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=()=>reject({code:'invalid_avatar'});img.src=url;});
   if(epoch!==uploadEpoch)return;
   if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>60000000)throw{code:'photo_size'};
   source=img;$('avatarZoom').value='1';$('avatarX').value='50';$('avatarY').value='50';$('avatarCrop').hidden=false;crop();
  }catch(error){message='error.'+(error.code||'invalid_avatar');render();}
  finally{URL.revokeObjectURL(url);$('avatarFile').value='';}
 });
 for(const id of ['avatarZoom','avatarX','avatarY'])$(id).addEventListener('input',()=>{try{crop();}catch(error){message='error.'+error.code;render();}});
 document.addEventListener('click',e=>{
  const icon=e.target.closest('[data-avatar-icon]');if(icon&&!busy){uploadEpoch++;draft={type:'icon',value:icon.dataset.avatarIcon};dirty=true;source=null;$('avatarCrop').hidden=true;message=null;render();}
  if(e.target.closest('[data-avatar-edit]')){window.KAZ_ROOM?.close();window.KAZ_SOCIAL.open('settings');render();$('avatarSettings').scrollIntoView({block:'start'});}
 });
 $('avatarSave').addEventListener('click',async()=>{
  if(busy||!dirty)return;
  if(!window.KAZ_AUTH?.isAuthenticated()){message='avatarLogin';render();return;}
  if(!socket.connected){message='error.connection';render();return;}
  busy=true;message=null;render();
  try{
   const result=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject({code:'connection'}),15000);socket.emit('avatar:save',{avatar:draft},out=>{clearTimeout(timer);out?.ok?resolve(out.avatar):reject({code:out?.error||'server_error'});});});
   if(window.KAZ_NET.profile)window.KAZ_NET.profile.avatar=result;draft=result;dirty=false;source=null;$('avatarCrop').hidden=true;message='avatarSaved';
  }catch(error){message='error.'+(error.code||'server_error');}
  finally{busy=false;render();}
 });
 window.addEventListener('kaz-profile-updated',render);window.addEventListener('kaz-language-changed',render);
 window.addEventListener('kaz-auth-changed',()=>{dirty=false;draft=null;source=null;message=null;uploadEpoch++;$('avatarCrop').hidden=true;render();});
 render();
})();
