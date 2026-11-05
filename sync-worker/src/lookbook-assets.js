/** Inlined lookbook viewer assets served from R2 with each share. */
export const LOOKBOOK_STATIC_CSS = `/* Engineer lookbook — compact, report-first. */
:root {
  --lb-ink: #111827;
  --lb-muted: #6b7280;
  --lb-line: #d1d5db;
  --lb-bg: #f3f4f6;
  --lb-paper: #fff;
  --lb-accent: #07283d;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
  background: var(--lb-bg);
  color: var(--lb-ink);
  font: 14px/1.4 system-ui, -apple-system, Segoe UI, sans-serif;
}
.lb-top {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  justify-content: space-between;
  align-items: center;
  padding: 10px 14px;
  background: var(--lb-accent);
  color: #fff;
}
.lb-top__id {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.lb-top__id strong { font-size: 15px; }
.lb-top__id span { font-size: 12px; opacity: 0.85; }
.lb-top__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.lb-expiry { font-size: 12px; opacity: 0.85; }
.lb-btn {
  appearance: none;
  border: 1px solid rgba(255,255,255,0.45);
  background: transparent;
  color: #fff;
  border-radius: 4px;
  padding: 6px 10px;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.lb-btn:hover { background: rgba(255,255,255,0.12); }
.lb-tabs {
  display: flex;
  gap: 0;
  background: #fff;
  border-bottom: 1px solid var(--lb-line);
}
.lb-tab {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 10px 16px;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: var(--lb-muted);
  cursor: pointer;
  border-bottom: 2px solid transparent;
}
.lb-tab.is-on {
  color: var(--lb-accent);
  border-bottom-color: var(--lb-accent);
}
.lb-pane { padding: 14px; }
.lb-pane[hidden] { display: none !important; }
.lb-stage {
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
}
.lb-nav {
  display: flex;
  gap: 8px;
  align-items: center;
}
.lb-nav button {
  appearance: none;
  border: 1px solid var(--lb-line);
  background: #fff;
  border-radius: 4px;
  padding: 6px 10px;
  font: inherit;
  cursor: pointer;
}
.lb-nav button:disabled { opacity: 0.4; cursor: default; }
.lb-count { font-size: 13px; color: var(--lb-muted); }
.lb-sheet-frame {
  width: min(100%, 1100px);
  background: var(--lb-paper);
  border: 1px solid var(--lb-line);
  box-shadow: 0 8px 24px rgba(0,0,0,0.08);
  overflow: auto;
}
.lb-sheet-frame img {
  display: block;
  width: 100%;
  height: auto;
}
.lb-sheet-fallback {
  padding: 28px 24px;
  color: var(--lb-muted);
}
.lb-photo-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 10px;
}
.lb-photo {
  appearance: none;
  border: 1px solid var(--lb-line);
  background: #fff;
  padding: 0;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  text-align: left;
}
.lb-photo img {
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  background: #e5e7eb;
}
.lb-photo figcaption {
  padding: 6px 8px;
  font-size: 12px;
  color: var(--lb-muted);
}
.lb-viewer {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(7, 40, 61, 0.94);
  color: #fff;
  display: flex;
  flex-direction: column;
}
.lb-viewer[hidden] { display: none !important; }
.lb-viewer__bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
}
.lb-viewer__stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 0;
  padding: 8px;
}
.lb-viewer__stage img {
  max-width: calc(100vw - 96px);
  max-height: calc(100vh - 120px);
  object-fit: contain;
}
.lb-viewer__stage button,
.lb-viewer__bar button {
  appearance: none;
  border: 1px solid rgba(255,255,255,0.35);
  background: transparent;
  color: #fff;
  border-radius: 4px;
  padding: 8px 12px;
  font: inherit;
  cursor: pointer;
}
.lb-empty {
  padding: 24px;
  color: var(--lb-muted);
}
@media print {
  .lb-top__actions .lb-btn,
  .lb-tabs,
  .lb-nav,
  .lb-viewer { display: none !important; }
  body { background: #fff; }
  .lb-pane { padding: 0; }
  .lb-sheet-frame {
    box-shadow: none;
    border: 0;
    page-break-after: always;
    width: 100%;
  }
  .lb-photo-grid { grid-template-columns: repeat(2, 1fr); }
}
`;

export const LOOKBOOK_STATIC_JS = `(function () {
  'use strict';

  var dataEl = document.getElementById('lb-data');
  var data = {};
  try { data = JSON.parse(dataEl.textContent || '{}'); } catch (_) { data = {}; }

  var reportPane = document.getElementById('lb-report');
  var photosPane = document.getElementById('lb-photos');
  var viewer = document.getElementById('lb-viewer');
  var pageAt = 0;
  var pages = Array.isArray(data.pages) ? data.pages : [];
  var photos = Array.isArray(data.photos) ? data.photos : [];

  function showTab(name) {
    document.querySelectorAll('.lb-tab').forEach(function (tab) {
      tab.classList.toggle('is-on', tab.getAttribute('data-lb-tab') === name);
    });
    reportPane.hidden = name !== 'report';
    photosPane.hidden = name !== 'photos';
  }

  document.querySelectorAll('.lb-tab').forEach(function (tab) {
    tab.addEventListener('click', function () {
      showTab(tab.getAttribute('data-lb-tab'));
    });
  });

  function renderReport() {
    reportPane.innerHTML = '';
    if (!pages.length) {
      reportPane.innerHTML = '<p class="lb-empty">No report sheets were packaged with this lookbook. Photographs are still available on the Photographs tab. Use Save as PDF for a printable copy of what is here.</p>';
      return;
    }
    var stage = document.createElement('div');
    stage.className = 'lb-stage';
    var nav = document.createElement('div');
    nav.className = 'lb-nav';
    nav.innerHTML =
      '<button type="button" data-lb="prev">Previous</button>' +
      '<span class="lb-count" data-lb-count></span>' +
      '<button type="button" data-lb="next">Next</button>';
    var frame = document.createElement('div');
    frame.className = 'lb-sheet-frame';
    frame.setAttribute('data-lb-frame', '1');
    stage.appendChild(nav);
    stage.appendChild(frame);
    reportPane.appendChild(stage);

    function paint() {
      pageAt = Math.max(0, Math.min(pages.length - 1, pageAt));
      var page = pages[pageAt] || {};
      nav.querySelector('[data-lb-count]').textContent =
        (pageAt + 1) + ' of ' + pages.length + (page.title ? ' — ' + page.title : '');
      nav.querySelector('[data-lb="prev"]').disabled = pageAt === 0;
      nav.querySelector('[data-lb="next"]').disabled = pageAt >= pages.length - 1;
      frame.innerHTML = '';
      if (page.still) {
        var img = document.createElement('img');
        img.src = page.still;
        img.alt = page.title || ('Sheet ' + (pageAt + 1));
        frame.appendChild(img);
      } else {
        var fallback = document.createElement('div');
        fallback.className = 'lb-sheet-fallback';
        fallback.innerHTML =
          '<strong>' + escapeHtml(page.title || ('Sheet ' + (pageAt + 1))) + '</strong>' +
          '<p>This sheet was not captured as an image. Open Photographs for the field pictures, or use the PDF hardcopy that was emailed with this link.</p>';
        frame.appendChild(fallback);
      }
    }

    nav.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-lb]');
      if (!btn) return;
      if (btn.getAttribute('data-lb') === 'prev') pageAt -= 1;
      if (btn.getAttribute('data-lb') === 'next') pageAt += 1;
      paint();
    });
    paint();
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function renderPhotos() {
    photosPane.innerHTML = '';
    if (!photos.length) {
      photosPane.innerHTML = '<p class="lb-empty">No photographs were packaged with this lookbook.</p>';
      return;
    }
    var grid = document.createElement('div');
    grid.className = 'lb-photo-grid';
    photos.forEach(function (photo, index) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'lb-photo';
      btn.innerHTML =
        '<img src="' + escapeHtml(photo.src) + '" alt="">' +
        '<figcaption>' + escapeHtml(photo.title || ('Photo ' + (index + 1))) + '</figcaption>';
      btn.addEventListener('click', function () { openViewer(index); });
      grid.appendChild(btn);
    });
    photosPane.appendChild(grid);
  }

  var viewerIndex = 0;
  function openViewer(index) {
    viewerIndex = index;
    viewer.hidden = false;
    viewer.innerHTML =
      '<div class="lb-viewer__bar">' +
      '  <span data-lb-vtitle></span>' +
      '  <button type="button" data-lb-vclose>Close</button>' +
      '</div>' +
      '<div class="lb-viewer__stage">' +
      '  <button type="button" data-lb-vprev aria-label="Previous">‹</button>' +
      '  <img data-lb-vimg alt="">' +
      '  <button type="button" data-lb-vnext aria-label="Next">›</button>' +
      '</div>';
    paintViewer();
    viewer.querySelector('[data-lb-vclose]').addEventListener('click', closeViewer);
    viewer.querySelector('[data-lb-vprev]').addEventListener('click', function () {
      viewerIndex = (viewerIndex - 1 + photos.length) % photos.length;
      paintViewer();
    });
    viewer.querySelector('[data-lb-vnext]').addEventListener('click', function () {
      viewerIndex = (viewerIndex + 1) % photos.length;
      paintViewer();
    });
  }

  function paintViewer() {
    var photo = photos[viewerIndex] || {};
    viewer.querySelector('[data-lb-vtitle]').textContent =
      (photo.title || 'Photograph') + ' (' + (viewerIndex + 1) + ' of ' + photos.length + ')';
    viewer.querySelector('[data-lb-vimg]').src = photo.src || '';
  }

  function closeViewer() {
    viewer.hidden = true;
    viewer.innerHTML = '';
  }

  document.getElementById('lb-print').addEventListener('click', function () {
    closeViewer();
    showTab('report');
    // Print every sheet, not only the one on screen — Save as PDF is the
    // hardcopy path from this temporary lookbook.
    if (pages.length) {
      reportPane.innerHTML = '';
      pages.forEach(function (page, index) {
        var frame = document.createElement('div');
        frame.className = 'lb-sheet-frame lb-sheet-frame--print';
        if (page.still) {
          var img = document.createElement('img');
          img.src = page.still;
          img.alt = page.title || ('Sheet ' + (index + 1));
          frame.appendChild(img);
        } else {
          var fallback = document.createElement('div');
          fallback.className = 'lb-sheet-fallback';
          fallback.innerHTML =
            '<strong>' + escapeHtml(page.title || ('Sheet ' + (index + 1))) + '</strong>' +
            '<p>This sheet was not captured as an image. Use the PDF hardcopy emailed with this link, or open Photographs.</p>';
          frame.appendChild(fallback);
        }
        reportPane.appendChild(frame);
      });
      window.addEventListener('afterprint', function () { renderReport(); }, { once: true });
    }
    window.print();
  });

  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && !viewer.hidden) closeViewer();
  });

  renderReport();
  renderPhotos();
})();
`;
