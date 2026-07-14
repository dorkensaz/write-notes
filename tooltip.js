// Hover-guide tooltips, positioned in JS so they clamp to this window's real
// bounds instead of overflowing past a frameless window's edge (CSS ::after
// with left:50% has no way to know it's about to run off a 360px-wide window).
(function () {
  let tipEl = null;
  let showTimer = null;

  function ensureTip() {
    if (tipEl) return tipEl;
    tipEl = document.createElement('div');
    tipEl.id = '__tip';
    document.body.appendChild(tipEl);
    return tipEl;
  }

  function positionTip(el, anchorRect) {
    el.classList.add('show');
    const tw = el.offsetWidth, th = el.offsetHeight;
    let left = anchorRect.left + anchorRect.width / 2 - tw / 2;
    left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
    let top = anchorRect.top - th - 8;
    if (top < 8) top = anchorRect.bottom + 8; // flip below if no room above
    top = Math.max(8, Math.min(top, window.innerHeight - th - 8));
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  }

  function hideTip() {
    clearTimeout(showTimer);
    if (tipEl) tipEl.classList.remove('show');
  }

  document.addEventListener('mouseover', e => {
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      const el = ensureTip();
      el.textContent = target.getAttribute('data-tip');
      positionTip(el, target.getBoundingClientRect());
    }, 400);
  });

  document.addEventListener('mouseout', e => {
    if (e.target.closest('[data-tip]')) hideTip();
  });
  document.addEventListener('mousedown', hideTip);
  window.addEventListener('blur', hideTip);
})();
