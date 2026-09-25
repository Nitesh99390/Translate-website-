/* Reading studio interactions. File parsing remains in app.js. */
(function () {
  'use strict';
  const zone = document.getElementById('dropZone');
  const input = document.getElementById('epubFile');
  if (zone && input) {
    zone.addEventListener('click', (event) => {
      if (event.target !== input) input.click();
    });
    zone.addEventListener('keydown', (event) => {
      if (event.target === zone && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
        input.click();
      }
    });
  }
  // Links into the landing page also work while a book is open.
  document.querySelectorAll('[data-home-anchor]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const target = document.querySelector(link.getAttribute('href'));
      if (!target || !window.DTV) return;
      event.preventDefault();
      window.DTV.showHero();
      if (window.DTV.running) return;
      target.scrollIntoView({ block: 'start' });
      const focusTarget = target.querySelector('summary, button, a');
      focusTarget?.focus({ preventScroll: true });
    });
  });
  document.getElementById('studioSearch')?.addEventListener('click', () => {
    document.getElementById('cmdBtn')?.click();
  });
  document.getElementById('libraryNav')?.addEventListener('click', (event) => {
    if (!window.DTV) return;
    event.preventDefault();
    window.DTV.showHero();
    if (window.DTV.running) return;
    document.getElementById('libraryWrap')?.scrollIntoView({ block: 'center' });
    document.getElementById('libraryRefresh')?.focus({ preventScroll: true });
  });
})();
