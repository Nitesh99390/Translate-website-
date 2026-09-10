/* Xplin Go — run.js
 * Full-screen viewer, chapter list, translate-verify loop.
 * The viewer fills the phone screen so Chrome's page translator sees the whole chapter.
 */
'use strict';
(function(){
const XG = window.XG, S = XG.state, el = XG.el;

const viewer = el('viewer'), viewerLabel = el('viewerLabel'), scrollBar = el('viewerScrollBar');
const liveBadge = el('liveBadge'), chapList = el('chapList');
let statusFilter = 'all', textFilter = '';

/* ---------- verify helpers ---------- */
function nonLatin(str){ return /[\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u0980-\u09FF\u0A00-\u0A7F\u0B80-\u0BFF\u0C00-\u0C7F]/.test(str); }
function divergence(a, b){
  a = (a||'').trim(); b = (b||'').trim();
  if(!a && !b) return 0; if(!a || !b) return 1; if(a === b) return 0;
  const wa = a.toLowerCase().split(/\s+/), wb = new Set(b.toLowerCase().split(/\s+/));
  let common = 0; wa.forEach(w=>{ if(wb.has(w)) common++; });
  return 1 - common / wa.length;
}
function isTranslated(now, orig, elapsed){
  if(!now.trim()) return false;
  if(S.verifyMode === 'script') return nonLatin(now);
  if(S.verifyMode === 'latin') return elapsed > 2500 && divergence(orig, now) > 0.35;
  if(nonLatin(now)) return true;
  return elapsed > 2800 && divergence(orig, now) > 0.4;
}
function waitForTranslation(node, orig, timeoutMs){
  return new Promise(resolve=>{
    const start = Date.now();
    const t = setInterval(()=>{
      if(S.skipRequested || S.stopRequested){ clearInterval(t); resolve({success:false, interrupted:true, text: node.innerText||''}); return; }
      const now = node.innerText || '', elapsed = Date.now() - start;
      if(isTranslated(now, orig, elapsed)){ clearInterval(t); resolve({success:true, text: now}); return; }
      if(elapsed > timeoutMs){ clearInterval(t); resolve({success:false, text: now}); }
    }, 400);
  });
}

/* ---------- auto scroll (full screen) ---------- */
function updateScrollBar(){
  const max = viewer.scrollHeight - viewer.clientHeight;
  scrollBar.style.width = max > 0 ? Math.min(100, viewer.scrollTop / max * 100) + '%' : '0%';
}
viewer.addEventListener('scroll', updateScrollBar, {passive:true});
function autoScroll(node){
  return new Promise(resolve=>{
    node.scrollTop = 0;
    const max = node.scrollHeight - node.clientHeight;
    if(max <= 0){ resolve(); return; }
    const step = Math.max(120, Math.floor(node.clientHeight * 0.8));
    const steps = Math.ceil(max / step);
    const duration = Math.max(450, steps * XG.settings.scrollMs);
    const start = performance.now();
    const ease = t => t < .5 ? 2*t*t : -1 + (4 - 2*t) * t;
    const schedule = cb => document.hidden ? setTimeout(()=>cb(performance.now()), 200) : requestAnimationFrame(cb);
    function frame(now){
      if(S.skipRequested || S.stopRequested){ node.scrollTop = 0; updateScrollBar(); resolve(); return; }
      const t = Math.min(1, (now - start) / duration);
      node.scrollTop = ease(t) * max; updateScrollBar();
      if(t < 1) schedule(frame);
      else setTimeout(()=>{ node.scrollTop = 0; updateScrollBar(); resolve(); }, 160);
    }
    schedule(frame);
  });
}

/* ---------- chapter content ---------- */
async function loadChapterHtml(c){
  if(c.item){
    if(c.item.document && c.item.document.body) return c.item.document.body.innerHTML;
    await c.item.load(S.book.load.bind(S.book));
    if(c.item.document && c.item.document.body) return c.item.document.body.innerHTML;
    return '';
  }
  return c.html || '';
}
function unload(c){ if(c.item && typeof c.item.unload === 'function'){ try{ c.item.unload(); }catch(e){} } }
function storeOriginal(c, full){ c.originalText = (XG.settings.memSaver && full.length > XG.ORIG_SNIPPET) ? full.slice(0, XG.ORIG_SNIPPET) : full; }
function setLive(on){ liveBadge.classList.toggle('on', on); viewer.classList.toggle('live', on); }

XG.previewChapter = async function(i){
  const c = S.chapters[i]; if(!c) return;
  S.previewIdx = i;
  viewerLabel.textContent = `${i+1}/${S.chapters.length} · ${c.title}`;
  if(c.text && c.text.trim()){
    viewer.setAttribute('translate', 'no'); viewer.classList.add('notranslate');
    viewer.innerHTML = c.text.split(/\n+/).map(p=>p.trim()).filter(Boolean).map(p=>`<p>${XG.escapeHtml(p)}</p>`).join('');
  } else {
    viewer.removeAttribute('translate'); viewer.classList.remove('notranslate');
    let html = '';
    try{ html = await loadChapterHtml(c); }catch(e){}
    if(S.previewIdx !== i) return;
    viewer.innerHTML = html || '<div class="ph">Empty chapter</div>';
    if(!c.originalText) storeOriginal(c, viewer.innerText);
    unload(c);
  }
  viewer.scrollTop = 0; updateScrollBar();
  updateCompare(c);
  highlightRow();
  el('prevChapBtn').disabled = i <= 0; el('nextChapBtn').disabled = i >= S.chapters.length - 1;
};
function updateCompare(c){
  const p = el('comparePanel');
  if(!XG.settings.compare || !c || !(c.text && c.text.trim())){ p.hidden = true; return; }
  el('compareBody').textContent = c.originalText || '(original not kept)';
  p.hidden = false;
}
XG.refreshCompare = ()=>updateCompare(S.chapters[S.previewIdx]);
el('prevChapBtn').addEventListener('click', ()=>{ if(S.previewIdx > 0) XG.previewChapter(S.previewIdx - 1); });
el('nextChapBtn').addEventListener('click', ()=>{ if(S.previewIdx < S.chapters.length - 1) XG.previewChapter(S.previewIdx + 1); });

/* swipe between chapters (only when not running) */
let tx0 = null, ty0 = null;
viewer.addEventListener('touchstart', e=>{ if(S.running) return; const t = e.touches[0]; tx0 = t.clientX; ty0 = t.clientY; }, {passive:true});
viewer.addEventListener('touchend', e=>{
  if(tx0 === null || S.running) return;
  const t = e.changedTouches[0], dx = t.clientX - tx0, dy = t.clientY - ty0;
  tx0 = ty0 = null;
  if(Math.abs(dx) > 70 && Math.abs(dy) < 50){ dx < 0 ? el('nextChapBtn').click() : el('prevChapBtn').click(); }
}, {passive:true});

/* ---------- chapter list ---------- */
const STATUS_LABEL = {pending:'Pending', active:'Translating…', done:'Done', retry:'Retrying', unverified:'Unverified', skipped:'Skipped'};
function rowVisible(c){
  if(statusFilter !== 'all' && c.status !== statusFilter) return false;
  if(textFilter && !c.title.toLowerCase().includes(textFilter)) return false;
  return true;
}
XG.renderChapterList = function(){
  chapList.innerHTML = '';
  if(!S.chapters.length){ chapList.innerHTML = '<div class="empty">No chapters yet</div>'; el('chapCount').textContent = '0'; return; }
  const frag = document.createDocumentFragment();
  S.chapters.forEach((c,i)=>{
    const b = document.createElement('button');
    b.className = `chap st-${c.status}` + (c.excluded ? ' excluded' : '') + (rowVisible(c) ? '' : ' is-hidden') + (i === S.previewIdx ? ' is-preview' : '');
    b.id = 'chap-' + i;
    b.innerHTML = `<span class="chap-num">${i+1}</span><span class="chap-main"><span class="chap-title">${XG.escapeHtml(c.title)}</span><span class="chap-sub">${STATUS_LABEL[c.status] || c.status}${c.wc ? ' · ' + c.wc + ' words' : ''}</span></span><span class="chap-st"></span>`;
    b.addEventListener('click', ()=>{ XG.previewChapter(i); XG.closeDrawer(); });
    let lp = null;
    b.addEventListener('touchstart', ()=>{ lp = setTimeout(()=>{ lp = null; XG.buzz(20); XG.openChapSheet(i); }, 520); }, {passive:true});
    ['touchend','touchmove','touchcancel'].forEach(ev=>b.addEventListener(ev, ()=>{ if(lp){ clearTimeout(lp); lp = null; } }, {passive:true}));
    b.addEventListener('contextmenu', e=>{ e.preventDefault(); XG.openChapSheet(i); });
    frag.appendChild(b);
  });
  chapList.appendChild(frag);
  el('chapCount').textContent = S.chapters.length;
};
function refreshRow(i){
  const c = S.chapters[i], b = el('chap-' + i); if(!b) return;
  b.className = `chap st-${c.status}` + (c.excluded ? ' excluded' : '') + (rowVisible(c) ? '' : ' is-hidden') + (i === S.previewIdx ? ' is-preview' : '');
  b.querySelector('.chap-title').textContent = c.title;
  b.querySelector('.chap-sub').textContent = (STATUS_LABEL[c.status] || c.status) + (c.wc ? ' · ' + c.wc + ' words' : '');
}
XG.refreshRow = refreshRow;
function highlightRow(){ chapList.querySelectorAll('.chap.is-preview').forEach(x=>x.classList.remove('is-preview')); const b = el('chap-' + S.previewIdx); if(b){ b.classList.add('is-preview'); } }
function applyFilters(){ S.chapters.forEach((c,i)=>{ const b = el('chap-'+i); if(b) b.classList.toggle('is-hidden', !rowVisible(c)); }); }
el('chapFilter').addEventListener('input', e=>{ textFilter = e.target.value.trim().toLowerCase(); applyFilters(); });
el('statusFilters').addEventListener('click', e=>{
  const b = e.target.closest('.chip'); if(!b) return;
  statusFilter = b.dataset.f;
  el('statusFilters').querySelectorAll('.chip').forEach(x=>x.classList.toggle('active', x === b));
  applyFilters();
});

function setStatus(i, st){
  const c = S.chapters[i]; c.status = st; refreshRow(i);
  XG.saveSession(); XG.updateProgress();
}
XG.setChapterText = function(c, text){ c.text = text || ''; c.wc = XG.wordCount(c.text); };

/* ---------- progress ---------- */
XG.updateProgress = function(){
  const total = S.chapters.length;
  const done = S.chapters.filter(c=>c.status==='done').length;
  const processed = S.chapters.filter(c=>['done','unverified','skipped'].includes(c.status)).length;
  const pct = total ? Math.round(processed / total * 100) : 0;
  el('runBarFill').style.width = pct + '%';
  el('runCount').textContent = `${processed} / ${total}`;
  el('miniPillText').textContent = pct + '%';
  el('ringFg').style.strokeDashoffset = 56.5 - 56.5 * pct / 100;
  el('miniPill').classList.toggle('running', S.running);
  el('miniPill').classList.toggle('done', !S.running && total > 0 && processed === total);
  if(S.running && S.durations.length){
    const avg = S.durations.reduce((a,b)=>a+b,0) / S.durations.length;
    const left = total - processed;
    const ms = avg * left;
    el('runEta').textContent = left > 0 ? '~' + (ms < 60000 ? Math.ceil(ms/1000) + 's' : Math.ceil(ms/60000) + ' min') + ' left' : '';
  } else el('runEta').textContent = '';
  const exportable = S.chapters.filter(c=>c.text && c.text.trim() && !c.excluded).length;
  el('exportCount').textContent = exportable;
  el('exportHint').textContent = exportable ? `${exportable} translated chapter${exportable>1?'s':''} ready (${done} verified).` : 'Translated chapters will be listed here.';
  const en = exportable > 0;
  ['exportStoryBtn','exportZipBtn','exportEpubBtn','exportMdBtn','exportHtmlBtn','shareBtn'].forEach(id=>el(id).disabled = !en);
  el('backupExportBtn').disabled = !S.chapters.length;
  document.title = S.running ? `${pct}% · Xplin Go` : 'Xplin Go — Mobile Book Translator';
};
function setRunStatus(title, sub){ el('runStatusTitle').textContent = title; if(sub !== undefined) el('runStatusSub').textContent = sub; }
XG.setRunStatus = setRunStatus;

/* ---------- process one chapter ---------- */
async function processChapter(i){
  const c = S.chapters[i];
  S.currentIdx = i; S.previewIdx = i; S.skipRequested = false;
  const t0 = Date.now();
  setStatus(i, 'active');
  viewerLabel.textContent = `${i+1}/${S.chapters.length} · ${c.title}`;
  highlightRow();
  setLive(true);
  setRunStatus(`Translating ${i+1} of ${S.chapters.length}`, c.title);

  viewer.removeAttribute('translate'); viewer.classList.remove('notranslate');
  el('comparePanel').hidden = true;
  let html = '';
  try{ html = await loadChapterHtml(c); }catch(e){}
  viewer.innerHTML = html || '<div class="ph">Empty chapter content</div>';
  html = null;
  const original = viewer.innerText;
  storeOriginal(c, original);
  unload(c);

  if(!original.trim()){
    XG.setChapterText(c, ''); setStatus(i, 'skipped'); S.durations.push(Date.now()-t0); setLive(false); return true;
  }

  await autoScroll(viewer);
  if(S.skipRequested){ XG.setChapterText(c, viewer.innerText); setStatus(i, 'skipped'); S.skipRequested = false; S.durations.push(Date.now()-t0); setLive(false); return true; }
  if(S.stopRequested){ setLive(false); return true; }

  const result = await waitForTranslation(viewer, original, XG.settings.timeoutMs);
  setLive(false);

  if(result.interrupted){
    if(S.stopRequested) return true;
    XG.setChapterText(c, result.text); setStatus(i, 'skipped'); S.skipRequested = false; S.durations.push(Date.now()-t0); return true;
  }
  if(result.success){
    XG.setChapterText(c, result.text);
    c.durMs = Date.now()-t0; c.doneAt = Date.now();
    setStatus(i, 'done');
    S.durations.push(c.durMs);
    XG.buzz(15);
    viewerLabel.textContent = `${i+1}/${S.chapters.length} · ${c.title} ✓`;
    return true;
  }
  c.retries += 1;
  if(c.retries < XG.settings.maxRetries){
    setStatus(i, 'retry');
    await XG.sleep(1200);
    if(S.stopRequested || S.skipRequested){ XG.setChapterText(c, viewer.innerText); setStatus(i, S.skipRequested ? 'skipped' : 'unverified'); S.skipRequested = false; return true; }
    return await processChapter(i);
  }
  XG.setChapterText(c, result.text);
  c.durMs = Date.now()-t0;
  setStatus(i, 'unverified');
  S.durations.push(c.durMs);
  return false;
}

/* ---------- main loop ---------- */
function clampRange(){
  const n = S.chapters.length || 1;
  let from = parseInt(el('rangeFrom').value, 10) || 1, to = parseInt(el('rangeTo').value, 10) || n;
  from = Math.min(Math.max(1, from), n); to = Math.min(Math.max(from, to), n);
  el('rangeFrom').value = from; el('rangeTo').value = to;
  return {from, to};
}
el('rangeFrom').addEventListener('change', clampRange); el('rangeTo').addEventListener('change', clampRange);

function setControls(){
  const r = S.running;
  el('startBtn').disabled = r || !S.chapters.length;
  el('pauseBtn').disabled = !r; el('skipBtn').disabled = !r; el('stopBtn').disabled = !r;
  el('pauseLabel').textContent = S.paused ? 'Resume' : 'Pause';
  const fab = el('fab');
  fab.hidden = !S.chapters.length;
  fab.classList.toggle('running', r && !S.paused);
  fab.setAttribute('aria-label', r ? (S.paused ? 'Resume' : 'Pause') : 'Start translation');
  el('openFileBtn').disabled = r; el('backupImportBtn').disabled = r;
}
XG.setControls = setControls;

XG.runTranslation = async function(){
  if(S.running || !S.chapters.length) return;
  const range = clampRange();
  S.running = true; S.paused = false; S.stopRequested = false; S.skipRequested = false; S.durations = [];
  setControls();
  XG.acquireWakeLock();
  XG.closeDrawer();
  document.body.classList.add('immersive');
  XG.hideBanner();
  let failures = 0, verified = 0;

  for(let i = range.from - 1; i <= range.to - 1; i++){
    if(S.stopRequested) break;
    while(S.paused && !S.stopRequested) await XG.sleep(250);
    if(S.stopRequested) break;
    const c = S.chapters[i];
    if(c.status === 'done' && c.text && c.text.trim()) continue;
    const ok = await processChapter(i);
    if(ok && c.status === 'done'){ verified++; failures = 0; }
    else if(c.status === 'unverified'){
      failures++;
      if(failures >= 3){
        S.paused = true; setControls();
        XG.banner({level:'warn', title:'Is Chrome translate on?',
          message:'3 chapters in a row finished without any translated text. Open Chrome ⋮ → Translate, pick your language, then continue.',
          actions:[{label:'Continue', primary:true, onClick:()=>{ S.paused = false; failures = 0; setControls(); XG.hideBanner(); }}, {label:'Stop', onClick:()=>{ S.stopRequested = true; S.paused = false; XG.hideBanner(); }}]});
        while(S.paused && !S.stopRequested) await XG.sleep(250);
      }
    }
    XG.updateProgress();
    if(!S.stopRequested && i < range.to - 1) await XG.sleep(XG.settings.gapMs);
  }

  S.running = false; S.paused = false;
  setControls(); setLive(false);
  XG.releaseWakeLock();
  document.body.classList.remove('immersive');
  XG.updateProgress();
  const done = S.chapters.filter(c=>c.status==='done').length;
  if(S.stopRequested){ setRunStatus('Stopped', `${done} of ${S.chapters.length} verified`); XG.toast('Stopped', 'warn'); }
  else if(verified === 0 && done === 0){ setRunStatus('Nothing verified', 'Is Chrome translate on?'); XG.toast('Nothing verified — is Chrome translate on?', 'warn', 4000); }
  else {
    setRunStatus('Finished', `${done} of ${S.chapters.length} verified · export from the menu`);
    XG.chime(); XG.buzz([40, 60, 40]);
    XG.toast(`Done — ${done} chapters verified`, 'ok', 3500);
    XG.emit('run:done');
  }
  S.stopRequested = false;
  if(S.previewIdx >= 0) XG.previewChapter(S.previewIdx);
};
XG.pauseToggle = function(){ if(!S.running) return; S.paused = !S.paused; setControls(); XG.toast(S.paused ? 'Paused' : 'Resumed'); if(S.paused) setRunStatus('Paused', 'Tap Resume to continue'); };
XG.skip = function(){ if(S.running) S.skipRequested = true; };
XG.stop = function(){ if(S.running){ S.stopRequested = true; S.paused = false; } };

XG.retranslateChapter = function(i){
  const c = S.chapters[i]; if(!c || S.running) return;
  c.status = 'pending'; c.retries = 0; XG.setChapterText(c, ''); c.excluded = false;
  refreshRow(i); XG.saveSession();
  el('rangeFrom').value = i+1; el('rangeTo').value = i+1;
  XG.runTranslation();
};

el('startBtn').addEventListener('click', XG.runTranslation);
el('pauseBtn').addEventListener('click', XG.pauseToggle);
el('skipBtn').addEventListener('click', XG.skip);
el('stopBtn').addEventListener('click', XG.stop);
el('fab').addEventListener('click', ()=>{ S.running ? XG.pauseToggle() : XG.runTranslation(); });
el('targetLang').addEventListener('change', e=>{ S.verifyMode = e.target.value; XG.saveSettings(); });

/* ---------- react to book events ---------- */
XG.on('book:reset', ()=>{
  viewer.innerHTML = '<div class="ph">Loading…</div>';
  viewerLabel.textContent = 'Extracting…';
  XG.renderChapterList(); XG.updateProgress(); setControls();
  setRunStatus('Extracting…', 'Reading the file');
});
XG.on('book:loaded', ({count})=>{
  el('rangeFrom').max = count; el('rangeTo').max = count; el('rangeFrom').value = 1; el('rangeTo').value = count;
  XG.renderChapterList(); XG.updateProgress(); setControls();
  setRunStatus('Ready', `${count} chapter${count>1?'s':''} · turn on Chrome translate, then Start`);
  XG.previewChapter(0);
});
XG.on('chapters:changed', ()=>{ XG.renderChapterList(); XG.updateProgress(); setControls(); if(S.previewIdx >= 0) XG.previewChapter(S.previewIdx); });
XG.on('book:failed', ()=>{ setRunStatus('Could not load', 'Try another file'); setControls(); });
})();
