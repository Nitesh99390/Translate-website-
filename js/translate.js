/* ==========================================================================
   Deep Translate — Novelxplin  ·  translate.js
   API-based whole-book translation (no Chrome translate needed).
   - Parses EPUB / PDF / DOCX / TXT locally into paragraphs
   - Packs paragraphs into small chunks (mobile-data friendly), translates each
     chunk with Google (clients5) → Lingva → MyMemory fallbacks, verifies the
     target script, and saves progress to IndexedDB after every chunk
   - Auto-pauses offline, resumes online; retries with back-off on rate limits
   - Exports TXT / ZIP / EPUB / MD / HTML / JSON and hands off to Novelxplin
   ========================================================================== */
'use strict';

/* ============ 0. HELPERS ============ */
const el = (id) => document.getElementById(id);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const escapeXml = (s) => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const formatBytes = (b) => b < 1024 ? Math.round(b) + ' B' : b < 1048576 ? (b/1024).toFixed(1) + ' KB' : (b/1048576).toFixed(2) + ' MB';
const wordCount = (s) => { const t = (s||'').trim(); return t ? t.split(/\s+/).length : 0; };
const safeFileName = (s, fb) => { const c = String(s||'').replace(/[^a-zA-Z0-9\u0900-\u097F \-_]/g,'').trim().slice(0,80); return c || fb; };
const fmtDur = (ms) => { if(!isFinite(ms) || ms < 0) return '—'; const s = Math.round(ms/1000); if(s < 60) return s + 's'; const m = Math.floor(s/60); if(m < 60) return m + 'm ' + (s%60) + 's'; return Math.floor(m/60) + 'h ' + (m%60) + 'm'; };
const now = () => Date.now();
const byteLen = (s) => { try{ return new TextEncoder().encode(s).length; }catch(e){ return s.length * 2; } };

/* ============ 1. LANGUAGES ============ */
/* script: regex that matches the target script; null = Latin (verify via text divergence) */
const LANGS = {
  auto:{name:'Detect language', script:null, srcOnly:true},
  en:{name:'English', script:null},
  hi:{name:'Hindi · हिन्दी', script:/[\u0900-\u097F]/},
  mr:{name:'Marathi · मराठी', script:/[\u0900-\u097F]/},
  ne:{name:'Nepali · नेपाली', script:/[\u0900-\u097F]/},
  bn:{name:'Bengali · বাংলা', script:/[\u0980-\u09FF]/},
  ta:{name:'Tamil · தமிழ்', script:/[\u0B80-\u0BFF]/},
  te:{name:'Telugu · తెలుగు', script:/[\u0C00-\u0C7F]/},
  gu:{name:'Gujarati · ગુજરાતી', script:/[\u0A80-\u0AFF]/},
  kn:{name:'Kannada · ಕನ್ನಡ', script:/[\u0C80-\u0CFF]/},
  ml:{name:'Malayalam · മലയാളം', script:/[\u0D00-\u0D7F]/},
  pa:{name:'Punjabi · ਪੰਜਾਬੀ', script:/[\u0A00-\u0A7F]/},
  or:{name:'Odia · ଓଡ଼ିଆ', script:/[\u0B00-\u0B7F]/},
  ur:{name:'Urdu · اردو', script:/[\u0600-\u06FF]/},
  ar:{name:'Arabic · العربية', script:/[\u0600-\u06FF]/},
  fa:{name:'Persian · فارسی', script:/[\u0600-\u06FF]/},
  he:{name:'Hebrew · עברית', script:/[\u0590-\u05FF]/},
  'zh-CN':{name:'Chinese (Simplified) · 中文', script:/[\u4E00-\u9FFF\u3400-\u4DBF]/},
  'zh-TW':{name:'Chinese (Traditional) · 繁體', script:/[\u4E00-\u9FFF\u3400-\u4DBF]/},
  ja:{name:'Japanese · 日本語', script:/[\u3040-\u30FF\u4E00-\u9FFF]/},
  ko:{name:'Korean · 한국어', script:/[\uAC00-\uD7AF\u1100-\u11FF]/},
  ru:{name:'Russian · Русский', script:/[\u0400-\u04FF]/},
  uk:{name:'Ukrainian · Українська', script:/[\u0400-\u04FF]/},
  th:{name:'Thai · ไทย', script:/[\u0E00-\u0E7F]/},
  el:{name:'Greek · Ελληνικά', script:/[\u0370-\u03FF]/},
  es:{name:'Spanish · Español', script:null},
  fr:{name:'French · Français', script:null},
  de:{name:'German · Deutsch', script:null},
  pt:{name:'Portuguese · Português', script:null},
  it:{name:'Italian · Italiano', script:null},
  id:{name:'Indonesian · Bahasa', script:null},
  vi:{name:'Vietnamese · Tiếng Việt', script:null},
  tr:{name:'Turkish · Türkçe', script:null},
  nl:{name:'Dutch · Nederlands', script:null},
  pl:{name:'Polish · Polski', script:null},
  sw:{name:'Swahili · Kiswahili', script:null},
  tl:{name:'Filipino · Tagalog', script:null}
};
const langShort = (c) => (c === 'auto' ? 'AUTO' : c.toUpperCase());
const langLabel = (c) => (LANGS[c] ? LANGS[c].name.split(' · ')[0] : c);

/* ============ 2. STATE & SETTINGS ============ */
const S = {
  book: null,               // { key, title, ext, src, tgt, chapters:[{title, paras:[{o, t, h, err}]}], createdAt, stats }
  running:false, paused:false, stopReq:false,
  previewIdx:-1, viewMode:'trans', filter:'all',
  run:null                  // per-run counters
};
const SETTINGS_KEY = 'dt_settings_v1';
const settings = Object.assign({
  chunk:3500, parallel:2, gap:250, retries:3, email:'',
  wake:true, sound:true, vibe:true, noVerify:false,
  font:17, fontFam:'serif', engine:'auto', src:'en', tgt:'hi'
}, (()=>{ try{ return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }catch(e){ return {}; } })());
function saveSettings(){ try{ localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }catch(e){} }

/* ============ 3. TOASTS / THEME / SOUND / WAKE LOCK ============ */
const toastWrap = el('toastWrap');
function toast(msg, type='info', ms=2800){
  const icons = {ok:'\u2713', err:'\u2715', info:'i', warn:'!'};
  while(toastWrap.children.length >= 4) toastWrap.firstChild.remove();
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.innerHTML = `<span class="t-ic">${icons[type]||'i'}</span><span></span>`;
  t.lastElementChild.textContent = msg;
  toastWrap.appendChild(t);
  setTimeout(()=>{ t.classList.add('out'); setTimeout(()=>t.remove(), 320); }, ms);
}
const THEMES = ['dark','light','amoled','sepia'];
el('themeBtn').addEventListener('click', ()=>{
  const cur = document.documentElement.dataset.theme || 'dark';
  const next = THEMES[(THEMES.indexOf(cur) + 1) % THEMES.length];
  document.documentElement.dataset.theme = next;
  try{ localStorage.setItem('dtv_theme', next); }catch(e){}
  document.querySelector('meta[name=theme-color]').setAttribute('content', getComputedStyle(document.body).backgroundColor);
  toast('Theme: ' + next[0].toUpperCase() + next.slice(1), 'info', 1400);
});
function chime(){
  if(!settings.sound) return;
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [523.25, 659.25, 783.99].forEach((f, i)=>{
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine'; o.frequency.value = f; o.connect(g); g.connect(ctx.destination);
      const t0 = ctx.currentTime + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      o.start(t0); o.stop(t0 + 0.55);
    });
  }catch(e){}
}
function buzz(ms=20){ if(settings.vibe && navigator.vibrate){ try{ navigator.vibrate(ms); }catch(e){} } }
let wakeLock = null;
async function acquireWake(){ if(!settings.wake || !('wakeLock' in navigator)) return; try{ wakeLock = await navigator.wakeLock.request('screen'); }catch(e){} }
function releaseWake(){ try{ wakeLock && wakeLock.release(); }catch(e){} wakeLock = null; }
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState === 'visible' && S.running && !S.paused) acquireWake(); });

/* ============ 4. INDEXEDDB (novelxplin_dt) ============ */
const DB_NAME = 'novelxplin_dt', DB_VER = 1;
let dbHandle = null;
function openDB(){
  return new Promise((res, rej)=>{
    if(!('indexedDB' in window)) return rej(new Error('no idb'));
    const q = indexedDB.open(DB_NAME, DB_VER);
    q.onupgradeneeded = ()=>{
      const d = q.result;
      if(!d.objectStoreNames.contains('sessions')) d.createObjectStore('sessions', {keyPath:'key'});
      if(!d.objectStoreNames.contains('handoff')) d.createObjectStore('handoff');
    };
    q.onsuccess = ()=>res(q.result); q.onerror = ()=>rej(q.error);
  });
}
async function db(){ if(dbHandle) return dbHandle; dbHandle = await openDB(); return dbHandle; }
async function idb(store, mode, fn){
  try{
    const d = await db();
    return await new Promise((res, rej)=>{
      const tx = d.transaction(store, mode); const st = tx.objectStore(store);
      const r = fn(st); let out;
      if(r && 'onsuccess' in r){ r.onsuccess = ()=>{ out = r.result; }; }
      tx.oncomplete = ()=>res(out); tx.onerror = ()=>rej(tx.error); tx.onabort = ()=>rej(tx.error);
    });
  }catch(e){ return undefined; }
}
const sessGet = (key) => idb('sessions', 'readonly', st=>st.get(key));
const sessAll = () => idb('sessions', 'readonly', st=>st.getAll());
const sessPut = (v) => idb('sessions', 'readwrite', st=>st.put(v));
const sessDel = (key) => idb('sessions', 'readwrite', st=>st.delete(key));
const sessClear = () => idb('sessions', 'readwrite', st=>st.clear());
const handoffPut = (v) => idb('handoff', 'readwrite', st=>st.put(v, 'latest'));

let saveTimer = null, saveDirty = false;
function scheduleSave(immediate){
  saveDirty = true;
  if(immediate){ clearTimeout(saveTimer); return flushSave(); }
  if(saveTimer) return;
  saveTimer = setTimeout(flushSave, 1500);
}
async function flushSave(){
  saveTimer = null;
  if(!saveDirty || !S.book) return;
  saveDirty = false;
  const b = S.book;
  b.savedAt = now();
  b.progress = progressOf(b);
  await sessPut(b);
}
window.addEventListener('pagehide', ()=>{ if(saveDirty) flushSave(); });

/* ============ 5. BOOK MODEL ============ */
function mkPara(o, h){ return { o: o, t: null, h: h || 0, err: 0 }; }
function computeKey(title, src, tgt, chapters){
  const wc = chapters.reduce((n,c)=>n + c.paras.length, 0);
  return `dt:${String(title).toLowerCase().replace(/[^a-z0-9\u0900-\u097F]+/g,'-').slice(0,60)}:${chapters.length}:${wc}:${src}>${tgt}`;
}
function progressOf(b){
  let total = 0, done = 0;
  b.chapters.forEach(c=>c.paras.forEach(p=>{ total++; if(p.t != null) done++; }));
  return { total, done, pct: total ? Math.round(done/total*100) : 0 };
}
function chapterStatus(c){
  if(c.excluded) return 'skipped';
  const n = c.paras.length; if(!n) return 'done';
  let done = 0, failed = 0;
  for(const p of c.paras){ if(p.t != null) done++; else if(p.err >= settings.retries + 1) failed++; }
  if(done === n) return 'done';
  if(S.running && S.run && S.run.activeCh.has(c.index)) return 'active';
  if(failed && done + failed === n) return 'failed';
  if(done) return 'partial';
  return 'pending';
}
function chapterText(c, includePartial){
  return c.paras.map(p=>{
    if(p.t != null) return p.t;
    return includePartial ? p.o : null;
  }).filter(x=>x != null && x !== '').join('\n\n');
}

/* ============ 6. PARSING (EPUB / PDF / DOCX / TXT) ============ */
const MAX_PARA = 1800; // characters — long paragraphs are split on sentence boundaries
function splitLong(p){
  if(p.length <= MAX_PARA) return [p];
  const units = p.match(/[^.!?\u0964\u3002]+[.!?\u0964\u3002]+["'\u201D\u2019)]?(\s|$)/g) || p.match(/\S+\s*/g) || [p];
  const out = []; let buf = '';
  units.forEach(u=>{ if(buf.length + u.length > MAX_PARA && buf){ out.push(buf.trim()); buf = ''; } buf += u; });
  if(buf.trim()) out.push(buf.trim());
  return out.length ? out : [p];
}
/* HTML string → paragraphs [{o, h}] (h = heading level 0..3) */
function htmlToParas(html){
  // DOMParser never fetches images/scripts (unlike innerHTML on a live element)
  const box = new DOMParser().parseFromString('<!DOCTYPE html><body>' + (html || '') + '</body>', 'text/html').body;
  $$('script,style,svg,img,video,audio,iframe,nav[epub\\:type="toc"]', box).forEach(n=>n.remove());
  const out = [];
  const push = (text, h)=>{
    const t = text.replace(/\s+/g,' ').trim();
    if(!t) return;
    splitLong(t).forEach((s, i)=>out.push(mkPara(s, i === 0 ? h : 0)));
  };
  const BLOCK = /^(P|H[1-6]|LI|BLOCKQUOTE|PRE|TD|TH|DT|DD|FIGCAPTION|DIV|SECTION|ARTICLE|ASIDE|HEADER|FOOTER|TR|TABLE|UL|OL|BODY|MAIN|CENTER)$/;
  const walk = (node)=>{
    let inline = '';
    const flushInline = ()=>{ if(inline.trim()) push(inline, 0); inline = ''; };
    node.childNodes.forEach(ch=>{
      if(ch.nodeType === 3){ inline += ch.nodeValue; return; }
      if(ch.nodeType !== 1) return;
      const tag = ch.tagName;
      if(tag === 'BR'){ flushInline(); return; }
      if(/^H[1-6]$/.test(tag)){ flushInline(); push(ch.textContent, Math.min(3, parseInt(tag[1],10))); return; }
      if(BLOCK.test(tag)){
        flushInline();
        const hasBlockKids = Array.from(ch.children).some(k=>BLOCK.test(k.tagName) || k.tagName === 'BR');
        if(hasBlockKids) walk(ch); else push(ch.textContent, 0);
        return;
      }
      inline += ch.textContent; // inline element (span, em, a, …)
    });
    flushInline();
  };
  walk(box);
  box.innerHTML = '';
  return out;
}
/* Chapter-heading detector shared by TXT / PDF / EPUB-fallback.
   Matches: "Chapter 12", "CHAPTER TWELVE — The Sea", "Ch. 3", "Part II", "Book One", "Prologue",
   "Epilogue", "Interlude", "Act 2", "अध्याय 5", "भाग 2", "प्रस्तावना", "12. The Harbour", "XII",
   or a short ALL-CAPS line. Long sentences are never headings. */
const HEADING_WORD = /^(chapter|chap\.?|ch\.?|part|book|volume|vol\.?|prologue|epilogue|interlude|intermission|afterword|foreword|preface|introduction|act|section|canto|अध्याय|भाग|खंड|प्रस्तावना|उपसंहार|परिच्छेद|অধ্যায়|அத்தியாயம்|అధ్యాయం|પ્રકરણ|ಅಧ್ಯಾಯ|അധ്യായം|باب|فصل)(?=$|[\s\d.:\-—–(])/i;
const ROMAN_RE = /^(?:[IVXLC]{2,7}|I(?=[\s.:\-—–]))(?:[\s.:\-—–]+.{0,70})?$/;
const NUM_TITLE_RE = /^(?:\d{1,3})[.:)\-—–]\s+[A-Z\u0900-\u097F][^.!?]{0,70}$/;
function isChapterHeading(t){
  if(!t || t.length > 90) return false;
  if(/[.!?\u0964]\s*\S/.test(t.slice(0, -1)) && !/^(?:\d{1,3}|[IVXLC]{1,7}|(?:chapter|chap|ch|part|book|vol)\.?\s*\d{0,3})\./i.test(t)) return false; // sentence with inner punctuation
  if(HEADING_WORD.test(t)) return true;
  if(ROMAN_RE.test(t)) return true;
  if(NUM_TITLE_RE.test(t)) return true;
  const letters = t.replace(/[^A-Za-z]/g,'');
  if(letters.length >= 4 && letters.length <= 60 && letters === letters.toUpperCase() && /\s|^[A-Z]+$/.test(t) && !/^\W*[A-Z]{1,3}\W*$/.test(t)) return true; // ALL CAPS title line
  return false;
}
function textToParas(text){
  let raw = String(text || '').replace(/\r\n?/g,'\n').replace(/\u00A0/g,' ');
  // Files with single-newline paragraphs (no blank lines): treat each line as a paragraph.
  const blank = (raw.match(/\n[ \t]*\n/g) || []).length;
  const lines = (raw.match(/\n/g) || []).length;
  if(lines > 8 && blank < lines / 12){
    const avg = raw.length / (lines + 1);
    if(avg > 60) raw = raw.replace(/\n/g, '\n\n');
  }
  const out = [];
  raw.split(/\n{2,}/).forEach(p=>{
    const t = p.replace(/[ \t]*\n[ \t]*/g,' ').replace(/\s+/g,' ').trim();
    if(!t) return;
    if(/^[\s*_\-=~#·•]{3,}$/.test(t)) return; // scene-break rules (***, ---, ===)
    const isHeading = isChapterHeading(t);
    splitLong(t).forEach((s,i)=>out.push(mkPara(s, i === 0 && isHeading ? 2 : 0)));
  });
  return out;
}
/* group flat paragraphs into chapters.
   - If the file has real chapter headings (2+ of them, each followed by some body text), split exactly there.
   - Otherwise fall back to ~N-char parts; headings still start a new part when the current one is not tiny. */
function autoChapters(paras, label, target=9000){
  const heads = paras.map((p,i)=>p.h ? i : -1).filter(i=>i >= 0);
  const bodyBetween = (a, b)=>paras.slice(a + 1, b).reduce((n,p)=>n + p.o.length, 0);
  const realHeads = heads.filter((hi, k)=>bodyBetween(hi, k + 1 < heads.length ? heads[k+1] : paras.length) >= 200);
  const chapters = [];
  if(realHeads.length >= 2 && realHeads.length <= 600){
    const cuts = new Set(realHeads);
    let cur = [];
    paras.forEach((p,i)=>{ if(cuts.has(i) && cur.length){ chapters.push(cur); cur = []; } cur.push(p); });
    if(cur.length) chapters.push(cur);
    // front matter before the first heading (book title, "A novel", author) stays as its own chapter
    // only if it has substance; otherwise it is folded into chapter 1 (which keeps chapter 1's title)
    const titleOf = (ps)=>{ const h = ps.find(p=>p.h && cuts.has(paras.indexOf(p))) || (ps[0].h ? ps[0] : null); return h ? h.o.slice(0,80) : ''; };
    if(chapters.length > 1 && chapters[0].reduce((n,p)=>n + p.o.length, 0) < 200){ chapters[1] = chapters[0].concat(chapters[1]); chapters.shift(); }
    // very long chapters are split further so progress stays granular and a failure costs less
    const MAX_CH = 40000; const out = [];
    chapters.forEach((ps, ci)=>{
      const baseTitle = titleOf(ps) || `${label} ${ci+1}`;
      const len = ps.reduce((n,p)=>n + p.o.length, 0);
      if(len <= MAX_CH){ out.push({ title: baseTitle, paras: ps }); return; }
      const pieces = []; let cur = [], l = 0;
      ps.forEach(p=>{ cur.push(p); l += p.o.length; if(l >= MAX_CH * 0.6){ pieces.push(cur); cur = []; l = 0; } });
      if(cur.length) pieces.push(cur);
      pieces.forEach((pc, k)=>out.push({ title: `${baseTitle} (${k+1}/${pieces.length})`, paras: pc }));
    });
    return out.map((c,i)=>({ index:i, title: c.title, paras: c.paras, excluded:false }));
  }
  let cur = [], len = 0;
  paras.forEach(p=>{
    if(p.h && cur.length && len > 1200){ chapters.push(cur); cur = []; len = 0; }
    cur.push(p); len += p.o.length;
    if(len >= target && !p.h){ chapters.push(cur); cur = []; len = 0; }
  });
  if(cur.length) chapters.push(cur);
  return chapters.map((ps,i)=>({ index:i, title: (ps[0].h ? ps[0].o.slice(0,80) : `${label} ${i+1}`), paras: ps, excluded:false }));
}

const LIB = {
  pdf: ()=>typeof pdfjsLib !== 'undefined',
  mammoth: ()=>typeof mammoth !== 'undefined',
  jszip: ()=>typeof JSZip !== 'undefined'
};
async function waitLib(ok, ms=6000){ const t0 = now(); while(!ok() && now() - t0 < ms) await sleep(120); return ok(); }

async function parseFile(file){
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  const title = file.name.replace(/\.[^.]+$/,'');
  if(ext === 'epub') return parseEpub(file, title);
  if(ext === 'pdf') return parsePdf(file, title);
  if(ext === 'docx') return parseDocx(file, title);
  if(ext === 'txt' || ext === 'md' || ext === 'text') return { title, ext:'TXT', chapters: autoChapters(textToParas(await file.text()), 'Part') };
  throw new Error(`Unsupported file type .${ext} — use EPUB, PDF, DOCX or TXT.`);
}

/* EPUB via JSZip (reads OPF spine + NCX / nav TOC titles) */
async function parseEpub(file, fallbackTitle){
  if(!await waitLib(LIB.jszip)) throw new Error('ZIP library did not load — check your connection and reload.');
  const zip = await JSZip.loadAsync(file);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if(!containerXml) throw new Error('Not a valid EPUB (missing container.xml).');
  const opfPath = (containerXml.match(/full-path="([^"]+)"/) || [])[1];
  if(!opfPath || !zip.file(opfPath)) throw new Error('Not a valid EPUB (missing package file).');
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');
  const title = (opf.getElementsByTagNameNS('*','title')[0] || {}).textContent || fallbackTitle;
  const lang = ((opf.getElementsByTagNameNS('*','language')[0] || {}).textContent || 'en').slice(0,2).toLowerCase();
  const manifest = {};
  Array.from(opf.getElementsByTagNameNS('*','item')).forEach(it=>{ manifest[it.getAttribute('id')] = { href: it.getAttribute('href'), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' }; });
  const spine = Array.from(opf.getElementsByTagNameNS('*','itemref')).map(r=>manifest[r.getAttribute('idref')]).filter(m=>m && /html|xml/i.test(m.type));
  const resolve = (href)=>{ try{ return decodeURIComponent(new URL(href, 'epub://x/' + opfDir).pathname.slice(1)); }catch(e){ return opfDir + href; } };

  // TOC titles: EPUB3 nav or NCX
  const tocMap = {};
  const joinPath = (dir, href)=>{ try{ return decodeURIComponent(new URL(href, 'epub://x/' + dir).pathname.slice(1)); }catch(e){ return dir + href; } };
  const addToc = (fullPath, label)=>{ if(!fullPath) return; const k = fullPath.split('#')[0]; if(!tocMap[k] && label && label.trim()) tocMap[k] = label.replace(/\s+/g,' ').trim(); };
  try{
    const navItem = Object.values(manifest).find(m=>/\bnav\b/.test(m.props));
    if(navItem && zip.file(resolve(navItem.href))){
      const navPath = resolve(navItem.href), navDir = navPath.replace(/[^/]*$/,'');
      const nav = new DOMParser().parseFromString(await zip.file(navPath).async('string'), 'text/html');
      $$('nav a[href]', nav).forEach(a=>addToc(joinPath(navDir, a.getAttribute('href')), a.textContent));
    }
    const ncxItem = Object.values(manifest).find(m=>/ncx/i.test(m.type));
    if(ncxItem && zip.file(resolve(ncxItem.href))){
      const ncx = new DOMParser().parseFromString(await zip.file(resolve(ncxItem.href)).async('string'), 'application/xml');
      const ncxDir = resolve(ncxItem.href).replace(/[^/]*$/,'');
      Array.from(ncx.getElementsByTagNameNS('*','navPoint')).forEach(np=>{
        const label = (np.getElementsByTagNameNS('*','text')[0] || {}).textContent;
        const src = (np.getElementsByTagNameNS('*','content')[0] || {getAttribute:()=>null}).getAttribute('src');
        if(src) addToc(joinPath(ncxDir, src), label);
      });
    }
  }catch(e){}

  const chapters = [];
  for(const item of spine){
    const path = resolve(item.href);
    const f = zip.file(path); if(!f) continue;
    let html = '';
    try{ html = await f.async('string'); }catch(e){ continue; }
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body || doc.documentElement;
    const paras = htmlToParas(body ? body.innerHTML : '');
    if(!paras.length) continue;
    const txtLen = paras.reduce((n,p)=>n + p.o.length, 0);
    if(txtLen < 40) continue; // covers, blank pages
    const h1 = paras.find(p=>p.h);
    const docTitle = (doc.title || '').trim();
    const t = tocMap[path] || (h1 && h1.o.length < 90 ? h1.o : null) || (docTitle && !/^(c|ch|chapter|part|section|text|index|split)?[\s_-]*\d+$/i.test(docTitle) && docTitle.length > 3 ? docTitle : null) || `Chapter ${chapters.length + 1}`;
    chapters.push({ index: chapters.length, title: t.slice(0,100), paras, excluded:false });
  }
  if(!chapters.length) throw new Error('No readable text found in this EPUB.');
  // Single-file EPUBs (e.g. converted from TXT) put the whole book in 1–2 spine items:
  // split them on in-text chapter headings / size so progress and exports stay per-chapter.
  const total = chapters.reduce((n,c)=>n + c.paras.reduce((m,p)=>m + p.o.length, 0), 0);
  if(chapters.length <= 2 && total > 30000){
    const flat = chapters.flatMap(c=>c.paras);
    flat.forEach(p=>{ if(!p.h && isChapterHeading(p.o)) p.h = 2; });
    const split = autoChapters(flat, 'Part');
    if(split.length > chapters.length) return { title, ext:'EPUB', lang, chapters: split };
  }
  return { title, ext:'EPUB', lang, chapters };
}

/* PDF via pdf.js — pages grouped into ~9k-char chapters */
async function parsePdf(file, title){
  if(!await waitLib(LIB.pdf)) throw new Error('PDF library did not load — check your connection and reload.');
  const v = pdfjsLib.version || '3.11.174';
  pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${v}/pdf.worker.min.js`;
  let pdf;
  try{ pdf = await pdfjsLib.getDocument({data: await file.arrayBuffer()}).promise; }
  catch(e){ if(e && e.name === 'PasswordException') throw new Error('This PDF is password-protected — remove the password first.'); throw new Error('The file could not be parsed as a PDF.'); }
  const paras = []; let empty = 0;
  try{
    for(let p=1;p<=pdf.numPages;p++){
      try{
        const page = await pdf.getPage(p);
        const content = await page.getTextContent();
        const lines = groupLines(content.items);
        const ps = guessParagraphs(lines);
        if(ps.join('').trim().length < 3) empty++;
        ps.forEach(t=>splitLong(t).forEach((s,i)=>paras.push(mkPara(s, (i === 0 && isChapterHeading(s)) ? 2 : 0))));
        if(page.cleanup) try{ page.cleanup(); }catch(e){}
      }catch(e){}
      if(p % 10 === 0) setDropStatus(`Reading page ${p} / ${pdf.numPages}…`);
    }
  } finally { try{ pdf.destroy(); }catch(e){} }
  if(pdf.numPages && empty / pdf.numPages > 0.6) toast('Most pages had no text — scanned PDF? (no OCR)', 'warn', 4500);
  if(!paras.length) throw new Error('No readable text found in this PDF (scanned / image-only PDFs need OCR).');
  return { title, ext:'PDF', chapters: autoChapters(paras, 'Part') };
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
    if(/^\d{1,4}$/.test(t)) return; // page numbers
    const ends = /[.!?"'\u201D\u2019)\u0964]$/.test(buf.trim());
    const newPara = buf && ends && /^[A-Z"'\u201C\u2018(]/.test(t) && buf.trim().length < 90;
    const heading = t.length < 60 && /^(chapter|part|book|prologue|epilogue)\b/i.test(t);
    if(heading){ if(buf.trim()) out.push(buf.trim()); out.push(t); buf = ''; return; }
    if(newPara){ out.push(buf.trim()); buf = t; } else buf = buf ? buf + (buf.endsWith('-') ? '' : ' ') + t : t;
  });
  if(buf.trim()) out.push(buf.trim());
  return out;
}

/* DOCX via mammoth — split on H1/H2 */
async function parseDocx(file, title){
  if(!await waitLib(LIB.mammoth)) throw new Error('DOCX library did not load — check your connection and reload.');
  let result;
  try{ result = await mammoth.convertToHtml({arrayBuffer: await file.arrayBuffer()}); }
  catch(e){ throw new Error('Could not read this DOCX (old .doc files must be re-saved as .docx).'); }
  const paras = htmlToParas(result.value);
  if(!paras.length) throw new Error('No readable text found in this document.');
  const hasHeadings = paras.some(p=>p.h && p.h <= 2);
  let chapters;
  if(hasHeadings){
    chapters = []; let cur = null;
    paras.forEach(p=>{
      if(p.h && p.h <= 2){ if(cur && cur.paras.length) chapters.push(cur); cur = { index: chapters.length, title: p.o.slice(0,100), paras:[p], excluded:false }; }
      else { if(!cur) cur = { index:0, title:'Section 1', paras:[], excluded:false }; cur.paras.push(p); }
    });
    if(cur && cur.paras.length) chapters.push(cur);
    chapters.forEach((c,i)=>c.index = i);
  } else chapters = autoChapters(paras, 'Section');
  return { title, ext:'DOCX', chapters };
}

/* ============ 7. TRANSLATION ENGINES ============ */
const GOOGLE_CODES = { 'zh-CN':'zh-CN', 'zh-TW':'zh-TW', tl:'tl' };
const gcode = (c) => GOOGLE_CODES[c] || c;
let dataUsed = 0;
function countData(reqBytes, resBytes){ dataUsed += reqBytes + resBytes; if(S.book){ S.book.stats = S.book.stats || {}; S.book.stats.bytes = (S.book.stats.bytes || 0) + reqBytes + resBytes; } }

class EngineError extends Error { constructor(msg, {rate=false, fatal=false, status=0}={}){ super(msg); this.rate = rate; this.fatal = fatal; this.status = status; } }

async function fetchT(url, opts, timeoutMs){
  const ctrl = new AbortController();
  const t = setTimeout(()=>ctrl.abort(), timeoutMs || 25000);
  try{ return await fetch(url, Object.assign({}, opts, {signal: ctrl.signal})); }
  finally{ clearTimeout(t); }
}

/* Google (clients5 "dict-chrome-ex" endpoint) — batch of paragraphs in one POST. Response: ["t1","t2",…] or [["t1","en"],…] when sl=auto */
async function engineGoogle(texts, src, tgt){
  const body = texts.map(t=>'q=' + encodeURIComponent(t)).join('&');
  const url = `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=${encodeURIComponent(gcode(src))}&tl=${encodeURIComponent(gcode(tgt))}`;
  const res = await fetchT(url, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'}, body });
  if(res.status === 429 || res.status === 403) throw new EngineError('Google rate-limited', {rate:true, status:res.status});
  if(!res.ok) throw new EngineError('Google HTTP ' + res.status, {status:res.status});
  const raw = await res.text();
  countData(byteLen(body) + 300, byteLen(raw) + 300);
  let data; try{ data = JSON.parse(raw); }catch(e){ throw new EngineError('Google: bad response'); }
  if(!Array.isArray(data)) throw new EngineError('Google: unexpected response');
  if(texts.length === 1 && typeof data[0] === 'string' && data.length !== 1) data = [data[0]];
  const out = data.map(x=>Array.isArray(x) ? x[0] : x);
  if(out.length !== texts.length) throw new EngineError('Google: count mismatch');
  return out.map(x=>String(x == null ? '' : x));
}

/* Lingva (community Google front-end) — one paragraph per GET; several instances */
const LINGVA_HOSTS = ['https://lingva.ml', 'https://lingva.thedaviddelta.com', 'https://translate.plausibility.cloud'];
let lingvaIdx = 0;
async function engineLingva(texts, src, tgt){
  const out = [];
  for(const t of texts){
    let lastErr;
    for(let k=0;k<LINGVA_HOSTS.length;k++){
      const host = LINGVA_HOSTS[(lingvaIdx + k) % LINGVA_HOSTS.length];
      try{
        const url = `${host}/api/v1/${encodeURIComponent(src === 'auto' ? 'auto' : src)}/${encodeURIComponent(tgt.split('-')[0])}/${encodeURIComponent(t)}`;
        const res = await fetchT(url, {}, 30000);
        if(res.status === 429) throw new EngineError('Lingva rate-limited', {rate:true, status:429});
        if(!res.ok) throw new EngineError('Lingva HTTP ' + res.status, {status:res.status});
        const raw = await res.text(); countData(byteLen(url) + 300, byteLen(raw) + 300);
        const j = JSON.parse(raw);
        if(typeof j.translation !== 'string') throw new EngineError('Lingva: bad response');
        out.push(j.translation); lingvaIdx = (lingvaIdx + k) % LINGVA_HOSTS.length; lastErr = null; break;
      }catch(e){ lastErr = e; if(e.rate) continue; }
    }
    if(lastErr) throw lastErr;
  }
  return out;
}

/* MyMemory — free 5k chars/day anonymous, 50k with e-mail; 500 chars per request */
async function engineMyMemory(texts, src, tgt){
  const out = [];
  const from = src === 'auto' ? 'en' : src.split('-')[0];
  for(const t of texts){
    const parts = t.length > 480 ? splitTo(t, 480) : [t];
    const trans = [];
    for(const part of parts){
      const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(part)}&langpair=${from}|${tgt.split('-')[0]}${settings.email ? '&de=' + encodeURIComponent(settings.email) : ''}`;
      const res = await fetchT(url, {}, 30000);
      if(res.status === 429) throw new EngineError('MyMemory rate-limited', {rate:true, status:429});
      if(!res.ok) throw new EngineError('MyMemory HTTP ' + res.status, {status:res.status});
      const raw = await res.text(); countData(byteLen(url) + 300, byteLen(raw) + 300);
      const j = JSON.parse(raw);
      if(j.responseStatus === 429 || j.quotaFinished || /QUOTA|LIMIT/i.test(j.responseDetails || '')) throw new EngineError('MyMemory daily quota reached', {rate:true, fatal:true});
      if(!j.responseData || typeof j.responseData.translatedText !== 'string') throw new EngineError('MyMemory: bad response');
      trans.push(j.responseData.translatedText);
    }
    out.push(trans.join(' '));
  }
  return out;
}
function splitTo(text, max){
  const units = text.match(/[^.!?\u0964]+[.!?\u0964]+["'\u201D)]?(\s|$)/g) || [text];
  const out = []; let buf = '';
  units.forEach(u=>{ if(buf.length + u.length > max && buf){ out.push(buf.trim()); buf = ''; } buf += u; });
  if(buf.trim()) out.push(buf.trim());
  return out.flatMap(s=>s.length > max ? (s.match(new RegExp(`.{1,${max}}(\\s|$)`, 'g')) || [s]) : [s]);
}

const ENGINES = { google: engineGoogle, lingva: engineLingva, mymemory: engineMyMemory };
const ENGINE_ORDER = ['google', 'lingva', 'mymemory'];
const engineCooldown = { google:0, lingva:0, mymemory:0 };
function pickEngines(){
  const pref = settings.engine;
  if(pref !== 'auto' && ENGINES[pref]) return [pref].concat(ENGINE_ORDER.filter(e=>e !== pref));
  return ENGINE_ORDER.slice();
}

/* ============ 8. VERIFICATION ============ */
function verifyPara(orig, trans, tgt){
  if(settings.noVerify) return trans != null && String(trans).trim().length > 0;
  const t = String(trans || '').trim();
  if(!t) return false;
  const lang = LANGS[tgt];
  if(lang && lang.script){
    const letters = (t.match(/\p{L}/gu) || []).length;
    if(!letters) return /\d/.test(orig) && !/\p{L}/u.test(orig); // numbers-only paragraph
    const hit = (t.match(new RegExp(lang.script.source, 'gu')) || []).length;
    // Allow untranslatable names/numbers: at least 35% of letters in target script (Hindi novels typically 90%+)
    return hit / letters >= 0.35 || (letters < 12 && hit > 0);
  }
  // Latin target: must differ from source unless it's very short / numeric
  if(orig.trim().length < 6) return true;
  const a = orig.replace(/\W+/g,'').toLowerCase(), b = t.replace(/\W+/g,'').toLowerCase();
  return a !== b || tgt === (S.book && S.book.src);
}

/* ============ 9. RUN LOOP (chunked, parallel, resumable) ============ */
/* Build chunks: arrays of {ci, pi} refs whose combined source length ≈ settings.chunk */
function buildChunks(range){
  const chunks = []; let cur = [], len = 0;
  const [from, to] = range;
  S.book.chapters.forEach((c, ci)=>{
    if(ci < from || ci > to || c.excluded) return;
    c.paras.forEach((p, pi)=>{
      if(p.t != null || p.err > settings.retries) return;
      if(len && len + p.o.length > settings.chunk){ chunks.push(cur); cur = []; len = 0; }
      cur.push({ci, pi}); len += p.o.length;
    });
    // chapter boundary: keep chunks within one chapter when it's already reasonably full
    if(cur.length && len > settings.chunk * 0.6){ chunks.push(cur); cur = []; len = 0; }
  });
  if(cur.length) chunks.push(cur);
  return chunks;
}
function currentRange(){
  const n = S.book.chapters.length;
  const a = Math.max(1, Math.min(n, parseInt(el('rangeFrom').value, 10) || 1));
  const b = Math.max(a, Math.min(n, parseInt(el('rangeTo').value, 10) || n));
  return [a - 1, b - 1];
}

async function translateChunk(refs, run){
  const texts = refs.map(r=>S.book.chapters[r.ci].paras[r.pi].o);
  const engines = pickEngines();
  let lastErr = null;
  for(const name of engines){
    if(engineCooldown[name] > now()) continue;
    try{
      const out = await ENGINES[name](texts, S.book.src, S.book.tgt);
      run.engineUsed[name] = (run.engineUsed[name] || 0) + 1;
      return { out, engine:name };
    }catch(e){
      lastErr = e;
      if(e.name === 'AbortError'){ lastErr = new EngineError(name + ' timed out'); }
      if(e.rate){ engineCooldown[name] = now() + (e.fatal ? 6*3600e3 : 45e3); run.rateHits++; }
      else if(e instanceof TypeError){ // network failure / CORS
        if(!navigator.onLine) throw new EngineError('offline', {rate:false});
        engineCooldown[name] = now() + 15e3;
      }
    }
  }
  throw lastErr || new EngineError('All engines unavailable');
}

async function startRun(opts={}){
  if(!S.book || S.running) return;
  if(!navigator.onLine){ toast('You are offline — connect and try again', 'warn'); return; }
  const range = currentRange();
  if(opts.retryFailed){ S.book.chapters.forEach(c=>c.paras.forEach(p=>{ if(p.t == null) p.err = 0; })); }
  const chunks = buildChunks(range);
  if(!chunks.length){ toast('Nothing left to translate in this range', 'info'); return; }
  S.running = true; S.paused = false; S.stopReq = false;
  S.run = { total: chunks.length, done: 0, startedAt: now(), bytes0: (S.book.stats && S.book.stats.bytes) || 0, activeCh: new Set(), engineUsed:{}, rateHits:0, failed:0, lastTimes:[], parasDone:0 };
  S.book.stats = S.book.stats || {bytes:0, ms:0, runs:0}; S.book.stats.runs++;
  setControls(); setRunStatus('running', 'Translating…', `${chunks.length} chunks · ${langLabel(S.book.src)} → ${langLabel(S.book.tgt)}`);
  acquireWake(); renderChapters(); updateProgress();
  showBanner(null);

  const queue = chunks.slice();
  let idx = 0;
  const worker = async ()=>{
    while(idx < queue.length && !S.stopReq){
      while(S.paused && !S.stopReq) await sleep(250);
      if(S.stopReq) break;
      const refs = queue[idx++];
      const chapIdx = new Set(refs.map(r=>r.ci));
      chapIdx.forEach(ci=>S.run.activeCh.add(ci));
      renderChapterRow([...chapIdx]);
      const t0 = now();
      let result = null, err = null;
      try{ result = await translateChunk(refs, S.run); }catch(e){ err = e; }
      if(err && err.message === 'offline'){
        idx--; // put back
        S.paused = true; setRunStatus('paused', 'Paused — offline', 'Will resume automatically when you are back online.'); setControls();
        chapIdx.forEach(ci=>S.run.activeCh.delete(ci)); renderChapterRow([...chapIdx]);
        continue;
      }
      if(result){
        let ok = 0;
        refs.forEach((r, i)=>{
          const p = S.book.chapters[r.ci].paras[r.pi];
          const t = result.out[i];
          if(verifyPara(p.o, t, S.book.tgt)){ p.t = t.trim(); p.err = 0; ok++; }
          else p.err++;
        });
        S.run.parasDone += ok;
        if(ok < refs.length){
          // unverified paragraphs go back as their own smaller chunk (once) so other engines can try
          const bad = refs.filter(r=>S.book.chapters[r.ci].paras[r.pi].t == null && S.book.chapters[r.ci].paras[r.pi].err <= settings.retries);
          if(bad.length){ queue.push(bad); S.run.total++; }
        }
      } else {
        refs.forEach(r=>{ S.book.chapters[r.ci].paras[r.pi].err++; });
        const again = refs.filter(r=>S.book.chapters[r.ci].paras[r.pi].err <= settings.retries);
        if(again.length){
          // split in half and requeue with back-off
          if(again.length > 1){ const h = Math.ceil(again.length/2); queue.push(again.slice(0,h), again.slice(h)); S.run.total += 2; }
          else { queue.push(again); S.run.total++; }
          const wait = S.run.rateHits ? Math.min(20000, 2000 * S.run.rateHits) : 1200;
          setRunStatus('running', 'Retrying…', `${err.message}. Waiting ${Math.round(wait/1000)}s`);
          await sleep(wait);
        } else {
          S.run.failed += refs.length;
        }
      }
      S.run.done++;
      S.run.lastTimes.push(now() - t0); if(S.run.lastTimes.length > 12) S.run.lastTimes.shift();
      chapIdx.forEach(ci=>{ S.run.activeCh.delete(ci); const c = S.book.chapters[ci]; if(chapterStatus(c) === 'done'){ buzz(15); } });
      renderChapterRow([...chapIdx]); updateProgress(); scheduleSave();
      if(S.previewIdx >= 0 && chapIdx.has(S.previewIdx)) renderPreview(true);
      if(!S.stopReq) setRunStatus('running', 'Translating…', `${S.run.done} / ${S.run.total} chunks · ${result ? result.engine : 'retry'}`);
      if(settings.gap) await sleep(settings.gap);
    }
  };
  await Promise.all(Array.from({length: Math.max(1, Math.min(4, settings.parallel))}, worker));

  S.running = false; S.paused = false;
  S.run.activeCh.clear();
  S.book.stats.ms = (S.book.stats.ms || 0) + (now() - S.run.startedAt);
  releaseWake(); await scheduleSave(true);
  const prog = progressOf(S.book);
  const failedParas = S.book.chapters.reduce((n,c)=>n + c.paras.filter(p=>p.t == null && p.err > settings.retries).length, 0);
  if(S.stopReq) setRunStatus('paused', 'Stopped', `${prog.done} / ${prog.total} paragraphs translated so far.`);
  else if(failedParas){ setRunStatus('err', 'Finished with gaps', `${failedParas} paragraph${failedParas>1?'s':''} could not be verified. Tap "Retry failed" or change the engine.`); toast(`${failedParas} paragraphs failed — retry later`, 'warn', 4000); }
  else { setRunStatus('done', 'All done ✓', `${prog.done} paragraphs · ${formatBytes(dataUsed)} used this session · ${fmtDur(now() - S.run.startedAt)}`); chime(); buzz([30,50,30]); toast('Translation complete — export below', 'ok', 4000); if(window.innerWidth <= 860) setTab('export'); }
  setControls(); renderChapters(); updateProgress(); refreshExport(); renderRecent();
}
function pauseRun(){ if(!S.running) return; S.paused = !S.paused; setRunStatus(S.paused ? 'paused' : 'running', S.paused ? 'Paused' : 'Translating…', S.paused ? 'Tap Resume to continue.' : ''); setControls(); if(S.paused) releaseWake(); else acquireWake(); }
function stopRun(){ if(!S.running) return; S.stopReq = true; S.paused = false; setRunStatus('paused', 'Stopping…', 'Finishing the current chunk.'); }

window.addEventListener('online', ()=>{ el('netPill').classList.remove('off'); el('netPill').lastElementChild.textContent = 'Online'; if(S.running && S.paused){ S.paused = false; setRunStatus('running', 'Back online — resuming', ''); setControls(); acquireWake(); toast('Back online — resuming', 'ok'); } });
window.addEventListener('offline', ()=>{ el('netPill').classList.add('off'); el('netPill').lastElementChild.textContent = 'Offline'; if(S.running && !S.paused){ S.paused = true; setRunStatus('paused', 'Paused — offline', 'Will resume automatically when you are back online.'); setControls(); } });
if(!navigator.onLine){ el('netPill').classList.add('off'); el('netPill').lastElementChild.textContent = 'Offline'; }

/* ============ 10. UI — status / progress / controls ============ */
function setRunStatus(kind, title, sub){
  const r = el('runStatus'); r.className = 'run-status ' + (kind || '');
  r.firstElementChild.textContent = title; if(sub != null) r.lastElementChild.textContent = sub;
}
function setControls(){
  const has = !!S.book;
  el('startBtn').hidden = S.running; el('pauseBtn').hidden = !S.running; el('stopBtn').hidden = !S.running;
  el('pauseBtn').lastElementChild.textContent = S.paused ? 'Resume' : 'Pause';
  el('pauseBtn').firstElementChild.innerHTML = S.paused ? '<path d="M8 5v14l11-7z"/>' : '<path d="M6 5h4v14H6zM14 5h4v14h-4z"/>';
  const prog = has ? progressOf(S.book) : {done:0,total:0};
  el('startBtn').lastElementChild.textContent = prog.done && prog.done < prog.total ? 'Continue' : 'Start';
  el('startBtn').disabled = !has || (prog.total > 0 && prog.done === prog.total);
  const failed = has && S.book.chapters.some(c=>c.paras.some(p=>p.t == null && p.err > settings.retries));
  el('retryBtn').hidden = S.running || !failed;
  el('engineSel').disabled = S.running;
}
function updateProgress(){
  if(!S.book) return;
  const prog = progressOf(S.book);
  el('progPct').textContent = prog.pct + '%';
  el('ringFg').style.strokeDashoffset = (175.9 * (1 - prog.pct/100)).toFixed(1);
  el('progBar').style.width = prog.pct + '%';
  const bytes = (S.book.stats && S.book.stats.bytes) || 0;
  el('statData').textContent = formatBytes(bytes);
  if(S.run){
    el('statChunks').textContent = `${S.run.done} / ${S.run.total}`;
    const elapsed = now() - S.run.startedAt;
    el('statSpeed').textContent = S.run.done ? `${(S.run.parasDone / Math.max(1, elapsed/60000)).toFixed(0)} ¶/min` : '—';
    const avg = S.run.lastTimes.length ? S.run.lastTimes.reduce((a,b)=>a+b,0) / S.run.lastTimes.length : 0;
    const left = S.run.total - S.run.done;
    el('statEta').textContent = S.running && left && avg ? fmtDur(left * (avg + settings.gap) / Math.max(1, settings.parallel)) : (S.running ? '…' : '—');
  } else {
    el('statChunks').textContent = `${prog.done} / ${prog.total} ¶`;
    el('statSpeed').textContent = '—'; el('statEta').textContent = '—';
  }
  el('exportCount').textContent = `${S.book.chapters.filter(c=>chapterStatus(c) === 'done').length} / ${S.book.chapters.length} chapters`;
  document.title = (S.running ? `${prog.pct}% · ` : '') + 'Deep Translate — Novelxplin';
}
function showBanner(opts){
  const b = el('banner');
  if(!opts){ b.hidden = true; return; }
  b.hidden = false; b.className = 'banner ' + (opts.level || '');
  el('bannerTitle').textContent = opts.title || ''; el('bannerMsg').textContent = opts.message || '';
  const acts = el('bannerActions'); acts.innerHTML = '';
  (opts.actions || []).forEach(a=>{ const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn sm' + (a.primary ? ' btn-primary' : ''); btn.textContent = a.label; btn.onclick = a.onClick; acts.appendChild(btn); });
}

/* ============ 11. UI — chapters / preview / editor ============ */
const chapList = el('chapList');
function renderChapters(){
  if(!S.book) return;
  chapList.innerHTML = '';
  el('chapCount').textContent = S.book.chapters.length;
  const frag = document.createDocumentFragment();
  S.book.chapters.forEach((c, i)=>{
    const st = chapterStatus(c);
    if(S.filter !== 'all' && !((S.filter === 'done' && st === 'done') || (S.filter === 'pending' && (st === 'pending' || st === 'partial' || st === 'active')) || (S.filter === 'failed' && st === 'failed'))) return;
    const li = document.createElement('li'); li.className = 'chap' + (i === S.previewIdx ? ' sel' : '') + (c.excluded ? ' excl' : ''); li.dataset.i = i; li.dataset.st = st;
    const done = c.paras.filter(p=>p.t != null).length;
    li.innerHTML = `<span class="s"></span><span class="n">${i+1}</span><span class="t"></span><span class="m">${done}/${c.paras.length}</span>`;
    li.children[2].textContent = c.title;
    li.title = c.title + (c.excluded ? ' (excluded from export)' : '');
    frag.appendChild(li);
  });
  chapList.appendChild(frag);
}
function renderChapterRow(indices){
  indices.forEach(i=>{
    const li = chapList.querySelector(`.chap[data-i="${i}"]`); if(!li) return;
    const c = S.book.chapters[i]; li.dataset.st = chapterStatus(c);
    li.querySelector('.m').textContent = `${c.paras.filter(p=>p.t != null).length}/${c.paras.length}`;
  });
}
chapList.addEventListener('click', (e)=>{
  const li = e.target.closest('.chap'); if(!li) return;
  previewChapter(parseInt(li.dataset.i, 10)); if(window.innerWidth <= 860) setTab('preview');
});
let pressTimer = null;
chapList.addEventListener('contextmenu', (e)=>{ const li = e.target.closest('.chap'); if(!li) return; e.preventDefault(); toggleExclude(parseInt(li.dataset.i,10)); });
chapList.addEventListener('touchstart', (e)=>{ const li = e.target.closest('.chap'); if(!li) return; pressTimer = setTimeout(()=>{ toggleExclude(parseInt(li.dataset.i,10)); buzz(20); pressTimer = null; }, 550); }, {passive:true});
chapList.addEventListener('touchend', ()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer = null; } });
chapList.addEventListener('touchmove', ()=>{ if(pressTimer){ clearTimeout(pressTimer); pressTimer = null; } }, {passive:true});
function toggleExclude(i){
  const c = S.book.chapters[i]; c.excluded = !c.excluded; renderChapters(); refreshExport(); scheduleSave();
  toast(c.excluded ? `"${c.title}" excluded from translation & export` : `"${c.title}" included again`, 'info');
}
$$('.chip', el('chaptersPanel')).forEach(ch=>ch.addEventListener('click', ()=>{ $$('.chip', el('chaptersPanel')).forEach(x=>x.classList.toggle('active', x === ch)); S.filter = ch.dataset.f; renderChapters(); }));
el('rangeAll').addEventListener('click', ()=>{ el('rangeFrom').value = 1; el('rangeTo').value = S.book ? S.book.chapters.length : 1; });

const reader = el('reader');
function previewChapter(i){
  if(!S.book || i < 0 || i >= S.book.chapters.length) return;
  S.previewIdx = i;
  $$('.chap', chapList).forEach(li=>li.classList.toggle('sel', parseInt(li.dataset.i,10) === i));
  renderPreview(false);
  el('prevChapBtn').disabled = i === 0; el('nextChapBtn').disabled = i === S.book.chapters.length - 1;
}
function renderPreview(live){
  const c = S.book && S.book.chapters[S.previewIdx]; if(!c) return;
  el('prevTitle').textContent = `${S.previewIdx + 1}. ${c.title}`;
  reader.lang = S.viewMode === 'orig' ? (S.book.src === 'auto' ? '' : S.book.src) : S.book.tgt;
  reader.dir = /^(ur|ar|fa|he)$/.test(reader.lang) ? 'rtl' : 'ltr';
  const keep = live ? reader.scrollTop : 0;
  const html = c.paras.map(p=>{
    const tag = p.h ? 'h' + (p.h + 1) : 'p';
    if(S.viewMode === 'orig') return `<${tag}>${escapeHtml(p.o)}</${tag}>`;
    if(S.viewMode === 'both') return `<div class="pair"><${tag} class="o">${escapeHtml(p.o)}</${tag}><${tag}${p.t == null ? ' class="pending"' : ''}>${escapeHtml(p.t == null ? '…' : p.t)}</${tag}></div>`;
    return `<${tag} class="${p.t == null ? 'pending' : (live && p.fresh ? 'live' : '')}">${escapeHtml(p.t == null ? p.o : p.t)}</${tag}>`;
  }).join('');
  reader.innerHTML = html || '<p class="ph">Empty chapter.</p>';
  if(live) reader.scrollTop = keep;
}
['viewTrans','viewOrig','viewBoth'].forEach((id, k)=>el(id).addEventListener('click', ()=>{ S.viewMode = ['trans','orig','both'][k]; $$('.seg-btn', el('previewPanel')).forEach(b=>b.classList.toggle('active', b.id === id)); renderPreview(false); }));
el('prevChapBtn').addEventListener('click', ()=>previewChapter(S.previewIdx - 1));
el('nextChapBtn').addEventListener('click', ()=>previewChapter(S.previewIdx + 1));
// swipe between chapters on the reader
let swX = null, swY = null;
reader.addEventListener('touchstart', e=>{ swX = e.touches[0].clientX; swY = e.touches[0].clientY; }, {passive:true});
reader.addEventListener('touchend', e=>{ if(swX == null) return; const dx = e.changedTouches[0].clientX - swX, dy = e.changedTouches[0].clientY - swY; swX = null; if(Math.abs(dx) > 70 && Math.abs(dy) < 50) previewChapter(S.previewIdx + (dx < 0 ? 1 : -1)); }, {passive:true});

/* editor */
el('editChapBtn').addEventListener('click', ()=>{
  const c = S.book && S.book.chapters[S.previewIdx]; if(!c) return;
  if(S.running){ toast('Pause the run before editing', 'warn'); return; }
  el('editTitle').textContent = `Edit — ${c.title}`;
  el('editArea').value = c.paras.map(p=>p.t == null ? p.o : p.t).join('\n\n');
  el('editHint').textContent = `${c.paras.length} paragraphs — keep one paragraph per blank line so they stay aligned.`;
  el('editModal').hidden = false; el('editArea').focus();
});
const closeEdit = ()=>{ el('editModal').hidden = true; };
el('editClose').addEventListener('click', closeEdit); el('editCancel').addEventListener('click', closeEdit);
el('editSave').addEventListener('click', ()=>{
  const c = S.book.chapters[S.previewIdx];
  const parts = el('editArea').value.replace(/\r/g,'').split(/\n{2,}/).map(s=>s.trim());
  if(parts.length === c.paras.length){ parts.forEach((t,i)=>{ c.paras[i].t = t; c.paras[i].err = 0; }); }
  else {
    // paragraph count changed — replace the chapter's paragraphs wholesale (originals kept where possible)
    c.paras = parts.filter(Boolean).map((t,i)=>({ o: c.paras[i] ? c.paras[i].o : t, t, h: c.paras[i] ? c.paras[i].h : 0, err:0 }));
    toast('Paragraph count changed — originals re-aligned as best as possible', 'warn', 3800);
  }
  closeEdit(); renderPreview(false); renderChapters(); updateProgress(); refreshExport(); scheduleSave(true); toast('Chapter saved', 'ok');
});
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape'){ closeEdit(); closeSettings(); }
  if(e.target.matches('input,textarea,select')) return;
  if(!S.book) return;
  if(e.key === 'ArrowLeft' || e.key === 'j') previewChapter(S.previewIdx - 1);
  if(e.key === 'ArrowRight' || e.key === 'k') previewChapter(S.previewIdx + 1);
  if(e.key === ' ' && S.running){ e.preventDefault(); pauseRun(); }
});

/* mobile tabs */
function setTab(t){ el('work').dataset.tab = t; $$('.mtab').forEach(b=>b.classList.toggle('active', b.dataset.tab === t)); }
$$('.mtab').forEach(b=>b.addEventListener('click', ()=>setTab(b.dataset.tab)));

/* ============ 12. EXPORTS ============ */
function exportable(){
  const inc = el('exIncludeUnverified').checked;
  return S.book.chapters.filter(c=>!c.excluded && (inc ? c.paras.some(p=>p.t != null || p.o) : chapterStatus(c) === 'done'));
}
function refreshExport(){
  if(!S.book) return;
  const n = exportable().length;
  $$('.ex').forEach(b=>{ if(b.dataset.ex !== 'json') b.disabled = n === 0; });
  el('shareBtn').hidden = !(navigator.share && navigator.canShare);
}
el('exIncludeUnverified').addEventListener('change', refreshExport);
function triggerDownload(blob, name){
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}
const bookFile = (suffix) => `${safeFileName(S.book.title, 'book')}_${S.book.tgt}${suffix}`;
function chapterPlain(c){ const inc = el('exIncludeUnverified').checked; return chapterText(c, inc); }
function chapterHtml(c){
  const inc = el('exIncludeUnverified').checked;
  return c.paras.map(p=>{ const t = p.t != null ? p.t : (inc ? p.o : null); if(t == null) return ''; const tag = p.h ? 'h' + Math.min(6, p.h + 1) : 'p'; return `<${tag}>${escapeHtml(t)}</${tag}>`; }).join('\n');
}
async function doExport(kind){
  if(!S.book) return;
  const chs = exportable();
  if(kind !== 'json' && !chs.length){ toast('No finished chapters to export yet', 'warn'); return; }
  const title = S.book.title;
  try{
    if(kind === 'story'){
      triggerDownload(new Blob([chs.map(c=>chapterPlain(c)).join('\n\n\n')], {type:'text/plain;charset=utf-8'}), bookFile('.txt'));
    } else if(kind === 'zip'){
      if(!await waitLib(LIB.jszip)) throw new Error('ZIP library not loaded');
      const zip = new JSZip(); const pad = String(chs.length).length;
      chs.forEach((c,i)=>zip.file(`${String(i+1).padStart(pad,'0')} - ${safeFileName(c.title,'chapter')}.txt`, `${c.title}\n\n${chapterPlain(c)}`));
      zip.file('00 - FULL BOOK.txt', `${title}\n\n` + chs.map(c=>`${c.title}\n\n${chapterPlain(c)}`).join('\n\n\n'));
      triggerDownload(await zip.generateAsync({type:'blob'}), bookFile('.zip'));
    } else if(kind === 'epub'){
      if(!await waitLib(LIB.jszip)) throw new Error('ZIP library not loaded');
      triggerDownload(await buildEpub(chs), bookFile('.epub'));
    } else if(kind === 'md'){
      const md = `# ${title}\n\n` + chs.map((c,i)=>`- [${c.title}](#ch${i+1})`).join('\n') + '\n\n' + chs.map((c,i)=>`<a id="ch${i+1}"></a>\n## ${c.title}\n\n${chapterPlain(c)}`).join('\n\n---\n\n');
      triggerDownload(new Blob([md], {type:'text/markdown;charset=utf-8'}), bookFile('.md'));
    } else if(kind === 'html'){
      const lang = S.book.tgt; const rtl = /^(ur|ar|fa|he)$/.test(lang);
      const html = `<!DOCTYPE html><html lang="${lang}"${rtl?' dir="rtl"':''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{max-width:720px;margin:0 auto;padding:32px 20px;font-family:'Noto Serif Devanagari',Georgia,serif;line-height:1.8;font-size:18px;color:#222;background:#faf8f3}h1{font-size:2em}h2{margin-top:3em;border-bottom:1px solid #ddd;padding-bottom:.3em}nav ol{columns:2;font-size:.9em}a{color:#2a5db0}@media(prefers-color-scheme:dark){body{background:#111;color:#ddd}h2{border-color:#333}a{color:#8ab4ff}}</style></head><body>
<h1>${escapeHtml(title)}</h1><nav><ol>${chs.map((c,i)=>`<li><a href="#ch${i+1}">${escapeHtml(c.title)}</a></li>`).join('')}</ol></nav>
${chs.map((c,i)=>`<section id="ch${i+1}"><h2>${escapeHtml(c.title)}</h2>\n${chapterHtml(c)}</section>`).join('\n')}
<footer style="margin-top:4em;font-size:.8em;color:#888">Translated with Deep Translate · novelxplin.in</footer></body></html>`;
      triggerDownload(new Blob([html], {type:'text/html;charset=utf-8'}), bookFile('.html'));
    } else if(kind === 'json'){
      triggerDownload(new Blob([JSON.stringify(backupPayload())], {type:'application/json'}), bookFile('_dt_backup.json'));
    } else if(kind === 'copy'){
      await navigator.clipboard.writeText(chs.map(c=>`${c.title}\n\n${chapterPlain(c)}`).join('\n\n\n'));
      toast('Copied the whole book to the clipboard', 'ok'); return;
    } else if(kind === 'share'){
      const file = new File([chs.map(c=>`${c.title}\n\n${chapterPlain(c)}`).join('\n\n\n')], bookFile('.txt'), {type:'text/plain'});
      if(navigator.canShare && navigator.canShare({files:[file]})) await navigator.share({files:[file], title});
      else await navigator.share({title, text: chs.slice(0,1).map(c=>chapterPlain(c)).join('').slice(0, 2000)});
      return;
    }
    toast('Download started', 'ok');
  }catch(e){ if(e && e.name === 'AbortError') return; toast('Export failed: ' + (e.message || e), 'err', 4000); }
}
$$('.ex').forEach(b=>b.addEventListener('click', ()=>doExport(b.dataset.ex)));

async function buildEpub(chs){
  const zip = new JSZip();
  const title = S.book.title, lang = S.book.tgt, uid = 'urn:uuid:' + (crypto.randomUUID ? crypto.randomUUID() : 'dt-' + now());
  zip.file('mimetype', 'application/epub+zip', {compression:'STORE'});
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  zip.file('OEBPS/style.css', `body{font-family:serif;line-height:1.7;margin:1em}h1,h2{text-align:center;margin:1.5em 0 1em}p{text-indent:1.2em;margin:0 0 .4em;text-align:justify}`);
  const rtl = /^(ur|ar|fa|he)$/.test(lang);
  const items = chs.map((c,i)=>{
    const id = `ch${i+1}`;
    zip.file(`OEBPS/${id}.xhtml`, `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}"${rtl?' dir="rtl"':''}><head><title>${escapeXml(c.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head><body><section epub:type="chapter"><h2>${escapeXml(c.title)}</h2>${chapterHtml(c).replace(/<br>/g,'<br/>')}</section></body></html>`);
    return {id, title:c.title};
  });
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc" id="toc"><h1>${escapeXml(title)}</h1><ol>${items.map(it=>`<li><a href="${it.id}.xhtml">${escapeXml(it.title)}</a></li>`).join('')}</ol></nav></body></html>`);
  zip.file('OEBPS/toc.ncx', `<?xml version="1.0" encoding="UTF-8"?><ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="${uid}"/></head><docTitle><text>${escapeXml(title)}</text></docTitle><navMap>${items.map((it,i)=>`<navPoint id="np${i+1}" playOrder="${i+1}"><navLabel><text>${escapeXml(it.title)}</text></navLabel><content src="${it.id}.xhtml"/></navPoint>`).join('')}</navMap></ncx>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="uid">${uid}</dc:identifier><dc:title>${escapeXml(title)}</dc:title><dc:language>${lang}</dc:language><dc:contributor>Deep Translate · Novelxplin</dc:contributor><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/,'Z')}</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/><item id="css" href="style.css" media-type="text/css"/>${items.map(it=>`<item id="${it.id}" href="${it.id}.xhtml" media-type="application/xhtml+xml"/>`).join('')}</manifest><spine toc="ncx">${items.map(it=>`<itemref idref="${it.id}"/>`).join('')}</spine></package>`);
  return zip.generateAsync({type:'blob', mimeType:'application/epub+zip'});
}

/* Backup format — compatible with Novelxplin's `dtvBackup:1` so it can be restored in any layout */
function backupPayload(){
  const inc = true;
  return {
    dtvBackup: 1, deepTranslate: 1, savedAt: now(), bookTitle: S.book.title, bookLang: S.book.src === 'auto' ? 'en' : S.book.src, targetLang: S.book.tgt,
    exportOrder: S.book.chapters.map((c,i)=>i),
    chapters: S.book.chapters.map(c=>{
      const st = chapterStatus(c);
      return { title: c.title, status: st === 'done' ? 'done' : (st === 'skipped' ? 'skipped' : (c.paras.some(p=>p.t != null) ? 'unverified' : 'pending')), text: chapterText(c, inc), originalText: c.paras.map(p=>p.o).join('\n\n'), excluded: !!c.excluded,
        dt: { paras: c.paras.map(p=>[p.o, p.t, p.h || 0]) } };
    })
  };
}
async function restoreBackup(file){
  let data;
  try{ data = JSON.parse(await file.text()); }catch(e){ toast('Could not read this file', 'err'); return; }
  if(!data || data.dtvBackup !== 1 || !Array.isArray(data.chapters)){ toast('Not a valid Novelxplin / Deep Translate backup', 'err'); return; }
  const src = data.bookLang && LANGS[data.bookLang] ? data.bookLang : 'en';
  const tgt = data.targetLang && LANGS[data.targetLang] ? data.targetLang : settings.tgt;
  const chapters = data.chapters.map((sc,i)=>{
    let paras;
    if(sc.dt && Array.isArray(sc.dt.paras)) paras = sc.dt.paras.map(a=>({o:a[0], t:a[1], h:a[2]||0, err:0}));
    else {
      const origs = textToParas(sc.originalText || ''); const trans = (sc.text || '').split(/\n{2,}/).map(s=>s.trim()).filter(Boolean);
      if(origs.length && origs.length === trans.length) paras = origs.map((p,k)=>({o:p.o, t:trans[k], h:p.h, err:0}));
      else if(origs.length) paras = origs.map(p=>({o:p.o, t:null, h:p.h, err:0}));
      else paras = trans.map(t=>({o:t, t, h:0, err:0}));
      if(sc.status === 'done' && sc.text && origs.length !== trans.length){ paras = [{o: sc.originalText || sc.text, t: sc.text, h:0, err:0}]; }
    }
    return { index:i, title: sc.title || `Chapter ${i+1}`, paras, excluded: !!sc.excluded };
  });
  await loadBook({ title: data.bookTitle || file.name.replace(/\.json$/i,''), ext:'JSON', chapters }, src, tgt, {restored:true});
}

/* ============ 13. HAND-OFF TO NOVELXPLIN ============ */
el('openInNxBtn').addEventListener('click', async ()=>{
  if(!S.book) return;
  const ok = await handoffPut(backupPayload());
  if(ok === undefined && !('indexedDB' in window)){ toast('Storage unavailable — download the .json backup and restore it in Novelxplin instead', 'warn', 4500); return; }
  location.href = 'index.html?ui=new&from=deep-translate';
});

/* ============ 14. BOOK LOADING / HOME ============ */
function setDropStatus(msg){ const dz = el('dropzone'); dz.querySelector('b').textContent = msg || 'Tap to choose a book'; }
async function openFile(file){
  if(!file) return;
  if(S.running){ toast('Stop the current run first', 'warn'); return; }
  if(/\.json$/i.test(file.name)) return restoreBackup(file);
  const dz = el('dropzone'); dz.classList.add('busy'); setDropStatus(`Reading ${file.name}…`);
  try{
    const parsed = await parseFile(file);
    const src = el('srcLang').value, tgt = el('tgtLang').value;
    if(parsed.lang && src !== 'auto' && parsed.lang !== src && LANGS[parsed.lang]) toast(`This EPUB says it is in ${langLabel(parsed.lang)} — check the "From" language`, 'warn', 4500);
    await loadBook(parsed, src, tgt, {fileSize: file.size});
  }catch(e){ toast(e.message || 'Could not open this file', 'err', 5000); }
  finally{ dz.classList.remove('busy'); setDropStatus(''); }
}
async function loadBook(parsed, src, tgt, meta={}){
  if(src === tgt && src !== 'auto'){ toast('Source and target language are the same', 'warn'); return; }
  const key = computeKey(parsed.title, src, tgt, parsed.chapters);
  const saved = await sessGet(key);
  const book = { key, title: parsed.title, ext: parsed.ext, src, tgt, chapters: parsed.chapters, createdAt: now(), savedAt: now(), stats:{bytes:0, ms:0, runs:0}, fileSize: meta.fileSize || 0 };
  if(saved && saved.chapters && saved.chapters.length === book.chapters.length && !meta.restored){
    const prog = progressOf(saved);
    if(prog.done){
      // merge saved translations into the freshly parsed book
      saved.chapters.forEach((sc,i)=>{ const c = book.chapters[i]; if(sc.paras.length === c.paras.length){ sc.paras.forEach((sp,k)=>{ c.paras[k].t = sp.t; c.paras[k].err = 0; }); c.excluded = !!sc.excluded; if(sc.title) c.title = sc.title; } });
      book.stats = saved.stats || book.stats; book.createdAt = saved.createdAt || book.createdAt;
      toast(`Resumed — ${prog.done} of ${prog.total} paragraphs were already translated`, 'ok', 3800);
    }
  }
  S.book = book; S.previewIdx = -1; S.filter = 'all'; dataUsed = 0;
  $$('.chip', el('chaptersPanel')).forEach(x=>x.classList.toggle('active', x.dataset.f === 'all'));
  el('home').hidden = true; el('work').hidden = false; setTab('chapters');
  el('bookTitle').textContent = book.title; el('bookExt').textContent = book.ext;
  const words = book.chapters.reduce((n,c)=>n + c.paras.reduce((m,p)=>m + wordCount(p.o), 0), 0);
  const chars = book.chapters.reduce((n,c)=>n + c.paras.reduce((m,p)=>m + p.o.length, 0), 0);
  const chunks = Math.ceil(chars / settings.chunk);
  el('bookSub').textContent = `${book.chapters.length} chapters · ${words.toLocaleString()} words · ≈${chunks} chunks · ≈${formatBytes(chars * 3.2)} data`;
  el('langMini').textContent = `${langShort(src)} → ${langShort(tgt)}`;
  el('rangeFrom').max = el('rangeTo').max = book.chapters.length; el('rangeFrom').value = 1; el('rangeTo').value = book.chapters.length;
  el('engineSel').value = settings.engine;
  renderChapters(); updateProgress(); setControls(); refreshExport();
  const prog = progressOf(book);
  setRunStatus(prog.done === prog.total ? 'done' : '', prog.done === prog.total ? 'Already translated ✓' : (prog.done ? 'Ready to continue' : 'Ready'), prog.done === prog.total ? 'Export below or open in Novelxplin.' : `Tap ${prog.done ? 'Continue' : 'Start'} — progress is saved after every chunk.`);
  previewChapter(0);
  scheduleSave(true); renderRecent();
  window.scrollTo({top:0, behavior:'smooth'});
}
function closeBook(){
  if(S.running){ toast('Stop the run first', 'warn'); return; }
  flushSave(); S.book = null; S.previewIdx = -1; S.run = null;
  el('work').hidden = true; el('home').hidden = false; document.title = 'Deep Translate — Novelxplin'; renderRecent();
}
el('closeBookBtn').addEventListener('click', closeBook);
el('startBtn').addEventListener('click', ()=>startRun());
el('retryBtn').addEventListener('click', ()=>startRun({retryFailed:true}));
el('pauseBtn').addEventListener('click', pauseRun);
el('stopBtn').addEventListener('click', stopRun);
el('engineSel').addEventListener('change', ()=>{ settings.engine = el('engineSel').value; saveSettings(); });

/* file inputs / drag-drop */
const dz = el('dropzone');
dz.addEventListener('click', (e)=>{ if(e.target.closest('.link-btn')) return; el('fileInput').click(); });
dz.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); el('fileInput').click(); } });
el('fileInput').addEventListener('change', (e)=>{ const f = e.target.files[0]; e.target.value = ''; openFile(f); });
el('restoreBtn').addEventListener('click', (e)=>{ e.stopPropagation(); el('restoreInput').click(); });
el('restoreInput').addEventListener('change', (e)=>{ const f = e.target.files[0]; e.target.value = ''; if(f) restoreBackup(f); });
let dragDepth = 0;
window.addEventListener('dragenter', (e)=>{ e.preventDefault(); dragDepth++; el('dropOverlay').classList.add('show'); });
window.addEventListener('dragover', (e)=>e.preventDefault());
window.addEventListener('dragleave', ()=>{ if(--dragDepth <= 0){ dragDepth = 0; el('dropOverlay').classList.remove('show'); } });
window.addEventListener('drop', (e)=>{ e.preventDefault(); dragDepth = 0; el('dropOverlay').classList.remove('show'); const f = e.dataTransfer.files && e.dataTransfer.files[0]; if(f) openFile(f); });

/* sample book */
el('sampleBtn').addEventListener('click', (e)=>{
  e.stopPropagation();
  const sample = [
    {title:'The Lighthouse Keeper', paras:[
      'The lighthouse stood at the edge of the world, or so it seemed to Mara when she was a child. Every evening her grandfather climbed the one hundred and twelve steps to light the great lamp, and every evening she counted them with him.',
      '"A light is a promise," he told her once, resting on the landing to catch his breath. "It says: someone is watching, someone remembers you are out there."',
      'Years later, when the ships no longer needed the lamp and the town had forgotten the old man, Mara still climbed the steps. She lit the lamp not for the ships, but for the promise.'
    ]},
    {title:'A Letter from the Sea', paras:[
      'The bottle arrived on a Tuesday, wedged between two rocks below the lighthouse. Inside was a single page, water-stained but legible, written in a careful hand.',
      '"To whoever keeps the light: I saw you from the deck of the Corvina on the night of the storm. We would not have found the channel without you. Thank you for watching."',
      'Mara read the letter three times. Then she folded it, put it in her coat pocket, and climbed the one hundred and twelve steps a little faster than usual.'
    ]},
    {title:'What the Light Remembers', paras:[
      'Some nights the fog came in so thick that even the lamp could not cut through it. On those nights Mara would sit by the window and talk to the dark, telling it stories her grandfather had told her.',
      'She spoke of ships and sailors, of storms that had names and storms that did not, of the small brave things people do when nobody is looking.',
      'The dark never answered. But somewhere out on the water, she liked to think, someone was listening — and that was enough.'
    ]}
  ];
  const chapters = sample.map((s,i)=>({ index:i, title:s.title, excluded:false, paras:[mkPara(s.title, 2)].concat(s.paras.map(p=>mkPara(p, 0))) }));
  loadBook({ title:'Sample — The Lighthouse Keeper', ext:'DEMO', chapters }, 'en', el('tgtLang').value === 'en' ? 'hi' : el('tgtLang').value);
});

/* recent sessions */
async function renderRecent(){
  const all = (await sessAll()) || [];
  all.sort((a,b)=>(b.savedAt||0) - (a.savedAt||0));
  const wrap = el('recentWrap'), list = el('recentList');
  list.innerHTML = '';
  const items = all.filter(b=>b && b.chapters && b.chapters.length).slice(0, 8);
  wrap.hidden = !items.length;
  items.forEach(b=>{
    const prog = b.progress || progressOf(b);
    const row = document.createElement('div'); row.className = 'recent-item'; row.setAttribute('role','button'); row.tabIndex = 0;
    row.innerHTML = `<span class="ri-ic">${escapeHtml(b.ext || 'BOOK')}</span><span class="ri-text"><b></b><span>${b.chapters.length} chapters · ${langShort(b.src)} → ${langShort(b.tgt)} · ${new Date(b.savedAt||b.createdAt).toLocaleDateString()}</span></span><span class="ri-pct">${prog.pct}%</span><button class="ri-del" type="button" title="Delete" aria-label="Delete session">✕</button>`;
    row.querySelector('b').textContent = b.title;
    row.addEventListener('click', (e)=>{ if(e.target.closest('.ri-del')) return; openSaved(b); });
    row.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') openSaved(b); });
    row.querySelector('.ri-del').addEventListener('click', async (e)=>{ e.stopPropagation(); if(!confirm(`Delete "${b.title}" (${prog.pct}% done)?`)) return; await sessDel(b.key); renderRecent(); toast('Session deleted', 'info'); });
    list.appendChild(row);
  });
}
async function openSaved(b){
  const fresh = await sessGet(b.key) || b;
  S.book = null;
  await loadBook({ title: fresh.title, ext: fresh.ext, chapters: fresh.chapters.map((c,i)=>Object.assign({index:i, excluded:false}, c)) }, fresh.src, fresh.tgt, {restored:true});
  S.book.stats = fresh.stats || S.book.stats; S.book.createdAt = fresh.createdAt || S.book.createdAt; S.book.key = fresh.key;
  updateProgress(); scheduleSave(true);
}

/* ============ 15. LANGUAGE PICKERS & SETTINGS ============ */
(function initLangs(){
  const srcSel = el('srcLang'), tgtSel = el('tgtLang');
  Object.entries(LANGS).forEach(([code, l])=>{
    srcSel.appendChild(new Option(l.name, code));
    if(!l.srcOnly) tgtSel.appendChild(new Option(l.name, code));
  });
  srcSel.value = LANGS[settings.src] ? settings.src : 'en'; tgtSel.value = LANGS[settings.tgt] && settings.tgt !== 'auto' ? settings.tgt : 'hi';
  srcSel.addEventListener('change', ()=>{ settings.src = srcSel.value; saveSettings(); });
  tgtSel.addEventListener('change', ()=>{ settings.tgt = tgtSel.value; saveSettings(); });
  el('swapLangBtn').addEventListener('click', ()=>{
    const a = srcSel.value, b = tgtSel.value; if(a === 'auto'){ toast('Pick a specific source language to swap', 'info'); return; }
    srcSel.value = b; tgtSel.value = a; settings.src = b; settings.tgt = a; saveSettings();
  });
})();

const sheet = el('settingsSheet'), scrim = el('sheetScrim');
function openSettings(){
  el('setChunk').value = String(settings.chunk); el('setParallel').value = String(settings.parallel); el('setGap').value = settings.gap; el('setRetries').value = settings.retries; el('setEmail').value = settings.email;
  el('setWake').checked = settings.wake; el('setSound').checked = settings.sound; el('setVibe').checked = settings.vibe; el('setNoVerify').checked = settings.noVerify;
  el('setFont').value = settings.font; el('setFontFam').value = settings.fontFam;
  sheet.hidden = false; scrim.hidden = false;
}
function closeSettings(){ sheet.hidden = true; scrim.hidden = true; }
el('settingsBtn').addEventListener('click', openSettings); el('closeSettingsBtn').addEventListener('click', closeSettings); scrim.addEventListener('click', closeSettings);
function applyReader(){ document.documentElement.style.setProperty('--reader-font', settings.font + 'px'); reader.classList.toggle('sans', settings.fontFam === 'sans'); }
sheet.addEventListener('change', (e)=>{
  const t = e.target;
  if(t.id === 'setChunk') settings.chunk = parseInt(t.value,10) || 3500;
  if(t.id === 'setParallel') settings.parallel = parseInt(t.value,10) || 2;
  if(t.id === 'setGap') settings.gap = Math.max(0, parseInt(t.value,10) || 0);
  if(t.id === 'setRetries') settings.retries = Math.max(0, Math.min(6, parseInt(t.value,10) || 0));
  if(t.id === 'setEmail') settings.email = t.value.trim();
  if(t.id === 'setWake') settings.wake = t.checked;
  if(t.id === 'setSound') settings.sound = t.checked;
  if(t.id === 'setVibe') settings.vibe = t.checked;
  if(t.id === 'setNoVerify') settings.noVerify = t.checked;
  if(t.id === 'setFontFam') settings.fontFam = t.value;
  saveSettings(); applyReader();
  if(S.book && !S.running){ renderChapters(); setControls(); }
});
el('setFont').addEventListener('input', ()=>{ settings.font = parseInt(el('setFont').value,10); saveSettings(); applyReader(); });
el('clearAllBtn').addEventListener('click', async ()=>{
  if(S.running){ toast('Stop the run first', 'warn'); return; }
  if(!confirm('Delete every saved Deep Translate session on this device?')) return;
  await sessClear(); if(S.book) closeBook(); renderRecent(); toast('All sessions deleted', 'ok');
});
applyReader();

/* ============ 16. SERVICE WORKER & INIT ============ */
if('serviceWorker' in navigator && location.protocol === 'https:'){ window.addEventListener('load', ()=>{ navigator.serviceWorker.register('sw.js').catch(()=>{}); }); }
try{ localStorage.setItem('nx_deep_seen', '1'); }catch(e){}
renderRecent();
window.DT = { S, settings, startRun, pauseRun, stopRun, openFile, loadBook, LANGS, engines: ENGINES, verifyPara, htmlToParas, textToParas };
