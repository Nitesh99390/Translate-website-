/* ==========================================================================
   Auth — Google Sign-In via Firebase Authentication.

   • Header shows a "Sign in with Google" button when signed out and an avatar
     menu (name, e-mail, sign out) when signed in.
   • On sign-in the shared library (cloud-sync) adopts the Google display name
     and the Firebase uid so contributions / presence are attributed to you.
   • Popup first, redirect fallback (popup blockers, in-app browsers, iOS PWA).
   ========================================================================== */
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult,
  onAuthStateChanged, signOut, setPersistence, browserLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirebase } from "./firebase.js";

const $ = (id) => document.getElementById(id);
const D = () => window.DTV;
const toast = (msg, type='info', ms) => { const d = D(); if(d && d.showToast) d.showToast(msg, type, ms); };

let auth = null, provider = null, user = null, menuOpen = false;

function initials(name, email){
  const src = (name || email || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if(parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function esc(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function friendlyError(e){
  const code = (e && e.code) || '';
  if(code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return null; // silent
  if(code === 'auth/network-request-failed') return 'Network error — check your connection and try again.';
  if(code === 'auth/unauthorized-domain') return 'This domain is not authorised for Google sign-in (Firebase console → Authentication → Settings → Authorized domains).';
  if(code === 'auth/operation-not-allowed') return 'Google sign-in is not enabled for this project (Firebase console → Authentication → Sign-in method).';
  return (e && e.message) ? e.message.replace(/^Firebase:\s*/, '').replace(/\s*\(auth\/[^)]+\)\.?$/, '') : 'Sign-in failed. Please try again.';
}

/* ------------------------------------------------------------------ UI */
function render(){
  const wrap = $('authWrap');
  if(!wrap) return;
  const signedIn = !!user;
  wrap.dataset.state = signedIn ? 'in' : 'out';

  const btn = $('authSignInBtn');
  const avatarBtn = $('authAvatarBtn');
  const menu = $('authMenu');
  if(btn) btn.hidden = signedIn;
  if(avatarBtn) avatarBtn.hidden = !signedIn;

  if(signedIn){
    const name = user.displayName || (user.email || '').split('@')[0] || 'Reader';
    const photo = user.photoURL ? user.photoURL.replace(/=s\d+-c$/, '=s96-c') : '';
    const av = photo
      ? `<img src="${esc(photo)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'auth-initials',textContent:'${esc(initials(name, user.email))}'}))">`
      : `<span class="auth-initials">${esc(initials(name, user.email))}</span>`;
    if(avatarBtn){
      avatarBtn.innerHTML = av;
      avatarBtn.title = `${name} — account`;
      avatarBtn.setAttribute('aria-label', `Account menu for ${name}`);
    }
    if(menu){
      menu.innerHTML = `
        <div class="auth-menu-head">
          <span class="auth-menu-avatar">${av}</span>
          <div class="auth-menu-id">
            <b>${esc(name)}</b>
            <span>${esc(user.email || '')}</span>
          </div>
        </div>
        <div class="auth-menu-note">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          <span>Shared-library contributions are credited to <b>${esc(name)}</b></span>
        </div>
        <button type="button" class="auth-menu-item" id="authSignOutBtn" role="menuitem">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/></svg>
          Sign out
        </button>`;
      const so = $('authSignOutBtn');
      if(so) so.addEventListener('click', doSignOut);
    }
  }else{
    if(menu) menu.innerHTML = '';
    closeMenu();
  }
}

function openMenu(){ const m = $('authMenu'); if(!m || !user) return; m.classList.add('show'); menuOpen = true; $('authAvatarBtn')?.setAttribute('aria-expanded', 'true'); }
function closeMenu(){ const m = $('authMenu'); if(m) m.classList.remove('show'); menuOpen = false; $('authAvatarBtn')?.setAttribute('aria-expanded', 'false'); }

/* ------------------------------------------------------------- actions */
function isEmbeddedOrMobile(){
  const ua = navigator.userAgent || '';
  const standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const inApp = /FBAN|FBAV|Instagram|Line\/|MicroMessenger|Twitter|wv\)/i.test(ua);
  return standalone || inApp;
}

async function doSignIn(){
  if(!auth){ toast('Sign-in is unavailable right now', 'warn'); return; }
  const btn = $('authSignInBtn');
  if(btn){ btn.disabled = true; btn.classList.add('busy'); }
  try{
    if(isEmbeddedOrMobile()){
      await signInWithRedirect(auth, provider);
      return;
    }
    const res = await signInWithPopup(auth, provider);
    if(res && res.user) toast(`Welcome, ${res.user.displayName || 'reader'}!`, 'ok', 2200);
  }catch(e){
    if(e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')){
      try{ await signInWithRedirect(auth, provider); return; }catch(e2){ e = e2; }
    }
    const msg = friendlyError(e);
    if(msg) toast(msg, 'err', 5000);
  }finally{
    if(btn){ btn.disabled = false; btn.classList.remove('busy'); }
  }
}

async function doSignOut(){
  closeMenu();
  try{ await signOut(auth); toast('Signed out', 'info', 1600); }
  catch(e){ toast(friendlyError(e) || 'Sign-out failed', 'err'); }
}

/* ------------------------------------------------- identity → cloud-sync */
function pushIdentity(){
  const cloud = window.DTVCloud;
  if(!cloud || !cloud.setIdentity) return false;
  if(user){
    cloud.setIdentity({ uid: user.uid, name: user.displayName || (user.email || '').split('@')[0] || null, photo: user.photoURL || null, email: user.email || null });
  }else{
    cloud.setIdentity(null);
  }
  return true;
}

/* ---------------------------------------------------------------- wire */
function wire(){
  const { app } = getFirebase();
  try{
    auth = getAuth(app);
    provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
  }catch(e){
    console.warn('[auth] init failed', e);
    render();
    return;
  }

  setPersistence(auth, browserLocalPersistence).catch(()=>{});

  $('authSignInBtn')?.addEventListener('click', doSignIn);
  $('authAvatarBtn')?.addEventListener('click', (e)=>{ e.stopPropagation(); menuOpen ? closeMenu() : openMenu(); });
  document.addEventListener('click', (e)=>{ if(menuOpen && !e.target.closest('#authWrap')) closeMenu(); });
  document.addEventListener('keydown', (e)=>{ if(e.key === 'Escape' && menuOpen) closeMenu(); });

  getRedirectResult(auth).then(res=>{ if(res && res.user) toast(`Welcome, ${res.user.displayName || 'reader'}!`, 'ok', 2200); }).catch(e=>{ const m = friendlyError(e); if(m) toast(m, 'err', 5000); });

  onAuthStateChanged(auth, (u)=>{
    user = u || null;
    document.documentElement.dataset.auth = user ? 'in' : 'out';
    render();
    if(!pushIdentity()){
      /* cloud-sync may load after us */
      const d = D();
      if(d && d.on) d.on('cloud:ready', pushIdentity);
      else document.addEventListener('DOMContentLoaded', ()=>{ const dd = D(); if(dd && dd.on) dd.on('cloud:ready', pushIdentity); }, {once:true});
    }
    const d = D();
    if(d && d.emit) d.emit('auth:change', user ? { uid: user.uid, name: user.displayName, email: user.email, photo: user.photoURL } : null);
  });

  window.DTVAuth = {
    get user(){ return user; },
    signIn: doSignIn,
    signOut: doSignOut,
    isSignedIn: () => !!user
  };
}

if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire, {once:true});
else wire();
