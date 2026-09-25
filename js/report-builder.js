// Toolbox — Report Builder workspace.
//
// 11×17 landscape sheets, page rail, authored wording, and jump links back
// to the source workspaces. Page order and wording are a Customer File
// report draft (ToolboxReportDraft). Evidence bytes stay in the workspaces
// that own them and are referenced by media id. This module does not invent
// findings, and it does not edit Distress or Floor Survey capture.

(function () {
  'use strict';

  var SHEET_RATIO_LABEL = '11 × 17 landscape';
  var MAX_PAGES = 80;
  var SHEET_RATIO = 17 / 11;
  var AUTOSAVE_MS = 400;

  var COMPOSE_TOOLS = [
    { id: 'select', label: 'Select' },
    { id: 'text', label: 'Text' },
  ];

  var UNSUPPORTED_TOOLS = [
    { id: 'image', label: 'Image', title: 'Image placement is not available in this version.' },
    { id: 'line', label: 'Line', title: 'Line drawing is not available in this version.' },
    { id: 'arrow', label: 'Arrow', title: 'Arrow drawing is not available in this version.' },
    { id: 'shape', label: 'Shape', title: 'Shape drawing is not available in this version.' },
  ];

  var INACTIVE_TOOLS = [
    { id: 'forward', label: 'Bring forward', title: 'Bring forward is not available in this version.' },
    { id: 'backward', label: 'Send backward', title: 'Send backward is not available in this version.' },
    { id: 'align', label: 'Align', title: 'Align is not available in this version.' },
    { id: 'undo', label: 'Undo', title: 'Undo is not available in this version.' },
    { id: 'redo', label: 'Redo', title: 'Redo is not available in this version.' },
  ];

  var SAVE_LABEL = {
    'not-saved': 'Not saved',
    unsaved: 'Unsaved',
    saving: 'Saving…',
    saved: 'Saved',
    failed: 'Not saved',
  };

  var mountGeneration = 0;
  var fitObserver = null;
  var fitOnResize = null;
  var pageSeq = 1;
  var activeFlush = null;

  function fitSheet(root) {
    var stage = root && root.querySelector('.rb-stage');
    var sheet = stage && stage.querySelector('.rb-sheet');
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

  function draftApi() {
    return window.ToolboxReportDraft;
  }

  function blankSequence() {
    var api = sourceApi();
    if (api && typeof api.assemble === 'function') return api.assemble(api.read(null));
    return { pages: [{ id: 'page-1', type: 'sheet', title: 'Sheet', railLabel: 'Sheet', includeInToc: true, note: '', sourceKey: null, meta: null }] };
  }

  function noteSeq(list) {
    (list || []).forEach(function (page) {
      var match = /^(?:added|copy|page)-(\d+)$/.exec(page && page.id || '');
      if (match) pageSeq = Math.max(pageSeq, Number(match[1]));
    });
  }

  function addedPage() {
    pageSeq += 1;
    return {
      id: 'added-' + pageSeq,
      type: 'sheet',
      title: 'Added page',
      tocTitle: 'Added page',
      railLabel: 'Added page',
      note: '',
      body: '',
      sourceKey: null,
      sourceRef: null,
      sourceId: null,
      origin: 'added',
      includeInToc: true,
      titleEdited: false,
      meta: null,
    };
  }

  function clonePage(source) {
    pageSeq += 1;
    var meta = null;
    if (source.meta) {
      try { meta = JSON.parse(JSON.stringify(source.meta)); } catch (err) { meta = null; }
    }
    return {
      id: 'copy-' + pageSeq,
      type: source.type,
      title: source.title,
      tocTitle: source.tocTitle || source.title,
      railLabel: (source.railLabel || source.title || 'Page') + ' copy',
      note: source.note || '',
      body: source.body || '',
      sourceKey: source.sourceKey || null,
      sourceRef: source.sourceRef || null,
      sourceId: source.origin === 'added' ? null : (source.sourceId || source.id || null),
      origin: 'duplicate',
      includeInToc: source.includeInToc !== false,
      titleEdited: !!source.titleEdited,
      meta: meta,
      evidence: source.evidence || null,
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

  function canAuthor(page) {
    if (!page || page.derived) return false;
    if (page.origin === 'added' || (page.origin === 'duplicate' && page.type === 'sheet')) return true;
    var section = page.meta && page.meta.sectionId;
    return section === 'discussion' || section === 'conclusions' || section === 'limitations';
  }

  function authoredBlock(margin, page) {
    var field = document.createElement('textarea');
    field.className = 'rb-authored';
    field.value = page.body || '';
    field.placeholder = 'Write this section.';
    field.setAttribute('aria-label', (page.title || 'Page') + ' text');
    margin.appendChild(field);
    var printed = document.createElement('p');
    printed.className = 'rb-authored-print';
    printed.textContent = page.body || '';
    margin.appendChild(printed);
  }

  function evidenceImage(parent, url, className, alt) {
    if (!url || url.indexOf('data:image/') !== 0) return false;
    var img = document.createElement('img');
    img.className = className;
    img.src = url;
    img.alt = alt;
    parent.appendChild(img);
    return true;
  }

  function renderEvidence(margin, page) {
    var evidence = page.evidence;
    if (!evidence) return false;
    var frame = document.createElement('div');
    frame.className = 'rb-evidence-frame';
    if (page.type === 'distress') {
      var plan = document.createElement('div');
      plan.className = 'rb-evidence-plan';
      if (!evidenceImage(plan, evidence.plan && evidence.plan.dataUrl, 'rb-evidence-plan__image', 'Distress Survey plan')) {
        addLine(plan, 'rb-sheet__note', 'Plan image is not on this device.');
      }
      (evidence.pins || []).forEach(function (pin) {
        if (!pin.position) return;
        var marker = document.createElement('span');
        marker.className = 'rb-evidence-pin';
        marker.style.left = (Math.max(0, Math.min(1, pin.position.x)) * 100) + '%';
        marker.style.top = (Math.max(0, Math.min(1, pin.position.y)) * 100) + '%';
        marker.textContent = String(pin.number);
        plan.appendChild(marker);
      });
      frame.appendChild(plan);
      var observations = document.createElement('div');
      observations.className = 'rb-evidence-observations';
      (evidence.pins || []).forEach(function (pin) {
        var item = document.createElement('div');
        item.className = 'rb-evidence-observation';
        addLine(item, 'rb-evidence-observation__heading', String(pin.number) + (pin.location ? ' · ' + pin.location : ''));
        if (pin.text) addLine(item, 'rb-evidence-observation__text', pin.text);
        (pin.photos || []).forEach(function (photo) {
          var photoBox = document.createElement('figure');
          photoBox.className = 'rb-evidence-photo';
          addLine(photoBox, 'rb-evidence-photo__caption', 'Photo ' + photo.displayNumber);
          if (!evidenceImage(photoBox, photo.dataUrl, 'rb-evidence-photo__image', 'Photo ' + photo.displayNumber)) {
            addLine(photoBox, 'rb-sheet__note', 'Photo not on this device');
          }
          item.appendChild(photoBox);
        });
        observations.appendChild(item);
      });
      frame.appendChild(observations);
    } else if (page.type === 'floor') {
      var figure = evidence.figure || {};
      if (figure.kind === 'stored-rendering' && figure.mime === 'pdf' && figure.dataUrl) {
        var pdf = document.createElement('object');
        pdf.type = 'application/pdf';
        pdf.data = figure.dataUrl;
        pdf.className = 'rb-evidence-pdf';
        addLine(pdf, 'rb-sheet__note', 'Stored Floor Survey PDF');
        frame.appendChild(pdf);
      } else if (!evidenceImage(frame, figure.dataUrl, 'rb-evidence-figure', 'Stored Floor Survey figure')) {
        addLine(frame, 'rb-sheet__note', 'The finished Floor Survey rendering is not stored. Readings were not redrawn.');
      }
    } else if (page.type === 'diagnostics') {
      if (!evidenceImage(frame, evidence.dataUrl, 'rb-evidence-figure', 'Diagnostics 3D view')) {
        addLine(frame, 'rb-sheet__note', 'Diagnostics figure is not stored on this device.');
      }
    }
    margin.appendChild(frame);
    return true;
  }

  function storedFigure(slide) {
    return !!(slide && slide.figure && slide.figure.kind === 'stored-rendering');
  }

  async function attachEvidence(record, pages, seenSourceIds) {
    var api = window.ToolboxReportEvidence;
    if (!record || !api || typeof api.assemble !== 'function') {
      return pages.filter(function (page) { return !page.derived; });
    }
    var source = await api.assemble(record);
    var distress = (source.distress && source.distress.slides) || [];
    var floor = (source.floor && source.floor.slides) || [];
    var diagnostics = window.ToolboxDiagnostics && window.ToolboxDiagnostics.listReportFigures
      ? window.ToolboxDiagnostics.listReportFigures(record) : [];
    var base = pages.filter(function (page) { return page && !page.derived; });
    var result = [];
    for (var i = 0; i < base.length; i += 1) {
      var page = base[i];
      if (page.type === 'distress' && !(page.meta && page.meta.reserved)) {
        page.evidence = distress.find(function (slide) { return slide.canvasId === page.sourceRef; }) || null;
        if (page.evidence && page.meta) page.meta.slideId = page.evidence.id;
      } else if (page.type === 'floor' && !(page.meta && page.meta.reserved)) {
        var matches = floor.filter(function (slide) {
          return page.meta && slide.canvasId === page.meta.canvasId && slide.epochId === page.meta.epochId;
        });
        if (page.meta && page.meta.slideId) {
          var named = floor.find(function (slide) { return slide.id === page.meta.slideId; });
          page.evidence = storedFigure(named) ? named : null;
          result.push(page);
          continue;
        }
        if (matches.length) {
          page.meta = page.meta || {};
          page.meta.slideId = matches[0].id;
          page.evidence = storedFigure(matches[0]) ? matches[0] : null;
          result.push(page);
          for (var j = 1; j < matches.length; j += 1) {
            var slide = matches[j];
            var represented = base.some(function (item) {
              return item === page ? false : (item.id === slide.id || (item.meta && item.meta.slideId === slide.id));
            }) || result.some(function (item) {
              return item.id === slide.id || (item.meta && item.meta.slideId === slide.id);
            });
            if (represented) continue;
            if (seenSourceIds.indexOf(slide.id) !== -1) continue;
            seenSourceIds.push(slide.id);
            result.push({
              id: slide.id,
              type: 'floor',
              title: slide.title || page.title,
              tocTitle: slide.title || page.tocTitle,
              railLabel: slide.title || page.railLabel,
              note: page.note,
              body: '',
              sourceKey: 'floor',
              sourceRef: slide.id,
              sourceId: slide.id,
              origin: 'source',
              includeInToc: true,
              titleEdited: false,
              meta: Object.assign({}, page.meta, {
                slideId: slide.id,
                areaId: slide.areaId || null,
                areaName: slide.areaName || '',
              }),
              evidence: storedFigure(slide) ? slide : null,
            });
          }
          continue;
        }
      } else if (page.type === 'diagnostics' && !(page.meta && page.meta.reserved)) {
        var fig = diagnostics.find(function (item) { return item.id === page.sourceRef; });
        if (fig && window.ToolboxDB && window.ToolboxDB.getMedia) {
          var dataUrl = await window.ToolboxDB.getMedia(fig.mediaId).catch(function () { return null; });
          page.evidence = { dataUrl: dataUrl, mediaId: fig.mediaId };
        }
      }
      result.push(page);
    }
    return result;
  }

  function coverLines(meta) {
    var lines = [];
    var address = (meta && meta.address) || '';
    if (!address) lines.push('No property address on file');
    else address.split('\n').forEach(function (line) {
      if (line.trim()) lines.push(line.trim());
    });
    if (meta && meta.companyName) lines.push(meta.companyName);
    if (meta && meta.cellPhone) lines.push(meta.cellPhone);
    if (meta && meta.homePhone) lines.push(meta.homePhone);
    if (meta && meta.email) lines.push(meta.email);
    if (meta && meta.floorSurveyDate) lines.push('Floor Survey date ' + meta.floorSurveyDate);
    if (meta && meta.fileDate) lines.push('File date ' + meta.fileDate);
    return lines;
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
      coverLines(page.meta).forEach(function (line) {
        addLine(margin, 'rb-sheet__meta', line);
      });
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
      if (!renderEvidence(margin, page)) {
        figure.textContent = figureLabel(page);
        margin.appendChild(figure);
      }
      if (page.note) addLine(margin, 'rb-sheet__note', page.note);
      if (canAuthor(page)) authoredBlock(margin, page);
    } else {
      addLine(margin, 'rb-sheet__kicker', 'Report');
      var sectionTitle = document.createElement('h1');
      sectionTitle.className = 'rb-sheet__title';
      sectionTitle.textContent = page.title || 'Sheet';
      margin.appendChild(sectionTitle);
      if (page.note) addLine(margin, 'rb-sheet__note', page.note);
      if (canAuthor(page)) authoredBlock(margin, page);
    }

    var footer = document.createElement('p');
    footer.className = 'rb-sheet__page';
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

  function withProperty(sequence, source) {
    var api = sourceApi();
    var view = api && typeof api.presentation === 'function' ? api.presentation(source) : null;
    if (!view) return sequence;
    (sequence.pages || []).forEach(function (item) {
      if (item.type === 'cover') {
        item.meta = view.coverMeta;
        if (source && source.customerName && !item.titleEdited) item.title = source.customerName;
      }
      if (item.type === 'section' && item.meta && item.meta.sectionId === 'property') {
        item.meta.rows = view.propertyRows;
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
    var opened = draftApi() ? draftApi().blankFromSequence(sequence) : { pages: sequence.pages, selectedPageId: '', seenSourceIds: [] };
    var pages = opened.pages.slice();
    var seenSourceIds = opened.seenSourceIds.slice();
    var activeId = pages[0] ? pages[0].id : '';
    var activeTool = 'select';
    var touched = false;
    var revision = 0;
    var savedRevision = 0;
    var saveMode = 'not-saved';
    var saveTimer = null;
    var saveChain = Promise.resolve();
    pageSeq = 1;
    noteSeq(pages);

    host.innerHTML = shellHtml();
    var root = host.querySelector('.rb-shell');
    var fileLabelEl = root.querySelector('#rb-file-label');
    var statusEl = root.querySelector('#rb-tool-status');
    var saveStateEl = root.querySelector('#rb-save-state');
    var fileStatusEl = root.querySelector('#rb-file-status');
    var saveDetailEl = root.querySelector('#rb-save-detail');
    var saveBtn = root.querySelector('#rb-save');
    var listEl = root.querySelector('#rb-page-list');
    var sheetEl = root.querySelector('.rb-stage .rb-sheet');
    var printDeck = root.querySelector('#rb-print-deck');
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

    function setSaveStatus(mode, detail) {
      saveMode = mode;
      var label = SAVE_LABEL[mode] || SAVE_LABEL['not-saved'];
      if (saveStateEl) saveStateEl.textContent = label;
      if (fileStatusEl) fileStatusEl.textContent = label;
      if (saveDetailEl) saveDetailEl.textContent = detail || '';
      if (saveBtn) saveBtn.disabled = mode === 'saving';
    }

    function toolStatusText() {
      var page = activePage();
      if (activeTool === 'text') {
        if (canAuthor(page)) return 'Text edits this sheet. Save stores the wording on the Customer File.';
        return 'This sheet has no text area. Discussion, Conclusions, Limitations, and added pages do.';
      }
      return 'Select a page from the list.';
    }

    function setToolStatus() {
      statusEl.textContent = toolStatusText();
    }

    function buildPrintDeck() {
      if (!printDeck) return;
      printDeck.textContent = '';
      pages.forEach(function (page) {
        var sheet = document.createElement('article');
        sheet.className = 'rb-sheet rb-print-page';
        renderSheet(sheet, page, pages);
        printDeck.appendChild(sheet);
      });
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
          if (activeId === item.id) return;
          activeId = item.id;
          markDirty();
          renderPages();
        });
        listEl.appendChild(button);
      });

      renderSheet(sheetEl, current, pages);
      buildPrintDeck();
      root.querySelectorAll('[data-rb-source]').forEach(function (button) {
        var on = button.getAttribute('data-rb-source') === current.sourceKey;
        button.classList.toggle('is-current', on);
      });
      addBtn.disabled = pages.length >= MAX_PAGES;
      removeBtn.disabled = pages.length <= 1;
      earlierBtn.disabled = index <= 0;
      laterBtn.disabled = index >= pages.length - 1;
      duplicateBtn.disabled = pages.length >= MAX_PAGES;
      setToolStatus();
    }

    function snapshot() {
      return {
        pages: pages,
        selectedPageId: activeId,
        seenSourceIds: seenSourceIds,
      };
    }

    function flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (!touched || revision === savedRevision) return Promise.resolve();
      var api = draftApi();
      if (!api || !customerFileId) {
        setSaveStatus('failed', 'Could not save. Your edits are still on this page.');
        return Promise.reject(new Error('Report draft storage is not available.'));
      }
      var savingRevision = revision;
      var shot = snapshot();
      setSaveStatus('saving');
      var run = saveChain.then(function () {
        return api.save(customerFileId, shot);
      }).then(function () {
        if (token !== mountGeneration) return;
        if (revision === savingRevision) {
          savedRevision = savingRevision;
          setSaveStatus('saved');
        } else {
          setSaveStatus('unsaved');
        }
      }).catch(function (err) {
        if (token !== mountGeneration) return;
        setSaveStatus('failed', 'Could not save. Your edits are still on this page.');
        if (err && err.message) saveDetailEl.textContent = 'Could not save. Your edits are still on this page.';
      });
      saveChain = run.then(function () { return null; }, function () { return null; });
      return run;
    }

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { flushSave(); }, AUTOSAVE_MS);
    }

    function markDirty() {
      touched = true;
      revision += 1;
      setSaveStatus('unsaved');
      scheduleSave();
    }

    activeFlush = flushSave;
    if (window.ToolboxApp && typeof window.ToolboxApp.registerActiveFlush === 'function') {
      window.ToolboxApp.registerActiveFlush(flushSave);
    }

    root.querySelector('#rb-back').addEventListener('click', function () {
      flushSave();
      if (typeof onBack === 'function') onBack();
    });

    root.querySelectorAll('[data-rb-source]').forEach(function (button) {
      button.addEventListener('click', function () {
        flushSave();
        var key = button.getAttribute('data-rb-source');
        if (typeof onOpenSource === 'function') onOpenSource(key);
      });
    });

    sheetEl.addEventListener('click', function (event) {
      var jump = event.target.closest('[data-rb-goto]');
      if (!jump) return;
      var nextId = jump.getAttribute('data-rb-goto');
      if (!nextId || nextId === activeId) return;
      activeId = nextId;
      markDirty();
      renderPages();
    });

    sheetEl.addEventListener('input', function (event) {
      var field = event.target.closest('.rb-authored');
      if (!field) return;
      var page = activePage();
      if (!page) return;
      page.body = field.value;
      var printed = field.parentNode && field.parentNode.querySelector('.rb-authored-print');
      if (printed) printed.textContent = field.value;
      markDirty();
      buildPrintDeck();
    });

    root.querySelectorAll('[data-rb-tool]').forEach(function (button) {
      button.addEventListener('click', function () {
        if (button.disabled) return;
        activeTool = button.getAttribute('data-rb-tool');
        root.querySelectorAll('[data-rb-tool]').forEach(function (peer) {
          var on = peer === button;
          peer.classList.toggle('is-active', on);
          peer.setAttribute('aria-pressed', on ? 'true' : 'false');
        });
        setToolStatus();
        if (activeTool === 'text') {
          var field = sheetEl.querySelector('.rb-authored');
          if (field) field.focus();
        }
      });
    });

    addBtn.addEventListener('click', function () {
      if (pages.length >= MAX_PAGES) return;
      var item = addedPage();
      pages.push(item);
      activeId = item.id;
      markDirty();
      renderPages();
      var field = sheetEl.querySelector('.rb-authored');
      if (field) field.focus();
    });

    duplicateBtn.addEventListener('click', function () {
      if (pages.length >= MAX_PAGES) return;
      var index = activeIndex();
      var item = clonePage(pages[index]);
      pages.splice(index + 1, 0, item);
      activeId = item.id;
      markDirty();
      renderPages();
    });

    removeBtn.addEventListener('click', function () {
      if (pages.length <= 1) return;
      var index = activeIndex();
      pages.splice(index, 1);
      activeId = pages[Math.min(index, pages.length - 1)].id;
      markDirty();
      renderPages();
    });

    earlierBtn.addEventListener('click', function () {
      var index = activeIndex();
      if (index <= 0) return;
      var moved = pages[index];
      pages[index] = pages[index - 1];
      pages[index - 1] = moved;
      markDirty();
      renderPages();
    });

    laterBtn.addEventListener('click', function () {
      var index = activeIndex();
      if (index >= pages.length - 1) return;
      var moved = pages[index];
      pages[index] = pages[index + 1];
      pages[index + 1] = moved;
      markDirty();
      renderPages();
    });

    saveBtn.addEventListener('click', function () {
      if (!touched || revision === savedRevision) {
        touched = true;
        revision += 1;
      }
      flushSave();
    });

    root.querySelector('#rb-print').addEventListener('click', function () {
      buildPrintDeck();
      window.print();
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

    setSaveStatus('not-saved');
    setToolStatus();
    renderPages();
    watchSheet(root);
    fileLabelEl.textContent = 'Loading Customer File…';

    function applyRecord(record) {
      fileLabelEl.textContent = record ? fileLabel(record) : 'Customer File not on this device';
      if (touched) return;
      var api = sourceApi();
      var drafts = draftApi();
      if (!api || !drafts) return;
      var source = api.read(record || null);
      var next = withProperty(api.assemble(source), source);
      var stored = record ? drafts.read(record) : null;
      var merged = stored ? drafts.merge(stored, next) : drafts.blankFromSequence(next);
      pages = merged.pages.slice();
      seenSourceIds = merged.seenSourceIds.slice();
      activeId = merged.selectedPageId || (pages[0] && pages[0].id) || '';
      noteSeq(pages);
      revision = 0;
      savedRevision = 0;
      setSaveStatus(stored ? 'saved' : 'not-saved');
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
      attachEvidence(record, pages.slice(), seenSourceIds).then(function (enriched) {
        if (token !== mountGeneration || touched) return;
        pages = enriched;
        renderPages();
        fitSheet(root);
      }).catch(function (err) {
        console.warn('Report evidence could not be loaded:', err);
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
      '    <span class="file-status" id="rb-file-status">Not saved</span>' +
      '  </div>' +
      '  <div class="rb-toolbar">' +
      '    <div class="rb-toolbar__tools" role="toolbar" aria-label="Report composition">' +
             toolButtons() +
      '    </div>' +
      '    <button type="button" id="rb-save" class="btn btn--accent rb-save">Save</button>' +
      '    <button type="button" id="rb-print" class="btn btn--secondary rb-print">Print 11×17</button>' +
      '    <button type="button" id="rb-export-ai" class="btn btn--accent rb-export">Export for AI</button>' +
      '    <p class="rb-toolbar__status" id="rb-tool-status" aria-live="polite"></p>' +
      '    <p class="rb-ai-status" id="rb-ai-status" aria-live="polite"></p>' +
      '  </div>' +
      '  <div class="rb-workspace">' +
      '    <aside class="rb-rail" aria-label="Report pages">' +
      '      <div class="rb-rail__head">' +
      '        <p class="eyebrow">Pages</p>' +
      '        <strong>Report sheets</strong>' +
      '        <span id="rb-save-state">Not saved</span>' +
      '        <p class="rb-save-detail" id="rb-save-detail"></p>' +
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
      '  <div class="rb-print-deck" id="rb-print-deck"></div>' +
      '</div>'
    );
  }

  function toolButtons() {
    var html = COMPOSE_TOOLS.map(function (tool) {
      var pressed = tool.id === 'select' ? 'true' : 'false';
      var active = tool.id === 'select' ? ' is-active' : '';
      return '<button type="button" class="rb-tool' + active + '" data-rb-tool="' + tool.id + '" aria-pressed="' + pressed + '">' + tool.label + '</button>';
    }).join('');
    html += UNSUPPORTED_TOOLS.map(function (tool) {
      return '<button type="button" class="rb-tool" data-rb-tool="' + tool.id + '" disabled title="' + tool.title + '">' + tool.label + '</button>';
    }).join('');
    html += '<span class="rb-tool-sep" aria-hidden="true"></span>';
    html += INACTIVE_TOOLS.map(function (tool) {
      return '<button type="button" class="rb-tool" disabled title="' + tool.title + '">' + tool.label + '</button>';
    }).join('');
    return html;
  }

  function unmount() {
    mountGeneration += 1;
    var flush = activeFlush;
    activeFlush = null;
    if (window.ToolboxApp && typeof window.ToolboxApp.registerActiveFlush === 'function') {
      window.ToolboxApp.registerActiveFlush(null);
    }
    if (flush) flush();
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
