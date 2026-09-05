/* Live visitors odometer — Firebase Realtime Database.
   The card stays hidden until real data arrives, so a blocked/offline
   Firebase never shows a broken meter. */
import { ref, runTransaction, onValue } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getFirebase } from "./firebase.js";

function initOdometer(){
  const NUM_DIGITS = 7;
  const REEL_SETS = 4;
  const wrap = document.getElementById('odoWrap');
  const box = document.getElementById('odo-box');
  if(!wrap || !box) return;

  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function digitHeight(){
    const d = box.querySelector('.odo-digit');
    return d ? d.getBoundingClientRect().height : 46;
  }

  const columns = [];
  const positions = Array(NUM_DIGITS).fill(0);

  const frag = document.createDocumentFragment();
  for(let i = 0; i < NUM_DIGITS; i++){
    const win = document.createElement('div');
    win.className = 'odo-window';
    win.innerHTML = '<div class="odo-center-line"></div>';
    const col = document.createElement('div');
    col.className = 'odo-column';
    for(let k = 0; k < REEL_SETS; k++){
      for(let j = 0; j <= 9; j++){
        const d = document.createElement('div');
        d.className = 'odo-digit';
        d.textContent = j;
        col.appendChild(d);
      }
    }
    win.appendChild(col);
    frag.appendChild(win);
    columns.push(col);
  }
  box.appendChild(frag);

  function setColumn(i, rowIndex, durationS, delayMs){
    positions[i] = rowIndex;
    const move = () => {
      columns[i].style.transition = durationS > 0 ? `transform ${durationS}s cubic-bezier(0.22, 1, 0.36, 1)` : 'none';
      columns[i].style.transform = `translateY(-${rowIndex * digitHeight()}px)`;
    };
    delayMs > 0 ? setTimeout(move, delayMs) : move();
  }

  columns.forEach((col, i) => {
    col.addEventListener('transitionend', () => {
      const digit = positions[i] % 10;
      if(positions[i] !== digit) setColumn(i, digit, 0, 0);
    });
  });

  function updateOdometer(newVal, isFirstLoad){
    let v = Math.max(0, Math.floor(Number(newVal) || 0));
    const MAX = Math.pow(10, NUM_DIGITS) - 1;
    if(v > MAX) v = MAX;
    const valStr = String(v).padStart(NUM_DIGITS, '0');
    for(let i = 0; i < NUM_DIGITS; i++){
      const target = parseInt(valStr[i], 10);
      const from = positions[i] % 10;
      let diff = target - from;
      if(diff < 0) diff += 10;
      if(!isFirstLoad && diff === 0) continue;
      if(reduceMotion){ setColumn(i, target, 0, 0); continue; }
      const steps = isFirstLoad ? (20 + diff) : diff;
      setColumn(i, from, 0, 0);
      void columns[i].offsetHeight;
      setColumn(i, from + steps, isFirstLoad ? 2.2 : 0.9, isFirstLoad ? i * 120 : 0);
    }
  }

  let resizeT = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => {
      for(let i = 0; i < NUM_DIGITS; i++) setColumn(i, positions[i] % 10, 0, 0);
    }, 150);
  }, {passive:true});

  try{
    const { db } = getFirebase();
    /* NOTE: must match a path allowed by the RTDB rules (see README) — only
       visits / library_index / library are open for read+write. Any other
       path (e.g. the old 'darshak_ginti_pro') gets permission_denied and the
       odometer silently dies after an optimistic first update. */
    const darshakRef = ref(db, 'visits/total');

    let counted = false;
    try{ counted = sessionStorage.getItem('dtv_counted') === '1'; }catch(e){}
    if(!counted){
      runTransaction(darshakRef, (n) => (n || 0) + 1)
        .then(()=>{ try{ sessionStorage.setItem('dtv_counted','1'); }catch(e){} })
        .catch(()=>{});
    }

    let isFirst = true;
    onValue(darshakRef, (snapshot) => {
      const val = snapshot.val() || 0;
      if(isFirst) wrap.classList.add('ready');
      updateOdometer(val, isFirst);
      isFirst = false;
    }, ()=>{});
  }catch(err){}
}

if(document.readyState === 'loading'){
  document.addEventListener('DOMContentLoaded', initOdometer, {once:true});
}else{
  initOdometer();
}
