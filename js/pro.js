/* ==========================================================================
   Pro features layer — built on window.DTV (see app.js §12)
   Command palette · Reading mode · Diff viewer · Glossary · Stats · Export
   preview · Onboarding tour · Context menu · Confetti · Recent sessions ·
   Community library · Mobile drawer · PWA install
   ========================================================================== */
(function(){
  const D = window.DTV;
  if(!D) return;
  const { el, on, emit, showToast, escapeHtml, escapeAttr, formatNum, formatDuration } = D;
  const REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const LS = { glossary:'dtv_glossary_v1', recent:'dtv_recent_v1', tour:'dtv_tour_done', lang:'dtv_ui_lang' };
  const lsGet = (k, d)=>{ try{ const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); }catch(e){ return d; } };
  const lsSet = (k, v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} };

  /* ------------------------------------------------------------------
     0. Generic modal helper
     ------------------------------------------------------------------ */
  function openModal(id){ const m = el(id); if(!m) return; m.classList.add('show'); document.body.classList.add('modal-open'); const f = m.querySelector('[autofocus]'); if(f) setTimeout(()=>f.focus(), 30); }
  function closeModal(id){ const m = el(id); if(!m) return; m.classList.remove('show'); if(!document.querySelector('.modal.show')) document.body.classList.remove('modal-open'); }
  function closeAllModals(){ document.querySelectorAll('.modal.show').forEach(m=>m.classList.remove('show')); document.body.classList.remove('modal-open'); }
  document.querySelectorAll('.modal').forEach(m=>{
    m.addEventListener('click', e=>{ if(e.target === m) closeModal(m.id); });
    m.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click', ()=>closeModal(m.id)));
  });

  /* ------------------------------------------------------------------
     1. Command palette (Ctrl/Cmd+K)
     ------------------------------------------------------------------ */
  const palette = el('cmdPalette'), cmdInput = el('cmdInput'), cmdList = el('cmdList');
  const loaded = ()=> D.chapters.length > 0;
  const COMMANDS = [
    { id:'open', label:'Open a document', hint:'EPUB · PDF · DOCX · TXT', kbd:'O', icon:'\u{1F4C2}', run:()=>D.openFile(), when:()=>!D.running },
    { id:'start', label:'Start / continue translation run', kbd:'S', icon:'\u25B6', run:()=>D.startRun(), when:()=>loaded() && !D.running && !D.nodes.startBtn.disabled },
    { id:'pause', label:'Pause / resume run', kbd:'P', icon:'\u23F8', run:()=>D.pauseRun(), when:()=>D.running },
    { id:'skip', label:'Skip current chapter', kbd:'K', icon:'\u23ED', run:()=>D.skipChapter(), when:()=>D.running },
    { id:'stop', label:'Stop run', kbd:'Esc', icon:'\u23F9', run:()=>D.stopRun(), when:()=>D.running },
    { id:'retry', label:'Retry unverified / skipped chapters', icon:'\u21BB', run:()=>D.retryIssues(), when:()=>loaded() && !D.running && D.chapters.some(c=>c.status==='unverified'||c.status==='skipped') },
    { id:'read', label:'Open Reading mode', kbd:'R', icon:'\u{1F4D6}', run:()=>openReader(), when:()=>loaded() },
    { id:'diff', label:'Open Diff viewer (original vs translated)', kbd:'D', icon:'\u2194', run:()=>openDiff(D.previewIdx), when:()=>loaded() },
    { id:'stats', label:'Statistics dashboard', icon:'\u{1F4CA}', run:()=>openStats(), when:()=>loaded() },
    { id:'glossary', label:'Glossary / custom dictionary', kbd:'G', icon:'\u{1F4D8}', run:()=>openModal('glossaryModal') },
    { id:'preview', label:'Export preview', icon:'\u{1F441}', run:()=>openExportPreview(), when:()=>loaded() && D.getExportChapters().length>0 },
    { id:'export-story', label:'Export \u2192 Story TXT', icon:'\u2B07', run:()=>{ D.setExportMode('story'); D.download(); }, when:()=>D.getExportChapters().length>0 },
    { id:'export-epub', label:'Export \u2192 EPUB', icon:'\u2B07', run:()=>{ D.setExportMode('epub'); D.download(); }, when:()=>D.getExportChapters().length>0 },
    { id:'export-md', label:'Export \u2192 Markdown', icon:'\u2B07', run:()=>{ D.setExportMode('md'); D.download(); }, when:()=>D.getExportChapters().length>0 },
    { id:'export-html', label:'Export \u2192 HTML', icon:'\u2B07', run:()=>{ D.setExportMode('html'); D.download(); }, when:()=>D.getExportChapters().length>0 },
    { id:'export-zip', label:'Export \u2192 ZIP (per chapter)', icon:'\u2B07', run:()=>{ D.setExportMode('txt'); D.download(); }, when:()=>D.getExportChapters().length>0 },
    { id:'backup', label:'Download backup (.json)', icon:'\u{1F4BE}', run:()=>D.backup(), when:()=>loaded() },
    { id:'restore', label:'Restore from backup', icon:'\u{1F4E5}', run:()=>el('backupFileInput').click() },
    { id:'expand', label:'Expand / collapse preview', kbd:'F', icon:'\u26F6', run:()=>D.toggleExpandViewer(), when:()=>loaded() },
    { id:'filter', label:'Focus chapter filter', kbd:'/', icon:'\u{1F50D}', run:()=>el('chapFilter').focus(), when:()=>loaded() },
    { id:'flag', label:'Flag / unflag previewed chapter', icon:'\u2691', run:()=>{ if(D.previewIdx>=0){ const f = D.toggleChapterFlag(D.previewIdx); showToast(f?'Chapter flagged':'Flag removed','info',1400); } }, when:()=>loaded() && D.previewIdx>=0 },
    { id:'note', label:'Add note to previewed chapter', icon:'\u270E', run:()=>openNote(D.previewIdx), when:()=>loaded() && D.previewIdx>=0 },
    { id:'theme-dark', label:'Theme: Dark', icon:'\u{1F319}', run:()=>D.applyTheme('dark') },
    { id:'theme-light', label:'Theme: Light', icon:'\u2600', run:()=>D.applyTheme('light') },
    { id:'theme-amoled', label:'Theme: AMOLED black', icon:'\u26AB', run:()=>D.applyTheme('amoled') },
    { id:'theme-sepia', label:'Theme: Sepia', icon:'\u{1F4DC}', run:()=>D.applyTheme('sepia') },
    { id:'lang', label:'Toggle interface language (English / Hinglish)', icon:'\u{1F310}', run:()=>toggleUiLang() },
    { id:'tour', label:'Show onboarding tour', icon:'\u{1F9ED}', run:()=>startTour(true) },
    { id:'shortcuts', label:'Keyboard shortcuts', kbd:'?', icon:'\u2328', run:()=>D.toggleShortcuts(true) },
    { id:'home', label:'Back to home / load another file', icon:'\u{1F3E0}', run:()=>D.showHero(), when:()=>loaded() && !D.running },
    { id:'install', label:'Install as app (PWA)', icon:'\u{1F4F2}', run:()=>promptInstall(), when:()=>!!deferredInstall },
  ];
  let cmdSel = 0, cmdItems = [];
  function fuzzy(q, s){
    q = q.toLowerCase(); s = s.toLowerCase();
    if(!q) return 1;
    if(s.includes(q)) return 3;
    let i = 0; for(const ch of s){ if(ch === q[i]) i++; if(i === q.length) return 1; }
    return 0;
  }
  function renderCmds(){
    const q = cmdInput.value.trim();
    const chapterCmds = [];
    if(q && loaded()){
      const num = parseInt(q, 10);
      D.chapters.forEach((c, i)=>{
        if((num && i+1 === num) || (q.length > 1 && c.title.toLowerCase().includes(q.toLowerCase()))){
          chapterCmds.push({ id:'ch'+i, label:`Go to chapter ${i+1}: ${c.title}`, icon:'\u{1F4C4}', hint:D.statusLabel(c.status), run:()=>{ if(!D.running) D.previewChapter(i); } });
        }
      });
    }
    cmdItems = COMMANDS.filter(c=>!c.when || c.when()).map(c=>({c, s:fuzzy(q, c.label)})).filter(x=>x.s>0).sort((a,b)=>b.s-a.s).map(x=>x.c).concat(chapterCmds.slice(0, 8));
    cmdSel = Math.min(cmdSel, Math.max(0, cmdItems.length-1));
    cmdList.innerHTML = cmdItems.length ? cmdItems.map((c, i)=>`
      <li class="cmd-item ${i===cmdSel?'sel':''}" data-i="${i}" role="option" aria-selected="${i===cmdSel}">
        <span class="cmd-ic">${c.icon||''}</span>
        <span class="cmd-label">${escapeHtml(c.label)}${c.hint?`<small>${escapeHtml(c.hint)}</small>`:''}</span>
        ${c.kbd?`<kbd>${escapeHtml(c.kbd)}</kbd>`:''}
      </li>`).join('') : '<li class="cmd-empty">No matching command</li>';
  }
  function openPalette(){ if(!palette) return; cmdInput.value=''; cmdSel = 0; renderCmds(); openModal('cmdPalette'); cmdInput.focus(); }
  function runCmd(i){ const c = cmdItems[i]; if(!c) return; closeModal('cmdPalette'); setTimeout(()=>c.run(), 20); }
  if(palette){
    cmdInput.addEventListener('input', ()=>{ cmdSel = 0; renderCmds(); });
    cmdInput.addEventListener('keydown', e=>{
      if(e.key === 'ArrowDown'){ e.preventDefault(); cmdSel = Math.min(cmdItems.length-1, cmdSel+1); renderCmds(); scrollSel(); }
      else if(e.key === 'ArrowUp'){ e.preventDefault(); cmdSel = Math.max(0, cmdSel-1); renderCmds(); scrollSel(); }
      else if(e.key === 'Enter'){ e.preventDefault(); runCmd(cmdSel); }
    });
    cmdList.addEventListener('click', e=>{ const li = e.target.closest('.cmd-item'); if(li) runCmd(parseInt(li.dataset.i,10)); });
    cmdList.addEventListener('mousemove', e=>{ const li = e.target.closest('.cmd-item'); if(li && parseInt(li.dataset.i,10)!==cmdSel){ cmdSel = parseInt(li.dataset.i,10); renderCmds(); } });
    el('cmdBtn') && el('cmdBtn').addEventListener('click', openPalette);
  }
  function scrollSel(){ const li = cmdList.querySelector('.sel'); if(li) li.scrollIntoView({block:'nearest'}); }

  /* ------------------------------------------------------------------
     2. Reading mode
     ------------------------------------------------------------------ */
  const reader = el('readerModal');
  let readerFont = 18, readerIdx = 0, readerAll = false;
  function readerChapters(){ return D.exportOrder.map(i=>D.chapters[i]).filter(c=>c && c.text && c.text.trim() && !c.excluded); }
  function renderReader(){
    const body = el('readerBody'), title = el('readerTitle'), pos = el('readerPos');
    const list = readerChapters();
    if(!list.length){ body.innerHTML = '<div class="reader-empty">No translated chapters yet. Run the translation first.</div>'; title.textContent = D.bookTitle; pos.textContent=''; return; }
    body.style.fontSize = readerFont + 'px';
    if(readerAll){
      body.innerHTML = list.map((c, k)=>`<h2 class="reader-h" id="reader-ch-${k}">${escapeHtml(c.title)}</h2>${paras(c.text)}`).join('');
      title.textContent = D.bookTitle; pos.textContent = `${list.length} chapters · ${formatNum(list.reduce((s,c)=>s+(c.wc||0),0))} words`;
    } else {
      readerIdx = Math.max(0, Math.min(list.length-1, readerIdx));
      const c = list[readerIdx];
      body.innerHTML = `<h2 class="reader-h">${escapeHtml(c.title)}</h2>${paras(c.text)}`;
      title.textContent = D.bookTitle;
      pos.textContent = `Chapter ${readerIdx+1} of ${list.length} · ${formatNum(c.wc||0)} words · ~${Math.max(1, Math.round((c.wc||0)/200))} min`;
    }
    el('readerPrev').disabled = readerAll || readerIdx <= 0;
    el('readerNext').disabled = readerAll || readerIdx >= list.length-1;
    body.scrollTop = 0;
    updateReaderBar();
  }
  function paras(t){ return t.split(/\n+/).filter(p=>p.trim()).map(p=>`<p>${escapeHtml(p)}</p>`).join(''); }
  function updateReaderBar(){ const b = el('readerBody'), bar = el('readerBar'); if(!b||!bar) return; const max = b.scrollHeight - b.clientHeight; bar.style.width = max>0 ? (b.scrollTop/max*100)+'%' : '0%'; }
  function openReader(){
    if(!reader) return;
    const list = readerChapters();
    const pi = D.previewIdx; const k = D.exportOrder.indexOf(pi);
    readerIdx = Math.max(0, list.findIndex(c=>c === D.chapters[pi]));
    if(readerIdx < 0) readerIdx = 0;
    renderReader(); openModal('readerModal');
  }
  if(reader){
    el('readerPrev').addEventListener('click', ()=>{ readerIdx--; renderReader(); });
    el('readerNext').addEventListener('click', ()=>{ readerIdx++; renderReader(); });
    el('readerFontMinus').addEventListener('click', ()=>{ readerFont = Math.max(14, readerFont-1); el('readerBody').style.fontSize = readerFont+'px'; });
    el('readerFontPlus').addEventListener('click', ()=>{ readerFont = Math.min(28, readerFont+1); el('readerBody').style.fontSize = readerFont+'px'; });
    el('readerAll').addEventListener('click', (e)=>{ readerAll = !readerAll; e.currentTarget.classList.toggle('active', readerAll); renderReader(); });
    el('readerBody').addEventListener('scroll', updateReaderBar, {passive:true});
    el('readerFontSel').addEventListener('change', e=>{ el('readerBody').dataset.font = e.target.value; });
    reader.addEventListener('keydown', e=>{ if(e.key==='ArrowLeft' && !el('readerPrev').disabled) el('readerPrev').click(); if(e.key==='ArrowRight' && !el('readerNext').disabled) el('readerNext').click(); });
    el('readingModeBtn') && el('readingModeBtn').addEventListener('click', openReader);
  }

  /* ------------------------------------------------------------------
     3. Diff viewer (word-level LCS)
     ------------------------------------------------------------------ */
  function diffWords(a, b){
    const A = a.split(/(\s+)/).filter(Boolean), B = b.split(/(\s+)/).filter(Boolean);
    const MAXN = 2500;
    if(A.length > MAXN || B.length > MAXN){ return [['del', A.join('')], ['ins', B.join('')]]; }
    const n = A.length, m = B.length;
    const dp = new Uint16Array((n+1)*(m+1));
    for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--){
      dp[i*(m+1)+j] = A[i]===B[j] ? dp[(i+1)*(m+1)+j+1]+1 : Math.max(dp[(i+1)*(m+1)+j], dp[i*(m+1)+j+1]);
    }
    const out = []; let i=0, j=0;
    const push = (t, s)=>{ if(out.length && out[out.length-1][0]===t) out[out.length-1][1]+=s; else out.push([t, s]); };
    while(i<n && j<m){
      if(A[i]===B[j]){ push('eq', A[i]); i++; j++; }
      else if(dp[(i+1)*(m+1)+j] >= dp[i*(m+1)+j+1]){ push('del', A[i]); i++; }
      else { push('ins', B[j]); j++; }
    }
    while(i<n) push('del', A[i++]);
    while(j<m) push('ins', B[j++]);
    return out;
  }
  let diffIdx = -1;
  function openDiff(i){
    if(i == null || i < 0) i = D.previewIdx >= 0 ? D.previewIdx : 0;
    const c = D.chapters[i]; if(!c) return;
    diffIdx = i;
    el('diffTitle').textContent = `${i+1}. ${c.title}`;
    const orig = c.originalText || '', tr = c.text || '';
    const left = el('diffLeft'), right = el('diffRight'), summary = el('diffSummary');
    if(!orig && !tr){ left.innerHTML = right.innerHTML = '<div class="reader-empty">Nothing captured for this chapter yet.</div>'; summary.textContent=''; }
    else {
      const mode = el('diffMode').value;
      if(mode === 'side'){
        left.innerHTML = paras(orig || '(original not captured)');
        right.innerHTML = paras(tr || '(not translated yet)');
        el('diffPane').classList.remove('inline');
      } else {
        const parts = diffWords(orig, tr);
        left.innerHTML = parts.map(([t,s])=>`<span class="d-${t}">${escapeHtml(s)}</span>`).join('');
        right.innerHTML = '';
        el('diffPane').classList.add('inline');
      }
      const ow = D.wordCount(orig), tw = D.wordCount(tr);
      summary.textContent = `${formatNum(ow)} → ${formatNum(tw)} words · ratio ${ow? (tw/ow).toFixed(2):'—'} · ${D.statusLabel(c.status)}${c.fromCloud?' · from shared library by '+escapeHtml(c.cloudBy||''):''}`;
    }
    el('diffPrev').disabled = i<=0; el('diffNext').disabled = i>=D.chapters.length-1;
    openModal('diffModal');
  }
  if(el('diffModal')){
    el('diffPrev').addEventListener('click', ()=>openDiff(diffIdx-1));
    el('diffNext').addEventListener('click', ()=>openDiff(diffIdx+1));
    el('diffMode').addEventListener('change', ()=>openDiff(diffIdx));
    el('diffBtn') && el('diffBtn').addEventListener('click', ()=>openDiff(D.previewIdx));
  }

  /* ------------------------------------------------------------------
     4. Glossary / custom dictionary (auto-applied to every verified chapter)
     ------------------------------------------------------------------ */
  let glossary = lsGet(LS.glossary, []);
  function glossaryApply(text){
    if(!glossary.length || !text) return text;
    let t = text;
    for(const g of glossary){
      if(!g.from) continue;
      try{
        const re = g.regex ? new RegExp(g.from, g.cs ? 'g' : 'gi') : new RegExp(g.word ? `\\b${escRe(g.from)}\\b` : escRe(g.from), g.cs ? 'g' : 'gi');
        t = t.replace(re, g.to || '');
      }catch(e){}
    }
    return t;
  }
  function escRe(s){ return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  window.DTVHooks.transformText = (t)=> glossaryApply(t);
  function renderGlossary(){
    const list = el('glossaryList'); if(!list) return;
    el('glossaryCount').textContent = glossary.length ? `${glossary.length} rule${glossary.length>1?'s':''}` : '';
    list.innerHTML = glossary.length ? glossary.map((g, i)=>`
      <div class="gl-row">
        <span class="gl-from" title="${escapeAttr(g.from)}">${escapeHtml(g.from)}</span>
        <span class="gl-arrow">\u2192</span>
        <span class="gl-to" title="${escapeAttr(g.to)}">${escapeHtml(g.to) || '<i>(remove)</i>'}</span>
        <span class="gl-tags">${g.cs?'<b>Aa</b>':''}${g.word?'<b>W</b>':''}${g.regex?'<b>.*</b>':''}</span>
        <button class="editor-btn" data-gl-del="${i}" title="Delete rule">\u2715</button>
      </div>`).join('') : '<div class="empty-hint">No rules yet. Add terms that should always be translated a specific way — they\u2019re applied automatically to every verified chapter.</div>';
  }
  if(el('glossaryModal')){
    renderGlossary();
    el('glossaryAdd').addEventListener('click', ()=>{
      const from = el('glFrom').value.trim(), to = el('glTo').value;
      if(!from){ showToast('Enter the text to find', 'warn'); return; }
      glossary.push({from, to, cs: el('glCase').checked, word: el('glWord').checked, regex: el('glRegex').checked});
      lsSet(LS.glossary, glossary); renderGlossary();
      el('glFrom').value=''; el('glTo').value=''; el('glFrom').focus();
    });
    el('glFrom').addEventListener('keydown', e=>{ if(e.key==='Enter') el('glTo').focus(); });
    el('glTo').addEventListener('keydown', e=>{ if(e.key==='Enter') el('glossaryAdd').click(); });
    el('glossaryList').addEventListener('click', e=>{ const b = e.target.closest('[data-gl-del]'); if(!b) return; glossary.splice(parseInt(b.dataset.glDel,10),1); lsSet(LS.glossary, glossary); renderGlossary(); });
    el('glossaryApplyNow').addEventListener('click', ()=>{
      if(!glossary.length){ showToast('Add at least one rule first','warn'); return; }
      let changed = 0;
      D.chapters.forEach(c=>{ if(c.text){ const nt = glossaryApply(c.text); if(nt !== c.text){ D.setText(c, nt); changed++; } } });
      if(changed){ D.renderEditorList(); D.refreshDownloadSummary(); D.requestProgressUpdate(); D.saveSessionProgress(); if(D.previewIdx>=0) D.previewChapter(D.previewIdx,{scroll:false}); }
      showToast(changed ? `Glossary applied to ${changed} chapter${changed>1?'s':''}` : 'No chapters needed changes', changed?'ok':'info');
    });
    el('glossaryExport').addEventListener('click', ()=>{ D.triggerDownload(new Blob([JSON.stringify({dtvGlossary:1, rules:glossary}, null, 2)],{type:'application/json'}), 'dtv_glossary.json'); });
    el('glossaryImport').addEventListener('click', ()=>el('glossaryFile').click());
    el('glossaryFile').addEventListener('change', e=>{
      const f = e.target.files[0]; e.target.value=''; if(!f) return;
      const r = new FileReader(); r.onload = ()=>{ try{ const d = JSON.parse(r.result); const rules = Array.isArray(d) ? d : d.rules; if(!Array.isArray(rules)) throw 0; glossary = glossary.concat(rules.filter(x=>x && x.from)); lsSet(LS.glossary, glossary); renderGlossary(); showToast(`Imported ${rules.length} rules`,'ok'); }catch(err){ showToast('Not a valid glossary file','err'); } }; r.readAsText(f);
    });
    el('glossaryBtn') && el('glossaryBtn').addEventListener('click', ()=>openModal('glossaryModal'));
    el('glossaryClear').addEventListener('click', ()=>{ if(!glossary.length) return; if(confirm('Delete all glossary rules?')){ glossary = []; lsSet(LS.glossary, glossary); renderGlossary(); } });
  }

  /* ------------------------------------------------------------------
     5. Statistics dashboard
     ------------------------------------------------------------------ */
  function openStats(){
    const ch = D.chapters; if(!ch.length) return;
    const done = ch.filter(c=>c.status==='done'), unv = ch.filter(c=>c.status==='unverified'), sk = ch.filter(c=>c.status==='skipped');
    const durs = ch.filter(c=>c.durMs>0);
    const avg = durs.length ? durs.reduce((s,c)=>s+c.durMs,0)/durs.length : 0;
    const fastest = durs.slice().sort((a,b)=>a.durMs-b.durMs)[0], slowest = durs.slice().sort((a,b)=>b.durMs-a.durMs)[0];
    const words = ch.reduce((s,c)=>s+(c.wc||0),0);
    const cloud = ch.filter(c=>c.fromCloud).length;
    const rate = ch.length ? Math.round(done.length/ch.length*100) : 0;
    el('statsKpis').innerHTML = [
      ['Success rate', rate+'%', 'green'], ['Verified', done.length+' / '+ch.length, ''],
      ['Unverified', unv.length, 'red'], ['Skipped', sk.length, 'amber'],
      ['Words out', formatNum(words), 'purple'], ['Avg / chapter', avg?formatDuration(avg):'—', ''],
      ['From shared library', cloud, 'accent'], ['Flagged / notes', ch.filter(c=>c.flag||c.note).length, '']
    ].map(([k,v,c])=>`<div class="kpi ${c}"><b>${v}</b><span>${k}</span></div>`).join('');
    const maxW = Math.max(1, ...ch.map(c=>c.wc||0));
    const maxD = Math.max(1, ...ch.map(c=>c.durMs||0));
    el('statsBars').innerHTML = ch.map((c,i)=>`
      <div class="sbar-row" title="${escapeAttr(c.title)} · ${formatNum(c.wc||0)} words${c.durMs?' · '+formatDuration(c.durMs):''}">
        <span class="sbar-i">${i+1}</span>
        <span class="sbar-track"><i class="sbar-w st-${c.status}" style="width:${(c.wc||0)/maxW*100}%"></i>${c.durMs?`<i class="sbar-d" style="width:${c.durMs/maxD*100}%"></i>`:''}</span>
      </div>`).join('');
    el('statsExtremes').innerHTML = `
      ${fastest?`<div><span>Fastest</span><b>${escapeHtml(fastest.title)}</b><small>${formatDuration(fastest.durMs)}</small></div>`:''}
      ${slowest?`<div><span>Slowest</span><b>${escapeHtml(slowest.title)}</b><small>${formatDuration(slowest.durMs)}</small></div>`:''}
      <div><span>Longest chapter</span><b>${escapeHtml(ch.slice().sort((a,b)=>(b.wc||0)-(a.wc||0))[0].title)}</b><small>${formatNum(Math.max(...ch.map(c=>c.wc||0)))} words</small></div>`;
    openModal('statsModal');
  }
  el('statsBtn') && el('statsBtn').addEventListener('click', openStats);
  el('statsCsv') && el('statsCsv').addEventListener('click', ()=>{
    const rows = [['#','Title','Status','Words','Duration ms','From cloud','Flag','Note']].concat(D.chapters.map((c,i)=>[i+1, c.title, c.status, c.wc||0, c.durMs||0, c.fromCloud?'yes':'', c.flag?'yes':'', c.note||'']));
    const csv = rows.map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    D.triggerDownload(new Blob([csv],{type:'text/csv'}), `${D.safeFileName(D.bookTitle,'book')}_stats.csv`);
  });

  /* ------------------------------------------------------------------
     6. Export preview
     ------------------------------------------------------------------ */
  function openExportPreview(){
    const list = D.getExportChapters();
    if(!list.length){ showToast('Nothing to preview — no included translated chapters', 'warn'); return; }
    const mode = D.exportMode;
    const body = el('exportPreviewBody');
    const LIM = 3;
    const sample = list.slice(0, LIM);
    let html = '';
    if(mode === 'story'){ html = `<pre>${escapeHtml(sample.map(c=>c.text.trim()).join('\n\n').slice(0, 6000))}</pre>`; }
    else if(mode === 'md'){ html = `<pre>${escapeHtml('# ' + D.bookTitle + '\n\n' + list.map((c,i)=>`${i+1}. [${c.title}](#ch-${i+1})`).join('\n') + '\n\n' + sample.map((c,i)=>`## ${c.title}\n\n${c.text.trim()}`).join('\n\n---\n\n').slice(0,6000))}</pre>`; }
    else if(mode === 'html' || mode === 'epub'){ html = `<div class="ep-doc"><h1>${escapeHtml(D.bookTitle)}</h1><ol class="ep-toc">${list.map(c=>`<li>${escapeHtml(c.title)}</li>`).join('')}</ol>${sample.map(c=>`<h2>${escapeHtml(c.title)}</h2>${paras(c.text.slice(0,2500))}`).join('')}</div>`; }
    else { html = `<div class="ep-files">${list.map((c,i)=>`<div class="ep-file"><span>\u{1F4C4}</span>${String(i+1).padStart(2,'0')}_${escapeHtml(D.safeFileName(c.title,'chapter'))}.txt<small>${formatNum(c.wc||0)} w</small></div>`).join('')}<div class="ep-file"><span>\u{1F4C4}</span>00_full_${escapeHtml(D.safeFileName(D.bookTitle,'book'))}.txt</div></div>`; }
    body.innerHTML = html + (list.length > LIM && mode!=='txt' ? `<div class="ep-more">\u2026 and ${list.length-LIM} more chapter${list.length-LIM>1?'s':''} in the real export</div>` : '');
    el('exportPreviewMeta').textContent = `${mode.toUpperCase()} · ${list.length} chapters · ${formatNum(list.reduce((s,c)=>s+(c.wc||0),0))} words`;
    openModal('exportPreviewModal');
  }
  el('exportPreviewBtn') && el('exportPreviewBtn').addEventListener('click', openExportPreview);
  el('exportPreviewDownload') && el('exportPreviewDownload').addEventListener('click', ()=>{ closeModal('exportPreviewModal'); D.download(); });

  /* ------------------------------------------------------------------
     7. Chapter notes + context menu
     ------------------------------------------------------------------ */
  let noteIdx = -1;
  function openNote(i){
    const c = D.chapters[i]; if(!c) return;
    noteIdx = i;
    el('noteTitle').textContent = `${i+1}. ${c.title}`;
    el('noteText').value = c.note || '';
    el('noteFlag').checked = !!c.flag;
    openModal('noteModal');
  }
  if(el('noteModal')){
    el('noteSave').addEventListener('click', ()=>{
      const c = D.chapters[noteIdx]; if(!c) return;
      c.flag = el('noteFlag').checked;
      D.setChapterNote(noteIdx, el('noteText').value);
      closeModal('noteModal'); showToast('Note saved','ok',1400);
    });
  }
  const ctx = el('ctxMenu');
  function hideCtx(){ if(ctx) ctx.classList.remove('show'); }
  on('chapter:menu', ({i, x, y})=>{
    if(!ctx) return;
    const c = D.chapters[i];
    ctx.innerHTML = `
      <button data-a="preview">Preview</button>
      <button data-a="read">Open in reader</button>
      <button data-a="diff">Diff original vs translated</button>
      <hr>
      <button data-a="flag">${c.flag?'Remove flag':'Flag chapter'}</button>
      <button data-a="note">${c.note?'Edit note':'Add note'}</button>
      <hr>
      <button data-a="pending" ${D.running?'disabled':''}>Mark pending (re-translate)</button>
      <button data-a="skip" ${D.running||c.status==='done'?'disabled':''}>Mark skipped</button>
      <button data-a="${c.excluded?'include':'exclude'}">${c.excluded?'Include in export':'Exclude from export'}</button>
      <hr>
      <button data-a="copy" ${c.text?'':'disabled'}>Copy translated text</button>`;
    ctx.style.left = Math.min(x, window.innerWidth - 230) + 'px';
    ctx.style.top = Math.min(y, window.innerHeight - ctx.offsetHeight - 240) + 'px';
    ctx.classList.add('show');
    ctx.onclick = (e)=>{
      const b = e.target.closest('button[data-a]'); if(!b || b.disabled) return;
      const a = b.dataset.a; hideCtx();
      if(a==='preview') D.previewChapter(i);
      else if(a==='read'){ D.previewChapter(i,{scroll:false}); openReader(); }
      else if(a==='diff') openDiff(i);
      else if(a==='flag'){ D.toggleChapterFlag(i); }
      else if(a==='note') openNote(i);
      else if(a==='pending'){ c.bulkSkipped=false; c.retries=0; c.fromCloud=false; D.setChapterStatus(i,'pending'); D.nodes.startBtn.disabled=false; }
      else if(a==='skip'){ c.bulkSkipped=true; D.setChapterStatus(i,'skipped'); }
      else if(a==='include'||a==='exclude'){ c.excluded = a==='exclude'; D.renderEditorList(); D.saveSessionProgress(); showToast(c.excluded?'Excluded from export':'Included in export','info',1400); }
      else if(a==='copy'){ navigator.clipboard.writeText(c.text||'').then(()=>showToast('Copied','ok',1200)).catch(()=>showToast('Clipboard blocked','err')); }
    };
  });
  document.addEventListener('click', e=>{ if(ctx && !ctx.contains(e.target)) hideCtx(); });
  document.addEventListener('scroll', hideCtx, {passive:true});
  window.addEventListener('blur', hideCtx);

  /* ------------------------------------------------------------------
     8. Confetti on run completion
     ------------------------------------------------------------------ */
  function confetti(){
    if(REDUCED) return;
    const cv = document.createElement('canvas'); cv.className = 'confetti'; document.body.appendChild(cv);
    const ctx2 = cv.getContext('2d'); cv.width = innerWidth; cv.height = innerHeight;
    const colors = ['#5b8def','#a371f7','#3fb950','#d29922','#ff6b9d','#7aa5ff'];
    const P = Array.from({length: 160}, ()=>({x: cv.width/2 + (Math.random()-.5)*200, y: cv.height*0.35, vx:(Math.random()-.5)*14, vy:-Math.random()*14-4, r: Math.random()*6+3, c: colors[Math.floor(Math.random()*colors.length)], a: Math.random()*Math.PI, s: (Math.random()-.5)*.3}));
    const t0 = performance.now();
    (function frame(now){
      const t = (now - t0)/1000;
      ctx2.clearRect(0,0,cv.width,cv.height);
      P.forEach(p=>{ p.vy += .35; p.x += p.vx; p.y += p.vy; p.vx *= .99; p.a += p.s; ctx2.save(); ctx2.translate(p.x,p.y); ctx2.rotate(p.a); ctx2.fillStyle = p.c; ctx2.globalAlpha = Math.max(0, 1 - t/2.6); ctx2.fillRect(-p.r/2,-p.r/2,p.r,p.r*.6); ctx2.restore(); });
      if(t < 2.8) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }
  on('run:complete', ({doneCount, total, stopped})=>{ if(!stopped && doneCount === total && total > 0) confetti(); rememberRecent(); });

  /* ------------------------------------------------------------------
     9. Recent sessions (hero)
     ------------------------------------------------------------------ */
  function rememberRecent(){
    if(!D.chapters.length) return;
    const list = lsGet(LS.recent, []);
    const key = D.sessionKey || D.bookTitle;
    const done = D.chapters.filter(c=>c.status==='done').length;
    const entry = { key, title: D.bookTitle, fileName: D.currentFile ? D.currentFile.name : '', size: D.currentFile ? D.currentFile.size : 0, count: D.chapters.length, done, at: Date.now() };
    const next = [entry].concat(list.filter(x=>x.key !== key)).slice(0, 8);
    lsSet(LS.recent, next); renderRecent();
  }
  function renderRecent(){
    const wrap = el('recentWrap'), list = el('recentList'); if(!wrap||!list) return;
    const items = lsGet(LS.recent, []);
    wrap.classList.toggle('show', items.length > 0);
    list.innerHTML = items.map(x=>`
      <div class="recent-item" data-key="${escapeAttr(x.key)}">
        <div class="recent-ext" data-ext="${escapeAttr((x.fileName.split('.').pop()||'').toLowerCase())}">${escapeHtml((x.fileName.split('.').pop()||'bk').toUpperCase().slice(0,4))}</div>
        <div class="recent-main"><b title="${escapeAttr(x.title)}">${escapeHtml(x.title)}</b><span>${x.done}/${x.count} chapters · ${timeAgo(x.at)}</span>
        <i class="recent-bar"><i style="width:${x.count?x.done/x.count*100:0}%"></i></i></div>
        <button class="editor-btn" data-recent-del="${escapeAttr(x.key)}" title="Remove">\u2715</button>
      </div>`).join('');
  }
  function timeAgo(t){ const s = (Date.now()-t)/1000; if(s<60) return 'just now'; if(s<3600) return Math.floor(s/60)+' min ago'; if(s<86400) return Math.floor(s/3600)+' h ago'; return Math.floor(s/86400)+' d ago'; }
  if(el('recentList')){
    renderRecent();
    el('recentList').addEventListener('click', e=>{
      const del = e.target.closest('[data-recent-del]');
      if(del){ lsSet(LS.recent, lsGet(LS.recent,[]).filter(x=>x.key!==del.dataset.recentDel)); renderRecent(); return; }
      const item = e.target.closest('.recent-item'); if(!item) return;
      showToast('Pick the same file again — your saved progress will be offered automatically', 'info', 3600);
      D.openFile();
    });
    el('recentClear') && el('recentClear').addEventListener('click', ()=>{ lsSet(LS.recent, []); renderRecent(); });
  }
  on('chapter:status', ()=>{ clearTimeout(rememberRecent._t); rememberRecent._t = setTimeout(rememberRecent, 2500); });
  on('book:loaded', ()=>setTimeout(rememberRecent, 800));

  /* ------------------------------------------------------------------
     10. Community library (hero) — needs DTVCloud
     ------------------------------------------------------------------ */
  async function renderLibrary(){
    const wrap = el('libraryWrap'), list = el('libraryList'); if(!wrap||!list||!window.DTVCloud) return;
    list.innerHTML = '<div class="skel-row"></div><div class="skel-row"></div><div class="skel-row"></div>';
    const items = await window.DTVCloud.fetchLibraryIndex(12);
    wrap.classList.toggle('show', items.length > 0);
    list.innerHTML = items.map(x=>{
      const pct = x.chapterCount ? Math.round((x.doneCount||0)/x.chapterCount*100) : 0;
      return `<div class="lib-item" data-id="${escapeAttr(x.id)}">
        <div class="lib-ring" style="--p:${pct}"><span>${pct}%</span></div>
        <div class="recent-main"><b title="${escapeAttr(x.title||x.id)}">${escapeHtml(x.title||x.id)}</b><span>${x.doneCount||0}/${x.chapterCount||'?'} chapters · ${x.updatedAt?timeAgo(x.updatedAt):''}</span></div>
        <span class="lib-open">Open \u2192</span></div>`;
    }).join('');
  }
  if(el('libraryList')){
    el('libraryList').addEventListener('click', e=>{ const it = e.target.closest('.lib-item'); if(it && window.DTVCloud) window.DTVCloud.openFromLibrary(it.dataset.id); });
    el('libraryRefresh') && el('libraryRefresh').addEventListener('click', renderLibrary);
    on('cloud:ready', renderLibrary);
    if(window.DTVCloud) renderLibrary();
  }

  /* ------------------------------------------------------------------
     11. Onboarding tour
     ------------------------------------------------------------------ */
  const TOUR = [
    { sel:'#dropZone', title:'1 · Upload', text:'Drop an EPUB, PDF, DOCX or TXT here. Everything is parsed locally in your browser.' },
    { sel:'#cmdBtn', title:'Command palette', text:'Press Ctrl+K (or ⌘K) any time to search every action — start, export, themes, chapters…' },
    { sel:'#themeToggle', title:'Themes', text:'Dark, Light, AMOLED and Sepia. Press T to cycle.' },
    { sel:'#libraryWrap', title:'Shared library', text:'Chapters translated by anyone are saved to Firebase. Open the same file and the run continues from where the community left off.', optional:true },
    { sel:'#recentWrap', title:'Recent sessions', text:'Your recent books and their progress live here.', optional:true },
  ];
  let tourStep = 0;
  function startTour(force){
    if(!force && lsGet(LS.tour, false)) return;
    if(!el('tourPop')) return;
    tourStep = 0; showTourStep();
  }
  function showTourStep(){
    const pop = el('tourPop'), hl = el('tourHl');
    while(tourStep < TOUR.length){
      const s = TOUR[tourStep]; const n = document.querySelector(s.sel);
      if(n && n.offsetParent !== null && !(s.optional && !n.classList.contains('show') && s.sel!=='#libraryWrap' && s.sel!=='#recentWrap')) break;
      if(n && n.offsetParent !== null && (!s.optional || n.classList.contains('show'))) break;
      tourStep++;
    }
    if(tourStep >= TOUR.length){ endTour(); return; }
    const s = TOUR[tourStep], n = document.querySelector(s.sel);
    hl.classList.remove('show'); pop.classList.remove('show');
    n.scrollIntoView({block:'center', behavior: REDUCED?'auto':'smooth'});
    /* The old code measured getBoundingClientRect() after a fixed 320ms
       timeout — too short for a long smooth-scroll (e.g. jumping from the
       top of the page down to the odometer), so the highlight box was
       positioned using a stale, pre-scroll rectangle and landed on the
       wrong element. Instead, poll until scrollY stops changing (scroll
       finished) before measuring, with a hard cap so it can never hang. */
    const place = ()=>{
      const r = n.getBoundingClientRect();
      const popW = Math.min(320, innerWidth - 20);
      /* Clamp the highlight box itself to the viewport so it can never
         overflow horizontally/vertically on narrow (mobile) screens. */
      const hlLeft = Math.max(4, r.left - 8);
      const hlTop = Math.max(4, r.top - 8);
      const hlRight = Math.min(innerWidth - 4, r.right + 8);
      const hlBottom = Math.min(innerHeight - 4, r.bottom + 8);
      hl.style.cssText = `top:${hlTop}px;left:${hlLeft}px;width:${Math.max(0,hlRight-hlLeft)}px;height:${Math.max(0,hlBottom-hlTop)}px;`;
      hl.classList.add('show');
      pop.innerHTML = `<b>${escapeHtml(s.title)}</b><p>${escapeHtml(s.text)}</p><div class="tour-foot"><span>${tourStep+1} / ${TOUR.length}</span><button class="mini-btn" data-tour="skip">Skip</button><button class="banner-btn primary" data-tour="next">${tourStep===TOUR.length-1?'Done':'Next'}</button></div>`;
      pop.style.width = popW + 'px';
      const below = r.bottom + 190 < innerHeight;
      pop.style.top = (below ? r.bottom + 14 : Math.max(10, r.top - 14 - 170)) + 'px';
      pop.style.left = Math.max(10, Math.min(innerWidth - popW - 10, r.left + r.width/2 - popW/2)) + 'px';
      pop.classList.add('show');
    };
    if(REDUCED){ place(); return; }
    let lastY = -1, stableFrames = 0, waited = 0;
    const poll = ()=>{
      const y = window.scrollY;
      if(Math.abs(y - lastY) < 1) stableFrames++; else stableFrames = 0;
      lastY = y; waited += 16;
      if(stableFrames >= 3 || waited >= 900){ place(); return; }
      requestAnimationFrame(poll);
    };
    setTimeout(()=>requestAnimationFrame(poll), 60);
  }
  function endTour(){ el('tourPop').classList.remove('show'); el('tourHl').classList.remove('show'); lsSet(LS.tour, true); }
  if(el('tourPop')){
    el('tourPop').addEventListener('click', e=>{ const b = e.target.closest('[data-tour]'); if(!b) return; if(b.dataset.tour==='skip') endTour(); else { tourStep++; showTourStep(); } });
    el('tourBtn') && el('tourBtn').addEventListener('click', ()=>startTour(true));
    setTimeout(()=>{ if(!loaded()) startTour(false); }, 1400);
    window.addEventListener('resize', ()=>{ if(el('tourPop').classList.contains('show')) showTourStep(); });
  }

  /* ------------------------------------------------------------------
     12. Mobile drawer (chapters sidebar as bottom sheet)
     ------------------------------------------------------------------ */
  const drawerBtn = el('drawerBtn'), sidebar = el('sidebar'), scrim = el('drawerScrim');
  function setDrawer(open){ document.body.classList.toggle('drawer-open', open); if(drawerBtn) drawerBtn.setAttribute('aria-expanded', open); }
  if(drawerBtn){
    drawerBtn.addEventListener('click', ()=>setDrawer(!document.body.classList.contains('drawer-open')));
    scrim && scrim.addEventListener('click', ()=>setDrawer(false));
    let sy=0; sidebar.addEventListener('touchstart', e=>{ sy = e.touches[0].clientY; }, {passive:true});
    sidebar.addEventListener('touchend', e=>{ if(e.changedTouches[0].clientY - sy > 90 && sidebar.scrollTop === 0) setDrawer(false); }, {passive:true});
    on('preview', ()=>{ if(innerWidth <= 900) setDrawer(false); });
  }

  /* ------------------------------------------------------------------
     13. PWA install + service worker
     ------------------------------------------------------------------ */
  let deferredInstall = null;
  window.addEventListener('beforeinstallprompt', e=>{ e.preventDefault(); deferredInstall = e; const b = el('installBtn'); if(b) b.hidden = false; });
  function promptInstall(){ if(!deferredInstall){ showToast('Already installed or not supported by this browser', 'info'); return; } deferredInstall.prompt(); deferredInstall.userChoice.then(()=>{ deferredInstall = null; const b = el('installBtn'); if(b) b.hidden = true; }); }
  el('installBtn') && el('installBtn').addEventListener('click', promptInstall);
  if('serviceWorker' in navigator && location.protocol.startsWith('http')){
    window.addEventListener('load', ()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); });
  }
  window.addEventListener('online', ()=>showToast('Back online','ok',1600));
  window.addEventListener('offline', ()=>showToast('You are offline — everything still works locally; cloud sync resumes later','warn',3600));

  /* ------------------------------------------------------------------
     14. UI language toggle (English / Hinglish) — light-touch, key labels only
     ------------------------------------------------------------------ */
  const HI = {
    'Upload':'Upload', 'Translate':'Translate', 'Review':'Review', 'Export':'Export',
    'heroTitle':'Chrome translation ka har chapter <span class="grad">verify</span> karo, phir export karo',
    'heroSub':'EPUB, PDF, DOCX ya TXT upload karo. Chrome ka built-in translate on karo. Tool har chapter check karta hai ki text sach mein translate hua, aur result package kar deta hai — kuch bhi device se bahar nahi jaata.',
    'dropLabel':'Yahan document drop karo, ya <em>browse</em> karo',
    'startBtn':'Verified Translation Shuru Karo'
  };
  let uiLang = lsGet(LS.lang, 'en');
  const enCache = {};
  function applyUiLang(){
    const h1 = document.querySelector('.hero h1'), sub = document.querySelector('.hero-sub'), dl = document.querySelector('.drop-label'), sb = el('startBtnLabel');
    if(h1 && !enCache.h1){ enCache.h1 = h1.innerHTML; enCache.sub = sub.innerHTML; enCache.dl = dl.innerHTML; }
    const hi = uiLang === 'hi';
    if(h1){ h1.innerHTML = hi ? HI.heroTitle : enCache.h1; sub.innerHTML = hi ? HI.heroSub : enCache.sub; dl.innerHTML = hi ? HI.dropLabel : enCache.dl; }
    document.documentElement.dataset.uiLang = uiLang;
    const lb = el('langBtn'); if(lb) lb.textContent = hi ? 'हिं' : 'EN';
  }
  function toggleUiLang(){ uiLang = uiLang === 'en' ? 'hi' : 'en'; lsSet(LS.lang, uiLang); applyUiLang(); showToast(uiLang==='hi' ? 'Interface: Hinglish' : 'Interface: English', 'info', 1400); }
  el('langBtn') && el('langBtn').addEventListener('click', toggleUiLang);
  applyUiLang();

  /* ------------------------------------------------------------------
     15. Extra keyboard shortcuts
     ------------------------------------------------------------------ */
  document.addEventListener('keydown', e=>{
    if((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k'){ e.preventDefault(); if(palette && palette.classList.contains('show')) closeModal('cmdPalette'); else openPalette(); return; }
    if(e.key === 'Escape'){ if(ctx && ctx.classList.contains('show')){ hideCtx(); return; } const open = document.querySelector('.modal.show:not(#shortcutsModal)'); if(open){ closeModal(open.id); e.stopImmediatePropagation(); return; } if(document.body.classList.contains('drawer-open')){ setDrawer(false); return; } }
    if(e.target.matches('input, select, textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
    if(document.querySelector('.modal.show')) return;
    const k = e.key.toLowerCase();
    if(k === 'o' && !D.running){ e.preventDefault(); D.openFile(); }
    else if(k === 'r' && loaded()){ e.preventDefault(); openReader(); }
    else if(k === 'd' && loaded()){ e.preventDefault(); openDiff(D.previewIdx); }
    else if(k === 'g'){ e.preventDefault(); openModal('glossaryModal'); }
    else if(k === 'n' && loaded() && D.previewIdx>=0){ e.preventDefault(); openNote(D.previewIdx); }
  }, true);

  /* ------------------------------------------------------------------
     16. Small polish: viewer toolbar buttons, step click nav, sticky header shadow
     ------------------------------------------------------------------ */
  el('noteBtn') && el('noteBtn').addEventListener('click', ()=>{ if(D.previewIdx>=0) openNote(D.previewIdx); });
  el('flagBtn') && el('flagBtn').addEventListener('click', ()=>{ if(D.previewIdx>=0){ const f = D.toggleChapterFlag(D.previewIdx); showToast(f?'Chapter flagged':'Flag removed','info',1200); } });
  on('preview', ({i})=>{ const c = D.chapters[i]; const fb = el('flagBtn'); if(fb) fb.classList.toggle('active', !!(c&&c.flag)); const nb = el('noteBtn'); if(nb) nb.classList.toggle('active', !!(c&&c.note)); });
  let lastY = 0;
  window.addEventListener('scroll', ()=>{ const y = scrollY; document.getElementById('topbar').classList.toggle('scrolled', y > 8); lastY = y; }, {passive:true});
  document.querySelectorAll('#stepper .step').forEach(s=>s.addEventListener('click', ()=>{
    const k = parseInt(s.dataset.step,10);
    if(k===1){ if(!loaded()) return; D.ensureInView(el('upload-section'), true); }
    else if(k===2 && loaded()) D.ensureInView(el('actionPanel'), true);
    else if(k===3 && el('editorPanel').style.display!=='none') D.ensureInView(el('editorPanel'), true);
    else if(k===4 && el('downloadPanel').style.display!=='none') D.ensureInView(el('downloadPanel'), true);
  }));

  window.DTVPro = { openPalette, openReader, openDiff, openStats, openExportPreview, openNote, startTour, confetti, renderLibrary, renderRecent, openModal, closeModal };
})();
