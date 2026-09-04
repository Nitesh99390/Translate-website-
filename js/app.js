"use strict";
/* ================================================================
   DOCUMENT TRANSLATION VERIFIER — PRO  ·  main application
   Sections:
   1. State & DOM refs          7. Chapter list (low-RAM render)
   2. Theme / stepper / pill    8. Translate-verify core & main loop
   3. Settings                  9. Editor, Find&Replace, Backup
   4. Toasts / sound / wakelock 10. Exports (Story TXT/ZIP/EPUB/MD/HTML)
   5. Sessions (IndexedDB)      11. Scrolling helpers & UI polish
   6. Parsing (EPUB/PDF/DOCX/TXT)
   ================================================================ */

/* ============ 1. STATE ============ */
let book = null;
let currentFile = null;
let chapters = [];
let currentIdx = -1;          // chapter being processed by the run
let previewIdx = -1;          // chapter shown in the preview (manual)
let running = false;
let paused = false;
let stopRequested = false;
let skipRequested = false;
let exportOrder = [];
let bookLang = 'en';
let sessionKey = null;
let idbAvailable = true;
let consecutiveVerifyFailures = 0;
let verifyMode = 'auto';        // auto | script | latin
let statusFilter = 'all';
let textFilter = '';
let runStartTime = 0;
let runTimer = null;
let chapterDurations = [];
let wakeLock = null;
let exportMode = 'story';
let logLines = 0;
const BASE_TITLE = document.title;
const MAX_LOG_LINES = 150;
const MAX_DURATION_SAMPLES = 40;
const ORIG_SNIPPET = 4000;
const TOPBAR_H = 60;

const el = id => document.getElementById(id);

const fileInput = el('epubFile');
const dropZone = el('dropZone');
const dropOverlay = el('dropOverlay');
const hero = el('hero');
const workspace = el('workspace');
const fileNameShow = el('fileNameShow');
const fileSizeShow = el('fileSizeShow');
const fileExt = el('fileExt');
const mTitle = el('mTitle'), mChapters = el('mChapters'), mStatus = el('mStatus'), mWords = el('mWords');
const targetLang = el('targetLang');
const parseWarnings = el('parseWarnings');
const chapList = el('chapList');
const progFill = el('progFill');
const progText = el('progText');
const progPercent = el('progPercent');
const etaText = el('etaText');
const viewerPanel = el('viewerPanel');
const viewerFrame = el('viewerFrame');
const viewer = el('viewer');
const viewerLabel = el('viewerLabel');
const viewerMeta = el('viewerMeta');
const viewerScrollBar = el('viewerScrollBar');
const liveBadge = el('liveBadge');
const actionPanel = el('actionPanel');
const startBtn = el('startBtn');
const startBtnLabel = el('startBtnLabel');
const pauseBtn = el('pauseBtn');
const pauseBtnLabel = el('pauseBtnLabel');
const skipBtn = el('skipBtn');
const stopBtn = el('stopBtn');
const retryFailedBtn = el('retryFailedBtn');
const runStatusTitle = el('runStatusTitle');
const runStatusSub = el('runStatusSub');
const logBox = el('logBox');
const logDetails = el('logDetails');
const logCount = el('logCount');
const downloadPanel = el('downloadPanel');
const dDone = el('dDone');
const dSkipped = el('dSkipped');
const dWords = el('dWords');
const downloadBtn = el('downloadBtn');
const downloadBtnLabel = el('downloadBtnLabel');
const editorPanel = el('editorPanel');
const editorList = el('editorList');
const exportTabs = el('exportTabs');
const exportNoteText = el('exportNoteText');
const globalBanner = el('globalBanner');
const resumeBanner = el('resumeBanner');
const savedPill = el('savedPill');
const stickyProg = el('stickyProg');
const stickyBar = el('stickyBar');
const rangeFrom = el('rangeFrom');
const rangeTo = el('rangeTo');
const runPill = el('runPill');
const runPillText = el('runPillText');
const ringFg = el('ringFg');
const RING_LEN = 56.5;

/* ============ EVENT BUS (used by pro.js + cloud-sync.js) ============ */
const bus = new EventTarget();
function emit(name, detail){ try{ bus.dispatchEvent(new CustomEvent(name, {detail})); }catch(e){} }
function on(name, fn){ bus.addEventListener(name, e=>fn(e.detail)); }
/* Hooks other modules can override */
window.DTVHooks = window.DTVHooks || {
  transformText: t => t,          // glossary etc.
  shouldDeferChapter: () => false // cloud claims
};

targetLang.addEventListener('change', ()=>{ verifyMode = targetLang.value; saveSettings(); });

/* ============ 2. THEME · STEPPER · RUN PILL ============ */
const THEME_KEY = 'dtv_theme';
const THEMES = ['dark','light','amoled','sepia'];
const THEME_COLORS = {dark:'#0a0d12', light:'#f3f5f9', amoled:'#000000', sepia:'#f4ecd8'};
function applyTheme(t){
  if(!THEMES.includes(t)) t = 'dark';
  document.documentElement.dataset.theme = t;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if(metaTheme) metaTheme.content = THEME_COLORS[t];
  try{ localStorage.setItem(THEME_KEY, t); }catch(e){}
  document.querySelectorAll('[data-theme-pick]').forEach(b=>b.classList.toggle('active', b.dataset.themePick === t));
  emit('theme', t);
}
function toggleTheme(){
  const cur = document.documentElement.dataset.theme || 'dark';
  applyTheme(THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length]);
}
function getTheme(){ return document.documentElement.dataset.theme || 'dark'; }
(function initThemeMenu(){
  const btn = el('themeToggle'), menu = el('themeMenu');
  if(!menu){ btn.addEventListener('click', toggleTheme); return; }
  btn.addEventListener('click', (e)=>{ e.stopPropagation(); menu.classList.toggle('show'); });
  menu.addEventListener('click', (e)=>{
    const pick = e.target.closest('[data-theme-pick]');
    if(pick){ applyTheme(pick.dataset.themePick); menu.classList.remove('show'); }
  });
  document.addEventListener('click', (e)=>{ if(!menu.contains(e.target) && e.target !== btn) menu.classList.remove('show'); });
  applyTheme(getTheme());
})();

function setStep(n){
  document.querySelectorAll('#stepper .step').forEach(s=>{
    const k = parseInt(s.dataset.step, 10);
    s.classList.toggle('is-active', k === n);
    s.classList.toggle('is-done', k < n);
  });
}
function setRunPill(pct, state){
  runPill.classList.add('show');
  runPill.classList.toggle('is-running', state === 'running');
  runPill.classList.toggle('is-done', state === 'done');
  runPillText.textContent = pct + '%';
  ringFg.style.strokeDashoffset = (RING_LEN * (1 - pct/100)).toFixed(2);
}
function setRunStatus(title, sub){
  runStatusTitle.textContent = title;
  if(sub !== undefined) runStatusSub.textContent = sub;
}

/* ============ 3. SETTINGS ============ */
const SETTINGS_KEY = 'dtv_settings_v4';
const settings = {
  timeoutMs: 8000, maxRetries: 2, gapMs: 500,
  scrollMs: 200, sound: 'on', notify: 'on', memSaver: 'on', follow: 'on'
};

function loadSettings(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY) || localStorage.getItem('dtv_settings_v3');
    if(raw){
      const s = JSON.parse(raw);
      if(typeof s.timeoutMs === 'number') settings.timeoutMs = s.timeoutMs;
      if(typeof s.maxRetries === 'number') settings.maxRetries = s.maxRetries;
      if(typeof s.gapMs === 'number') settings.gapMs = s.gapMs;
      if(typeof s.scrollMs === 'number') settings.scrollMs = s.scrollMs;
      if(s.sound) settings.sound = s.sound;
      if(s.notify) settings.notify = s.notify;
      if(s.memSaver) settings.memSaver = s.memSaver;
      if(s.follow) settings.follow = s.follow;
      if(s.verifyMode){ verifyMode = s.verifyMode; targetLang.value = s.verifyMode; }
    }
  }catch(e){}
  el('setTimeout').value = Math.round(settings.timeoutMs/1000);
  el('setRetries').value = settings.maxRetries;
  el('setGap').value = settings.gapMs;
  el('setScroll').value = settings.scrollMs;
  el('setSound').value = settings.sound;
  el('setNotify').value = settings.notify;
  el('setMemSaver').value = settings.memSaver;
  el('setFollow').value = settings.follow;
  refreshSettingLabels();
}
function saveSettings(){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify({...settings, verifyMode})); }catch(e){}
}
function refreshSettingLabels(){
  el('setTimeoutVal').textContent = Math.round(settings.timeoutMs/1000) + 's';
  el('setRetriesVal').textContent = settings.maxRetries;
  el('setGapVal').textContent = (settings.gapMs/1000).toFixed(2).replace(/\.?0+$/,'') + 's';
  el('setScrollVal').textContent = settings.scrollMs + 'ms';
}
el('setTimeout').addEventListener('input', e=>{ settings.timeoutMs = parseInt(e.target.value,10)*1000; refreshSettingLabels(); saveSettings(); });
el('setRetries').addEventListener('input', e=>{ settings.maxRetries = parseInt(e.target.value,10); refreshSettingLabels(); saveSettings(); });
el('setGap').addEventListener('input', e=>{ settings.gapMs = parseInt(e.target.value,10); refreshSettingLabels(); saveSettings(); });
el('setScroll').addEventListener('input', e=>{ settings.scrollMs = parseInt(e.target.value,10); refreshSettingLabels(); saveSettings(); });
el('setSound').addEventListener('change', e=>{ settings.sound = e.target.value; saveSettings(); });
el('setNotify').addEventListener('change', e=>{ settings.notify = e.target.value; saveSettings(); });
el('setMemSaver').addEventListener('change', e=>{ settings.memSaver = e.target.value; saveSettings(); });
el('setFollow').addEventListener('change', e=>{ settings.follow = e.target.value; saveSettings(); });
loadSettings();

function clampRangeInputs(){
  const n = chapters.length || 1;
  let from = parseInt(rangeFrom.value, 10) || 1;
  let to = parseInt(rangeTo.value, 10) || n;
  from = Math.min(Math.max(1, from), n);
  to = Math.min(Math.max(from, to), n);
  rangeFrom.value = from; rangeTo.value = to;
  return {from, to};
}
rangeFrom.addEventListener('change', clampRangeInputs);
rangeTo.addEventListener('change', clampRangeInputs);

/* ============ 4. TOASTS / SOUND / NOTIFY / WAKELOCK ============ */
const toastWrap = el('toastWrap');
function showToast(msg, type='info', ms=2800){
  const icons = {ok:'\u2713', err:'\u2715', info:'i', warn:'!'};
  while(toastWrap.children.length >= 4) toastWrap.firstChild.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span class="t-ic">${icons[type]||'i'}</span><span></span>`;
  t.lastElementChild.textContent = msg;
  toastWrap.appendChild(t);
  setTimeout(()=>{
    t.classList.add('out');
    setTimeout(()=>t.remove(), 320);
  }, ms);
}

function playChime(){
  if(settings.sound !== 'on') return;
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const notes = [523.25, 659.25, 783.99];
    notes.forEach((f, i)=>{
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0, ctx.currentTime + i*0.12);
      g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + i*0.12 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i*0.12 + 0.5);
      o.connect(g); g.connect(ctx.destination);
      o.start(ctx.currentTime + i*0.12);
      o.stop(ctx.currentTime + i*0.12 + 0.55);
    });
    setTimeout(()=>ctx.close().catch(()=>{}), 1500);
  }catch(e){}
}

function requestNotifyPermission(){
  if(settings.notify !== 'on' || !('Notification' in window)) return;
  if(Notification.permission === 'default'){
    try{ Notification.requestPermission().catch(()=>{}); }catch(e){}
  }
}
function notifyDone(msg){
  if(settings.notify !== 'on' || !('Notification' in window)) return;
  if(document.visibilityState === 'visible') return;
  if(Notification.permission === 'granted'){
    try{
      const n = new Notification('Translation run finished', {body: msg, tag:'dtv-done'});
      n.onclick = ()=>{ window.focus(); n.close(); };
    }catch(e){}
  }
}

async function acquireWakeLock(){
  if(!('wakeLock' in navigator)) return;
  try{
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', ()=>{ wakeLock = null; });
  }catch(e){}
}
function releaseWakeLock(){
  if(wakeLock){ try{ wakeLock.release(); }catch(e){} wakeLock = null; }
}
document.addEventListener('visibilitychange', ()=>{
  if(running && document.visibilityState === 'visible' && !wakeLock) acquireWakeLock();
});

/* ============ GLOBAL BANNER ============ */
function showBanner(node, {level='error', title, message, detail, actions=[]}){
  node.className = 'global-banner show ' + level;
  const actionsHtml = actions.length
    ? `<div class="banner-actions">${actions.map(a=>`<button class="banner-btn ${a.primary?'primary':''}" data-banner-action="${a.id}">${escapeHtml(a.label)}</button>`).join('')}</div>`
    : '';
  const detailHtml = detail
    ? `<details class="banner-detail"><summary>Technical detail</summary>${escapeHtml(detail)}</details>`
    : '';
  node.innerHTML = `
    <div class="global-banner-head">
      <span>${escapeHtml(title)}</span>
      <button class="banner-dismiss" data-banner-dismiss="1" aria-label="Dismiss">\u2715</button>
    </div>
    <div>${escapeHtml(message)}</div>
    ${detailHtml}
    ${actionsHtml}
  `;
  node._actionHandlers = {};
  actions.forEach(a => node._actionHandlers[a.id] = a.onClick);
  if(node === globalBanner || node === resumeBanner) ensureInView(node);
}
function hideBanner(node){ node.classList.remove('show'); node.innerHTML = ''; }

document.addEventListener('click', (e)=>{
  const dismissBtn = e.target.closest('[data-banner-dismiss]');
  if(dismissBtn){ hideBanner(dismissBtn.closest('.global-banner')); return; }
  const actionBtn = e.target.closest('[data-banner-action]');
  if(actionBtn){
    const node = actionBtn.closest('.global-banner');
    const id = actionBtn.dataset.bannerAction;
    if(node._actionHandlers && node._actionHandlers[id]) node._actionHandlers[id]();
  }
});

function showGlobalError(title, message, detail){ showBanner(globalBanner, {level:'error', title, message, detail}); }
function showGlobalWarning(title, message, detail){ showBanner(globalBanner, {level:'warn', title, message, detail}); }

/* ============ CRASH HANDLING ============ */
window.addEventListener('error', (e)=>{
  showGlobalError(
    'Something went wrong',
    'An unexpected error occurred. You can keep using the tool, but this action may not have completed — check the chapter list and log before continuing.',
    (e.error && e.error.stack) ? e.error.stack : e.message
  );
});
window.addEventListener('unhandledrejection', (e)=>{
  showGlobalError(
    'Something went wrong',
    'An unexpected error occurred in a background operation. You can keep using the tool, but check whether the last action completed correctly.',
    e.reason && e.reason.stack ? e.reason.stack : String(e.reason)
  );
});
window.addEventListener('beforeunload', (e)=>{
  if(running){ e.preventDefault(); e.returnValue = ''; }
});

/* ============ STARTUP DEPENDENCY CHECK ============ */
const LIB_STATUS = {
  jszip:   typeof JSZip !== 'undefined',
  epub:    typeof ePub !== 'undefined',
  pdf:     typeof pdfjsLib !== 'undefined',
  mammoth: typeof mammoth !== 'undefined',
};
function checkStartupDependencies(){
  const missingLabels = [];
  if(!LIB_STATUS.jszip)   missingLabels.push('JSZip — needed for ZIP and EPUB export');
  if(!LIB_STATUS.epub)    missingLabels.push('epub.js — needed to read .epub files');
  if(!LIB_STATUS.pdf)     missingLabels.push('PDF.js — needed to read .pdf files');
  if(!LIB_STATUS.mammoth) missingLabels.push('Mammoth.js — needed to read .docx files');
  if(missingLabels.length){
    showGlobalWarning(
      'Some features may not work',
      'The following components failed to load from their CDN, usually caused by an ad-blocker, offline connection, or restrictive network: ' + missingLabels.join('; ') + '. Formats that don\u2019t depend on the missing component will still work — reload the page after checking your connection to restore full functionality.'
    );
  }
}
checkStartupDependencies();

function requireLib(globalCheck, formatLabel){
  if(!globalCheck){
    setStatus(`Error: cannot read ${formatLabel} — a required component failed to load (see warning above). Try reloading the page.`);
    return false;
  }
  return true;
}

/* ============ 5. INDEXEDDB SESSIONS ============ */
const IDB_NAME = 'docTranslatorDB';
const IDB_STORE = 'sessions';
let idbHandle = null;

function idbOpen(){
  return new Promise((resolve, reject)=>{
    if(!('indexedDB' in window)){ reject(new Error('IndexedDB not supported')); return; }
    let req;
    try { req = indexedDB.open(IDB_NAME, 1); }
    catch(err){ reject(err); return; }
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(IDB_STORE, {keyPath:'key'}); };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}
async function idbGetHandle(){
  if(idbHandle) return idbHandle;
  idbHandle = await idbOpen();
  return idbHandle;
}
async function idbGet(key){
  try{
    const db = await idbGetHandle();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(IDB_STORE, 'readonly');
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = ()=> resolve(req.result || null);
      req.onerror = ()=> reject(req.error);
    });
  }catch(err){ idbAvailable = false; return null; }
}
async function idbPut(value){
  try{
    const db = await idbGetHandle();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> reject(tx.error);
    });
  }catch(err){ idbAvailable = false; return false; }
}
async function idbDelete(key){
  try{
    const db = await idbGetHandle();
    return await new Promise((resolve, reject)=>{
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(key);
      tx.oncomplete = ()=> resolve(true);
      tx.onerror = ()=> reject(tx.error);
    });
  }catch(err){ return false; }
}

function computeSessionKey(fileName, fileSize, chapterCount){
  return `${fileName}::${fileSize}::${chapterCount}`;
}

function buildSessionPayload(){
  return {
    key: sessionKey,
    savedAt: Date.now(),
    bookTitle: mTitle.textContent,
    bookLang,
    exportOrder,
    chapters: chapters.map(c=>({
      title: c.title, status: c.status, text: c.text,
      originalText: c.originalText || '', retries: c.retries, excluded: !!c.excluded,
      note: c.note || '', flag: !!c.flag, durMs: c.durMs || 0, doneAt: c.doneAt || 0
    }))
  };
}

let saveInFlight = false;
let savePending = false;
let savedPillTimer = null;
let saveDebounce = null;

function saveSessionProgress(){
  if(!sessionKey || !idbAvailable) return;
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(doSave, 600);
}
async function doSave(){
  if(!sessionKey || !idbAvailable) return;
  if(saveInFlight){ savePending = true; return; }
  saveInFlight = true;
  try{
    const ok = await idbPut(buildSessionPayload());
    if(ok){
      savedPill.classList.add('flash');
      clearTimeout(savedPillTimer);
      savedPillTimer = setTimeout(()=>savedPill.classList.remove('flash'), 1400);
    }
  } finally {
    saveInFlight = false;
    if(savePending){ savePending = false; doSave(); }
  }
}
async function clearSessionProgress(){
  if(!sessionKey) return;
  await idbDelete(sessionKey);
}

async function checkForResumableSession(bookTitle, fileSize, chapterCount){
  sessionKey = computeSessionKey(bookTitle, fileSize, chapterCount);
  if(!idbAvailable) return;
  const saved = await idbGet(sessionKey);
  if(!saved || !saved.chapters || saved.chapters.length !== chapters.length) return;
  const doneCount = saved.chapters.filter(c=>c.status==='done' && c.text && c.text.trim()).length;
  if(doneCount === 0) return;
  showBanner(resumeBanner, {
    level: 'info',
    title: 'Saved progress found',
    message: `A previous session for this file has ${doneCount} of ${saved.chapters.length} chapters already translated (saved ${new Date(saved.savedAt).toLocaleString()}).`,
    actions: [
      { id:'resume', label:'Resume', primary:true, onClick: ()=>applyResumedSession(saved) },
      { id:'discard', label:'Start Fresh', onClick: ()=>{ clearSessionProgress(); hideBanner(resumeBanner); showToast('Previous session discarded', 'info'); } }
    ]
  });
}

function applyResumedSession(saved){
  saved.chapters.forEach((sc, i)=>{
    if(!chapters[i]) return;
    chapters[i].status = sc.status;
    setText(chapters[i], sc.text || '');
    chapters[i].originalText = sc.originalText;
    chapters[i].retries = sc.retries || 0;
    chapters[i].excluded = !!sc.excluded;
    chapters[i].note = sc.note || '';
    chapters[i].flag = !!sc.flag;
    chapters[i].durMs = sc.durMs || 0;
    chapters[i].doneAt = sc.doneAt || 0;
    if(sc.title) chapters[i].title = sc.title;
  });
  if(Array.isArray(saved.exportOrder) && saved.exportOrder.length === chapters.length){
    exportOrder = saved.exportOrder.slice();
  }
  renderChapterList();
  requestProgressUpdate();
  hideBanner(resumeBanner);
  refreshDownloadSummary();
  showToast('Progress restored — continue from where you left off', 'ok');
}

/* ============ 6. FILE UPLOAD & PARSING ============ */
fileInput.addEventListener('change', function(e){
  const file = e.target.files[0];
  if(file) handleFile(file);
});
el('changeFileBtn').addEventListener('click', ()=>{
  if(running){ showToast('Stop the current run before loading another file', 'warn'); return; }
  fileInput.value = '';
  fileInput.click();
});

/* hero drop zone */
['dragenter','dragover'].forEach(ev=>{
  dropZone.addEventListener(ev, (e)=>{ e.preventDefault(); dropZone.classList.add('dragover'); });
});
['dragleave','drop'].forEach(ev=>{
  dropZone.addEventListener(ev, (e)=>{ e.preventDefault(); dropZone.classList.remove('dragover'); });
});
dropZone.addEventListener('drop', (e)=>{
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if(file){ fileInput.value = ''; handleFile(file); }
});

/* whole-window drag & drop overlay */
let dragDepth = 0;
function hasFiles(e){ return e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files'); }
document.addEventListener('dragenter', (e)=>{
  if(!hasFiles(e) || running) return;
  e.preventDefault();
  dragDepth++;
  dropOverlay.classList.add('show');
});
document.addEventListener('dragover', (e)=>{ if(hasFiles(e)) e.preventDefault(); });
document.addEventListener('dragleave', (e)=>{
  if(!hasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if(dragDepth === 0) dropOverlay.classList.remove('show');
});
document.addEventListener('drop', (e)=>{
  if(!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  dropOverlay.classList.remove('show');
  if(running){ showToast('Stop the current run before loading another file', 'warn'); return; }
  if(e.target.closest && e.target.closest('#dropZone')) return; // hero zone handles its own drop
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if(file){ fileInput.value = ''; handleFile(file); }
});

function setStatus(text, busy=false){
  mStatus.textContent = text;
  mStatus.classList.toggle('is-busy', !!busy);
}

function showWorkspace(){
  if(!hero.classList.contains('hidden')){
    hero.classList.add('leaving');
    setTimeout(()=>{ hero.classList.add('hidden'); hero.classList.remove('leaving'); }, 260);
  }
  workspace.classList.add('show');
  document.body.classList.add('has-runbar-mobile', 'has-book');
  window.scrollTo({top:0, behavior:'auto'});
}
function showHero(){
  if(running){ showToast('Stop the current run first', 'warn'); return; }
  workspace.classList.remove('show');
  hero.classList.remove('hidden');
  document.body.classList.remove('has-runbar-mobile', 'has-book');
  setStep(1);
  window.scrollTo({top:0, behavior:'auto'});
}

function resetForNewFile(file){
  currentFile = file;
  if(book && book.destroy){ try{ book.destroy(); }catch(e){} }
  book = null;
  chapters = [];
  currentIdx = -1;
  previewIdx = -1;
  exportOrder = [];
  consecutiveVerifyFailures = 0;
  chapterDurations = [];
  document.title = BASE_TITLE;

  const ext = file ? (file.name.split('.').pop() || '').toLowerCase() : 'json';
  fileExt.textContent = ext.toUpperCase().slice(0,4);
  fileExt.dataset.ext = ext;
  fileNameShow.textContent = file ? file.name : 'Restored from backup';
  fileSizeShow.textContent = file ? formatBytes(file.size) : '';

  setStatus('Extracting\u2026', true);
  mTitle.textContent = '—';
  mChapters.textContent = '—';
  mWords.textContent = '—';
  parseWarnings.classList.remove('show');
  parseWarnings.innerHTML = '';
  hideBanner(resumeBanner);
  hideBanner(globalBanner);
  editorPanel.style.display = 'none';
  downloadPanel.style.display = 'none';
  retryFailedBtn.style.display = 'none';
  startBtn.disabled = true;
  startBtnLabel.textContent = 'Start Verified Translation';
  setRunStatus('Preparing\u2026', 'Reading the document');
  viewer.innerHTML = '<div class="ph">Click a chapter to preview it, or start the run to watch live</div>';
  viewerLabel.textContent = '';
  viewerMeta.textContent = '';
  liveBadge.classList.remove('on');
  viewerFrame.classList.remove('live');
  logBox.innerHTML = '<div class="log-empty">No activity yet.</div>';
  logLines = 0; logCount.textContent = '';
  chapList.innerHTML = '';
  editorList.innerHTML = '';
  el('chapFilter').value = '';
  textFilter = '';
  statusFilter = 'all';
  document.querySelectorAll('#statusFilters .filter-btn').forEach(b=>b.classList.toggle('active', b.dataset.f==='all'));
  el('jumpActiveBtn').disabled = true;
  setStep(1);
  workspace.classList.add('is-loading');
  chapList.innerHTML = '<div class="skeleton-list">' + '<div class="skel-row"></div>'.repeat(8) + '</div>';
  showWorkspace();
  emit('book:reset', {file});
}

function handleFile(file){
  resetForNewFile(file);
  const ext = file.name.split('.').pop().toLowerCase();
  if(ext === 'epub') return parseEpubFile(file);
  if(ext === 'pdf') return parsePdfFile(file);
  if(ext === 'docx') return parseDocxFile(file);
  if(ext === 'txt') return parseTxtFile(file);
  setStatus('Error: unsupported file type (.' + ext + ')');
  setRunStatus('Unsupported file', 'Load an .epub, .pdf, .docx or .txt');
  showGlobalWarning('Unsupported file', 'This tool only reads .epub, .pdf, .docx and .txt files. The file you selected has a .' + ext + ' extension.');
}

function formatBytes(b){
  if(b < 1024) return b + ' B';
  if(b < 1048576) return (b/1024).toFixed(1) + ' KB';
  return (b/1048576).toFixed(1) + ' MB';
}
function formatNum(n){ return n.toLocaleString('en-US'); }
function wordCount(s){
  const t = (s||'').trim();
  return t ? t.split(/\s+/).length : 0;
}
/* keep a cached word count so progress updates stay O(chapters), not O(words) */
function setText(c, text){
  c.text = text || '';
  c.wc = wordCount(c.text);
}

function estimateSourceWords(){
  let total = 0, counted = 0;
  const tmp = document.createElement('div');
  chapters.forEach(c=>{
    if(c.html){
      tmp.innerHTML = c.html;
      total += wordCount(tmp.textContent);
      counted++;
    }
  });
  tmp.innerHTML = '';
  if(counted === 0) return null;
  if(counted < chapters.length){
    total = Math.round(total / counted * chapters.length);
    return '~' + formatNum(total);
  }
  return formatNum(total);
}

function finishLoadingChapters(bookTitle, lang){
  mTitle.textContent = bookTitle;
  mTitle.title = bookTitle;
  bookLang = lang || 'en';
  mChapters.textContent = chapters.length;

  if(chapters.length === 0){
    workspace.classList.remove('is-loading');
    chapList.innerHTML = '';
    setStatus('Error: no readable content found');
    setRunStatus('Nothing to translate', 'No readable text was found in this file');
    startBtn.disabled = true;
    showGlobalWarning(
      'No content extracted',
      'The file loaded without a technical error, but no chapters or readable text could be found. This can happen with a scanned/image-only PDF, an empty document, or a file that\u2019s corrupted despite having the right extension.'
    );
    return;
  }

  const est = estimateSourceWords();
  mWords.textContent = est || '—';
  setStatus('Ready');
  workspace.classList.remove('is-loading');
  exportOrder = chapters.map((c,i)=>i);
  rangeFrom.max = chapters.length; rangeTo.max = chapters.length;
  rangeFrom.value = 1; rangeTo.value = chapters.length;
  renderChapterList();
  startBtn.disabled = false;
  setRunStatus('Ready to translate', `${chapters.length} chapter${chapters.length>1?'s':''} · enable Chrome translate, then press Start (or S)`);
  setStep(2);
  setRunPill(0, 'idle');
  requestProgressUpdate();
  showToast(`Loaded ${chapters.length} chapter${chapters.length>1?'s':''}`, 'ok');
  previewChapter(0, {scroll:false});

  const fileSize = currentFile ? currentFile.size : 0;
  checkForResumableSession(bookTitle, fileSize, chapters.length);
  emit('book:loaded', {title: bookTitle, fileName: currentFile ? currentFile.name : '', fileSize, count: chapters.length, lang: bookLang});
}

/* ---- EPUB ---- */
function parseEpubFile(file){
  if(!requireLib(LIB_STATUS.epub, '.epub files')) return;
  const reader = new FileReader();
  reader.onerror = ()=>{ setStatus('Error: could not read the file from disk (' + (reader.error ? reader.error.message : 'unknown reason') + ')'); };
  reader.onload = async function(event){
    try{
      book = ePub(event.target.result);
      await book.ready;
      const nav = await book.loaded.navigation.catch(()=>null);
      const metadata = await book.loaded.metadata.catch(()=>({}));
      await book.loaded.spine;

      chapters = [];
      let skippedCount = 0;
      const spineArr = (book.spine && Array.isArray(book.spine.spineItems)) ? book.spine.spineItems : null;
      const spineLen = spineArr ? spineArr.length : (book.spine.length || 0);

      for(let i=0; i<spineLen; i++){
        try{
          const item = spineArr ? spineArr[i] : book.spine.get(i);
          if(!item){ skippedCount++; continue; }
          let chapTitle = 'Chapter ' + (i+1);
          if(nav && nav.toc){
            const match = findNavMatch(nav.toc, item.href);
            if(match) chapTitle = match;
          }
          chapters.push({ index: i, title: chapTitle, item: item, html: null, status: 'pending', text: '', wc: 0, originalText: '', retries: 0, excluded: false });
        }catch(chapErr){ skippedCount++; }
      }
      if(skippedCount > 0){
        showParseWarning(`${skippedCount} chapter${skippedCount>1?'s':''} could not be read and ${skippedCount>1?'were':'was'} skipped. The rest of the book loaded normally.`);
      }
      finishLoadingChapters(metadata.title || file.name.replace(/\.epub$/i,''), metadata.language);
    }catch(err){
      const friendly = /zip|central directory|corrupt/i.test(err.message||'')
        ? 'This doesn\u2019t look like a valid EPUB file — it may be corrupted or not actually an EPUB despite the extension.'
        : 'Could not open this EPUB file.';
      setStatus('Error: ' + friendly);
      setRunStatus('Could not read file', friendly);
      showGlobalError('Could not read EPUB', friendly, (err.message||'') + (err.stack ? '\n' + err.stack : ''));
    }
  };
  reader.readAsArrayBuffer(file);
}

function findNavMatch(tocArr, href){
  if(!href) return null;
  for(const entry of tocArr){
    if(entry.href && entry.href.split('#')[0] === href.split('#')[0]){
      return entry.label ? entry.label.trim() : null;
    }
    if(entry.subitems && entry.subitems.length){
      const r = findNavMatch(entry.subitems, href);
      if(r) return r;
    }
  }
  return null;
}

function showParseWarning(msg){
  parseWarnings.classList.add('show');
  parseWarnings.innerHTML = `<div class="global-banner-head"><span>Heads up</span></div><div>${escapeHtml(msg)}</div>`;
}

/* ---- PDF ---- */
function parsePdfFile(file){
  if(!requireLib(LIB_STATUS.pdf, '.pdf files')) return;
  const reader = new FileReader();
  reader.onerror = ()=>{ setStatus('Error: could not read the file from disk (' + (reader.error ? reader.error.message : 'unknown reason') + ')'); };
  reader.onload = async function(event){
    let pdf = null;
    try{
      const pdfVersion = pdfjsLib.version || '3.11.174';
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfVersion}/pdf.worker.min.js`;
      try{
        pdf = await pdfjsLib.getDocument({data: event.target.result}).promise;
      }catch(loadErr){
        if(loadErr && loadErr.name === 'PasswordException'){
          setStatus('Error: this PDF is password-protected');
          showGlobalError('Password-protected PDF', 'This tool reads PDFs directly in the browser and has no way to prompt for a password. Remove the password (many PDF readers offer "print to PDF" or "export without password") and upload again.');
          return;
        }
        throw loadErr;
      }

      chapters = [];
      let emptyPageCount = 0;
      let failedPageCount = 0;
      for(let p=1; p<=pdf.numPages; p++){
        try{
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          const rawLines = groupPdfTextIntoLines(content.items);
          const paragraphs = guessParagraphs(rawLines);
          const pageText = paragraphs.join(' ');
          const html = paragraphs.map(par=>`<p>${escapeHtml(par)}</p>`).join('\n');
          if(pageText.trim().length < 3) emptyPageCount++;
          chapters.push({ index: p-1, title: 'Page ' + p, item: null, html: html || '<p></p>', status: 'pending', text: '', wc: 0, originalText: '', retries: 0, excluded: false });
          if(page.cleanup) try{ page.cleanup(); }catch(e){}
        }catch(pageErr){ failedPageCount++; }
        if(p % 25 === 0) setStatus(`Extracting\u2026 page ${p}/${pdf.numPages}`, true);
      }
      if(pdf.numPages > 0 && emptyPageCount / pdf.numPages > 0.6){
        showParseWarning(`${emptyPageCount} of ${pdf.numPages} pages had little or no extractable text. This usually means the PDF is scanned images rather than real text — this tool can\u2019t OCR it, so those pages will translate as empty.`);
      }
      if(failedPageCount > 0){
        showParseWarning(`${failedPageCount} page${failedPageCount>1?'s':''} could not be read and ${failedPageCount>1?'were':'was'} skipped.`);
      }
      finishLoadingChapters(file.name.replace(/\.pdf$/i,''), 'en');
    }catch(err){
      setStatus('Error: could not read this PDF');
      setRunStatus('Could not read file', 'The PDF could not be parsed');
      showGlobalError('Could not read PDF', 'This file could not be parsed as a PDF — it may be corrupted or not a valid PDF despite the extension.', (err.message||'') + (err.stack ? '\n' + err.stack : ''));
    }finally{
      if(pdf && pdf.destroy){ try{ pdf.destroy(); }catch(e){} }
    }
  };
  reader.readAsArrayBuffer(file);
}

function groupPdfTextIntoLines(items){
  const lines = [];
  let currentY = null;
  let currentLine = [];
  items.forEach(item=>{
    if(!item.transform) return;
    const y = Math.round(item.transform[5]);
    if(currentY === null || Math.abs(y - currentY) > 2){
      if(currentLine.length) lines.push(currentLine.join(''));
      currentLine = [item.str];
      currentY = y;
    } else {
      currentLine.push(item.str);
    }
  });
  if(currentLine.length) lines.push(currentLine.join(''));
  return lines.filter(l=>l.trim().length>0);
}

function guessParagraphs(lines){
  const paragraphs = [];
  let buf = '';
  lines.forEach(line=>{
    const trimmed = line.trim();
    const endsSentence = /[.!?"')\u0964]$/.test(buf.trim());
    const looksLikeNewPara = buf && endsSentence && /^[A-Z"'(]/.test(trimmed) && buf.trim().length < 90;
    if(looksLikeNewPara){ paragraphs.push(buf.trim()); buf = trimmed; }
    else { buf = buf ? buf + ' ' + trimmed : trimmed; }
  });
  if(buf.trim()) paragraphs.push(buf.trim());
  return paragraphs;
}

/* ---- DOCX ---- */
function parseDocxFile(file){
  if(!requireLib(LIB_STATUS.mammoth, '.docx files')) return;
  const reader = new FileReader();
  reader.onerror = ()=>{ setStatus('Error: could not read the file from disk (' + (reader.error ? reader.error.message : 'unknown reason') + ')'); };
  reader.onload = async function(event){
    try{
      const result = await mammoth.convertToHtml({arrayBuffer: event.target.result});
      const container = document.createElement('div');
      container.innerHTML = result.value;
      const sections = splitHtmlOnHeadings(container);
      container.innerHTML = '';
      chapters = sections.map((sec, i)=>({ index: i, title: sec.title || ('Section ' + (i+1)), item: null, html: sec.html, status: 'pending', text: '', wc: 0, originalText: '', retries: 0, excluded: false }));
      if(result.messages && result.messages.length){
        const warningMsgs = result.messages.filter(m=>m.type==='warning');
        if(warningMsgs.length){
          const preview = warningMsgs.slice(0,3).map(m=>m.message).join('; ');
          const more = warningMsgs.length > 3 ? ` (+${warningMsgs.length-3} more)` : '';
          showParseWarning(`Some formatting couldn\u2019t be fully preserved during conversion: ${preview}${more}. This affects layout only, not the text content.`);
        }
      }
      finishLoadingChapters(file.name.replace(/\.docx$/i,''), 'en');
    }catch(err){
      const friendly = /central directory|zip|not a valid/i.test(err.message||'')
        ? 'This doesn\u2019t look like a valid .docx file — if this was saved from an older Word (.doc) format, re-save it as .docx first.'
        : 'Could not convert this document.';
      setStatus('Error: ' + friendly);
      setRunStatus('Could not read file', friendly);
      showGlobalError('Could not read DOCX', friendly, (err.message||'') + (err.stack ? '\n' + err.stack : ''));
    }
  };
  reader.readAsArrayBuffer(file);
}

function splitHtmlOnHeadings(container){
  const nodes = Array.from(container.childNodes);
  const headingTags = new Set(['H1','H2']);
  const hasHeadings = nodes.some(n=>n.nodeType===1 && headingTags.has(n.tagName));
  if(!hasHeadings) return [{ title: null, html: container.innerHTML }];
  const sections = [];
  let currentTitle = null;
  let currentNodes = [];
  function flush(){
    if(currentNodes.length){
      sections.push({ title: currentTitle, html: currentNodes.map(n=>n.outerHTML || escapeHtml(n.textContent)).join('\n') });
    }
    currentNodes = [];
  }
  nodes.forEach(n=>{
    if(n.nodeType===1 && headingTags.has(n.tagName)){ flush(); currentTitle = n.textContent.trim(); currentNodes = [n]; }
    else { currentNodes.push(n); }
  });
  flush();
  return sections.filter(s=>s.html && s.html.trim().length>0);
}

/* ---- TXT ---- */
function parseTxtFile(file){
  const reader = new FileReader();
  reader.onerror = ()=>{ setStatus('Error: could not read the file from disk (' + (reader.error ? reader.error.message : 'unknown reason') + ')'); };
  reader.onload = function(event){
    try{
      const text = event.target.result;
      if(!text || !text.trim()){ chapters = []; finishLoadingChapters(file.name.replace(/\.txt$/i,''), 'en'); return; }
      let paragraphs = text.split(/\n{2,}/).map(p=>p.trim()).filter(p=>p.length>0);
      const MAX_SINGLE_PARA = 4000;
      paragraphs = paragraphs.flatMap(p=>{
        if(p.length <= MAX_SINGLE_PARA) return [p];
        const sentences = p.match(/[^.!?\u0964]+[.!?\u0964]+(\s|$)/g);
        const units = sentences || (p.match(/\S+\s*/g) || [p]);
        const rebuilt = [];
        let buf = '';
        units.forEach(u=>{
          if(buf.length + u.length > MAX_SINGLE_PARA && buf){ rebuilt.push(buf.trim()); buf = ''; }
          buf += u;
        });
        if(buf.trim()) rebuilt.push(buf.trim());
        return rebuilt.length ? rebuilt : [p];
      });
      const CHUNK_CHARS = 3000;
      const chunks = [];
      let buf = [];
      let bufLen = 0;
      paragraphs.forEach(p=>{
        buf.push(p); bufLen += p.length;
        if(bufLen >= CHUNK_CHARS){ chunks.push(buf); buf = []; bufLen = 0; }
      });
      if(buf.length) chunks.push(buf);
      chapters = chunks.map((chunkParas, i)=>({ index: i, title: 'Part ' + (i+1), item: null, html: chunkParas.map(p=>`<p>${escapeHtml(p)}</p>`).join('\n'), status: 'pending', text: '', wc: 0, originalText: '', retries: 0, excluded: false }));
      finishLoadingChapters(file.name.replace(/\.txt$/i,''), 'en');
    }catch(err){
      setStatus('Error: could not read this text file');
      showGlobalError('Could not read TXT', 'This file could not be processed as plain text.', (err.message||'') + (err.stack ? '\n' + err.stack : ''));
    }
  };
  reader.readAsText(file);
}

/* ============ 7. CHAPTER LIST (low-RAM render) ============ */
function renderChapterList(){
  chapList.innerHTML = '';
  const frag = document.createDocumentFragment();
  chapters.forEach((c, i)=>{
    const wrap = document.createElement('div');
    wrap.className = 'chap-item-wrap';
    wrap.id = 'chap-wrap-'+i;
    const row = document.createElement('div');
    row.className = 'chap-item' + (i===currentIdx ? ' active' : '') + (i===previewIdx && !running ? ' is-preview' : '');
    row.id = 'chap-row-'+i;
    row.dataset.idx = i;
    row.setAttribute('role','listitem');
    row.tabIndex = 0;
    row.innerHTML = `
      <input type="checkbox" class="chap-check" data-idx="${i}" aria-label="Select chapter" ${selectedChapters.has(i)?'checked':''}>
      <span class="chap-idx">${String(i+1).padStart(2,'0')}</span>
      <span class="chap-name" title="${escapeAttr(c.title)}">${escapeHtml(c.title)}</span>
      <span class="chap-marks" id="chap-marks-${i}">${chapterMarksHtml(c)}</span>
      <span class="chap-cloud" id="chap-cloud-${i}" title="Synced from shared library" ${c.fromCloud?'':'hidden'}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 .4-9A7 7 0 0 0 4 12.5 4.5 4.5 0 0 0 6.5 19z"/></svg></span>
      <span class="chap-status ${statusClass(c.status)}" id="chap-status-${i}">${statusLabel(c.status)}</span>
      <button class="compare-toggle" data-idx="${i}" id="compare-toggle-${i}" style="display:none;">Compare</button>
    `;
    const panel = document.createElement('div');
    panel.className = 'compare-panel';
    panel.id = 'compare-panel-'+i;
    wrap.appendChild(row);
    wrap.appendChild(panel);
    frag.appendChild(wrap);
    if(c.status === 'done' || c.status === 'unverified'){
      const t = row.querySelector('.compare-toggle');
      if(t && (c.originalText || c.text)) t.style.display = 'inline-block';
    }
  });
  chapList.appendChild(frag);
  applyChapterFilters();
  updateBulkBar();
}

/* ---- Notes / flags on chapters ---- */
function chapterMarksHtml(c){
  let h = '';
  if(c.flag) h += `<span class="chap-flag" title="Flagged">\u2691</span>`;
  if(c.note) h += `<span class="chap-note" title="${escapeAttr(c.note)}">\u270E</span>`;
  return h;
}
function refreshChapterMarks(i){
  const m = el('chap-marks-'+i);
  if(m) m.innerHTML = chapterMarksHtml(chapters[i]);
}
function setChapterNote(i, note){
  if(!chapters[i]) return;
  chapters[i].note = (note||'').trim();
  refreshChapterMarks(i);
  saveSessionProgress();
  emit('chapter:meta', {i});
}
function toggleChapterFlag(i){
  if(!chapters[i]) return;
  chapters[i].flag = !chapters[i].flag;
  refreshChapterMarks(i);
  saveSessionProgress();
  emit('chapter:meta', {i});
  return chapters[i].flag;
}

/* ---- Bulk selection ---- */
const selectedChapters = new Set();
function updateBulkBar(){
  const bar = el('bulkBar');
  if(!bar) return;
  const n = selectedChapters.size;
  bar.classList.toggle('show', n > 0);
  const cnt = el('bulkCount'); if(cnt) cnt.textContent = n + ' selected';
  chapList.classList.toggle('has-selection', n > 0);
}
function clearSelection(){
  selectedChapters.clear();
  chapList.querySelectorAll('.chap-check:checked').forEach(cb=>cb.checked=false);
  updateBulkBar();
}
function bulkApply(act){
  if(running && act !== 'flag' && act !== 'select-visible'){ showToast('Stop the run before bulk-editing chapters', 'warn'); return; }
  const ids = [...selectedChapters];
  if(act === 'skip'){ ids.forEach(i=>{ if(chapters[i].status!=='done'){ chapters[i].bulkSkipped = true; setChapterStatus(i,'skipped'); } }); }
  else if(act === 'pending'){ ids.forEach(i=>{ chapters[i].bulkSkipped = false; chapters[i].retries = 0; setChapterStatus(i,'pending'); }); }
  else if(act === 'exclude'){ ids.forEach(i=>{ chapters[i].excluded = true; }); renderEditorList(); saveSessionProgress(); }
  else if(act === 'include'){ ids.forEach(i=>{ chapters[i].excluded = false; }); renderEditorList(); saveSessionProgress(); }
  else if(act === 'flag'){ ids.forEach(i=>{ chapters[i].flag = !chapters[i].flag; refreshChapterMarks(i); }); saveSessionProgress(); }
  showToast(`${ids.length} chapter${ids.length>1?'s':''} updated`, 'ok', 1600);
  requestProgressUpdate();
  clearSelection();
}
chapList.addEventListener('change', (e)=>{
  const cb = e.target.closest('.chap-check');
  if(!cb) return;
  const i = parseInt(cb.dataset.idx, 10);
  if(cb.checked) selectedChapters.add(i); else selectedChapters.delete(i);
  updateBulkBar();
});
(function initBulkBar(){
  const bar = el('bulkBar'); if(!bar) return;
  bar.addEventListener('click', (e)=>{
    const b = e.target.closest('[data-bulk]'); if(!b) return;
    const act = b.dataset.bulk;
    if(act === 'clear') return clearSelection();
    if(act === 'all'){ chapters.forEach((c,i)=>{ if(rowVisible(c)){ selectedChapters.add(i); const cb = chapList.querySelector(`.chap-check[data-idx="${i}"]`); if(cb) cb.checked = true; } }); updateBulkBar(); return; }
    bulkApply(act);
  });
})();

let filterDebounce = null;
el('chapFilter').addEventListener('input', (e)=>{
  clearTimeout(filterDebounce);
  filterDebounce = setTimeout(()=>{
    textFilter = e.target.value.trim().toLowerCase();
    applyChapterFilters();
  }, 120);
});
el('statusFilters').addEventListener('click', (e)=>{
  const btn = e.target.closest('.filter-btn');
  if(!btn) return;
  statusFilter = btn.dataset.f;
  document.querySelectorAll('#statusFilters .filter-btn').forEach(b=>b.classList.toggle('active', b===btn));
  applyChapterFilters();
});

function matchesStatusFilter(c){
  if(statusFilter === 'all') return true;
  if(statusFilter === 'pending') return c.status === 'pending' || c.status === 'active' || c.status === 'retry';
  if(statusFilter === 'done') return c.status === 'done';
  if(statusFilter === 'issues') return c.status === 'unverified' || c.status === 'skipped';
  if(statusFilter === 'flagged') return !!c.flag || !!c.note;
  return true;
}
function rowVisible(c){
  const textOk = !textFilter || c.title.toLowerCase().includes(textFilter);
  return textOk && matchesStatusFilter(c);
}
function applyFilterToRow(i){
  const wrap = el('chap-wrap-'+i);
  if(wrap) wrap.classList.toggle('hidden', !rowVisible(chapters[i]));
}
function applyChapterFilters(){
  let visible = 0;
  chapters.forEach((c, i)=>{
    const wrap = el('chap-wrap-'+i);
    if(!wrap) return;
    const ok = rowVisible(c);
    wrap.classList.toggle('hidden', !ok);
    if(ok) visible++;
  });
  let empty = chapList.querySelector('.empty-hint');
  if(visible === 0 && chapters.length){
    if(!empty){ empty = document.createElement('div'); empty.className = 'empty-hint'; chapList.appendChild(empty); }
    empty.textContent = 'No chapters match this filter';
  } else if(empty){ empty.remove(); }
}

chapList.addEventListener('click', async (e)=>{
  if(e.target.closest('.chap-check')) return;
  const btn = e.target.closest('.compare-toggle');
  if(btn){ toggleComparePanel(parseInt(btn.dataset.idx, 10)); return; }
  const row = e.target.closest('.chap-item');
  if(row && !running) await previewChapter(parseInt(row.dataset.idx, 10));
});
chapList.addEventListener('contextmenu', (e)=>{
  const row = e.target.closest('.chap-item');
  if(!row) return;
  e.preventDefault();
  emit('chapter:menu', {i: parseInt(row.dataset.idx, 10), x: e.clientX, y: e.clientY});
});
chapList.addEventListener('keydown', (e)=>{
  if(e.key !== 'Enter' && e.key !== ' ') return;
  const row = e.target.closest('.chap-item');
  if(row && !running){ e.preventDefault(); previewChapter(parseInt(row.dataset.idx, 10)); }
});

async function previewChapter(i, {scroll=true} = {}){
  const c = chapters[i];
  if(!c) return;
  previewIdx = i;
  emit('preview', {i});
  chapList.querySelectorAll('.chap-item.is-preview').forEach(r=>r.classList.remove('is-preview'));
  const row = el('chap-row-'+i);
  if(row && !running) row.classList.add('is-preview');
  viewerLabel.textContent = `${c.title}` + (c.text && c.text.trim() ? ' · translated' : ' · original');
  if(c.text && c.text.trim()){
    viewer.innerHTML = c.text.split(/\n+/).filter(p=>p.trim()).map(p=>`<p>${escapeHtml(p)}</p>`).join('');
  } else {
    try{
      const html = await loadChapterHtml(c);
      viewer.innerHTML = html || '<div class="ph">Empty chapter content</div>';
    }catch(err){
      viewer.innerHTML = '<div class="ph">Could not load this chapter</div>';
    }
  }
  viewer.scrollTop = 0;
  updateViewerScrollBar();
  updateViewerMeta(i);
  updateNavButtons();
  if(scroll && window.innerWidth <= 900) ensureInView(viewerPanel);
}
function updateViewerMeta(i){
  const c = chapters[i];
  if(!c){ viewerMeta.textContent = ''; return; }
  const words = c.text && c.text.trim() ? (c.wc || wordCount(c.text)) : wordCount(viewer.innerText);
  viewerMeta.textContent = `Chapter ${i+1} of ${chapters.length} · ${formatNum(words)} words · ${statusLabel(c.status)}`;
}
function updateNavButtons(){
  const idx = previewIdx;
  el('prevChapBtn').disabled = running || idx <= 0;
  el('nextChapBtn').disabled = running || idx < 0 || idx >= chapters.length - 1;
}
function stepPreview(delta){
  if(running || !chapters.length) return;
  const next = Math.min(chapters.length-1, Math.max(0, (previewIdx < 0 ? 0 : previewIdx) + delta));
  if(next === previewIdx) return;
  previewChapter(next, {scroll:false});
  const row = el('chap-row-'+next);
  if(row) scrollListToRow(row, true);
}
/* swipe left/right on the preview to change chapter (mobile) */
(function(){
  let sx = 0, sy = 0, t0 = 0;
  viewer.addEventListener('touchstart', e=>{ const t = e.touches[0]; sx = t.clientX; sy = t.clientY; t0 = Date.now(); }, {passive:true});
  viewer.addEventListener('touchend', e=>{
    const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
    if(Date.now() - t0 < 600 && Math.abs(dx) > 70 && Math.abs(dy) < 50) stepPreview(dx < 0 ? 1 : -1);
  }, {passive:true});
})();
el('prevChapBtn').addEventListener('click', ()=>stepPreview(-1));
el('nextChapBtn').addEventListener('click', ()=>stepPreview(1));

function toggleComparePanel(i){
  const c = chapters[i];
  const panel = el('compare-panel-'+i);
  if(!panel) return;
  if(panel.classList.contains('show')){ panel.classList.remove('show'); panel.innerHTML = ''; return; }
  document.querySelectorAll('.compare-panel.show').forEach(p=>{ p.classList.remove('show'); p.innerHTML=''; });
  panel.innerHTML = `
    <div class="compare-col">
      <div class="compare-col-label">Original${settings.memSaver==='on' && (c.originalText||'').length >= ORIG_SNIPPET ? ' (first part)' : ''}</div>
      <div class="compare-col-text">${escapeHtml(c.originalText || '(not captured)')}</div>
    </div>
    <div class="compare-col">
      <div class="compare-col-label">Translated</div>
      <div class="compare-col-text translated">${escapeHtml(c.text || '(not captured)')}</div>
    </div>
  `;
  panel.classList.add('show');
}

function statusClass(s){
  return {pending:'st-pending', active:'st-active', done:'st-done', retry:'st-retry', unverified:'st-unverified', skipped:'st-skipped'}[s] || 'st-pending';
}
function statusLabel(s){
  return {pending:'Pending', active:'Translating', done:'Done', retry:'Retrying', unverified:'Unverified', skipped:'Skipped'}[s] || 'Pending';
}

function setChapterStatus(i, status){
  const prev = chapters[i].status;
  chapters[i].status = status;
  const badge = el('chap-status-'+i);
  if(badge){
    badge.className = 'chap-status ' + statusClass(status);
    badge.textContent = statusLabel(status);
  }
  const prevActive = chapList.querySelector('.chap-item.active');
  if(prevActive) prevActive.classList.remove('active');
  const row = el('chap-row-'+i);
  if(row && status==='active'){
    row.classList.add('active');
    followActiveRow(row);
  }
  const toggle = el('compare-toggle-'+i);
  if(toggle){
    const canCompare = (status==='done' || status==='unverified' || status==='skipped') && !!(chapters[i].originalText || chapters[i].text);
    toggle.style.display = canCompare ? 'inline-block' : 'none';
  }
  requestProgressUpdate();
  applyFilterToRow(i);
  saveSessionProgress();
  emit('chapter:status', {i, status, prev});
}

/* Animated numeric counters (stats) */
const counterState = new WeakMap();
function setCounter(node, value, fmt){
  const target = Number(value) || 0;
  const st = counterState.get(node) || {cur: target, raf: 0};
  if(st.cur === target && node.textContent){ return; }
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(REDUCED || Math.abs(target - st.cur) < 2){ st.cur = target; node.textContent = fmt ? fmt(target) : target; counterState.set(node, st); return; }
  cancelAnimationFrame(st.raf);
  const from = st.cur, start = performance.now(), dur = 420;
  const tick = now=>{
    const t = Math.min(1, (now - start) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    const v = Math.round(from + (target - from) * e);
    node.textContent = fmt ? fmt(v) : v;
    if(t < 1) st.raf = requestAnimationFrame(tick); else st.cur = target;
  };
  st.raf = requestAnimationFrame(tick);
  counterState.set(node, st);
}

function bumpStat(id){
  const stat = el(id).closest('.stat');
  if(!stat) return;
  stat.classList.add('bump');
  setTimeout(()=>stat.classList.remove('bump'), 250);
}

let progressRafQueued = false;
function requestProgressUpdate(){
  if(progressRafQueued) return;
  progressRafQueued = true;
  requestAnimationFrame(()=>{ progressRafQueued = false; updateProgress(); });
}

function updateProgress(){
  let verified = 0, unverified = 0, skipped = 0, words = 0;
  for(const c of chapters){
    if(c.status === 'done') verified++;
    else if(c.status === 'unverified') unverified++;
    else if(c.status === 'skipped') skipped++;
    words += c.wc || 0;
  }
  const processed = verified + unverified + skipped;
  const total = chapters.length;
  const pct = total ? Math.round((processed/total)*100) : 0;
  progFill.style.width = pct + '%';
  stickyBar.style.width = pct + '%';
  progText.textContent = `${verified} verified / ${total} chapters`;
  progPercent.textContent = pct + '%';
  if(total) setRunPill(pct, running ? 'running' : (processed === total ? 'done' : 'idle'));
  if(running) document.title = `${pct}% \u00b7 Translating\u2026 — DTV Pro`;

  if(el('statDone').textContent !== String(verified)){ setCounter(el('statDone'), verified); bumpStat('statDone'); }
  setCounter(el('statIssue'), unverified);
  setCounter(el('statSkip'), skipped);
  setCounter(el('statPending'), total - processed);
  setCounter(el('statWords'), words, formatNum);
  el('statReadTime').textContent = words > 0 ? formatDuration(Math.round(words/200)*60000) : '0m';
  updateEta(processed, total);
  emit('progress', {verified, unverified, skipped, words, processed, total, pct});
}

function updateEta(processed, total){
  if(!running || chapterDurations.length === 0){
    if(!running && !etaText.dataset.final) etaText.textContent = '';
    return;
  }
  const avg = chapterDurations.reduce((a,b)=>a+b,0) / chapterDurations.length;
  const remaining = chapters.filter(c=>!['done','unverified','skipped'].includes(c.status)).length;
  const etaMs = avg * remaining;
  const elapsed = Date.now() - runStartTime;
  etaText.textContent = `elapsed ${formatDuration(elapsed)} \u00b7 ~${formatDuration(etaMs)} left`;
  runStatusSub.textContent = `${processed}/${total} processed · ~${formatDuration(etaMs)} remaining`;
}

function recordDuration(ms){
  chapterDurations.push(ms);
  if(chapterDurations.length > MAX_DURATION_SAMPLES) chapterDurations.shift();
}

function formatDuration(ms){
  const s = Math.round(ms/1000);
  if(s < 60) return s + 's';
  const m = Math.floor(s/60);
  const rs = s % 60;
  if(m < 60) return m + 'm ' + (rs ? rs + 's' : '');
  return Math.floor(m/60) + 'h ' + (m%60) + 'm';
}

function escapeHtml(s){
  return String(s == null ? '' : s)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function escapeAttr(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
}

function log(msg, type=''){
  const empty = logBox.querySelector('.log-empty');
  if(empty) empty.remove();
  const nearBottom = logBox.scrollHeight - logBox.scrollTop - logBox.clientHeight < 40;
  const line = document.createElement('div');
  line.className = 'log-line ' + type;
  const ts = new Date().toLocaleTimeString([], {hour12:false});
  line.textContent = `[${ts}] ${msg}`;
  logBox.appendChild(line);
  while(logBox.children.length > MAX_LOG_LINES) logBox.firstChild.remove();
  logLines++;
  logCount.textContent = `(${logLines})`;
  if(nearBottom) logBox.scrollTop = logBox.scrollHeight;
}

/* ============ VIEWER CONTROLS ============ */
let viewerFontSize = 15;
el('fontMinus').addEventListener('click', ()=>{ viewerFontSize = Math.max(12, viewerFontSize - 1); viewer.style.fontSize = viewerFontSize + 'px'; });
el('fontPlus').addEventListener('click', ()=>{ viewerFontSize = Math.min(22, viewerFontSize + 1); viewer.style.fontSize = viewerFontSize + 'px'; });
el('copyViewer').addEventListener('click', async ()=>{
  try{ await navigator.clipboard.writeText(viewer.innerText || ''); showToast('Copied to clipboard', 'ok'); }
  catch(e){ showToast('Copy failed — your browser blocked clipboard access', 'err'); }
});
function toggleExpandViewer(){
  viewerFrame.classList.toggle('expanded');
  if(viewerFrame.classList.contains('expanded')) ensureInView(viewerPanel, true);
}
el('expandViewer').addEventListener('click', toggleExpandViewer);

function updateViewerScrollBar(){
  const max = viewer.scrollHeight - viewer.clientHeight;
  viewerScrollBar.style.width = max > 0 ? Math.min(100, (viewer.scrollTop / max) * 100) + '%' : '0%';
}
viewer.addEventListener('scroll', updateViewerScrollBar, {passive:true});

/* ============ 8. TRANSLATE-VERIFY CORE ============ */
function containsNonLatinScript(str){
  return /[\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F]/.test(str);
}
function textDivergence(a, b){
  a = (a||'').trim(); b = (b||'').trim();
  if(!a && !b) return 0;
  if(!a || !b) return 1;
  if(a === b) return 0;
  const wa = a.toLowerCase().split(/\s+/);
  const wb = new Set(b.toLowerCase().split(/\s+/));
  let common = 0;
  wa.forEach(w=>{ if(wb.has(w)) common++; });
  return 1 - (common / wa.length);
}
function isTranslated(rendered, originalText, elapsed){
  const now = (rendered||'');
  if(!now.trim()) return false;
  if(verifyMode === 'script') return containsNonLatinScript(now);
  if(verifyMode === 'latin') return elapsed > 2500 && textDivergence(originalText, now) > 0.35;
  if(containsNonLatinScript(now)) return true;
  return elapsed > 2800 && textDivergence(originalText, now) > 0.4;
}

function waitForTranslation(node, originalText, timeoutMs){
  return new Promise((resolve)=>{
    const start = Date.now();
    const check = setInterval(()=>{
      if(skipRequested || stopRequested){ clearInterval(check); resolve({success:false, interrupted:true, text: node.innerText || ''}); return; }
      const now = node.innerText || '';
      const elapsed = Date.now()-start;
      if(isTranslated(now, originalText, elapsed)){ clearInterval(check); resolve({success:true, text: now}); return; }
      if(elapsed > timeoutMs){ clearInterval(check); resolve({success:false, text: now}); }
    }, 400);
  });
}

/* Smooth, frame-based auto-scroll through the chapter so Chrome translates
   every part of it. Falls back to a timer when the tab is hidden (rAF pauses). */
function autoScrollNode(node){
  return new Promise(resolve=>{
    node.scrollTop = 0;
    const max = node.scrollHeight - node.clientHeight;
    if(max <= 0){ resolve(); return; }
    const step = Math.max(120, Math.floor(node.clientHeight * 0.8));
    const steps = Math.ceil(max / step);
    const duration = Math.max(450, steps * settings.scrollMs);
    const start = performance.now();
    const ease = t => t < .5 ? 2*t*t : -1 + (4 - 2*t) * t;
    const schedule = cb => document.hidden ? setTimeout(()=>cb(performance.now()), 200) : requestAnimationFrame(cb);
    function frame(now){
      if(skipRequested || stopRequested){ node.scrollTop = 0; updateViewerScrollBar(); resolve(); return; }
      const t = Math.min(1, (now - start) / duration);
      node.scrollTop = ease(t) * max;
      updateViewerScrollBar();
      if(t < 1){ schedule(frame); }
      else { setTimeout(()=>{ node.scrollTop = 0; updateViewerScrollBar(); resolve(); }, 160); }
    }
    schedule(frame);
  });
}

async function loadChapterHtml(c){
  if(c.item){
    if(c.item.document && c.item.document.body) return c.item.document.body.innerHTML;
    await c.item.load(book.load.bind(book));
    if(c.item.document && c.item.document.body) return c.item.document.body.innerHTML;
    return '';
  }
  return c.html || '';
}
function unloadChapterItem(c){
  if(c.item && typeof c.item.unload === 'function'){ try{ c.item.unload(); }catch(e){} }
}
function storeOriginal(c, fullText){
  c.originalText = (settings.memSaver === 'on' && fullText.length > ORIG_SNIPPET) ? fullText.slice(0, ORIG_SNIPPET) : fullText;
}
function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }
async function waitWhilePaused(){ while(paused && !stopRequested) await sleep(250); }

function setLive(on){
  liveBadge.classList.toggle('on', on);
  viewerFrame.classList.toggle('live', on);
}

async function processChapter(i){
  const c = chapters[i];
  currentIdx = i;
  skipRequested = false;
  const t0 = Date.now();
  setChapterStatus(i, 'active');
  el('jumpActiveBtn').disabled = false;
  viewerLabel.textContent = c.title;
  setLive(true);
  setRunStatus(`Translating chapter ${i+1} of ${chapters.length}`, c.title);
  log(`Loading chapter ${i+1}: ${c.title}`);

  let html = '';
  try{ html = await loadChapterHtml(c); }
  catch(err){ log(`Chapter ${i+1} failed to load: ${err.message}`, 'warn'); }

  viewer.innerHTML = html || '<div class="ph">Empty chapter content</div>';
  html = null;
  const originalText = viewer.innerText;
  storeOriginal(c, originalText);
  unloadChapterItem(c);
  updateViewerMeta(i);

  if(!originalText.trim()){
    setText(c, '');
    setChapterStatus(i, 'skipped');
    log(`Chapter ${i+1} was empty, marked skipped.`, 'warn');
    recordDuration(Date.now()-t0);
    setLive(false);
    return true;
  }

  await autoScrollNode(viewer);

  if(skipRequested){
    setText(c, viewer.innerText);
    setChapterStatus(i, 'skipped');
    log(`Chapter ${i+1} manually skipped.`, 'warn');
    skipRequested = false;
    recordDuration(Date.now()-t0);
    setLive(false);
    return true;
  }
  if(stopRequested){ setLive(false); return true; }

  log(`Verifying translation for chapter ${i+1}\u2026`);
  const result = await waitForTranslation(viewer, originalText, settings.timeoutMs);
  setLive(false);

  if(result.interrupted){
    if(stopRequested) return true;
    setText(c, result.text);
    setChapterStatus(i, 'skipped');
    log(`Chapter ${i+1} manually skipped.`, 'warn');
    skipRequested = false;
    recordDuration(Date.now()-t0);
    return true;
  }

  if(result.success){
    let finalText = result.text;
    try{ finalText = window.DTVHooks.transformText(finalText, c) || finalText; }catch(e){}
    setText(c, finalText);
    c.durMs = Date.now()-t0;
    c.doneAt = Date.now();
    setChapterStatus(i, 'done');
    log(`Chapter ${i+1} verified (${finalText.length} chars).`, 'ok');
    consecutiveVerifyFailures = 0;
    recordDuration(Date.now()-t0);
    viewerLabel.textContent = `${c.title} · translated`;
    updateViewerMeta(i);
    return true;
  }

  c.retries += 1;
  if(c.retries < settings.maxRetries){
    setChapterStatus(i, 'retry');
    log(`Chapter ${i+1} — no translation detected, retrying (${c.retries}/${settings.maxRetries})\u2026`, 'warn');
    await sleep(1200);
    if(stopRequested || skipRequested){
      setText(c, viewer.innerText);
      setChapterStatus(i, skipRequested ? 'skipped' : 'unverified');
      skipRequested = false;
      recordDuration(Date.now()-t0);
      return true;
    }
    return await processChapter(i);
  }
  setText(c, result.text);
  c.durMs = Date.now()-t0;
  setChapterStatus(i, 'unverified');
  log(`Chapter ${i+1} — translation not verified, saving available text as-is.`, 'err');
  consecutiveVerifyFailures++;
  recordDuration(Date.now()-t0);
  return false;
}

/* ============ MAIN LOOP ============ */
async function runTranslation(){
  if(running) return;
  const range = clampRangeInputs();
  running = true;
  paused = false;
  stopRequested = false;
  skipRequested = false;
  consecutiveVerifyFailures = 0;
  chapterDurations = [];
  runStartTime = Date.now();
  delete etaText.dataset.final;
  startBtn.style.display = 'none';
  stopBtn.style.display = '';
  skipBtn.style.display = '';
  pauseBtn.style.display = '';
  pauseBtnLabel.textContent = 'Pause';
  retryFailedBtn.style.display = 'none';
  actionPanel.classList.add('is-running');
  chapList.querySelectorAll('.chap-item.is-preview').forEach(r=>r.classList.remove('is-preview'));
  updateNavButtons();
  logBox.innerHTML = '';
  logLines = 0;
  logDetails.open = true;
  hideBanner(globalBanner);
  progFill.classList.add('animating');
  stickyProg.classList.add('on');
  acquireWakeLock();
  requestNotifyPermission();
  setStep(2);

  runTimer = setInterval(()=>{
    const processed = chapters.filter(c=>['done','unverified','skipped'].includes(c.status)).length;
    updateEta(processed, chapters.length);
  }, 1000);

  const rangeNote = (range.from > 1 || range.to < chapters.length) ? ` Range: chapters ${range.from}\u2013${range.to}.` : '';
  log(`Starting (mode: ${verifyMode}, timeout: ${Math.round(settings.timeoutMs/1000)}s, retries: ${settings.maxRetries}).${rangeNote} Confirm Chrome translation is enabled.`);
  emit('run:start', {range});

  /* Two passes: the first skips chapters another collaborator is translating right now
     (cloud claim); the second pass picks up whatever is still pending. */
  const deferred = [];
  const queue = [];
  for(let i=range.from-1; i<range.to; i++) queue.push(i);
  let pass = 0;
  while(queue.length && !stopRequested){
    const i = queue.shift();
    if(stopRequested){ log('Stopped by user.', 'warn'); break; }
    await waitWhilePaused();
    if(stopRequested){ log('Stopped by user.', 'warn'); break; }
    if(chapters[i].status === 'done' && chapters[i].text && chapters[i].text.trim()) continue;
    if(chapters[i].status === 'skipped' && chapters[i].bulkSkipped) continue;
    if(pass === 0 && window.DTVHooks.shouldDeferChapter(i)){
      deferred.push(i);
      log(`Chapter ${i+1} is being translated by another collaborator — deferring.`, 'warn');
      if(queue.length === 0 && deferred.length){ pass = 1; queue.push(...deferred); deferred.length = 0; await sleep(1500); }
      continue;
    }
    if(queue.length === 0 && deferred.length && pass === 0){ pass = 1; queue.push(...deferred); deferred.length = 0; }
    chapters[i].retries = 0;
    emit('chapter:claim', {i});
    const verified = await processChapter(i);
    emit('chapter:release', {i});

    if(verified === false && consecutiveVerifyFailures >= 2){
      await new Promise(resolve=>{
        showBanner(globalBanner, {
          level: 'warn',
          title: 'Translation not detected',
          message: `The last ${consecutiveVerifyFailures} chapters finished without any translated text being detected. This usually means Chrome's translation isn't active, or the target language doesn't match your selection. Check the translate icon in the address bar, then continue.`,
          actions: [
            { id:'stop', label:'Stop Now', primary:true, onClick: ()=>{ stopRequested = true; hideBanner(globalBanner); resolve(); } },
            { id:'continue', label:'Keep Going', onClick: ()=>{ consecutiveVerifyFailures = 0; hideBanner(globalBanner); resolve(); } }
          ]
        });
      });
    }
    if(settings.gapMs && !stopRequested) await sleep(settings.gapMs);
  }

  running = false;
  paused = false;
  clearInterval(runTimer);
  releaseWakeLock();
  emit('run:end', {stopped: stopRequested});
  progFill.classList.remove('animating');
  stickyProg.classList.remove('on');
  actionPanel.classList.remove('is-running');
  startBtn.style.display = '';
  stopBtn.style.display = 'none';
  skipBtn.style.display = 'none';
  pauseBtn.style.display = 'none';
  startBtnLabel.textContent = 'Run Again (remaining)';
  const lastIdx = currentIdx;
  currentIdx = -1;
  document.title = BASE_TITLE;
  el('jumpActiveBtn').disabled = true;
  if(lastIdx >= 0){ previewIdx = lastIdx; const r = el('chap-row-'+lastIdx); if(r) r.classList.add('is-preview'); }
  updateNavButtons();

  refreshDownloadSummary();
  requestProgressUpdate();
  const doneCount = chapters.filter(c=>c.status==='done' && c.text.trim()).length;
  const issueCount = chapters.filter(c=>c.status==='unverified' || c.status==='skipped').length;
  if(issueCount > 0) retryFailedBtn.style.display = '';
  const took = formatDuration(Date.now() - runStartTime);
  etaText.textContent = `finished in ${took}`;
  etaText.dataset.final = '1';
  log(`Complete — ${doneCount}/${chapters.length} chapters verified in ${took}.`, doneCount>0?'ok':'warn');
  emit('run:complete', {doneCount, total: chapters.length, issueCount, stopped: stopRequested, took});
  if(doneCount > 0){
    setRunStatus(stopRequested ? 'Run stopped' : 'Run complete', `${doneCount}/${chapters.length} verified in ${took} · ready to export`);
    playChime();
    notifyDone(`${doneCount}/${chapters.length} chapters verified in ${took}. Ready to export.`);
    showToast(`Run complete: ${doneCount}/${chapters.length} verified in ${took}`, 'ok', 4200);
    setTimeout(()=>ensureInView(downloadPanel), 350);
  } else {
    setRunStatus('Nothing verified', 'Is Chrome translation switched on?');
    showToast('Run finished but nothing was verified — is Chrome translation on?', 'warn', 4200);
  }
}

startBtn.addEventListener('click', runTranslation);
stopBtn.addEventListener('click', ()=>{ stopRequested = true; paused = false; setRunStatus('Stopping\u2026', 'Finishing the current step'); log('Stopping after current step\u2026', 'warn'); });
pauseBtn.addEventListener('click', ()=>{
  paused = !paused;
  pauseBtnLabel.textContent = paused ? 'Resume' : 'Pause';
  if(paused){ log('Paused — will hold after the current chapter finishes.', 'warn'); showToast('Paused (after current chapter)', 'info'); setRunStatus('Pausing\u2026', 'Will hold after the current chapter'); }
  else { log('Resumed.', 'ok'); showToast('Resumed', 'ok'); }
});
skipBtn.addEventListener('click', ()=>{ if(currentIdx >= 0){ skipRequested = true; showToast('Skipping current chapter\u2026', 'info', 1600); } });
retryFailedBtn.addEventListener('click', ()=>{
  const targets = chapters.filter(c=>c.status==='unverified' || c.status==='skipped');
  if(targets.length === 0){ retryFailedBtn.style.display = 'none'; return; }
  targets.forEach(c=>{ c.status = 'pending'; c.retries = 0; });
  rangeFrom.value = 1; rangeTo.value = chapters.length;
  renderChapterList();
  requestProgressUpdate();
  showToast(`Retrying ${targets.length} chapter${targets.length>1?'s':''}\u2026`, 'info');
  runTranslation();
});

/* keyboard shortcuts */
const shortcutsModal = el('shortcutsModal');
function toggleShortcuts(force){
  const show = force !== undefined ? force : !shortcutsModal.classList.contains('show');
  shortcutsModal.classList.toggle('show', show);
}
el('shortcutsBtn').addEventListener('click', ()=>toggleShortcuts());
el('shortcutsClose').addEventListener('click', ()=>toggleShortcuts(false));
shortcutsModal.addEventListener('click', (e)=>{ if(e.target === shortcutsModal) toggleShortcuts(false); });

document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){
    if(shortcutsModal.classList.contains('show')){ toggleShortcuts(false); return; }
    if(running){ stopBtn.click(); return; }
  }
  if(e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key;
  const loaded = workspace.classList.contains('show') && chapters.length > 0;
  if(k === '?'){ e.preventDefault(); toggleShortcuts(); return; }
  if(k === '/' && loaded){ e.preventDefault(); el('chapFilter').focus(); return; }
  const lk = k.toLowerCase();
  if(lk === 't'){ e.preventDefault(); toggleTheme(); return; }
  if(!loaded) return;
  if(lk === 's' && !running && !startBtn.disabled){ e.preventDefault(); startBtn.click(); }
  else if(lk === 'p' && running){ e.preventDefault(); pauseBtn.click(); }
  else if(lk === 'k' && running){ e.preventDefault(); skipBtn.click(); }
  else if(lk === 'f'){ e.preventDefault(); toggleExpandViewer(); }
  else if(k === 'ArrowLeft' && !running){ e.preventDefault(); stepPreview(-1); }
  else if(k === 'ArrowRight' && !running){ e.preventDefault(); stepPreview(1); }
});

function refreshDownloadSummary(){
  const doneCount = chapters.filter(c=>c.status==='done' && c.text && c.text.trim()).length;
  const usable = chapters.filter(c=>c.text && c.text.trim()).length;
  if(usable > 0){
    dDone.textContent = doneCount;
    dSkipped.textContent = usable - doneCount;
    dWords.textContent = formatNum(chapters.reduce((s,c)=> s + (c.wc || 0), 0));
    downloadPanel.style.display = '';
    editorPanel.style.display = '';
    renderEditorList();
    setStep(3);
  }
}

/* ============ 9. CHAPTER EDITOR ============ */
let dragSrcPos = null;

function renderEditorList(){
  editorList.innerHTML = '';
  const frag = document.createDocumentFragment();
  exportOrder.forEach((chapIdx, pos)=>{
    const c = chapters[chapIdx];
    const hasText = !!(c.text && c.text.trim());
    const wc = hasText ? (c.wc || wordCount(c.text)) : 0;
    const row = document.createElement('div');
    row.className = 'editor-row' + (c.excluded ? ' excluded' : '');
    row.draggable = true;
    row.dataset.pos = pos;
    row.innerHTML = `
      <span class="drag-handle" title="Drag to reorder" aria-hidden="true">&#8942;&#8942;</span>
      <span class="editor-pos">${String(pos+1).padStart(2,'0')}</span>
      <div class="editor-main">
        <input class="editor-title-input" value="${escapeAttr(c.title)}" data-chap="${chapIdx}" ${hasText ? '' : 'disabled'} aria-label="Chapter title" />
        <span class="editor-wc">${hasText ? formatNum(wc) + ' words \u00b7 ' + statusLabel(c.status) : 'no text captured'}</span>
      </div>
      <div class="editor-controls">
        <button class="editor-btn" data-act="up" data-pos="${pos}" ${pos===0?'disabled':''} title="Move up" aria-label="Move up">\u2191</button>
        <button class="editor-btn" data-act="down" data-pos="${pos}" ${pos===exportOrder.length-1?'disabled':''} title="Move down" aria-label="Move down">\u2193</button>
        <button class="editor-btn ${c.excluded?'toggle-off':''}" data-act="toggle" data-chap="${chapIdx}" title="${c.excluded ? 'Include in export' : 'Exclude from export'}" ${hasText ? '' : 'disabled'} aria-label="Toggle include">${c.excluded ? '\uFF0B' : '\u2715'}</button>
      </div>
    `;
    frag.appendChild(row);
  });
  editorList.appendChild(frag);
}

editorList.addEventListener('input', (e)=>{
  if(e.target.classList.contains('editor-title-input')){
    const idx = parseInt(e.target.dataset.chap, 10);
    chapters[idx].title = e.target.value;
    const name = el('chap-row-'+idx) && el('chap-row-'+idx).querySelector('.chap-name');
    if(name) name.textContent = chapters[idx].title;
    saveSessionProgress();
  }
});

editorList.addEventListener('click', (e)=>{
  const btn = e.target.closest('.editor-btn');
  if(!btn || btn.disabled) return;
  const act = btn.dataset.act;
  if(act === 'up' || act === 'down'){
    const pos = parseInt(btn.dataset.pos, 10);
    const swapWith = act === 'up' ? pos-1 : pos+1;
    if(swapWith < 0 || swapWith >= exportOrder.length) return;
    [exportOrder[pos], exportOrder[swapWith]] = [exportOrder[swapWith], exportOrder[pos]];
    const keep = editorList.scrollTop;
    renderEditorList();
    editorList.scrollTop = keep;
    saveSessionProgress();
  }
  if(act === 'toggle'){
    const idx = parseInt(btn.dataset.chap, 10);
    chapters[idx].excluded = !chapters[idx].excluded;
    const keep = editorList.scrollTop;
    renderEditorList();
    editorList.scrollTop = keep;
    saveSessionProgress();
  }
});

editorList.addEventListener('dragstart', (e)=>{
  const row = e.target.closest('.editor-row');
  if(!row) return;
  dragSrcPos = parseInt(row.dataset.pos, 10);
  row.classList.add('dragging');
  e.dataTransfer.effectAllowed = 'move';
  try{ e.dataTransfer.setData('text/plain', String(dragSrcPos)); }catch(err){}
});
editorList.addEventListener('dragend', ()=>{
  dragSrcPos = null;
  editorList.querySelectorAll('.editor-row').forEach(r=>r.classList.remove('dragging','drop-target'));
});
editorList.addEventListener('dragover', (e)=>{
  if(dragSrcPos === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  const row = e.target.closest('.editor-row');
  editorList.querySelectorAll('.editor-row.drop-target').forEach(r=>r.classList.remove('drop-target'));
  if(row && parseInt(row.dataset.pos,10) !== dragSrcPos) row.classList.add('drop-target');
});
editorList.addEventListener('drop', (e)=>{
  if(dragSrcPos === null) return;
  e.preventDefault();
  e.stopPropagation();
  const row = e.target.closest('.editor-row');
  if(!row) return;
  const targetPos = parseInt(row.dataset.pos, 10);
  if(targetPos === dragSrcPos) return;
  const [moved] = exportOrder.splice(dragSrcPos, 1);
  exportOrder.splice(targetPos, 0, moved);
  dragSrcPos = null;
  const keep = editorList.scrollTop;
  renderEditorList();
  editorList.scrollTop = keep;
  saveSessionProgress();
  showToast('Chapter order updated', 'ok', 1600);
});

el('resetOrderBtn').addEventListener('click', ()=>{
  exportOrder = chapters.map((c,i)=>i);
  renderEditorList();
  saveSessionProgress();
  showToast('Original order restored', 'info', 1800);
});

function getExportChapters(){
  return exportOrder.map(idx => chapters[idx]).filter(c => c && c.text && c.text.trim() && !c.excluded);
}

/* ---- FIND & REPLACE ---- */
function escapeRegExp(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function countFindMatches(){
  const find = el('fnrFind').value;
  if(!find) return 0;
  const re = new RegExp(escapeRegExp(find), el('fnrCase').checked ? 'g' : 'gi');
  let count = 0;
  chapters.forEach(c=>{ if(c.text && !c.excluded){ const m = c.text.match(re); if(m) count += m.length; } });
  return count;
}
let fnrDebounce = null;
function refreshFnrPreview(){
  clearTimeout(fnrDebounce);
  fnrDebounce = setTimeout(()=>{
    const find = el('fnrFind').value;
    el('fnrPreview').textContent = find ? countFindMatches() + ' matches' : '';
  }, 250);
}
el('fnrFind').addEventListener('input', refreshFnrPreview);
el('fnrCase').addEventListener('change', refreshFnrPreview);
el('fnrApplyBtn').addEventListener('click', ()=>{
  const find = el('fnrFind').value;
  const replace = el('fnrReplace').value;
  if(!find){ showToast('Enter text to find first', 'warn'); return; }
  const re = new RegExp(escapeRegExp(find), el('fnrCase').checked ? 'g' : 'gi');
  let total = 0;
  chapters.forEach(c=>{
    if(c.text && !c.excluded){
      const m = c.text.match(re);
      if(m){ total += m.length; setText(c, c.text.replace(re, replace)); }
    }
  });
  if(total > 0){
    renderEditorList();
    refreshDownloadSummary();
    requestProgressUpdate();
    saveSessionProgress();
    if(previewIdx >= 0) previewChapter(previewIdx, {scroll:false});
    showToast(`Replaced ${total} occurrence${total>1?'s':''}`, 'ok');
    el('fnrPreview').textContent = '0 matches';
  } else {
    showToast('No matches found', 'info');
  }
});

/* ---- SESSION BACKUP ---- */
el('backupExportBtn').addEventListener('click', ()=>{
  if(chapters.length === 0){ showToast('Nothing to back up yet', 'warn'); return; }
  const payload = {
    dtvBackup: 1, savedAt: Date.now(), bookTitle: mTitle.textContent, bookLang, exportOrder,
    chapters: chapters.map(c=>({ title: c.title, status: c.status, text: c.text, originalText: c.originalText || '', excluded: !!c.excluded }))
  };
  const blob = new Blob([JSON.stringify(payload)], {type:'application/json'});
  triggerDownload(blob, `${safeFileName(mTitle.textContent,'book')}_dtv_backup.json`);
  showToast('Backup file download started', 'ok');
});
el('backupImportBtn').addEventListener('click', ()=> el('backupFileInput').click());
el('backupFileInput').addEventListener('change', (e)=>{
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  restoreBackupFile(file);
});
function restoreBackupFile(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const data = JSON.parse(reader.result);
      if(!data || data.dtvBackup !== 1 || !Array.isArray(data.chapters)){ showToast('Not a valid DTV backup file', 'err'); return; }
      resetForNewFile(null);
      fileNameShow.textContent = file.name;
      fileSizeShow.textContent = 'restored backup · ' + formatBytes(file.size);
      chapters = data.chapters.map((sc, i)=>{
        const c = { index: i, title: sc.title || ('Chapter ' + (i+1)), item: null, html: null, status: sc.status || (sc.text ? 'done' : 'pending'), text: '', wc: 0, originalText: sc.originalText || '', retries: 0, excluded: !!sc.excluded };
        setText(c, sc.text || '');
        return c;
      });
      bookLang = data.bookLang || 'en';
      mTitle.textContent = data.bookTitle || 'Restored book';
      mChapters.textContent = chapters.length;
      mWords.textContent = '—';
      setStatus('Restored from backup');
      exportOrder = (Array.isArray(data.exportOrder) && data.exportOrder.length === chapters.length) ? data.exportOrder.slice() : chapters.map((c,i)=>i);
      sessionKey = computeSessionKey(mTitle.textContent, 0, chapters.length);
      rangeFrom.max = chapters.length; rangeTo.max = chapters.length;
      rangeFrom.value = 1; rangeTo.value = chapters.length;
      renderChapterList();
      startBtn.disabled = chapters.every(c=>c.status==='done');
      setRunStatus('Backup restored', `${chapters.length} chapters · review and export below`);
      requestProgressUpdate();
      refreshDownloadSummary();
      previewChapter(0, {scroll:false});
      showToast(`Backup restored — ${chapters.length} chapters`, 'ok');
      /* Let the cloud layer attach so a book opened from the community library
         (or a restored backup of a shared file) keeps syncing and can be continued. */
      emit('book:loaded', {title: mTitle.textContent, fileName: data.sourceFileName || file.name.replace(/\.json$/i,''), fileSize: file.size, count: chapters.length, lang: bookLang, restored: true, cloudBookId: data.cloudBookId || null});
    }catch(err){ showToast('Could not read backup file', 'err'); }
  };
  reader.onerror = ()=> showToast('Could not read backup file', 'err');
  reader.readAsText(file);
}

/* ============ 10. EXPORTS ============ */
const EXPORT_META = {
  story:{ btn:'Download story as a single .txt file', note:'One plain .txt file with just the translated story text, in order — no chapter numbers, titles or dividers. Ideal for reading apps or feeding into other tools.' },
  txt:  { btn:'Download ZIP (per-chapter + combined .txt)', note:'A .zip with one .txt file per chapter plus a combined file that includes a table of contents and chapter headings.' },
  epub: { btn:'Download EPUB (.epub)', note:'Repackages translated chapters into a standard EPUB3 container with a generated table of contents, using the titles and order set above. Opens in any e-reader (Apple Books, Calibre, Kindle after conversion, etc.).' },
  md:   { btn:'Download Markdown (.md)', note:'A single Markdown file with a linked table of contents and one heading per chapter — great for Obsidian, Notion, GitHub, or further editing.' },
  html: { btn:'Download HTML (.html)', note:'A single, self-contained styled HTML page with a clickable table of contents — readable in any browser, easy to print or convert to PDF.' },
};
exportTabs.addEventListener('click', (e)=>{
  const tab = e.target.closest('.export-tab');
  if(!tab) return;
  exportMode = tab.dataset.mode;
  document.querySelectorAll('.export-tab').forEach(t=>t.classList.toggle('active', t===tab));
  const meta = EXPORT_META[exportMode];
  downloadBtnLabel.textContent = meta.btn;
  exportNoteText.textContent = meta.note;
});

downloadBtn.addEventListener('click', async ()=>{
  if(downloadBtn.disabled) return;
  if((exportMode === 'txt' || exportMode === 'epub') && !requireLib(LIB_STATUS.jszip, 'ZIP/EPUB export')){
    showGlobalError('Cannot export', 'The JSZip component failed to load, so files can\u2019t be packaged. Reload the page after checking your connection.');
    return;
  }
  downloadBtn.disabled = true;
  const originalLabel = downloadBtnLabel.textContent;
  downloadBtnLabel.textContent = 'Preparing\u2026';
  try{
    if(exportMode === 'story') await downloadAsStoryTxt();
    else if(exportMode === 'epub') await downloadAsEpub();
    else if(exportMode === 'md') await downloadAsMarkdown();
    else if(exportMode === 'html') await downloadAsHtml();
    else await downloadAsTxtZip();
    setStep(4);
  }catch(err){
    log(`Export failed: ${err.message}`, 'err');
    showGlobalError('Export failed', 'Something went wrong while preparing the download.', (err.message||'') + (err.stack ? '\n' + err.stack : ''));
  }finally{
    downloadBtn.disabled = false;
    downloadBtnLabel.textContent = originalLabel;
  }
});

function requireExportList(){
  const exportList = getExportChapters();
  if(exportList.length === 0){
    log('Nothing to export — all chapters are excluded or empty.', 'err');
    showGlobalWarning('Nothing to export', 'Every translated chapter is currently excluded (or empty). Include at least one chapter in the "Review & Arrange" panel.');
    return null;
  }
  return exportList;
}
function safeFileName(s, fallback){
  const cleaned = String(s||'').replace(/[^a-zA-Z0-9 \-_]/g,'').trim();
  return cleaned || fallback;
}

async function downloadAsStoryTxt(){
  const exportList = requireExportList();
  if(!exportList) return;
  const bookTitle = safeFileName(mTitle.textContent, 'book');
  const story = exportList.map(c => c.text.trim()).filter(t=>t).join('\n\n');
  const blob = new Blob([story], {type:'text/plain;charset=utf-8'});
  triggerDownload(blob, `${bookTitle}_story_${Math.floor(Date.now()/1000)}.txt`);
  log(`Story TXT download started (${exportList.length} chapters merged, no headers).`, 'ok');
  showToast('Story .txt download started', 'ok');
  clearSessionProgress();
}

async function downloadAsTxtZip(){
  const exportList = requireExportList();
  if(!exportList) return;
  const zip = new JSZip();
  const bookTitle = safeFileName(mTitle.textContent, 'book');
  const usedNames = new Set();
  exportList.forEach((c, pos)=>{
    let base = `${String(pos+1).padStart(2,'0')}_${safeFileName(c.title,'chapter')}`;
    let fname = base + '.txt';
    let n = 1;
    while(usedNames.has(fname)){ fname = `${base}_${n++}.txt`; }
    usedNames.add(fname);
    zip.file(fname, c.text);
  });
  const tocLines = ['TABLE OF CONTENTS', '='.repeat(40), ''];
  exportList.forEach((c, pos)=>{ tocLines.push(`${String(pos+1).padStart(2,'0')}. ${c.title}`); });
  tocLines.push('', '='.repeat(40), '');
  const bodyLines = [];
  exportList.forEach((c, pos)=>{
    bodyLines.push(`[${String(pos+1).padStart(2,'0')}] ${c.title}`, '-'.repeat(40), '', c.text, '', '');
  });
  zip.file(`00_full_${bookTitle}.txt`, tocLines.join('\n') + bodyLines.join('\n'));
  try{
    const blob = await zip.generateAsync({type:'blob', streamFiles:true});
    triggerDownload(blob, `${bookTitle}_translated_${Math.floor(Date.now()/1000)}.zip`);
    log(`ZIP download started (${exportList.length} chapters).`, 'ok');
    showToast('ZIP download started', 'ok');
    clearSessionProgress();
  }catch(err){
    log(`ZIP generation failed: ${err.message}`, 'err');
    showGlobalError('Export failed', 'Building the ZIP file failed, most likely because the combined content is too large to hold in memory at once. Try excluding some chapters and exporting in smaller batches.', (err.message||'') + (err.stack ? '\n' + err.stack : ''));
  }
}

function triggerDownload(blob, filename){
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}

async function downloadAsMarkdown(){
  const exportList = requireExportList();
  if(!exportList) return;
  const bookTitle = mTitle.textContent || 'Translated Book';
  const lines = [`# ${bookTitle}`, '', '## Table of Contents', ''];
  const anchors = exportList.map((c, pos)=>{
    const slug = String(c.title||'chapter').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-') || 'chapter-' + (pos+1);
    return slug + '-' + (pos+1);
  });
  exportList.forEach((c, pos)=>{ lines.push(`${pos+1}. [${c.title}](#${anchors[pos]})`); });
  lines.push('', '---', '');
  exportList.forEach((c, pos)=>{
    lines.push(`<a id="${anchors[pos]}"></a>`, '', `## ${c.title}`, '');
    c.text.split(/\n+/).map(p=>p.trim()).filter(p=>p).forEach(p=>{ lines.push(p, ''); });
    lines.push('---', '');
  });
  const blob = new Blob([lines.join('\n')], {type:'text/markdown;charset=utf-8'});
  triggerDownload(blob, `${safeFileName(bookTitle,'book')}_translated_${Math.floor(Date.now()/1000)}.md`);
  log(`Markdown download started (${exportList.length} chapters).`, 'ok');
  showToast('Markdown download started', 'ok');
  clearSessionProgress();
}

async function downloadAsHtml(){
  const exportList = requireExportList();
  if(!exportList) return;
  const bookTitle = mTitle.textContent || 'Translated Book';
  const lang = (bookLang || 'en').split('-')[0] || 'en';
  const tocHtml = exportList.map((c, pos)=> `<li><a href="#chap-${pos+1}">${escapeHtml(c.title)}</a></li>`).join('\n');
  const chapHtml = exportList.map((c, pos)=>{
    const paras = c.text.split(/\n+/).map(p=>p.trim()).filter(p=>p).map(p=>`<p>${escapeHtml(p)}</p>`).join('\n');
    return `<section id="chap-${pos+1}"><h2>${escapeHtml(c.title)}</h2>\n${paras}\n<p class="back"><a href="#top">\u2191 Contents</a></p></section>`;
  }).join('\n<hr>\n');
  const doc = `<!DOCTYPE html>
<html lang="${escapeAttr(lang)}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(bookTitle)}</title>
<style>
  body{max-width:680px;margin:0 auto;padding:40px 20px 80px;font-family:Georgia,'Times New Roman',serif;line-height:1.8;color:#222;background:#faf8f4;}
  h1{font-size:1.9em;line-height:1.3;}
  h2{margin-top:2em;font-size:1.4em;}
  nav ol{line-height:2;}
  a{color:#3a5fa8;}
  hr{border:none;border-top:1px solid #ddd6c8;margin:3em 0;}
  .back{font-size:0.85em;margin-top:2em;}
  .meta{color:#888;font-size:0.85em;font-family:system-ui,sans-serif;}
  @media print{.back{display:none;}}
</style>
</head>
<body>
<header id="top">
  <h1>${escapeHtml(bookTitle)}</h1>
  <p class="meta">Translated copy &middot; ${exportList.length} chapters &middot; generated ${new Date().toLocaleDateString()}</p>
</header>
<nav aria-label="Table of contents">
  <h2>Contents</h2>
  <ol>
${tocHtml}
  </ol>
</nav>
<hr>
<main>
${chapHtml}
</main>
</body>
</html>`;
  const blob = new Blob([doc], {type:'text/html;charset=utf-8'});
  triggerDownload(blob, `${safeFileName(bookTitle,'book')}_translated_${Math.floor(Date.now()/1000)}.html`);
  log(`HTML download started (${exportList.length} chapters).`, 'ok');
  showToast('HTML download started', 'ok');
  clearSessionProgress();
}

function textToXhtmlBody(text){
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(p => p.length > 0);
  if(paragraphs.length === 0){
    const lines = text.split(/\n/).map(l=>l.trim()).filter(l=>l.length>0);
    if(lines.length === 0) return '<p></p>';
    return lines.map(l=>`<p>${escapeXml(l)}</p>`).join('\n');
  }
  return paragraphs.map(p => `<p>${escapeXml(p).replace(/\n/g, '<br/>')}</p>`).join('\n');
}
function escapeXml(s){
  return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
}
function makeUuid(){
  if(window.crypto && crypto.randomUUID){ try{ return crypto.randomUUID(); }catch(e){} }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{
    const r = Math.random()*16|0;
    return (c==='x' ? r : (r&0x3|0x8)).toString(16);
  });
}

async function downloadAsEpub(){
  const exportList = requireExportList();
  if(!exportList) return;
  const bookTitle = mTitle.textContent || 'Translated Book';
  const uuid = makeUuid();
  const lang = (bookLang || 'en').split('-')[0] || 'en';
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', {compression:'STORE'});
  zip.file('META-INF/container.xml',
`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`);

  const manifestItems = [];
  const spineItems = [];
  const navItems = [];
  exportList.forEach((c, pos)=>{
    const id = `chap${String(pos+1).padStart(3,'0')}`;
    const fname = `${id}.xhtml`;
    const xhtml =
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${escapeXml(lang)}">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(c.title)}</title>
</head>
<body>
  <h1>${escapeXml(c.title)}</h1>
  ${textToXhtmlBody(c.text)}
</body>
</html>`;
    zip.file(`OEBPS/${fname}`, xhtml);
    manifestItems.push(`<item id="${id}" href="${fname}" media-type="application/xhtml+xml"/>`);
    spineItems.push(`<itemref idref="${id}"/>`);
    navItems.push(`<li><a href="${fname}">${escapeXml(c.title)}</a></li>`);
  });

  const navXhtml =
`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeXml(lang)}">
<head><meta charset="UTF-8"/><title>Table of Contents</title></head>
<body>
  <nav epub:type="toc" id="toc">
    <h1>Table of Contents</h1>
    <ol>
      ${navItems.join('\n      ')}
    </ol>
  </nav>
</body>
</html>`;
  zip.file('OEBPS/nav.xhtml', navXhtml);
  manifestItems.push(`<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>`);

  const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const opf =
`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${escapeXml(bookTitle)}</dc:title>
    <dc:language>${escapeXml(lang)}</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    ${manifestItems.join('\n    ')}
  </manifest>
  <spine>
    ${spineItems.join('\n    ')}
  </spine>
</package>`;
  zip.file('OEBPS/content.opf', opf);

  try{
    const blob = await zip.generateAsync({ type:'blob', mimeType:'application/epub+zip', streamFiles:true });
    triggerDownload(blob, `${safeFileName(bookTitle, 'book')}_translated_${Math.floor(Date.now()/1000)}.epub`);
    log(`EPUB download started (${exportList.length} chapters).`, 'ok');
    showToast('EPUB download started', 'ok');
    clearSessionProgress();
  }catch(err){
    log(`EPUB generation failed: ${err.message}`, 'err');
    showGlobalError('Export failed', 'Building the EPUB file failed, most likely because the content is too large to hold in memory at once. Try excluding some chapters, or use the Text export instead.', (err.message||'') + (err.stack ? '\n' + err.stack : ''));
  }
}

/* ============ 11. SCROLLING HELPERS & UI POLISH ============ */

/* Scroll the PAGE so `node` sits just under the sticky top bar — only if it
   isn't already fully visible. Never uses scrollIntoView (which would also
   yank every ancestor scroll container). */
function ensureInView(node, force=false){
  if(!node || node.offsetParent === null) return;
  const r = node.getBoundingClientRect();
  const top = TOPBAR_H + 16;
  if(!force && r.top >= top && r.bottom <= window.innerHeight) return;
  const y = window.scrollY + r.top - top;
  window.scrollTo({top: Math.max(0, y), behavior: 'smooth'});
}

/* Scroll ONLY the chapter list so `row` is centred — the page never moves. */
let listProgrammaticUntil = 0;
let listUserScrollAt = 0;
function scrollListToRow(row, smooth=true){
  const lr = chapList.getBoundingClientRect();
  const rr = row.getBoundingClientRect();
  const target = chapList.scrollTop + (rr.top - lr.top) - (lr.height / 2 - rr.height / 2);
  listProgrammaticUntil = Date.now() + 700;
  chapList.scrollTo({top: Math.max(0, target), behavior: smooth ? 'smooth' : 'auto'});
}
chapList.addEventListener('scroll', ()=>{
  if(Date.now() > listProgrammaticUntil) listUserScrollAt = Date.now();
}, {passive:true});
chapList.addEventListener('wheel', ()=>{ listUserScrollAt = Date.now(); }, {passive:true});
chapList.addEventListener('touchstart', ()=>{ listUserScrollAt = Date.now(); }, {passive:true});

function followActiveRow(row){
  if(settings.follow !== 'on') return;
  if(Date.now() - listUserScrollAt < 4000) return;      // user is browsing the list — don't fight them
  if(chapList.matches(':hover')) return;
  scrollListToRow(row, true);
}
el('jumpActiveBtn').addEventListener('click', ()=>{
  const idx = currentIdx >= 0 ? currentIdx : previewIdx;
  const row = el('chap-row-'+idx);
  if(row){ listUserScrollAt = 0; scrollListToRow(row, true); }
});

/* Back-to-top */
const toTopBtn = el('toTopBtn');
let scrollRaf = false;
window.addEventListener('scroll', ()=>{
  if(scrollRaf) return;
  scrollRaf = true;
  requestAnimationFrame(()=>{
    scrollRaf = false;
    toTopBtn.classList.toggle('show', window.scrollY > 480);
  });
}, {passive:true});
toTopBtn.addEventListener('click', ()=> window.scrollTo({top:0, behavior:'smooth'}));
el('brandLink').addEventListener('click', (e)=>{ e.preventDefault(); window.scrollTo({top:0, behavior:'smooth'}); });

/* Ripple micro-interaction */
(function(){
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(REDUCED) return;
  document.addEventListener('pointerdown', (e)=>{
    const target = e.target.closest('.btn, .banner-btn, .export-tab, .filter-btn, .fnr-apply, .mini-btn, .btn-inline');
    if(!target || target.disabled) return;
    const rect = target.getBoundingClientRect();
    const size = Math.max(rect.width, rect.height);
    const ink = document.createElement('span');
    ink.className = 'ripple-ink';
    ink.style.width = ink.style.height = size + 'px';
    ink.style.left = (e.clientX - rect.left - size/2) + 'px';
    ink.style.top = (e.clientY - rect.top - size/2) + 'px';
    target.appendChild(ink);
    setTimeout(()=>ink.remove(), 600);
  }, {passive:true});
})();

/* ============ 12. PUBLIC API (consumed by js/pro.js and js/cloud-sync.js) ============ */
window.DTV = {
  bus, on, emit,
  get chapters(){ return chapters; },
  get running(){ return running; },
  get paused(){ return paused; },
  get currentIdx(){ return currentIdx; },
  get previewIdx(){ return previewIdx; },
  get exportOrder(){ return exportOrder; },
  set exportOrder(v){ exportOrder = v; },
  get sessionKey(){ return sessionKey; },
  get bookTitle(){ return mTitle.textContent; },
  get bookLang(){ return bookLang; },
  get currentFile(){ return currentFile; },
  get verifyMode(){ return verifyMode; },
  get exportMode(){ return exportMode; },
  settings, THEMES,
  el, showToast, log, formatNum, formatDuration, formatBytes, escapeHtml, escapeAttr, wordCount,
  applyTheme, toggleTheme, getTheme, setStep, setText, setChapterStatus, statusLabel, statusClass,
  previewChapter, stepPreview, renderChapterList, renderEditorList, requestProgressUpdate, refreshDownloadSummary,
  saveSessionProgress, showBanner, hideBanner, showGlobalError, showGlobalWarning,
  getExportChapters, triggerDownload, safeFileName, ensureInView, showHero, showWorkspace,
  setChapterNote, toggleChapterFlag, refreshChapterMarks, selectedChapters, updateBulkBar, clearSelection, bulkApply,
  toggleExpandViewer, toggleShortcuts, toggleComparePanel,
  startRun: ()=>{ if(!startBtn.disabled && !running) startBtn.click(); },
  pauseRun: ()=>{ if(running) pauseBtn.click(); },
  skipChapter: ()=>{ if(running) skipBtn.click(); },
  stopRun: ()=>{ if(running) stopBtn.click(); },
  retryIssues: ()=>{ retryFailedBtn.click(); },
  openFile: ()=>{ if(running) return; fileInput.value=''; fileInput.click(); },
  handleFile, restoreBackupFile,
  setExportMode: (m)=>{ const t = exportTabs.querySelector(`.export-tab[data-mode="${m}"]`); if(t) t.click(); },
  download: ()=> downloadBtn.click(),
  backup: ()=> el('backupExportBtn').click(),
  nodes: { hero, workspace, viewer, viewerPanel, chapList, editorPanel, downloadPanel, globalBanner, resumeBanner, startBtn }
};
emit('ready');
