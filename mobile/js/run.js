/* Xplin Go — run.js
 * Full-screen viewer, chapter list, translate-verify loop, run HUD, stats.
 * The viewer fills the phone screen so the browser's page translator sees the whole chapter.
 */
'use strict';
(function(){
const XG = window.XG, S = XG.state, el = XG.el;

const viewer = el('viewer'), viewerLabel = el('viewerLabel'), scrollBar = el('viewerScrollBar');
const liveBadge = el('liveBadge'), statusBadge = el('statusBadge'), chapList = el('chapList');
let statusFilter = 'all', textFilter = '';
let lastRun = null;

/* ---------- verify helpers ---------- */
const ANY_NONLATIN = /[\u0900-\u097F\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\u0590-\u05FF\u0370-\u03FF]/;
function nonLatin(str){ return ANY_NONLATIN.test(str); }
function scriptRatio(str, re){
  /* share of letters that belong to the target script — guards against a single stray glyph */
  let hit = 0, letters = 0;
  for(let i=0;i<str.length && i<6000;i++){
    const ch = str[i];
    if(/\s|\d|[.,;:!?"'()\-\u2014\u2013\u2018\u2019\u201c\u201d]/.test(ch)) continue;
    letters++; if(re.test(ch)) hit++;
  }
  return letters ? hit / letters : 0;
}
function divergence(a, b){
  a = (a||'').trim(); b = (b||'').trim();
  if(!a && !b) return 0; if(!a || !b) return 1; if(a === b) return 0;
  const wa = a.toLowerCase().split(/\s+/), wb = new Set(b.toLowerCase().split(/\s+/));
  let common = 0; wa.forEach(w=>{ if(wb.has(w)) common++; });
  return 1 - common / wa.length;
}
function isTranslated(now, orig, elapsed){
  if(!now.trim()) return false;
  const lang = XG.LANGS[S.targetLang] || XG.LANGS.auto;
  if(lang.script){
    /* target uses its own script: need a meaningful share of it */
    return scriptRatio(now, lang.script) > 0.25;
  }
  if(S.targetLang === 'auto'){
    if(nonLatin(now)) return true;
    return elapsed > 2800 && divergence(orig, now) > 0.4;
  }
  /* Latin target: text must diverge from the original */
  return elapsed > 2200 && divergence(orig, now) > 0.35;
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
function setLive(on){ liveBadge.classList.toggle('on', on); viewer.classList.toggle('live', on); if(on) statusBadge.hidden = true; }
const STATUS_LABEL = {pending:'Pending', active:'Translating…', done:'Verified', retry:'Retrying', unverified:'Unverified', skipped:'Skipped'};
function showStatusBadge(c){
  if(!c || S.running || c.status === 'pending' || c.status === 'active'){ statusBadge.hidden = true; return; }
  statusBadge.textContent = STATUS_LABEL[c.status] || c.status;
  statusBadge.className = 'status-badge ' + c.status;
  statusBadge.hidden = false;
}

XG.previewChapter = async function(i){
  const c = S.chapters[i]; if(!c) return;
  XG.tts.stop();
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
  /* end-of-chapter footer with a next button (reading mode) */
  if(!S.running){
    const foot = document.createElement('div'); foot.className = 'chap-end'; foot.setAttribute('translate','no');
    const nxt = S.chapters[i+1];
    foot.innerHTML = nxt ? `End of chapter ${i+1}<br><button type="button">Next: ${XG.escapeHtml(nxt.title)} ›</button>` : `End of book · ${S.chapters.length} chapters`;
    const b = foot.querySelector('button'); if(b) b.addEventListener('click', ()=>XG.previewChapter(i+1));
    viewer.appendChild(foot);
  }
  viewer.scrollTop = 0; updateScrollBar();
  updateCompare(c);
  showStatusBadge(c);
  highlightRow();
  el('prevChapBtn').disabled = i <= 0; el('nextChapBtn').disabled = i >= S.chapters.length - 1;
  el('listenBtn').hidden = !(XG.tts.ok && c.text && c.text.trim());
  el('listenBtn').classList.remove('on');
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

/* read aloud */
XG.listenChapter = function(i){
  const c = S.chapters[i]; if(!c || !c.text) { XG.toast('No translated text yet', 'warn'); return; }
  if(XG.tts.isSpeaking()){ XG.tts.stop(); el('listenBtn').classList.remove('on'); return; }
  if(S.previewIdx !== i) XG.previewChapter(i);
  const paras = Array.from(viewer.querySelectorAll('p'));
  const ok = XG.tts.start(paras.map(p=>p.innerText), {
    onPara: idx=>{ paras.forEach((p,k)=>p.classList.toggle('tts-now', k === idx)); if(paras[idx]) paras[idx].scrollIntoView({block:'center', behavior:'smooth'}); },
    onEnd: ()=>{ paras.forEach(p=>p.classList.remove('tts-now')); el('listenBtn').classList.remove('on'); }
  });
  if(!ok){ XG.toast('Read aloud not available on this device', 'warn'); return; }
  el('listenBtn').classList.add('on');
  XG.toast('Reading aloud — tap 🔊 again to stop', 'info', 2200);
};
el('listenBtn').addEventListener('click', ()=>XG.listenChapter(S.previewIdx));

/* swipe between chapters + tap zones (only when not running) */
let tx0 = null, ty0 = null, t0 = 0, moved = false;
viewer.addEventListener('touchstart', e=>{ if(S.running) return; const t = e.touches[0]; tx0 = t.clientX; ty0 = t.clientY; t0 = Date.now(); moved = false; }, {passive:true});
viewer.addEventListener('touchmove', ()=>{ moved = true; }, {passive:true});
viewer.addEventListener('touchend', e=>{
  if(tx0 === null || S.running) return;
  const t = e.changedTouches[0], dx = t.clientX - tx0, dy = t.clientY - ty0;
  const x0 = tx0; tx0 = ty0 = null;
  if(Math.abs(dx) > 70 && Math.abs(dy) < 50){ dx < 0 ? el('nextChapBtn').click() : el('prevChapBtn').click(); return; }
  /* tap zones: left 22% = prev, right 22% = next, middle = toggle bars */
  if(!moved && Math.abs(dx) < 8 && Math.abs(dy) < 8 && Date.now() - t0 < 350 && XG.settings.tapZones){
    if(e.target.closest('a,button')) return;
    const w = viewer.clientWidth, x = x0;
    if(x < w * 0.22){ if(S.previewIdx > 0){ XG.previewChapter(S.previewIdx - 1); XG.buzz(8); } }
    else if(x > w * 0.78){ if(S.previewIdx < S.chapters.length - 1){ XG.previewChapter(S.previewIdx + 1); XG.buzz(8); } }
    else { document.body.classList.toggle('immersive'); }
  }
}, {passive:true});

/* ---------- chapter list ---------- */
function rowVisible(c){
  if(statusFilter !== 'all' && c.status !== statusFilter) return false;
  if(textFilter && !c.title.toLowerCase().includes(textFilter)) return false;
  return true;
}
const MORE_SVG = '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>';
XG.renderChapterList = function(){
  chapList.innerHTML = '';
  if(!S.chapters.length){ chapList.innerHTML = '<div class="empty">No chapters yet</div>'; el('chapCount').textContent = '0'; return; }
  const frag = document.createDocumentFragment();
  S.chapters.forEach((c,i)=>{
    const b = document.createElement('div');
    b.className = `chap st-${c.status}` + (c.excluded ? ' excluded' : '') + (rowVisible(c) ? '' : ' is-hidden') + (i === S.previewIdx ? ' is-preview' : '');
    b.id = 'chap-' + i; b.setAttribute('role', 'button'); b.tabIndex = 0;
    b.innerHTML = `<span class="chap-num">${i+1}</span><span class="chap-main"><span class="chap-title">${XG.escapeHtml(c.title)}</span><span class="chap-sub">${STATUS_LABEL[c.status] || c.status}${c.wc ? ' · ' + c.wc + ' words' : ''}</span></span><span class="chap-st"></span><button class="chap-more" aria-label="Chapter options">${MORE_SVG}</button>`;
    b.addEventListener('click', e=>{
      if(e.target.closest('.chap-more')){ XG.openChapSheet(i); return; }
      XG.previewChapter(i); XG.closeAll();
    });
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
XG.scrollListToCurrent = function(){ const b = el('chap-' + (S.running ? S.currentIdx : S.previewIdx)); if(b) b.scrollIntoView({block:'center'}); };
function applyFilters(){ S.chapters.forEach((c,i)=>{ const b = el('chap-'+i); if(b) b.classList.toggle('is-hidden', !rowVisible(c)); }); }
el('chapFilter').addEventListener('input', e=>{ textFilter = e.target.value.trim().toLowerCase(); applyFilters(); });
el('statusFilters').addEventListener('click', e=>{
  const b = e.target.closest('.chip'); if(!b) return;
  statusFilter = b.dataset.f;
  el('statusFilters').querySelectorAll('.chip').forEach(x=>x.classList.toggle('active', x === b));
  applyFilters();
});
el('chapJump').addEventListener('change', e=>{
  const n = parseInt(e.target.value, 10); e.target.value = '';
  if(n >= 1 && n <= S.chapters.length){ XG.previewChapter(n-1); XG.closeAll(); }
});
el('chapNextPendingBtn').addEventListener('click', ()=>{
  const i = S.chapters.findIndex(c=>c.status !== 'done');
  if(i < 0){ XG.toast('All chapters are done 🎉', 'ok'); return; }
  XG.previewChapter(i); XG.scrollListToCurrent();
});
el('chapCurrentBtn').addEventListener('click', XG.scrollListToCurrent);

function setStatus(i, st){
  const c = S.chapters[i]; c.status = st; refreshRow(i);
  XG.saveSession(); XG.updateProgress();
}
XG.setChapterText = function(c, text){ c.text = text || ''; c.wc = XG.wordCount(c.text); };

/* ---------- progress ---------- */
function fmtEta(ms){ return ms < 60000 ? Math.ceil(ms/1000) + 's' : Math.ceil(ms/60000) + ' min'; }
XG.updateProgress = function(){
  const total = S.chapters.length;
  const done = S.chapters.filter(c=>c.status==='done').length;
  const unverified = S.chapters.filter(c=>c.status==='unverified').length;
  const processed = S.chapters.filter(c=>['done','unverified','skipped'].includes(c.status)).length;
  const pct = total ? Math.round(processed / total * 100) : 0;
  el('runBarFill').style.width = pct + '%';
  el('runCount').textContent = `${processed} / ${total}`;
  el('miniPillText').textContent = pct + '%';
  el('ringFg').style.strokeDashoffset = 56.5 - 56.5 * pct / 100;
  el('miniPill').hidden = !total;
  el('miniPill').classList.toggle('running', S.running);
  el('miniPill').classList.toggle('done', !S.running && total > 0 && processed === total);
  el('hudPct').textContent = pct + '%';
  el('hudRing').style.strokeDashoffset = 94.2 - 94.2 * pct / 100;
  let eta = '';
  if(S.running && S.durations.length){
    const avg = S.durations.reduce((a,b)=>a+b,0) / S.durations.length;
    const left = total - processed;
    if(left > 0) eta = '~' + fmtEta(avg * left + Math.max(0,left-1) * XG.settings.gapMs) + ' left';
  }
  el('runEta').textContent = eta;
  const exportable = S.chapters.filter(c=>c.text && c.text.trim() && !c.excluded).length;
  el('exportCount').textContent = exportable;
  el('exportHint').textContent = exportable ? `${exportable} translated chapter${exportable>1?'s':''} ready (${done} verified${unverified ? ', ' + unverified + ' unverified' : ''}).` : 'Translated chapters will be listed here.';
  const en = exportable > 0;
  ['exportStoryBtn','exportZipBtn','exportEpubBtn','exportMdBtn','exportHtmlBtn','shareBtn','copyAllBtn'].forEach(id=>el(id).disabled = !en);
  el('backupExportBtn').disabled = !S.chapters.length;
  el('retryFailedBtn').disabled = S.running || !unverified;
  el('retryFailedCount').textContent = unverified ? `(${unverified})` : '';
  /* bottom-bar badges */
  const pending = total - done;
  el('bbChapBadge').hidden = !(total && pending); el('bbChapBadge').textContent = pending > 99 ? '99+' : pending;
  el('bbExportBadge').hidden = !exportable; el('bbExportBadge').textContent = exportable > 99 ? '99+' : exportable;
  document.title = S.running ? `${pct}% · Xplin Go` : 'Xplin Go — Mobile Book Translator';
};
function setRunStatus(title, sub){
  el('runStatusTitle').textContent = title; if(sub !== undefined) el('runStatusSub').textContent = sub;
  el('hudTitle').textContent = title; if(sub !== undefined) el('hudSub').textContent = sub;
}
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
    setRunStatus(`Retrying ${i+1} (${c.retries}/${XG.settings.maxRetries})`, c.title);
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
  fab.disabled = !S.chapters.length;
  fab.classList.toggle('running', r && !S.paused);
  fab.classList.toggle('paused', r && S.paused);
  fab.setAttribute('aria-label', r ? (S.paused ? 'Resume' : 'Pause') : 'Start translation');
  const allDone = S.chapters.length && S.chapters.every(c=>c.status === 'done');
  el('fabLabel').textContent = r ? (S.paused ? 'Resume' : 'Pause') : (allDone ? 'Done' : (S.chapters.some(c=>c.status==='done') ? 'Continue' : 'Start'));
  el('openFileBtn').disabled = r; el('backupImportBtn').disabled = r; el('sampleBtn').disabled = r;
  el('bbChapters').disabled = false; el('bbExport').disabled = r;
  const hud = el('runHud'); hud.hidden = !r; requestAnimationFrame(()=>hud.classList.toggle('show', r));
  el('retryFailedBtn').disabled = r || !S.chapters.some(c=>c.status==='unverified');
}
XG.setControls = setControls;

XG.runTranslation = async function(opts={}){
  if(S.running || !S.chapters.length) return;
  /* preflight: is the browser translator on? (ui.js shows the setup sheet) */
  if(!opts.skipPreflight && XG.preflight && !XG.preflight()) return;
  const range = clampRange();
  const todo = [];
  for(let i = range.from - 1; i <= range.to - 1; i++){ const c = S.chapters[i]; if(!(c.status === 'done' && c.text && c.text.trim())) todo.push(i); }
  if(!todo.length){ XG.toast('Everything in this range is already verified', 'ok'); return; }

  S.running = true; S.paused = false; S.stopRequested = false; S.skipRequested = false; S.durations = []; S.runStartedAt = Date.now();
  XG.tts.stop();
  setControls();
  XG.acquireWakeLock();
  XG.closeAll();
  document.body.classList.add('immersive');
  XG.hideBanner();
  let failures = 0, verified = 0, unverified = 0, skipped = 0, processedCount = 0;

  for(const i of todo){
    if(S.stopRequested) break;
    while(S.paused && !S.stopRequested) await XG.sleep(250);
    if(S.stopRequested) break;
    const c = S.chapters[i];
    if(c.status === 'done' && c.text && c.text.trim()) continue;
    const ok = await processChapter(i);
    processedCount++;
    if(ok && c.status === 'done'){ verified++; failures = 0; }
    else if(c.status === 'skipped'){ skipped++; }
    else if(c.status === 'unverified'){
      unverified++; failures++;
      if(failures >= 3){
        S.paused = true; setControls();
        const bh = XG.browserHint();
        XG.banner({level:'warn', title:'Is translate turned on?',
          message:`3 chapters in a row finished without ${XG.langName(S.targetLang)} text. ${bh.step.replace(/<[^>]+>/g,'')}, pick ${XG.langName(S.targetLang)}, then continue.`,
          actions:[{label:'Continue', primary:true, onClick:()=>{ S.paused = false; failures = 0; setControls(); XG.hideBanner(); }}, {label:'Stop', onClick:()=>{ S.stopRequested = true; S.paused = false; XG.hideBanner(); }}]});
        while(S.paused && !S.stopRequested) await XG.sleep(250);
      }
    }
    XG.updateProgress();
    if(!S.stopRequested && i !== todo[todo.length-1]) await XG.sleep(XG.settings.gapMs);
  }

  S.running = false; S.paused = false;
  setControls(); setLive(false);
  XG.releaseWakeLock();
  document.body.classList.remove('immersive');
  XG.updateProgress();
  const done = S.chapters.filter(c=>c.status==='done').length;
  const elapsed = Date.now() - S.runStartedAt;
  const words = S.chapters.filter(c=>c.status==='done').reduce((a,c)=>a+(c.wc||0),0);
  lastRun = {verified, unverified, skipped, processed: processedCount, elapsed, done, total: S.chapters.length, words, stopped: S.stopRequested};
  XG.lastRun = lastRun;
  XG.settings.runs = (XG.settings.runs||0) + 1; XG.saveSettings();
  if(S.stopRequested){ setRunStatus('Stopped', `${done} of ${S.chapters.length} verified`); XG.toast('Stopped', 'warn'); XG.emit('run:done', lastRun); }
  else if(verified === 0 && done === 0){ setRunStatus('Nothing verified', 'Is translate on?'); XG.toast('Nothing verified — is translate turned on?', 'warn', 4000); XG.emit('run:done', lastRun); }
  else {
    setRunStatus('Finished', `${done} of ${S.chapters.length} verified · export from the bottom bar`);
    XG.chime(); XG.buzz([40, 60, 40]);
    XG.emit('run:done', lastRun);
    XG.emit('run:finished', lastRun);
  }
  S.stopRequested = false;
  if(S.previewIdx >= 0) XG.previewChapter(S.previewIdx);
};
XG.pauseToggle = function(){ if(!S.running) return; S.paused = !S.paused; setControls(); XG.toast(S.paused ? 'Paused' : 'Resumed'); if(S.paused) setRunStatus('Paused', 'Tap ▶ to continue'); };
XG.skip = function(){ if(S.running){ S.skipRequested = true; XG.toast('Skipping…', 'info', 1200); } };
XG.stop = function(){ if(S.running){ S.stopRequested = true; S.paused = false; } };

XG.retranslateChapter = function(i){
  const c = S.chapters[i]; if(!c || S.running) return;
  c.status = 'pending'; c.retries = 0; XG.setChapterText(c, ''); c.excluded = false;
  refreshRow(i); XG.saveSession();
  el('rangeFrom').value = i+1; el('rangeTo').value = i+1;
  XG.runTranslation();
};
XG.retryUnverified = function(){
  if(S.running) return;
  const idx = S.chapters.map((c,i)=>c.status==='unverified' ? i : -1).filter(i=>i>=0);
  if(!idx.length){ XG.toast('No unverified chapters', 'ok'); return; }
  idx.forEach(i=>{ const c = S.chapters[i]; c.status = 'pending'; c.retries = 0; XG.setChapterText(c, ''); refreshRow(i); });
  XG.saveSession();
  el('rangeFrom').value = idx[0]+1; el('rangeTo').value = idx[idx.length-1]+1;
  XG.toast(`Retrying ${idx.length} chapter${idx.length>1?'s':''}`, 'info');
  XG.runTranslation();
};

el('startBtn').addEventListener('click', ()=>XG.runTranslation());
el('pauseBtn').addEventListener('click', XG.pauseToggle);
el('skipBtn').addEventListener('click', XG.skip);
el('stopBtn').addEventListener('click', XG.stop);
el('hudSkip').addEventListener('click', XG.skip);
el('hudStop').addEventListener('click', ()=>{ if(confirm('Stop translating? Progress so far is saved.')) XG.stop(); });
el('retryFailedBtn').addEventListener('click', XG.retryUnverified);
el('fab').addEventListener('click', ()=>{ XG.buzz(10); S.running ? XG.pauseToggle() : XG.runTranslation(); });
el('targetLangSel').addEventListener('change', e=>{ S.targetLang = e.target.value; XG.saveSettings(); XG.emit('lang:changed', S.targetLang); });

/* ---------- react to book events ---------- */
XG.on('book:reset', ()=>{
  viewer.innerHTML = '<div class="ph">Loading…</div>';
  viewerLabel.textContent = 'Extracting…';
  statusBadge.hidden = true; el('listenBtn').hidden = true;
  XG.renderChapterList(); XG.updateProgress(); setControls();
  setRunStatus('Extracting…', 'Reading the file');
});
XG.on('book:loaded', ({count})=>{
  el('rangeFrom').max = count; el('rangeTo').max = count; el('rangeFrom').value = 1; el('rangeTo').value = count;
  XG.renderChapterList(); XG.updateProgress(); setControls();
  setRunStatus('Ready', `${count} chapter${count>1?'s':''} · turn on translate, then tap ▶`);
  XG.previewChapter(0);
});
XG.on('chapters:changed', ()=>{ XG.renderChapterList(); XG.updateProgress(); setControls(); if(S.previewIdx >= 0) XG.previewChapter(S.previewIdx); });
XG.on('book:failed', ()=>{ setRunStatus('Could not load', 'Try another file'); setControls(); });
})();
