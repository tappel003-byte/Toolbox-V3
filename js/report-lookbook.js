// Toolbox — Report Builder engineer lookbook packager.
//
// Builds a read-only lookbook package (sheet stills + photographs) that can:
//   1. Upload to the Sync Worker as a 30-day tokenized link
//   2. Download as a self-contained ZIP that keeps working offline forever
//
// Not a Customer File editor. PDF hardcopy remains the durable emailed deliverable;
// Save as PDF inside the lookbook uses the browser print dialog.

(function () {
  'use strict';

  var VIEWER_CSS_URL = '/lookbook-viewer/lookbook.css';
  var VIEWER_JS_URL = '/lookbook-viewer/lookbook.js';
  var STILL_MAX_W = 1400;
  var STILL_JPEG_Q = 0.82;
  var PHOTO_JPEG_Q = 0.88;

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function slugPart(value) {
    var text = trim(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    return text.slice(0, 40) || 'report';
  }

  function lookbookIndexHtml(meta) {
    var title = escapeHtml(meta.title || 'Report lookbook');
    var residence = escapeHtml(meta.residence || '');
    var address = escapeHtml(meta.address || '');
    var expiresLabel = meta.expiresAt
      ? escapeHtml(String(meta.expiresAt).slice(0, 10))
      : 'kept on this computer';
    var payload = JSON.stringify({
      title: meta.title || 'Report lookbook',
      residence: meta.residence || '',
      address: meta.address || '',
      expiresAt: meta.expiresAt || '',
      pages: meta.pages || [],
      photos: meta.photos || [],
    }).replace(/</g, '\\u003c');

    return '<!doctype html>\n' +
      '<html lang="en">\n' +
      '<head>\n' +
      '<meta charset="utf-8">\n' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
      '<title>' + title + '</title>\n' +
      '<link rel="stylesheet" href="lookbook.css">\n' +
      '</head>\n' +
      '<body>\n' +
      '<header class="lb-top">\n' +
      '  <div class="lb-top__id">\n' +
      '    <strong>' + title + '</strong>\n' +
      '    <span>' + residence + (address ? ' · ' + address : '') + '</span>\n' +
      '  </div>\n' +
      '  <div class="lb-top__actions">\n' +
      '    <span class="lb-expiry">' +
      (meta.expiresAt ? ('Available until ' + expiresLabel) : 'Saved lookbook — works offline on this computer') +
      '</span>\n' +
      '    <button type="button" id="lb-print" class="lb-btn">Save as PDF</button>\n' +
      '  </div>\n' +
      '</header>\n' +
      '<nav class="lb-tabs" role="tablist">\n' +
      '  <button type="button" class="lb-tab is-on" data-lb-tab="report">Report</button>\n' +
      '  <button type="button" class="lb-tab" data-lb-tab="photos">Photographs</button>\n' +
      '</nav>\n' +
      '<main id="lb-report" class="lb-pane is-on"></main>\n' +
      '<main id="lb-photos" class="lb-pane" hidden></main>\n' +
      '<div id="lb-viewer" class="lb-viewer" hidden></div>\n' +
      '<script type="application/json" id="lb-data">' + payload + '</script>\n' +
      '<script src="lookbook.js"></script>\n' +
      '</body>\n' +
      '</html>\n';
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function dataUrlToBlob(dataUrl) {
    if (typeof fetch !== 'function') return Promise.resolve(null);
    return fetch(dataUrl).then(function (res) { return res.blob(); }).catch(function () { return null; });
  }

  function fetchText(url) {
    return fetch(url, { cache: 'no-store' }).then(function (res) {
      if (!res.ok) throw new Error('Could not load ' + url);
      return res.text();
    });
  }

  function replaceCanvasesWithImages(root) {
    [].slice.call(root.querySelectorAll('canvas')).forEach(function (cv) {
      if (!cv.width || !cv.height) return;
      var url = '';
      try { url = cv.toDataURL('image/jpeg', 0.88); } catch (_) { return; }
      if (!url) return;
      var img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.style.width = (cv.style.width || cv.width + 'px');
      img.style.height = (cv.style.height || cv.height + 'px');
      img.className = cv.className || '';
      if (cv.parentNode) cv.parentNode.replaceChild(img, cv);
    });
  }

  function waitImages(root) {
    var imgs = [].slice.call(root.querySelectorAll('img'));
    return Promise.all(imgs.map(function (img) {
      if (img.complete && img.naturalWidth > 0) return Promise.resolve();
      return new Promise(function (resolve) {
        var done = function () { resolve(); };
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', done, { once: true });
        setTimeout(done, 2500);
      });
    }));
  }

  /**
   * Rasterize one print paper into a JPEG data URL.
   * Uses SVG foreignObject + inlined report-builder CSS. Failures return ''.
   */
  function capturePaperStill(paper, cssText) {
    replaceCanvasesWithImages(paper);
    return waitImages(paper).then(function () {
      var w = Math.max(1, Math.round(paper.offsetWidth || paper.scrollWidth || 1632));
      var h = Math.max(1, Math.round(paper.offsetHeight || paper.scrollHeight || 1056));
      var scale = Math.min(1, STILL_MAX_W / w);
      var outW = Math.max(1, Math.round(w * scale));
      var outH = Math.max(1, Math.round(h * scale));
      var clone = paper.cloneNode(true);
      clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
      var serializer = new XMLSerializer();
      var bodyHtml;
      try {
        bodyHtml = serializer.serializeToString(clone);
      } catch (_) {
        return '';
      }
      // Strip scripts; keep markup + styles.
      bodyHtml = bodyHtml.replace(/<script[\s\S]*?<\/script>/gi, '');
      var svg =
        '<svg xmlns="http://www.w3.org/2000/svg" width="' + outW + '" height="' + outH + '">' +
        '<foreignObject width="100%" height="100%" x="0" y="0">' +
        '<div xmlns="http://www.w3.org/1999/xhtml" style="width:' + w + 'px;height:' + h +
        'px;transform:scale(' + scale + ');transform-origin:0 0;background:#fff;">' +
        '<style>' + String(cssText || '').replace(/<\/style/gi, '<\\/style') + '</style>' +
        bodyHtml +
        '</div></foreignObject></svg>';
      var svgUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
      return new Promise(function (resolve) {
        var img = new Image();
        img.onload = function () {
          try {
            var canvas = document.createElement('canvas');
            canvas.width = outW;
            canvas.height = outH;
            var ctx = canvas.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, outW, outH);
            ctx.drawImage(img, 0, 0, outW, outH);
            resolve(canvas.toDataURL('image/jpeg', STILL_JPEG_Q));
          } catch (_) {
            resolve('');
          }
        };
        img.onerror = function () { resolve(''); };
        img.src = svgUrl;
      });
    });
  }

  function collectPhotoEntries(record, pages) {
    var byKey = Object.create(null);
    var list = [];

    function add(entry) {
      if (!entry) return;
      var key = entry.id || entry.key || (entry.dataUrl && entry.dataUrl.slice(0, 64));
      if (!key) return;
      if (byKey[key]) {
        if (!byKey[key].dataUrl && entry.dataUrl) byKey[key].dataUrl = entry.dataUrl;
        return;
      }
      var row = {
        id: entry.id || entry.key || ('photo-' + list.length),
        title: entry.title || ('Photo ' + (entry.displayNumber || (list.length + 1))),
        dataUrl: entry.dataUrl || '',
        mediaId: entry.id || entry.mediaId || '',
      };
      byKey[key] = row;
      list.push(row);
    }

    (pages || []).forEach(function (page) {
      if (!page || page.type !== 'pictures') return;
      var captions = (page.reportText && page.reportText.captions) || {};
      var photos = (page.evidence && Array.isArray(page.evidence.photos))
        ? page.evidence.photos
        : [];
      photos.forEach(function (photo) {
        if (!photo) return;
        var key = photo.key || photo.id || '';
        var caption = typeof captions[key] === 'string' ? captions[key] : '';
        add({
          id: key || photo.id,
          key: key,
          title: caption || ('Photo ' + (photo.displayNumber || '')),
          displayNumber: photo.displayNumber,
          dataUrl: photo.dataUrl,
        });
      });
    });

    if (window.ToolboxReportEvidence &&
        typeof window.ToolboxReportEvidence.listDistressPhotos === 'function') {
      (window.ToolboxReportEvidence.listDistressPhotos(record) || []).forEach(function (photo) {
        add({
          id: photo.id || photo.key || ('distress-' + photo.displayNumber),
          key: photo.key,
          title: 'Photo ' + (photo.displayNumber || ''),
          displayNumber: photo.displayNumber,
          dataUrl: photo.dataUrl,
        });
      });
    }

    return list;
  }

  async function hydratePhotoBytes(list) {
    if (!Array.isArray(list) || !list.length) return list;
    var getMedia = window.ToolboxDB && typeof window.ToolboxDB.getMedia === 'function'
      ? window.ToolboxDB.getMedia.bind(window.ToolboxDB)
      : null;
    for (var i = 0; i < list.length; i += 1) {
      var photo = list[i];
      if (photo.dataUrl && photo.dataUrl.indexOf('data:image/') === 0) continue;
      if (!photo.mediaId || !getMedia) continue;
      try {
        var url = await getMedia(photo.mediaId);
        if (url && String(url).indexOf('data:image/') === 0) photo.dataUrl = url;
      } catch (_) {}
    }
    return list;
  }

  function packageName(meta) {
    var day = new Date().toISOString().slice(0, 10);
    return 'Lookbook-' + slugPart(meta.residence || meta.title) + '-' + day;
  }

  /**
   * @param {object} options
   * @param {HTMLElement} options.printDeck - settled print deck in the document
   * @param {object[]} options.pages - report page models matching deck order
   * @param {object} options.record - Customer File record
   * @param {string} [options.title]
   * @param {function} [options.onProgress]
   */
  async function buildPackage(options) {
    var opts = options || {};
    var deck = opts.printDeck;
    if (!deck) throw new Error('Print deck is required to package a lookbook.');
    var record = opts.record || {};
    var pageModels = Array.isArray(opts.pages) ? opts.pages : [];
    var progress = typeof opts.onProgress === 'function' ? opts.onProgress : function () {};

    progress('Loading lookbook viewer…');
    var cssText = '';
    try {
      cssText = await fetchText('/css/report-builder.css');
    } catch (_) {
      cssText = '';
    }
    var viewerCss = await fetchText(VIEWER_CSS_URL);
    var viewerJs = await fetchText(VIEWER_JS_URL);

    var papers = [].slice.call(deck.querySelectorAll('.rb-print__page'));
    var files = [];
    var pageEntries = [];

    progress('Capturing report sheets…');
    for (var i = 0; i < papers.length; i += 1) {
      progress('Capturing sheet ' + (i + 1) + ' of ' + papers.length + '…');
      var still = await capturePaperStill(papers[i], cssText);
      var title = (pageModels[i] && (pageModels[i].railLabel || pageModels[i].title)) ||
        ('Sheet ' + (i + 1));
      var stillPath = '';
      if (still && still.indexOf('data:image/') === 0) {
        stillPath = 'sheets/sheet-' + pad2(i + 1) + '.jpg';
        var stillBlob = await dataUrlToBlob(still);
        if (stillBlob) {
          files.push({ path: stillPath, blob: stillBlob, contentType: 'image/jpeg' });
        } else {
          stillPath = '';
        }
      }
      pageEntries.push({
        title: title,
        still: stillPath,
      });
    }

    progress('Collecting photographs…');
    var photos = await hydratePhotoBytes(collectPhotoEntries(record, pageModels));

    var photoEntries = [];
    for (var j = 0; j < photos.length; j += 1) {
      var photo = photos[j];
      if (!photo.dataUrl || photo.dataUrl.indexOf('data:image/') !== 0) continue;
      progress('Packaging photograph ' + (j + 1) + ' of ' + photos.length + '…');
      var ext = /data:image\/png/i.test(photo.dataUrl) ? 'png' : 'jpg';
      var photoPath = 'photos/photo-' + pad2(j + 1) + '.' + ext;
      var photoBlob = await dataUrlToBlob(photo.dataUrl);
      if (!photoBlob) continue;
      // Re-encode large PNG photos lightly to JPEG when useful.
      if (ext === 'png' && photoBlob.size > 900000) {
        try {
          var img = await loadImage(photo.dataUrl);
          var canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth;
          canvas.height = img.naturalHeight;
          canvas.getContext('2d').drawImage(img, 0, 0);
          var jpegUrl = canvas.toDataURL('image/jpeg', PHOTO_JPEG_Q);
          var jpegBlob = await dataUrlToBlob(jpegUrl);
          if (jpegBlob && jpegBlob.size < photoBlob.size) {
            photoBlob = jpegBlob;
            photoPath = 'photos/photo-' + pad2(j + 1) + '.jpg';
            ext = 'jpg';
          }
        } catch (_) {}
      }
      files.push({
        path: photoPath,
        blob: photoBlob,
        contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      });
      photoEntries.push({
        title: photo.title || ('Photo ' + (j + 1)),
        src: photoPath,
      });
    }

    var identity = {
      title: trim(opts.title) || 'Report lookbook',
      residence: trim(opts.residence) || trim(record.firstName + ' ' + record.lastName) || '',
      address: trim(opts.address) || trim(record.propertyAddress) || '',
      customerFileId: record.id || '',
    };

    var localMeta = {
      title: identity.title,
      residence: identity.residence,
      address: identity.address,
      expiresAt: '',
      pages: pageEntries,
      photos: photoEntries,
    };

    files.push({
      path: 'lookbook.css',
      text: viewerCss,
      contentType: 'text/css; charset=utf-8',
    });
    files.push({
      path: 'lookbook.js',
      text: viewerJs,
      contentType: 'application/javascript; charset=utf-8',
    });
    files.push({
      path: 'index.html',
      text: lookbookIndexHtml(localMeta),
      contentType: 'text/html; charset=utf-8',
    });

    return {
      identity: identity,
      pages: pageEntries,
      photos: photoEntries,
      files: files,
      baseName: packageName(identity),
    };
  }

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('image load failed')); };
      img.src = src;
    });
  }

  async function downloadZip(pkg) {
    if (!window.JSZip || typeof window.JSZip !== 'function') {
      throw new Error('ZIP support is not available in this session.');
    }
    var zip = new window.JSZip();
    var folder = zip.folder(pkg.baseName) || zip;
    for (var i = 0; i < pkg.files.length; i += 1) {
      var file = pkg.files[i];
      if (file.blob) folder.file(file.path, file.blob, { binary: true });
      else folder.file(file.path, file.text || '');
    }
    var blob = await zip.generateAsync({ type: 'blob' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = pkg.baseName + '.zip';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return { filename: pkg.baseName + '.zip', bytes: blob.size };
  }

  async function publishOnline(pkg, options) {
    var sync = window.ToolboxSync;
    if (!sync || typeof sync.createLookbook !== 'function') {
      throw new Error('Sync is not available for lookbook sharing.');
    }
    if (!sync.syncApiBase || !sync.syncApiBase()) {
      throw new Error('Sync is not configured yet.');
    }
    var progress = options && typeof options.onProgress === 'function'
      ? options.onProgress
      : function () {};

    progress('Creating lookbook link…');
    var created = await sync.createLookbook({
      customerFileId: pkg.identity.customerFileId,
      title: pkg.identity.title,
      residence: pkg.identity.residence,
      address: pkg.identity.address,
    });
    var token = created && created.token;
    if (!token) throw new Error('Lookbook create did not return a token.');

    // Upload media files only (viewer assets + index written on finalize).
    var uploads = pkg.files.filter(function (file) {
      return file.path !== 'index.html' &&
        file.path !== 'lookbook.css' &&
        file.path !== 'lookbook.js';
    });
    for (var i = 0; i < uploads.length; i += 1) {
      var file = uploads[i];
      progress('Uploading ' + (i + 1) + ' of ' + uploads.length + '…');
      var body = file.blob;
      if (!body && file.text != null) {
        body = new Blob([file.text], { type: file.contentType || 'text/plain' });
      }
      await sync.uploadLookbookFile(token, file.path, body, file.contentType);
    }

    progress('Finalizing lookbook…');
    var finalized = await sync.finalizeLookbook(token, {
      title: pkg.identity.title,
      residence: pkg.identity.residence,
      address: pkg.identity.address,
      pages: pkg.pages,
      photos: pkg.photos,
    });

    return {
      token: token,
      url: (finalized && finalized.url) || (created && created.url) || '',
      expiresAt: (finalized && finalized.expiresAt) || (created && created.expiresAt) || '',
      ttlDays: 30,
      pageCount: pkg.pages.length,
      photoCount: pkg.photos.length,
    };
  }

  // --- Share dialog -------------------------------------------------------

  function ensureDialogCss() {
    if (document.getElementById('rb-lookbook-style')) return;
    var style = document.createElement('style');
    style.id = 'rb-lookbook-style';
    style.textContent =
      '.rb-lookbook-dialog{position:fixed;inset:0;z-index:80;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(7,40,61,.55)}' +
      '.rb-lookbook-dialog[hidden]{display:none!important}' +
      '.rb-lookbook-card{width:min(520px,100%);background:#fff;border-radius:8px;box-shadow:0 18px 48px rgba(0,0,0,.28);padding:18px 18px 16px;color:#111827}' +
      '.rb-lookbook-card h2{margin:0 0 6px;font-size:18px}' +
      '.rb-lookbook-card p{margin:0 0 10px;font-size:13px;line-height:1.45;color:#4b5563}' +
      '.rb-lookbook-card label{display:block;font-size:12px;font-weight:600;margin:10px 0 4px}' +
      '.rb-lookbook-card input[type=text]{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:4px;font:inherit}' +
      '.rb-lookbook-actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}' +
      '.rb-lookbook-actions .btn{min-height:34px}' +
      '.rb-lookbook-status{min-height:1.2em;margin:8px 0 0;font-size:12px;color:#374151}' +
      '.rb-lookbook-linkrow{display:flex;gap:8px;align-items:stretch;margin-top:8px}' +
      '.rb-lookbook-linkrow input{flex:1 1 auto}' +
      '.rb-lookbook-expiry{font-size:12px;color:#6b7280;margin-top:6px}';
    document.head.appendChild(style);
  }

  function closeDialog(root) {
    if (root && root.parentNode) root.parentNode.removeChild(root);
  }

  function openResultDialog(result) {
    ensureDialogCss();
    closeDialog(document.querySelector('.rb-lookbook-dialog'));
    var root = document.createElement('div');
    root.className = 'rb-lookbook-dialog';
    root.innerHTML =
      '<div class="rb-lookbook-card" role="dialog" aria-modal="true" aria-label="Lookbook ready">' +
      '  <h2>Lookbook ready</h2>' +
      '  <p>Send the PDF hardcopy as usual. The link lets an engineer browse the report and open photographs full screen for 30 days. The downloaded ZIP keeps working on their computer with no expiry.</p>' +
      (result.url
        ? ('  <label for="rb-lookbook-url">30-day link</label>' +
           '  <div class="rb-lookbook-linkrow">' +
           '    <input id="rb-lookbook-url" type="text" readonly value="' + escapeHtml(result.url) + '">' +
           '    <button type="button" class="btn btn--accent" data-lb-copy>Copy</button>' +
           '  </div>' +
           '  <p class="rb-lookbook-expiry">Available until ' +
           escapeHtml((result.expiresAt || '').slice(0, 10) || '30 days from now') +
           '. They can Save as PDF from the lookbook.</p>')
        : '  <p class="rb-lookbook-expiry">Online link was not created. The downloaded lookbook still works offline.</p>') +
      (result.zipName
        ? ('  <p class="rb-lookbook-status">Downloaded ' + escapeHtml(result.zipName) + '.</p>')
        : '') +
      '  <div class="rb-lookbook-actions">' +
      '    <button type="button" class="btn btn--secondary" data-lb-close>Close</button>' +
      '  </div>' +
      '</div>';
    document.body.appendChild(root);
    var copyBtn = root.querySelector('[data-lb-copy]');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var input = root.querySelector('#rb-lookbook-url');
        if (!input) return;
        input.select();
        var ok = false;
        try {
          ok = document.execCommand && document.execCommand('copy');
        } catch (_) {}
        if (!ok && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(input.value).then(function () {
            copyBtn.textContent = 'Copied';
          }).catch(function () {});
        } else if (ok) {
          copyBtn.textContent = 'Copied';
        }
      });
    }
    root.querySelector('[data-lb-close]').addEventListener('click', function () { closeDialog(root); });
    root.addEventListener('click', function (event) {
      if (event.target === root) closeDialog(root);
    });
  }

  /**
   * Run from Report Builder Share control.
   * options.prepareDeck() -> Promise<{ printDeck, pages, record, title, residence, address, cleanup }>
   */
  async function shareFromReport(options) {
    var opts = options || {};
    var prepare = opts.prepareDeck;
    if (typeof prepare !== 'function') throw new Error('prepareDeck is required');
    var setStatus = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};

    setStatus('Preparing lookbook…');
    var prepared = await prepare();
    try {
      var pkg = await buildPackage({
        printDeck: prepared.printDeck,
        pages: prepared.pages,
        record: prepared.record,
        title: prepared.title,
        residence: prepared.residence,
        address: prepared.address,
        onProgress: setStatus,
      });

      var zipResult = null;
      try {
        setStatus('Downloading lookbook package…');
        zipResult = await downloadZip(pkg);
      } catch (zipErr) {
        console.warn('Lookbook ZIP download failed', zipErr);
      }

      var published = null;
      try {
        published = await publishOnline(pkg, { onProgress: setStatus });
      } catch (pubErr) {
        console.warn('Lookbook online publish failed', pubErr);
        setStatus(pubErr && pubErr.message ? pubErr.message : 'Online share failed');
      }

      openResultDialog({
        url: published && published.url,
        expiresAt: published && published.expiresAt,
        zipName: zipResult && zipResult.filename,
      });

      if (published && published.url) {
        setStatus('Lookbook link ready — expires in 30 days.');
      } else if (zipResult) {
        setStatus('Lookbook downloaded. Online link needs Sync sign-in.');
      } else {
        throw new Error('Could not create a lookbook link or download.');
      }
      return { published: published, zip: zipResult };
    } finally {
      if (prepared && typeof prepared.cleanup === 'function') {
        try { prepared.cleanup(); } catch (_) {}
      }
    }
  }

  window.ToolboxReportLookbook = {
    buildPackage: buildPackage,
    downloadZip: downloadZip,
    publishOnline: publishOnline,
    shareFromReport: shareFromReport,
    lookbookIndexHtml: lookbookIndexHtml,
    collectPhotoEntries: collectPhotoEntries,
  };
})();
