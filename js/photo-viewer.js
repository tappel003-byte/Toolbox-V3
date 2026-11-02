// Toolbox — shared read-only Customer File photo viewer.
//
// Full-size local pictures only. Prev/next, zoom/pan, Close/Escape.
// Does not write photos, captions, order, layout, or checkout state.

(function () {
  'use strict';

  var active = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  function close() {
    if (!active) return;
    var session = active;
    active = null;
    document.removeEventListener('keydown', session.onKey, true);
    if (session.box && session.box.parentNode) session.box.parentNode.removeChild(session.box);
    if (typeof session.onClose === 'function') {
      try { session.onClose(); } catch (_) {}
    }
  }

  function isOpen() {
    return !!active;
  }

  /**
   * Open the viewer.
   *
   * items: [{ id, title, caption, src?, getSrc? }]
   *   src — data URL or blob URL already known
   *   getSrc — optional () => Promise<string|null> for lazy local resolve
   * options: { index, onClose }
   */
  function open(items, options) {
    close();
    var list = Array.isArray(items) ? items.filter(Boolean) : [];
    if (!list.length) return null;
    var opts = options || {};
    var index = clamp(Number(opts.index) || 0, 0, list.length - 1);

    var box = document.createElement('div');
    box.className = 'tb-photo-viewer';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Photograph viewer');
    box.innerHTML =
      '<div class="tb-photo-viewer__bar">' +
      '  <p class="tb-photo-viewer__title" data-pv-title></p>' +
      '  <button type="button" class="btn btn--ghost" data-pv-close>Close</button>' +
      '</div>' +
      '<p class="tb-photo-viewer__caption" data-pv-caption></p>' +
      '<div class="tb-photo-viewer__stage" data-pv-stage>' +
      '  <button type="button" class="tb-photo-viewer__step" data-pv-prev aria-label="Previous picture">\u2039</button>' +
      '  <div class="tb-photo-viewer__frame" data-pv-frame>' +
      '    <img class="tb-photo-viewer__img" data-pv-img alt="">' +
      '    <p class="tb-photo-viewer__missing" data-pv-missing hidden>Photo not on this device</p>' +
      '  </div>' +
      '  <button type="button" class="tb-photo-viewer__step" data-pv-next aria-label="Next picture">\u203a</button>' +
      '</div>' +
      '<div class="tb-photo-viewer__tools">' +
      '  <button type="button" class="btn btn--secondary" data-pv-zoom-out aria-label="Zoom out">\u2212</button>' +
      '  <button type="button" class="btn btn--secondary" data-pv-zoom-reset>Fit</button>' +
      '  <button type="button" class="btn btn--secondary" data-pv-zoom-in aria-label="Zoom in">+</button>' +
      '  <span class="tb-photo-viewer__count" data-pv-count></span>' +
      '</div>';

    var titleEl = box.querySelector('[data-pv-title]');
    var captionEl = box.querySelector('[data-pv-caption]');
    var img = box.querySelector('[data-pv-img]');
    var missingEl = box.querySelector('[data-pv-missing]');
    var frame = box.querySelector('[data-pv-frame]');
    var prevBtn = box.querySelector('[data-pv-prev]');
    var nextBtn = box.querySelector('[data-pv-next]');
    var countEl = box.querySelector('[data-pv-count]');

    var scale = 1;
    var tx = 0;
    var ty = 0;
    var drag = null;
    var pointers = new Map();
    var pinchStart = null;
    var loadToken = 0;

    function applyTransform() {
      img.style.transform = 'translate(' + tx + 'px,' + ty + 'px) scale(' + scale + ')';
      frame.classList.toggle('is-zoomed', scale > 1.01);
    }

    function resetView() {
      scale = 1;
      tx = 0;
      ty = 0;
      applyTransform();
    }

    function zoomBy(factor, cx, cy) {
      var rect = frame.getBoundingClientRect();
      var midX = cx != null ? cx : rect.left + rect.width / 2;
      var midY = cy != null ? cy : rect.top + rect.height / 2;
      var localX = midX - rect.left - rect.width / 2;
      var localY = midY - rect.top - rect.height / 2;
      var next = clamp(scale * factor, 1, 8);
      if (next === scale) return;
      var ratio = next / scale;
      tx = localX - (localX - tx) * ratio;
      ty = localY - (localY - ty) * ratio;
      scale = next;
      if (scale <= 1.01) {
        scale = 1;
        tx = 0;
        ty = 0;
      }
      applyTransform();
    }

    function show(nextIndex) {
      if (nextIndex < 0 || nextIndex >= list.length) return;
      index = nextIndex;
      var item = list[index];
      var number = item.title || item.numberLabel || 'Photograph';
      titleEl.textContent = number;
      captionEl.textContent = item.caption ? String(item.caption) : '';
      captionEl.hidden = !item.caption;
      countEl.textContent = (index + 1) + ' of ' + list.length;
      prevBtn.disabled = index === 0;
      nextBtn.disabled = index === list.length - 1;
      resetView();
      img.removeAttribute('src');
      img.hidden = true;
      missingEl.hidden = true;
      box.classList.add('is-loading');
      var token = ++loadToken;

      function paint(src) {
        if (!active || active.box !== box || token !== loadToken) return;
        box.classList.remove('is-loading');
        if (typeof src === 'string' && src.indexOf('data:image/') === 0) {
          img.src = src;
          img.alt = number;
          img.hidden = false;
          missingEl.hidden = true;
        } else if (typeof src === 'string' && /^blob:|^https?:|^\/|^data:/i.test(src)) {
          img.src = src;
          img.alt = number;
          img.hidden = false;
          missingEl.hidden = true;
        } else {
          img.hidden = true;
          missingEl.hidden = false;
        }
      }

      if (item.missing) {
        paint(null);
        return;
      }
      if (typeof item.src === 'string' && item.src) {
        paint(item.src);
        return;
      }
      if (typeof item.getSrc === 'function') {
        Promise.resolve()
          .then(function () { return item.getSrc(); })
          .then(function (src) { paint(src); })
          .catch(function () { paint(null); });
        return;
      }
      paint(null);
    }

    function onKey(event) {
      if (!active || active.box !== box) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        show(index - 1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        show(index + 1);
      } else if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        zoomBy(1.2);
      } else if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        zoomBy(1 / 1.2);
      } else if (event.key === '0') {
        event.preventDefault();
        resetView();
      }
    }

    box.querySelector('[data-pv-close]').addEventListener('click', close);
    prevBtn.addEventListener('click', function () { show(index - 1); });
    nextBtn.addEventListener('click', function () { show(index + 1); });
    box.querySelector('[data-pv-zoom-in]').addEventListener('click', function () { zoomBy(1.25); });
    box.querySelector('[data-pv-zoom-out]').addEventListener('click', function () { zoomBy(1 / 1.25); });
    box.querySelector('[data-pv-zoom-reset]').addEventListener('click', resetView);

    frame.addEventListener('wheel', function (event) {
      event.preventDefault();
      zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
    }, { passive: false });

    frame.addEventListener('pointerdown', function (event) {
      frame.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        var pts = Array.from(pointers.values());
        var dx = pts[0].x - pts[1].x;
        var dy = pts[0].y - pts[1].y;
        pinchStart = {
          dist: Math.max(1, Math.hypot(dx, dy)),
          scale: scale,
        };
        drag = null;
      } else if (scale > 1.01) {
        drag = { x: event.clientX, y: event.clientY, tx: tx, ty: ty };
      }
    });
    frame.addEventListener('pointermove', function (event) {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2 && pinchStart) {
        var pts = Array.from(pointers.values());
        var dx = pts[0].x - pts[1].x;
        var dy = pts[0].y - pts[1].y;
        var dist = Math.max(1, Math.hypot(dx, dy));
        var next = clamp(pinchStart.scale * (dist / pinchStart.dist), 1, 8);
        scale = next;
        if (scale <= 1.01) {
          scale = 1;
          tx = 0;
          ty = 0;
        }
        applyTransform();
        return;
      }
      if (!drag || scale <= 1.01) return;
      tx = drag.tx + (event.clientX - drag.x);
      ty = drag.ty + (event.clientY - drag.y);
      applyTransform();
    });
    function endPointer(event) {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (pointers.size === 0) drag = null;
    }
    frame.addEventListener('pointerup', endPointer);
    frame.addEventListener('pointercancel', endPointer);

    box.addEventListener('click', function (event) {
      if (event.target === box) close();
    });

    document.body.appendChild(box);
    active = { box: box, onKey: onKey, onClose: opts.onClose || null };
    document.addEventListener('keydown', onKey, true);
    show(index);
    box.querySelector('[data-pv-close]').focus();
    return { close: close, show: show };
  }

  window.ToolboxPhotoViewer = {
    open: open,
    close: close,
    isOpen: isOpen,
  };
})();
