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

  function formatUploaded(iso) {
    if (!iso) return '';
    const date = new Date(iso);
    if (isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  function downloadName(key) {
    return String(key || 'object').replace(/[^A-Za-z0-9._-]+/g, '_') || 'object';
  }

  function objectLabel(row, id) {
    const key = String(row && row.key || '');
    const prefix = 'cf/' + id + '/';
    const names = {
      'index.json': 'Customer information',
      'plans.json': 'Plans and canvases',
      'distress.json': 'Distress Survey',
      'floor.json': 'Floor Survey',
      'diagnostics.json': 'Diagnostics',
      'report.json': 'Report Builder',
      'trash.json': 'Trash record',
    };
    if (key.indexOf(prefix) === 0) {
      const filename = key.slice(prefix.length);
      return names[filename] || filename.replace(/\.json$/i, '').replace(/[-_]/g, ' ');
    }
    if (key.indexOf('media/') === 0) {
      const mediaId = key.slice('media/'.length);
      if (mediaId.indexOf('fsrec_') === 0) return 'Floor Survey recovery PDF';
      if (mediaId.indexOf('dxfig_') === 0) return 'Diagnostics figure';
      if (mediaId.indexOf('ph_') === 0) return 'Distress or Quick Capture photo';
      if (mediaId.indexOf('plan-') === 0) return 'Floor plan image';
      if (previewKind(row && row.contentType) === 'image') return 'Stored image';
      if (previewKind(row && row.contentType) === 'pdf') return 'Stored PDF';
      return 'Stored media';
    }
    return 'Stored file';
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
      '        <h1>File Explorer</h1>' +
      '        <p id="explorer-lead"></p>' +
      '      </div>' +
      (inside
        ? '<button type="button" id="explorer-zip" class="btn btn--secondary">Download ZIP</button>'
        : '') +
      '    </header>' +
      '    <p class="explorer-crumb" id="explorer-crumb"></p>' +
      '    <p class="cabinet-notice" id="explorer-notice" hidden></p>' +
      '    <div id="explorer-notes"></div>' +
      '    <div class="explorer-list" id="explorer-list">' +
      '      <p class="cabinet-empty">Loading server objects…</p>' +
      '    </div>' +
      '    <section class="explorer-preview" id="explorer-preview" hidden></section>' +
      '  </section>' +
      '</div>',
    );

    const lead = app.querySelector('#explorer-lead');
    const crumb = app.querySelector('#explorer-crumb');
    const listEl = app.querySelector('#explorer-list');
    const notesEl = app.querySelector('#explorer-notes');
    const notice = app.querySelector('#explorer-notice');
    const preview = app.querySelector('#explorer-preview');

    lead.textContent = inside
      ? 'Stored Customer File information, surveys, plans, and media. Missing items are marked not stored.'
      : 'Customer Files stored on the server. Open a file to see its contents.';
    crumb.textContent = inside ? 'File Explorer / Customer File contents' : '';

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
        const files = data && Array.isArray(data.files) ? data.files : [];
        paintRoot(files);
      }).catch(function (err) {
        listEl.innerHTML = '';
        showNotice(errorText(err));
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

    function paintRoot(files) {
      listEl.innerHTML = '';
      if (!files.length) {
        const empty = document.createElement('p');
        empty.className = 'cabinet-empty';
        empty.textContent = 'No Customer Files are stored.';
        listEl.appendChild(empty);
        return;
      }
      const head = document.createElement('div');
      head.className = 'explorer-columns';
      head.innerHTML = '<span>Customer File</span><span>Type</span><span>Size</span><span>Uploaded</span><span></span>';
      listEl.appendChild(head);
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
      keyBtn.textContent = row && row.displayName || row && row.propertyAddress || 'Customer File';
      keyBtn.addEventListener('click', function () {
        if (row && row.id) window.location.hash = '#/explore/' + encodeURIComponent(row.id);
      });
      main.appendChild(keyBtn);
      if (row && row.propertyAddress && row.displayName) {
        const p = document.createElement('p');
        p.className = 'explorer-row__label';
        p.textContent = row.propertyAddress;
        main.appendChild(p);
      } else if (row && row.unreadable) {
        const p = document.createElement('p');
        p.className = 'explorer-row__label';
        p.textContent = 'Stored object could not be read as JSON.';
        main.appendChild(p);
      }
      main.appendChild(technicalKey(key));
      article.appendChild(main);
      article.appendChild(metaNode(row));
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

    function paintCustomer(id, data) {
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
      const head = document.createElement('div');
      head.className = 'explorer-columns';
      head.innerHTML = '<span>Stored item</span><span>Type</span><span>Size</span><span>Uploaded</span><span></span>';
      listEl.appendChild(head);
      objects.forEach(function (row) {
        listEl.appendChild(objectRow(id, row));
      });
    }

    function metaNode(row) {
      const meta = document.createElement('div');
      meta.className = 'explorer-row__meta';
      const type = document.createElement('span');
      const size = document.createElement('span');
      size.className = 'explorer-row__size';
      const time = document.createElement('time');
      time.className = 'explorer-row__date';
      if (row && row.missing) {
        type.className = 'explorer-row__missing';
        type.textContent = 'Not stored';
      } else {
        type.className = 'explorer-row__type';
        type.textContent = typeLabel(row && row.contentType);
        size.textContent = formatBytes(row && row.size);
        if (row && row.uploaded) {
          time.dateTime = row.uploaded;
          time.textContent = formatUploaded(row.uploaded);
        }
      }
      meta.appendChild(type);
      meta.appendChild(size);
      meta.appendChild(time);
      return meta;
    }

    function objectRow(id, row) {
      const article = document.createElement('article');
      article.className = 'explorer-row' + (row && row.missing ? ' explorer-row--missing' : '');
      const key = row && row.key ? row.key : '';
      article.dataset.key = key;
      const main = document.createElement('div');
      main.className = 'explorer-row__main';
      const title = document.createElement('strong');
      title.className = 'explorer-row__title';
      title.textContent = objectLabel(row, id);
      main.appendChild(title);
      main.appendChild(technicalKey(key));
      article.appendChild(main);
      article.appendChild(metaNode(row));
      const actions = document.createElement('div');
      actions.className = 'explorer-row__actions';
      if (row && !row.missing) {
        const open = document.createElement('button');
        open.type = 'button';
        open.className = 'btn btn--secondary';
        open.textContent = 'Open';
        open.addEventListener('click', function () {
          openObject(id, key, objectLabel(row, id), preview, showNotice);
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
          img.alt = key;
          img.src = previewUrl;
          panel.appendChild(img);
        } else if (kind === 'pdf') {
          previewUrl = URL.createObjectURL(loaded.blob);
          const frame = document.createElement('iframe');
          frame.className = 'explorer-preview__pdf';
          frame.title = key;
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
