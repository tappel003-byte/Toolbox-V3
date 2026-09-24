// Toolbox — Report Builder workspace.
//
// 11×17 landscape sheet, page rail, composition controls, and jump links
// back to the source workspaces. Evidence pages are read from the open
// Customer File through ToolboxReportSource. This module does not write
// the Customer File and does not invent report narrative.
// Pages exist only while this workspace stays open.
// Export for AI reads the open Customer File and downloads one ZIP.

(function () {
  'use strict';

  var SHEET_RATIO_LABEL = '11 × 17 landscape';
  var MAX_PAGES = 40;
  var SHEET_RATIO = 17 / 11;

  var COMPOSE_TOOLS = [
    { id: 'select', label: 'Select' },
    { id: 'text', label: 'Text' },
    { id: 'image', label: 'Image' },
    { id: 'line', label: 'Line' },
    { id: 'arrow', label: 'Arrow' },
    { id: 'shape', label: 'Shape' },
  ];

  var INACTIVE_TOOLS = [
    { id: 'forward', label: 'Bring forward' },
    { id: 'backward', label: 'Send backward' },
    { id: 'align', label: 'Align' },
    { id: 'undo', label: 'Undo' },
    { id: 'redo', label: 'Redo' },
  ];

  var TOOL_STATUS = {
    select: 'Select is highlighted. This shell does not move anything on the sheet.',
    text: 'Text is reserved. This shell does not place text.',
    image: 'Image is reserved. This shell does not place images.',
    line: 'Line is reserved. This shell does not draw lines.',
    arrow: 'Arrow is reserved. This shell does not draw arrows.',
    shape: 'Shape is reserved. This shell does not draw shapes.',
  };

  var mountGeneration = 0;
  var fitObserver = null;
  var fitOnResize = null;

  function fitSheet(root) {
    var stage = root && root.querySelector('.rb-stage');
    var sheet = root && root.querySelector('.rb-sheet');
    if (!stage || !sheet) return;
    var styles = window.getComputedStyle(stage);
    var padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    var padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    var availW = Math.max(0, stage.clientWidth - padX);
    var availH = Math.max(0, stage.clientHeight - padY);
    if (availW < 40 || availH < 40) return;
    var width = availW;
    var height = width / SHEET_RATIO;
    if (height > availH) {
      height = availH;
      width = height * SHEET_RATIO;
    }
    sheet.style.width = Math.floor(width) + 'px';
    sheet.style.height = Math.floor(height) + 'px';
  }

  function watchSheet(root) {
    if (fitObserver) fitObserver.disconnect();
    if (fitOnResize) window.removeEventListener('resize', fitOnResize);
    var stage = root.querySelector('.rb-stage');
    fitOnResize = function () { fitSheet(root); };
    window.addEventListener('resize', fitOnResize);
    if (typeof window.ResizeObserver === 'function' && stage) {
      fitObserver = new window.ResizeObserver(function () { fitSheet(root); });
      fitObserver.observe(stage);
    }
    fitSheet(root);
    window.requestAnimationFrame(function () { fitSheet(root); });
  }

  function identityApi() {
    return window.ToolboxApp && window.ToolboxApp.customerIdentity;
  }

  function fileLabel(record) {
    var api = identityApi();
    if (!record || !api) return 'Customer File';
    var name = api.displayName(record);
    var address = api.displayAddress(record);
    if (!address || address === 'No property address yet') return name;
    return name + ' · ' + address;
  }

  function clonePage(page) {
    return JSON.parse(JSON.stringify(page));
  }

  function blankPage(seq, identity, reason) {
    return {
      id: 'page-' + seq,
      seq: seq,
      kind: 'blank',
      title: 'Blank report sheet',
      sourceKey: null,
      canvasId: null,
      identity: identity || null,
      reason: reason || 'blank',
    };
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function identityLine(identity) {
    if (!identity) return '';
    var parts = [];
    if (identity.name) parts.push(identity.name);
    if (identity.address) parts.push(identity.address);
    return parts.join(' · ');
  }

  function numberLabel(pin) {
    if (!pin) return '';
    if (pin.numberEnd && pin.numberEnd !== pin.number) return pin.number + '–' + pin.numberEnd;
    return String(pin.number);
  }

  function renderBlank(margin, page, index) {
    margin.classList.remove('rb-sheet__margin--evidence');
    margin.appendChild(el('p', 'rb-sheet__kicker', SHEET_RATIO_LABEL));
    var who = identityLine(page.identity);
    if (who) margin.appendChild(el('p', 'rb-sheet__note', who));
    margin.appendChild(el('h1', 'rb-sheet__title', 'Blank report sheet'));
    var note = 'Blank sheet. Nothing has been placed on it.';
    if (page.reason === 'pending') note = 'Reading the Customer File.';
    else if (page.reason === 'empty') note = 'No Distress or Floor Survey evidence is stored on this Customer File yet.';
    margin.appendChild(el('p', 'rb-sheet__note', note));
    margin.appendChild(el('p', 'rb-sheet__page', 'Page ' + (index + 1)));
  }

  function renderEvidenceHead(page) {
    var head = el('header', 'rb-evidence__head');
    var who = identityLine(page.identity);
    if (who) head.appendChild(el('p', 'rb-evidence__identity', who));
    var dateText = '';
    if (page.kind === 'floor-topo' && page.surveyDate) dateText = 'Survey date ' + page.surveyDate;
    else if (page.identity && page.identity.fileDate) dateText = 'File updated ' + page.identity.fileDate;
    if (dateText) head.appendChild(el('p', 'rb-evidence__date', dateText));
    head.appendChild(el('h1', 'rb-evidence__title', page.title || 'Report sheet'));
    return head;
  }

  function renderJump(page) {
    var label = page.sourceKey === 'floor' ? 'Open Floor Survey' : 'Open Distress Survey';
    var button = el('button', 'rb-jump', label);
    button.type = 'button';
    button.setAttribute('data-rb-source', page.sourceKey);
    if (page.canvasId) button.setAttribute('data-rb-canvas', page.canvasId);
    return button;
  }

  function renderDistress(margin, page, index) {
    margin.classList.add('rb-sheet__margin--evidence');
    margin.appendChild(renderEvidenceHead(page));
    var body = el('div', 'rb-evidence');
    var planSlot = el('div', 'rb-plan-slot');
    var plan = page.plan || {};
    var ratio = plan.width && plan.height ? (plan.width / plan.height) : 1;
    var frame = el('div', 'rb-plan-frame');
    frame.style.setProperty('--plan-ratio', String(ratio));
    if (plan.dataUrl) {
      var image = el('img', 'rb-plan-frame__img');
      image.alt = page.levelName ? page.levelName + ' plan' : 'Floor plan';
      image.src = plan.dataUrl;
      frame.appendChild(image);
    } else {
      frame.appendChild(el('p', 'rb-plan-frame__missing', 'Plan image is not on this device.'));
    }
    (page.pins || []).forEach(function (pin) {
      if (!pin.position) return;
      var mark = el('span', 'rb-pin', numberLabel(pin));
      var x = Math.max(0, Math.min(1, pin.position.x));
      var y = Math.max(0, Math.min(1, pin.position.y));
      mark.style.left = (x * 100) + '%';
      mark.style.top = (y * 100) + '%';
      frame.appendChild(mark);
    });
    planSlot.appendChild(frame);
    body.appendChild(planSlot);

    var list = el('div', 'rb-obs-list');
    if (!(page.pins || []).length) {
      list.appendChild(el('p', 'rb-obs__empty', 'No observations on this level.'));
    }
    (page.pins || []).forEach(function (pin) {
      var item = el('article', 'rb-obs');
      item.appendChild(el('h2', 'rb-obs__num', numberLabel(pin)));
      var place = [pin.location, pin.category].filter(Boolean).join(' · ');
      if (pin.isExterior) place = place ? place + ' · Exterior' : 'Exterior';
      if (place) item.appendChild(el('p', 'rb-obs__place', place));
      if (pin.text) item.appendChild(el('p', 'rb-obs__text', pin.text));
      var photos = el('div', 'rb-obs__photos');
      (pin.photos || []).forEach(function (photo) {
        var fig = el('figure', 'rb-photo');
        fig.appendChild(el('figcaption', 'rb-photo__num', String(photo.displayNumber)));
        if (photo.dataUrl) {
          var img = el('img', 'rb-photo__img');
          img.alt = 'Photo ' + photo.displayNumber;
          img.src = photo.dataUrl;
          fig.appendChild(img);
        } else {
          fig.appendChild(el('span', 'rb-photo__missing', 'Not on this device'));
        }
        photos.appendChild(fig);
      });
      if ((pin.photos || []).length) item.appendChild(photos);
      list.appendChild(item);
    });
    body.appendChild(list);
    margin.appendChild(body);
    var foot = el('footer', 'rb-evidence__foot');
    foot.appendChild(renderJump(page));
    foot.appendChild(el('p', 'rb-sheet__page', 'Page ' + (index + 1)));
    margin.appendChild(foot);
  }

  function renderFloor(margin, page, index) {
    margin.classList.add('rb-sheet__margin--evidence');
    margin.appendChild(renderEvidenceHead(page));
    var figure = page.figure || {};
    var frame = el('div', 'rb-figure');
    frame.setAttribute('data-figure-kind', figure.kind || 'unavailable');
    if (figure.mediaId) frame.setAttribute('data-media-id', figure.mediaId);
    if (figure.kind === 'stored-rendering' && figure.dataUrl && figure.mime === 'pdf') {
      var object = document.createElement('object');
      object.className = 'rb-figure__pdf';
      object.type = 'application/pdf';
      object.data = figure.dataUrl;
      object.appendChild(el('p', 'rb-figure__fallback', 'Finished Floor Survey rendering'));
      frame.appendChild(object);
    } else if (figure.kind === 'stored-rendering' && figure.dataUrl && figure.mime === 'image') {
      var image = el('img', 'rb-figure__img');
      image.alt = page.title || 'Floor Survey rendering';
      image.src = figure.dataUrl;
      frame.appendChild(image);
    } else {
      frame.appendChild(el('p', 'rb-figure__note', page.note || 'The finished Floor Survey rendering is not stored for this level. Readings were not redrawn here.'));
    }
    if (page.areaNames && page.areaNames.length && !page.areaName) {
      frame.appendChild(el('p', 'rb-figure__areas', 'Areas: ' + page.areaNames.join(', ')));
    }
    margin.appendChild(frame);
    var foot = el('footer', 'rb-evidence__foot');
    foot.appendChild(renderJump(page));
    foot.appendChild(el('p', 'rb-sheet__page', 'Page ' + (index + 1)));
    margin.appendChild(foot);
  }

  function renderSheet(root, page, index) {
    var sheet = root.querySelector('.rb-sheet');
    var margin = root.querySelector('#rb-sheet-margin');
    if (!sheet || !margin || !page) return;
    var evidence = page.kind === 'distress-level' || page.kind === 'floor-topo';
    sheet.classList.toggle('is-evidence', evidence);
    sheet.setAttribute('aria-label', (page.title || SHEET_RATIO_LABEL) + ' report sheet');
    sheet.setAttribute('data-page-kind', page.kind || 'blank');
    if (page.canvasId) sheet.setAttribute('data-canvas-id', page.canvasId);
    else sheet.removeAttribute('data-canvas-id');
    margin.textContent = '';
    if (page.kind === 'distress-level') renderDistress(margin, page, index);
    else if (page.kind === 'floor-topo') renderFloor(margin, page, index);
    else renderBlank(margin, page, index);
  }

  function mount(host, options) {
    if (!host) return;
    var token = ++mountGeneration;
    var customerFileId = options && options.customerFileId;
    var onBack = options && options.onBack;
    var onOpenSource = options && options.onOpenSource;

    var nextSeq = 1;
    var pages = [blankPage(nextSeq, null, 'pending')];
    nextSeq += 1;
    var activeId = pages[0].id;
    var activeTool = 'select';
    var loadedIdentity = null;

    host.innerHTML = shellHtml();
    var root = host.querySelector('.rb-shell');
    var fileLabelEl = root.querySelector('#rb-file-label');
    var modeEl = root.querySelector('#rb-mode');
    var statusEl = root.querySelector('#rb-tool-status');
    var listEl = root.querySelector('#rb-page-list');
    var addBtn = root.querySelector('#rb-add-page');
    var duplicateBtn = root.querySelector('#rb-duplicate-page');
    var removeBtn = root.querySelector('#rb-remove-page');
    var earlierBtn = root.querySelector('#rb-page-earlier');
    var laterBtn = root.querySelector('#rb-page-later');

    function activeIndex() {
      for (var i = 0; i < pages.length; i += 1) {
        if (pages[i].id === activeId) return i;
      }
      return 0;
    }

    function setToolStatus() {
      statusEl.textContent = TOOL_STATUS[activeTool] || TOOL_STATUS.select;
    }

    function renderPages() {
      var index = activeIndex();
      if (index < 0) index = 0;
      if (!pages.length) {
        pages = [blankPage(nextSeq, loadedIdentity, 'blank')];
        nextSeq += 1;
        index = 0;
      }
      activeId = pages[index].id;
      listEl.textContent = '';
      pages.forEach(function (page, pageIndex) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'rb-thumb' + (page.id === activeId ? ' is-active' : '');
        button.setAttribute('aria-pressed', page.id === activeId ? 'true' : 'false');
        button.setAttribute('aria-label', 'Page ' + (pageIndex + 1) + ', ' + (page.title || 'Report sheet'));

        var sheet = document.createElement('span');
        sheet.className = 'rb-thumb__sheet';
        sheet.setAttribute('aria-hidden', 'true');
        var num = document.createElement('span');
        num.className = 'rb-thumb__num';
        num.textContent = String(pageIndex + 1);
        sheet.appendChild(num);

        var caption = document.createElement('span');
        caption.className = 'rb-thumb__caption';
        caption.textContent = page.title || ('Page ' + (pageIndex + 1));

        button.appendChild(sheet);
        button.appendChild(caption);
        button.addEventListener('click', function () {
          activeId = page.id;
          renderPages();
        });
        listEl.appendChild(button);
      });

      renderSheet(root, pages[index], index);
      addBtn.disabled = pages.length >= MAX_PAGES;
      removeBtn.disabled = pages.length <= 1;
      earlierBtn.disabled = index <= 0;
      laterBtn.disabled = index >= pages.length - 1;
      duplicateBtn.disabled = pages.length >= MAX_PAGES;
    }

    root.querySelector('#rb-back').addEventListener('click', function () {
      if (typeof onBack === 'function') onBack();
    });

    root.addEventListener('click', function (event) {
      var button = event.target.closest('[data-rb-source]');
      if (!button || !root.contains(button)) return;
      var key = button.getAttribute('data-rb-source');
      var canvasId = button.getAttribute('data-rb-canvas');
      if (typeof onOpenSource === 'function') {
        onOpenSource(key, canvasId ? { canvasId: canvasId } : undefined);
      }
    });

    root.querySelectorAll('[data-rb-tool]').forEach(function (button) {
      button.addEventListener('click', function () {
        activeTool = button.getAttribute('data-rb-tool');
        root.querySelectorAll('[data-rb-tool]').forEach(function (peer) {
          var on = peer === button;
          peer.classList.toggle('is-active', on);
          peer.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        setToolStatus();
      });
    });

    addBtn.addEventListener('click', function () {
      if (pages.length >= MAX_PAGES) return;
      var page = blankPage(nextSeq, loadedIdentity, 'blank');
      nextSeq += 1;
      pages.push(page);
      activeId = page.id;
      renderPages();
    });

    duplicateBtn.addEventListener('click', function () {
      if (pages.length >= MAX_PAGES) return;
      var index = activeIndex();
      var page = clonePage(pages[index]);
      page.seq = nextSeq;
      page.id = 'page-' + nextSeq;
      nextSeq += 1;
      pages.splice(index + 1, 0, page);
      activeId = page.id;
      renderPages();
    });

    removeBtn.addEventListener('click', function () {
      if (pages.length <= 1) return;
      var index = activeIndex();
      pages.splice(index, 1);
      activeId = pages[Math.min(index, pages.length - 1)].id;
      renderPages();
    });

    earlierBtn.addEventListener('click', function () {
      var index = activeIndex();
      if (index <= 0) return;
      var moved = pages[index];
      pages[index] = pages[index - 1];
      pages[index - 1] = moved;
      renderPages();
    });

    laterBtn.addEventListener('click', function () {
      var index = activeIndex();
      if (index >= pages.length - 1) return;
      var moved = pages[index];
      pages[index] = pages[index + 1];
      pages[index + 1] = moved;
      renderPages();
    });

    var exportBtn = root.querySelector('#rb-export-ai');
    var exportStatus = root.querySelector('#rb-ai-status');
    exportBtn.addEventListener('click', function () {
      if (!window.ToolboxAiExport || typeof window.ToolboxAiExport.exportCheckedOutFile !== 'function') {
        exportStatus.textContent = 'Export for AI is not available in this session.';
        return;
      }
      exportBtn.disabled = true;
      exportStatus.textContent = 'Preparing the AI package…';
      window.ToolboxAiExport.exportCheckedOutFile(customerFileId).then(function (result) {
        var name = result && result.filename ? result.filename : 'the AI package';
        exportStatus.textContent = 'Downloaded ' + name + '.';
      }).catch(function (error) {
        exportStatus.textContent = error && error.message
          ? error.message
          : 'Export failed. This Customer File was not changed.';
      }).then(function () {
        exportBtn.disabled = false;
      });
    });

    setToolStatus();
    renderPages();
    watchSheet(root);
    fileLabelEl.textContent = 'Loading Customer File…';

    function applySource(record, source) {
      loadedIdentity = source && source.identity ? source.identity : null;
      var evidence = source && Array.isArray(source.pages) ? source.pages : [];
      if (evidence.length) {
        pages = evidence.map(function (page) {
          var copy = clonePage(page);
          copy.seq = nextSeq;
          nextSeq += 1;
          return copy;
        });
        modeEl.textContent = 'Evidence';
      } else {
        pages = [blankPage(nextSeq, loadedIdentity, 'empty')];
        nextSeq += 1;
        modeEl.textContent = 'Shell';
      }
      activeId = pages[0].id;
      fileLabelEl.textContent = record ? fileLabel(record) : 'Customer File not on this device';
      renderPages();
      fitSheet(root);
    }

    if (!window.ToolboxDB || typeof window.ToolboxDB.getCustomerFile !== 'function' || !customerFileId) {
      fileLabelEl.textContent = 'Customer File';
      return;
    }

    window.ToolboxDB.getCustomerFile(customerFileId).then(function (record) {
      if (token !== mountGeneration) return;
      if (record && record.deletedAt) {
        window.location.replace('#/trash');
        return;
      }
      if (!record || !window.ToolboxReportSource || typeof window.ToolboxReportSource.assemble !== 'function') {
        fileLabelEl.textContent = record ? fileLabel(record) : 'Customer File not on this device';
        return;
      }
      return window.ToolboxReportSource.assemble(record).then(function (source) {
        if (token !== mountGeneration) return;
        applySource(record, source);
      });
    }).catch(function () {
      if (token !== mountGeneration) return;
      fileLabelEl.textContent = 'Customer File';
    });
  }

  function shellHtml() {
    return (
      '<div class="rb-shell">' +
      '  <div class="view-bar view-bar--file rb-identity">' +
      '    <button type="button" id="rb-back" class="btn btn--ghost">‹ Customer File</button>' +
      '    <div class="file-identity">' +
      '      <span class="file-identity__name">Report Builder</span>' +
      '      <span class="file-identity__address" id="rb-file-label"></span>' +
      '    </div>' +
      '    <span class="file-status" id="rb-mode">Shell</span>' +
      '  </div>' +
      '  <div class="rb-toolbar">' +
      '    <div class="rb-toolbar__tools" role="toolbar" aria-label="Report composition">' +
             toolButtons() +
      '    </div>' +
      '    <button type="button" id="rb-export-ai" class="btn btn--accent rb-export">Export for AI</button>' +
      '    <p class="rb-toolbar__status" id="rb-tool-status" aria-live="polite"></p>' +
      '    <p class="rb-ai-status" id="rb-ai-status" aria-live="polite"></p>' +
      '  </div>' +
      '  <div class="rb-workspace">' +
      '    <aside class="rb-rail" aria-label="Report pages">' +
      '      <div class="rb-rail__head">' +
      '        <p class="eyebrow">Pages</p>' +
      '        <strong>Report sheets</strong>' +
      '        <span id="rb-rail-note">Not saved</span>' +
      '      </div>' +
      '      <div class="rb-rail__list" id="rb-page-list"></div>' +
      '      <div class="rb-rail__actions">' +
      '        <button type="button" id="rb-add-page" class="btn btn--secondary">Add page</button>' +
      '        <button type="button" id="rb-duplicate-page" class="btn btn--quiet">Duplicate</button>' +
      '        <button type="button" id="rb-remove-page" class="btn btn--quiet">Remove</button>' +
      '        <button type="button" id="rb-page-earlier" class="btn btn--quiet">Earlier</button>' +
      '        <button type="button" id="rb-page-later" class="btn btn--quiet">Later</button>' +
      '      </div>' +
      '    </aside>' +
      '    <div class="rb-stage">' +
      '      <article class="rb-sheet" id="rb-sheet" aria-label="' + SHEET_RATIO_LABEL + ' report sheet">' +
      '        <div class="rb-sheet__margin" id="rb-sheet-margin">' +
      '          <p class="rb-sheet__kicker">' + SHEET_RATIO_LABEL + '</p>' +
      '          <h1 class="rb-sheet__title">Blank report sheet</h1>' +
      '          <p class="rb-sheet__note">Reading the Customer File.</p>' +
      '          <p class="rb-sheet__page">Page 1</p>' +
      '        </div>' +
      '      </article>' +
      '    </div>' +
      '    <aside class="rb-panel" aria-label="Toolbox">' +
      '      <p class="eyebrow">Toolbox</p>' +
      '      <h2>Source workspaces</h2>' +
      '      <p class="rb-panel__lead">Open the workspace that owns the source. Report Builder does not edit it here.</p>' +
      '      <div class="rb-panel__links">' +
      '        <button type="button" class="btn btn--secondary" data-rb-source="floor">Open Floor Survey</button>' +
      '        <button type="button" class="btn btn--secondary" data-rb-source="distress">Open Distress Survey</button>' +
      '        <button type="button" class="btn btn--secondary" data-rb-source="diagnostics">Open Diagnostics</button>' +
      '      </div>' +
      '    </aside>' +
      '  </div>' +
      '</div>'
    );
  }

  function toolButtons() {
    var html = COMPOSE_TOOLS.map(function (tool) {
      var pressed = tool.id === 'select' ? 'true' : 'false';
      var active = tool.id === 'select' ? ' is-active' : '';
      return '<button type="button" class="rb-tool' + active + '" data-rb-tool="' + tool.id + '" aria-pressed="' + pressed + '">' + tool.label + '</button>';
    }).join('');
    html += '<span class="rb-tool-sep" aria-hidden="true"></span>';
    html += INACTIVE_TOOLS.map(function (tool) {
      return '<button type="button" class="rb-tool" disabled title="Shown for layout. Not available in this shell.">' + tool.label + '</button>';
    }).join('');
    return html;
  }

  function unmount() {
    mountGeneration += 1;
    if (fitObserver) {
      fitObserver.disconnect();
      fitObserver = null;
    }
    if (fitOnResize) {
      window.removeEventListener('resize', fitOnResize);
      fitOnResize = null;
    }
  }

  window.ToolboxReportBuilder = {
    mount: mount,
    unmount: unmount,
  };
})();
