# Document Translation Verifier — Pro

Live: https://nitesh99390.github.io/Translate-website-/

Translate EPUB / PDF / DOCX / TXT books chapter-by-chapter using Chrome's built-in
page translator, with every chapter **verified** before it is accepted. Pure static
site — no build step, no server. Just open `index.html` (or serve the folder).

## Features

**Core**
- Chapter splitting for `.epub`, `.pdf`, `.docx`, `.txt`
- Verified translation (script-change / text-divergence checks), retries, skip, pause, stop
- Side-by-side compare, inline editor, chapter reorder, exclude from export
- Export as story `.txt`, ZIP (per chapter), EPUB, Markdown, HTML — with export preview
- Resume from IndexedDB session, backup / restore `.json`

**Shared translation library (Firebase)**
- Every verified chapter is saved to Firebase Realtime Database under
  `library/{bookId}` where `bookId = normalized-filename__chapterCount`
- Anyone who opens a file with the **same name** (and chapter count) instantly gets
  the already-translated chapters pulled in, and the run **continues from the rest**
- Live updates: chapters translated by others appear while you work
- Claims (3-min TTL) so two readers never translate the same chapter at once; the
  run loop defers claimed chapters and comes back to them in a second pass
- Presence ("N others on this book"), contributors, display name, toggle to opt out
- Community library on the home screen: open any shared book and continue it

**Pro UI**
- 4 themes: Dark, Light, AMOLED, Sepia (theme menu + `T` shortcut)
- Command palette (`Ctrl/⌘ K`) with fuzzy search
- Reading mode (`R`), word-level diff viewer (`D`), glossary / custom dictionary (`G`)
  auto-applied to translated text, stats dashboard + CSV export
- Chapter notes & flags, right-click context menu, "Flagged" filter, bulk actions bar
- Recent sessions, onboarding tour, animated counters, skeleton loaders, confetti
- Mobile: bottom-sheet sidebar, swipe between chapters
- PWA: installable, offline app shell (`manifest.webmanifest`, `sw.js`)
- UI language toggle (EN / Hinglish)

## Firebase

Config lives in `js/firebase.js` (shared by the visitor odometer and the library).
Recommended Realtime Database rules:

```json
{
  "rules": {
    "visits": { ".read": true, ".write": true },
    "library_index": { ".read": true, ".write": true },
    "library": {
      "$bookId": {
        ".read": true,
        ".write": true,
        "chapters": { "$i": { ".validate": "newData.hasChildren(['text','title'])" } }
      }
    }
  }
}
```

## Project layout

```
index.html            app shell + modals
css/style.css         themes + all component styles
js/app.js             core: parsing, run loop, verification, exports, window.DTV API
js/pro.js             pro UI layer (palette, reader, diff, glossary, stats, tour, PWA…)
js/firebase.js        shared Firebase init
js/cloud-sync.js      shared translation library (push / pull / live / claims / presence)
js/odometer.js        visitor counter
manifest.webmanifest  PWA manifest
sw.js                 service worker
```

## Local dev

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```
