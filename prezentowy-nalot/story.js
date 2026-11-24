// Story pages between chapters: a full-screen illustration that slowly drifts, the chapter title in the script font,
// and Kaka reading the chapter aloud (her portrait blinks and moves its mouth with the narration, Rhubarb cues).
// STORY.show(n, then) shows chapter n (1..11) and calls then() when the player presses "Dalej".
(function(){
  const base=/\/(wioska|magazyn|bobslej|arcade)\//.test(location.pathname)?'../':'./';
  const ROMAN=['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI'];
  const CH={
    1:{bg:'art/bg_night.webp',sprite:'art/sleigh.webp',t:'Wigilijny lot',x:'Kaczor zamknął oczy tylko na chwilkę… i nagle siedział w saniach. Obok ja, z listą prezentów, z tyłu mały Mikołaj, a z przodu Rudolf z nosem jak latarnia. Trzeba rozwieźć prezenty po całym osiedlu. Tylko skąd nad dachami wzięło się tyle kruków?'},
    2:{bg:'art/bg_forest.webp',t:'Las goblinów',x:'Maryańska pokazała nam drogę przez las. Bobry i borsuki czekają na prezenty, ale w koronach drzew czają się gobliny Grincha z workami węgla. Trzeba lecieć nisko, między drzewami.'},
    3:{bg:'art/bg_pole.webp',sprite:'art/sleigh.webp',t:'Kurs na biegun',x:'W piernikowej chatce Jugo czekała niespodzianka: prawdziwy Święty Mikołaj, Papi. Inez zbuntowała jego elfy, zajęła biegun i ukradła Worek Prezentów. Wsiadamy do sań. Kurs na biegun północny!'},
    4:{bg:'wioska/art/bg_village.webp',t:'Wioska elfów',x:'Inez zestrzeliła nasze sanie wielkim serduszkiem. Wszyscy cali, ale dalej trzeba iść pieszo — przez wioskę zbuntowanych elfów, gdzie lojalni pomocnicy Mikołaja siedzą zamknięci w klatkach.'},
    5:{bg:'art/fab_in.webp',t:'Ruch oporu',x:'Generał Elfów się poddał, a brama warsztatu stanęła otworem. W środku czekała Maryańska. Razem z elfami z ruchu oporu ma plan, jak pokonać Inez. Potrzebna będzie armatka śnieżna.'},
    6:{bg:'wioska/art/bg_factory.webp',t:'Hala produkcyjna',x:'Armatka gotowa, ale Inez wymknęła się przez halę produkcyjną. Sprężyny, liny, taśmociągi — trzeba przebiec całą fabrykę, zanim dotrze do toru bobslejowego.'},
    7:{bg:'art/st_mag.webp',t:'Magazyn zabawek',x:'Za halą jest magazyn pilnowany przez kamery i elfy-strażników. Kaczor jest za duży, żeby przemknąć między regałami, więc na zwiad rusza mały Mikołaj — po złoty klucz do bramy.'},
    8:{bg:'art/st_bob.webp',t:'Pościg',x:'Brama otwarta! Za nią lodowy tor, a na nim różowy bobslej Inez. Wskakujemy do naszego bobsleja — z armatką śnieżną na przodzie. Pościg czas zacząć!'},
    9:{bg:'art/bg_palace.webp',sprite:'art/sleigh.webp',t:'Różowy Pałac',x:'Inez przegrała wyścig, ale nie oddała bieguna. Wskoczyła na Różowego Renifera i odleciała do swojego pałacu z lodu — z Workiem Prezentów Papiego. Elfy połatały nasze sanie. Lecimy za nią!'},
    10:{bg:'wioska/art/bg_palace_in.webp',t:'Wieża luster',x:'Różowy Renifer uciekł, a Inez schowała się na szczycie swojej wieży. Lodowe schody, kryształowe żyrandole i sala luster. Gdzieś tam, obok jej tronu, leży worek prezentów.'},
    11:{bg:'art/throne.webp',t:'Sala tronowa',x:'Lustra rozbite. Zmęczona Inez zaprasza Kaczora do sali tronowej. Worek leży tuż obok… ale Inez ma jeszcze jedną propozycję.'}};
  const css=`.st-ov{position:fixed;inset:0;z-index:9998;overflow:hidden;background:#0b1020;font-family:"Baloo 2",system-ui,sans-serif;opacity:0;transition:opacity .6s}
.st-ov.on{opacity:1}.st-bg{position:absolute;inset:-4%;background:center/cover no-repeat;animation:stZoom 26s ease-out forwards;filter:saturate(1.05)}
@keyframes stZoom{from{transform:scale(1.02) translate(0,0)}to{transform:scale(1.12) translate(-1.5%,-1%)}}
.st-vig{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 40%,rgba(0,0,0,0) 45%,rgba(5,6,20,.55) 100%),linear-gradient(rgba(0,0,0,0) 50%,rgba(5,6,20,.75))}
.st-spr{position:absolute;width:34%;top:16%;left:-40%;animation:stFly 9s ease-in-out forwards;filter:drop-shadow(0 8px 14px rgba(0,0,0,.4))}
@keyframes stFly{0%{left:-40%;transform:translateY(0) rotate(-4deg)}60%{transform:translateY(-14px) rotate(-1deg)}100%{left:110%;transform:translateY(-34px) rotate(-6deg)}}
.st-snow{position:absolute;inset:0;pointer-events:none}
.st-card{position:absolute;left:50%;bottom:4%;transform:translateX(-50%);width:min(92%,1000px);display:flex;gap:18px;align-items:center;background:rgba(251,243,230,.94);border:4px solid #c9a24a;border-radius:24px;padding:16px 22px;box-shadow:0 18px 50px rgba(0,0,0,.45)}
.st-face{flex:0 0 auto;width:min(18vw,118px);aspect-ratio:1;border-radius:50%;border:4px solid #c0392b;overflow:hidden;background:#f1dfc0}.st-ov .st-face canvas{position:static!important;inset:auto!important;transform:none!important;width:100%!important;height:100%!important;display:block}.st-ov canvas.st-snow{position:absolute!important;inset:0!important;width:100%!important;height:100%!important;transform:none!important}
.st-txt{flex:1;color:#3a2414}.st-ch{font-weight:800;color:#a07a1a;letter-spacing:.08em;font-size:clamp(12px,1.4vw,15px);text-transform:uppercase}
.st-t{font-family:Lobster,cursive;color:#c0392b;font-size:clamp(26px,3.6vw,44px);line-height:1.05;margin:.05em 0 .15em}
.st-x{font-size:clamp(15px,1.7vw,21px);line-height:1.35;font-weight:600}.st-x span{opacity:0;transition:opacity .35s}.st-x span.on{opacity:1}
.st-row{display:flex;justify-content:space-between;align-items:center;margin-top:10px;gap:10px}.st-who{font-size:13px;opacity:.6}
.st-play{position:absolute;left:50%;top:38%;transform:translate(-50%,-50%);width:150px;height:150px;border-radius:50%;border:5px solid #fff3d0;background:rgba(192,57,43,.92);color:#fff;font-size:64px;line-height:1;cursor:pointer;box-shadow:0 10px 40px rgba(0,0,0,.5);animation:stPulse 1.6s ease-in-out infinite;display:flex;flex-direction:column;align-items:center;justify-content:center;padding-left:8px}
.st-play small{font-size:13px;font-weight:700;margin-top:4px;padding-right:8px}@keyframes stPulse{50%{transform:translate(-50%,-50%) scale(1.07)}}
.st-btn{font:inherit;font-weight:800;font-size:18px;border:0;border-radius:999px;padding:9px 22px;cursor:pointer;background:#c0392b;color:#fff;box-shadow:0 4px 0 #8a2418}`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  // Kaka's talking portrait (mouth shapes and closed eyes are the ones made for the platformer story card)
  const F={im:new Image(),m:new Image(),b:new Image(),M:null,B:null,L:{}}; F.im.src=base+'wioska/art/kaka_face.webp'; F.m.src=base+'wioska/art/mouth/kaka_face.webp'; F.b.src=base+'wioska/art/blink/kaka_face.webp';
  fetch(base+'wioska/art/mouth/mouths.json').then(r=>r.json()).then(j=>F.M=j.kaka_face).catch(()=>{}); fetch(base+'wioska/art/blink/blinks.json').then(r=>r.json()).then(j=>F.B=j.kaka_face).catch(()=>{}); fetch(base+'audio/story/lips.json').then(r=>r.json()).then(j=>F.L=j).catch(()=>{});
  const ok=i=>i&&i.complete&&i.naturalWidth;
  function show(n,then){ const C=CH[n]; if(!C){ then&&then(); return; } let muted=false; try{ muted=localStorage.getItem('pn-mute')==='1'; }catch(e){}
    const ov=document.createElement('div'); ov.className='st-ov';
    ov.innerHTML=`<div class="st-bg" style="background-image:url(${base+C.bg})"></div>${C.sprite?`<img class="st-spr" src="${base+C.sprite}" alt="">`:''}<canvas class="st-snow"></canvas><div class="st-vig"></div>
      <div class="st-card"><div class="st-face"><canvas width="256" height="256"></canvas></div><div class="st-txt"><div class="st-ch">Rozdział ${ROMAN[n]}</div><div class="st-t">${C.t}</div>
      <div class="st-x">${C.x.split(/(?<=[.!?…])\s+/).map(s=>`<span>${s} </span>`).join('')}</div><div class="st-row"><span class="st-who">Opowiada Kaka</span><button class="st-btn">Dalej ▶</button></div></div></div>`;
    document.body.appendChild(ov); requestAnimationFrame(()=>ov.classList.add('on'));
    const spans=[...ov.querySelectorAll('.st-x span')], a=muted?null:new Audio(base+'audio/story/ch'+n+'.mp3'); let waiting=false, wait0=0; const startRead=()=>{ if(!waiting) return; waiting=false; a.play().catch(()=>{}); const pr=ov.querySelector('.st-play'); if(pr) pr.remove(); };
    // a fresh page load may not play sound until the player interacts: then the page waits behind a big start button and the text appears together with the voice
    if(a){ a.volume=.95; a.play().catch(()=>{ waiting=true; wait0=performance.now(); const b=document.createElement('button'); b.className='st-play'; b.innerHTML='▶<small>Kaka czyta rozdział — kliknij</small>'; b.onclick=e=>{ e.stopPropagation(); startRead(); }; ov.appendChild(b); }); }
    let t0=performance.now(); const cues=F.L['ch'+n]||[], dur=()=>a&&a.duration&&isFinite(a.duration)?a.duration:spans.length*3.2;
    const sn=ov.querySelector('.st-snow'), sg=sn.getContext('2d'), flakes=Array.from({length:90},()=>({x:Math.random(),y:Math.random(),r:1+Math.random()*2.4,s:.02+Math.random()*.05,d:Math.random()*6}));
    const fc=ov.querySelector('.st-face canvas').getContext('2d'); let raf, done=false;
    function frame(){ if(done) return; const t=(performance.now()-t0)/1000, at=waiting?-1:a&&!a.paused?a.currentTime:a&&a.currentTime>0?a.duration:t;
      // sentences appear as they are read
      spans.forEach((s,i)=>{ if(waiting) s.classList.remove('on'); else if(at>=i/spans.length*dur()*0.98) s.classList.add('on'); });
      // snow
      if(sn.width!==sn.clientWidth){ sn.width=sn.clientWidth; sn.height=sn.clientHeight; } sg.clearRect(0,0,sn.width,sn.height); sg.fillStyle='rgba(255,255,255,.85)';
      flakes.forEach(f=>{ const y=((f.y+t*f.s)%1)*sn.height, x=((f.x+Math.sin(t*.7+f.d)*.01)%1)*sn.width; sg.beginPath(); sg.arc(x,y,f.r,0,6.29); sg.fill(); });
      // portrait: blink every 4.2 s, mouth from the cues while the narration plays
      fc.clearRect(0,0,256,256); if(ok(F.im)) fc.drawImage(F.im,0,0,256,256); const bt=t%4.2, ba=bt<.06?bt/.06:bt<.15?1:bt<.23?1-(bt-.15)/.08:0;
      if(F.B&&ok(F.b)&&ba>0){ fc.globalAlpha=ba; fc.drawImage(F.b,F.B.x,F.B.y,F.B.w,F.B.h); fc.globalAlpha=1; }
      if(a&&!a.paused&&F.M&&ok(F.m)){ let v='X'; for(const q of cues){ if(q[0]<=a.currentTime) v=q[1]; else break; } const f={X:0,A:0,B:1,G:1,C:2,H:2,D:3,E:4,F:4}[v]||0; fc.drawImage(F.m,f*F.M.fw,0,F.M.fw,F.M.fh,F.M.x,F.M.y,F.M.w,F.M.h); }
      raf=requestAnimationFrame(frame); }
    frame();
    const close=()=>{ if(done) return; done=true; cancelAnimationFrame(raf); if(a){ a.pause(); } removeEventListener('keydown',key,true); ov.classList.remove('on'); setTimeout(()=>ov.remove(),500); then&&then(); };
    const key=e=>{ if(e.code==='Enter'||e.code==='Space'){ e.preventDefault(); e.stopPropagation(); if(waiting){ startRead(); return; } if(performance.now()-t0>400) close(); } };
    ov.querySelector('.st-btn').onclick=close; addEventListener('keydown',key,true); }
  window.STORY={show};
  // ?story=N shows chapter N on its own (to preview a page)
  const q=+new URLSearchParams(location.search).get('story'); if(q) addEventListener('load',()=>setTimeout(()=>show(q,()=>{}),600));
})();
