/* Xplin Go v2 — ui.js
 * Drawer (settings), bottom bar (Chapters · Export · ▶ · Reader · Menu), bottom sheets,
 * translate-status pill + preflight sheet, onboarding, finish stats, reader & advanced
 * settings wiring, recent sessions, mobile-only gate, full screen, PWA.
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

/* ---------- browser-specific translate instructions ---------- */
const bh = XG.browserHint();
['obTranslateHow','hsTranslateHow'].forEach(id=>{ const n = el(id); if(n) n.innerHTML = bh.step + ' → choose your language'; });
el('setupStep1').innerHTML = `Tap ${bh.name}'s <em>${XG.escapeHtml(bh.menu)}</em> menu.`;
el('setupStep2').innerHTML = bh.step + '.';
function syncLangName(){
  const name = XG.langName(S.targetLang);
  el('setupLangName').textContent = name;
  el('translateHint').innerHTML = `${bh.step}, pick <em>${XG.escapeHtml(name)}</em>, then press Start. Every chapter is checked before it's saved.`;
  el('targetLangSel').value = S.targetLang;
}
XG.on('lang:changed', syncLangName);
syncLangName();

/* ---------- scrim / history helpers ---------- */
const drawer = el('drawer'), scrim = el('scrim'), menuBtn = el('menuBtn');
const SHEETS = ['chaptersSheet','exportSheet','readerSheet','setupSheet','statsSheet','chapSheet','editSheet'];
function showScrim(){ scrim.hidden = false; requestAnimationFrame(()=>scrim.classList.add('show')); }
function sheetOpen(id){ const s = el(id); return !s.hidden && s.classList.contains('open'); }
function hideScrimIfIdle(){
  if(drawer.classList.contains('open')) return;
  if(SHEETS.some(sheetOpen)) return;
  scrim.classList.remove('show'); setTimeout(()=>{ if(!scrim.classList.contains('show')) scrim.hidden = true; }, 260);
}
/* One history entry for "a layer is open" so the Android back button closes it.
 * Never stack entries (replaceState when already on a layer) and remember our own
 * programmatic history.back() calls so a late popstate can't close a freshly opened layer. */
let ownBack = 0;
function onLayer(){ return !!(history.state && history.state.xgLayer); }
function anyLayerOpen(){ return drawer.classList.contains('open') || !el('onboard').hidden || SHEETS.some(sheetOpen); }
function pushLayer(tag){ try{ onLayer() ? history.replaceState({xgLayer:tag}, '') : history.pushState({xgLayer:tag}, ''); }catch(e){} }
function popLayer(fromPop){ if(!fromPop && onLayer()){ ownBack++; try{ history.back(); }catch(e){ ownBack--; } } }
window.addEventListener('popstate', ()=>{
  if(ownBack > 0){
    ownBack--;
    /* something opened while our back() was in flight — give it a fresh entry */
    if(anyLayerOpen() && !onLayer()) pushLayer('relayer');
    return;
  }
  closeSheets(true); XG.closeDrawer(true); hideOnboarding(true);
});

/* ---------- drawer ---------- */
XG.openDrawer = function(){
  if(drawer.classList.contains('open')) return;
  closeSheets(true, true);
  drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false');
  showScrim();
  menuBtn.setAttribute('aria-expanded', 'true');
  el('bbMenu').classList.add('on');
  pushLayer('drawer');
};
XG.closeDrawer = function(fromPop){
  if(!drawer.classList.contains('open')) return;
  drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true');
  menuBtn.setAttribute('aria-expanded', 'false');
  el('bbMenu').classList.remove('on');
  hideScrimIfIdle();
  popLayer(fromPop);
};
menuBtn.addEventListener('click', ()=>drawer.classList.contains('open') ? XG.closeDrawer() : XG.openDrawer());
el('drawerClose').addEventListener('click', ()=>XG.closeDrawer());
el('bbMenu').addEventListener('click', ()=>{ XG.buzz(8); drawer.classList.contains('open') ? XG.closeDrawer() : XG.openDrawer(); });

/* collapsible drawer sections (remember state) */
let collapsed = {};
try{ collapsed = JSON.parse(localStorage.getItem('xg_drawer_collapsed') || '{}') || {}; }catch(e){}
document.querySelectorAll('.dsec').forEach(sec=>{
  const key = sec.dataset.sec;
  if(collapsed[key]) sec.classList.add('collapsed');
  const t = sec.querySelector('.dsec-title');
  t.setAttribute('role','button'); t.tabIndex = 0;
  const toggle = ()=>{
    sec.classList.toggle('collapsed'); collapsed[key] = sec.classList.contains('collapsed');
    try{ localStorage.setItem('xg_drawer_collapsed', JSON.stringify(collapsed)); }catch(e){}
  };
  t.addEventListener('click', toggle);
  t.addEventListener('keydown', e=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); toggle(); } });
});
function expandSection(key){ const sec = document.querySelector(`.dsec[data-sec="${key}"]`); if(sec){ sec.classList.remove('collapsed'); collapsed[key] = false; } }

/* quick row in drawer */
el('qChapters').addEventListener('click', ()=>XG.openSheet('chaptersSheet'));
el('qExport').addEventListener('click', ()=>XG.openSheet('exportSheet'));
el('qGuide').addEventListener('click', ()=>{ XG.closeDrawer(true); showOnboarding(); });

/* edge swipe to open, swipe-left on drawer to close */
let sx = null, sy = null, fromEdge = false;
document.addEventListener('touchstart', e=>{
  const t = e.touches[0]; sx = t.clientX; sy = t.clientY;
  fromEdge = sx < 24 && !drawer.classList.contains('open') && !SHEETS.some(sheetOpen) && el('desktopGate').hidden && el('onboard').hidden;
}, {passive:true});
document.addEventListener('touchend', e=>{
  if(sx === null) return;
  const t = e.changedTouches[0], dx = t.clientX - sx, dy = Math.abs(t.clientY - sy);
  if(fromEdge && dx > 60 && dy < 60) XG.openDrawer();
  else if(drawer.classList.contains('open') && dx < -70 && dy < 80 && sx < drawer.offsetWidth) XG.closeDrawer();
  sx = sy = null; fromEdge = false;
}, {passive:true});

/* ---------- bottom sheets ---------- */
XG.openSheet = function(id){
  const s = el(id); if(!s || sheetOpen(id)) return;
  XG.closeDrawer(true);
  /* only one sheet at a time */
  SHEETS.filter(x=>x !== id).forEach(x=>{ const o = el(x); if(!o.hidden){ o.classList.remove('open'); o.hidden = true; } });
  s.hidden = false; s.classList.remove('open'); requestAnimationFrame(()=>s.classList.add('open'));
  showScrim();
  document.querySelectorAll('.bb-item').forEach(b=>b.classList.remove('on'));
  const bb = {chaptersSheet:'bbChapters', exportSheet:'bbExport', readerSheet:'bbReader'}[id];
  if(bb) el(bb).classList.add('on');
  pushLayer(id);
  if(id === 'chaptersSheet') setTimeout(()=>XG.scrollListToCurrent(), 120);
};
function closeSheets(fromPop, silent){
  let any = false;
  SHEETS.forEach(id=>{ const s = el(id); if(!s.hidden && s.classList.contains('open')){ any = true; s.classList.remove('open'); setTimeout(()=>{ if(!s.classList.contains('open')) s.hidden = true; }, 280); } });
  document.querySelectorAll('.bb-item').forEach(b=>b.classList.remove('on'));
  if(drawer.classList.contains('open')) el('bbMenu').classList.add('on');
  if(!any) return false;
  setTimeout(hideScrimIfIdle, 10);
  if(!silent) popLayer(fromPop);
  return true;
}
XG.closeSheets = ()=>closeSheets();
XG.closeAll = function(){ closeSheets(); XG.closeDrawer(); };
scrim.addEventListener('click', ()=>{ if(!closeSheets()) XG.closeDrawer(); });
document.querySelectorAll('.sheet [data-close]').forEach(b=>b.addEventListener('click', ()=>closeSheets()));

/* swipe-down on the handle / head closes a sheet */
document.querySelectorAll('.sheet').forEach(s=>{
  let y0 = null;
  const grab = s.querySelector('.sheet-handle') || s;
  const head = s.querySelector('.sheet-head');
  [grab, head].filter(Boolean).forEach(h=>{
    h.addEventListener('touchstart', e=>{ y0 = e.touches[0].clientY; }, {passive:true});
    h.addEventListener('touchend', e=>{ if(y0 !== null && e.changedTouches[0].clientY - y0 > 60) closeSheets(); y0 = null; }, {passive:true});
  });
});

/* bottom bar */
el('bbChapters').addEventListener('click', ()=>{ XG.buzz(8); sheetOpen('chaptersSheet') ? closeSheets() : XG.openSheet('chaptersSheet'); });
el('bbExport').addEventListener('click', ()=>{ XG.buzz(8); sheetOpen('exportSheet') ? closeSheets() : XG.openSheet('exportSheet'); });
el('bbReader').addEventListener('click', ()=>{ XG.buzz(8); sheetOpen('readerSheet') ? closeSheets() : XG.openSheet('readerSheet'); });
function setBottomBar(on){ el('bottombar').hidden = !on; document.body.classList.toggle('no-bottombar', !on); }
setBottomBar(false);

/* ---------- translate status pill + preflight ---------- */
const tPill = el('tPill');
let preflightResolve = null; /* truthy while the setup sheet is waiting to auto-start */
function renderPill(on){
  tPill.classList.toggle('on', on); tPill.classList.remove('checking');
  el('tPillText').textContent = on ? 'Translate on' : 'Translate off';
  const ss = el('setupStatus');
  ss.classList.toggle('on', on);
  ss.querySelector('span:last-child').textContent = on ? `Translated — you're ready. Tap Start.` : 'Waiting for the page to be translated…';
  el('setupStart').disabled = !on;
  if(on && sheetOpen('setupSheet') && preflightResolve){ XG.buzz(15); setTimeout(()=>{ if(preflightResolve && sheetOpen('setupSheet')) startFromPreflight(); }, 700); }
}
XG.translateDetect.onChange(renderPill);
XG.translateDetect.start();
renderPill(XG.translateDetect.isOn());
tPill.addEventListener('click', ()=>{
  if(XG.translateDetect.isOn()){ XG.toast(`Browser translate is on — page reads as “${(document.documentElement.getAttribute('lang')||'?')}”`, 'ok'); return; }
  tPill.classList.add('checking');
  setTimeout(()=>{ renderPill(XG.translateDetect.check()); }, 500);
  if(!S.chapters.length){ XG.toast('Open a book first, then turn on translate', 'info'); return; }
  XG.openSheet('setupSheet');
});

/* runTranslation() calls XG.preflight(); returns true to proceed now, false to wait for the sheet */
XG.preflight = function(){
  if(XG.translateDetect.check()) return true;
  if(!S.chapters.length) return false;
  preflightResolve = true;
  syncLangName();
  XG.openSheet('setupSheet');
  return false;
};
function startFromPreflight(){
  preflightResolve = null;
  closeSheets();
  setTimeout(()=>XG.runTranslation({skipPreflight:true}), 250);
}
el('setupStart').addEventListener('click', startFromPreflight);
el('setupSkip').addEventListener('click', ()=>{ XG.toast('Starting without translate — chapters may come back unverified', 'warn', 3200); startFromPreflight(); });
XG.on('run:done', ()=>{ preflightResolve = null; });

/* ---------- onboarding ---------- */
function showOnboarding(){ if(!el('onboard').hidden) return; el('onboard').hidden = false; pushLayer('onboard'); }
function hideOnboarding(fromPop){ if(el('onboard').hidden) return; el('onboard').hidden = true; st.onboarded = true; XG.saveSettings(); if(!fromPop) popLayer(); }
el('obDone').addEventListener('click', ()=>hideOnboarding());
el('obSample').addEventListener('click', ()=>{ hideOnboarding(); setTimeout(()=>XG.loadSample(), 200); });
el('onboard').addEventListener('click', e=>{ if(e.target === el('onboard')) hideOnboarding(); });
if(!st.onboarded && el('desktopGate').hidden) setTimeout(showOnboarding, 500);

/* ---------- file open ---------- */
const fileInput = el('fileInput');
fileInput.addEventListener('change', e=>{ const f = e.target.files[0]; if(f) XG.handleFile(f); fileInput.value = ''; });
function pickFile(){ if(S.running){ XG.toast('Stop the current run first', 'warn'); return; } XG.closeAll(); fileInput.click(); }
['openFileBtn','homeOpenBtn'].forEach(id=>el(id).addEventListener('click', pickFile));
['backupImportBtn','homeRestoreBtn'].forEach(id=>el(id).addEventListener('click', ()=>{ if(S.running){ XG.toast('Stop the current run first', 'warn'); return; } el('backupFileInput').click(); }));
el('backupFileInput').addEventListener('change', e=>{ const f = e.target.files[0]; e.target.value = ''; if(f) XG.restoreBackup(f); });
['sampleBtn','homeSampleBtn'].forEach(id=>el(id).addEventListener('click', ()=>{ XG.closeAll(); XG.loadSample(); }));

/* drag & drop (tablets / desktop-forced) */
['dragover','drop'].forEach(ev=>document.addEventListener(ev, e=>{ e.preventDefault(); if(ev === 'drop'){ const f = e.dataTransfer && e.dataTransfer.files[0]; if(f) XG.handleFile(f); } }));

/* ---------- home <-> reader ---------- */
function showReader(){ el('home').hidden = true; el('readerWrap').hidden = false; setBottomBar(true); }
function showHome(){ el('home').hidden = false; el('readerWrap').hidden = true; setBottomBar(false); document.body.classList.remove('immersive'); XG.tts.stop(); }
el('brandLink').addEventListener('click', e=>{ e.preventDefault(); if(S.running){ XG.toast('Translation is running', 'warn'); return; } XG.closeAll(); showHome(); });

XG.on('book:reset', ({file})=>{
  showReader();
  el('fileNameShow').textContent = file ? file.name : 'Restored from backup';
  el('fileSubShow').textContent = file ? XG.formatBytes(file.size) : '';
  el('fileExt').textContent = file ? ((file.name.split('.').pop() || '').toUpperCase().slice(0,4)) : 'JSON';
  XG.closeAll();
});
XG.on('book:loaded', ({title, count})=>{
  el('fileSubShow').textContent = `${title} · ${count} chapter${count>1?'s':''}` + (S.currentFile ? ' · ' + XG.formatBytes(S.currentFile.size) : '');
  XG.toast(`Loaded ${count} chapter${count>1?'s':''} — tap ▶ to start`, 'ok');
  expandSection('run');
  loadRecent();
  if(st.tapZones && (st.runs||0) === 0){ const h = el('tapHint'); h.hidden = false; setTimeout(()=>{ h.hidden = true; }, 2400); }
});
XG.on('book:failed', ()=>{ el('fileSubShow').textContent = 'Could not load'; });
XG.on('parse:progress', ({done, total})=>{ XG.setRunStatus('Extracting…', `page ${done} / ${total}`); });
XG.on('run:done', ()=>setTimeout(loadRecent, 1000)); /* after the debounced session save */

/* ---------- finish stats sheet ---------- */
function fmtDur(ms){ const s = Math.round(ms/1000); if(s < 60) return s + 's'; const m = Math.floor(s/60); return m + 'm ' + String(s%60).padStart(2,'0') + 's'; }
XG.on('run:finished', r=>{
  el('statsTitle').textContent = r.done === r.total ? 'All done 🎉' : 'Run finished';
  el('statsGrid').innerHTML = [
    `<div class="stat ok"><b>${r.verified}</b><span>Verified</span></div>`,
    `<div class="stat ${r.unverified ? 'err' : ''}"><b>${r.unverified}</b><span>Unverified</span></div>`,
    `<div class="stat"><b>${r.skipped}</b><span>Skipped</span></div>`,
    `<div class="stat accent"><b>${r.done}/${r.total}</b><span>Book</span></div>`,
    `<div class="stat"><b>${r.words >= 1000 ? (r.words/1000).toFixed(1) + 'k' : r.words}</b><span>Words</span></div>`,
    `<div class="stat"><b>${fmtDur(r.elapsed)}</b><span>Time</span></div>`
  ].join('');
  el('statsRetry').hidden = !r.unverified;
  setTimeout(()=>XG.openSheet('statsSheet'), 400);
});
el('statsRetry').addEventListener('click', ()=>{ closeSheets(); setTimeout(()=>XG.retryUnverified(), 300); });
el('statsExport').addEventListener('click', ()=>XG.openSheet('exportSheet'));
XG.on('run:done', r=>{
  if(r.stopped || r.verified > 0) return;
  if(r.done === 0) XG.toast('Nothing verified — turn on translate and try again', 'warn', 4000, {label:'How?', onClick:()=>XG.openSheet('setupSheet')});
});

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
      b.innerHTML = `<span class="ri-ring"><svg viewBox="0 0 34 34"><circle class="ring-bg" cx="17" cy="17" r="14"/><circle class="ring-fg" cx="17" cy="17" r="14" style="stroke-dashoffset:${(88 - 88*pct/100).toFixed(1)}"/></svg><span class="ri-pct">${pct}%</span></span><span class="ri-main"><b>${XG.escapeHtml(s.bookTitle || 'Untitled')}</b><small>${done}/${s.chapters.length} chapters · ${new Date(s.savedAt||0).toLocaleDateString()}</small></span>`;
      b.addEventListener('click', ()=>openSaved(s));
      let lp = null;
      b.addEventListener('touchstart', ()=>{ lp = setTimeout(()=>{ lp = null; XG.buzz(20); deleteSaved(s); }, 600); }, {passive:true});
      ['touchend','touchmove','touchcancel'].forEach(ev=>b.addEventListener(ev, ()=>{ if(lp){ clearTimeout(lp); lp = null; } }, {passive:true}));
      b.addEventListener('contextmenu', e=>{ e.preventDefault(); deleteSaved(s); });
      list.appendChild(b);
    });
  };
  render(el('recentWrap'), el('recentList'));
  render(el('homeRecent'), el('homeRecentList'));
}
async function deleteSaved(s){
  if(!confirm(`Delete saved progress for “${s.bookTitle || 'Untitled'}”?`)) return;
  await XG.idbDelete(s.key); loadRecent(); XG.toast('Deleted', 'ok');
}
function openSaved(s){
  if(S.running){ XG.toast('Stop the current run first', 'warn'); return; }
  XG.resetForNewFile(null);
  el('fileNameShow').textContent = s.fileName || s.bookTitle || 'Saved session';
  el('fileExt').textContent = 'SAVE';
  S.chapters = s.chapters.map((sc,i)=>({ index:i, title:sc.title || ('Chapter ' + (i+1)), item:null, html:null, status: sc.status === 'active' || sc.status === 'retry' ? 'pending' : (sc.status || 'pending'), text: sc.text || '', wc: XG.wordCount(sc.text||''), originalText: sc.originalText || '', retries:0, excluded: !!sc.excluded, durMs: sc.durMs||0, doneAt: sc.doneAt||0 }));
  /* pending chapters can only be re-translated from the saved snapshot if the original was kept */
  S.chapters.forEach(c=>{ if(!c.text && c.originalText) c.html = c.originalText.split(/\n+/).map(p=>`<p>${XG.escapeHtml(p)}</p>`).join(''); });
  S.bookTitle = s.bookTitle || 'Saved book'; S.bookLang = s.bookLang || 'en';
  S.exportOrder = (Array.isArray(s.exportOrder) && s.exportOrder.length === S.chapters.length) ? s.exportOrder.slice() : S.chapters.map((c,i)=>i);
  S.sessionKey = s.key;
  XG.emit('book:loaded', {title:S.bookTitle, count:S.chapters.length, lang:S.bookLang, restored:true});
  const pending = S.chapters.filter(c=>c.status !== 'done' && !c.html).length;
  if(pending) XG.toast(`${pending} chapters need the original file to translate`, 'info', 4200, {label:'Open file', onClick:pickFile});
}
loadRecent();

el('clearDataBtn').addEventListener('click', async ()=>{
  if(!confirm('Delete all saved sessions on this phone?')) return;
  await XG.idbClear(); loadRecent(); XG.toast('Saved sessions cleared', 'ok');
});

/* ---------- chapter actions sheet ---------- */
let sheetIdx = -1;
XG.openChapSheet = function(i){
  sheetIdx = i; const c = S.chapters[i]; if(!c) return;
  el('sheetTitle').textContent = `${i+1}. ${c.title}`;
  const q = a=>el('chapSheet').querySelector(`[data-act=${a}]`);
  q('toggleExclude').textContent = c.excluded ? 'Include in export' : 'Exclude from export';
  q('edit').disabled = !(c.text && c.text.trim());
  q('copy').disabled = !(c.text && c.text.trim());
  q('listen').disabled = !(XG.tts.ok && c.text && c.text.trim());
  q('retranslate').disabled = S.running;
  q('retranslate').textContent = c.status === 'done' ? 'Re-translate this chapter' : 'Translate this chapter';
  XG.openSheet('chapSheet');
};
el('chapSheet').addEventListener('click', e=>{
  const b = e.target.closest('.sheet-item'); if(!b || b.disabled) return;
  const act = b.dataset.act, i = sheetIdx, c = S.chapters[i];
  if(act === 'edit'){
    el('editTitle').textContent = `Edit · ${c.title}`; el('editArea').value = c.text || '';
    XG.openSheet('editSheet');
    setTimeout(()=>el('editArea').focus(), 320);
    return;
  }
  XG.closeAll();
  if(act === 'view'){ XG.previewChapter(i); }
  else if(act === 'retranslate'){ setTimeout(()=>XG.retranslateChapter(i), 300); }
  else if(act === 'listen'){ setTimeout(()=>XG.listenChapter(i), 300); }
  else if(act === 'toggleExclude'){ c.excluded = !c.excluded; XG.refreshRow(i); XG.saveSession(); XG.updateProgress(); XG.toast(c.excluded ? 'Excluded from export' : 'Included in export'); }
  else if(act === 'copy'){ XG.copyChapter(i); }
});
el('editCancel').addEventListener('click', ()=>closeSheets());
el('editSave').addEventListener('click', ()=>{
  const c = S.chapters[sheetIdx]; if(!c) return;
  XG.setChapterText(c, el('editArea').value);
  if(c.text.trim() && c.status !== 'done') c.status = 'done';
  XG.refreshRow(sheetIdx); XG.saveSession(); XG.updateProgress(); XG.setControls();
  if(S.previewIdx === sheetIdx) XG.previewChapter(sheetIdx);
  closeSheets(); XG.toast('Saved', 'ok');
});
/* tap chapter title in the reader → chapter list */
el('viewerLabel').addEventListener('click', ()=>{ if(S.chapters.length) XG.openSheet('chaptersSheet'); });

/* ---------- reader settings (drawer + reader sheet stay in sync) ---------- */
const FS_MIN = 14, FS_MAX = 28, LH_MIN = 1.3, LH_MAX = 2.2;
function applyReader(){
  st.fontSize = Math.min(FS_MAX, Math.max(FS_MIN, st.fontSize));
  st.lineHeight = Math.round(Math.min(LH_MAX, Math.max(LH_MIN, st.lineHeight)) * 100) / 100;
  document.documentElement.style.setProperty('--reader-fs', st.fontSize + 'px');
  document.documentElement.style.setProperty('--reader-lh', st.lineHeight);
  document.documentElement.dataset.font = st.fontFamily;
  const lh = Number(st.lineHeight).toFixed(2).replace(/0$/,'');
  el('fontSizeVal').textContent = st.fontSize + 'px'; el('fontSizeVal2').textContent = st.fontSize;
  el('lineHeightVal').textContent = lh; el('lineHeightVal2').textContent = lh;
  el('fontSize').value = st.fontSize; el('lineHeight').value = st.lineHeight; el('fontFamily').value = st.fontFamily;
  el('fontSeg').querySelectorAll('button').forEach(b=>b.classList.toggle('active', b.dataset.font === st.fontFamily));
  el('setCompare').checked = st.compare; el('setCompare2').checked = st.compare;
}
XG.applyReader = applyReader;
el('fontSize').addEventListener('input', e=>{ st.fontSize = parseInt(e.target.value,10); applyReader(); XG.saveSettings(); });
el('lineHeight').addEventListener('input', e=>{ st.lineHeight = parseFloat(e.target.value); applyReader(); XG.saveSettings(); });
el('fontFamily').addEventListener('change', e=>{ st.fontFamily = e.target.value; applyReader(); XG.saveSettings(); });
el('fsMinus').addEventListener('click', ()=>{ st.fontSize -= 1; applyReader(); XG.saveSettings(); XG.buzz(6); });
el('fsPlus').addEventListener('click', ()=>{ st.fontSize += 1; applyReader(); XG.saveSettings(); XG.buzz(6); });
el('lhMinus').addEventListener('click', ()=>{ st.lineHeight -= 0.1; applyReader(); XG.saveSettings(); XG.buzz(6); });
el('lhPlus').addEventListener('click', ()=>{ st.lineHeight += 0.1; applyReader(); XG.saveSettings(); XG.buzz(6); });
el('fontSeg').addEventListener('click', e=>{ const b = e.target.closest('button'); if(!b) return; st.fontFamily = b.dataset.font; applyReader(); XG.saveSettings(); });
['themeRow','themeRow2'].forEach(id=>el(id).addEventListener('click', e=>{ const b = e.target.closest('.theme-dot'); if(b){ XG.applyTheme(b.dataset.theme); XG.buzz(10); } }));
['setCompare','setCompare2'].forEach(id=>el(id).addEventListener('change', e=>{ st.compare = e.target.checked; applyReader(); XG.saveSettings(); XG.refreshCompare(); }));
el('setTapZones').addEventListener('change', e=>{ st.tapZones = e.target.checked; XG.saveSettings(); });
el('setWake').addEventListener('change', e=>{ st.wake = e.target.checked; XG.saveSettings(); if(!st.wake) XG.releaseWakeLock(); else if(S.running) XG.acquireWakeLock(); });
XG.applyTheme(XG.getTheme());
applyReader();

/* pinch-to-zoom text size in the viewer */
(function pinch(){
  const v = el('viewer'); let d0 = null, fs0 = 0;
  v.addEventListener('touchstart', e=>{ if(e.touches.length === 2){ d0 = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY); fs0 = st.fontSize; } }, {passive:true});
  v.addEventListener('touchmove', e=>{
    if(d0 && e.touches.length === 2){
      const d = Math.hypot(e.touches[0].clientX-e.touches[1].clientX, e.touches[0].clientY-e.touches[1].clientY);
      const fs = Math.round(Math.min(FS_MAX, Math.max(FS_MIN, fs0 * d / d0)));
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
  el('setWake').checked = st.wake; el('setTapZones').checked = st.tapZones;
}
el('setTimeout').addEventListener('input', e=>{ st.timeoutMs = parseInt(e.target.value,10)*1000; syncAdvanced(); XG.saveSettings(); });
el('setRetries').addEventListener('input', e=>{ st.maxRetries = parseInt(e.target.value,10); syncAdvanced(); XG.saveSettings(); });
el('setGap').addEventListener('input', e=>{ st.gapMs = parseInt(e.target.value,10); syncAdvanced(); XG.saveSettings(); });
el('setScroll').addEventListener('input', e=>{ st.scrollMs = parseInt(e.target.value,10); syncAdvanced(); XG.saveSettings(); });
el('setSound').addEventListener('change', e=>{ st.sound = e.target.checked; XG.saveSettings(); if(st.sound) XG.chime(); });
el('setVibrate').addEventListener('change', e=>{ st.vibrate = e.target.checked; XG.saveSettings(); XG.buzz(20); });
el('setMemSaver').addEventListener('change', e=>{ st.memSaver = e.target.checked; XG.saveSettings(); });
syncAdvanced();

/* ---------- full screen / immersive ---------- */
el('fullscreenBtn').addEventListener('click', async ()=>{
  const d = document;
  try{
    if(!d.fullscreenElement && d.documentElement.requestFullscreen){ await d.documentElement.requestFullscreen({navigationUI:'hide'}); document.body.classList.add('immersive'); }
    else if(d.fullscreenElement){ await d.exitFullscreen(); document.body.classList.remove('immersive'); }
    else { document.body.classList.toggle('immersive'); }
  }catch(e){ document.body.classList.toggle('immersive'); }
  XG.buzz(8);
});
document.addEventListener('fullscreenchange', ()=>{ if(!document.fullscreenElement && !S.running) document.body.classList.remove('immersive'); });
/* tap the reader header (not its buttons) to toggle the bars */
el('readerTop').addEventListener('click', e=>{ if(e.target.closest('button')) return; document.body.classList.toggle('immersive'); });
/* keyboard (external / desktop-forced) */
document.addEventListener('keydown', e=>{
  if(e.target.matches('input,textarea,select')) return;
  if(e.key === 'Escape'){ if(!closeSheets()) { XG.closeDrawer(); hideOnboarding(); } }
  else if(e.key === 'ArrowLeft'){ el('prevChapBtn').click(); }
  else if(e.key === 'ArrowRight'){ el('nextChapBtn').click(); }
  else if(e.key === ' ' && S.chapters.length){ e.preventDefault(); el('fab').click(); }
  else if(e.key === 'c' || e.key === 'C'){ if(S.chapters.length) XG.openSheet('chaptersSheet'); }
  else if(e.key === 'e' || e.key === 'E'){ if(S.chapters.length) XG.openSheet('exportSheet'); }
  else if(e.key === 'm' || e.key === 'M'){ drawer.classList.contains('open') ? XG.closeDrawer() : XG.openDrawer(); }
});

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
window.addEventListener('appinstalled', ()=>{ el('installBtn').hidden = true; XG.toast('Xplin Go installed', 'ok'); });
if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').then(reg=>{
      reg.addEventListener('updatefound', ()=>{
        const nw = reg.installing; if(!nw) return;
        nw.addEventListener('statechange', ()=>{
          if(nw.state === 'installed' && navigator.serviceWorker.controller && !S.running)
            XG.toast('Update ready', 'info', 6000, {label:'Reload', onClick:()=>{ nw.postMessage('SKIP_WAITING'); setTimeout(()=>location.reload(), 300); }});
        });
      });
    }).catch(()=>{});
  });
}
window.addEventListener('online', ()=>XG.toast('Back online', 'ok', 1500));
window.addEventListener('offline', ()=>XG.toast('Offline — translate needs a connection', 'warn', 3500));

/* ?action=open shortcut */
try{ if(new URLSearchParams(location.search).get('action') === 'open') setTimeout(()=>fileInput.click(), 400); }catch(e){}
})();
