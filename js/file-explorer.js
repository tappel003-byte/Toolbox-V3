// Toolbox — File Explorer.
//
// Read-only view of server Customer Files and their stored content.
// Raw storage keys remain available under Technical details.

(function () {
  'use strict';

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function previewKind(contentType) {
    const ct = String(contentType || '').toLowerCase().split(';')[0].trim();
    if (!ct || ct === 'application/octet-stream') return '';
    if (ct.indexOf('image/') === 0) return 'image';
    if (ct === 'application/pdf') return 'pdf';
    if (ct === 'application/json' || ct.slice(-5) === '+json' || ct.indexOf('text/') === 0) return 'text';
    return '';
  }

  function typeLabel(contentType) {
    const type = String(contentType || '').toLowerCase().split(';')[0].trim();
    if (type === 'application/pdf') return 'PDF';
    if (type.indexOf('image/') === 0) return 'Image';
    if (type === 'application/json' || type.slice(-5) === '+json') return 'File data';
    if (type.indexOf('text/') === 0) return 'Text';
    return type ? 'File' : '';
  }

  function formatBytes(size) {
    if (typeof size !== 'number' || !isFinite(size) || size < 0) return '';
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) {
      const value = size / 1024;
      return (value >= 10 ? value.toFixed(0) : value.toFixed(1)) + ' KB';
    }
    return (size / (1024 * 1024)).toFixed(1) + ' MB';
  }

  function downloadName(key) {
    return String(key || 'object').replace(/[^A-Za-z0-9._-]+/g, '_') || 'object';
  }

  const GROUPS = [
    { id: 'customer', title: 'Customer information' },
    { id: 'plans', title: 'Plans and canvases' },
    { id: 'distress', title: 'Distress Survey' },
    { id: 'quick-capture', title: 'Quick Capture' },
    { id: 'other-photos', title: 'Other photos' },
    { id: 'floor', title: 'Floor Survey' },
    { id: 'diagnostics', title: 'Diagnostics' },
    { id: 'report', title: 'Report Builder' },
    { id: 'other', title: 'Other stored files' },
    { id: 'technical', title: 'Technical details' },
  ];

  const KNOWN_FILE = {
    'index.json': { purpose: 'technical', label: 'Cabinet index' },
    'customer.json': { purpose: 'customer', label: 'Customer information' },
    'plans.json': { purpose: 'plans', label: 'Plans and canvases' },
    'distress.json': { purpose: 'distress', label: 'Distress Survey' },
    'floor.json': { purpose: 'floor', label: 'Floor Survey' },
    'diagnostics.json': { purpose: 'diagnostics', label: 'Diagnostics' },
    'report.json': { purpose: 'report', label: 'Report Builder' },
    'trash.json': { purpose: 'technical', label: 'Trash record' },
  };

  function formatFieldDate(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
    let date;
    if (day) date = new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
    else {
      const parsed = Date.parse(text);
      if (!isFinite(parsed)) return '';
      date = new Date(parsed);
    }
    if (isNaN(date.getTime())) return '';
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  }

  function usefulDate(row) {
    if (!row) return '';
    return formatFieldDate(row.fieldWorkDate || row.createdAt);
  }

  // A filename prefix is not ownership. Without a manifest purpose, media
  // stays in Other stored files.
  function classify(row, id) {
    if (row && row.purpose && row.label) {
      return { purpose: row.purpose, label: row.label, detail: row.detail || '' };
    }
    const key = String(row && row.key || '');
    const prefix = 'cf/' + id + '/';
    if (key.indexOf(prefix) === 0) {
      const filename = key.slice(prefix.length);
      const known = KNOWN_FILE[filename];
      if (known) return { purpose: known.purpose, label: known.label, detail: '' };
      return { purpose: 'other', label: filename || 'Stored file', detail: '' };
    }
    if (key.indexOf('media/') === 0) {
      return { purpose: 'other', label: 'Stored media', detail: '' };
    }
    return { purpose: 'other', label: 'Stored file', detail: '' };
  }

  function groupIdFor(purpose) {
    if (purpose === 'plan') return 'plans';
    if (purpose === 'distress-photo') return 'distress';
    if (purpose === 'unassigned-photo' || purpose === 'general-photo') return 'other-photos';
    if (purpose === 'floor-pdf' || purpose === 'floor-figure') return 'floor';
    if (purpose === 'diagnostics-figure') return 'diagnostics';
    const known = GROUPS.some(function (group) { return group.id === purpose; });
    return known ? purpose : 'other';
  }

  function purposeRank(purpose) {
    if (purpose === 'floor-pdf' || purpose === 'distress-photo' || purpose === 'plan' || purpose === 'diagnostics-figure') return 0;
    if (purpose === 'floor-figure' || purpose === 'quick-capture') return 1;
    return 2;
  }

  function alsoNote(row) {
    const also = row && Array.isArray(row.also) ? row.also : [];
    const names = [];
    if (also.indexOf('distress-photo') !== -1) names.push('Distress Survey');
    if (also.indexOf('quick-capture') !== -1) names.push('Quick Capture');
    if (also.indexOf('unassigned-photo') !== -1) names.push('Unassigned photos');
    if (also.indexOf('general-photo') !== -1) names.push('General photos');
    if (!names.length) return '';
    return 'Also listed in ' + names.join(' and ') + '.';
  }

  function metaLine(row) {
    if (row && row.missing) return 'Not stored';
    if (!row || String(row.key || '').indexOf('media/') !== 0) return '';
    const parts = [];
    const type = typeLabel(row.contentType);
    const size = formatBytes(row.size);
    if (type) parts.push(type);
    if (size) parts.push(size);
    return parts.join(' · ');
  }

  function technicalKey(key) {
    const details = document.createElement('details');
    details.className = 'explorer-row__technical';
    const summary = document.createElement('summary');
    summary.textContent = 'Technical details';
    const code = document.createElement('code');
    code.textContent = key;
    details.appendChild(summary);
    details.appendChild(code);
    return details;
  }

  function errorText(err) {
    if (!err) return 'Could not read the server File Cabinet.';
    if (err.code === 'offline') return 'File Explorer reads the server and needs a network connection.';
    if (err.code === 'auth') return 'Sign in required to browse the server File Cabinet.';
    if (err.code === 'config') return 'Sync is not configured yet.';
    if (err.code === 'network') return 'Network error while reading the server File Cabinet.';
    return (err && err.message) || 'Could not read the server File Cabinet.';
  }

  let previewUrl = '';

  function revokePreview() {
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl); } catch (_) {}
      previewUrl = '';
    }
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }, 1500);
  }

  async function responseBlob(response) {
    const type = response.headers.get('content-type') || 'application/octet-stream';
    const buffer = await response.arrayBuffer();
    return { blob: new Blob([buffer], { type: type }), type: type, buffer: buffer };
  }

  function renderShell(app, inner) {
    app.innerHTML = inner;
  }

  function renderExplore(app, customerId) {
    if (window.ToolboxApp && typeof window.ToolboxApp.registerActiveFlush === 'function') {
      window.ToolboxApp.registerActiveFlush(null);
    }
    revokePreview();
    const inside = !!customerId;
    renderShell(
      app,
      '<div class="explorer">' +
      '  <div class="view-bar view-bar--file">' +
      '    <button type="button" id="explorer-back" class="btn btn--ghost">' +
             (inside ? '‹ File Explorer' : '‹ Customer Files') +
      '    </button>' +
      '    <div class="file-identity"><span class="file-identity__name">File Explorer</span></div>' +
      '  </div>' +
      '  <section class="explorer-view">' +
      '    <header class="explorer-head">' +
      '      <div class="explorer-head__copy">' +
      '        <p class="eyebrow">File Cabinet</p>' +
      '        <h1 id="explorer-title">File Explorer</h1>' +
      '        <p id="explorer-lead"></p>' +
      '        <p id="explorer-sub" class="explorer-sub"></p>' +
      '      </div>' +
      (inside
        ? '<button type="button" id="explorer-zip" class="btn btn--secondary">Download ZIP</button>'
        : '') +
      '    </header>' +
      (inside
        ? ''
        : '<label class="explorer-search">' +
          '  <span class="sr-only">Search Customer Files</span>' +
          '  <input type="search" id="explorer-search" placeholder="Search name or address" autocomplete="off" />' +
          '</label>') +
      '    <p class="explorer-crumb" id="explorer-crumb"></p>' +
      '    <p class="cabinet-notice" id="explorer-notice" hidden></p>' +
      '    <div id="explorer-notes"></div>' +
      '    <div class="explorer-list" id="explorer-list">' +
      '      <p class="cabinet-empty">Loading Customer Files…</p>' +
      '    </div>' +
      '    <section class="explorer-preview" id="explorer-preview" hidden></section>' +
      '  </section>' +
      '</div>',
    );

    const titleEl = app.querySelector('#explorer-title');
    const lead = app.querySelector('#explorer-lead');
    const sub = app.querySelector('#explorer-sub');
    const crumb = app.querySelector('#explorer-crumb');
    const listEl = app.querySelector('#explorer-list');
    const notesEl = app.querySelector('#explorer-notes');
    const notice = app.querySelector('#explorer-notice');
    const preview = app.querySelector('#explorer-preview');
    const searchInput = app.querySelector('#explorer-search');

    lead.textContent = inside
      ? 'Stored surveys, photos, plans, and other data.'
      : 'Customer Files stored on the server. Open a file to view its stored surveys, photos, plans, and other data.';
    sub.textContent = inside ? 'Missing items are marked not stored.' : '';
    crumb.textContent = '';

    app.querySelector('#explorer-back').addEventListener('click', function () {
      window.location.hash = inside ? '#/explore' : '#/';
    });

    function showNotice(message) {
      notice.hidden = !message;
      notice.textContent = message || '';
    }

    function requireSync() {
      if (!window.ToolboxSync || typeof window.ToolboxSync.exploreListFiles !== 'function') {
        showNotice('File Explorer is unavailable.');
        listEl.innerHTML = '';
        return false;
      }
      return true;
    }

    let rootFiles = [];

    if (inside) {
      app.querySelector('#explorer-zip').addEventListener('click', function () {
        downloadArchive(customerId, app.querySelector('#explorer-zip'), showNotice);
      });
      loadCustomer(customerId);
    } else {
      loadRoot();
    }

    function loadRoot() {
      if (!requireSync()) return;
      window.ToolboxSync.exploreListFiles().then(function (data) {
        rootFiles = data && Array.isArray(data.files) ? data.files : [];
        paintRoot();
      }).catch(function (err) {
        listEl.innerHTML = '';
        showNotice(errorText(err));
      });
    }

    if (searchInput) {
      searchInput.addEventListener('input', function () {
        paintRoot();
      });
    }

    function loadCustomer(id) {
      if (!requireSync()) return;
      window.ToolboxSync.exploreListCustomerFile(id).then(function (data) {
        paintCustomer(id, data || {});
      }).catch(function (err) {
        listEl.innerHTML = '';
        showNotice(errorText(err));
      });
    }

    function filteredRoot() {
      const query = searchInput ? String(searchInput.value || '').trim().toLowerCase() : '';
      const files = rootFiles.slice().sort(function (a, b) {
        const nameA = String(a && a.displayName || a && a.propertyAddress || '').toLowerCase();
        const nameB = String(b && b.displayName || b && b.propertyAddress || '').toLowerCase();
        if (nameA < nameB) return -1;
        if (nameA > nameB) return 1;
        return String(a && a.key || '') < String(b && b.key || '') ? -1 : 1;
      });
      if (!query) return files;
      return files.filter(function (row) {
        const hay = [
          row && row.displayName,
          row && row.propertyAddress,
          usefulDate(row),
        ].join('\n').toLowerCase();
        return hay.indexOf(query) !== -1;
      });
    }

    function paintRoot() {
      const files = filteredRoot();
      listEl.innerHTML = '';
      if (!rootFiles.length) {
        const empty = document.createElement('p');
        empty.className = 'cabinet-empty';
        empty.textContent = 'No Customer Files are stored.';
        listEl.appendChild(empty);
        return;
      }
      if (!files.length) {
        const empty = document.createElement('p');
        empty.className = 'cabinet-empty';
        empty.textContent = 'No Customer Files match that search.';
        listEl.appendChild(empty);
        return;
      }
      files.forEach(function (row) {
        listEl.appendChild(rootRow(row));
      });
    }

    function rootRow(row) {
      const article = document.createElement('article');
      article.className = 'explorer-row';
      const key = row && row.key ? row.key : '';
      article.dataset.key = key;
      const main = document.createElement('div');
      main.className = 'explorer-row__main';
      const keyBtn = document.createElement('button');
      keyBtn.type = 'button';
      keyBtn.className = 'explorer-row__key';
      const named = !!(row && row.displayName);
      keyBtn.textContent = (row && row.displayName) || (row && row.propertyAddress) || 'Customer File';
      keyBtn.addEventListener('click', function () {
        if (row && row.id) window.location.hash = '#/explore/' + encodeURIComponent(row.id);
      });
      main.appendChild(keyBtn);
      const secondary = [];
      if (row && row.deletedAt) secondary.push('In File Cabinet Trash');
      if (named && row.propertyAddress) secondary.push(row.propertyAddress);
      const date = usefulDate(row);
      if (date) secondary.push(date);
      if (secondary.length) {
        const p = document.createElement('p');
        p.className = 'explorer-row__label';
        p.textContent = secondary.join(' · ');
        main.appendChild(p);
      } else if (row && row.unreadable) {
        const p = document.createElement('p');
        p.className = 'explorer-row__label';
        p.textContent = 'Stored object could not be read as JSON.';
        main.appendChild(p);
      }
      main.appendChild(technicalKey(key));
      article.appendChild(main);
      const actions = document.createElement('div');
      actions.className = 'explorer-row__actions';
      const open = document.createElement('button');
      open.type = 'button';
      open.className = 'btn btn--secondary';
      open.textContent = 'Open';
      open.addEventListener('click', function () {
        if (row && row.id) window.location.hash = '#/explore/' + encodeURIComponent(row.id);
      });
      actions.appendChild(open);
      article.appendChild(actions);
      return article;
    }

    function showCustomerIdentity(data) {
      const name = data && data.displayName;
      if (name) titleEl.textContent = name;
      const bits = [];
      if (data && data.propertyAddress) bits.push(data.propertyAddress);
      const date = usefulDate(data);
      if (date) bits.push(date);
      if (data && data.deletedAt) bits.push('In File Cabinet Trash');
      if (bits.length) lead.textContent = bits.join(' · ');
    }

    function paintCustomer(id, data) {
      showCustomerIdentity(data || {});
      notesEl.innerHTML = '';
      const notes = Array.isArray(data.referenceNotes) ? data.referenceNotes : [];
      notes.forEach(function (note) {
        const p = document.createElement('p');
        p.className = 'explorer-note';
        p.textContent = note;
        notesEl.appendChild(p);
      });
      const objects = Array.isArray(data.objects) ? data.objects : [];
      listEl.innerHTML = '';
      if (!objects.length) {
        const empty = document.createElement('p');
        empty.className = 'cabinet-empty';
        empty.textContent = 'No objects are stored for this Customer File.';
        listEl.appendChild(empty);
        return;
      }
      const buckets = {};
      objects.forEach(function (row) {
        const info = classify(row, id);
        row._label = info.label;
        row._detail = info.detail;
        const gid = groupIdFor(info.purpose);
        if (!buckets[gid]) buckets[gid] = [];
        buckets[gid].push(row);
      });
      GROUPS.forEach(function (group) {
        const rows = buckets[group.id];
        if (!rows || !rows.length) return;
        rows.sort(function (a, b) {
          const rank = purposeRank(classify(a, id).purpose) - purposeRank(classify(b, id).purpose);
          if (rank) return rank;
          const labelA = String(a._label || '');
          const labelB = String(b._label || '');
          if (labelA < labelB) return -1;
          if (labelA > labelB) return 1;
          return String(a.key || '') < String(b.key || '') ? -1 : 1;
        });
        const section = document.createElement('section');
        section.className = 'explorer-group';
        section.dataset.group = group.id;
        const heading = document.createElement('h2');
        heading.textContent = group.title;
        section.appendChild(heading);
        rows.forEach(function (row) {
          section.appendChild(objectRow(id, row));
        });
        listEl.appendChild(section);
      });
    }

    function objectRow(id, row) {
      const info = classify(row, id);
      const article = document.createElement('article');
      let className = 'explorer-row';
      if (row && row.missing) className += ' explorer-row--missing';
      if (info.purpose === 'floor-pdf') className += ' explorer-row--pdf';
      article.className = className;
      const key = row && row.key ? row.key : '';
      article.dataset.key = key;
      article.dataset.purpose = info.purpose;
      const main = document.createElement('div');
      main.className = 'explorer-row__main';
      const title = document.createElement('strong');
      title.className = 'explorer-row__title';
      title.textContent = info.label;
      main.appendChild(title);
      const note = alsoNote(row) || info.detail;
      const meta = metaLine(row);
      if (note) {
        const p = document.createElement('p');
        p.className = 'explorer-row__label';
        p.textContent = note;
        main.appendChild(p);
      }
      if (meta) {
        const p = document.createElement('p');
        p.className = row && row.missing ? 'explorer-row__missing' : 'explorer-row__label';
        p.textContent = meta;
        main.appendChild(p);
      }
      main.appendChild(technicalKey(key));
      article.appendChild(main);
      const actions = document.createElement('div');
      actions.className = 'explorer-row__actions';
      if (row && !row.missing) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn btn--secondary';
        open.textContent = 'Open';
        open.addEventListener('click', function () {
          openObject(id, key, info.label, preview, showNotice);
        });
        actions.appendChild(open);
        const download = document.createElement('button');
        download.type = 'button';
        download.className = 'btn btn--secondary';
        download.textContent = 'Download';
        download.addEventListener('click', function () {
          downloadObject(id, key, download, showNotice);
        });
        actions.appendChild(download);
      }
      article.appendChild(actions);
      return article;
    }

    function openObject(id, key, label, panel, notify) {
      notify('');
      revokePreview();
      panel.hidden = false;
      panel.innerHTML = '<p class="explorer-preview__status">Opening ' + escapeHtml(label) + '…</p>';
      window.ToolboxSync.exploreFetchObject(id, key).then(function (response) {
        return responseBlob(response);
      }).then(function (loaded) {
        const kind = previewKind(loaded.type);
        panel.innerHTML = '';
        const head = document.createElement('div');
        head.className = 'explorer-preview__head';
        const title = document.createElement('h2');
        title.textContent = label;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn btn--ghost';
        close.textContent = 'Close';
        close.addEventListener('click', function () {
          revokePreview();
          panel.hidden = true;
          panel.innerHTML = '';
        });
        head.appendChild(title);
        head.appendChild(close);
        panel.appendChild(head);
        const meta = document.createElement('p');
        meta.className = 'explorer-preview__meta';
        meta.textContent = loaded.type || 'No content type stored';
        panel.appendChild(meta);
        if (kind === 'image') {
          previewUrl = URL.createObjectURL(loaded.blob);
          const img = document.createElement('img');
          img.className = 'explorer-preview__image';
          img.alt = label;
          img.src = previewUrl;
          panel.appendChild(img);
        } else if (kind === 'pdf') {
          previewUrl = URL.createObjectURL(loaded.blob);
          const frame = document.createElement('iframe');
          frame.className = 'explorer-preview__pdf';
          frame.title = label;
          frame.src = previewUrl;
          panel.appendChild(frame);
        } else if (kind === 'text') {
          const pre = document.createElement('pre');
          pre.className = 'explorer-preview__text';
          const text = new TextDecoder().decode(loaded.buffer);
          const limit = 512 * 1024;
          pre.textContent = text.length > limit ? text.slice(0, limit) : text;
          panel.appendChild(pre);
          if (text.length > limit) {
            const more = document.createElement('p');
            more.className = 'explorer-preview__meta';
            more.textContent = 'Preview shows the first 512 KB. Download for the full object.';
            panel.appendChild(more);
          }
        } else {
          const p = document.createElement('p');
          p.className = 'explorer-preview__meta';
          p.textContent = loaded.type && loaded.type !== 'application/octet-stream'
            ? 'This content type is not previewed. Download the object to keep the original bytes.'
            : 'No previewable content type is stored on this object. Download keeps the original bytes.';
          panel.appendChild(p);
        }
        panel.scrollIntoView({ block: 'nearest' });
      }).catch(function (err) {
        panel.hidden = true;
        panel.innerHTML = '';
        notify(errorText(err));
      });
    }

    function downloadObject(id, key, button, notify) {
      notify('');
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = 'Downloading…';
      window.ToolboxSync.exploreFetchObject(id, key).then(function (response) {
        return responseBlob(response);
      }).then(function (loaded) {
        saveBlob(loaded.blob, downloadName(key));
      }).catch(function (err) {
        notify(errorText(err));
      }).then(function () {
        button.disabled = false;
        button.textContent = previous;
      });
    }

    function downloadArchive(id, button, notify) {
      notify('');
      const previous = button.textContent;
      button.disabled = true;
      button.textContent = 'Preparing ZIP…';
      window.ToolboxSync.exploreFetchArchive(id).then(function (response) {
        const disposition = response.headers.get('content-disposition') || '';
        const named = /filename="([^"]+)"/.exec(disposition);
        const filename = (named && named[1]) || ('cf-' + id + '.zip');
        return responseBlob(response).then(function (loaded) {
          saveBlob(loaded.blob, filename);
        });
      }).catch(function (err) {
        notify(errorText(err));
      }).then(function () {
        button.disabled = false;
        button.textContent = previous;
      });
    }
  }

  const explorerBtn = document.getElementById('app-explorer');
  if (explorerBtn) {
    explorerBtn.addEventListener('click', function () {
      if ((window.location.hash || '') === '#/explore') {
        try { window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (_) {
          window.location.hash = '#/explore';
        }
      } else {
        window.location.hash = '#/explore';
      }
    });
  }

  window.ToolboxFileExplorer = {
    render: renderExplore,
    previewKind: previewKind,
  };
})();
