// Toolbox — Job Walk (TLS).
//
// Phone-friendly capture on an open Customer File with or without a plan.
// Photos reuse Distress Quick Capture (shared both sides). Visit notes and
// optional audio live on record.distress.jobWalk so they travel with the
// distress component. Drawing freedom and POR stay separate.
(function () {
  'use strict';

  var DISTRESS_DB = 'pgg_photos_v1';
  var DISTRESS_STORE = 'photos';
  var activeMount = null;

  function isoNow() { return new Date().toISOString(); }

  function uid(prefix) {
    return (prefix || 'jw') + '-' + Date.now().toString(36) + '-' +
      Math.floor(Math.random() * 1e6).toString(36);
  }

  function displayName(record) {
    var first = ((record && record.firstName) || '').trim();
    var last = ((record && record.lastName) || '').trim();
    var company = ((record && record.companyName) || '').trim();
    return (first + ' ' + last).trim() || company || 'Customer File';
  }

  function ensureDistress(record) {
    if (!record.distress || typeof record.distress !== 'object') record.distress = {};
    if (!Array.isArray(record.distress.quickCapture)) record.distress.quickCapture = [];
    if (!record.distress.jobWalk || typeof record.distress.jobWalk !== 'object') {
      record.distress.jobWalk = { updatedAt: '', notes: [] };
    }
    if (!Array.isArray(record.distress.jobWalk.notes)) record.distress.jobWalk.notes = [];
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

  function putDistressBlob(id, blob) {
    return openDistressDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(DISTRESS_STORE, 'readwrite');
        tx.objectStore(DISTRESS_STORE).put(blob, id);
        tx.oncomplete = function () { db.close(); resolve(id); };
        tx.onerror = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function getDistressBlob(id) {
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

  function blobUrl(blob) {
    if (!blob) return Promise.resolve('');
    return Promise.resolve(URL.createObjectURL(blob));
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
      '    <span class="file-identity__name">Job Walk</span>' +
      '    <span class="file-identity__address" id="jw-file-label"></span>' +
      '  </div>' +
      '  <span class="file-status" id="jw-status">Loading…</span>' +
      '</div>' +
      '<div class="jw-body">' +
      '  <section class="jw-panel">' +
      '    <h2 class="jw-panel__title">Take Photos</h2>' +
      '    <p class="jw-panel__hint">No floor plan required. Photos stay on this Customer File for both sides.</p>' +
      '    <div class="jw-photo-actions">' +
      '      <button type="button" id="jw-take" class="btn btn--accent">Take Photos</button>' +
      '      <input type="file" id="jw-file" accept="image/*" capture="environment" multiple hidden>' +
      '    </div>' +
      '    <div class="jw-grid" id="jw-grid"></div>' +
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
    var notesEl = root.querySelector('#jw-notes');
    var fileInput = root.querySelector('#jw-file');
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

    function renderGrid() {
      gridEl.innerHTML = '';
      var items = jobWalkPhotos();
      if (!items.length) {
        var empty = document.createElement('p');
        empty.className = 'jw-empty';
        empty.textContent = 'No Job Walk photos yet.';
        gridEl.appendChild(empty);
        return;
      }
      items.forEach(function (item) {
        var card = document.createElement('article');
        card.className = 'jw-card';
        var img = document.createElement('img');
        img.alt = item.description || 'Job Walk photo';
        img.className = 'jw-card__img';
        card.appendChild(img);
        getDistressBlob(item.id).then(blobUrl).then(function (url) {
          if (!url) return;
          state.objectUrls.push(url);
          img.src = url;
        }).catch(function () {});
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
        if (note.text) {
          var body = document.createElement('p');
          body.className = 'jw-note__text';
          body.textContent = note.text;
          row.appendChild(body);
        }
        if (note.audioId) {
          var audio = document.createElement('audio');
          audio.controls = true;
          audio.className = 'jw-note__audio';
          getDistressBlob(note.audioId).then(blobUrl).then(function (url) {
            if (!url) return;
            state.objectUrls.push(url);
            audio.src = url;
          }).catch(function () {});
          row.appendChild(audio);
        }
        notesEl.appendChild(row);
      });
    }

    function renderAll() {
      labelEl.textContent = displayName(state.record);
      renderGrid();
      renderNotes();
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
          return putDistressBlob(id, file).then(function () {
            ensureDistress(state.record).quickCapture.push({
              id: id,
              ts: isoNow(),
              folder: 'Job Walk',
              description: '',
              sourceName: file.name || '',
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
      var typed = (root.querySelector('#jw-note-text').value || '').trim();
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
        state.recordingFor = { speaker: speaker, text: typed };
        recorder.ondataavailable = function (ev) {
          if (ev.data && ev.data.size) state.chunks.push(ev.data);
        };
        recorder.onstop = function () {
          var blob = new Blob(state.chunks, { type: recorder.mimeType || 'audio/webm' });
          var audioId = 'vm_' + uid('jw');
          putDistressBlob(audioId, blob).then(function () {
            ensureDistress(state.record).jobWalk.notes.push({
              id: uid('note'),
              at: isoNow(),
              text: (state.recordingFor && state.recordingFor.text) || '',
              speaker: (state.recordingFor && state.recordingFor.speaker) || 'investigator',
              audioId: audioId,
            });
            root.querySelector('#jw-note-text').value = '';
            return persist();
          }).then(renderNotes).catch(function (err) {
            console.error(err);
            setStatus('Could not save recording — typed notes still work');
          });
          state.recorder = null;
          state.chunks = [];
          state.recordingFor = null;
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
      persist().then(onBack);
    });
    root.querySelector('#jw-take').addEventListener('click', function () {
      if (state.readOnly) return;
      fileInput.click();
    });
    fileInput.addEventListener('change', function () {
      addPhotos(fileInput.files);
      fileInput.value = '';
    });
    root.querySelector('#jw-note-save').addEventListener('click', saveTypedNote);
    recBtn.addEventListener('click', startRecording);
    stopBtn.addEventListener('click', stopRecording);

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
      if (state.readOnly) {
        root.querySelector('#jw-take').disabled = true;
        root.querySelector('#jw-note-save').disabled = true;
        root.querySelector('#jw-note-text').disabled = true;
        recBtn.disabled = true;
        setStatus('View only — checked out elsewhere');
      } else {
        setStatus('Ready');
      }
      renderAll();
    });
  }

  window.ToolboxJobWalk = {
    mount: mount,
    unmount: unmount,
  };
})();
