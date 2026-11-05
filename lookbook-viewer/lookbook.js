(function () {
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
