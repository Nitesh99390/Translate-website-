/* Xplin Go — ui.js
 * Drawer (hamburger menu), mobile-only gate, home/reader switching, bottom sheets,
 * reader & advanced settings wiring, recent sessions, full screen, PWA.
 */
'use strict';
(function(){
const XG = window.XG, S = XG.state, el = XG.el, st = XG.settings;

/* ---------- mobile-only gate ---------- */
function isMobile(){
  const ua = navigator.userAgent || '';
  const uaMobile = /Android|iPhone|iPad|iPod|Mobile|Silk|Opera Mini|IEMobile|BlackBerry/i.test(ua) || (navigator.userAgentData && navigator.userAgentData.mobile);
  const touch = ('ontouchstart' in window) || navigator.maxTouchPoints > 1;
  const narrow = Math.min(screen.width, screen.height) <= 900;
  return !!(uaMobile || (touch && narrow));
}
(function gate(){
  let force = false;
  try{ force = sessionStorage.getItem('xg_force_desktop') === '1'; }catch(e){}
  if(isMobile() || force) return;
  el('desktopGate').hidden = false;
  el('gateForceBtn').addEventListener('click', ()=>{
    try{ sessionStorage.setItem('xg_force_desktop', '1'); }catch(e){}
    el('desktopGate').hidden = true;
  });
})();

/* ---------- drawer ---------- */
const drawer = el('drawer'), scrim = el('scrim'), menuBtn = el('menuBtn');
XG.openDrawer = function(){
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  scrim.hidden = false; requestAnimationFrame(()=>scrim.classList.add('show'));
  menuBtn.setAttribute('aria-expanded', 'true');
  history.pushState({xgDrawer:1}, '');
};
XG.closeDrawer = function(fromPop){
  if(!drawer.classList.contains('open')) return;
  drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
  scrim.classList.remove('show'); setTimeout(()=>{ scrim.hidden = true; }, 260);
  menuBtn.setAttribute('aria-expanded', 'false');
  if(!fromPop && history.state && history.state.xgDrawer) history.back();
};
menuBtn.addEventListener('click', ()=>drawer.classList.contains('open') ? XG.closeDrawer() : XG.openDrawer());
el('drawerClose').addEventListener('click', ()=>XG.closeDrawer());
scrim.addEventListener('click', ()=>XG.closeDrawer());
window.addEventListener('popstate', ()=>{ XG.closeDrawer(true); closeSheets(true); });

/* edge swipe to open, swipe-left on drawer to close */
let sx = null, sy = null, fromEdge = false;
document.addEventListener('touchstart', e=>{
  const t = e.touches[0]; sx = t.clientX; sy = t.clientY; fromEdge = sx < 24 && !drawer.classList.contains('open');
}, {passive:true});
document.addEventListener('touchend', e=>{
  if(sx === null) return;
  const t = e.changedTouches[0], dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
  if(fromEdge && dx > 60 && dy < 60) XG.openDrawer();
  else if(drawer.classList.contains('open') && dx < -70 && dy < 80 && sx < drawer.offsetWidth) XG.closeDrawer();
  sx = sy = null; fromEdge = false;
}, {passive:true});

/* ---------- file open ---------- */
const fileInput = el('fileInput');
fileInput.addEventListener('change', e=>{ const f = e.target.files[0]; if(f) XG.handleFile(f); fileInput.value = ''; });
['openFileBtn','homeOpenBtn'].forEach(id=>el(id).addEventListener('click', ()=>{ if(S.running){ XG.toast('Stop the current run first', 'warn'); return; } fileInput.click(); }));
el('backupImportBtn').addEventListener('click', ()=>el('backupFileInput').click());
el('backupFileInput').addEventListener('change', e=>{ const f = e.target.files[0]; e.target.value = ''; if(f) XG.restoreBackup(f); });

/* ---------- home <-> reader ---------- */
function showReader(){ el('home').hidden = true; el('readerWrap').hidden = false; }
function showHome(){ el('home').hidden = false; el('readerWrap').hidden = true; el('fab').hidden = true; document.body.classList.remove('immersive'); }
el('brandLink').addEventListener('click', e=>{ e.preventDefault(); if(S.running){ XG.toast('Translation is running', 'warn'); return; } showHome(); XG.closeDrawer(); });

XG.on('book:reset', ({file})=>{
  showReader();
  el('fileNameShow').textContent = file ? file.name : 'Restored from backup';
  el('fileSubShow').textContent = file ? XG.formatBytes(file.size) : '';
  const ext = file ? (file.name.split('.').pop() || '').toUpperCase().slice(0,4) : 'JSON';
  el('fileExt').textContent = ext;
  XG.closeDrawer();
});
XG.on('book:loaded', ({title, count})=>{
  el('fileSubShow').textContent = `${title} · ${count} chapter${count>1?'s':''}` + (S.currentFile ? ' · ' + XG.formatBytes(S.currentFile.size) : '');
  XG.toast(`Loaded ${count} chapter${count>1?'s':''}`, 'ok');
  el('fab').hidden = false;
  setTimeout(()=>XG.openDrawer(), 350);
  loadRecent();
});
XG.on('parse:progress', ({done, total})=>{ XG.setRunStatus('Extracting…', `page ${done} / ${total}`); });
XG.on('run:done', loadRecent);

/* ---------- recent sessions ---------- */
async function loadRecent(){
  const all = (await XG.idbAll()).filter(s=>s && s.chapters && s.chapters.length).sort((a,b)=>(b.savedAt||0)-(a.savedAt||0)).slice(0, 6);
  const render = (wrap, list)=>{
    list.innerHTML = '';
    if(!all.length){ wrap.hidden = true; return; }
    wrap.hidden = false;
    all.forEach(s=>{
      const done = s.chapters.filter(c=>c.status==='done').length;
      const pct = Math.round(done / s.chapters.length * 100);
      const b = document.createElement('button');
      b.className = 'recent-item';
      b.innerHTML = `<span class="ri-main"><b>${XG.escapeHtml(s.bookTitle || 'Untitled')}</b><small>${done}/${s.chapters.length} chapters · ${new Date(s.savedAt||0).toLocaleDateString()}</small></span><span class="ri-pct">${pct}%</span>`;
      b.addEventListener('click', ()=>openSaved(s));
      list.appendChild(b);
    });
  };
  render(el('recentWrap'), el('recentList'));
  render(el('homeRecent'), el('homeRecentList'));
}
function openSaved(s){
  if(S.running){ XG.toast('Stop the current run first', 'warn'); return; }
  XG.resetForNewFile(null);
  el('fileNameShow').textContent = s.fileName || s.bookTitle || 'Saved session';
  el('fileExt').textContent = 'SAVE';
  S.chapters = s.chapters.map((sc,i)=>({ index:i, title:sc.title || ('Chapter ' + (i+1)), item:null, html:null, status: sc.status === 'active' || sc.status === 'retry' ? 'pending' : (sc.status || 'pending'), text: sc.text || '', wc: XG.wordCount(sc.text||''), originalText: sc.originalText || '', retries:0, excluded: !!sc.excluded }));
  /* originals only (no source file): pending chapters can't be re-translated from the saved snapshot unless the original was kept */
  S.chapters.forEach(c=>{ if(!c.text && c.originalText) c.html = c.originalText.split(/\n+/).map(p=>`<p>${XG.escapeHtml(p)}</p>`).join(''); });
  S.bookTitle = s.bookTitle || 'Saved book'; S.bookLang = s.bookLang || 'en';
  S.exportOrder = (Array.isArray(s.exportOrder) && s.exportOrder.length === S.chapters.length) ? s.exportOrder.slice() : S.chapters.map((c,i)=>i);
  S.sessionKey = s.key;
  XG.emit('book:loaded', {title:S.bookTitle, count:S.chapters.length, lang:S.bookLang, restored:true});
  const pending = S.chapters.filter(c=>c.status !== 'done').length;
  if(pending) XG.toast(`${pending} chapters still pending — open the original file to translate them`, 'info', 4200);
}
loadRecent();

el('clearDataBtn').addEventListener('click', async ()=>{
  if(!confirm('Delete all saved sessions on this phone?')) return;
  await XG.idbClear(); loadRecent(); XG.toast('Saved sessions cleared', 'ok');
});

/* ---------- bottom sheets ---------- */
let sheetIdx = -1;
function openSheet(id){ const s = el(id); s.hidden = false; requestAnimationFrame(()=>s.classList.add('open')); scrim.hidden = false; requestAnimationFrame(()=>scrim.classList.add('show')); history.pushState({xgSheet:1}, ''); }
function closeSheets(fromPop){
  let any = false;
  ['chapSheet','editSheet'].forEach(id=>{ const s = el(id); if(!s.hidden){ any = true; s.classList.remove('open'); setTimeout(()=>{ s.hidden = true; }, 280); } });
  if(any && !drawer.classList.contains('open')){ scrim.classList.remove('show'); setTimeout(()=>{ scrim.hidden = true; }, 260); }
  if(any && !fromPop && history.state && history.state.xgSheet) history.back();
}
scrim.addEventListener('click', ()=>closeSheets());
XG.openChapSheet = function(i){
  sheetIdx = i; const c = S.chapters[i];
  el('sheetTitle').textContent = `${i+1}. ${c.title}`;
  el('chapSheet').querySelector('[data-act=toggleExclude]').textContent = c.excluded ? 'Include in export' : 'Exclude from export';
  el('chapSheet').querySelector('[data-act=edit]').disabled = !(c.text && c.text.trim());
  el('chapSheet').querySelector('[data-act=retranslate]').disabled = S.running;
  openSheet('chapSheet');
};
el('chapSheet').addEventListener('click', e=>{
  const b = e.target.closest('.sheet-item'); if(!b) return;
  const act = b.dataset.act, i = sheetIdx, c = S.chapters[i];
  closeSheets();
  if(act === 'view'){ XG.previewChapter(i); XG.closeDrawer(); }
  else if(act === 'retranslate'){ XG.retranslateChapter(i); }
  else if(act === 'toggleExclude'){ c.excluded = !c.excluded; XG.refreshRow(i); XG.saveSession(); XG.updateProgress(); XG.toast(c.excluded ? 'Excluded from export' : 'Included in export'); }
  else if(act === 'copy'){ XG.copyChapter(i); }
  else if(act === 'edit'){
    setTimeout(()=>{ el('editTitle').textContent = `Edit · ${c.title}`; el('editArea').value = c.text || ''; openSheet('editSheet'); }, 300);
  }
});
el('editCancel').addEventListener('click', ()=>closeSheets());
el('editSave').addEventListener('click', ()=>{
  const c = S.chapters[sheetIdx]; if(!c) return;
  XG.setChapterText(c, el('editArea').value);
  if(c.text.trim() && c.status !== 'done') c.status = 'done';
  XG.refreshRow(sheetIdx); XG.saveSession(); XG.updateProgress();
  if(S.previewIdx === sheetIdx) XG.previewChapter(sheetIdx);
  closeSheets(); XG.toast('Saved', 'ok');
});

/* ---------- reader settings ---------- */
function applyReader(){
  document.documentElement.style.setProperty('--reader-fs', st.fontSize + 'px');
  document.documentElement.style.setProperty('--reader-lh', st.lineHeight);
  document.documentElement.dataset.font = st.fontFamily;
  el('fontSizeVal').textContent = st.fontSize + 'px'; el('lineHeightVal').textContent = Number(st.lineHeight).toFixed(2).replace(/0$/,'');
  el('fontSize').value = st.fontSize; el('lineHeight').value = st.lineHeight; el('fontFamily').value = st.fontFamily;
}
el('fontSize').addEventListener('input', e=>{ st.fontSize = parseInt(e.target.value,10); applyReader(); XG.saveSettings(); });
el('lineHeight').addEventListener('input', e=>{ st.lineHeight = parseFloat(e.target.value); applyReader(); XG.saveSettings(); });
el('fontFamily').addEventListener('change', e=>{ st.fontFamily = e.target.value; applyReader(); XG.saveSettings(); });
el('themeRow').addEventListener('click', e=>{ const b = e.target.closest('.theme-dot'); if(b){ XG.applyTheme(b.dataset.theme); XG.buzz(10); } });
XG.applyTheme(XG.getTheme());
applyReader();

/* pinch-to-zoom text size in the viewer */
(function pinch(){
  const v = el('viewer'); let d0 = null, fs0 = 0;
  v.addEventListener('touchstart', e=>{ if(e.touches.length === 2){ d0 = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); fs0 = st.fontSize; } }, {passive:true});
  v.addEventListener('touchmove', e=>{
    if(d0 && e.touches.length === 2){
      const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      const fs = Math.round(Math.min(26, Math.max(14, fs0 * d / d0)));
      if(fs !== st.fontSize){ st.fontSize = fs; applyReader(); }
    }
  }, {passive:true});
  v.addEventListener('touchend', ()=>{ if(d0){ d0 = null; XG.saveSettings(); } }, {passive:true});
})();

/* ---------- advanced settings ---------- */
function syncAdvanced(){
  el('setTimeout').value = Math.round(st.timeoutMs/1000); el('setTimeoutVal').textContent = Math.round(st.timeoutMs/1000) + 's';
  el('setRetries').value = st.maxRetries; el('setRetriesVal').textContent = st.maxRetries;
  el('setGap').value = st.gapMs; el('setGapVal').textContent = (st.gapMs/1000).toFixed(2).replace(/\.?0+$/,'') + 's';
  el('setScroll').value = st.scrollMs; el('setScrollVal').textContent = st.scrollMs + 'ms';
  el('setSound').checked = st.sound; el('setVibrate').checked = st.vibrate; el('setMemSaver').checked = st.memSaver;
  el('setWake').checked = st.wake; el('setCompare').checked = st.compare;
  el('targetLang').value = S.verifyMode;
}
el('setTimeout').addEventListener('input', e=>{ st.timeoutMs = parseInt(e.target.value,10)*1000; syncAdvanced(); XG.saveSettings(); });
el('setRetries').addEventListener('input', e=>{ st.maxRetries = parseInt(e.target.value,10); syncAdvanced(); XG.saveSettings(); });
el('setGap').addEventListener('input', e=>{ st.gapMs = parseInt(e.target.value,10); syncAdvanced(); XG.saveSettings(); });
el('setScroll').addEventListener('input', e=>{ st.scrollMs = parseInt(e.target.value,10); syncAdvanced(); XG.saveSettings(); });
el('setSound').addEventListener('change', e=>{ st.sound = e.target.checked; XG.saveSettings(); });
el('setVibrate').addEventListener('change', e=>{ st.vibrate = e.target.checked; XG.saveSettings(); });
el('setMemSaver').addEventListener('change', e=>{ st.memSaver = e.target.checked; XG.saveSettings(); });
el('setWake').addEventListener('change', e=>{ st.wake = e.target.checked; XG.saveSettings(); if(!st.wake) XG.releaseWakeLock(); else if(S.running) XG.acquireWakeLock(); });
el('setCompare').addEventListener('change', e=>{ st.compare = e.target.checked; XG.saveSettings(); XG.refreshCompare(); });
syncAdvanced();

/* ---------- full screen / immersive ---------- */
el('fullscreenBtn').addEventListener('click', async ()=>{
  const d = document;
  try{
    if(!d.fullscreenElement && d.documentElement.requestFullscreen){ await d.documentElement.requestFullscreen({navigationUI:'hide'}); document.body.classList.add('immersive'); }
    else if(d.fullscreenElement){ await d.exitFullscreen(); document.body.classList.remove('immersive'); }
    else { document.body.classList.toggle('immersive'); }
  }catch(e){ document.body.classList.toggle('immersive'); }
});
document.addEventListener('fullscreenchange', ()=>{ if(!document.fullscreenElement && !S.running) document.body.classList.remove('immersive'); });
/* tap the reader title area to bring the app bar back while immersive */
el('readerTop').addEventListener('click', e=>{ if(e.target.closest('button')) return; document.body.classList.toggle('immersive'); });

/* ---------- layout switcher (remember choice) ---------- */
document.querySelectorAll('a[href*="?ui=new"]').forEach(a=>a.addEventListener('click', ()=>{ try{ localStorage.setItem('nx_ui_version','new'); sessionStorage.setItem('nx_ui_switched','1'); }catch(e){} }));
document.querySelectorAll('a[href*="?ui=classic"]').forEach(a=>a.addEventListener('click', ()=>{ try{ localStorage.setItem('nx_ui_version','classic'); sessionStorage.setItem('nx_ui_switched','1'); }catch(e){} }));
try{ if(isMobile()) localStorage.setItem('nx_ui_version','mobile'); }catch(e){}

/* ---------- leave guard ---------- */
window.addEventListener('beforeunload', e=>{ if(S.running){ e.preventDefault(); e.returnValue = ''; } });

/* ---------- PWA ---------- */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredInstall = e; el('installBtn').hidden = false; });
el('installBtn').addEventListener('click', async ()=>{ if(!deferredInstall) return; deferredInstall.prompt(); await deferredInstall.userChoice.catch(()=>{}); deferredInstall = null; el('installBtn').hidden = true; });
if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
  window.addEventListener('load', ()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
}

/* ?action=open shortcut */
try{ if(new URLSearchParams(location.search).get('action') === 'open') setTimeout(()=>fileInput.click(), 400); }catch(e){}
})();
