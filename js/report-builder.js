// Toolbox — Report Builder workspace.
//
// 11×17 landscape sheets, page rail, composition controls, and jump links
// back to the source workspaces. The opening sequence comes from
// ToolboxReportSource (issue #66 skeleton + the #65 evidence contract).
// Assembled pages and report wording autosave onto record.reportBuilder.
// Photo/plan evidence is rehydrated from Distress / Floor Survey on open —
// binaries are not stored inside the report document. Export for AI reads
// the open Customer File and downloads one ZIP.

(function () {
  'use strict';

  var SHEET_RATIO_LABEL = '11 × 17 landscape';
  var MAX_PAGES = 80;
  var SHEET_RATIO = 17 / 11;
  var AUTOSAVE_DELAY_MS = 900;
  var PHOTOS_PER_PAGE = 10;
  var REPORT_SCHEMA = 'toolbox.report-builder';
  var REPORT_SCHEMA_VERSION = 1;

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
  var penLogUi = {
    selectedPinId: '',
    property: '',
    noteMap: {},
    onNote: null,
    onSelect: null,
    layout: null,
  };
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

  function displayAddress(record) {
    var api = identityApi();
    if (api && typeof api.displayAddress === 'function') {
      var shown = api.displayAddress(record);
      if (!shown || shown === 'No property address yet') return '';
      return shown;
    }
    var addr = record && typeof record.propertyAddress === 'string' ? record.propertyAddress.trim() : '';
    if (!addr) return '';
    return addr.split('\n')[0].trim();
  }

  function fullAddress(record) {
    var addr = record && typeof record.propertyAddress === 'string' ? record.propertyAddress.trim() : '';
    return addr || displayAddress(record);
  }

  function addressParts(text) {
    var lines = String(text || '').split(/\n/).map(function (line) {
      return line.trim();
    }).filter(Boolean);
    return {
      street: lines[0] || '',
      cityLine: lines.slice(1).join(', '),
    };
  }

  function displayCustomerName(record) {
    var api = identityApi();
    if (api && typeof api.displayName === 'function') {
      var name = api.displayName(record);
      if (name && name !== 'New Customer File') return name;
    }
    var first = record && typeof record.firstName === 'string' ? record.firstName.trim() : '';
    var last = record && typeof record.lastName === 'string' ? record.lastName.trim() : '';
    return (first + ' ' + last).trim();
  }

  function residenceTitle(name) {
    var parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return parts[parts.length - 1] + ' Residence';
    if (parts.length === 1) return parts[0] + ' Residence';
    return '';
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
      meta: cloneJson(source.meta || null),
      reportText: cloneJson(source.reportText || null),
      evidence: source.evidence || null,
    };
  }

  function photoLabel(displayNumber) {
    var n = Number(displayNumber);
    if (!isFinite(n)) return 'Photo';
    var raw = String(Math.round(n));
    return 'Photo ' + (raw.length < 2 ? ('0' + raw) : raw);
  }

  function brandMark() {
    var brand = document.createElement('div');
    brand.className = 'rb-topo-page__brand';
    brand.innerHTML =
      '<span class="rb-topo-page__brand-mark" aria-hidden="true"></span>' +
      '<span class="rb-topo-page__brand-name">SANDIA GEO</span>';
    return brand;
  }

  function nextPicturesPageId(pages) {
    var max = 0;
    (pages || []).forEach(function (page) {
      var m = page && page.id && String(page.id).match(/^pictures-(\d+)$/);
      if (m) max = Math.max(max, Number(m[1]) || 0);
    });
    return 'pictures-' + (max + 1);
  }

  function maxFigureNumber(pages) {
    var max = 0;
    (pages || []).forEach(function (page) {
      var n = page && page.meta && page.meta.figureNumber;
      if (typeof n === 'number' && isFinite(n)) max = Math.max(max, n);
    });
    return max;
  }

  function captionsFromPhotos(photos, prior) {
    var captions = prior && typeof prior === 'object' ? Object.assign({}, prior) : {};
    (photos || []).forEach(function (photo) {
      if (!photo || !photo.key) return;
      if (typeof captions[photo.key] !== 'string') {
        captions[photo.key] = photo.seedText || '';
      }
    });
    return captions;
  }

  function buildPicturesPage(photos, figureNumber, pageId) {
    var list = photos || [];
    return {
      id: pageId,
      type: 'pictures',
      title: 'Pictures',
      tocTitle: 'Figure ' + figureNumber + ' — Pictures',
      railLabel: 'Pictures',
      note: '',
      sourceKey: 'distress',
      sourceRef: null,
      includeInToc: true,
      meta: {
        figureNumber: figureNumber,
        photoKeys: list.map(function (photo) { return photo.key; }),
      },
      reportText: {
        captions: captionsFromPhotos(list, null),
      },
      evidence: null,
    };
  }

  function buildPicturesPages(photos, startFigureNumber, existingPages) {
    var list = photos || [];
    if (!list.length) return [];
    var pages = [];
    var figure = typeof startFigureNumber === 'number' ? startFigureNumber : 1;
    for (var i = 0; i < list.length; i += PHOTOS_PER_PAGE) {
      var chunk = list.slice(i, i + PHOTOS_PER_PAGE);
      var id = nextPicturesPageId((existingPages || []).concat(pages));
      pages.push(buildPicturesPage(chunk, figure, id));
      figure += 1;
    }
    if (pages.length > 1) {
      pages.forEach(function (page, index) {
        page.railLabel = 'Pictures · ' + (index + 1);
      });
    }
    return pages;
  }

  function photoMapFromList(photos) {
    var map = {};
    (photos || []).forEach(function (photo) {
      if (photo && photo.key) map[photo.key] = photo;
    });
    return map;
  }

  function insertIndexBeforeClosing(pages) {
    var closing = { discussion: 1, conclusions: 1, limitations: 1 };
    for (var i = 0; i < pages.length; i += 1) {
      var sectionId = pages[i] && pages[i].meta && pages[i].meta.sectionId;
      if (sectionId && closing[sectionId]) return i;
      if (pages[i] && pages[i].type === 'diagnostics') return i;
    }
    return pages.length;
  }

  function lastIndexOfType(pages, type) {
    var index = -1;
    for (var i = 0; i < pages.length; i += 1) {
      if (pages[i] && pages[i].type === type) index = i;
    }
    return index;
  }

  function insertPagesAt(pages, index, additions) {
    if (!additions || !additions.length) return pages;
    var at = Math.max(0, Math.min(index, pages.length));
    return pages.slice(0, at).concat(additions, pages.slice(at));
  }

  /**
   * Keep saved pages and wording; add new Distress/Floor/Pictures source items.
   */
  function reconcileReportPages(savedPages, freshPages, photos) {
    var pages = (savedPages || []).map(function (page) {
      return {
        id: page.id,
        type: page.type,
        title: page.title,
        tocTitle: page.tocTitle || page.title,
        railLabel: page.railLabel || page.title,
        note: page.note || '',
        sourceKey: page.sourceKey || null,
        sourceRef: page.sourceRef || null,
        includeInToc: page.includeInToc !== false,
        meta: cloneJson(page.meta || null),
        reportText: cloneJson(page.reportText || null),
        evidence: null,
      };
    });
    var byId = {};
    pages.forEach(function (page) { byId[page.id] = true; });

    function addMissingOfType(type) {
      var additions = [];
      (freshPages || []).forEach(function (fresh) {
        if (!fresh || fresh.type !== type) return;
        if (fresh.meta && fresh.meta.reserved) return;
        if (byId[fresh.id]) return;
        additions.push({
          id: fresh.id,
          type: fresh.type,
          title: fresh.title,
          tocTitle: fresh.tocTitle || fresh.title,
          railLabel: fresh.railLabel || fresh.title,
          note: fresh.note || '',
          sourceKey: fresh.sourceKey || null,
          sourceRef: fresh.sourceRef || null,
          includeInToc: fresh.includeInToc !== false,
          meta: cloneJson(fresh.meta || null),
          reportText: cloneJson(fresh.reportText || null),
          evidence: null,
        });
        byId[fresh.id] = true;
      });
      if (!additions.length) return;
      var anchor = lastIndexOfType(pages, type);
      var at = anchor >= 0 ? anchor + 1 : insertIndexBeforeClosing(pages);
      pages = insertPagesAt(pages, at, additions);
    }

    addMissingOfType('distress');
    addMissingOfType('floor');
    addMissingOfType('diagnostics');

    var photoList = photos || [];
    var photoByKey = photoMapFromList(photoList);
    var knownKeys = {};
    pages.forEach(function (page) {
      if (!page || page.type !== 'pictures') return;
      var keys = page.meta && Array.isArray(page.meta.photoKeys) ? page.meta.photoKeys.slice() : [];
      var kept = keys.filter(function (key) { return !!photoByKey[key]; });
      kept.forEach(function (key) { knownKeys[key] = true; });
      page.meta = page.meta || {};
      page.meta.photoKeys = kept;
      page.reportText = page.reportText || {};
      page.reportText.captions = captionsFromPhotos(
        kept.map(function (key) { return photoByKey[key]; }),
        page.reportText.captions
      );
    });

    var newPhotos = photoList.filter(function (photo) {
      return photo && photo.key && !knownKeys[photo.key];
    });
    if (newPhotos.length) {
      var picturePages = pages.filter(function (page) { return page.type === 'pictures'; });
      var lastPictures = picturePages.length ? picturePages[picturePages.length - 1] : null;
      var queue = newPhotos.slice();
      if (lastPictures) {
        lastPictures.meta = lastPictures.meta || {};
        var existingKeys = Array.isArray(lastPictures.meta.photoKeys)
          ? lastPictures.meta.photoKeys.slice()
          : [];
        var room = Math.max(0, PHOTOS_PER_PAGE - existingKeys.length);
        if (room > 0) {
          var fill = queue.splice(0, room);
          existingKeys = existingKeys.concat(fill.map(function (photo) { return photo.key; }));
          lastPictures.meta.photoKeys = existingKeys;
          lastPictures.reportText = lastPictures.reportText || {};
          lastPictures.reportText.captions = captionsFromPhotos(
            existingKeys.map(function (key) { return photoByKey[key]; }),
            lastPictures.reportText.captions
          );
        }
      }
      if (queue.length) {
        var startFig = maxFigureNumber(pages) + 1;
        var created = buildPicturesPages(queue, startFig, pages);
        var at = lastIndexOfType(pages, 'pictures');
        if (at < 0) at = lastIndexOfType(pages, 'floor');
        if (at < 0) at = lastIndexOfType(pages, 'distress');
        at = at >= 0 ? at + 1 : insertIndexBeforeClosing(pages);
        pages = insertPagesAt(pages, at, created);
      }
    }

    var pictures = pages.filter(function (page) { return page.type === 'pictures'; });
    if (pictures.length > 1) {
      pictures.forEach(function (page, index) {
        page.railLabel = 'Pictures · ' + (index + 1);
      });
    } else if (pictures.length === 1) {
      pictures[0].railLabel = 'Pictures';
    }

    return pages;
  }

  function ensurePicturesInFreshPages(pages, photos) {
    var list = pages ? pages.slice() : [];
    if (list.some(function (page) { return page.type === 'pictures'; })) return list;
    if (!(photos || []).length) return list;
    var startFig = maxFigureNumber(list) + 1;
    var created = buildPicturesPages(photos, startFig, list);
    var at = lastIndexOfType(list, 'floor');
    if (at < 0) at = lastIndexOfType(list, 'distress');
    at = at >= 0 ? at + 1 : insertIndexBeforeClosing(list);
    return insertPagesAt(list, at, created);
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

  function evidenceImage(parent, url, className, alt) {
    if (!url || url.indexOf('data:image/') !== 0) return false;
    var img = document.createElement('img');
    img.className = className;
    img.src = url;
    img.alt = alt;
    parent.appendChild(img);
    return true;
  }

  function formatSurveyDate(value, fullYear) {
    var text = typeof value === 'string' ? value.trim() : '';
    if (!text) return '';
    var m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return m[2] + '/' + m[3] + '/' + (fullYear ? m[1] : m[1].slice(2));
    return text;
  }

  function formatReading(value, dec) {
    var n = typeof value === 'number' && isFinite(value) ? value : null;
    if (n == null) return '';
    var places = typeof dec === 'number' ? dec : 2;
    return n.toFixed(places);
  }

  function renderTopoLegend(stats) {
    var box = document.createElement('div');
    box.className = 'rb-topo-legend';
    var elev = document.createElement('div');
    elev.className = 'rb-topo-legend__elev';
    elev.textContent = 'ELEV.';
    box.appendChild(elev);
    var bar = document.createElement('div');
    bar.className = 'rb-topo-legend__bar';
    var legend = stats.legend || { min: 0, max: 0, stops: [] };
    var stops = Array.isArray(legend.stops) ? legend.stops.slice() : [];
    // High at top of the bar.
    for (var i = stops.length - 1; i >= 0; i -= 1) {
      var seg = document.createElement('span');
      seg.style.background = stops[i].color || '#ccc';
      bar.appendChild(seg);
    }
    box.appendChild(bar);
    var labels = document.createElement('div');
    labels.className = 'rb-topo-legend__labels';
    var hiLabel = document.createElement('span');
    hiLabel.textContent = formatReading(legend.max, stats.decimalPlaces) || '—';
    var loLabel = document.createElement('span');
    loLabel.textContent = formatReading(legend.min, stats.decimalPlaces) || '—';
    labels.appendChild(hiLabel);
    labels.appendChild(loLabel);
    box.appendChild(labels);
    return box;
  }

  function renderTopoStats(stats) {
    var pill = document.createElement('div');
    pill.className = 'rb-topo-stats';
    if (stats.name) {
      var label = document.createElement('span');
      label.className = 'rb-topo-stats__label';
      label.textContent = stats.name;
      pill.appendChild(label);
    }
    function coloredStat(className, letter, value) {
      var el = document.createElement('span');
      el.className = className;
      var bold = document.createElement('b');
      bold.textContent = letter;
      el.appendChild(bold);
      el.appendChild(document.createTextNode(' ' + (value || '—')));
      return el;
    }
    pill.appendChild(coloredStat('rb-topo-stats__hi', 'H', formatReading(stats.hi, stats.decimalPlaces)));
    pill.appendChild(coloredStat('rb-topo-stats__lo', 'L', formatReading(stats.lo, stats.decimalPlaces)));
    pill.appendChild(coloredStat('rb-topo-stats__delta', '\u0394', formatReading(stats.delta, stats.decimalPlaces)));
    return pill;
  }

  function renderNorthArrow() {
    var wrap = document.createElement('div');
    wrap.className = 'rb-topo-page__north';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<svg viewBox="0 0 40 52" focusable="false">' +
      '<polygon points="20,2 28,22 20,18 12,22" fill="#111"/>' +
      '<polygon points="20,50 28,30 20,34 12,30" fill="#bbb"/>' +
      '<text x="20" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#111">N</text>' +
      '</svg>';
    return wrap;
  }

  function renderRelativeReadings(statsList) {
    var box = document.createElement('div');
    box.className = 'rb-topo-page__readings';
    var sole = statsList.length === 1 ? statsList[0] : null;
    var dec = sole ? sole.decimalPlaces : 2;
    var hiText = sole ? formatReading(sole.hi, dec) : '';
    var loText = sole ? formatReading(sole.lo, dec) : '';
    var deltaText = sole ? formatReading(sole.delta, dec) : '';

    function row(letter, label, value) {
      var line = document.createElement('div');
      line.className = 'rb-topo-page__readings-row';
      var badge = document.createElement('span');
      badge.className = 'rb-topo-page__readings-badge';
      badge.textContent = letter;
      var text = document.createElement('span');
      text.className = 'rb-topo-page__readings-label';
      text.textContent = label + (value ? (' ' + value) : ' ');
      line.appendChild(badge);
      line.appendChild(text);
      return line;
    }

    box.appendChild(row('H', 'High Relative Reading -', hiText));
    box.appendChild(row('L', 'Low Relative Reading -', loText));
    var total = document.createElement('div');
    total.className = 'rb-topo-page__readings-total';
    total.textContent = 'Total Relative Elevation Difference -' +
      (deltaText ? (' ' + deltaText + '"') : '');
    box.appendChild(total);
    return box;
  }

  function renderTopoFigurePage(page, evidence) {
    var meta = page.meta || {};
    var root = document.createElement('div');
    root.className = 'rb-topo-page';

    var header = document.createElement('div');
    header.className = 'rb-topo-page__header';

    var left = document.createElement('div');
    left.className = 'rb-topo-page__header-left';
    var num = meta.figureNumber || '';
    var scopeTitle = meta.scopeTitle || meta.levelName || 'Floor Level Survey';
    var figureNum = document.createElement('p');
    figureNum.className = 'rb-topo-page__figure-num';
    figureNum.textContent = num ? ('Figure ' + num) : 'Figure';
    left.appendChild(figureNum);
    var figureTitle = document.createElement('h1');
    figureTitle.className = 'rb-topo-page__figure-title';
    figureTitle.textContent = 'Floor Level Survey — ' + scopeTitle;
    left.appendChild(figureTitle);
    var dateLine = document.createElement('p');
    dateLine.className = 'rb-topo-page__survey-date';
    var dateText = formatSurveyDate(meta.surveyDate || evidence.surveyDate || '', true);
    dateLine.textContent = dateText ? ('Survey Date: ' + dateText) : 'Survey Date:';
    left.appendChild(dateLine);
    var corrected = document.createElement('p');
    corrected.className = 'rb-topo-page__corrected';
    corrected.textContent = 'Corrected for Floor Differences';
    left.appendChild(corrected);
    header.appendChild(left);

    var right = document.createElement('div');
    right.className = 'rb-topo-page__header-right';
    var residence = document.createElement('p');
    residence.className = 'rb-topo-page__residence';
    residence.textContent = evidence.residenceTitle ||
      residenceTitle(evidence.customerName || '') ||
      (evidence.customerName || '');
    right.appendChild(residence);
    var parts = addressParts(evidence.addressFull || evidence.address || meta.address || '');
    var street = document.createElement('p');
    street.className = 'rb-topo-page__address';
    street.textContent = parts.street || evidence.address || '';
    right.appendChild(street);
    if (parts.cityLine) {
      var city = document.createElement('p');
      city.className = 'rb-topo-page__address-city';
      city.textContent = parts.cityLine;
      right.appendChild(city);
    }
    var door = document.createElement('div');
    door.className = 'rb-topo-page__front-door';
    door.appendChild(renderNorthArrow());
    var doorMeta = document.createElement('div');
    doorMeta.className = 'rb-topo-page__front-door-meta';
    var doorLabel = document.createElement('span');
    doorLabel.textContent = 'Front Door';
    var doorValue = document.createElement('strong');
    doorValue.textContent = meta.frontDoorFacing || evidence.frontDoorFacing || '—';
    doorMeta.appendChild(doorLabel);
    doorMeta.appendChild(doorValue);
    door.appendChild(doorMeta);
    right.appendChild(door);
    header.appendChild(right);
    root.appendChild(header);

    var body = document.createElement('div');
    body.className = 'rb-topo-page__body';
    var drawing = document.createElement('div');
    drawing.className = 'rb-topo-page__drawing';
    var figure = evidence.figure || {};
    if (!evidenceImage(drawing, figure.dataUrl, 'rb-topo-page__image', scopeTitle)) {
      addLine(drawing, 'rb-sheet__note', 'Topo figure could not be composed from Floor Survey readings.');
    }
    body.appendChild(drawing);

    var chrome = document.createElement('aside');
    chrome.className = 'rb-topo-page__chrome';
    var statsList = Array.isArray(evidence.stats) ? evidence.stats : [];
    if (!statsList.length) {
      addLine(chrome, 'rb-sheet__note', 'H / L / Δ unavailable for this figure.');
    } else {
      statsList.forEach(function (stats, index) {
        var block = document.createElement('div');
        var side = statsList.length === 1
          ? 'left'
          : (index % 2 === 0 ? 'left' : 'right');
        block.className = 'rb-topo-page__stat-block rb-topo-page__stat-block--' + side;
        if (stats.name) {
          var name = document.createElement('div');
          name.className = 'rb-topo-page__stat-name';
          name.textContent = stats.name;
          block.appendChild(name);
        }
        block.appendChild(renderTopoLegend(stats));
        block.appendChild(renderTopoStats(stats));
        chrome.appendChild(block);
      });
    }
    body.appendChild(chrome);
    root.appendChild(body);

    var footer = document.createElement('div');
    footer.className = 'rb-topo-page__footer';
    footer.appendChild(brandMark());
    footer.appendChild(renderRelativeReadings(statsList));
    root.appendChild(footer);
    return root;
  }

  function renderPicturesPage(page) {
    var meta = page.meta || {};
    var evidence = page.evidence || {};
    var captions = (page.reportText && page.reportText.captions) || {};
    var photos = Array.isArray(evidence.photos) ? evidence.photos : [];
    var root = document.createElement('div');
    root.className = 'rb-pictures-page';

    var header = document.createElement('div');
    header.className = 'rb-pictures-page__header';
    var fig = document.createElement('p');
    fig.className = 'rb-pictures-page__figure-num';
    fig.textContent = meta.figureNumber ? ('Figure ' + meta.figureNumber) : 'Figure';
    header.appendChild(fig);
    var title = document.createElement('h1');
    title.className = 'rb-pictures-page__title';
    title.textContent = 'Pictures';
    header.appendChild(title);
    root.appendChild(header);

    var grid = document.createElement('div');
    grid.className = 'rb-pictures-page__grid';
    if (!photos.length) {
      addLine(grid, 'rb-sheet__note', 'No photographs are available for this page yet.');
    }
    photos.forEach(function (photo) {
      var cell = document.createElement('figure');
      cell.className = 'rb-pictures-page__cell';
      cell.setAttribute('data-photo-key', photo.key || '');
      var frame = document.createElement('div');
      frame.className = 'rb-pictures-page__frame';
      if (!evidenceImage(frame, photo.dataUrl, 'rb-pictures-page__image', photoLabel(photo.displayNumber))) {
        addLine(frame, 'rb-sheet__note', 'Photo not on this device');
      }
      cell.appendChild(frame);
      var label = document.createElement('figcaption');
      label.className = 'rb-pictures-page__label';
      label.textContent = photoLabel(photo.displayNumber);
      cell.appendChild(label);
      var caption = document.createElement('textarea');
      caption.className = 'rb-pictures-page__caption';
      caption.setAttribute('data-rb-caption', photo.key || '');
      caption.setAttribute('aria-label', photoLabel(photo.displayNumber) + ' description');
      caption.rows = 3;
      caption.value = typeof captions[photo.key] === 'string'
        ? captions[photo.key]
        : (photo.seedText || '');
      cell.appendChild(caption);
      grid.appendChild(cell);
    });
    root.appendChild(grid);

    var footer = document.createElement('div');
    footer.className = 'rb-pictures-page__footer';
    footer.appendChild(brandMark());
    root.appendChild(footer);
    return root;
  }

  function renderMitchellCover(page, pages) {
    var meta = page.meta || {};
    var root = document.createElement('div');
    root.className = 'rb-cover';

    var prepared = document.createElement('div');
    prepared.className = 'rb-cover__prepared';
    addLine(prepared, 'rb-cover__label', 'Prepared For:');
    addLine(prepared, 'rb-cover__name', meta.customerName || page.title || 'Customer File');
    if (meta.email) addLine(prepared, 'rb-cover__email', meta.email);
    if (meta.cellPhone) addLine(prepared, 'rb-cover__phone', meta.cellPhone);
    root.appendChild(prepared);

    var main = document.createElement('div');
    main.className = 'rb-cover__main';

    var left = document.createElement('div');
    left.className = 'rb-cover__left';
    addLine(left, 'rb-cover__product', 'FLOOR LEVEL SURVEY');
    var parts = addressParts(meta.addressFull || meta.address || '');
    addLine(left, 'rb-cover__street', parts.street || meta.address || 'No property address on file');
    if (parts.cityLine) addLine(left, 'rb-cover__city', parts.cityLine);
    var rule = document.createElement('div');
    rule.className = 'rb-cover__rule';
    rule.setAttribute('aria-hidden', 'true');
    left.appendChild(rule);
    var dateText = formatSurveyDate(meta.floorSurveyDate || '', false);
    var dateRow = document.createElement('p');
    dateRow.className = 'rb-cover__date';
    var dateLabel = document.createElement('span');
    dateLabel.className = 'rb-cover__label';
    dateLabel.textContent = 'Survey Date:';
    dateRow.appendChild(dateLabel);
    if (dateText) {
      dateRow.appendChild(document.createTextNode(' '));
      var dateValue = document.createElement('span');
      dateValue.textContent = dateText;
      dateRow.appendChild(dateValue);
    }
    left.appendChild(dateRow);
    addLine(left, 'rb-cover__corrected', 'Corrected for Floor Differences');
    main.appendChild(left);

    var contents = document.createElement('div');
    contents.className = 'rb-cover__contents';
    addLine(contents, 'rb-cover__contents-title', 'CONTENTS');
    var list = document.createElement('div');
    list.className = 'rb-cover__contents-list';
    var api = sourceApi();
    var entries = api && typeof api.contents === 'function' ? api.contents(pages) : [];
    if (!entries.length) {
      addLine(list, 'rb-sheet__note', 'No sections are included.');
    }
    entries.forEach(function (entry) {
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'rb-cover__contents-item';
      row.setAttribute('data-rb-goto', entry.pageId);
      var title = entry.title || '';
      var pageItem = null;
      for (var i = 0; i < pages.length; i += 1) {
        if (pages[i].id === entry.pageId) pageItem = pages[i];
      }
      var figNum = pageItem && pageItem.meta && pageItem.meta.figureNumber;
      if ((entry.type === 'floor' || entry.type === 'pictures') && figNum) {
        var figLabel = document.createElement('span');
        var figStrong = document.createElement('strong');
        figStrong.textContent = 'Figure ' + figNum;
        figLabel.appendChild(figStrong);
        figLabel.appendChild(document.createTextNode(
          entry.type === 'pictures' ? ' Pictures' : (' — ' + title)
        ));
        row.appendChild(figLabel);
        list.appendChild(row);
        return;
      }
      if (entry.type === 'section' && /discussion/i.test(title)) {
        var disc = document.createElement('span');
        var discStrong = document.createElement('strong');
        discStrong.textContent = 'Floor Level Survey Results - Discussion';
        disc.appendChild(discStrong);
        row.appendChild(disc);
        list.appendChild(row);
        return;
      }
      var span = document.createElement('span');
      span.textContent = title;
      row.appendChild(span);
      list.appendChild(row);
    });
    contents.appendChild(list);
    main.appendChild(contents);
    root.appendChild(main);
    return root;
  }

  function renderEvidence(margin, page) {
    var evidence = page.evidence;
    if (!evidence) return false;
    if (page.type === 'floor' && evidence.composed) {
      margin.appendChild(renderTopoFigurePage(page, evidence));
      return true;
    }
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

  async function attachEvidence(record, pages) {
    var api = window.ToolboxReportEvidence;
    if (!record || !api || typeof api.assemble !== 'function') return pages;
    var source = await api.assemble(record);
    var distress = (source.distress && source.distress.slides) || [];
    var floor = (source.floor && source.floor.slides) || [];
    var photoByKey = {};
    distress.forEach(function (slide) {
      (slide.pins || []).forEach(function (pin) {
        (pin.photos || []).forEach(function (photo) {
          var key = photo.id || ('photo-' + photo.displayNumber);
          photoByKey[key] = {
            key: String(key),
            id: photo.id || null,
            displayNumber: photo.displayNumber,
            dataUrl: photo.dataUrl || null,
            seedText: pin.text || '',
            location: pin.location || '',
            pinId: pin.id || null,
            pinNumber: pin.number,
            canvasId: slide.canvasId || null,
          };
        });
      });
    });
    var diagnostics = window.ToolboxDiagnostics && window.ToolboxDiagnostics.listReportFigures
      ? window.ToolboxDiagnostics.listReportFigures(record) : [];
    var result = [];
    for (var i = 0; i < pages.length; i += 1) {
      var page = pages[i];
      if (page.type === 'pictures') {
        var keys = page.meta && Array.isArray(page.meta.photoKeys) ? page.meta.photoKeys : [];
        page.evidence = {
          photos: keys.map(function (key) {
            return photoByKey[key] || {
              key: key,
              id: null,
              displayNumber: null,
              dataUrl: null,
              seedText: '',
              missing: true,
            };
          }),
        };
        result.push(page);
        continue;
      }
      if (page.type === 'distress' && !(page.meta && page.meta.reserved)) {
        page.evidence = distress.find(function (slide) { return slide.canvasId === page.sourceRef; }) || null;
      } else if (page.type === 'floor' && !(page.meta && page.meta.reserved)) {
        var meta = page.meta || {};
        if (meta.compose && window.ToolboxFloorSurvey &&
            typeof window.ToolboxFloorSurvey.composeReportTopoFigureForPage === 'function') {
          try {
            var composed = await window.ToolboxFloorSurvey.composeReportTopoFigureForPage(record, {
              canvasId: meta.canvasId,
              epochId: meta.epochId,
              areaId: meta.areaId || null,
              scope: meta.scope || 'all',
            }, window.ToolboxDB && window.ToolboxDB.getMedia
              ? window.ToolboxDB.getMedia.bind(window.ToolboxDB)
              : null);
            if (composed && composed.dataUrl) {
              var customerName = displayCustomerName(record);
              page.evidence = {
                composed: true,
                customerName: customerName,
                residenceTitle: residenceTitle(customerName),
                address: displayAddress(record),
                addressFull: fullAddress(record),
                surveyDate: meta.surveyDate || '',
                frontDoorFacing: meta.frontDoorFacing || '',
                stats: composed.stats || [],
                figure: {
                  kind: 'composed-topo',
                  dataUrl: composed.dataUrl,
                  mime: composed.mime || 'image/png',
                  width: composed.width,
                  height: composed.height,
                  readingsRebuilt: true,
                },
              };
              result.push(page);
              continue;
            }
          } catch (err) {
            console.warn('Report Builder topo compose failed', err);
          }
        }
        var matches = floor.filter(function (slide) {
          if (slide.canvasId !== meta.canvasId || slide.epochId !== meta.epochId) return false;
          if (meta.areaId) return slide.areaId === meta.areaId;
          if (meta.scope === 'all') return !slide.areaId;
          return true;
        });
        if (matches.length) {
          if (matches[0].figure && matches[0].figure.kind === 'stored-rendering') page.evidence = matches[0];
          result.push(page);
          continue;
        }
      } else if (page.type === 'diagnostics' && !(page.meta && page.meta.reserved)) {
        var fig = diagnostics.find(function (item) { return item.id === page.sourceRef; });
        if (fig && window.ToolboxDB && window.ToolboxDB.getMedia) {
          var dataUrl = await window.ToolboxDB.getMedia(fig.mediaId).catch(function () { return null; });
          page.evidence = { dataUrl: dataUrl };
        }
      }
      result.push(page);
    }
    return result;
  }


  function isPenLogPage(page) {
    return !!(page && page.type === 'distress' && !(page.meta && page.meta.reserved) &&
      page.meta && page.meta.penLog &&
      window.ToolboxPenLog && typeof window.ToolboxPenLog.renderPage === 'function');
  }

  function penLogNoteMap(page, legacyNotes) {
    var notes = {};
    var legacy = legacyNotes && typeof legacyNotes === 'object' ? legacyNotes : {};
    Object.keys(legacy).forEach(function (key) {
      if (typeof legacy[key] === 'string') notes[key] = legacy[key];
    });
    var pageNotes = page && page.reportText && page.reportText.notes;
    if (pageNotes && typeof pageNotes === 'object' && !Array.isArray(pageNotes)) {
      Object.keys(pageNotes).forEach(function (key) {
        if (typeof pageNotes[key] === 'string') notes[key] = pageNotes[key];
      });
    }
    return notes;
  }

  function penLogPinsForPage(page, noteMap) {
    var api = window.ToolboxPenLog;
    var evidence = page && page.evidence;
    return ((evidence && evidence.pins) || []).map(function (pin) {
      return {
        id: pin.id,
        number: pin.number,
        photoLabel: api.photoRange(pin.number, (pin.photos || []).length),
        location: pin.location || '',
        note: api.displayNote(pin, noteMap),
        sourceNote: api.sourceNote(pin),
        x: pin.position ? pin.position.x : null,
        y: pin.position ? pin.position.y : null,
        exterior: !!pin.isExterior,
        photos: pin.photos || [],
      };
    });
  }

  function collectPenLogNotes(pages) {
    var notes = {};
    (pages || []).forEach(function (page) {
      if (!page || page.type !== 'distress') return;
      var map = page.reportText && page.reportText.notes;
      if (!map || typeof map !== 'object') return;
      Object.keys(map).forEach(function (key) {
        if (typeof map[key] === 'string') notes[key] = map[key];
      });
    });
    return notes;
  }


  function renderPenLogSheet(sheet, page, pages) {
    var index = 0;
    for (var n = 0; n < pages.length; n += 1) {
      if (pages[n].id === page.id) index = n;
    }
    var notes = penLogNoteMap(page, penLogUi.noteMap);
    var pins = penLogPinsForPage(page, notes);
    if (!pins.some(function (pin) { return pin.id === penLogUi.selectedPinId; })) {
      penLogUi.selectedPinId = pins[0] ? pins[0].id : '';
    }
    penLogUi.layout = window.ToolboxPenLog.renderPage(sheet, {
      title: page.title,
      levelName: page.meta && page.meta.levelName,
      pageNumber: index + 1,
      property: penLogUi.property,
      plan: (page.evidence && page.evidence.plan) || {},
      pins: pins,
      selectedPinId: penLogUi.selectedPinId,
      onNote: function (id, value, source) {
        if (typeof penLogUi.onNote === 'function') penLogUi.onNote(id, value, source);
      },
      onSelect: function (id) {
        if (typeof penLogUi.onSelect === 'function') penLogUi.onSelect(id);
      },
    });
  }

  function renderSheet(sheet, page, pages) {
    sheet.textContent = '';
    sheet.setAttribute('data-page-id', page.id);
    sheet.setAttribute('data-page-type', page.type || 'sheet');
    sheet.setAttribute('aria-label', (page.title || 'Report sheet') + ', ' + SHEET_RATIO_LABEL);
    sheet.removeAttribute('data-page-kind');

    if (isPenLogPage(page)) {
      renderPenLogSheet(sheet, page, pages);
      return;
    }
    penLogUi.layout = null;

    var margin = document.createElement('div');
    margin.className = 'rb-sheet__margin';

    var index = 0;
    for (var i = 0; i < pages.length; i += 1) {
      if (pages[i].id === page.id) index = i;
    }

    if (page.type === 'cover') {
      margin.classList.add('rb-sheet__margin--cover');
      margin.appendChild(renderMitchellCover(page, pages));
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
    } else if (page.type === 'pictures') {
      margin.classList.add('rb-sheet__margin--pictures');
      margin.appendChild(renderPicturesPage(page));
    } else if (page.type === 'floor' && page.evidence && page.evidence.composed) {
      margin.classList.add('rb-sheet__margin--topo');
      if (!renderEvidence(margin, page)) {
        addLine(margin, 'rb-sheet__note', 'Topo figure reserved.');
      }
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
    } else {
      addLine(margin, 'rb-sheet__kicker', 'Report');
      var sectionTitle = document.createElement('h1');
      sectionTitle.className = 'rb-sheet__title';
      sectionTitle.textContent = page.title || 'Sheet';
      margin.appendChild(sectionTitle);
      if (page.note) addLine(margin, 'rb-sheet__note', page.note);
    }

    var hidePageNum = page.type === 'cover' ||
      page.type === 'pictures' ||
      (page.type === 'floor' && page.evidence && page.evidence.composed);
    if (!hidePageNum) {
      var footer = document.createElement('p');
      footer.className = 'rb-sheet__page';
      footer.id = 'rb-sheet-page';
      footer.textContent = 'Page ' + (index + 1);
      margin.appendChild(footer);
    }
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

  function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function persistablePage(page) {
    return {
      id: page.id,
      type: page.type,
      title: page.title,
      tocTitle: page.tocTitle || page.title,
      railLabel: page.railLabel || page.title,
      note: page.note || '',
      sourceKey: page.sourceKey || null,
      sourceRef: page.sourceRef || null,
      includeInToc: page.includeInToc !== false,
      meta: cloneJson(page.meta || null),
      reportText: cloneJson(page.reportText || null),
    };
  }

  function persistableDocument(pages, activePageId, prior) {
    var notes = collectPenLogNotes(pages);
    if ((!notes || !Object.keys(notes).length) && prior && prior.penLog && prior.penLog.notes) {
      notes = prior.penLog.notes;
    }
    var doc = {
      schema: REPORT_SCHEMA,
      schemaVersion: REPORT_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      activePageId: activePageId || '',
      pages: (pages || []).map(persistablePage),
    };
    if (prior && typeof prior.title === 'string' && prior.title) doc.title = prior.title;
    if (notes && Object.keys(notes).length) {
      doc.penLog = {
        schema: 'toolbox.pen-log-notes',
        schemaVersion: 1,
        notes: notes,
      };
    }
    return doc;
  }

  function savedReportPages(record) {
    var doc = record && (record.reportBuilder || record.report);
    if (!doc || typeof doc !== 'object') return null;
    if (!Array.isArray(doc.pages) || !doc.pages.length) return null;
    return {
      activePageId: typeof doc.activePageId === 'string' ? doc.activePageId : '',
      updatedAt: typeof doc.updatedAt === 'string' ? doc.updatedAt : '',
      pages: doc.pages.map(function (page) {
        return {
          id: page.id,
          type: page.type,
          title: page.title,
          tocTitle: page.tocTitle || page.title,
          railLabel: page.railLabel || page.title,
          note: page.note || '',
          sourceKey: page.sourceKey || null,
          sourceRef: page.sourceRef || null,
          includeInToc: page.includeInToc !== false,
          meta: cloneJson(page.meta || null),
          reportText: cloneJson(page.reportText || null),
          evidence: null,
        };
      }),
    };
  }

  function formatSavedAt(iso) {
    if (!iso) return 'Saved';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return 'Saved';
    return 'Saved ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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
    var workingRecord = null;
    var saveTimer = null;
    var lastSavedAt = '';
    pageSeq = pages.length;

    host.innerHTML = shellHtml();
    var root = host.querySelector('.rb-shell');
    var fileLabelEl = root.querySelector('#rb-file-label');
    var statusEl = root.querySelector('#rb-tool-status');
    var saveStatusEl = root.querySelector('#rb-save-status');
    var draftEl = root.querySelector('#rb-file-status');
    var listEl = root.querySelector('#rb-page-list');
    var sheetEl = root.querySelector('.rb-sheet');
    var addBtn = root.querySelector('#rb-add-page');
    var duplicateBtn = root.querySelector('#rb-duplicate-page');
    var removeBtn = root.querySelector('#rb-remove-page');
    var earlierBtn = root.querySelector('#rb-page-earlier');
    var laterBtn = root.querySelector('#rb-page-later');
    var penPanel = root.querySelector('#rb-penlog-panel');
    var penNoteField = root.querySelector('#rb-report-note');
    var penSaveState = root.querySelector('#rb-save-state');
    var penPhotoList = root.querySelector('#rb-photo-list');

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

    function setSaveStatus(text) {
      if (saveStatusEl) saveStatusEl.textContent = text || '';
    }

    function markDirty() {
      dirty = true;
      setSaveStatus('Saving…');
      if (draftEl) draftEl.textContent = 'Saving';
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        flushSave().catch(function () {});
      }, AUTOSAVE_DELAY_MS);
    }

    function flushSave() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (!dirty || !workingRecord || !customerFileId) return Promise.resolve();
      if (!window.ToolboxDB || typeof window.ToolboxDB.saveCustomerFile !== 'function') {
        return Promise.reject(new Error('Customer File save is not available.'));
      }
      var doc = persistableDocument(pages, activeId, workingRecord && (workingRecord.reportBuilder || workingRecord.report));
      workingRecord.reportBuilder = doc;
      workingRecord.updatedAt = doc.updatedAt;
      delete workingRecord.report;
      return window.ToolboxDB.saveCustomerFile(workingRecord).then(function () {
        dirty = false;
        lastSavedAt = doc.updatedAt;
        setSaveStatus(formatSavedAt(lastSavedAt));
        if (draftEl) draftEl.textContent = 'Saved';
      }).catch(function (err) {
        console.error('Report Builder save failed:', err);
        if (err && err.code === 'checkout') {
          dirty = false;
          setSaveStatus(err.message || 'Checked out elsewhere');
          if (draftEl) draftEl.textContent = 'Read-only';
          return;
        }
        setSaveStatus('Save failed — will retry');
        if (draftEl) draftEl.textContent = 'Unsaved';
        throw err;
      });
    }

    function leaveAfterFlush(next) {
      dirty = true;
      setSaveStatus('Saving…');
      flushSave().then(function () {
        if (typeof next === 'function') next();
      }).catch(function () {});
    }


    function setPenSaveState(msg) {
      if (penSaveState) penSaveState.textContent = msg || '';
    }

    function seedPenLogNotes(record) {
      var legacy = {};
      if (window.ToolboxPenLog && typeof window.ToolboxPenLog.readNotes === 'function') {
        legacy = window.ToolboxPenLog.readNotes(record) || {};
      }
      penLogUi.noteMap = legacy;
      (pages || []).forEach(function (page) {
        if (!page || page.type !== 'distress' || (page.meta && page.meta.reserved)) return;
        page.reportText = page.reportText || {};
        page.reportText.notes = page.reportText.notes || {};
        Object.keys(legacy).forEach(function (key) {
          if (page.reportText.notes[key] == null && typeof legacy[key] === 'string') {
            page.reportText.notes[key] = legacy[key];
          }
        });
      });
    }

    function syncPenLogPanel(page) {
      if (!penPanel) return;
      if (!isPenLogPage(page)) {
        penPanel.hidden = true;
        setPenSaveState('');
        return;
      }
      penPanel.hidden = false;
      var notes = penLogNoteMap(page, penLogUi.noteMap);
      var pins = penLogPinsForPage(page, notes);
      if (!pins.some(function (pin) { return pin.id === penLogUi.selectedPinId; })) {
        penLogUi.selectedPinId = pins[0] ? pins[0].id : '';
      }
      var chosen = null;
      pins.forEach(function (pin) {
        if (pin.id === penLogUi.selectedPinId) chosen = pin;
      });
      if (penNoteField && document.activeElement !== penNoteField) {
        penNoteField.setAttribute('data-pin-id', penLogUi.selectedPinId || '');
        penNoteField.setAttribute('data-source-note', chosen ? chosen.sourceNote : '');
        penNoteField.value = chosen ? (chosen.note || '') : '';
      }
      if (!penPhotoList) return;
      penPhotoList.textContent = '';
      pins.forEach(function (pin) {
        (pin.photos || []).forEach(function (photo) {
          var figure = document.createElement('figure');
          figure.className = 'rb-photo' + (pin.id === penLogUi.selectedPinId ? ' is-current' : '');
          figure.setAttribute('data-pin-id', pin.id || '');
          var caption = document.createElement('figcaption');
          caption.textContent = 'Photo ' + photo.displayNumber + (pin.location ? ' · ' + pin.location : '');
          figure.appendChild(caption);
          if (photo.dataUrl && String(photo.dataUrl).indexOf('data:image/') === 0) {
            var img = document.createElement('img');
            img.src = photo.dataUrl;
            img.alt = 'Photo ' + photo.displayNumber;
            figure.appendChild(img);
          } else {
            var missing = document.createElement('p');
            missing.textContent = 'Photo ' + photo.displayNumber + ' is not on this device.';
            figure.appendChild(missing);
          }
          figure.addEventListener('click', function () {
            penLogUi.selectedPinId = pin.id || '';
            renderPages();
          });
          penPhotoList.appendChild(figure);
        });
      });
      if (!penPhotoList.childNodes.length) {
        var empty = document.createElement('p');
        empty.className = 'rb-panel__lead';
        empty.textContent = 'No photographs are stored on these pins.';
        penPhotoList.appendChild(empty);
      }
    }

    function applyPenLogNote(pinId, value, sourceNote) {
      if (!pinId) return;
      var current = activePage();
      if (!current || !isPenLogPage(current)) return;
      current.reportText = current.reportText || {};
      current.reportText.notes = current.reportText.notes || {};
      var next = typeof value === 'string' ? value : '';
      if (sourceNote != null && next === sourceNote) {
        delete current.reportText.notes[pinId];
        delete penLogUi.noteMap[pinId];
      } else {
        current.reportText.notes[pinId] = next;
        penLogUi.noteMap[pinId] = next;
      }
      setPenSaveState('Note saved');
      setSaveStatus('Note saved');
      markDirty();
    }

    penLogUi.onNote = function (id, value, source) {
      applyPenLogNote(id, value, source);
      var noteEl = root.querySelector('.rb-penlog__note[data-pin-id="' + id + '"]');
      if (penNoteField && penNoteField.getAttribute('data-pin-id') === id && document.activeElement !== penNoteField) {
        penNoteField.value = value || '';
      }
      if (noteEl && document.activeElement !== noteEl) noteEl.value = value || '';
    };
    penLogUi.onSelect = function (id) {
      if (penLogUi.selectedPinId === id) return;
      penLogUi.selectedPinId = id || '';
      renderPages();
    };

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
      syncPenLogPanel(current);
      fitSheet(root);
      if (penLogUi.layout && typeof penLogUi.layout.layout === 'function') {
        window.requestAnimationFrame(function () {
          if (penLogUi.layout && typeof penLogUi.layout.layout === 'function') {
            penLogUi.layout.layout();
          }
        });
      }
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
      leaveAfterFlush(function () {
        if (window.ToolboxReportSession && typeof window.ToolboxReportSession.clear === 'function') {
          window.ToolboxReportSession.clear();
        }
        if (typeof onBack === 'function') onBack();
      });
    });

    root.querySelectorAll('[data-rb-source]').forEach(function (button) {
      button.addEventListener('click', function () {
        var key = button.getAttribute('data-rb-source');
        leaveAfterFlush(function () {
          if (window.ToolboxReportSession && typeof window.ToolboxReportSession.write === 'function') {
            window.ToolboxReportSession.write({
              customerFileId: customerFileId,
              pageId: activeId,
              sourceKey: key,
            });
          }
          if (typeof onOpenSource === 'function') onOpenSource(key);
        });
      });
    });

    sheetEl.addEventListener('click', function (event) {
      var jump = event.target.closest('[data-rb-goto]');
      if (!jump) return;
      var targetId = jump.getAttribute('data-rb-goto');
      if (!targetId || targetId === activeId) return;
      activeId = targetId;
      markDirty();
      renderPages();
    });

    sheetEl.addEventListener('input', function (event) {
      var field = event.target.closest('[data-rb-caption]');
      if (!field) return;
      var key = field.getAttribute('data-rb-caption');
      if (!key) return;
      var current = activePage();
      if (!current || current.type !== 'pictures') return;
      current.reportText = current.reportText || {};
      current.reportText.captions = current.reportText.captions || {};
      current.reportText.captions[key] = field.value;
      markDirty();
    });

    if (penNoteField) {
      penNoteField.addEventListener('input', function () {
        var pinId = penNoteField.getAttribute('data-pin-id') || '';
        var source = penNoteField.getAttribute('data-source-note') || '';
        applyPenLogNote(pinId, penNoteField.value, source);
        var sheetNote = root.querySelector('.rb-penlog__note[data-pin-id="' + pinId + '"]');
        if (sheetNote && document.activeElement !== sheetNote) sheetNote.value = penNoteField.value;
      });
      penNoteField.addEventListener('focus', function () {
        var pinId = penNoteField.getAttribute('data-pin-id') || '';
        if (pinId) penLogUi.onSelect(pinId);
      });
    }

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
      var item = addedPage();
      pages.push(item);
      activeId = item.id;
      markDirty();
      renderPages();
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

    var exportBtn = root.querySelector('#rb-export-ai');
    var exportStatus = root.querySelector('#rb-ai-status');
    exportBtn.addEventListener('click', function () {
      if (!window.ToolboxAiExport || typeof window.ToolboxAiExport.exportCheckedOutFile !== 'function') {
        exportStatus.textContent = 'Export for AI is not available in this session.';
        return;
      }
      exportBtn.disabled = true;
      exportStatus.textContent = 'Preparing the AI package…';
      flushSave().catch(function () {}).then(function () {
        return window.ToolboxAiExport.exportCheckedOutFile(customerFileId);
      }).then(function (result) {
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
    setSaveStatus('Loading…');
    renderPages();
    watchSheet(root);
    fileLabelEl.textContent = 'Loading Customer File…';

    function restoreReturnPage() {
      if (!window.ToolboxReportSession || typeof window.ToolboxReportSession.forFile !== 'function') {
        return false;
      }
      var ret = window.ToolboxReportSession.forFile(customerFileId);
      if (!ret || !ret.pageId) return false;
      var found = pages.some(function (page) { return page.id === ret.pageId; });
      if (found) activeId = ret.pageId;
      if (typeof window.ToolboxReportSession.clear === 'function') {
        window.ToolboxReportSession.clear();
      }
      return found;
    }

    function loadPagesFromRecord(record) {
      fileLabelEl.textContent = record ? fileLabel(record) : 'Customer File not on this device';
      var api = sourceApi();
      if (!api) return { assembledFresh: false, reconciled: false };
      var photoList = window.ToolboxReportEvidence &&
        typeof window.ToolboxReportEvidence.listDistressPhotos === 'function'
        ? window.ToolboxReportEvidence.listDistressPhotos(record)
        : [];
      var source = api.read(record || null);
      var fresh = withProperty(api.assemble(source), source);
      var freshPages = ensurePicturesInFreshPages(fresh.pages.slice(), photoList);
      var saved = savedReportPages(record);
      if (saved) {
        var before = saved.pages.map(function (page) {
          return page.id + ':' + ((page.meta && page.meta.photoKeys) || []).join(',');
        }).join('|');
        pages = reconcileReportPages(saved.pages, freshPages, photoList);
        var after = pages.map(function (page) {
          return page.id + ':' + ((page.meta && page.meta.photoKeys) || []).join(',');
        }).join('|');
        var restored = restoreReturnPage();
        if (!restored) {
          activeId = saved.activePageId && pages.some(function (p) { return p.id === saved.activePageId; })
            ? saved.activePageId
            : (pages[0] ? pages[0].id : '');
        }
        pageSeq = pages.length;
        lastSavedAt = saved.updatedAt || '';
        return { assembledFresh: false, reconciled: before !== after };
      }
      pages = freshPages;
      activeId = pages[0] ? pages[0].id : '';
      pageSeq = pages.length;
      restoreReturnPage();
      return { assembledFresh: true, reconciled: false };
    }

    if (window.ToolboxApp && typeof window.ToolboxApp.registerActiveFlush === 'function') {
      window.ToolboxApp.registerActiveFlush(flushSave);
    }

    if (!window.ToolboxDB || typeof window.ToolboxDB.getCustomerFile !== 'function' || !customerFileId) {
      fileLabelEl.textContent = 'Customer File';
      setSaveStatus('Not on this device');
      return;
    }

    window.ToolboxDB.getCustomerFile(customerFileId).then(function (record) {
      if (token !== mountGeneration) return;
      if (record && record.deletedAt) {
        window.location.replace('#/trash');
        return;
      }
      workingRecord = record || null;
      if (!workingRecord) {
        fileLabelEl.textContent = 'Customer File not on this device';
        setSaveStatus('');
        return;
      }
      penLogUi.property = displayAddress(workingRecord) || '';
      var loaded = loadPagesFromRecord(workingRecord);
      seedPenLogNotes(workingRecord);
      root.setAttribute('data-report-ready', 'true');
      renderPages();
      fitSheet(root);
      if (loaded.assembledFresh || loaded.reconciled) {
        markDirty();
        flushSave().catch(function () {});
      } else {
        setSaveStatus(formatSavedAt(lastSavedAt));
        if (draftEl) draftEl.textContent = 'Saved';
      }
      return attachEvidence(workingRecord, pages.slice()).then(function (enriched) {
        if (token !== mountGeneration) return;
        pages = enriched;
        renderPages();
        fitSheet(root);
      });
    }).catch(function (err) {
      if (token !== mountGeneration) return;
      console.warn('Report Builder could not load Customer File:', err);
      fileLabelEl.textContent = 'Customer File';
      setSaveStatus('Load failed');
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
      '    <span class="file-status" id="rb-file-status">Draft</span>' +
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
      '        <span id="rb-save-status">Loading…</span>' +
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
      '      <p class="rb-panel__lead">Open the workspace that owns the source. Geometry stays in Distress and Floor Survey.</p>' +
      '      <div class="rb-panel__links">' +
      '        <button type="button" class="btn btn--secondary" data-rb-source="floor">Open Floor Survey</button>' +
      '        <button type="button" class="btn btn--secondary" data-rb-source="distress">Open Distress Survey</button>' +
      '        <button type="button" class="btn btn--secondary" data-rb-source="diagnostics">Open Diagnostics</button>' +
      '      </div>' +
      '      <div id="rb-penlog-panel" class="rb-penlog-panel" hidden>' +
      '        <h2>Pen Log</h2>' +
      '        <p class="rb-panel__lead">Report wording stays on the Pen Log. Distress Survey keeps the source note.</p>' +
      '        <p class="rb-panel__status" id="rb-save-state" aria-live="polite"></p>' +
      '        <label class="rb-panel__label" for="rb-report-note">Report note</label>' +
      '        <textarea id="rb-report-note" class="rb-panel__note" rows="3"></textarea>' +
      '        <div id="rb-photos">' +
      '          <h3 class="rb-panel__subhead">Photographs</h3>' +
      '          <div id="rb-photo-list" class="rb-photo-list"></div>' +
      '        </div>' +
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
    if (window.ToolboxApp && typeof window.ToolboxApp.registerActiveFlush === 'function') {
      window.ToolboxApp.registerActiveFlush(null);
    }
  }

  window.ToolboxReportBuilder = {
    mount: mount,
    unmount: unmount,
  };
})();
