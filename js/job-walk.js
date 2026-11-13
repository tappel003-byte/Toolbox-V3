// Toolbox — Initial Visit (TLS), formerly Job Walk.
//
// Phone-friendly capture on an open Customer File / visit with or without a
// plan. Photos reuse Distress Quick Capture (JPEG data URLs). Videos are
// stored as raw Blobs and upload only on "Upload videos" (Tim, Nov 9, 2026) —
// they do not ride Check Out. Visit notes + audio still travel with the file.
// When record.status === 'visit', this is an Initial Visit card (outcomes,
// follow-up, Make Customer File). Existing jobWalk data on ordinary files
// still opens here.
(function () {
  'use strict';

  var DISTRESS_DB = 'pgg_photos_v1';
  var DISTRESS_STORE = 'photos';
  var MAX_PHOTO_DIM = 1600;
  var JPEG_QUALITY = 0.88;
  /**
   * Per-clip cap with headroom under the Cloudflare Workers request-body
   * limit (100 MB on Free/Pro). 90 MB stated clearly when exceeded.
   */
  var MAX_VIDEO_BYTES = 90 * 1024 * 1024;
  var MAX_VIDEO_LABEL = '90 MB';
  var activeMount = null;

  function isoNow() { return new Date().toISOString(); }

  function uid(prefix) {
    return (prefix || 'jw') + '-' + Date.now().toString(36) + '-' +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function displayName(record) {
    var identity = window.ToolboxApp && window.ToolboxApp.customerIdentity;
    if (identity && typeof identity.displayName === 'function') {
      var named = identity.displayName(record || {});
      if (named && named !== 'New Customer File') return named;
    }
    var first = ((record && record.firstName) || '').trim();
    var last = ((record && record.lastName) || '').trim();
    var company = ((record && record.companyName) || '').trim();
    return (first + ' ' + last).trim() || company || 'Customer File';
  }

  function isVisitRecord(record) {
    return !!(record && record.status === 'visit');
  }

  function todayIsoDate() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, '0');
    var day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  function ensureDistress(record) {
    if (!record.distress || typeof record.distress !== 'object') record.distress = {};
    if (!Array.isArray(record.distress.quickCapture)) record.distress.quickCapture = [];
    if (!record.distress.jobWalk || typeof record.distress.jobWalk !== 'object') {
      record.distress.jobWalk = { updatedAt: '', notes: [], videos: [] };
    }
    if (!Array.isArray(record.distress.jobWalk.notes)) record.distress.jobWalk.notes = [];
    if (!Array.isArray(record.distress.jobWalk.videos)) record.distress.jobWalk.videos = [];
    var walk = record.distress.jobWalk;
    if (!walk.outcomes || typeof walk.outcomes !== 'object') {
      walk.outcomes = {
        noProblems: false,
        recommendFloor: false,
        recommendDistress: false,
        wantsQuote: false,
        callBack: false,
      };
    }
    if (typeof walk.visitDate !== 'string' || !walk.visitDate) {
      walk.visitDate = todayIsoDate();
    }
    if (typeof walk.visitTime !== 'string') walk.visitTime = '';
    if (typeof walk.followUpDate !== 'string') walk.followUpDate = '';
    return record.distress;
  }

  function openDistressDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DISTRESS_DB, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DISTRESS_STORE)) {
          db.createObjectStore(DISTRESS_STORE);
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('Photo store unavailable')); };
    });
  }

  function putDistressValue(id, value) {
    return openDistressDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DISTRESS_STORE, 'readwrite');
        tx.objectStore(DISTRESS_STORE).put(value, id);
        tx.oncomplete = function () { db.close(); resolve(id); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function getDistressValue(id) {
    return openDistressDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DISTRESS_STORE, 'readonly');
        var get = tx.objectStore(DISTRESS_STORE).get(id);
        get.onsuccess = function () {
          db.close();
          resolve(get.result || null);
        };
        get.onerror = function () { db.close(); reject(get.error); };
      });
    });
  }

  function deleteDistressValue(id) {
    if (!id) return Promise.resolve();
    return openDistressDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DISTRESS_STORE, 'readwrite');
        tx.objectStore(DISTRESS_STORE).delete(id);
        tx.oncomplete = function () { db.close(); resolve(); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('Could not read file')); };
      reader.readAsDataURL(file);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('Could not read recording')); };
      reader.readAsDataURL(blob);
    });
  }

  /** Match Distress Quick Capture: JPEG data URL capped at MAX_PHOTO_DIM. */
  function fileToJpegDataUrl(file) {
    return readFileAsDataUrl(file).then(function (raw) {
      return new Promise(function (resolve, reject) {
        var img = new Image();
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var h = img.naturalHeight || img.height;
          if (!w || !h) {
            reject(new Error('Could not read image size'));
            return;
          }
          var scale = Math.min(1, MAX_PHOTO_DIM / Math.max(w, h));
          var nw = Math.max(1, Math.round(w * scale));
          var nh = Math.max(1, Math.round(h * scale));
          var c = document.createElement('canvas');
          c.width = nw;
          c.height = nh;
          c.getContext('2d').drawImage(img, 0, 0, nw, nh);
          resolve(c.toDataURL('image/jpeg', JPEG_QUALITY));
        };
        img.onerror = function () { reject(new Error('Could not decode image')); };
        img.src = raw;
      });
    });
  }

  function mediaSrc(value) {
    if (typeof value === 'string' && value.indexOf('data:') === 0) return value;
    if (value instanceof Blob) return URL.createObjectURL(value);
    return '';
  }

  /**
   * Read a Job Walk / Distress media value, converting legacy Blobs written by
   * early TLS builds into transferable data URL strings and rewriting them.
   */
  function getStoredMedia(id) {
    return getDistressValue(id).then(function (value) {
      if (value == null) return null;
      if (typeof value === 'string' && value.indexOf('data:') === 0) return value;
      if (!(value instanceof Blob)) return value;
      // Videos stay Blobs. Legacy photo/audio Blobs convert once to data URLs.
      if (typeof id === 'string' && id.indexOf('vid_') === 0) return value;
      return blobToDataUrl(value).then(function (dataUrl) {
        return putDistressValue(id, dataUrl).then(function () { return dataUrl; });
      });
    });
  }

  function unmount() {
    if (activeMount && activeMount.root && activeMount.root.parentNode) {
      activeMount.root.parentNode.removeChild(activeMount.root);
    }
    if (activeMount && activeMount.recorder) {
      try { activeMount.recorder.stop(); } catch (err) { /* ignore */ }
    }
    if (activeMount && activeMount.stream) {
      activeMount.stream.getTracks().forEach(function (t) { t.stop(); });
    }
    (activeMount && activeMount.objectUrls || []).forEach(function (u) {
      try { URL.revokeObjectURL(u); } catch (err) { /* ignore */ }
    });
    document.body.classList.remove('job-walk-open', 'tls-side');
    activeMount = null;
  }

  function mount(host, opts) {
    opts = opts || {};
    unmount();
    var customerFileId = opts.customerFileId;
    var onBack = typeof opts.onBack === 'function' ? opts.onBack : function () {};
    document.body.classList.add('job-walk-open', 'tls-side');

    var root = document.createElement('div');
    root.className = 'jw-shell tls-shell';
    host.appendChild(root);

    root.innerHTML =
      '<div class="view-bar view-bar--file jw-bar">' +
      '  <button type="button" id="jw-back" class="btn btn--ghost">‹ TLS</button>' +
      '  <div class="file-identity">' +
      '    <span class="file-identity__name" id="jw-title">Initial Visit</span>' +
      '    <span class="file-identity__address" id="jw-file-label"></span>' +
      '  </div>' +
      '  <span class="file-status" id="jw-status">Loading…</span>' +
      '</div>' +
      '<div class="jw-body">' +
      // Contact (phone tap-to-call + address) sits above Schedule (CC check Nov 11).
      '  <section class="jw-panel jw-panel--contact" id="jw-visit-contact" hidden>' +
      '    <p class="jw-contact__phone">' +
      '      <a id="jw-phone" class="jw-contact__phone-link" href="#"></a>' +
      '    </p>' +
      '    <p class="jw-contact__address" id="jw-address"></p>' +
      '  </section>' +
      // Order (Tim Nov 11): Schedule → homeowner/visit notes → photos/video/record → Outcome at bottom.
      '  <section class="jw-panel jw-panel--visit" id="jw-visit-meta" hidden>' +
      '    <h2 class="jw-panel__title">Schedule</h2>' +
      '    <div class="jw-visit-fields">' +
      '      <label class="jw-field"><span>Date</span>' +
      '        <input type="date" id="jw-visit-date"></label>' +
      '      <label class="jw-field"><span>Time</span>' +
      '        <input type="time" id="jw-visit-time" step="300"></label>' +
      '      <label class="jw-field"><span>Follow-up date</span>' +
      '        <input type="date" id="jw-follow-up"></label>' +
      '    </div>' +
      '  </section>' +
      '  <section class="jw-panel">' +
      '    <h2 class="jw-panel__title">Visit Notes</h2>' +
      '    <div class="jw-note-compose">' +
      '      <label class="jw-speaker">' +
      '        <span>Who said this</span>' +
      '        <select id="jw-speaker">' +
      '          <option value="homeowner">Homeowner</option>' +
      '          <option value="investigator">Investigator</option>' +
      '        </select>' +
      '      </label>' +
      '      <textarea id="jw-note-text" rows="3" placeholder="Visit note…"></textarea>' +
      '      <div class="jw-note-actions">' +
      '        <button type="button" id="jw-note-save" class="btn btn--secondary">Save note</button>' +
      '        <button type="button" id="jw-rec" class="btn btn--quiet">Record audio</button>' +
      '        <button type="button" id="jw-stop" class="btn btn--quiet" hidden>Stop</button>' +
      '        <span class="jw-rec-status" id="jw-rec-status" hidden></span>' +
      '      </div>' +
      '    </div>' +
      '    <div class="jw-notes" id="jw-notes"></div>' +
      '  </section>' +
      '  <section class="jw-panel">' +
      '    <h2 class="jw-panel__title">Take Photos</h2>' +
      '    <p class="jw-panel__hint">No floor plan required. Photos stay on this file for both sides.</p>' +
      '    <div class="jw-photo-actions">' +
      '      <button type="button" id="jw-take" class="btn btn--accent">Take Photos</button>' +
      '      <input type="file" id="jw-file" accept="image/*" capture="environment" multiple hidden>' +
      '    </div>' +
      '    <div class="jw-grid" id="jw-grid"></div>' +
      '  </section>' +
      '  <section class="jw-panel">' +
      '    <h2 class="jw-panel__title">Videos</h2>' +
      '    <p class="jw-panel__hint">Walk-around clips stay on this phone until you upload them to the File Cabinet. Max ' + MAX_VIDEO_LABEL + ' each. They do not travel with Check Out.</p>' +
      '    <div class="jw-photo-actions">' +
      '      <button type="button" id="jw-take-video" class="btn btn--accent">Take Video</button>' +
      '      <button type="button" id="jw-upload-videos" class="btn btn--secondary">Upload videos</button>' +
      '      <span class="jw-video-wait" id="jw-video-wait" hidden></span>' +
      '      <input type="file" id="jw-video-file" accept="video/*" capture="environment" multiple hidden>' +
      '    </div>' +
      '    <div class="jw-grid jw-grid--video" id="jw-videos"></div>' +
      '  </section>' +
      '  <section class="jw-panel jw-panel--visit-outcome" id="jw-visit-outcome" hidden>' +
      '    <h2 class="jw-panel__title">Outcome</h2>' +
      '    <fieldset class="jw-outcomes">' +
      '      <legend class="jw-sr-only">Outcome</legend>' +
      '      <label class="jw-check"><input type="checkbox" id="jw-out-none" data-jw-outcome="noProblems"> No problems seen</label>' +
      '      <label class="jw-check"><input type="checkbox" id="jw-out-floor" data-jw-outcome="recommendFloor"> Recommended floor survey</label>' +
      '      <label class="jw-check"><input type="checkbox" id="jw-out-distress" data-jw-outcome="recommendDistress"> Recommended distress survey</label>' +
      '      <label class="jw-check"><input type="checkbox" id="jw-out-quote" data-jw-outcome="wantsQuote"> Wants a repair quote</label>' +
      '      <label class="jw-check"><input type="checkbox" id="jw-out-callback" data-jw-outcome="callBack"> Told them to call back</label>' +
      '    </fieldset>' +
      '    <div class="jw-visit-actions">' +
      '      <button type="button" id="jw-make-cf" class="btn btn--accent">Make Customer File</button>' +
      '      <p class="jw-panel__hint">Moves this visit into Customer Files — same record, no copy.</p>' +
      '    </div>' +
      '  </section>' +
      '</div>';

    var state = {
      root: root,
      record: null,
      readOnly: false,
      objectUrls: [],
      recorder: null,
      stream: null,
      chunks: [],
      recordingFor: null,
    };
    activeMount = state;

    var statusEl = root.querySelector('#jw-status');
    var labelEl = root.querySelector('#jw-file-label');
    var gridEl = root.querySelector('#jw-grid');
    var videosEl = root.querySelector('#jw-videos');
    var notesEl = root.querySelector('#jw-notes');
    var fileInput = root.querySelector('#jw-file');
    var videoInput = root.querySelector('#jw-video-file');
    var recBtn = root.querySelector('#jw-rec');
    var stopBtn = root.querySelector('#jw-stop');
    var recStatus = root.querySelector('#jw-rec-status');

    function setStatus(text) {
      if (statusEl) statusEl.textContent = text || '';
    }

    function persist() {
      if (!state.record || state.readOnly) return Promise.resolve();
      var distress = ensureDistress(state.record);
      var now = isoNow();
      distress.jobWalk.updatedAt = now;
      distress.updatedAt = now;
      state.record.updatedAt = now;
      return window.ToolboxDB.saveCustomerFile(state.record).then(function () {
        setStatus('Saved');
      }).catch(function (err) {
        console.error(err);
        setStatus('Could not save');
      });
    }

    function jobWalkPhotos() {
      var distress = ensureDistress(state.record);
      return (distress.quickCapture || []).filter(function (item) {
        return item && item.folder === 'Job Walk';
      });
    }

    function jobWalkVideos() {
      return ensureDistress(state.record).jobWalk.videos.slice();
    }

    function videosWaitingUpload() {
      return jobWalkVideos().filter(function (clip) {
        return clip && clip.id && !clip.cabinetUploadedAt;
      });
    }

    function updateVideoWaitBadge() {
      var el = root.querySelector('#jw-video-wait');
      var btn = root.querySelector('#jw-upload-videos');
      if (!el) return;
      var waiting = videosWaitingUpload().length;
      if (waiting) {
        el.hidden = false;
        el.textContent = waiting === 1
          ? '1 video waiting to upload'
          : waiting + ' videos waiting to upload';
      } else {
        el.hidden = true;
        el.textContent = '';
      }
      if (btn) btn.disabled = state.readOnly || waiting === 0;
    }

    function makeDeleteButton(label, onClick) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--quiet jw-delete';
      btn.textContent = label;
      btn.disabled = state.readOnly;
      btn.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        if (state.readOnly) return;
        onClick();
      });
      return btn;
    }

    function renderGrid() {
      gridEl.innerHTML = '';
      var items = jobWalkPhotos();
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'jw-empty';
        empty.textContent = 'No visit photos yet.';
        gridEl.appendChild(empty);
        return;
      }
      items.forEach(function (item) {
        var card = document.createElement('article');
        card.className = 'jw-card';
        var mediaWrap = document.createElement('div');
        mediaWrap.className = 'jw-card__media';
        var img = document.createElement('img');
        img.alt = item.description || 'Visit photo';
        img.className = 'jw-card__img';
        mediaWrap.appendChild(img);
        mediaWrap.appendChild(makeDeleteButton('Delete', function () {
          if (!window.confirm('Delete this photo?')) return;
          var distress = ensureDistress(state.record);
          distress.quickCapture = (distress.quickCapture || []).filter(function (entry) {
            return !(entry && entry.id === item.id);
          });
          deleteDistressValue(item.id).then(persist).then(renderGrid).catch(function (err) {
            console.error(err);
            setStatus('Could not delete photo');
          });
        }));
        card.appendChild(mediaWrap);
        var photoMeta = document.createElement('p');
        photoMeta.className = 'jw-card__meta';
        photoMeta.textContent = '';
        card.appendChild(photoMeta);
        function thumbKey(id) {
          return window.ToolboxSync && typeof window.ToolboxSync.thumbMediaKey === 'function'
            ? window.ToolboxSync.thumbMediaKey(id)
            : ('thumb:' + id);
        }
        function openExplorerFor(mediaId) {
          if (typeof location !== 'undefined') {
            location.hash = '#/explorer' +
              (state.record && state.record.id ? '/' + state.record.id : '');
          }
          setStatus(mediaId
            ? 'In the File Cabinet — open File Explorer to view this photo.'
            : 'Open File Explorer to view Cabinet photos.');
        }
        getStoredMedia(item.id).then(function (value) {
          var src = mediaSrc(value);
          if (src) {
            if (src.indexOf('blob:') === 0) state.objectUrls.push(src);
            img.src = src;
            photoMeta.textContent = item.localFull === false ? 'Downloaded' : 'On this device';
            return getStoredMedia(thumbKey(item.id)).then(function () { return true; });
          }
          return getStoredMedia(thumbKey(item.id)).then(function (thumb) {
            var thumbSrc = mediaSrc(thumb);
            if (thumbSrc) {
              img.src = thumbSrc;
              photoMeta.textContent = 'In the File Cabinet';
              card.classList.add('jw-card--cabinet');
              card.addEventListener('click', function (event) {
                if (event.target.closest('.jw-delete') || event.target.closest('textarea')) return;
                openExplorerFor(item.id);
              });
            } else {
              photoMeta.textContent = 'In the File Cabinet';
              card.classList.add('jw-card--cabinet');
            }
          });
        }).catch(function () {
          photoMeta.textContent = 'In the File Cabinet';
        });
        var desc = document.createElement('textarea');
        desc.className = 'jw-card__desc';
        desc.rows = 2;
        desc.placeholder = 'Photo description';
        desc.value = item.description || '';
        desc.disabled = state.readOnly;
        desc.addEventListener('change', function () {
          item.description = (desc.value || '').trim();
          persist();
        });
        card.appendChild(desc);
        gridEl.appendChild(card);
      });
    }

    function renderVideos() {
      videosEl.innerHTML = '';
      var items = jobWalkVideos();
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'jw-empty';
        empty.textContent = 'No visit videos yet.';
        videosEl.appendChild(empty);
        return;
      }
      items.forEach(function (item) {
        var card = document.createElement('article');
        card.className = 'jw-card jw-card--video';
        var mediaWrap = document.createElement('div');
        mediaWrap.className = 'jw-card__media';
        var video = document.createElement('video');
        video.className = 'jw-card__video';
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        mediaWrap.appendChild(video);
        mediaWrap.appendChild(makeDeleteButton('Delete', function () {
          if (!window.confirm('Delete this video?')) return;
          var videos = ensureDistress(state.record).jobWalk.videos;
          var idx = videos.findIndex(function (entry) {
            return entry && entry.id === item.id;
          });
          if (idx >= 0) videos.splice(idx, 1);
          deleteDistressValue(item.id).then(persist).then(renderVideos).catch(function (err) {
            console.error(err);
            setStatus('Could not delete video');
          });
        }));
        card.appendChild(mediaWrap);
        var meta = document.createElement('p');
        meta.className = 'jw-card__meta';
        meta.textContent = item.cabinetUploadedAt
          ? 'In File Cabinet (kept on this phone)'
          : 'On this phone — waiting to upload';
        card.appendChild(meta);
        var downloadBtn = document.createElement('button');
        downloadBtn.type = 'button';
        downloadBtn.className = 'btn btn--secondary jw-download-video';
        downloadBtn.textContent = 'Download video';
        downloadBtn.hidden = true;
        downloadBtn.addEventListener('click', function () {
          if (!window.ToolboxSync || typeof window.ToolboxSync.downloadJobWalkVideo !== 'function') {
            setStatus('Download video is not available');
            return;
          }
          setStatus('Downloading video…');
          window.ToolboxSync.downloadJobWalkVideo(state.record.id, item.id).then(function () {
            setStatus('Video downloaded to this device');
            renderVideos();
          }).catch(function (err) {
            console.error(err);
            setStatus((err && err.message) || 'Could not download video');
          });
        });
        card.appendChild(downloadBtn);
        getStoredMedia(item.id).then(function (value) {
          var src = mediaSrc(value);
          if (!src) {
            meta.textContent = item.cabinetUploadedAt
              ? 'In the File Cabinet — tap Download video'
              : 'Video bytes missing on this device';
            if (item.cabinetUploadedAt) downloadBtn.hidden = false;
            return;
          }
          if (src.indexOf('blob:') === 0) state.objectUrls.push(src);
          video.src = src;
          // Still offer download when Cabinet has it and local is missing a refresh path.
          if (item.cabinetUploadedAt && !state.readOnly) {
            // Keep local after upload (open item); no forced re-download.
          }
        }).catch(function () {
          if (item.cabinetUploadedAt) downloadBtn.hidden = false;
        });
        var desc = document.createElement('textarea');
        desc.className = 'jw-card__desc';
        desc.rows = 2;
        desc.placeholder = 'Video description';
        desc.value = item.description || '';
        desc.disabled = state.readOnly;
        desc.addEventListener('change', function () {
          item.description = (desc.value || '').trim();
          persist();
        });
        card.appendChild(desc);
        videosEl.appendChild(card);
      });
      updateVideoWaitBadge();
    }

    function renderNotes() {
      notesEl.innerHTML = '';
      var notes = ensureDistress(state.record).jobWalk.notes.slice().reverse();
      if (!notes.length) {
        var empty = document.createElement('p');
        empty.className = 'jw-empty';
        empty.textContent = 'No visit notes yet.';
        notesEl.appendChild(empty);
        return;
      }
      notes.forEach(function (note) {
        var row = document.createElement('article');
        row.className = 'jw-note';
        var head = document.createElement('header');
        head.className = 'jw-note__head';
        var who = note.speaker === 'homeowner' ? 'Homeowner' : 'Investigator';
        var when = note.at ? new Date(note.at).toLocaleString() : '';
        head.textContent = who + (when ? ' · ' + when : '');
        row.appendChild(head);
        // Editable so Tim can copy out → organize elsewhere → paste back.
        var body = document.createElement('textarea');
        body.className = 'jw-note__text jw-note__edit';
        body.rows = Math.min(12, Math.max(3, String(note.text || '').split('\n').length + 1));
        body.value = note.text || '';
        body.setAttribute('aria-label', 'Visit note text');
        body.disabled = !!state.readOnly;
        row.appendChild(body);
        if (note.audioId) {
          var audio = document.createElement('audio');
          audio.controls = true;
          audio.className = 'jw-note__audio';
          getStoredMedia(note.audioId).then(function (value) {
            var src = mediaSrc(value);
            if (!src) return;
            if (src.indexOf('blob:') === 0) state.objectUrls.push(src);
            audio.src = src;
          }).catch(function () {});
          row.appendChild(audio);
        }
        var noteActions = document.createElement('div');
        noteActions.className = 'jw-note__actions';
        if (!state.readOnly) {
          var saveBtn = document.createElement('button');
          saveBtn.type = 'button';
          saveBtn.className = 'btn btn--secondary jw-note__save';
          saveBtn.textContent = 'Save';
          saveBtn.addEventListener('click', function () {
            var list = ensureDistress(state.record).jobWalk.notes;
            var idx = list.findIndex(function (entry) {
              return entry && entry.id === note.id;
            });
            if (idx < 0) return;
            list[idx].text = body.value;
            persist().then(function () {
              setStatus('Note saved');
            });
          });
          noteActions.appendChild(saveBtn);
        }
        noteActions.appendChild(makeDeleteButton(
          note.audioId ? 'Delete audio note' : 'Delete note',
          function () {
            var label = note.audioId ? 'Delete this audio clip?' : 'Delete this note?';
            if (!window.confirm(label)) return;
            var list = ensureDistress(state.record).jobWalk.notes;
            var idx = list.findIndex(function (entry) {
              return entry && entry.id === note.id;
            });
            if (idx >= 0) list.splice(idx, 1);
            var cleanup = note.audioId
              ? deleteDistressValue(note.audioId)
              : Promise.resolve();
            cleanup.then(persist).then(renderNotes).catch(function (err) {
              console.error(err);
              setStatus('Could not delete note');
            });
          }
        ));
        row.appendChild(noteActions);
        notesEl.appendChild(row);
      });
    }

    function syncVisitFields() {
      var visit = isVisitRecord(state.record);
      var meta = root.querySelector('#jw-visit-meta');
      var outcome = root.querySelector('#jw-visit-outcome');
      var contact = root.querySelector('#jw-visit-contact');
      var title = root.querySelector('#jw-title');
      if (title) title.textContent = 'Initial Visit';
      if (meta) meta.hidden = !visit;
      if (outcome) outcome.hidden = !visit;
      if (contact) contact.hidden = !visit;
      if (!visit) return;
      var phone = ((state.record && state.record.cellPhone) || '').trim();
      var address = ((state.record && state.record.propertyAddress) || '').trim();
      var phoneEl = root.querySelector('#jw-phone');
      var addressEl = root.querySelector('#jw-address');
      if (phoneEl) {
        phoneEl.textContent = phone || 'No phone on file';
        if (phone) {
          phoneEl.href = 'tel:' + phone.replace(/[^\d+]/g, '');
          phoneEl.classList.remove('is-empty');
        } else {
          phoneEl.removeAttribute('href');
          phoneEl.classList.add('is-empty');
        }
      }
      if (addressEl) {
        addressEl.textContent = address || 'No address on file';
        addressEl.classList.toggle('is-empty', !address);
      }
      var walk = ensureDistress(state.record).jobWalk;
      var dateEl = root.querySelector('#jw-visit-date');
      var timeEl = root.querySelector('#jw-visit-time');
      var followEl = root.querySelector('#jw-follow-up');
      if (dateEl) dateEl.value = walk.visitDate || todayIsoDate();
      if (timeEl) timeEl.value = walk.visitTime || '';
      if (followEl) followEl.value = walk.followUpDate || '';
      root.querySelectorAll('[data-jw-outcome]').forEach(function (input) {
        var key = input.getAttribute('data-jw-outcome');
        input.checked = !!(walk.outcomes && walk.outcomes[key]);
        input.disabled = state.readOnly;
      });
      if (dateEl) dateEl.disabled = state.readOnly;
      if (timeEl) timeEl.disabled = state.readOnly;
      if (followEl) followEl.disabled = state.readOnly;
      var makeBtn = root.querySelector('#jw-make-cf');
      if (makeBtn) makeBtn.disabled = state.readOnly;
    }

    function renderAll() {
      labelEl.textContent = displayName(state.record);
      syncVisitFields();
      renderGrid();
      renderVideos();
      renderNotes();
    }

    function makeCustomerFile() {
      if (!state.record || state.readOnly || !isVisitRecord(state.record)) return;
      var walk = ensureDistress(state.record).jobWalk;
      var outcomes = walk.outcomes || {};
      // MOVE, not copy: drop the visit mark on the same id, then navigate.
      delete state.record.status;
      state.record.customerUpdatedAt = isoNow();
      state.record.updatedAt = isoNow();
      setStatus('Saving…');
      return persist().then(function () {
        var id = state.record.id;
        var hash;
        if (outcomes.recommendFloor) {
          hash = '#/file/' + encodeURIComponent(id) + '/floor';
        } else if (outcomes.recommendDistress) {
          hash = '#/file/' + encodeURIComponent(id) + '/distress';
        } else {
          hash = '#/file/' + encodeURIComponent(id);
        }
        window.location.hash = hash;
      }).catch(function (err) {
        console.error(err);
        setStatus('Could not make Customer File');
      });
    }

    function addPhotos(fileList) {
      if (state.readOnly) return;
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) return;
      setStatus('Saving photos…');
      var chain = Promise.resolve();
      files.forEach(function (file) {
        chain = chain.then(function () {
          var id = 'ph_' + uid('jw');
          return fileToJpegDataUrl(file).then(function (dataUrl) {
            return putDistressValue(id, dataUrl).then(function () {
              ensureDistress(state.record).quickCapture.push({
                id: id,
                ts: isoNow(),
                folder: 'Job Walk',
                description: '',
                sourceName: file.name || '',
                localFull: true,
              });
            });
          });
        });
      });
      return chain.then(function () {
        return persist();
      }).then(renderGrid).catch(function (err) {
        console.error(err);
        setStatus('Could not save photo');
      });
    }

    function addVideos(fileList) {
      if (state.readOnly) return;
      var files = Array.prototype.slice.call(fileList || []);
      if (!files.length) return;
      setStatus('Saving videos…');
      var chain = Promise.resolve();
      files.forEach(function (file) {
        chain = chain.then(function () {
          if (file.size > MAX_VIDEO_BYTES) {
            setStatus('Video too large — max ' + MAX_VIDEO_LABEL + ' per clip (' +
              (file.name || 'clip') + ' is about ' +
              Math.round(file.size / (1024 * 1024)) + ' MB)');
            return;
          }
          var id = 'vid_' + uid('jw');
          // Keep the raw file as a Blob — never inflate to a data URL.
          return putDistressValue(id, file).then(function () {
            ensureDistress(state.record).jobWalk.videos.push({
              id: id,
              ts: isoNow(),
              description: '',
              sourceName: file.name || '',
              byteLength: file.size,
              mimeType: file.type || 'video/*',
            });
          });
        });
      });
      return chain.then(function () {
        return persist();
      }).then(function () {
        renderVideos();
        updateVideoWaitBadge();
      }).catch(function (err) {
        console.error(err);
        setStatus('Could not save video');
      });
    }

    function uploadVideos() {
      if (state.readOnly) return;
      if (!window.ToolboxSync || typeof window.ToolboxSync.uploadJobWalkVideos !== 'function') {
        setStatus('Upload is not available');
        return;
      }
      var waiting = videosWaitingUpload().length;
      if (!waiting) {
        setStatus('No videos waiting to upload');
        return;
      }
      setStatus('Uploading videos to File Cabinet…');
      window.ToolboxSync.uploadJobWalkVideos(state.record.id).then(function (result) {
        if (result && result.record) state.record = result.record;
        setStatus(result && result.uploaded
          ? ('Uploaded ' + result.uploaded + ' video' + (result.uploaded === 1 ? '' : 's') +
            ' to the File Cabinet')
          : 'Nothing to upload');
        renderVideos();
        updateVideoWaitBadge();
      }).catch(function (err) {
        console.error(err);
        setStatus((err && err.message) || 'Could not upload videos');
      });
    }

    function saveTypedNote() {
      if (state.readOnly) return;
      var text = (root.querySelector('#jw-note-text').value || '').trim();
      if (!text) {
        setStatus('Type a note first');
        return;
      }
      var speaker = root.querySelector('#jw-speaker').value === 'homeowner'
        ? 'homeowner'
        : 'investigator';
      ensureDistress(state.record).jobWalk.notes.push({
        id: uid('note'),
        at: isoNow(),
        text: text,
        speaker: speaker,
      });
      root.querySelector('#jw-note-text').value = '';
      persist().then(renderNotes);
    }

    function stopRecording() {
      if (state.recorder && state.recorder.state !== 'inactive') {
        try { state.recorder.stop(); } catch (err) { /* ignore */ }
      }
      if (state.stream) {
        state.stream.getTracks().forEach(function (t) { t.stop(); });
        state.stream = null;
      }
      recBtn.hidden = false;
      stopBtn.hidden = true;
      recStatus.hidden = true;
    }

    function startRecording() {
      if (state.readOnly) return;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Recording is not available on this device');
        return;
      }
      var speaker = root.querySelector('#jw-speaker').value === 'homeowner'
        ? 'homeowner'
        : 'investigator';
      navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
        state.stream = stream;
        state.chunks = [];
        var recorder;
        try {
          recorder = new MediaRecorder(stream);
        } catch (err) {
          stream.getTracks().forEach(function (t) { t.stop(); });
          setStatus('Could not start recording');
          return;
        }
        state.recorder = recorder;
        state.recordingFor = { speaker: speaker, text: '' };
        recorder.ondataavailable = function (ev) {
          if (ev.data && ev.data.size) state.chunks.push(ev.data);
        };
        recorder.onstop = function () {
          // Capture locals before any async work; text at Stop time includes
          // anything typed while the mic was rolling.
          var savedSpeaker = (state.recordingFor && state.recordingFor.speaker) || 'investigator';
          var savedText = (root.querySelector('#jw-note-text').value || '').trim();
          var chunks = state.chunks.slice();
          var mime = recorder.mimeType || 'audio/webm';
          state.recorder = null;
          state.chunks = [];
          state.recordingFor = null;
          var blob = new Blob(chunks, { type: mime });
          var audioId = 'vm_' + uid('jw');
          blobToDataUrl(blob).then(function (dataUrl) {
            return putDistressValue(audioId, dataUrl);
          }).then(function () {
            ensureDistress(state.record).jobWalk.notes.push({
              id: uid('note'),
              at: isoNow(),
              text: savedText,
              speaker: savedSpeaker,
              audioId: audioId,
            });
            root.querySelector('#jw-note-text').value = '';
            return persist();
          }).then(renderNotes).catch(function (err) {
            console.error(err);
            setStatus('Could not save recording — typed notes still work');
          });
        };
        recorder.start();
        recBtn.hidden = true;
        stopBtn.hidden = false;
        recStatus.hidden = false;
        recStatus.textContent = 'Recording… tap Stop when finished';
        setStatus('Recording with homeowner permission');
      }).catch(function () {
        setStatus('Microphone permission refused — typed notes still work');
      });
    }

    root.querySelector('#jw-back').addEventListener('click', function () {
      stopRecording();
      persist().then(function () {
        if (isVisitRecord(state.record)) {
          window.location.hash = '#/';
          return;
        }
        onBack();
      });
    });
    root.querySelector('#jw-take').addEventListener('click', function () {
      if (state.readOnly) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      addPhotos(fileInput.files);
      fileInput.value = '';
    });
    root.querySelector('#jw-take-video').addEventListener('click', function () {
      if (state.readOnly) return;
      videoInput.click();
    });
    root.querySelector('#jw-upload-videos').addEventListener('click', uploadVideos);
    videoInput.addEventListener('change', function () {
      addVideos(videoInput.files);
      videoInput.value = '';
    });
    root.querySelector('#jw-note-save').addEventListener('click', saveTypedNote);
    recBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);
    var makeCfBtn = root.querySelector('#jw-make-cf');
    if (makeCfBtn) makeCfBtn.addEventListener('click', makeCustomerFile);
    var visitDateEl = root.querySelector('#jw-visit-date');
    if (visitDateEl) {
      visitDateEl.addEventListener('change', function () {
        if (!state.record || state.readOnly) return;
        ensureDistress(state.record).jobWalk.visitDate = visitDateEl.value || todayIsoDate();
        persist();
      });
    }
    var visitTimeEl = root.querySelector('#jw-visit-time');
    if (visitTimeEl) {
      visitTimeEl.addEventListener('change', function () {
        if (!state.record || state.readOnly) return;
        ensureDistress(state.record).jobWalk.visitTime = visitTimeEl.value || '';
        persist();
      });
    }
    var followEl = root.querySelector('#jw-follow-up');
    if (followEl) {
      followEl.addEventListener('change', function () {
        if (!state.record || state.readOnly) return;
        ensureDistress(state.record).jobWalk.followUpDate = followEl.value || '';
        persist();
      });
    }
    root.querySelectorAll('[data-jw-outcome]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!state.record || state.readOnly) return;
        var key = input.getAttribute('data-jw-outcome');
        var walk = ensureDistress(state.record).jobWalk;
        walk.outcomes[key] = !!input.checked;
        persist();
      });
    });

    setStatus('Loading…');
    return window.ToolboxDB.getCustomerFile(customerFileId).then(function (record) {
      if (!record) {
        setStatus('Customer File missing');
        return;
      }
      state.record = record;
      state.readOnly = !!(window.ToolboxSync &&
        typeof window.ToolboxSync.heldElsewhere === 'function' &&
        window.ToolboxSync.heldElsewhere(record));
      ensureDistress(record);
      // Visit cards go back to the cabinet Visits list, not TLS home.
      if (isVisitRecord(record)) {
        var back = root.querySelector('#jw-back');
        if (back) back.textContent = '‹ Visits';
      }
      if (state.readOnly) {
        root.querySelector('#jw-take').disabled = true;
        root.querySelector('#jw-take-video').disabled = true;
        root.querySelector('#jw-upload-videos').disabled = true;
        root.querySelector('#jw-note-save').disabled = true;
        root.querySelector('#jw-note-text').disabled = true;
        recBtn.disabled = true;
        setStatus('View only — checked out elsewhere');
      } else {
        setStatus('Ready');
      }
      renderAll();
      updateVideoWaitBadge();
    });
  }

  window.ToolboxJobWalk = {
    mount: mount,
    unmount: unmount,
    isVisitRecord: isVisitRecord,
    /** Public media read — converts legacy Blobs to data URLs for Sync/UI. */
    getStoredMedia: getStoredMedia,
    putStoredMedia: putDistressValue,
    // Test/helpers: same compression path Distress Quick Capture uses.
    _test: {
      fileToJpegDataUrl: fileToJpegDataUrl,
      blobToDataUrl: blobToDataUrl,
      putDistressValue: putDistressValue,
      getDistressValue: getDistressValue,
      deleteDistressValue: deleteDistressValue,
      getStoredMedia: getStoredMedia,
      MAX_PHOTO_DIM: MAX_PHOTO_DIM,
      MAX_VIDEO_BYTES: MAX_VIDEO_BYTES,
      todayIsoDate: todayIsoDate,
    },
  };
})();
