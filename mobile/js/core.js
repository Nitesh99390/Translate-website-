/* Xplin Go — core.js
 * State, settings, toasts, IndexedDB sessions, file parsing (EPUB / PDF / DOCX / TXT).
 * Shares the same IndexedDB (docTranslatorDB) and theme key as Novelxplin so books
 * can be resumed across the three layouts.
 */
'use strict';

window.XG = window.XG || {};
const XG = window.XG;

/* ---------- helpers ---------- */
XG.el = (id) => document.getElementById(id);
XG.escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
XG.escapeXml = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
XG.sleep = (ms) => new Promise(r => setTimeout(r, ms));
XG.formatBytes = (b) => b < 1024 ? b + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(1) + ' MB';
XG.wordCount = (s) => { const t = (s||'').trim(); return t ? t.split(/\s+/).length : 0; };
XG.safeFileName = (s, fb) => { const c = String(s||'').replace(/[^a-zA-Z0-9 \-_]/g,'').trim(); return c || fb; };

const bus = new EventTarget();
XG.emit = (name, detail) => { try{ bus.dispatchEvent(new CustomEvent(name, {detail})); }catch(e){} };
XG.on = (name, fn) => bus.addEventListener(name, e => fn(e.detail));

/* ---------- state ---------- */
XG.state = {
  book: null,
  chapters: [],
  currentFile: null,
  bookTitle: '',
  bookLang: 'en',
  exportOrder: [],
  sessionKey: null,
  running: false, paused: false, stopRequested: false, skipRequested: false,
  currentIdx: -1, previewIdx: -1,
  verifyMode: 'auto',
  durations: []
};
const S = XG.state;
XG.ORIG_SNIPPET = 4000;

/* ---------- settings ---------- */
const SETTINGS_KEY = 'xg_settings_v1';
XG.settings = {
  timeoutMs: 8000, maxRetries: 2, gapMs: 500, scrollMs: 200,
  sound: true, vibrate: true, memSaver: true, wake: true, compare: false,
  fontSize: 18, lineHeight: 1.7, fontFamily: 'serif'
};
XG.loadSettings = function(){
  try{
    const raw = localStorage.getItem(SETTINGS_KEY);
    const legacy = !raw ? localStorage.getItem('dtv_settings_v4') : null;
    const src = raw ? JSON.parse(raw) : (legacy ? JSON.parse(legacy) : null);
    if(src){
      const s = XG.settings;
      if(typeof src.timeoutMs === 'number') s.timeoutMs = src.timeoutMs;
      if(typeof src.maxRetries === 'number') s.maxRetries = src.maxRetries;
      if(typeof src.gapMs === 'number') s.gapMs = src.gapMs;
      if(typeof src.scrollMs === 'number') s.scrollMs = src.scrollMs;
      ['sound','vibrate','memSaver','wake','compare'].forEach(k=>{
        if(typeof src[k] === 'boolean') s[k] = src[k];
        else if(src[k] === 'on' || src[k] === 'off') s[k] = src[k] === 'on';
      });
      if(typeof src.fontSize === 'number') s.fontSize = src.fontSize;
      if(typeof src.lineHeight === 'number') s.lineHeight = src.lineHeight;
      if(src.fontFamily) s.fontFamily = src.fontFamily;
      if(src.verifyMode) S.verifyMode = src.verifyMode;
    }
  }catch(e){}
};
XG.saveSettings = function(){
  try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify({...XG.settings, verifyMode: S.verifyMode})); }catch(e){}
  try{ localStorage.setItem('xg_font_size', String(XG.settings.fontSize)); }catch(e){}
};

/* ---------- theme ---------- */
XG.applyTheme = function(t){
  if(!['dark','light','sepia','amoled'].includes(t)) t = 'dark';
  document.documentElement.dataset.theme = t;
  try{ localStorage.setItem('xg_theme', t); localStorage.setItem('dtv_theme', t); }catch(e){}
  const meta = document.querySelector('meta[name=theme-color]');
  if(meta) meta.content = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() || '#0a0b14';
  document.querySelectorAll('.theme-dot').forEach(b => b.classList.toggle('active', b.dataset.theme === t));
};
XG.getTheme = () => document.documentElement.dataset.theme || 'dark';

/* ---------- toasts / feedback ---------- */
XG.toast = function(msg, type='info', ms=2600){
  const wrap = XG.el('toastWrap');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = msg;
  wrap.appendChild(t);
  requestAnimationFrame(()=>t.classList.add('show'));
  setTimeout(()=>{ t.classList.remove('show'); setTimeout(()=>t.remove(), 300); }, ms);
};
XG.buzz = function(pattern){
  if(!XG.settings.vibrate) return;
  try{ if(navigator.vibrate) navigator.vibrate(pattern || 30); }catch(e){}
};
XG.chime = function(){
  if(!XG.settings.sound) return;
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99].forEach((f, i)=>{
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i*0.12);
      g.gain.exponentialRampToValueAtTime(0.18, ctx.currentTime + i*0.12 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i*0.12 + 0.35);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i*0.12); o.stop(ctx.currentTime + i*0.12 + 0.4);
    });
    setTimeout(()=>{ try{ ctx.close(); }catch(e){} }, 1200);
  }catch(e){}
};

/* ---------- wake lock ---------- */
let wakeLock = null;
XG.acquireWakeLock = async function(){
  if(!XG.settings.wake || !('wakeLock' in navigator)) return;
  try{ wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', ()=>{ wakeLock = null; }); }catch(e){}
};
XG.releaseWakeLock = function(){ if(wakeLock){ try{ wakeLock.release(); }catch(e){} wakeLock = null; } };
document.addEventListener('visibilitychange', ()=>{ if(S.running && document.visibilityState === 'visible' && !wakeLock) XG.acquireWakeLock(); });

/* ---------- banner ---------- */
XG.banner = function({level='info', title, message, actions=[]}){
  const b = XG.el('banner');
  b.className = 'banner ' + level;
  b.innerHTML = `<b>${XG.escapeHtml(title)}</b><p>${XG.escapeHtml(message)}</p>` + (actions.length ? `<div class="drow"></div>` : '');
  const row = b.querySelector('.drow');
  actions.forEach(a=>{
    const btn = document.createElement('button');
    btn.className = 'dbtn' + (a.primary ? ' primary' : '');
    btn.textContent = a.label;
    btn.addEventListener('click', ()=>{ a.onClick && a.onClick(); });
    row.appendChild(btn);
  });
  if(!actions.length){
    const x = document.createElement('button'); x.className = 'dbtn wide'; x.textContent = 'Dismiss';
    x.addEventListener('click', XG.hideBanner); b.appendChild(x);
  }
  b.hidden = false;
};
XG.hideBanner = function(){ const b = XG.el('banner'); b.hidden = true; b.innerHTML = ''; };

/* ---------- IndexedDB sessions (shared DB with Novelxplin) ---------- */
const IDB_NAME = 'docTranslatorDB', IDB_STORE = 'sessions';
let idbHandle = null, idbAvailable = true;
function idbOpen(){
  return new Promise((resolve, reject)=>{
    if(!('indexedDB' in window)){ reject(new Error('no idb')); return; }
    let req; try{ req = indexedDB.open(IDB_NAME, 1); }catch(err){ reject(err); return; }
    req.onupgradeneeded = ()=>{ req.result.createObjectStore(IDB_STORE, {keyPath:'key'}); };
    req.onsuccess = ()=>resolve(req.result); req.onerror = ()=>reject(req.error);
  });
}
async function db(){ if(idbHandle) return idbHandle; idbHandle = await idbOpen(); return idbHandle; }
XG.idbGet = async function(key){
  try{ const d = await db(); return await new Promise((res, rej)=>{ const r = d.transaction(IDB_STORE,'readonly').objectStore(IDB_STORE).get(key); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); }); }
  catch(e){ idbAvailable = false; return null; }
};
XG.idbPut = async function(v){
  try{ const d = await db(); return await new Promise((res, rej)=>{ const tx = d.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).put(v); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); }); }
  catch(e){ idbAvailable = false; return false; }
};
XG.idbDelete = async function(key){
  try{ const d = await db(); return await new Promise((res, rej)=>{ const tx = d.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).delete(key); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); }); }
  catch(e){ return false; }
};
XG.idbAll = async function(){
  try{ const d = await db(); return await new Promise((res, rej)=>{ const r = d.transaction(IDB_STORE,'readonly').objectStore(IDB_STORE).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
  catch(e){ return []; }
};
XG.idbClear = async function(){
  try{ const d = await db(); return await new Promise((res, rej)=>{ const tx = d.transaction(IDB_STORE,'readwrite'); tx.objectStore(IDB_STORE).clear(); tx.oncomplete=()=>res(true); tx.onerror=()=>rej(tx.error); }); }
  catch(e){ return false; }
};

XG.computeSessionKey = (name, size, count) => `${name}::${size}::${count}`;
XG.buildSessionPayload = function(){
  return {
    key: S.sessionKey, savedAt: Date.now(), bookTitle: S.bookTitle, bookLang: S.bookLang, exportOrder: S.exportOrder,
    fileName: S.currentFile ? S.currentFile.name : '',
    chapters: S.chapters.map(c=>({ title:c.title, status:c.status, text:c.text, originalText:c.originalText||'', retries:c.retries, excluded:!!c.excluded, durMs:c.durMs||0, doneAt:c.doneAt||0 }))
  };
};
let saveDebounce = null, saveInFlight = false, savePending = false;
XG.saveSession = function(){
  if(!S.sessionKey || !idbAvailable) return;
  clearTimeout(saveDebounce);
  saveDebounce = setTimeout(async ()=>{
    if(saveInFlight){ savePending = true; return; }
    saveInFlight = true;
    try{ await XG.idbPut(XG.buildSessionPayload()); }
    finally{ saveInFlight = false; if(savePending){ savePending = false; XG.saveSession(); } }
  }, 600);
};
XG.clearSession = async function(){ if(S.sessionKey) await XG.idbDelete(S.sessionKey); };

/* ---------- file parsing ---------- */
XG.LIB = {
  epub: () => typeof ePub === 'function',
  pdf: () => typeof pdfjsLib !== 'undefined',
  mammoth: () => typeof mammoth !== 'undefined'
};
function requireLib(ok, label){
  if(ok()) return true;
  XG.banner({level:'err', title:'Library not loaded', message:`The helper needed for ${label} didn't load (offline or CDN blocked). Reconnect and reload.`});
  XG.emit('book:failed');
  return false;
}
function mkChapter(i, title, item, html){
  return { index:i, title, item, html, status:'pending', text:'', wc:0, originalText:'', retries:0, excluded:false };
}

XG.handleFile = function(file){
  if(S.running){ XG.toast('Stop the current run first', 'warn'); return; }
  XG.resetForNewFile(file);
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if(ext === 'epub') return parseEpub(file);
  if(ext === 'pdf') return parsePdf(file);
  if(ext === 'docx') return parseDocx(file);
  if(ext === 'txt') return parseTxt(file);
  XG.banner({level:'warn', title:'Unsupported file', message:`Only .epub, .pdf, .docx and .txt are supported (you picked .${ext}).`});
  XG.emit('book:failed');
};

XG.resetForNewFile = function(file){
  S.currentFile = file;
  if(S.book && S.book.destroy){ try{ S.book.destroy(); }catch(e){} }
  S.book = null; S.chapters = []; S.currentIdx = -1; S.previewIdx = -1; S.exportOrder = []; S.durations = [];
  S.bookTitle = file ? file.name.replace(/\.[^.]+$/,'') : 'Restored';
  XG.hideBanner();
  XG.emit('book:reset', {file});
};

function finishLoading(title, lang){
  S.bookTitle = title || S.bookTitle;
  S.bookLang = lang || 'en';
  if(S.chapters.length === 0){
    XG.banner({level:'warn', title:'No content found', message:'The file opened but no readable text was found. Scanned/image-only PDFs can\u2019t be read (no OCR).'});
    XG.emit('book:failed');
    return;
  }
  S.exportOrder = S.chapters.map((c,i)=>i);
  const size = S.currentFile ? S.currentFile.size : 0;
  S.sessionKey = XG.computeSessionKey(S.bookTitle, size, S.chapters.length);
  XG.emit('book:loaded', {title:S.bookTitle, count:S.chapters.length, lang:S.bookLang});
  XG.checkResumable();
}
XG.finishLoading = finishLoading;

XG.checkResumable = async function(){
  const saved = await XG.idbGet(S.sessionKey);
  if(!saved || !saved.chapters || saved.chapters.length !== S.chapters.length) return;
  const done = saved.chapters.filter(c=>c.status==='done' && c.text && c.text.trim()).length;
  if(!done) return;
  XG.banner({
    level:'info', title:'Saved progress found',
    message:`${done} of ${saved.chapters.length} chapters were already translated (${new Date(saved.savedAt).toLocaleString()}).`,
    actions:[
      {label:'Resume', primary:true, onClick:()=>{ XG.applyResumed(saved); XG.hideBanner(); }},
      {label:'Start fresh', onClick:()=>{ XG.clearSession(); XG.hideBanner(); }}
    ]
  });
};
XG.applyResumed = function(saved){
  saved.chapters.forEach((sc, i)=>{
    const c = S.chapters[i]; if(!c) return;
    c.status = sc.status; c.text = sc.text || ''; c.wc = XG.wordCount(c.text);
    c.originalText = sc.originalText || ''; c.retries = sc.retries || 0; c.excluded = !!sc.excluded;
    c.durMs = sc.durMs || 0; c.doneAt = sc.doneAt || 0; if(sc.title) c.title = sc.title;
  });
  if(Array.isArray(saved.exportOrder) && saved.exportOrder.length === S.chapters.length) S.exportOrder = saved.exportOrder.slice();
  XG.emit('chapters:changed');
  XG.toast('Progress restored', 'ok');
};

/* EPUB */
function parseEpub(file){
  if(!requireLib(XG.LIB.epub, '.epub files')) return;
  const reader = new FileReader();
  reader.onerror = ()=>{ XG.banner({level:'err', title:'Read error', message:'Could not read the file from storage.'}); XG.emit('book:failed'); };
  reader.onload = async (ev)=>{
    try{
      S.book = ePub(ev.target.result);
      await S.book.ready;
      const nav = await S.book.loaded.navigation.catch(()=>null);
      const meta = await S.book.loaded.metadata.catch(()=>({}));
      await S.book.loaded.spine;
      const spineArr = (S.book.spine && Array.isArray(S.book.spine.spineItems)) ? S.book.spine.spineItems : null;
      const len = spineArr ? spineArr.length : (S.book.spine.length || 0);
      S.chapters = [];
      for(let i=0;i<len;i++){
        try{
          const item = spineArr ? spineArr[i] : S.book.spine.get(i);
          if(!item) continue;
          let title = 'Chapter ' + (i+1);
          if(nav && nav.toc){ const m = findNav(nav.toc, item.href); if(m) title = m; }
          S.chapters.push(mkChapter(i, title, item, null));
        }catch(e){}
      }
      finishLoading(meta.title || file.name.replace(/\.epub$/i,''), meta.language);
    }catch(err){
      XG.banner({level:'err', title:'Could not open EPUB', message:'This doesn\u2019t look like a valid EPUB — it may be corrupted.'});
      XG.emit('book:failed');
    }
  };
  reader.readAsArrayBuffer(file);
}
function findNav(toc, href){
  if(!href) return null;
  for(const e of toc){
    if(e.href && e.href.split('#')[0] === href.split('#')[0]) return e.label ? e.label.trim() : null;
    if(e.subitems && e.subitems.length){ const r = findNav(e.subitems, href); if(r) return r; }
  }
  return null;
}

/* PDF */
function parsePdf(file){
  if(!requireLib(XG.LIB.pdf, '.pdf files')) return;
  const reader = new FileReader();
  reader.onerror = ()=>{ XG.banner({level:'err', title:'Read error', message:'Could not read the file from storage.'}); XG.emit('book:failed'); };
  reader.onload = async (ev)=>{
    let pdf = null;
    try{
      const v = pdfjsLib.version || '3.11.174';
      pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${v}/pdf.worker.min.js`;
      try{ pdf = await pdfjsLib.getDocument({data: ev.target.result}).promise; }
      catch(e){
        if(e && e.name === 'PasswordException'){ XG.banner({level:'err', title:'Password-protected PDF', message:'Remove the password and try again.'}); XG.emit('book:failed'); return; }
        throw e;
      }
      S.chapters = [];
      let empty = 0;
      for(let p=1;p<=pdf.numPages;p++){
        try{
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          const paras = guessParagraphs(groupLines(content.items));
          const text = paras.join(' ');
          if(text.trim().length < 3) empty++;
          S.chapters.push(mkChapter(p-1, 'Page ' + p, null, paras.map(x=>`<p>${XG.escapeHtml(x)}</p>`).join('\n') || '<p></p>'));
          if(page.cleanup) try{ page.cleanup(); }catch(e){}
        }catch(e){}
        if(p % 20 === 0) XG.emit('parse:progress', {done:p, total:pdf.numPages});
      }
      if(pdf.numPages && empty / pdf.numPages > 0.6) XG.toast('Most pages had no text — scanned PDF?', 'warn', 4000);
      finishLoading(file.name.replace(/\.pdf$/i,''), 'en');
    }catch(err){
      XG.banner({level:'err', title:'Could not read PDF', message:'The file could not be parsed as a PDF.'});
      XG.emit('book:failed');
    }finally{ if(pdf && pdf.destroy) try{ pdf.destroy(); }catch(e){} }
  };
  reader.readAsArrayBuffer(file);
}
function groupLines(items){
  const lines = []; let y0 = null, cur = [];
  items.forEach(it=>{
    if(!it.transform) return;
    const y = Math.round(it.transform[5]);
    if(y0 === null || Math.abs(y - y0) > 2){ if(cur.length) lines.push(cur.join('')); cur = [it.str]; y0 = y; }
    else cur.push(it.str);
  });
  if(cur.length) lines.push(cur.join(''));
  return lines.filter(l=>l.trim().length);
}
function guessParagraphs(lines){
  const out = []; let buf = '';
  lines.forEach(l=>{
    const t = l.trim();
    const ends = /[.!?"')\u0964]$/.test(buf.trim());
    const newPara = buf && ends && /^[A-Z"'(]/.test(t) && buf.trim().length < 90;
    if(newPara){ out.push(buf.trim()); buf = t; } else buf = buf ? buf + ' ' + t : t;
  });
  if(buf.trim()) out.push(buf.trim());
  return out;
}

/* DOCX */
function parseDocx(file){
  if(!requireLib(XG.LIB.mammoth, '.docx files')) return;
  const reader = new FileReader();
  reader.onerror = ()=>{ XG.banner({level:'err', title:'Read error', message:'Could not read the file from storage.'}); XG.emit('book:failed'); };
  reader.onload = async (ev)=>{
    try{
      const result = await mammoth.convertToHtml({arrayBuffer: ev.target.result});
      const box = document.createElement('div'); box.innerHTML = result.value;
      const secs = splitOnHeadings(box); box.innerHTML = '';
      S.chapters = secs.map((s,i)=>mkChapter(i, s.title || ('Section ' + (i+1)), null, s.html));
      finishLoading(file.name.replace(/\.docx$/i,''), 'en');
    }catch(err){
      XG.banner({level:'err', title:'Could not read DOCX', message:'If this was an old .doc file, re-save it as .docx first.'});
      XG.emit('book:failed');
    }
  };
  reader.readAsArrayBuffer(file);
}
function splitOnHeadings(box){
  const nodes = Array.from(box.childNodes);
  const H = new Set(['H1','H2']);
  if(!nodes.some(n=>n.nodeType===1 && H.has(n.tagName))) return [{title:null, html:box.innerHTML}];
  const secs = []; let title = null, cur = [];
  const flush = ()=>{ if(cur.length) secs.push({title, html: cur.map(n=>n.outerHTML || XG.escapeHtml(n.textContent)).join('\n')}); cur = []; };
  nodes.forEach(n=>{ if(n.nodeType===1 && H.has(n.tagName)){ flush(); title = n.textContent.trim(); cur = [n]; } else cur.push(n); });
  flush();
  return secs.filter(s=>s.html && s.html.trim());
}

/* TXT */
function parseTxt(file){
  const reader = new FileReader();
  reader.onerror = ()=>{ XG.banner({level:'err', title:'Read error', message:'Could not read the file from storage.'}); XG.emit('book:failed'); };
  reader.onload = (ev)=>{
    try{
      const text = ev.target.result;
      if(!text || !text.trim()){ S.chapters = []; finishLoading(file.name.replace(/\.txt$/i,''), 'en'); return; }
      let paras = text.split(/\n{2,}/).map(p=>p.trim()).filter(Boolean);
      const MAX = 4000;
      paras = paras.flatMap(p=>{
        if(p.length <= MAX) return [p];
        const units = p.match(/[^.!?\u0964]+[.!?\u0964]+(\s|$)/g) || p.match(/\S+\s*/g) || [p];
        const out = []; let buf = '';
        units.forEach(u=>{ if(buf.length + u.length > MAX && buf){ out.push(buf.trim()); buf=''; } buf += u; });
        if(buf.trim()) out.push(buf.trim());
        return out.length ? out : [p];
      });
      const CHUNK = 3000, chunks = []; let buf = [], len = 0;
      paras.forEach(p=>{ buf.push(p); len += p.length; if(len >= CHUNK){ chunks.push(buf); buf = []; len = 0; } });
      if(buf.length) chunks.push(buf);
      S.chapters = chunks.map((ps,i)=>mkChapter(i, 'Part ' + (i+1), null, ps.map(p=>`<p>${XG.escapeHtml(p)}</p>`).join('\n')));
      finishLoading(file.name.replace(/\.txt$/i,''), 'en');
    }catch(err){
      XG.banner({level:'err', title:'Could not read TXT', message:'The file could not be processed as plain text.'});
      XG.emit('book:failed');
    }
  };
  reader.readAsText(file);
}

/* backup restore */
XG.restoreBackup = function(file){
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const data = JSON.parse(reader.result);
      if(!data || data.dtvBackup !== 1 || !Array.isArray(data.chapters)){ XG.toast('Not a valid backup file', 'err'); return; }
      XG.resetForNewFile(null);
      S.chapters = data.chapters.map((sc,i)=>{
        const c = mkChapter(i, sc.title || ('Chapter ' + (i+1)), null, null);
        c.status = sc.status || (sc.text ? 'done' : 'pending'); c.text = sc.text || ''; c.wc = XG.wordCount(c.text);
        c.originalText = sc.originalText || ''; c.excluded = !!sc.excluded;
        return c;
      });
      S.bookTitle = data.bookTitle || 'Restored book';
      S.bookLang = data.bookLang || 'en';
      S.exportOrder = (Array.isArray(data.exportOrder) && data.exportOrder.length === S.chapters.length) ? data.exportOrder.slice() : S.chapters.map((c,i)=>i);
      S.sessionKey = XG.computeSessionKey(S.bookTitle, 0, S.chapters.length);
      XG.emit('book:loaded', {title:S.bookTitle, count:S.chapters.length, lang:S.bookLang, restored:true});
      XG.toast(`Backup restored — ${S.chapters.length} chapters`, 'ok');
    }catch(e){ XG.toast('Could not read backup file', 'err'); }
  };
  reader.onerror = ()=>XG.toast('Could not read backup file', 'err');
  reader.readAsText(file);
};

XG.loadSettings();
