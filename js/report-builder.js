// Toolbox — Report Builder workspace.
//
// 11×17 landscape sheets, page rail, composition controls, and jump links
// back to the source workspaces. The opening sequence comes from
// ToolboxReportSource (issue #66 skeleton + the #65 evidence contract).
// Pages exist only while this workspace stays open. This module does not
// write the Customer File and does not invent report narrative.
// Export for AI reads the open Customer File and downloads one ZIP.

(function () {
  'use strict';

  var SHEET_RATIO_LABEL = '11 × 17 landscape';
  var MAX_PAGES = 80;
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
    select: 'Select is highlighted. This skeleton does not move anything on the sheet.',
    text: 'Text is reserved. This skeleton does not place text.',
    image: 'Image is reserved. This skeleton does not place images.',
    line: 'Line is reserved. This skeleton does not draw lines.',
    arrow: 'Arrow is reserved. This skeleton does not draw arrows.',
    shape: 'Shape is reserved. This skeleton does not draw shapes.',
  };

  var mountGeneration = 0;
  var fitObserver = null;
  var fitOnResize = null;
  var pageSeq = 1;

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

  function sourceApi() {
    return window.ToolboxReportSource;
  }

  function blankSequence() {
    var api = sourceApi();
    if (api && typeof api.assemble === 'function') return api.assemble(api.read(null));
    return { pages: [{ id: 'page-1', type: 'sheet', title: 'Sheet', railLabel: 'Sheet', includeInToc: true, note: '', sourceKey: null, meta: null }] };
  }

  function addedPage() {
    pageSeq += 1;
    return {
      id: 'page-' + pageSeq,
      type: 'sheet',
      title: 'Sheet',
      railLabel: 'Sheet',
      note: 'Added in this session. Not saved.',
      sourceKey: null,
      sourceRef: null,
      includeInToc: true,
      meta: null,
    };
  }

  function clonePage(source) {
    pageSeq += 1;
    return {
      id: 'page-' + pageSeq,
      type: source.type,
      title: source.title,
      tocTitle: source.tocTitle || source.title,
      railLabel: (source.railLabel || source.title) + ' copy',
      note: source.note,
      sourceKey: source.sourceKey,
      sourceRef: source.sourceRef,
      includeInToc: source.includeInToc !== false,
      meta: source.meta,
    };
  }

  function countLine(count, singular, plural) {
    return count + ' ' + (count === 1 ? singular : plural);
  }

  function addLine(parent, className, text) {
    var el = document.createElement('p');
    el.className = className;
    el.textContent = text;
    parent.appendChild(el);
    return el;
  }

  function renderSheet(sheet, page, pages) {
    sheet.textContent = '';
    sheet.setAttribute('data-page-id', page.id);
    sheet.setAttribute('data-page-type', page.type || 'sheet');
    sheet.setAttribute('aria-label', (page.title || 'Report sheet') + ', ' + SHEET_RATIO_LABEL);

    var margin = document.createElement('div');
    margin.className = 'rb-sheet__margin';

    var index = 0;
    for (var i = 0; i < pages.length; i += 1) {
      if (pages[i].id === page.id) index = i;
    }

    if (page.type === 'cover') {
      addLine(margin, 'rb-sheet__kicker', 'Report');
      addLine(margin, 'rb-sheet__kicker rb-sheet__kicker--quiet', SHEET_RATIO_LABEL);
      var title = document.createElement('h1');
      title.className = 'rb-sheet__title';
      title.textContent = page.title || 'Customer File';
      margin.appendChild(title);
      var meta = page.meta || {};
      addLine(margin, 'rb-sheet__meta', meta.address || 'No property address on file');
      if (meta.floorSurveyDate) addLine(margin, 'rb-sheet__meta', 'Floor Survey date ' + meta.floorSurveyDate);
      addLine(margin, 'rb-sheet__note', page.note || '');
    } else if (page.type === 'toc') {
      addLine(margin, 'rb-sheet__kicker', 'Report');
      var tocTitle = document.createElement('h1');
      tocTitle.className = 'rb-sheet__title';
      tocTitle.textContent = 'Table of Contents';
      margin.appendChild(tocTitle);
      var list = document.createElement('div');
      list.className = 'rb-toc';
      var api = sourceApi();
      var entries = api && typeof api.contents === 'function' ? api.contents(pages) : [];
      if (!entries.length) {
        addLine(list, 'rb-sheet__note', 'No sections are included.');
      }
      entries.forEach(function (entry) {
        var row = document.createElement('button');
        row.type = 'button';
        row.className = 'rb-toc__item';
        row.setAttribute('data-rb-goto', entry.pageId);
        var label = document.createElement('span');
        label.textContent = entry.title;
        var number = document.createElement('span');
        number.className = 'rb-toc__num';
        number.textContent = String(entry.number);
        row.appendChild(label);
        row.appendChild(number);
        list.appendChild(row);
      });
      margin.appendChild(list);
    } else if (page.type === 'section' && page.meta && page.meta.sectionId === 'property') {
      addLine(margin, 'rb-sheet__kicker', 'Report');
      var propertyTitle = document.createElement('h1');
      propertyTitle.className = 'rb-sheet__title';
      propertyTitle.textContent = 'Property';
      margin.appendChild(propertyTitle);
      var rows = document.createElement('dl');
      rows.className = 'rb-dl';
      (page.meta.rows || []).forEach(function (row) {
        var dt = document.createElement('dt');
        dt.textContent = row[0];
        var dd = document.createElement('dd');
        dd.textContent = row[1];
        rows.appendChild(dt);
        rows.appendChild(dd);
      });
      margin.appendChild(rows);
    } else if (page.type === 'distress' || page.type === 'floor' || page.type === 'diagnostics') {
      var kicker = page.type === 'distress' ? 'Distress Survey' : page.type === 'floor' ? 'Floor Survey' : 'Diagnostics';
      addLine(margin, 'rb-sheet__kicker', kicker);
      var evidenceTitle = document.createElement('h1');
      evidenceTitle.className = 'rb-sheet__title';
      evidenceTitle.textContent = page.title || kicker;
      margin.appendChild(evidenceTitle);
      var metaLine = evidenceMeta(page);
      if (metaLine) addLine(margin, 'rb-sheet__meta', metaLine);
      var figure = document.createElement('div');
      figure.className = 'rb-figure';
      figure.textContent = figureLabel(page);
      margin.appendChild(figure);
      if (page.note) addLine(margin, 'rb-sheet__note', page.note);
    } else {
      addLine(margin, 'rb-sheet__kicker', 'Report');
      var sectionTitle = document.createElement('h1');
      sectionTitle.className = 'rb-sheet__title';
      sectionTitle.textContent = page.title || 'Sheet';
      margin.appendChild(sectionTitle);
      if (page.note) addLine(margin, 'rb-sheet__note', page.note);
    }

    var footer = document.createElement('p');
    footer.className = 'rb-sheet__page';
    footer.id = 'rb-sheet-page';
    footer.textContent = 'Page ' + (index + 1);
    margin.appendChild(footer);
    sheet.appendChild(margin);
  }

  function evidenceMeta(page) {
    var meta = page.meta || {};
    if (page.type === 'distress' && !meta.reserved) {
      return countLine(meta.pinCount || 0, 'observation', 'observations') +
        ' · ' + countLine(meta.photoCount || 0, 'photograph', 'photographs');
    }
    if (page.type === 'floor' && !meta.reserved) {
      var parts = [];
      if (meta.epochLabel) parts.push(meta.epochLabel);
      if (meta.surveyDate) parts.push(meta.surveyDate);
      if (meta.areaCount > 1) parts.push(countLine(meta.areaCount, 'topo area', 'topo areas'));
      parts.push(countLine(meta.readingCount || 0, 'reading', 'readings'));
      return parts.join(' · ');
    }
    return '';
  }

  function figureLabel(page) {
    var meta = page.meta || {};
    if (page.type === 'floor') {
      if (meta.figureMediaId) return 'Stored topo figure';
      return 'Topo figure reserved';
    }
    if (page.type === 'distress') {
      return meta.reserved ? 'Distress Survey reserved' : 'Distress plan and photographs reserved';
    }
    return meta.reserved ? 'Diagnostics reserved' : 'Diagnostics figure reserved';
  }

  function propertyRows(source) {
    var customer = source && source.customer ? source.customer : {};
    var rows = [
      ['Name', customer.name || 'New Customer File'],
      ['Property', customer.address || 'No property address on file'],
    ];
    if (customer.companyName) rows.push(['Company', customer.companyName]);
    if (customer.cellPhone) rows.push(['Cell', customer.cellPhone]);
    if (customer.email) rows.push(['Email', customer.email]);
    if (source && source.floorSurveyDate) rows.push(['Floor Survey date', source.floorSurveyDate]);
    return rows;
  }

  function withProperty(sequence, source) {
    (sequence.pages || []).forEach(function (item) {
      if (item.type === 'section' && item.meta && item.meta.sectionId === 'property') {
        item.meta.rows = propertyRows(source);
      }
    });
    return sequence;
  }

  function mount(host, options) {
    if (!host) return;
    var token = ++mountGeneration;
    var customerFileId = options && options.customerFileId;
    var onBack = options && options.onBack;
    var onOpenSource = options && options.onOpenSource;

    var sequence = withProperty(blankSequence(), null);
    var pages = sequence.pages.slice();
    var activeId = pages[0] ? pages[0].id : '';
    var activeTool = 'select';
    var dirty = false;
    pageSeq = pages.length;

    host.innerHTML = shellHtml();
    var root = host.querySelector('.rb-shell');
    var fileLabelEl = root.querySelector('#rb-file-label');
    var statusEl = root.querySelector('#rb-tool-status');
    var listEl = root.querySelector('#rb-page-list');
    var sheetEl = root.querySelector('.rb-sheet');
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

    function activePage() {
      return pages[activeIndex()] || pages[0];
    }

    function setToolStatus() {
      statusEl.textContent = TOOL_STATUS[activeTool] || TOOL_STATUS.select;
    }

    function renderPages() {
      if (!pages.length) return;
      var index = activeIndex();
      if (index < 0) index = 0;
      activeId = pages[index].id;
      var current = pages[index];
      listEl.textContent = '';
      pages.forEach(function (item, pageIndex) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'rb-thumb' + (item.id === activeId ? ' is-active' : '');
        button.setAttribute('aria-pressed', item.id === activeId ? 'true' : 'false');
        button.setAttribute('aria-label', (item.railLabel || item.title || 'Page') + ', page ' + (pageIndex + 1));
        button.setAttribute('data-page-id', item.id);

        var thumb = document.createElement('span');
        thumb.className = 'rb-thumb__sheet';
        thumb.setAttribute('aria-hidden', 'true');
        var num = document.createElement('span');
        num.className = 'rb-thumb__num';
        num.textContent = String(pageIndex + 1);
        thumb.appendChild(num);

        var caption = document.createElement('span');
        caption.className = 'rb-thumb__caption';
        caption.textContent = item.railLabel || item.title || ('Page ' + (pageIndex + 1));

        button.appendChild(thumb);
        button.appendChild(caption);
        button.addEventListener('click', function () {
          activeId = item.id;
          renderPages();
        });
        listEl.appendChild(button);
      });

      renderSheet(sheetEl, current, pages);
      root.querySelectorAll('[data-rb-source]').forEach(function (button) {
        var on = button.getAttribute('data-rb-source') === current.sourceKey;
        button.classList.toggle('is-current', on);
      });
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

    sheetEl.addEventListener('click', function (event) {
      var jump = event.target.closest('[data-rb-goto]');
      if (!jump) return;
      activeId = jump.getAttribute('data-rb-goto');
      renderPages();
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
      dirty = true;
      var item = addedPage();
      pages.push(item);
      activeId = item.id;
      renderPages();
    });

    duplicateBtn.addEventListener('click', function () {
      if (pages.length >= MAX_PAGES) return;
      dirty = true;
      var index = activeIndex();
      var item = clonePage(pages[index]);
      pages.splice(index + 1, 0, item);
      activeId = item.id;
      renderPages();
    });

    removeBtn.addEventListener('click', function () {
      if (pages.length <= 1) return;
      dirty = true;
      var index = activeIndex();
      pages.splice(index, 1);
      activeId = pages[Math.min(index, pages.length - 1)].id;
      renderPages();
    });

    earlierBtn.addEventListener('click', function () {
      var index = activeIndex();
      if (index <= 0) return;
      dirty = true;
      var moved = pages[index];
      pages[index] = pages[index - 1];
      pages[index - 1] = moved;
      renderPages();
    });

    laterBtn.addEventListener('click', function () {
      var index = activeIndex();
      if (index >= pages.length - 1) return;
      dirty = true;
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

    function applyRecord(record) {
      fileLabelEl.textContent = record ? fileLabel(record) : 'Customer File not on this device';
      if (dirty) return;
      var api = sourceApi();
      if (!api) return;
      var source = api.read(record || null);
      var next = withProperty(api.assemble(source), source);
      pages = next.pages.slice();
      activeId = pages[0] ? pages[0].id : '';
      pageSeq = pages.length;
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
      applyRecord(record);
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
      '    <span class="file-status">Draft</span>' +
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
      return '<button type="button" class="rb-tool" disabled title="Shown for layout. Not available in this skeleton.">' + tool.label + '</button>';
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
