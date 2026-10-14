/* Gx404 decorative background. No application state, requests or storage. */
(() => {
  'use strict';
  const canvas = document.createElement('canvas');
  canvas.id = 'gx-fluid';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let engine, timer, seeded = false, active = null, lost = false;
  const allowed = () => !motion.matches && !document.hidden && !lost;
  const stop = () => { clearTimeout(timer); timer = null; if (active !== null) engine?.end(active); active = null; };
  function seed() {
    if (seeded || !engine || !allowed()) return;
    seeded = true;
    let i = 0;
    function splash() {
      if (!allowed()) return;
      const x = (0.08 + Math.random() * 0.84) * innerWidth;
      const y = (0.12 + Math.random() * 0.76) * innerHeight;
      engine.start(-100, x, y); engine.end(-100);
      if (++i < (innerWidth < 600 ? 3 : 4)) timer = setTimeout(splash, 180);
    }
    splash();
  }
  function sync(resume = false) {
    if (!allowed()) { stop(); engine?.setPaused(true); return; }
    if (!engine) {
      try { engine = window.createGX404Fluid(canvas); }
      catch { canvas.hidden = true; return; }
    }
    engine.setPaused(false);
    if (resume) {
      engine.resize();
      engine.wake?.();
    }
    seed();
  }
  const interactive = 'a,button,input,select,textarea,[contenteditable],label,[role="button"],x-peer,x-dialog,header,footer,.subscription-card,.subscription-row,.overview';
  window.addEventListener('pointerdown', e => {
    if (!engine || !allowed() || e.target.closest(interactive)) return;
    stop(); seeded = true; active = e.pointerId;
    engine.start(active, e.clientX, e.clientY);
  }, { passive: true });
  window.addEventListener('pointermove', e => {
    if (active === e.pointerId && allowed()) engine.move(active, e.clientX, e.clientY);
  }, { passive: true });
  for (const type of ['pointerup', 'pointercancel']) window.addEventListener(type, e => {
    if (engine && active === e.pointerId) engine.end(active);
    active = null;
  }, { passive: true });
  window.addEventListener('resize', () => engine?.resize(), { passive: true });
  document.addEventListener('visibilitychange', () => sync(!document.hidden));
  motion.addEventListener('change', () => sync(true));
  canvas.addEventListener('webglcontextlost', () => { lost = true; stop(); engine?.setPaused(true); canvas.hidden = true; });
  window.addEventListener('pagehide', () => { stop(); engine?.setPaused(true); });
  window.addEventListener('pageshow', () => sync(true));
  window.addEventListener('focus', () => sync(true));
  window.addEventListener('blur', stop);
  sync();
})();
