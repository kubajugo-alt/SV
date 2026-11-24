// Online scoreboard shared by every part of Świąteczna Przygoda Kaczorów (main game, platformer, warehouse, bobsled).
// Each part calls RANK.award(key, points, stars, anchor) when something is completed: the best result per part is kept
// in localStorage, the total is sent to /api/scores (a Netlify Function backed by Netlify Blobs) together with the
// player's name and a random id, and RANK.show() opens the table of the 25 best players.
(function(){
  const PARTS={l1:'Nad osiedlem',l2:'Leśne gobliny',l3:'Biegun północny',l4:'Różowy Pałac',tent:'Namiot Maryańskiej',cot:'Chatka Jugo',fab:'Fabryka zabawek',w1:'Wioska elfów',w2:'Hala produkcyjna',w3:'Wieża luster',mag:'Magazyn',bob:'Bobslej'};
  const ls={ get(k,d){ try{ const v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} } };
  let PID=ls.get('pn-pid',''); if(!PID){ PID=(crypto.randomUUID?crypto.randomUUID():Math.random().toString(36).slice(2)+Date.now().toString(36)); ls.set('pn-pid',PID); }
  let NAME=ls.get('pn-name',''); const PTS=ls.get('pn-pts',{}), STARS=ls.get('pn-stars',{});
  const total=()=>Object.values(PTS).reduce((a,b)=>a+b,0), starSum=()=>Object.values(STARS).reduce((a,b)=>a+b,0);
  const css=`.rk-ov{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;background:rgba(10,8,20,.6);font-family:"Baloo 2",system-ui,sans-serif}
.rk-card{background:#fbf3e6;color:#3a2414;border-radius:22px;padding:22px 26px;min-width:min(92vw,520px);max-height:86vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.45);border:4px solid #c9a24a}
.rk-card h2{font-family:Lobster,cursive;color:#c0392b;margin:0 0 6px;font-size:34px;text-align:center}.rk-info{text-align:center;opacity:.8;margin:0 0 8px}
.rk-tab{width:100%;border-collapse:collapse;font-size:17px}.rk-tab td{padding:4px 8px;border-bottom:1px solid rgba(0,0,0,.08)}.rk-tab td:first-child{font-weight:800;width:2.6em}.rk-tab td.s{text-align:right;font-weight:800}.rk-tab td.p{text-align:right;opacity:.65;font-size:.85em}.rk-tab tr.me{background:#ffe9a8}
.rk-row{display:flex;gap:10px;justify-content:center;margin-top:12px;flex-wrap:wrap}.rk-btn{font:inherit;font-weight:800;border:0;border-radius:999px;padding:8px 18px;cursor:pointer;background:#c0392b;color:#fff}.rk-btn.alt{background:#2e7d4f}
.rk-in{font:inherit;font-weight:700;padding:7px 14px;border-radius:999px;border:2px solid #d9a400;background:#fffaf0;color:#3a2a1a;width:220px;text-align:center}
.rk-line{margin-top:.5em;font-size:.95em}.rk-mine{margin-top:10px;font-size:15px}.rk-mine td{padding:2px 8px}`;
  const st=document.createElement('style'); st.textContent=css; document.head.appendChild(st);
  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function setName(n){ NAME=String(n||'').replace(/\s+/g,' ').trim().slice(0,16); ls.set('pn-name',NAME); }
  function submit(cb){ if(!NAME||!total()) return; fetch(base()+'api/scores',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:PID,name:NAME,score:total(),parts:Object.keys(PTS).length,stars:starSum()})}).then(r=>r.json()).then(j=>cb&&cb(j)).catch(()=>{}); }
  // the site root (the subpages live one folder down)
  function base(){ const p=location.pathname; return /\/(wioska|magazyn|bobslej|arcade)\//.test(p)?'../':'./'; }
  function nameBox(after,onSave){ const w=document.createElement('div'); w.className='rk-line'; w.innerHTML='<input class="rk-in" maxlength="16" placeholder="Wpisz imię do rankingu"> <button class="rk-btn alt">Zapisz</button>'; after.after(w);
    const inp=w.querySelector('input'), save=()=>{ if(!inp.value.trim()) return; setName(inp.value); w.remove(); onSave&&onSave(); }; w.querySelector('button').onclick=save; inp.onkeydown=e=>{ e.stopPropagation(); if(e.key==='Enter') save(); }; inp.onkeyup=e=>e.stopPropagation(); }
  // record a result; anchor = an element on the win card under which a one-line summary is shown
  function award(key,pts,stars,anchor){ pts=Math.max(0,Math.round(pts)); const better=pts>(PTS[key]||0); if(better){ PTS[key]=pts; ls.set('pn-pts',PTS); } if((stars||0)>(STARS[key]||0)){ STARS[key]=stars; ls.set('pn-stars',STARS); }
    if(!anchor) { submit(); return; } let el=anchor.parentNode&&anchor.parentNode.querySelector('.rk-line.res'); if(!el){ el=document.createElement('div'); el.className='rk-line res'; anchor.after(el); }
    el.innerHTML=`<b>+${pts} pkt</b>${better?'':' (rekord: '+PTS[key]+')'} · razem <b>${total()}</b> · <a href="#" style="color:#c0392b;font-weight:800">🏆 Ranking</a>`; el.querySelector('a').onclick=e=>{ e.preventDefault(); show(); };
    const send=()=>submit(j=>{ if(j&&j.rank&&el.isConnected) el.insertAdjacentHTML('beforeend',` · <b>#${j.rank}</b> z ${j.total}`); });
    if(!NAME) nameBox(el,send); else send(); }
  function show(){ let ov=document.getElementById('rkOv'); if(ov) ov.remove(); ov=document.createElement('div'); ov.id='rkOv'; ov.className='rk-ov';
    ov.innerHTML=`<div class="rk-card"><h2>🏆 Ranking graczy</h2><p class="rk-info">Ładowanie…</p><table class="rk-tab"></table><div class="rk-me"></div><div class="rk-row"><button class="rk-btn">Zamknij</button></div></div>`;
    document.body.appendChild(ov); const close=()=>ov.remove(); ov.querySelector('.rk-btn').onclick=close; ov.onclick=e=>{ if(e.target===ov) close(); };
    const me=ov.querySelector('.rk-me'), rows=Object.keys(PARTS).filter(k=>PTS[k]).map(k=>`<tr><td>${PARTS[k]}</td><td style="text-align:right">${PTS[k]}</td></tr>`).join('');
    const mine=()=>{ me.innerHTML=(NAME?`<p class="rk-info">Grasz jako <b>${esc(NAME)}</b> · twoje punkty: <b>${total()}</b></p>`:`<p class="rk-info">Wpisz imię, żeby trafić do rankingu:</p><p class="rk-info anchor"></p>`)+(rows?`<table class="rk-mine">${rows}</table>`:''); if(!NAME) nameBox(me.querySelector('.anchor'),()=>{ submit(()=>{ ov.remove(); show(); }); mine(); }); };
    mine();
    fetch(base()+'api/scores?id='+encodeURIComponent(PID)).then(r=>r.json()).then(j=>{ ov.querySelector('.rk-info').textContent=j.total?`Graczy w rankingu: ${j.total}`+(j.rank>25?` · twoje miejsce: #${j.rank}`:''):'Ranking jest jeszcze pusty — ukończ poziom i bądź pierwszy!';
      ov.querySelector('.rk-tab').innerHTML=j.top.map((e,k)=>`<tr class="${e.me?'me':''}"><td>${k<3?['🥇','🥈','🥉'][k]:k+1+'.'}</td><td>${esc(e.name)}</td><td class="s">${e.score}</td><td class="p">${e.parts||0}/12 części</td></tr>`).join(''); })
      .catch(()=>{ ov.querySelector('.rk-info').textContent='Nie udało się połączyć z rankingiem. Spróbuj później.'; }); }
  window.RANK={award,show,setName,get name(){ return NAME; },get total(){ return total(); }};
  if(NAME&&total()) submit(); // resend on every visit, in case an earlier save never reached the server
})();
