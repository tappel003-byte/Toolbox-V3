// Toolbox — Report Builder workspace shell.
//
// First shell only: page rail, 11×17 landscape sheet, composition controls,
// and jump links back to the source workspaces. This module does not write
// the Customer File, does not assemble a report, and does not load a template.
// Pages exist only while this workspace stays open.
// Export for AI reads the open Customer File and downloads one ZIP.
// It does not write the Customer File.

(function () {
  'use strict';

  var SHEET_RATIO_LABEL = '11 × 17 landscape';
  var MAX_PAGES = 30;

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
  var SHEET_RATIO = 17 / 11;

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

  function createPage(seq) {
    return { id: 'page-' + seq, seq: seq };
  }

  function mount(host, options) {
    if (!host) return;
    var token = ++mountGeneration;
    var customerFileId = options && options.customerFileId;
    var onBack = options && options.onBack;
    var onOpenSource = options && options.onOpenSource;

    var nextSeq = 1;
    var pages = [createPage(nextSeq)];
    nextSeq += 1;
    var activeId = pages[0].id;
    var activeTool = 'select';

    host.innerHTML = shellHtml();
    var root = host.querySelector('.rb-shell');
    var fileLabelEl = root.querySelector('#rb-file-label');
    var statusEl = root.querySelector('#rb-tool-status');
    var listEl = root.querySelector('#rb-page-list');
    var sheetPageEl = root.querySelector('#rb-sheet-page');
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
      activeId = pages[index].id;
      listEl.textContent = '';
      pages.forEach(function (page, pageIndex) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'rb-thumb' + (page.id === activeId ? ' is-active' : '');
        button.setAttribute('aria-pressed', page.id === activeId ? 'true' : 'false');
        button.setAttribute('aria-label', 'Page ' + (pageIndex + 1));

        var sheet = document.createElement('span');
        sheet.className = 'rb-thumb__sheet';
        sheet.setAttribute('aria-hidden', 'true');
        var num = document.createElement('span');
        num.className = 'rb-thumb__num';
        num.textContent = String(pageIndex + 1);
        sheet.appendChild(num);

        var caption = document.createElement('span');
        caption.className = 'rb-thumb__caption';
        caption.textContent = 'Page ' + (pageIndex + 1);

        button.appendChild(sheet);
        button.appendChild(caption);
        button.addEventListener('click', function () {
          activeId = page.id;
          renderPages();
        });
        listEl.appendChild(button);
      });

      sheetPageEl.textContent = 'Page ' + (index + 1);
      addBtn.disabled = pages.length >= MAX_PAGES;
      removeBtn.disabled = pages.length <= 1;
      earlierBtn.disabled = index <= 0;
      laterBtn.disabled = index >= pages.length - 1;
      duplicateBtn.disabled = pages.length >= MAX_PAGES;
    }

    root.querySelector('#rb-back').addEventListener('click', function () {
      if (typeof onBack === 'function') onBack();
    });

    root.querySelectorAll('[data-rb-source]').forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-rb-source');
        if (typeof onOpenSource === 'function') onOpenSource(key);
      });
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
      var page = createPage(nextSeq);
      nextSeq += 1;
      pages.push(page);
      activeId = page.id;
      renderPages();
    });

    duplicateBtn.addEventListener('click', function () {
      if (pages.length >= MAX_PAGES) return;
      var index = activeIndex();
      var page = createPage(nextSeq);
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
      fileLabelEl.textContent = record ? fileLabel(record) : 'Customer File not on this device';
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
      '    <span class="file-status">Shell</span>' +
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
      '        <span>Not saved</span>' +
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
      '      <article class="rb-sheet" aria-label="' + SHEET_RATIO_LABEL + ' report sheet">' +
      '        <div class="rb-sheet__margin">' +
      '          <p class="rb-sheet__kicker">' + SHEET_RATIO_LABEL + '</p>' +
      '          <h1 class="rb-sheet__title">Blank report sheet</h1>' +
      '          <p class="rb-sheet__note">Template not loaded. This sheet is the composition surface only.</p>' +
      '          <p class="rb-sheet__page" id="rb-sheet-page">Page 1</p>' +
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
      '      <section class="rb-panel__reserve" aria-label="Template">' +
      '        <p class="eyebrow">Report</p>' +
      '        <h3>Template</h3>' +
      '        <p>Reserved for the existing black-and-white report. No template content is placed on the sheet in this shell.</p>' +
      '      </section>' +
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
