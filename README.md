# Novelxplin — Verified Document Translation

Live: https://novelxplin.in/ (mirror: https://nitesh99390.github.io/Translate-website-/)

Translate EPUB / PDF / DOCX / TXT books chapter-by-chapter using Chrome's built-in
page translator, with every chapter **verified** before it is accepted. Pure static
site — no build step, no server. Just open `index.html` (or serve the folder).

## Three interfaces — pick whichever you like

| | New UI (`/`) | Classic UI (`/classic/`) | **Xplin Go** (`/mobile/`) |
|---|---|---|---|
| Built for | Desktop & mobile | Desktop & mobile | **Phones only** (desktop shows a gate) |
| Layout | Top bar + stepper, sidebar workspace | Original single-column page | App bar + ☰ hamburger drawer, **full-screen reader** |
| Shared library / Google sign-in | Yes | No (100% local) | No (100% local) |
| Command palette, reading mode, diff, glossary, stats | Yes | No | No |
| Verified translation, pause/skip/retry, editor, backup, 5 exports | Yes | Yes | Yes (+ Web Share, long-press chapter menu, swipe between chapters, pinch-to-zoom text) |
| Themes | Dark · Light · AMOLED · Sepia | Dark · Light · AMOLED · Sepia | Dark · Light · Sepia · AMOLED |
| Logo | Aa/अ blue disc | Aa/अ blue disc | Own logo — open book + check, violet→cyan |

- Switch any time: **☰ menu → Switch to Classic UI / Xplin Go** in the new top bar (or `Ctrl K`),
  **New UI** toggle in the classic header, **Xplin Go (mobile)** link in either footer,
  and the *Other layouts* section in the Xplin Go drawer.
- Your choice is remembered (`localStorage.nx_ui_version` = `new` | `classic` | `mobile`) — the next
  visit to `novelxplin.in` opens the layout you picked. Force one with `?ui=new`, `?ui=classic` or `?ui=mobile`.

### Xplin Go (mobile edition)

`/mobile/` is a separate, self-contained app (`mobile/index.html`, `mobile/css`, `mobile/js`, own
manifest + service worker, own icons). Nothing from the two desktop layouts is changed apart from
the footer link and the `?ui=mobile` redirect.

- **Full-screen translation** — the chapter fills the whole phone screen so Chrome's page translator
  sees everything; the app bar hides while a run is active (tap the chapter title to bring it back,
  or use the ⛶ button for true browser fullscreen).
- **Bottom bar for one-thumb use (v2)**: Chapters · Export · **▶ Start/Pause** · Reader · Menu, with
  pending / exportable badges. A compact run HUD (progress ring, ETA, skip, stop) appears while translating.
- **Translate-status pill** in the app bar tells you whether the browser translator is on. Tapping ▶
  with translate off opens a **preflight sheet** with browser-specific steps (Chrome / Samsung /
  Edge / Firefox / Safari); the run auto-starts the moment the page is translated.
- **Target language picker** (Hindi, Bengali, Tamil, … 30 languages) — verification checks for the
  chosen script's share of letters (or text divergence for Latin targets).
- Bottom sheets: **Chapters** (search, jump to #, next pending, ⋮ per-row menu), **Export**
  (TXT · ZIP · EPUB · MD · HTML · JSON backup · Share · Copy all), **Reader** (theme incl. *Follow
  system*, A−/A+, line height, font, compare), **Finish stats** (verified / unverified / skipped /
  words / time + *Retry unverified*).
- ☰ drawer keeps Book (open / restore / sample / recent), Translate (range, retry unverified),
  Reader, Advanced (timeouts · retries · gap · scroll · sound · vibrate · memory saver) and Other
  layouts in collapsible sections.
- First-run onboarding, built-in **sample book**, **read aloud** (Web Speech) with paragraph
  highlight, tap zones (left / right = prev / next chapter, centre = hide bars), swipe between
  chapters, long-press a recent session to delete it.
- Edge-swipe opens the menu, Android back button closes menus/sheets, haptic feedback on each
  verified chapter, chime when done.
- Same IndexedDB (`docTranslatorDB`) as the other layouts, so a book started on desktop can be
  resumed on the phone and vice-versa. Theme is shared too.
- Desktop browsers see a "phone-only" gate with links to the other two layouts (and a
  "continue anyway" escape hatch).
- Theme (`dtv_theme`), run settings (`dtv_settings_v4`) and IndexedDB sessions are shared,
  so a book started in one layout can be resumed in the other.

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
- Clean top bar: logo · stepper · progress · Sign in · **☰ menu** (search, 4 theme tiles,
  interface language, shortcuts, tour, Classic UI, install)
- 4 themes: Dark, Light, AMOLED, Sepia (`T` shortcut)
- Command palette (`Ctrl/⌘ K`) with fuzzy search
- Reading mode (`R`), word-level diff viewer (`D`), glossary / custom dictionary (`G`)
  auto-applied to translated text, stats dashboard + CSV export
- Chapter notes & flags, right-click context menu, "Flagged" filter, bulk actions bar
- Recent sessions, onboarding tour, animated counters, skeleton loaders, confetti
- Mobile: bottom-sheet sidebar, swipe between chapters
- PWA: installable, offline app shell (`manifest.webmanifest`, `sw.js`)
- UI language toggle (EN / Hinglish)

**Google sign-in (optional)**
- "Sign in" button in the header uses Firebase Authentication with the Google provider
- Popup first, automatic redirect fallback (popup blocked, in-app browsers, installed PWA)
- When signed in, the shared library uses your Google name + uid for presence, claims
  and contributor credits; the display-name field becomes read-only
- Everything still works anonymously when signed out

## Firebase

Config lives in `js/firebase.js` (shared by the visitor odometer, auth and the library).

**Enable Google login** (one-time, Firebase console):
1. Authentication → Sign-in method → **Google** → Enable (pick a support e-mail)
2. Authentication → Settings → **Authorized domains** → add `nitesh99390.github.io`
   (and any custom domain / localhost you test from)
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
index.html            new UI — app shell + modals
classic/index.html    classic UI — original self-contained single page (own CSS/JS)
mobile/               Xplin Go — phone-only edition (own css/, js/, assets/, manifest, sw.js)
mobile/js/core.js       state, settings, IndexedDB, EPUB/PDF/DOCX/TXT parsing
mobile/js/run.js        full-screen viewer, chapter list, translate-verify loop
mobile/js/export.js     TXT / ZIP / EPUB / MD / HTML / backup / Web Share
mobile/js/ui.js         drawer, gate, sheets, reader settings, PWA
css/style.css         themes + all component styles
js/app.js             core: parsing, run loop, verification, exports, window.DTV API
js/pro.js             pro UI layer (palette, reader, diff, glossary, stats, tour, PWA…)
js/firebase.js        shared Firebase init
js/auth.js            Google sign-in (Firebase Auth) + header account menu
js/cloud-sync.js      shared translation library (push / pull / live / claims / presence)
js/odometer.js        visitor counter
manifest.webmanifest  PWA manifest
sw.js                 service worker
```

## Local dev

```bash
python3 -m http.server 8080   # then open http://localhost:8080
```
