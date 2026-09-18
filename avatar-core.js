(() => {
 'use strict';
 const icons={
  pawn:['#46715d','M7 18h10v3H7z M9 17l1-6h4l1 6 M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  crown:['#946d30','M4 8l4 4 4-7 4 7 4-4-2 10H6z M6 21h12'],
  knight:['#526b94','M7 20h12l-2-8-1-7-6-2 1 3-6 7 3 2 4-2-3 7 M13 8h.1'],
  star:['#866235','M12 3l3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1z'],
  shield:['#557f82','M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6'],
  bolt:['#92704a','M13 2L4 14h7l-1 8 10-13h-8z'],
  leaf:['#52754d','M20 3C8 2 3 7 4 14c1 7 12 9 15-2z M5 20L16 8'],
  compass:['#73628b','M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M16 8l-3 5-5 3 3-5z'],
  moon:['#5c6091','M20 15A9 9 0 0 1 9 3 9 9 0 1 0 20 15z'],
  sun:['#a07532','M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M12 2v2 M12 20v2 M2 12h2 M20 12h2 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2'],
  gem:['#427e87','M3 8l4-5h10l4 5-9 13z M3 8h18 M7 3l5 18 5-18'],
  rook:['#7a6474','M5 3h3v4h2V3h4v4h2V3h3v7l-3 2v6H8v-6l-3-2z M6 21h12']
 };
 const safePhoto=x=>typeof x==='string'&&(/^\/avatars\/[0-9a-f-]{36}\?v=[0-9a-f]{16}$/i.test(x)||/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(x)&&x.length<=68000);
 function html(avatar,extra=''){
  if(avatar?.type==='photo'&&safePhoto(avatar.value))return `<span class="kaz-avatar ${extra}"><img src="${avatar.value}" alt="" loading="lazy" decoding="async"></span>`;
  const [color,path]=icons[avatar?.value]||icons.pawn;
  return `<span class="kaz-avatar ${extra}" style="--avatar-color:${color}"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"><path d="${path}"/></svg></span>`;
 }
 window.KAZ_AVATARS={icons:Object.keys(icons),html};
})();
