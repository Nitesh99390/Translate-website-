/* ==========================================================================
   Cloud Sync — shared translation library on Firebase Realtime Database.

   • Every VERIFIED chapter is pushed to  library/{bookId}/chapters/{i}
   • Anyone who opens a file with the same name (and chapter count) gets
     those chapters instantly and the run continues from the first pending one.
   • Live: chapters translated by others appear in real time while you work.
   • Claims: while a chapter is being translated by someone, others skip it
     first and come back to it later (no duplicated effort).
   • Presence: shows how many people are working on the same book.
   • Index: library_index/{bookId} powers the "Community library" on the hero.
   ========================================================================== */
import {
  ref, get, set, update, onValue, onChildAdded, onChildChanged, onChildRemoved,
  onDisconnect, serverTimestamp, runTransaction, off
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";
import { getFirebase } from "./firebase.js";

const LS_UID = 'dtv_uid', LS_NAME = 'dtv_display_name', LS_CLOUD = 'dtv_cloud_sync';
const CLAIM_TTL = 3 * 60 * 1000;

function rand(n){ return Math.random().toString(36).slice(2, 2 + n); }
function getUid(){
  let u = null; try{ u = localStorage.getItem(LS_UID); }catch(e){}
  if(!u){ u = 'u_' + rand(8) + rand(4); try{ localStorage.setItem(LS_UID, u); }catch(e){} }
  return u;
}
function getName(){
  let n = null; try{ n = localStorage.getItem(LS_NAME); }catch(e){}
  if(!n){ n = 'Reader-' + rand(4).toUpperCase(); try{ localStorage.setItem(LS_NAME, n); }catch(e){} }
  return n;
}
export function setDisplayName(n){
  n = String(n||'').trim().slice(0, 24) || getName();
  try{ localStorage.setItem(LS_NAME, n); }catch(e){}
  state.name = n;
  if(state.presenceRef) update(state.presenceRef, {name: n}).catch(()=>{});
  return n;
}
export function isCloudEnabled(){
  try{ return localStorage.getItem(LS_CLOUD) !== 'off'; }catch(e){ return true; }
}
export function setCloudEnabled(on){
  try{ localStorage.setItem(LS_CLOUD, on ? 'on' : 'off'); }catch(e){}
  state.enabled = !!on;
  if(!on) detach(); else if(window.DTV && window.DTV.chapters.length) attachToBook();
  renderCloudPanel();
}

/* Book id: normalised file name + chapter count, so the "same file" maps to the same record. */
export function makeBookId(fileName, chapterCount){
  const base = String(fileName||'book').toLowerCase()
    .replace(/\.(epub|pdf|docx|txt|json)$/i, '')
    .replace(/[^a-z0-9\u0900-\u097F\u4E00-\u9FFF]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'book';
  return `${base}__${chapterCount}`;
}

const state = {
  enabled: isCloudEnabled(),
  uid: getUid(),
  name: getName(),
  db: null,
  bookId: null,
  bookRef: null,
  chaptersRef: null,
  claimsRef: null,
  presenceRef: null,
  unsub: [],
  claims: {},            // i -> {by, at}
  presence: {},          // uid -> {name, at, idx}
  cloudDone: 0,
  connected: false,
  pushQueue: new Map(),  // i -> timer
  pulled: 0,
  lastError: null
};

function D(){ return window.DTV; }
function safeGetDb(){
  if(state.db) return state.db;
  try{ state.db = getFirebase().db; }catch(e){ state.lastError = e; state.db = null; }
  return state.db;
}

/* ---------------------------------------------------------------- attach */
function detach(){
  state.unsub.forEach(fn=>{ try{ fn(); }catch(e){} });
  state.unsub = [];
  if(state.presenceRef){ set(state.presenceRef, null).catch(()=>{}); }
  state.bookRef = state.chaptersRef = state.claimsRef = state.presenceRef = null;
  state.bookId = null;
  state.claims = {}; state.presence = {}; state.cloudDone = 0; state.pulled = 0;
  renderCloudPanel();
}

async function attachToBook(info){
  detach();
  const dtv = D();
  if(!state.enabled || !dtv || !dtv.chapters.length) return;
  const db = safeGetDb();
  if(!db){ renderCloudPanel(); return; }

  const file = dtv.currentFile;
  const fileName = (info && info.fileName) || (file ? file.name : dtv.bookTitle);
  const count = dtv.chapters.length;
  /* A book opened from the community library carries its exact cloud id so it
     re-attaches to the same shared record even though the local "file" is a JSON. */
  state.bookId = (info && info.cloudBookId) || makeBookId(fileName, count);
  state.bookRef = ref(db, `library/${state.bookId}`);
  state.chaptersRef = ref(db, `library/${state.bookId}/chapters`);
  state.claimsRef = ref(db, `library/${state.bookId}/claims`);
  state.presenceRef = ref(db, `library/${state.bookId}/presence/${state.uid}`);
  renderCloudPanel('connecting');

  /* meta (create if missing) */
  try{
    await runTransaction(ref(db, `library/${state.bookId}/meta`), (m)=>{
      m = m || {};
      if(!m.createdAt) m.createdAt = Date.now();
      m.title = dtv.bookTitle || m.title || fileName;
      m.fileName = fileName;
      m.chapterCount = count;
      m.lang = dtv.bookLang || m.lang || 'en';
      m.updatedAt = Date.now();
      m.openCount = (m.openCount || 0) + 1;
      return m;
    });
  }catch(e){ state.lastError = e; }

  /* presence */
  try{
    await set(state.presenceRef, {name: state.name, at: serverTimestamp(), idx: -1});
    onDisconnect(state.presenceRef).remove().catch(()=>{});
  }catch(e){ state.lastError = e; }

  /* initial pull of every finished chapter, then live updates */
  try{
    const snap = await get(state.chaptersRef);
    const val = snap.val() || {};
    let applied = 0;
    Object.keys(val).forEach(k=>{ if(applyCloudChapter(parseInt(k,10), val[k], true)) applied++; });
    state.cloudDone = Object.keys(val).filter(k=>val[k] && val[k].text).length;
    state.pulled = applied;
    if(applied > 0){
      dtv.renderChapterList();
      dtv.requestProgressUpdate();
      dtv.refreshDownloadSummary();
      dtv.saveSessionProgress();
      dtv.log(`Shared library: ${applied} chapter${applied>1?'s':''} already translated by other readers were loaded.`, 'ok');
      dtv.showToast(`${applied} chapter${applied>1?'s':''} loaded from the shared library \u2014 the run will continue from the rest`, 'ok', 4600);
    }
    /* Reflect "continue from where others left off" on the primary button */
    const startBtn = dtv.nodes.startBtn;
    const doneAlready = dtv.chapters.filter(c=>c.status==='done').length;
    if(startBtn && !dtv.running && doneAlready > 0){
      const pending = dtv.chapters.length - doneAlready;
      const lbl = document.getElementById('startBtnLabel');
      if(lbl) lbl.textContent = pending ? `Continue (${pending} remaining)` : 'All chapters translated';
      startBtn.disabled = !pending;
    }
    state.connected = true;
  }catch(e){ state.lastError = e; state.connected = false; }

  const liveHandler = (s)=>{
    const i = parseInt(s.key, 10);
    const v = s.val();
    if(applyCloudChapter(i, v, false)){
      const c = dtv.chapters[i];
      const badge = document.getElementById('chap-cloud-'+i);
      if(badge) badge.hidden = false;
      dtv.setChapterStatus(i, 'done');
      dtv.refreshDownloadSummary();
      if(!dtv.running) dtv.showToast(`Chapter ${i+1} translated by ${v.by || 'another reader'}`, 'info', 2400);
      dtv.log(`Chapter ${i+1} arrived from the shared library (by ${v.by || 'someone'}).`, 'ok');
    }
    recountCloudDone();
  };
  state.unsub.push(onChildAdded(state.chaptersRef, liveHandler, ()=>{}));
  state.unsub.push(onChildChanged(state.chaptersRef, liveHandler, ()=>{}));

  /* claims */
  const claimsUpdate = (s)=>{ state.claims = s.val() || {}; renderClaimBadges(); };
  state.unsub.push(onValue(state.claimsRef, claimsUpdate, ()=>{}));

  /* presence */
  state.unsub.push(onValue(ref(db, `library/${state.bookId}/presence`), (s)=>{
    state.presence = s.val() || {};
    renderCloudPanel();
  }, ()=>{}));

  /* connection state */
  state.unsub.push(onValue(ref(db, '.info/connected'), (s)=>{
    state.connected = !!s.val();
    renderCloudPanel();
  }, ()=>{}));

  renderCloudPanel();
}

function recountCloudDone(){
  // cheap: count local chapters known to be in cloud
  state.cloudDone = D().chapters.filter(c=>c.fromCloud || c.pushed).length;
  renderCloudPanel();
}

/* Apply one cloud chapter locally. Returns true when something changed. */
function applyCloudChapter(i, v, silent){
  const dtv = D();
  const c = dtv.chapters[i];
  if(!c || !v || !v.text || !String(v.text).trim()) return false;
  if(v.by === state.name && v.uid === state.uid){ c.pushed = true; return false; }
  if(c.status === 'done' && c.text && c.text.trim()) { c.pushed = c.pushed || true; return false; } // local already done — keep local
  dtv.setText(c, v.text);
  c.status = 'done';
  c.fromCloud = true;
  c.cloudBy = v.by || 'another reader';
  c.doneAt = v.at || Date.now();
  if(v.title && !c.titleEdited) c.title = v.title;
  if(silent){ /* list re-rendered by caller */ }
  return true;
}

/* ------------------------------------------------------------------ push */
function queuePush(i){
  if(!state.enabled || !state.chaptersRef) return;
  clearTimeout(state.pushQueue.get(i));
  state.pushQueue.set(i, setTimeout(()=>pushChapter(i), 350));
}
async function pushChapter(i){
  const dtv = D();
  const c = dtv.chapters[i];
  if(!c || c.status !== 'done' || !c.text || !c.text.trim() || !state.chaptersRef) return;
  if(c.fromCloud) return; // came from cloud — nothing new to publish
  try{
    await set(ref(state.db, `library/${state.bookId}/chapters/${i}`), {
      title: c.title, text: c.text, wc: c.wc || 0,
      by: state.name, uid: state.uid, at: Date.now(), durMs: c.durMs || 0
    });
    c.pushed = true;
    const doneCount = dtv.chapters.filter(x=>x.status==='done' && x.text && x.text.trim()).length;
    const meta = { updatedAt: Date.now(), doneCount, title: dtv.bookTitle, chapterCount: dtv.chapters.length, fileName: dtv.currentFile ? dtv.currentFile.name : dtv.bookTitle, lang: dtv.bookLang };
    update(ref(state.db, `library/${state.bookId}/meta`), meta).catch(()=>{});
    update(ref(state.db, `library_index/${state.bookId}`), meta).catch(()=>{});
    update(ref(state.db, `library/${state.bookId}/contributors/${state.uid}`), {name: state.name, at: Date.now()}).catch(()=>{});
    recountCloudDone();
  }catch(e){ state.lastError = e; renderCloudPanel(); }
}

/* ---------------------------------------------------------------- claims */
function claim(i){
  if(!state.enabled || !state.claimsRef) return;
  const r = ref(state.db, `library/${state.bookId}/claims/${i}`);
  set(r, {by: state.name, uid: state.uid, at: Date.now()}).catch(()=>{});
  onDisconnect(r).remove().catch(()=>{});
  if(state.presenceRef) update(state.presenceRef, {idx: i, at: Date.now()}).catch(()=>{});
}
function release(i){
  if(!state.claimsRef) return;
  set(ref(state.db, `library/${state.bookId}/claims/${i}`), null).catch(()=>{});
}
function shouldDefer(i){
  if(!state.enabled || !state.bookId) return false;
  const cl = state.claims && state.claims[i];
  if(!cl || cl.uid === state.uid) return false;
  return (Date.now() - (cl.at || 0)) < CLAIM_TTL;
}
function renderClaimBadges(){
  const dtv = D();
  if(!dtv) return;
  const now = Date.now();
  dtv.chapters.forEach((c, i)=>{
    const row = document.getElementById('chap-row-'+i);
    if(!row) return;
    const cl = state.claims[i];
    const active = cl && cl.uid !== state.uid && (now - (cl.at||0)) < CLAIM_TTL;
    row.classList.toggle('is-claimed', !!active);
    row.title = active ? `Being translated by ${cl.by}` : '';
  });
}

/* ------------------------------------------------------------- UI panel */
function renderCloudPanel(mode){
  const panel = document.getElementById('cloudPanel');
  if(!panel) return;
  const statusEl = document.getElementById('cloudStatus');
  const dot = document.getElementById('cloudDot');
  const people = document.getElementById('cloudPeople');
  const cnt = document.getElementById('cloudDoneCount');
  const toggle = document.getElementById('cloudToggle');
  const nameInput = document.getElementById('cloudName');
  const cnt2 = document.getElementById('cloudPulled');
  if(toggle) toggle.checked = state.enabled;
  if(nameInput && nameInput.value !== state.name && document.activeElement !== nameInput) nameInput.value = state.name;

  let label, cls;
  if(!state.enabled){ label = 'Off'; cls = 'off'; }
  else if(!state.db){ label = 'Unavailable'; cls = 'err'; }
  else if(mode === 'connecting'){ label = 'Connecting\u2026'; cls = 'busy'; }
  else if(!state.bookId){ label = 'Waiting for a book'; cls = 'idle'; }
  else if(state.connected){ label = 'Live'; cls = 'ok'; }
  else { label = 'Offline \u2014 will sync later'; cls = 'warn'; }
  if(statusEl) statusEl.textContent = label;
  if(dot) dot.className = 'cloud-dot ' + cls;
  panel.dataset.state = cls;

  const others = Object.keys(state.presence).filter(u=>u!==state.uid);
  if(people){
    if(!state.bookId) people.innerHTML = '';
    else {
      const names = others.map(u=>state.presence[u].name || 'Reader').slice(0,5);
      people.innerHTML = others.length
        ? `<span class="cloud-avatars">${names.map(n=>`<span class="cloud-avatar" title="${esc(n)}">${esc(n.slice(0,1).toUpperCase())}</span>`).join('')}</span><span>${others.length} other${others.length>1?'s':''} on this book</span>`
        : `<span class="cloud-muted">You\u2019re the only one here right now</span>`;
    }
  }
  const total = D() ? D().chapters.length : 0;
  if(cnt) cnt.textContent = state.bookId ? `${state.cloudDone} / ${total}` : '\u2014';
  if(cnt2) cnt2.textContent = state.pulled ? `${state.pulled} loaded from cloud` : '';
}
function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'); }

/* -------------------------------------------------- Community library */
export async function fetchLibraryIndex(limit=12){
  const db = safeGetDb();
  if(!db) return [];
  try{
    /* No orderByChild here: it silently returns nothing unless the DB has an
       ".indexOn" rule for updatedAt. Fetch the (small) index and sort locally. */
    const snap = await get(ref(db, 'library_index'));
    const v = snap.val() || {};
    return Object.keys(v)
      .map(k=>({id:k, ...v[k]}))
      .filter(x => x && typeof x === 'object' && (x.chapterCount || x.doneCount))
      .sort((a,b)=>(b.updatedAt||0)-(a.updatedAt||0))
      .slice(0, limit);
  }catch(e){ state.lastError = e; return []; }
}
export async function openFromLibrary(bookId){
  const db = safeGetDb(); const dtv = D();
  if(!db || !dtv) return false;
  try{
    const [metaS, chS] = await Promise.all([get(ref(db, `library/${bookId}/meta`)), get(ref(db, `library/${bookId}/chapters`))]);
    const meta = metaS.val() || {}; const ch = chS.val() || {};
    const count = meta.chapterCount || Math.max(...Object.keys(ch).map(Number)) + 1;
    const chapters = [];
    for(let i=0;i<count;i++){
      const v = ch[i];
      chapters.push({ title: v && v.title || `Chapter ${i+1}`, status: v && v.text ? 'done' : 'pending', text: v ? v.text || '' : '', originalText: '', excluded: false });
    }
    const payload = { dtvBackup: 1, savedAt: Date.now(), bookTitle: meta.title || bookId, bookLang: meta.lang || 'en', exportOrder: chapters.map((c,i)=>i), chapters, cloudBookId: bookId, sourceFileName: meta.fileName || '' };
    const file = new File([JSON.stringify(payload)], (meta.fileName || bookId) + '.json', {type:'application/json'});
    dtv.restoreBackupFile(file);
    dtv.showToast(`Opened "${meta.title || bookId}" from the community library`, 'ok');
    return true;
  }catch(e){ state.lastError = e; dtv.showToast('Could not open this book from the library', 'err'); return false; }
}

/* ----------------------------------------------------------------- wire */
function wire(){
  const dtv = D();
  if(!dtv) return;
  window.DTVHooks.shouldDeferChapter = shouldDefer;

  dtv.on('book:loaded', (info)=>{ attachToBook(info || {}); });
  dtv.on('book:reset', ()=>{ detach(); });
  dtv.on('chapter:status', ({i, status})=>{ if(status === 'done') queuePush(i); });
  dtv.on('chapter:claim', ({i})=> claim(i));
  dtv.on('chapter:release', ({i})=> release(i));
  dtv.on('run:end', ()=>{ if(state.presenceRef) update(state.presenceRef, {idx:-1, at: Date.now()}).catch(()=>{}); });

  const toggle = document.getElementById('cloudToggle');
  if(toggle) toggle.addEventListener('change', e=> setCloudEnabled(e.target.checked));
  const nameInput = document.getElementById('cloudName');
  if(nameInput){
    nameInput.value = state.name;
    nameInput.addEventListener('change', e=>{ e.target.value = setDisplayName(e.target.value); dtv.showToast('Display name saved', 'ok', 1500); });
  }
  const pullBtn = document.getElementById('cloudPullBtn');
  if(pullBtn) pullBtn.addEventListener('click', ()=>{ if(dtv.running){ dtv.showToast('Stop the run before re-syncing', 'warn'); return; } attachToBook(); dtv.showToast('Re-syncing with the shared library\u2026', 'info', 1600); });

  renderCloudPanel();
  window.DTVCloud = { state, attachToBook, detach, fetchLibraryIndex, openFromLibrary, setDisplayName, setCloudEnabled, isCloudEnabled, makeBookId };
  dtv.emit('cloud:ready');
}

if(window.DTV) wire();
else document.addEventListener('DOMContentLoaded', ()=>{ if(window.DTV) wire(); }, {once:true});
