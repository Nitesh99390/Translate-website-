/* Xplin Go — export.js
 * TXT story / ZIP per chapter / EPUB / Markdown / HTML / JSON backup / Web Share.
 */
'use strict';
(function(){
const XG = window.XG, S = XG.state, el = XG.el;

function exportList(){
  const list = S.exportOrder.map(i=>S.chapters[i]).filter(c=>c && !c.excluded && c.text && c.text.trim());
  if(!list.length){ XG.toast('Nothing to export yet', 'warn'); return null; }
  return list;
}
function download(blob, name){
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
  XG.buzz(12);
}
const stamp = ()=>Math.floor(Date.now()/1000);
const title = ()=>S.bookTitle || 'Translated Book';
const fname = ()=>XG.safeFileName(title(), 'book');

XG.exportStory = function(){
  const list = exportList(); if(!list) return;
  const blob = new Blob([list.map(c=>c.text.trim()).join('\n\n')], {type:'text/plain;charset=utf-8'});
  download(blob, `${fname()}_story_${stamp()}.txt`);
  XG.toast('Story .txt download started', 'ok');
};

XG.exportZip = async function(){
  const list = exportList(); if(!list) return;
  if(typeof JSZip === 'undefined'){ XG.toast('ZIP library not loaded', 'err'); return; }
  const zip = new JSZip(); const used = new Set();
  list.forEach((c,pos)=>{
    const base = `${String(pos+1).padStart(2,'0')}_${XG.safeFileName(c.title,'chapter')}`;
    let f = base + '.txt', n = 1; while(used.has(f)) f = `${base}_${n++}.txt`; used.add(f);
    zip.file(f, c.text);
  });
  const toc = ['TABLE OF CONTENTS', '='.repeat(40), '', ...list.map((c,p)=>`${String(p+1).padStart(2,'0')}. ${c.title}`), '', '='.repeat(40), ''];
  const body = []; list.forEach((c,p)=>body.push(`[${String(p+1).padStart(2,'0')}] ${c.title}`, '-'.repeat(40), '', c.text, '', ''));
  zip.file(`00_full_${fname()}.txt`, toc.join('\n') + body.join('\n'));
  try{
    const blob = await zip.generateAsync({type:'blob', streamFiles:true});
    download(blob, `${fname()}_translated_${stamp()}.zip`);
    XG.toast('ZIP download started', 'ok');
  }catch(e){ XG.toast('ZIP failed — too large? Try fewer chapters', 'err', 4000); }
};

XG.exportMarkdown = function(){
  const list = exportList(); if(!list) return;
  const lines = [`# ${title()}`, '', '## Table of Contents', ''];
  const anchors = list.map((c,p)=>(String(c.title||'chapter').toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu,'').trim().replace(/\s+/g,'-') || 'chapter') + '-' + (p+1));
  list.forEach((c,p)=>lines.push(`${p+1}. [${c.title}](#${anchors[p]})`));
  lines.push('', '---', '');
  list.forEach((c,p)=>{
    lines.push(`<a id="${anchors[p]}"></a>`, '', `## ${c.title}`, '');
    c.text.split(/\n+/).map(x=>x.trim()).filter(Boolean).forEach(x=>lines.push(x, ''));
    lines.push('---', '');
  });
  download(new Blob([lines.join('\n')], {type:'text/markdown;charset=utf-8'}), `${fname()}_translated_${stamp()}.md`);
  XG.toast('Markdown download started', 'ok');
};

XG.exportHtml = function(){
  const list = exportList(); if(!list) return;
  const lang = (S.bookLang || 'en').split('-')[0];
  const H = XG.escapeHtml;
  const toc = list.map((c,p)=>`<li><a href="#chap-${p+1}">${H(c.title)}</a></li>`).join('\n');
  const chaps = list.map((c,p)=>{
    const paras = c.text.split(/\n+/).map(x=>x.trim()).filter(Boolean).map(x=>`<p>${H(x)}</p>`).join('\n');
    return `<section id="chap-${p+1}"><h2>${H(c.title)}</h2>\n${paras}\n<p class="back"><a href="#top">\u2191 Contents</a></p></section>`;
  }).join('\n<hr>\n');
  const doc = `<!DOCTYPE html>
<html lang="${H(lang)}"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${H(title())}</title>
<style>body{max-width:680px;margin:0 auto;padding:40px 20px 80px;font-family:Georgia,serif;line-height:1.8;color:#222;background:#faf8f4}h1{font-size:1.9em}h2{margin-top:2em;font-size:1.4em}nav ol{line-height:2}a{color:#3a5fa8}hr{border:none;border-top:1px solid #ddd6c8;margin:3em 0}.back{font-size:.85em;margin-top:2em}.meta{color:#888;font-size:.85em;font-family:system-ui,sans-serif}@media print{.back{display:none}}</style>
</head><body>
<header id="top"><h1>${H(title())}</h1><p class="meta">Translated copy &middot; ${list.length} chapters &middot; ${new Date().toLocaleDateString()} &middot; Xplin Go</p></header>
<nav><h2>Contents</h2><ol>\n${toc}\n</ol></nav><hr>
<main>\n${chaps}\n</main></body></html>`;
  download(new Blob([doc], {type:'text/html;charset=utf-8'}), `${fname()}_translated_${stamp()}.html`);
  XG.toast('HTML download started', 'ok');
};

function xhtmlBody(text){
  const X = XG.escapeXml;
  const paras = text.split(/\n{2,}/).map(p=>p.trim()).filter(Boolean);
  if(!paras.length){
    const lines = text.split(/\n/).map(l=>l.trim()).filter(Boolean);
    return lines.length ? lines.map(l=>`<p>${X(l)}</p>`).join('\n') : '<p></p>';
  }
  return paras.map(p=>`<p>${X(p).replace(/\n/g,'<br/>')}</p>`).join('\n');
}
function uuid(){
  if(window.crypto && crypto.randomUUID){ try{ return crypto.randomUUID(); }catch(e){} }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c=>{ const r = Math.random()*16|0; return (c==='x' ? r : (r&0x3|0x8)).toString(16); });
}
XG.exportEpub = async function(){
  const list = exportList(); if(!list) return;
  if(typeof JSZip === 'undefined'){ XG.toast('ZIP library not loaded', 'err'); return; }
  const X = XG.escapeXml, lang = (S.bookLang || 'en').split('-')[0], id = uuid();
  const zip = new JSZip();
  zip.file('mimetype', 'application/epub+zip', {compression:'STORE'});
  zip.file('META-INF/container.xml', `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const manifest = [], spine = [], nav = [];
  list.forEach((c,p)=>{
    const cid = `chap${String(p+1).padStart(3,'0')}`, f = `${cid}.xhtml`;
    zip.file(`OEBPS/${f}`, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="${X(lang)}"><head><meta charset="UTF-8"/><title>${X(c.title)}</title></head>
<body><h1>${X(c.title)}</h1>\n${xhtmlBody(c.text)}\n</body></html>`);
    manifest.push(`<item id="${cid}" href="${f}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${cid}"/>`);
    nav.push(`<li><a href="${f}">${X(c.title)}</a></li>`);
  });
  zip.file('OEBPS/nav.xhtml', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${X(lang)}"><head><meta charset="UTF-8"/><title>Table of Contents</title></head>
<body><nav epub:type="toc" id="toc"><h1>Table of Contents</h1><ol>\n${nav.join('\n')}\n</ol></nav></body></html>`);
  zip.file('OEBPS/content.opf', `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">urn:uuid:${id}</dc:identifier>
<dc:title>${X(title())}</dc:title>
<dc:language>${X(lang)}</dc:language>
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/,'Z')}</meta>
</metadata>
<manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>\n${manifest.join('\n')}\n</manifest>
<spine>\n${spine.join('\n')}\n</spine>
</package>`);
  try{
    const blob = await zip.generateAsync({type:'blob', mimeType:'application/epub+zip'});
    download(blob, `${fname()}_translated_${stamp()}.epub`);
    XG.toast('EPUB download started', 'ok');
  }catch(e){ XG.toast('EPUB build failed', 'err'); }
};

XG.exportBackup = function(){
  if(!S.chapters.length){ XG.toast('Nothing to back up yet', 'warn'); return; }
  const payload = {
    dtvBackup: 1, savedAt: Date.now(), bookTitle: title(), bookLang: S.bookLang, exportOrder: S.exportOrder,
    sourceFileName: S.currentFile ? S.currentFile.name : '',
    chapters: S.chapters.map(c=>({title:c.title, status:c.status, text:c.text, originalText:c.originalText||'', excluded:!!c.excluded}))
  };
  download(new Blob([JSON.stringify(payload)], {type:'application/json'}), `${fname()}_dtv_backup.json`);
  XG.toast('Backup download started', 'ok');
};

XG.shareStory = async function(){
  const list = exportList(); if(!list) return;
  const text = list.map(c=>c.text.trim()).join('\n\n');
  const file = new File([text], `${fname()}_story.txt`, {type:'text/plain'});
  try{
    if(navigator.canShare && navigator.canShare({files:[file]})){
      await navigator.share({files:[file], title: title(), text: `${title()} — translated with Xplin Go`});
      return;
    }
    if(navigator.share){ await navigator.share({title: title(), text: text.slice(0, 20000)}); return; }
    throw new Error('no share');
  }catch(e){
    if(e && e.name === 'AbortError') return;
    XG.exportStory();
  }
};

XG.copyAll = async function(){
  const list = exportList(); if(!list) return;
  const text = list.map(c=>`${c.title}\n\n${c.text.trim()}`).join('\n\n\n');
  try{ await navigator.clipboard.writeText(text); XG.toast(`Copied ${list.length} chapters`, 'ok'); }
  catch(e){ XG.toast('Copy not allowed here — use Share or TXT instead', 'err', 3500); }
};

XG.copyChapter = async function(i){
  const c = S.chapters[i]; if(!c || !c.text){ XG.toast('No translated text yet', 'warn'); return; }
  try{ await navigator.clipboard.writeText(c.text); XG.toast('Copied', 'ok'); }
  catch(e){ XG.toast('Copy not allowed here', 'err'); }
};

el('exportStoryBtn').addEventListener('click', XG.exportStory);
el('exportZipBtn').addEventListener('click', XG.exportZip);
el('exportEpubBtn').addEventListener('click', XG.exportEpub);
el('exportMdBtn').addEventListener('click', XG.exportMarkdown);
el('exportHtmlBtn').addEventListener('click', XG.exportHtml);
el('backupExportBtn').addEventListener('click', XG.exportBackup);
el('shareBtn').addEventListener('click', XG.shareStory);
el('copyAllBtn').addEventListener('click', XG.copyAll);
})();
