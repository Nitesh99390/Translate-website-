/* ==========================================================================
   Novelxplin — Premium landing interactions (v3)
   - Scroll reveal (.reveal → .in)
   - Count-up metrics (.count[data-to])
   - 3D tilt on the hero drop card (.tilt)
   - Magnetic hover for CTA buttons (.magnetic)
   - Spotlight cursor tracking on bento cards
   - Hero "Upload a document" button → opens the file picker
   Progressive enhancement only: nothing here is required for the app to work.
   ========================================================================== */
(function(){
  'use strict';

  var REDUCED = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE_POINTER = window.matchMedia && window.matchMedia('(pointer: fine)').matches;

  function $(sel, root){ return (root || document).querySelector(sel); }
  function $$(sel, root){ return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function clamp(v, a, b){ return Math.min(b, Math.max(a, v)); }

  /* ---------------------------------------------------------------------
     1. Hero upload button → native file input
     --------------------------------------------------------------------- */
  var heroBtn = $('#heroUploadBtn');
  var fileInput = $('#epubFile');
  if(heroBtn && fileInput){
    heroBtn.addEventListener('click', function(e){
      e.preventDefault();
      fileInput.click();
    });
  }

  /* ---------------------------------------------------------------------
     2. Scroll reveal
     --------------------------------------------------------------------- */
  var revealEls = $$('.reveal');
  if(revealEls.length){
    if(REDUCED || !('IntersectionObserver' in window)){
      document.documentElement.classList.add('no-io');
      revealEls.forEach(function(el){ el.classList.add('in'); });
    }else{
      var io = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if(en.isIntersecting){
            en.target.classList.add('in');
            io.unobserve(en.target);
          }
        });
      }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
      revealEls.forEach(function(el){ io.observe(el); });
    }
  }

  /* ---------------------------------------------------------------------
     3. Count-up metrics
     --------------------------------------------------------------------- */
  function countUp(el){
    var to = parseFloat(el.getAttribute('data-to')) || 0;
    if(REDUCED){ el.textContent = String(to); return; }
    var dur = clamp(600 + to * 8, 700, 1600);
    var start = null;
    function ease(t){ return 1 - Math.pow(1 - t, 3); }
    function step(ts){
      if(start === null) start = ts;
      var p = clamp((ts - start) / dur, 0, 1);
      el.textContent = String(Math.round(to * ease(p)));
      if(p < 1) requestAnimationFrame(step);
      else el.textContent = String(to);
    }
    requestAnimationFrame(step);
  }
  var counters = $$('.count[data-to]');
  if(counters.length){
    if('IntersectionObserver' in window && !REDUCED){
      var cio = new IntersectionObserver(function(entries){
        entries.forEach(function(en){
          if(en.isIntersecting){ countUp(en.target); cio.unobserve(en.target); }
        });
      }, { threshold: 0.4 });
      counters.forEach(function(el){ cio.observe(el); });
    }else{
      counters.forEach(countUp);
    }
  }

  /* ---------------------------------------------------------------------
     4. 3D tilt on the hero drop card
     --------------------------------------------------------------------- */
  var tiltEl = $('.tilt');
  if(tiltEl && FINE_POINTER && !REDUCED){
    var MAX = 7; // degrees
    var raf = 0, tx = 0, ty = 0;
    function apply(){
      raf = 0;
      tiltEl.style.transform = 'rotateX(' + ty.toFixed(2) + 'deg) rotateY(' + tx.toFixed(2) + 'deg)';
    }
    tiltEl.addEventListener('pointermove', function(e){
      if(tiltEl.classList.contains('dragover')) return;
      var r = tiltEl.getBoundingClientRect();
      var px = (e.clientX - r.left) / r.width  - 0.5;
      var py = (e.clientY - r.top)  / r.height - 0.5;
      tx =  px * MAX * 2;
      ty = -py * MAX * 2;
      tiltEl.classList.add('tilting');
      if(!raf) raf = requestAnimationFrame(apply);
    });
    tiltEl.addEventListener('pointerleave', function(){
      tiltEl.classList.remove('tilting');
      tiltEl.style.transform = '';
    });
  }

  /* ---------------------------------------------------------------------
     5. Magnetic buttons
     --------------------------------------------------------------------- */
  if(FINE_POINTER && !REDUCED){
    $$('.magnetic').forEach(function(btn){
      var STRENGTH = 0.22;
      btn.addEventListener('pointermove', function(e){
        var r = btn.getBoundingClientRect();
        var dx = e.clientX - (r.left + r.width / 2);
        var dy = e.clientY - (r.top + r.height / 2);
        btn.style.transform = 'translate(' + (dx * STRENGTH).toFixed(1) + 'px,' + (dy * STRENGTH).toFixed(1) + 'px)';
      });
      btn.addEventListener('pointerleave', function(){
        btn.style.transform = '';
      });
    });
  }

  /* ---------------------------------------------------------------------
     6. Bento spotlight (cursor-following radial glow)
     --------------------------------------------------------------------- */
  if(FINE_POINTER){
    var bento = $('.bento');
    if(bento){
      bento.addEventListener('pointermove', function(e){
        var card = e.target.closest ? e.target.closest('.bento-item') : null;
        if(!card) return;
        var r = card.getBoundingClientRect();
        card.style.setProperty('--mx', ((e.clientX - r.left) / r.width * 100).toFixed(1) + '%');
        card.style.setProperty('--my', ((e.clientY - r.top) / r.height * 100).toFixed(1) + '%');
      });
    }
  }
})();
