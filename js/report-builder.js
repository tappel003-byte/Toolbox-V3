// Toolbox — Report Builder workspace.
//
// Plumbing: 11×17 sheets, page rail, autosave on record.reportBuilder,
// jump links to source apps, Distress Put-on-report, Floor Import/Lock,
// caption/note edits, Export for AI. Evidence rehydrates from Distress /
// Floor Survey — binaries are not stored in the report document.
// Sheet formatting is rebuilt from real report screenshots; there is no
// fake Select/Text/Image drawing toolbar.

(function () {
  'use strict';

  var SHEET_RATIO_LABEL = '11 × 17 landscape';
  var MAX_PAGES = 80;
  var SHEET_RATIO = 17 / 11;
  var AUTOSAVE_DELAY_MS = 900;
  var PHOTOS_PER_PAGE = 10;
  var REPORT_SCHEMA = 'toolbox.report-builder';
  var REPORT_SCHEMA_VERSION = 1;
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
  var formatToolbar = null;
  // Object URLs for pictures placed on sheets, keyed by media id.
  var overlayUrlCache = {};
  var coverPasteHandler = null;
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

  // The decks never print a trailing comma on either line: the street stands
  // alone and the city/state/ZIP line sits under it. Splitting a single-line
  // address left the comma attached ("44 El Cielo Azul Circle,").
  function trimAddressLine(value) {
    return String(value == null ? '' : value).trim().replace(/[\s,]+$/, '');
  }

  function addressParts(text) {
    var lines = String(text || '').split(/\n/).map(function (line) {
      return line.trim();
    }).filter(Boolean);
    if (lines.length >= 2) {
      return {
        street: trimAddressLine(lines[0]),
        cityLine: trimAddressLine(lines.slice(1).join(', ')),
      };
    }
    var one = lines[0] || '';
    // A written address that carries two or more commas separates street from
    // city at the FIRST one ("28 Sandhill Lane, Los Lunas, NM 87031"). Taking
    // that boundary directly is exact. The whitespace regex below is greedy and
    // split two-word city names in half -- "Los Lunas" became street "... Los"
    // and city "Lunas, NM" -- which hit Ross and 1515, two of four real jobs.
    var firstComma = one.indexOf(',');
    if (firstComma > 0 && (one.match(/,/g) || []).length >= 2) {
      return {
        street: trimAddressLine(one.slice(0, firstComma)),
        cityLine: trimAddressLine(one.slice(firstComma + 1)),
      };
    }
    // Single line: "3777 American Rd. NW Albuquerque, NM" → street + city/state
    var split = one.match(/^(.*)\s+([A-Za-z][A-Za-z .]*?,\s*(?:[A-Z]{2}|[A-Za-z]+(?:\s+[A-Za-z]+)*)(?:,?\s*\d{5}(?:-\d{4})?)?)$/);
    if (split) {
      return { street: trimAddressLine(split[1]), cityLine: trimAddressLine(split[2]) };
    }
    return { street: trimAddressLine(one), cityLine: '' };
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

  // The real artwork, as it appears on every slide of the shipped reports.
  // This used to draw a stand-in -- a styled span plus the words "SANDIA GEO"
  // -- which is not the mark and had no business on a deliverable.
  var BRAND_LOGO = 'brand/sandia-geo.png';

  // One logo, one placement, every page. Each page type used to draw its own
  // -- the floor sheet and the pictures sheet each put one in their footer at
  // their own size, the discussion sheet drew a third -- so placing it on one
  // page did nothing to the rest. It is drawn once here, against the sheet, at
  // the placement the document holds, and that is what every page shows.
  // The page frame, drawn once against the sheet. Each page type used to draw
  // its own -- the cover a rectangle 0.9% in, the discussion sheet one at
  // 0.98% / 1.52%, and the floor and picture sheets none at all, showing the
  // content box's own border at a 4.5% inset in a different colour instead.
  // Three shapes in three places on one deliverable. The measurement kept is
  // the one the four shipped decks agree on to the hundredth of a percent.
  var SHEET_FRAME = { x: 0.98, y: 1.52, w: 98.04, h: 97.73 };

  function renderSheetFrame(sheet) {
    var frame = document.createElement('div');
    frame.className = 'rb-sheet__frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'left:' + SHEET_FRAME.x + '%;top:' + SHEET_FRAME.y + '%;' +
      'width:' + SHEET_FRAME.w + '%;height:' + SHEET_FRAME.h + '%;';
    sheet.appendChild(frame);
  }

  // Measured off the Mitchell deck: the logo (image2.png) sits at
  // 3.59 / 93.49 / 15.49 on slides 2 through 8, identically -- and is NOT on
  // slide 1. The title page carries the frame, the contact, the address, the
  // date and the contents, and no brand mark. So the cover does not get one.
  function pageTakesBrand(page) {
    if (!page) return false;
    // The cover carries its own mark. A Pictures page gives its whole area to
    // the photographs instead -- Tim: "do we need the logo on that page?
    // Keep the logo off and we can increase the size of the picture." Every
    // other sheet in the book still carries it, so the report is not short of
    // the mark.
    if (page.type === 'pictures') return false;
    // A figure page carries the mark in its rail, at the foot, so there is
    // nothing to float in the corner -- and nothing to drag or lock either.
    if (page.type === 'floor' && !(page.meta && page.meta.reserved)) return false;
    return page.type !== 'cover';
  }

  function renderBrandLayer(sheet, page, box) {
    var api = window.ToolboxReportDiscussion;
    if (!api || !pageTakesBrand(page)) return;
    var placed = api.normalizeBrandBox(box);
    var brand = document.createElement('div');
    brand.className = 'rb-brand' + (placed.locked ? ' is-locked' : '');
    brand.setAttribute('data-rb-brand-box', '1');
    brand.style.cssText = 'left:' + placed.x + '%;top:' + placed.y + '%;' +
      'width:' + placed.w + '%;height:' + placed.h + '%;';
    var img = document.createElement('img');
    img.className = 'rb-brand__img';
    img.src = BRAND_LOGO;
    img.alt = 'Sandia Geo';
    brand.appendChild(img);
    if (!placed.locked) {
      // Dragged by the logo itself, the way a picture is moved in PowerPoint.
      brand.setAttribute('title', 'Drag to move. Resize from the corner.');
      var grip = document.createElement('span');
      grip.className = 'rb-brand__resize';
      grip.setAttribute('data-rb-brand-resize', '1');
      brand.appendChild(grip);
    }
    sheet.appendChild(brand);

    // The control rides beside the logo rather than in a fixed corner, which
    // put it straight on top of the artwork once the logo was placed there.
    var lock = document.createElement('button');
    lock.type = 'button';
    lock.className = 'rb-brand__lock';
    lock.setAttribute('data-rb-brand-lock', placed.locked ? 'unlock' : 'lock');
    lock.textContent = placed.locked ? 'Unlock logo' : 'Lock logo';
    var GAP = 1.2;
    var WIDTH = 13; // roughly what "Unlock logo" occupies at this size
    var right = placed.x + placed.w + GAP;
    lock.style.left = (right + WIDTH <= 99 ? right : Math.max(0, placed.x - GAP - WIDTH)) + '%';
    lock.style.top = (placed.y + Math.max(0, (placed.h - 2.6) / 2)) + '%';
    sheet.appendChild(lock);
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
      // Bare title only. The cover derives "Figure N" from slide order;
      // storing it here too produced "Figure 3 Figure 3 — Pictures".
      tocTitle: 'Pictures',
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
  function renumberFigures(pages) {
    var api = sourceApi();
    if (api && typeof api.normalizeBookOrder === 'function') {
      return api.normalizeBookOrder(pages);
    }
    if (api && typeof api.assignFigureNumbers === 'function') {
      return api.assignFigureNumbers(pages);
    }
    return pages;
  }

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
    }).filter(function (page) {
      if (!page) return false;
      if (page.type === 'toc') return false;
      if (page.type === 'section' && page.meta && page.meta.sectionId === 'property') return false;
      if (page.type === 'section' && page.meta && page.meta.sectionId === 'conclusions') return false;
      if (page.type === 'section' && page.meta && page.meta.sectionId === 'limitations') return false;
      return true;
    });
    var byId = {};
    pages.forEach(function (page) { byId[page.id] = true; });
    if (!pages.some(function (page) { return page.type === 'section' && page.meta && page.meta.sectionId === 'discussion'; })) {
      var discussionFresh = (freshPages || []).find(function (page) {
        return page && page.type === 'section' && page.meta && page.meta.sectionId === 'discussion';
      });
      if (discussionFresh) {
        var coverAt = -1;
        for (var di = 0; di < pages.length; di += 1) {
          if (pages[di].type === 'cover') coverAt = di;
        }
        pages = insertPagesAt(pages, coverAt + 1, [{
          id: discussionFresh.id,
          type: discussionFresh.type,
          title: discussionFresh.title,
          tocTitle: discussionFresh.tocTitle || discussionFresh.title,
          railLabel: discussionFresh.railLabel || discussionFresh.title,
          note: discussionFresh.note || '',
          sourceKey: null,
          sourceRef: null,
          includeInToc: true,
          meta: cloneJson(discussionFresh.meta || null),
          reportText: null,
          evidence: null,
        }]);
        byId[discussionFresh.id] = true;
      }
    }

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

    addMissingOfType('floor');
    addMissingOfType('distress');

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

    return renumberFigures(pages);
  }

  function ensurePicturesInFreshPages(pages, photos) {
    var list = pages ? pages.slice() : [];
    if (list.some(function (page) { return page.type === 'pictures'; })) return renumberFigures(list);
    if (!(photos || []).length) return renumberFigures(list);
    var startFig = maxFigureNumber(list) + 1;
    var created = buildPicturesPages(photos, startFig, list);
    var at = lastIndexOfType(list, 'distress');
    if (at < 0) at = lastIndexOfType(list, 'floor');
    at = at >= 0 ? at + 1 : list.length;
    return renumberFigures(insertPagesAt(list, at, created));
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
    // This box used to fill in only when there was exactly ONE boundary, so on
    // a combined page -- the very page that needs it -- it printed "High
    // Relative Reading -" with nothing after it. It reads across every
    // boundary on the page: the highest high, the lowest low, and the spread
    // between them, which is what "Total Relative Elevation Difference" means.
    var list = Array.isArray(statsList) ? statsList.filter(Boolean) : [];
    var dec = list.length ? list[0].decimalPlaces : 2;
    var hi = null;
    var lo = null;
    list.forEach(function (item) {
      if (typeof item.hi === 'number' && (hi === null || item.hi > hi)) hi = item.hi;
      if (typeof item.lo === 'number' && (lo === null || item.lo < lo)) lo = item.lo;
    });
    var hiText = hi === null ? '' : formatReading(hi, dec);
    var loText = lo === null ? '' : formatReading(lo, dec);
    var deltaText = (hi === null || lo === null) ? '' : formatReading(hi - lo, dec);

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
    footer.appendChild(renderRelativeReadings(statsList));
    root.appendChild(footer);
    return root;
  }

  // How many pictures across a Pictures page lays them out.
  //
  // Five is the full page. Fewer across makes each one bigger, which is the
  // point when a page only carries three or four photographs and they are
  // worth seeing properly. Rows follow from how many pictures the page holds
  // rather than being chosen separately: 4 x 1 and 4 x 2 are the same
  // decision made twice, and a chosen row count could leave a photograph with
  // nowhere to go.
  var PICTURES_ACROSS = [3, 4, 5];
  var PICTURES_ACROSS_DEFAULT = 5;

  function picturesAcross(page) {
    var n = page && page.meta ? Number(page.meta.picturesAcross) : 0;
    return PICTURES_ACROSS.indexOf(n) >= 0 ? n : PICTURES_ACROSS_DEFAULT;
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
    var across = picturesAcross(page);
    var rows = Math.max(1, Math.ceil((photos.length || 1) / across));
    grid.style.setProperty('--rb-pics-cols', String(across));
    grid.style.setProperty('--rb-pics-rows', String(rows));
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
    root.appendChild(footer);
    return root;
  }

  function coverBoxShell(id, layout, locked) {
    var api = window.ToolboxReportCoverLayout;
    var box = (layout && layout.boxes && layout.boxes[id]) || { x: 0, y: 0, w: 20, h: 12 };
    var el = document.createElement('div');
    el.className = 'rb-cover-box' + (locked ? ' is-locked' : '');
    el.setAttribute('data-rb-cover-box', id);
    el.style.cssText = api ? api.boxStyle(box) : '';
    if (!locked) {
      // A box whose area is mostly text needs somewhere reliable to grab, now
      // that clicking the text edits it instead of moving the box.
      var move = document.createElement('span');
      move.className = 'rb-cover-box__move';
      move.setAttribute('data-rb-cover-move', id);
      move.setAttribute('title', 'Move this box');
      move.setAttribute('aria-hidden', 'true');
      el.appendChild(move);
      var handle = document.createElement('span');
      handle.className = 'rb-cover-box__resize';
      handle.setAttribute('data-rb-cover-resize', id);
      handle.setAttribute('aria-hidden', 'true');
      el.appendChild(handle);
    }
    return el;
  }

  // Report-owned text is editable in place and carries its own formatting, so
  // these are rich-text regions rather than inputs: an <input> can only hold
  // one uniform style, which makes bolding a word inside it impossible. The
  // deck-measured sizes in the stylesheet remain the DEFAULT; anything set
  // here overrides it for that field and persists on the page.
  function coverField(tag, className, fieldKey, value, locked) {
    var el = document.createElement('div');
    el.className = className + ' rb-rt';
    el.setAttribute('data-rb-cover-field', fieldKey);
    el.setAttribute('data-rb-rich', fieldKey);
    el.setAttribute('role', 'textbox');
    if (!locked) {
      el.setAttribute('contenteditable', 'true');
      el.setAttribute('spellcheck', 'true');
    }
    var api = window.ToolboxReportText;
    el.innerHTML = api ? api.toHtml(value) : String(value == null ? '' : value);
    return el;
  }

  // A contents line holds the TITLE only. "Figure N" is derived from slide
  // order at render time and shown in its own column, so reordering renumbers
  // without rewriting the investigator's text and nothing can double-prefix.
  function defaultContentsLine(entry) {
    if (!entry) return '';
    if (entry.isDiscussion || entry.type === 'section') {
      return entry.title || 'Floor Level Survey Results - Discussion';
    }
    return entry.title || '';
  }

  // Covers saved before the split stored "Figure 3 Figure 3 — Pictures" or
  // "Figure 1 Floor Level Survey — Combined". Strip every leading figure
  // prefix once on read so existing books (Keulen, Chalmers) come back clean
  // instead of showing the old text forever.
  // Saved cover text may be a plain string (pre-rich-text) or a model. Keep a
  // model as a model -- String() on one yields "[object Object]" on the page.
  // An EMPTY saved value is not an edit -- it means nothing was ever typed
  // there. Treating it as one froze the cover against the Customer File: a
  // phone or email added to the file after the report was first opened could
  // never appear, because the blank saved alongside it kept winning.
  function keepRich(value, fallback) {
    if (value == null) return fallback;
    var api = window.ToolboxReportText;
    if (api && api.isModel(value)) return api.isEmpty(value) ? fallback : value;
    return String(value).trim() ? String(value) : fallback;
  }

  function stripFigurePrefix(text) {
    var api = window.ToolboxReportText;
    if (api && api.isModel(text)) {
      var model = api.normalize(text);
      var first = model.paragraphs[0];
      if (first && first.runs.length) {
        first.runs[0].text = stripFigurePrefix(first.runs[0].text);
        if (!first.runs[0].text) first.runs.shift();
      }
      return model;
    }
    var out = String(text == null ? '' : text);
    var prev = null;
    while (prev !== out) {
      prev = out;
      out = out.replace(/^\s*Figure\s*\d+\s*(?:[—–-]\s*)?/i, '');
    }
    return out.trim() || String(text == null ? '' : text).trim();
  }

  function seedCoverText(page, pages) {
    var meta = (page && page.meta) || {};
    var prior = (page && page.reportText) || {};
    var parts = addressParts(meta.addressFull || meta.address || '');
    var source = sourceApi();
    var entries = source && typeof source.contents === 'function' ? source.contents(pages) : [];
    var priorLines = {};
    (Array.isArray(prior.contents) ? prior.contents : []).forEach(function (line) {
      if (line && line.pageId) priorLines[line.pageId] = stripFigurePrefix(line.text);
    });
    var contents = entries.map(function (entry) {
      var fallback = defaultContentsLine(entry);
      return {
        pageId: entry.pageId,
        text: keepRich(priorLines[entry.pageId], fallback),
        figureNumber: entry.figureNumber || null,
        isDiscussion: !!(entry.isDiscussion || entry.type === 'section'),
      };
    });
    return {
      name: keepRich(prior.name, meta.customerName || page.title || ''),
      email: keepRich(prior.email, meta.email || ''),
      phone: keepRich(prior.phone, meta.cellPhone || ''),
      street: keepRich(prior.street, parts.street || meta.address || ''),
      cityLine: keepRich(prior.cityLine, parts.cityLine || ''),
      surveyDate: keepRich(prior.surveyDate, formatSurveyDate(meta.floorSurveyDate || '', false)),
      corrected: keepRich(prior.corrected, 'Corrected for Floor Differences'),
      contents: contents,
    };
  }

  function renderMitchellCover(page, pages, coverLayout, overviewUrl) {
    var meta = page.meta || {};
    var text = seedCoverText(page, pages);
    page.reportText = text;
    var api = window.ToolboxReportCoverLayout;
    var layout = api ? api.normalizeLayout(coverLayout) : { locked: false, boxes: {}, overviewMediaId: '' };
    var locked = !!layout.locked;
    var root = document.createElement('div');
    root.className = 'rb-cover' + (locked ? ' is-locked' : '');
    root.setAttribute('data-rb-cover-stage', '1');

    var bar = document.createElement('div');
    bar.className = 'rb-cover__bar';
    var lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = 'btn btn--secondary';
    lockBtn.setAttribute('data-rb-cover-lock', locked ? 'unlock' : 'lock');
    lockBtn.textContent = locked ? 'Unlock layout' : 'Lock layout';
    bar.appendChild(lockBtn);
    var hint = document.createElement('p');
    hint.className = 'rb-cover__hint';
    hint.textContent = locked
      ? 'Title layout locked. Unlock to edit text or move boxes.'
      : 'Edit any text. Drag boxes to place. Resize from the corner.';
    bar.appendChild(hint);
    root.appendChild(bar);

    var stage = document.createElement('div');
    stage.className = 'rb-cover__stage';

    // "Prepared For:" sits in its own column with the contact stacked beside
    // it, which is how the decks tab it.
    var prepared = coverBoxShell('prepared', layout, locked);
    prepared.classList.add('rb-cover-box--prepared');
    addLine(prepared, 'rb-cover__label', 'Prepared For:');
    var contact = document.createElement('div');
    contact.className = 'rb-cover__contact';
    contact.appendChild(coverField('input', 'rb-cover__name', 'name', text.name, locked));
    contact.appendChild(coverField('input', 'rb-cover__email', 'email', text.email, locked));
    contact.appendChild(coverField('input', 'rb-cover__phone', 'phone', text.phone, locked));
    prepared.appendChild(contact);
    stage.appendChild(prepared);

    var identity = coverBoxShell('identity', layout, locked);
    identity.classList.add('rb-cover-box--identity');
    addLine(identity, 'rb-cover__product', 'FLOOR LEVEL SURVEY');
    identity.appendChild(coverField('input', 'rb-cover__street', 'street', text.street, locked));
    identity.appendChild(coverField('input', 'rb-cover__city', 'cityLine', text.cityLine, locked));
    stage.appendChild(identity);

    var dateBox = coverBoxShell('date', layout, locked);
    dateBox.classList.add('rb-cover-box--date');
    var rule = document.createElement('div');
    rule.className = 'rb-cover__rule';
    rule.setAttribute('aria-hidden', 'true');
    dateBox.appendChild(rule);
    var dateRow = document.createElement('div');
    dateRow.className = 'rb-cover__date-row';
    var dateLabel = document.createElement('span');
    dateLabel.className = 'rb-cover__label';
    dateLabel.textContent = 'Survey Date:';
    dateRow.appendChild(dateLabel);
    dateRow.appendChild(coverField('input', 'rb-cover__date-value', 'surveyDate', text.surveyDate, locked));
    dateBox.appendChild(dateRow);
    dateBox.appendChild(coverField('input', 'rb-cover__corrected', 'corrected', text.corrected, locked));
    stage.appendChild(dateBox);

    var contents = coverBoxShell('contents', layout, locked);
    contents.classList.add('rb-cover-box--contents');
    var contentsInner = document.createElement('div');
    contentsInner.className = 'rb-cover__contents';
    addLine(contentsInner, 'rb-cover__contents-title', 'CONTENTS');
    var list = document.createElement('div');
    list.className = 'rb-cover__contents-list';
    if (!text.contents.length) {
      addLine(list, 'rb-sheet__note', 'Contents appear as slides are added.');
    }
    text.contents.forEach(function (line, index) {
      var row = document.createElement('div');
      row.className = 'rb-cover__contents-item' +
        (line.isDiscussion ? ' rb-cover__contents-item--discussion' : '');
      // Derived, not stored: reordering renumbers without touching the text.
      var num = document.createElement('span');
      num.className = 'rb-cover__contents-num';
      num.textContent = line.figureNumber ? ('Figure ' + line.figureNumber) : '';
      row.appendChild(num);
      var field = coverField('input', 'rb-cover__contents-field', 'contents:' + index, line.text, locked);
      field.setAttribute('data-rb-cover-page', line.pageId || '');
      field.setAttribute('aria-label', 'Contents line ' + (index + 1));
      row.appendChild(field);
      if (line.pageId && !locked) {
        var jump = document.createElement('button');
        jump.type = 'button';
        jump.className = 'rb-cover__contents-jump';
        jump.setAttribute('data-rb-goto', line.pageId);
        jump.title = 'Go to slide';
        jump.textContent = '›';
        row.appendChild(jump);
      }
      list.appendChild(row);
    });
    contentsInner.appendChild(list);
    contents.appendChild(contentsInner);
    stage.appendChild(contents);

    var overview = coverBoxShell('overview', layout, locked);
    overview.classList.add('rb-cover-box--overview');
    var flat = function (v) {
      var api = window.ToolboxReportText;
      return api ? api.toPlain(v).replace(/\n/g, ' ').trim() : String(v == null ? '' : v);
    };
    var fullAddress = [flat(text.street), flat(text.cityLine)].filter(Boolean).join(', ') ||
      meta.addressFull || meta.address || '';
    var mapsUrl = api && typeof api.mapsSearchUrl === 'function' ? api.mapsSearchUrl(fullAddress) : '';
    if (overviewUrl) {
      evidenceImage(overview, overviewUrl, 'rb-cover__overview-image', 'Site overview');
    } else {
      var empty = document.createElement('div');
      empty.className = 'rb-cover__overview-empty';
      empty.textContent = 'Site overview photo — open Maps, screenshot, and paste';
      overview.appendChild(empty);
    }
    var overviewActions = document.createElement('div');
    overviewActions.className = 'rb-cover__overview-actions';
    if (mapsUrl) {
      var mapLink = document.createElement('a');
      mapLink.className = 'rb-cover__maps-link';
      mapLink.href = mapsUrl;
      mapLink.target = '_blank';
      mapLink.rel = 'noopener noreferrer';
      mapLink.textContent = 'Open in Google Maps';
      overviewActions.appendChild(mapLink);
    }
    if (!locked) {
      // Right-click offers Paste only over an editable target, and this box
      // is not one -- so the context menu the investigator reaches for has no
      // Paste in it. Ctrl+V works, but an explicit control is what makes the
      // Maps -> screenshot -> place workflow findable.
      var pasteBtn = document.createElement('button');
      pasteBtn.type = 'button';
      pasteBtn.className = 'btn btn--quiet';
      pasteBtn.setAttribute('data-rb-cover-overview', 'paste');
      pasteBtn.textContent = 'Paste overview';
      overviewActions.appendChild(pasteBtn);
      var addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'btn btn--quiet';
      addBtn.setAttribute('data-rb-cover-overview', 'pick');
      addBtn.textContent = overviewUrl ? 'Replace overview' : 'Add overview';
      overviewActions.appendChild(addBtn);
      if (overviewUrl) {
        var clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'btn btn--quiet';
        clearBtn.setAttribute('data-rb-cover-overview', 'clear');
        clearBtn.textContent = 'Remove';
        overviewActions.appendChild(clearBtn);
      }
    }
    overview.appendChild(overviewActions);
    stage.appendChild(overview);

    root.appendChild(stage);
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
        var customerName = displayCustomerName(record);
        var addrFull = fullAddress(record);
        var addrParts = addressParts(addrFull || displayAddress(record) || '');
        var chromeEv = {
          composed: false,
          chromeOnly: true,
          customerName: customerName,
          residenceTitle: residenceTitle(customerName),
          address: addrParts.street || displayAddress(record),
          addressCity: addrParts.cityLine || '',
          addressFull: addrFull,
          surveyDate: meta.surveyDate || '',
          frontDoorFacing: meta.frontDoorFacing || '',
          stats: [],
          figure: null,
        };
        if (meta.imported && meta.compose && window.ToolboxFloorSurvey &&
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
              page.evidence = {
                composed: true,
                chromeOnly: false,
                customerName: customerName,
                residenceTitle: residenceTitle(customerName),
                address: addrParts.street || displayAddress(record),
                addressCity: addrParts.cityLine || '',
                addressFull: addrFull,
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
        page.evidence = chromeEv;
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

  /**
   * Where this report draws each pin, relative to where Distress recorded it.
   *
   * Several photographs taken at one spot share a pin location, so they arrive
   * as separate pins at identical coordinates and land exactly on top of each
   * other -- only the last number is readable. These offsets pull them apart.
   *
   * Report-owned and never written back: the pin's recorded location is
   * Distress's, and this is only how this figure draws it. Stored like
   * page.reportText.notes -- same container, same keying by pin id -- and in
   * PERCENT OF THE PLAN RECT, the same unit the pin's own x/y already use, so
   * it survives preview scale, the print deck and 11 x 17 paper alike.
   */
  /** 2dp is 0.0017 in on a 17 in sheet -- below print resolution, and it keeps
   *  the offsets out of the undo snapshots and the autosave as long floats. */
  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function penLogOffsetMap(page) {
    var out = {};
    var stored = page && page.reportText && page.reportText.pinOffsets;
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return out;
    Object.keys(stored).forEach(function (key) {
      var o = stored[key];
      if (!o || typeof o !== 'object') return;
      var dx = typeof o.dx === 'number' && isFinite(o.dx) ? o.dx : 0;
      var dy = typeof o.dy === 'number' && isFinite(o.dy) ? o.dy : 0;
      if (dx || dy) out[key] = { dx: dx, dy: dy };
    });
    return out;
  }

  function applyPenLogOffset(page, pinId, dx, dy) {
    if (!page || !pinId) return;
    page.reportText = page.reportText || {};
    var map = page.reportText.pinOffsets;
    if (!map || typeof map !== 'object' || Array.isArray(map)) {
      map = {};
      page.reportText.pinOffsets = map;
    }
    // A pin dragged back to where Distress put it carries no offset, so the
    // record holds only real moves -- the same way applyPenLogNote drops a note
    // that matches its source text.
    if (!dx && !dy) delete map[pinId];
    else map[pinId] = { dx: dx, dy: dy };
  }

  function penLogPinsForPage(page, noteMap, offsetMap) {
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
        dx: (offsetMap && offsetMap[pin.id] && offsetMap[pin.id].dx) || 0,
        dy: (offsetMap && offsetMap[pin.id] && offsetMap[pin.id].dy) || 0,
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


  function renderPenLogSheet(sheet, page, pages, thumb) {
    var index = 0;
    for (var n = 0; n < pages.length; n += 1) {
      if (pages[n].id === page.id) index = n;
    }
    var notes = penLogNoteMap(page, penLogUi.noteMap);
    var pins = penLogPinsForPage(page, notes, penLogOffsetMap(page));
    if (!pins.some(function (pin) { return pin.id === penLogUi.selectedPinId; })) {
      penLogUi.selectedPinId = pins[0] ? pins[0].id : '';
    }
    // A preview measures itself at stamp size; keeping that would move the
    // pins on the real page.
    var penLogLayout = window.ToolboxPenLog.renderPage(sheet, {
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
    if (!thumb) penLogUi.layout = penLogLayout;
  }

  // Multicol spills into extra columns off to the side rather than stopping
  // at two. Pin the scroll so the caret cannot wander into them, and say so
  // on screen when the text no longer fits.
  function watchDiscussionOverflow(root) {
    var body = root.querySelector('.rb-discussion__body');
    var warn = root.querySelector('[data-rb-discussion-overflow]');
    if (!body || !warn) return;
    function check() {
      if (body.scrollLeft !== 0) body.scrollLeft = 0;
      warn.hidden = body.scrollWidth <= body.clientWidth + 2;
    }
    body.addEventListener('scroll', check);
    body.addEventListener('input', check);
    window.requestAnimationFrame(check);
  }

  // A formatting command can change how much text fits, which re-flows the
  // chain and rebuilds the DOM -- taking the selection with it. The selection
  // is recorded as character offsets inside the field (the text model owns
  // that, so the toolbar and the page use one implementation) and put back
  // after the rebuild, so A-up can be clicked repeatedly the way it is in
  // PowerPoint instead of having to re-select between every step.
  function captureSelectionOffsets(field) {
    var api = window.ToolboxReportText;
    if (!field || !api) return null;
    var at = api.captureOffsets(field);
    if (!at) return null;
    at.key = field.getAttribute('data-rb-rich') || '';
    return at;
  }

  function restoreSelectionOffsets(root, saved) {
    var api = window.ToolboxReportText;
    if (!saved || !saved.key || !root || !api) return false;
    var field = root.querySelector('[data-rb-rich="' + saved.key + '"]');
    if (!field) return false;
    return api.restoreOffsets(field, saved);
  }

  // The hosted Floor Survey topo view.
  //
  // renderPages() empties the sheet on every re-render, so a React root created
  // inside it would be torn down and rebuilt constantly -- losing the view, the
  // settings and anything in flight. The host element is therefore kept here
  // and re-appended: detaching and re-attaching a node leaves its React tree
  // intact, so the view survives every unrelated re-render. It is only
  // unmounted when the slide actually changes to a different level.
  var topoHost = { el: null, key: '', api: null, hooks: null };

  function topoHostKey(page) {
    var meta = (page && page.meta) || {};
    return [page && page.id, meta.canvasId, meta.epochId, meta.areaId || '', meta.scope || ''].join('|');
  }

  function releaseTopoHost() {
    if (topoHost.api && typeof topoHost.api.unmount === 'function') {
      try { topoHost.api.unmount(); } catch (err) { /* already gone */ }
    }
    if (topoHost.el && topoHost.el.parentNode) topoHost.el.parentNode.removeChild(topoHost.el);
    topoHost = { el: null, key: '', api: null, hooks: null };
  }

  function mountTopoHost(page, hooks) {
    var api = window.ToolboxFloorSurvey;
    if (!api || typeof api.mount !== 'function') return null;
    var key = topoHostKey(page);
    if (topoHost.el && topoHost.key === key) {
      topoHost.hooks = hooks;
      // Lock View changes nothing about WHICH level is shown, so the host is
      // reused rather than rebuilt -- and the view was therefore never told.
      // Lock flipped its own label, saved, and left the slide as steerable as
      // before. Push it the way settings are pushed.
      if (topoHost.api && typeof topoHost.api.update === 'function') {
        topoHost.api.update({ locked: !!(hooks && hooks.locked) });
      }
      return topoHost.el;
    }
    releaseTopoHost();
    var el = document.createElement('div');
    el.className = 'rb-topo-live';
    el.setAttribute('data-rb-topo-live', '1');
    topoHost = { el: el, key: key, api: null, hooks: hooks };
    var meta = page.meta || {};
    // The hooks are read through topoHost so a later re-render can swap them
    // without remounting the view.
    topoHost.api = api.mount(el, {
      customerFileId: (hooks && hooks.customerFileId) || '',
      workspace: 'report-topo',
      canvasId: meta.canvasId || '',
      areaId: meta.scope === 'all' ? null : (meta.areaId || null),
      camera: (hooks && hooks.camera) || null,
      settings: (hooks && hooks.settings) || null,
      locked: !!(hooks && hooks.locked),
      onBack: function () {},
      onCameraChange: function (camera) {
        if (topoHost.hooks && topoHost.hooks.onCameraChange) topoHost.hooks.onCameraChange(camera);
      },
      onSettingsChange: function (next) {
        if (topoHost.hooks && topoHost.hooks.onSettingsChange) topoHost.hooks.onSettingsChange(next);
      },
    });
    return el;
  }

  /**
   * Draw one page into one sheet element.
   *
   * `opts.thumb` renders the same page as a rail preview. The markup is
   * identical -- the sheet is a size container and everything on it is sized
   * in cqh, so the same page in a 150 px frame IS the miniature, with no
   * scaling hack and no second layout to keep in step. What a preview must
   * not do is write anything back: rendering a page stores the floor layout
   * it computed and the pen log's measured layout, and doing that at
   * thumbnail size would overwrite the real page's with numbers measured off
   * a stamp. Those three places check the flag; everything else is shared.
   */
  // The rail says the date the way the finished reports say it -- "September
  // 1, 2026" rather than 09/01/2026. The short form is still what the rest of
  // the book uses.
  function longSurveyDate(value) {
    if (!value) return '';
    var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? value + 'T12:00:00' : value);
    if (isNaN(d.getTime())) return '';
    var months = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
      'August', 'September', 'October', 'November', 'December'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  /**
   * The rail for a figure page.
   *
   * One rail serves every figure page: a section it has nothing for is simply
   * absent, so a Pictures page is the same component with no readings rather
   * than a second layout to keep in step with this one.
   */
  function railForPage(page) {
    var api = window.ToolboxReportRail;
    if (!api || typeof api.render !== 'function') return null;
    var meta = page.meta || {};
    var ev = page.evidence || {};
    var text = page.reportText || {};
    var scopeTitle = meta.scopeTitle || meta.levelName || '';
    var title = page.type === 'floor'
      ? ('Floor Level Survey' + (scopeTitle ? '\n' + scopeTitle : ''))
      : (page.title || '');
    var dateText = formatSurveyDate(meta.surveyDate || ev.surveyDate || '', true);
    return api.render({
      northRotation: typeof meta.northRotation === 'number' ? meta.northRotation : 0,
      residence: ev.residenceTitle || ev.customerName || '',
      address: ev.address || '',
      addressCity: ev.addressCity || '',
      title: title,
      // A field with no value shows a dash rather than leaving its heading
      // standing over nothing, which is what a sheet with no survey date
      // recorded looked like.
      surveyDate: longSurveyDate(meta.surveyDate || ev.surveyDate || '') || dateText || '\u2014',
      correctedNote: page.type === 'floor' ? 'Corrected for flooring differences' : '',
      stats: page.type === 'floor' && meta.imported ? ev.stats : null,
      note: text.railNote || '',
      figureLabel: meta.figureNumber ? ('Figure ' + meta.figureNumber) : '',
      markSrc: BRAND_LOGO,
    });
  }

  function renderSheet(sheet, page, pages, opts) {
    var thumb = !!(opts && opts.thumb);
    sheet.textContent = '';
    sheet.setAttribute('data-page-id', page.id);
    sheet.setAttribute('data-page-type', page.type || 'sheet');
    sheet.setAttribute('aria-label', (page.title || 'Report sheet') + ', ' + SHEET_RATIO_LABEL);
    sheet.removeAttribute('data-page-kind');

    if (isPenLogPage(page)) {
      renderPenLogSheet(sheet, page, pages, thumb);
      renderSheetFrame(sheet);
      renderBrandLayer(sheet, page, page._brandBox || (page.meta && page.meta.brandBox));
      return;
    }
    if (!thumb) penLogUi.layout = null;

    var margin = document.createElement('div');
    margin.className = 'rb-sheet__margin';

    var index = 0;
    for (var i = 0; i < pages.length; i += 1) {
      if (pages[i].id === page.id) index = i;
    }

    if (page.type === 'cover') {
      margin.classList.add('rb-sheet__margin--cover');
      margin.appendChild(renderMitchellCover(
        page,
        pages,
        page._coverLayout || (page.meta && page.meta.coverLayout),
        page._overviewUrl || ''
      ));
    } else if (page.type === 'section' && page.meta && page.meta.sectionId === 'discussion' &&
               window.ToolboxReportDiscussion) {
      margin.classList.add('rb-sheet__margin--discussion');
      var discussionEl = window.ToolboxReportDiscussion.renderPage(page, {
        locked: !!(page.meta && page.meta.locked),
        facts: page._facts || null,
      });
      margin.appendChild(discussionEl);
      if (!thumb) watchDiscussionOverflow(discussionEl);
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
    } else if (page.type === 'floor' && !(page.meta && page.meta.reserved)) {
      margin.classList.add('rb-sheet__margin--topo');
      // Once imported, the drawing gets the whole sheet: the inset box the
      // other pages use is a band of white the plan cannot be moved into, and
      // it clips the plan before the paper edge when it is panned.
      if (page.meta && page.meta.imported) margin.classList.add('rb-sheet__margin--topo-bleed');
      margin.classList.add('rb-sheet__margin--railed');
      var fl = window.ToolboxReportFloorLayout;
      if (fl && typeof fl.renderPage === 'function') {
        var imported = !!(page.meta && page.meta.imported && page.evidence && page.evidence.figure);
        var layout = (page.meta && page.meta.layout) || page._bookFloorLayout || fl.defaultLayout();
        var rendered = fl.renderPage(page, page.evidence || {}, {
          imported: imported,
          layout: layout,
          formatSurveyDate: formatSurveyDate,
          renderNorthArrow: renderNorthArrow,
          renderRelativeReadings: renderRelativeReadings,
          // Never in a preview. There is one live topo host and it is a
          // single DOM node: handing it to a thumbnail moves it off the
          // sheet and into the stamp, taking the drawing with it.
          mountTopo: thumb ? null : (page._mountTopo || null),
        });
        if (page.meta && !thumb) page.meta.layout = rendered.layout;
        margin.appendChild(rendered.root);
      } else if (!renderEvidence(margin, page)) {
        addLine(margin, 'rb-sheet__note', 'Floor Survey page unavailable.');
      }
    } else if (page.type === 'distress' || page.type === 'diagnostics') {
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

    if (page.type === 'floor' && !(page.meta && page.meta.reserved)) {
      var rail = railForPage(page);
      if (rail) sheet.appendChild(rail);
    }

    if (window.ToolboxReportOverlay) {
      sheet.appendChild(window.ToolboxReportOverlay.renderLayer(
        page.meta && page.meta.overlays,
        { locked: false, mediaUrls: overlayUrlCache }
      ));
    }

    var hidePageNum = page.type === 'cover' ||
      page.type === 'pictures' ||
      // The decks carry no page number on the discussion sheet.
      (page.type === 'section' && page.meta && page.meta.sectionId === 'discussion') ||
      (page.type === 'floor' && !(page.meta && page.meta.reserved));
    if (!hidePageNum) {
      var footer = document.createElement('p');
      footer.className = 'rb-sheet__page';
      footer.id = 'rb-sheet-page';
      footer.textContent = 'Page ' + (index + 1);
      margin.appendChild(footer);
    }
    sheet.appendChild(margin);
    renderSheetFrame(sheet);
    renderBrandLayer(sheet, page, page._brandBox || (page.meta && page.meta.brandBox));
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

  function persistableDocument(pages, activePageId, prior, floorLayout, coverLayout, brandBox, floorCamera, floorView, floorFramed) {
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
    var flApi = window.ToolboxReportFloorLayout;
    if (floorLayout && flApi) {
      doc.floorLayout = flApi.normalizeLayout(floorLayout);
    } else if (prior && prior.floorLayout) {
      doc.floorLayout = flApi ? flApi.normalizeLayout(prior.floorLayout) : prior.floorLayout;
    }
    var coverApi = window.ToolboxReportCoverLayout;
    if (coverLayout && coverApi) {
      doc.coverLayout = coverApi.normalizeLayout(coverLayout);
    } else if (prior && prior.coverLayout) {
      doc.coverLayout = coverApi ? coverApi.normalizeLayout(prior.coverLayout) : prior.coverLayout;
    }
    // The logo is placed once for the whole book, like the cover and floor
    // layouts -- not per sheet. Where it is put is where it stays.
    var discApi = window.ToolboxReportDiscussion;
    var brand = brandBox || (prior && prior.brandBox);
    if (brand) doc.brandBox = discApi ? discApi.normalizeBrandBox(brand) : brand;
    var camera = floorCamera || (prior && prior.floorCamera);
    if (camera) doc.floorCamera = JSON.parse(JSON.stringify(camera));
    var view = floorView || (prior && prior.floorView);
    if (view) doc.floorView = JSON.parse(JSON.stringify(view));
    if (floorFramed || (prior && prior.floorFramed)) doc.floorFramed = true;
    return doc;
  }

  /**
   * Repair Floor Survey render settings saved by a build that could not draw
   * the canvas chrome.
   *
   * While the slide passed `hideCanvasChrome`, TopoTab's `resolved` object had
   * showLegend / showStatsPill / showHighLow forced to false, and the rail's
   * own `update()` writes `onSettingsChange(resolveSettings({ ...resolved,
   * ...patch }))`. So every control the investigator touched wrote those three
   * `false` flags straight into the report.
   *
   * The slide draws its own chrome again now, and it honours stored settings --
   * which means a report saved under the old behaviour comes back with the
   * colour scale, the pill and the High/Low markers still switched off. It
   * works perfectly on a new file and stays broken on the one that was open at
   * the time, which is exactly what it looked like from the outside.
   *
   * Clearing the three flags once is the repair. A setting saved by a version
   * that could not render the thing it describes should not outlive it, and the
   * investigator should not have to find three switches to undo a bug.
   */
  var FLOOR_VIEW_CHROME_FIX = 1;

  function reviveFloorView(view) {
    if (!view || typeof view !== 'object') return view;
    var next = JSON.parse(JSON.stringify(view));
    if (next.chromeFix >= FLOOR_VIEW_CHROME_FIX) return next;

    // Settings saved before the slide could draw its own chrome. Clear the
    // three flags once, then stamp, so everything chosen after this is kept
    // forever.
    //
    // The first attempt only repaired a file with all three false, on the
    // reasoning that the old build forced them as a set and so all three off
    // was its signature. That was too clever. Turning the legend and the
    // markers back on by hand leaves showStatsPill false on its own -- a value
    // nobody chose, left behind by the bug -- and the repair never fired. Tim
    // hit exactly that: legend and High/Low on the page, no pill.
    //
    // Guessing intent from values cannot tell "left over" from "deliberate",
    // so it does not try. A stamp can tell "before the fix" from "after it",
    // which is the question that actually matters. The cost is that a setting
    // deliberately turned off before today comes back once; the alternative is
    // leaving chrome switched off that nobody switched off.
    ['showLegend', 'showStatsPill', 'showHighLow'].forEach(function (key) {
      delete next[key];
    });
    next.chromeFix = FLOOR_VIEW_CHROME_FIX;
    if (window.console && console.info) {
      console.info('Report Builder: restored Floor Survey chrome suppressed by an earlier build.');
    }
    return next;
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
    var dirty = false;
    var workingRecord = null;
    var saveTimer = null;
    var lastSavedAt = '';
    var floorLayout = window.ToolboxReportFloorLayout
      ? window.ToolboxReportFloorLayout.defaultLayout()
      : { locked: false, topo: { x: 10, y: 6, w: 80, h: 88 }, overlays: [] };
    var coverLayout = window.ToolboxReportCoverLayout
      ? window.ToolboxReportCoverLayout.defaultLayout()
      : { locked: false, boxes: {}, overviewMediaId: '' };
    // One logo placement for the whole book. Null until the document says
    // otherwise, so a report saved before this still shows where its logo was
    // put (the per-sheet copy is adopted on open).
    var brandBox = null;
    // One camera for every Floor Survey slide: the same part of the plan at the
    // same zoom, so clicking through Combined, Main Level, Kitchen and Garage
    // is a flip book -- the building does not move. The chrome (colour scale,
    // H/L/delta pill, the markers) is deliberately NOT part of this: the high
    // point sits somewhere different on each boundary, so a marker that is
    // right on one slide would land on a wall on the next.
    var floorCamera = null;
    // The document's default rendition. Each Floor Survey slide keeps its own
    // on page.meta.floorView; this is what a slide opens with before it has
    // been given one, and what older reports carry.
    var floorView = null;

    // The picture is shared. The rendition is not.
    //
    // Lock View pins where the plan sits and how big it is, so the building is
    // framed identically on every Floor Survey slide -- that is the picture,
    // and it is deliberately one setting for the whole report. What is DRAWN
    // inside that frame belongs to the slide: one page carries contours, the
    // next shows the same level with contours off and readings only, a third
    // shows another level. Those render settings used to be a single object
    // for the whole report, so turning contours off on one slide turned them
    // off on all of them, and the copy-a-slide-and-change-it move did not work.
    function floorViewFor(page) {
      if (page && page.meta && page.meta.floorView) return page.meta.floorView;
      return floorView;
    }
    function setFloorViewFor(page, next) {
      if (!page) {
        floorView = next;
        return;
      }
      page.meta = page.meta || {};
      page.meta.floorView = next;
      // Deliberately NOT written back to the document default. A slide that
      // has not been given its own rendition reads that default, so pushing
      // one slide's change into it would carry straight through to every
      // other slide -- which is the behaviour being fixed. The default stays
      // the baseline a slide opens at.
    }
    // Whether the frame has been given the plan's proportion yet. Once it has,
    // the frame is whatever it has been dragged to and is never re-fitted.
    var floorFramed = false;
    var coverOverviewUrl = '';
    var floorDrag = null;
    var coverDrag = null;
    pageSeq = pages.length;

    host.innerHTML = shellHtml();
    var root = host.querySelector('.rb-shell');
    var fileLabelEl = root.querySelector('#rb-file-label');
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

    function setSaveStatus(text) {
      if (saveStatusEl) saveStatusEl.textContent = text || '';
    }

    function markDirty() {
      recordHistory();
      dirty = true;
      // The save itself is debounced; only the STATUS fired on every
      // keystroke, which made it look as though every character was being
      // written. Say "Edited" while typing and "Saving" when a save actually
      // starts.
      setSaveStatus('Edited');
      if (draftEl) draftEl.textContent = 'Edited';
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        flushSave().catch(function () {});
      }, AUTOSAVE_DELAY_MS);
    }

    /**
     * Take back the components Report Builder reads but does not own, so this
     * save carries whatever another workspace wrote while the report was open.
     *
     * Floor Survey is the one that moves today: the colour scale, the H/L/delta
     * pill and the High and Low markers are placed on the level, and a slide
     * now lets the investigator drag them. Customer Information is here for the
     * same reason -- the cover reads it, nothing in the report writes it.
     *
     * A failed read is not a failed save. The report's own work still goes
     * down; the borrowed components just stay as they were.
     */
    function refreshBorrowedComponents() {
      if (!window.ToolboxDB || typeof window.ToolboxDB.getCustomerFile !== 'function') {
        return Promise.resolve();
      }
      return window.ToolboxDB.getCustomerFile(customerFileId).then(function (stored) {
        if (!stored || !workingRecord) return;
        if (stored.floorSurvey) workingRecord.floorSurvey = stored.floorSurvey;
        if (stored.planSetup) workingRecord.planSetup = stored.planSetup;
      }).catch(function () {
        /* offline or unreadable — keep what is in hand rather than losing the report */
      });
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
      var doc = persistableDocument(
        pages,
        activeId,
        workingRecord && (workingRecord.reportBuilder || workingRecord.report),
        floorLayout,
        coverLayout,
        brandBox,
        floorCamera,
        floorView,
        floorFramed
      );
      workingRecord.reportBuilder = doc;
      workingRecord.updatedAt = doc.updatedAt;
      delete workingRecord.report;
      setSaveStatus('Saving…');
      if (draftEl) draftEl.textContent = 'Saving';
      // Report Builder edits the report component and reads the rest. It held
      // the whole Customer File in memory and wrote the whole thing back, so a
      // component another workspace changed while this one was open -- the
      // Floor Survey level, when the investigator moves a colour scale, a pill
      // or a High/Low marker on a slide -- was overwritten by this stale copy
      // on the next autosave. The move landed in IndexedDB and then quietly
      // disappeared on the way back to the slide. Floor Survey owns that
      // component, so take its stored version rather than this one.
      return refreshBorrowedComponents()
        .then(function () {
          return window.ToolboxDB.saveCustomerFile(workingRecord);
        })
        .then(function () {
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

    var lastRenderedId = null;

    // --- Rail previews -------------------------------------------------
    //
    // The thumbnails were an empty white box with a page number on it, which
    // tells the investigator nothing about which slide is which. A page is
    // now drawn into each one at thumbnail size.
    //
    // Two caches. thumbCache keeps the rendered miniature against a signature
    // of the page, so a repaint of the rail does not re-render every page on
    // every keystroke; it only redraws what actually changed. floorShots
    // keeps a small picture of a Floor Survey slide's drawing, because that
    // drawing is a live canvas belonging to the slide being looked at and
    // there is only one of it -- a preview cannot mount its own. The picture
    // is taken while the investigator is on that slide, so the previews fill
    // in as the deck is worked through and then stay.
    var thumbCache = Object.create(null);
    var floorShots = Object.create(null);
    var floorShotTimer = null;

    function thumbSignature(page) {
      var shot = floorShots[page.id] || '';
      try {
        return JSON.stringify(persistablePage(page)) + '|' + shot.length;
      } catch (err) {
        return String(page.id) + '|' + shot.length;
      }
    }


    // A preview is a picture, so it must not answer to anything that looks
    // for the page being edited.
    //
    // The pages carry their own controls -- a floor slide has an Import
    // button, boxes have resize handles, text fields are editable -- and a
    // rail full of previews puts four more of each into the document, ahead
    // of the real ones. querySelector takes the first match, so Import on the
    // rail stopped working the moment previews rendered: the click went to a
    // stamp. Pointer-events alone does not fix that; the duplicates have to
    // stop matching.
    //
    // So every id and every data-rb / data-plan / data-page hook is stripped,
    // and form controls are disabled. data-rb-rich stays because the
    // stylesheet lays out the report's text through it, and nothing looks it
    // up outside the real sheet.
    function sanitizeThumb(root) {
      var nodes = root.querySelectorAll('*');
      for (var i = 0; i < nodes.length; i += 1) {
        var el = nodes[i];
        if (el.id) el.removeAttribute('id');
        if (el.hasAttribute('contenteditable')) el.setAttribute('contenteditable', 'false');
        var tag = el.tagName;
        if (tag === 'BUTTON' || tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
          el.disabled = true;
          el.setAttribute('tabindex', '-1');
        }
        if (tag === 'A') el.removeAttribute('href');
        var attrs = el.attributes;
        for (var k = attrs.length - 1; k >= 0; k -= 1) {
          var name = attrs[k].name;
          // Every data hook goes, not just the rb- ones: the pen log finds a
          // note by data-pin-id, and a preview carrying one would answer in
          // the real page's place. Only data-rb-rich stays, because the
          // stylesheet lays the report's text out through it and nothing
          // looks it up outside the sheet being edited.
          if (name === 'data-rb-rich') continue;
          if (name.indexOf('data-') === 0) el.removeAttribute(name);
        }
      }
      if (root.id) root.removeAttribute('id');
      root.removeAttribute('data-page-id');
      root.removeAttribute('data-page-type');
    }

    function buildThumbSheet(page) {
      var sheet = document.createElement('article');
      // Deliberately NOT given the rb-sheet class. Several places find the
      // page being edited with querySelector('.rb-sheet') or closest(), and a
      // rail full of sheets would hand them a stamp instead. The preview
      // carries the container itself so cqh still resolves against it.
      sheet.className = 'rb-sheet--thumb';
      sheet.setAttribute('aria-hidden', 'true');
      try {
        renderSheet(sheet, page, pages, { thumb: true });
      } catch (err) {
        // A page that cannot be drawn small is not worth failing the rail for.
        sheet.textContent = '';
      }
      sanitizeThumb(sheet);
      var shot = floorShots[page.id];
      if (shot) {
        var img = document.createElement('img');
        img.className = 'rb-thumb__shot';
        img.alt = '';
        img.src = shot;
        // Into the box the live drawing would have filled, so it sits under
        // the title block and the logo exactly as the drawing does. Dropped
        // on the sheet instead it went behind the page's own white
        // background and never showed.
        var slot = sheet.querySelector('.rb-topo-page__drawing--live') ||
                   sheet.querySelector('.rb-topo-page__drawing');
        (slot || sheet).appendChild(img);
      }
      return sheet;
    }

    // The preview is laid out at the sheet's own size and scaled to the box
    // it has to live in, so measure the box once it is on screen.
    var THUMB_SHEET_W = 680;
    function fitThumb(host, sheet) {
      var w = host.clientWidth;
      if (!w) return;
      sheet.style.setProperty('--rb-thumb-scale', String(w / THUMB_SHEET_W));
    }

    function paintThumb(host, page) {
      var sig = thumbSignature(page);
      var cached = thumbCache[page.id];
      var sheet = cached && cached.sig === sig && cached.el ? cached.el : buildThumbSheet(page);
      thumbCache[page.id] = { sig: sig, el: sheet };
      host.insertBefore(sheet, host.firstChild);
      fitThumb(host, sheet);
      window.requestAnimationFrame(function () { fitThumb(host, sheet); });
    }

    // One thumbnail, redrawn where it stands. Used after a picture of a
    // Floor Survey slide is taken, so the rail updates without re-rendering
    // the sheet the investigator is working on.
    function repaintThumb(pageId) {
      if (!listEl) return;
      var btn = listEl.querySelector('[data-page-id="' + pageId + '"]');
      if (!btn) return;
      var host = btn.querySelector('.rb-thumb__sheet');
      var page = null;
      for (var i = 0; i < pages.length; i += 1) if (pages[i].id === pageId) page = pages[i];
      if (!host || !page) return;
      var old = host.querySelector('.rb-sheet--thumb');
      if (old) host.removeChild(old);
      delete thumbCache[pageId];
      paintThumb(host, page);
    }

    // Take the picture a moment after the slide settles, so the drawing has
    // had its chance to load and render. Scaled down on the way in: a preview
    // does not need the full canvas, and holding full-size data URLs for
    // every level would be a lot of memory for a stamp.
    function scheduleFloorShot(page) {
      if (floorShotTimer) { clearTimeout(floorShotTimer); floorShotTimer = null; }
      if (!page || page.type !== 'floor' || !sheetEl) return;
      var pageId = page.id;
      floorShotTimer = setTimeout(function () {
        floorShotTimer = null;
        var cv = sheetEl.querySelector('[data-rb-topo-live] canvas');
        if (!cv || !cv.width || !cv.height) return;
        var url;
        try {
          var small = document.createElement('canvas');
          var w = 360;
          small.width = w;
          small.height = Math.max(1, Math.round(w * cv.height / cv.width));
          var sctx = small.getContext('2d');
          if (!sctx) return;
          sctx.fillStyle = '#fff';
          sctx.fillRect(0, 0, small.width, small.height);
          sctx.drawImage(cv, 0, 0, small.width, small.height);
          url = small.toDataURL('image/jpeg', 0.7);
        } catch (err) {
          return;
        }
        if (!url || floorShots[pageId] === url) return;
        floorShots[pageId] = url;
        repaintThumb(pageId);
      }, 1500);
    }

    function renderPages() {
      if (!pages.length) return;
      var index = activeIndex();
      if (index < 0) index = 0;
      activeId = pages[index].id;
      // Put the pen down whenever the sheet underneath actually changes --
      // thumbnail, jump link, add, duplicate, undo, anything. One guard here
      // instead of six, and it cannot be forgotten by a seventh. A sheet left
      // armed is a sheet nobody can click, which reads as a dead application.

      if (lastRenderedId !== null && lastRenderedId !== activeId) {
        disarmInk();
        // A different sheet means a different plan, so nothing is selected.
        sheetEl.classList.remove('rb-sheet--plan-selected');
      }
      lastRenderedId = activeId;
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
        paintThumb(thumb, item);

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

      if (current && current.type === 'floor') {
        current._bookFloorLayout = floorLayout;
        if (floorLayout && floorLayout.locked) {
          current.meta = current.meta || {};
          current.meta.layout = window.ToolboxReportFloorLayout
            ? window.ToolboxReportFloorLayout.cloneLayout(floorLayout)
            : floorLayout;
        } else if (current.meta && !current.meta.layout && floorLayout) {
          current.meta.layout = window.ToolboxReportFloorLayout
            ? window.ToolboxReportFloorLayout.cloneLayout(floorLayout)
            : floorLayout;
        }
      }
      if (current && current.type === 'cover') {
        current._coverLayout = coverLayout;
        current._overviewUrl = coverOverviewUrl;
      }
      if (current && current.type === 'section' && current.meta &&
          current.meta.sectionId === 'discussion') {
        current._facts = discussionFacts(current);
      }
      if (current) current._brandBox = currentBrandBox(current);
      // Only the slide being looked at hosts the live view; the others are not
      // in the DOM. The camera is the book's, so every level opens framed the
      // same way, and a change to it is stored for the book rather than the
      // slide.
      if (current && current.type === 'floor' && current.meta && current.meta.imported &&
          current.meta.canvasId && window.ToolboxFloorSurvey) {
        current._mountTopo = function (page) {
          return mountTopoHost(page, {
            customerFileId: customerFileId,
            camera: floorCamera,
            settings: floorViewFor(page),
            locked: !!(floorCamera && floorCamera.locked),
            onCameraChange: function (camera) {
              var locked = !!(floorCamera && floorCamera.locked);
              // rel marks a camera whose centre is a fraction of the plan
              // rather than image pixels. Dropping it here would make every
              // stored view read as the old pixel form, which is exactly the
              // thing that made two levels of one building land in different
              // places.
              floorCamera = {
                cx: camera.cx, cy: camera.cy, zoom: camera.zoom,
                rel: !!camera.rel, locked: locked,
              };
              markDirty();
            },
              onSettingsChange: function (next) {
              setFloorViewFor(page, next);
              markDirty();
            },
            onReady: function (info) {
              // The frame takes the plan's own proportion the first time a
              // level is shown, so the drawing fills it instead of sitting
              // letterboxed in white. After that it is whatever it has been
              // dragged to.
              if (!info || floorFramed) return;
              var flApi = window.ToolboxReportFloorLayout;
              if (!flApi || typeof flApi.frameForPlan !== 'function') return;
              var frame = flApi.frameForPlan(info.planWidth, info.planHeight);
              floorFramed = true;
              pages.forEach(function (item) {
                if (!item || item.type !== 'floor') return;
                item.meta = item.meta || {};
                var next = flApi.normalizeLayout(item.meta.layout || floorLayout);
                next.topo = frame;
                item.meta.layout = next;
              });
              floorLayout = flApi.normalizeLayout({ topo: frame });
              markDirty();
              renderPages();
              flushSave().catch(function () {});
            },
          });
        };
      } else {
        releaseTopoHost();
      }
      renderSheet(sheetEl, current, pages);
      syncPenLogPanel(current);
      fitSheet(root);
      // A Floor Survey slide's drawing is live and belongs to the slide being
      // looked at, so its preview is a picture taken while it is on screen.
      scheduleFloorShot(current);
      if (penLogUi.layout && typeof penLogUi.layout.layout === 'function') {
        window.requestAnimationFrame(function () {
          if (penLogUi.layout && typeof penLogUi.layout.layout === 'function') {
            penLogUi.layout.layout();
          }
        });
      }
      syncRail(current);
      addBtn.disabled = pages.length >= MAX_PAGES;
      removeBtn.disabled = pages.length <= 1;
      earlierBtn.disabled = index <= 0;
      laterBtn.disabled = index >= pages.length - 1;
      duplicateBtn.disabled = pages.length >= MAX_PAGES;
    }

    // ---- The rail ------------------------------------------------------
    //
    // Whatever slide is open, the rail is that workspace: Import at the top,
    // the workspace's own controls in the middle, the way back to the full
    // application at the bottom. The controls are not rebuilt here -- the
    // middle hosts the same panels Floor Survey draws on its own canvas, so
    // there is one definition of what Contours or Palette contains.
    var railEl = root.querySelector('[data-rb-rail]');
    var railIdleEl = root.querySelector('[data-rb-rail-idle]');
    var railTitleEl = root.querySelector('[data-rb-rail-title]');
    var railTopEl = root.querySelector('[data-rb-rail-top]');
    var railBodyEl = root.querySelector('[data-rb-rail-body]');
    var railFootEl = root.querySelector('[data-rb-rail-foot]');
    var railControls = { el: null, key: '', api: null };

    function releaseRailControls() {
      if (railControls.api && typeof railControls.api.unmount === 'function') {
        try { railControls.api.unmount(); } catch (err) { /* already gone */ }
      }
      if (railControls.el && railControls.el.parentNode) {
        railControls.el.parentNode.removeChild(railControls.el);
      }
      railControls = { el: null, key: '', api: null };
    }

    function railButton(label, kind, attr, value) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn--' + kind + ' rb-ws__btn';
      btn.textContent = label;
      if (attr) btn.setAttribute(attr, value || '');
      return btn;
    }

    function syncRail(page) {
      if (!railEl) return;
      var isPictures = !!(page && page.type === 'pictures');
      if (isPictures) {
        releaseRailControls();
        railEl.hidden = false;
        if (railIdleEl) railIdleEl.hidden = true;
        if (railTitleEl) railTitleEl.textContent = 'Pictures';
        railTopEl.textContent = '';
        var acrossNow = picturesAcross(page);
        var row = document.createElement('div');
        row.className = 'rb-ws__row';
        PICTURES_ACROSS.forEach(function (n) {
          var btn = railButton(String(n) + ' across',
            n === acrossNow ? 'accent' : 'secondary', 'data-rb-pics-across', String(n));
          row.appendChild(btn);
        });
        railTopEl.appendChild(row);
        var picHint = document.createElement('p');
        picHint.className = 'rb-panel__lead';
        picHint.textContent = 'Fewer across makes each picture bigger. Rows follow from how many this page holds.';
        railTopEl.appendChild(picHint);
        if (railBodyEl) railBodyEl.textContent = '';
        return;
      }
      var isFloor = !!(page && page.type === 'floor' && !(page.meta && page.meta.reserved));
      if (!isFloor) {
        releaseRailControls();
        railEl.hidden = true;
        if (railIdleEl) railIdleEl.hidden = false;
        return;
      }
      railEl.hidden = false;
      if (railIdleEl) railIdleEl.hidden = true;
      if (railTitleEl) railTitleEl.textContent = 'Floor Survey';

      var imported = !!(page.meta && page.meta.imported);
      railTopEl.textContent = '';
      if (!imported) {
        railTopEl.appendChild(
          railButton('Import Floor Survey', 'accent', 'data-rb-floor-import', page.id || ''));
        var hint = document.createElement('p');
        hint.className = 'rb-panel__lead';
        hint.textContent = 'Brings this level onto the slide.';
        railTopEl.appendChild(hint);
      } else {
        railTopEl.appendChild(
          railButton(floorCamera && floorCamera.locked ? 'Unlock view' : 'Lock view',
            floorCamera && floorCamera.locked ? 'secondary' : 'accent',
            'data-rb-floor-lock', floorCamera && floorCamera.locked ? 'unlock' : 'lock'));
        var viewHint = document.createElement('p');
        viewHint.className = 'rb-panel__lead';
        viewHint.textContent = floorCamera && floorCamera.locked
          ? 'Every Floor Survey slide frames the plan this way. What is drawn on it stays per slide.'
          : 'Drag the plan to move it. Drag the corner to size it. Lock when it sits where you want it on every slide.';
        railTopEl.appendChild(viewHint);
      }

      // Middle: the real Floor Survey controls, for an imported slide.
      var api = window.ToolboxFloorSurvey;
      var meta = page.meta || {};
      var key = [page.id, meta.canvasId, meta.areaId || '', meta.scope || ''].join('|');
      if (!imported || !api || typeof api.mount !== 'function') {
        releaseRailControls();
      } else if (railControls.el && railControls.key === key) {
        if (railControls.api && typeof railControls.api.update === 'function') {
          railControls.api.update({ settings: floorViewFor(page) });
        }
        if (railControls.el.parentNode !== railBodyEl) railBodyEl.appendChild(railControls.el);
      } else {
        releaseRailControls();
        var host = document.createElement('div');
        host.className = 'rb-ws__controls';
        railBodyEl.appendChild(host);
        railControls = { el: host, key: key, api: null };
        railControls.api = api.mount(host, {
          customerFileId: customerFileId,
          workspace: 'report-topo-controls',
          canvasId: meta.canvasId || '',
          areaId: meta.scope === 'all' ? null : (meta.areaId || null),
          settings: floorViewFor(page),
          onBack: function () {},
          onSettingsChange: function (next) {
            setFloorViewFor(activePage(), next);
            markDirty();
            // The drawing is a second root looking at the same settings.
            if (topoHost.api && typeof topoHost.api.update === 'function') {
              topoHost.api.update({ settings: next });
            }
            flushSave().catch(function () {});
          },
        });
      }

      railFootEl.textContent = '';
      railFootEl.appendChild(
        railButton('Open Floor Survey', 'secondary', 'data-rb-source', 'floor'));
      var footHint = document.createElement('p');
      footHint.className = 'rb-panel__lead';
      footHint.textContent = 'For changes other than formatting.';
      railFootEl.appendChild(footHint);
    }

    // The rail's buttons are built per slide, so they are handled by
    // delegation rather than by listeners attached once at mount.
    if (railEl) {
      railEl.addEventListener('click', function (event) {
        var importBtn = event.target.closest('[data-rb-floor-import]');
        if (importBtn) {
          event.preventDefault();
          importActiveFloorPage();
          return;
        }
        var acrossBtn = event.target.closest('[data-rb-pics-across]');
        if (acrossBtn) {
          event.preventDefault();
          var pic = activePage();
          if (!pic || pic.type !== 'pictures') return;
          var want = Number(acrossBtn.getAttribute('data-rb-pics-across'));
          if (PICTURES_ACROSS.indexOf(want) < 0) return;
          pic.meta = pic.meta || {};
          if (pic.meta.picturesAcross === want) return;
          pic.meta.picturesAcross = want;
          markDirty();
          renderPages();
          flushSave().catch(function () {});
          return;
        }
        var lockBtn = event.target.closest('[data-rb-floor-lock]');
        if (lockBtn) {
          event.preventDefault();
          var want = lockBtn.getAttribute('data-rb-floor-lock') === 'lock';
          // Lock View is about the camera -- the plan sitting in the same
          // place on every Floor Survey slide. It is deliberately not about
          // the chrome, which stays movable per slide.
          if (!floorCamera) floorCamera = { cx: 0.5, cy: 0.5, zoom: 1, rel: true, locked: false };
          floorCamera.locked = want;
          markDirty();
          renderPages();
          flushSave().catch(function () {});
          return;
        }
        var sourceBtn = event.target.closest('[data-rb-source]');
        if (sourceBtn) {
          event.preventDefault();
          var key = sourceBtn.getAttribute('data-rb-source');
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
        }
      });
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
      var brandLock = event.target.closest('[data-rb-brand-lock]');
      if (brandLock) {
        event.preventDefault();
        var page = activePage();
        if (!page) return;
        var api = window.ToolboxReportDiscussion;
        var box = api ? api.normalizeBrandBox(currentBrandBox(page)) : (currentBrandBox(page) || {});
        box.locked = brandLock.getAttribute('data-rb-brand-lock') === 'lock';
        applyBrandBox(box);
        markDirty();
        renderPages();
        flushSave().catch(function () {});
        return;
      }
      var jump = event.target.closest('[data-rb-goto]');
      if (!jump) return;
      var targetId = jump.getAttribute('data-rb-goto');
      if (!targetId || targetId === activeId) return;
      activeId = targetId;
      markDirty();
      renderPages();
    });

    // Typing and a toolbar command both have to persist the same way: a
    // toolbar click rewrites the field's markup without the investigator
    // touching the keyboard.
    // Only what the Customer File already holds. Nothing interpretive.
    function discussionFacts(page) {
      var meta = (page && page.meta) || {};
      var record = workingRecord || {};
      var parts = addressParts(meta.addressFull || meta.address || record.propertyAddress || '');
      var floor = record.floorSurvey || {};
      var canvases = (record.planSetup && record.planSetup.canvases) || [];
      var facing = meta.frontDoorFacing || '';
      if (!facing) {
        for (var i = 0; i < canvases.length && !facing; i += 1) {
          facing = canvases[i] && (canvases[i].frontDoorFacing || canvases[i].frontDoor) || '';
        }
      }
      return {
        surveyDate: formatSurveyDate(meta.floorSurveyDate || floor.inspectionDate || '', true),
        street: parts.street,
        cityLine: parts.cityLine,
        frontDoor: facing,
      };
    }

    // ---- Logo placement ------------------------------------------------
    // One placement for the whole book: every discussion sheet, including a
    // continuation, carries the same logo position so the pages match.
    // The placement to draw: the book's own, or -- for a report written
    // before the logo became one book-wide placement -- whatever that sheet
    // was carrying.
    function currentBrandBox(page) {
      if (brandBox) return brandBox;
      return (page && page.meta && page.meta.brandBox) || null;
    }

    function adoptLegacyBrandBox() {
      if (brandBox) return;
      var api = window.ToolboxReportDiscussion;
      for (var i = 0; i < pages.length; i += 1) {
        var meta = pages[i] && pages[i].meta;
        if (meta && meta.brandBox) {
          brandBox = api ? api.normalizeBrandBox(meta.brandBox) : meta.brandBox;
          return;
        }
      }
    }

    function applyBrandBox(box) {
      var api = window.ToolboxReportDiscussion;
      var next = api ? api.normalizeBrandBox(box) : box;
      brandBox = next;
      // Older documents carried a copy on every sheet. There is one placement
      // now, so the copies go rather than sitting there contradicting it.
      pages.forEach(function (item) {
        if (item && item.meta && item.meta.brandBox) delete item.meta.brandBox;
      });
      return next;
    }

    var brandDrag = null;

    sheetEl.addEventListener('pointerdown', function (event) {
      var grip = event.target.closest('[data-rb-brand-resize]');
      var mover = grip ? null : event.target.closest('[data-rb-brand-box]');
      if (!grip && !mover) return;
      if (mover && mover.classList.contains('is-locked')) return;
      var page = activePage();
      if (!page) return;
      // The logo is placed against the sheet, which is the one thing every
      // page type has in common.
      var rect = sheetEl.getBoundingClientRect();
      if (!rect || rect.width < 8) return;
      event.preventDefault();
      var api = window.ToolboxReportDiscussion;
      brandDrag = {
        resize: !!grip,
        startX: event.clientX,
        startY: event.clientY,
        rect: rect,
        box: api ? api.normalizeBrandBox(currentBrandBox(page)) : currentBrandBox(page),
      };
    });

    sheetEl.addEventListener('pointermove', function (event) {
      if (!brandDrag) return;
      var dx = ((event.clientX - brandDrag.startX) / brandDrag.rect.width) * 100;
      var dy = ((event.clientY - brandDrag.startY) / brandDrag.rect.height) * 100;
      var b = brandDrag.box;
      var next = brandDrag.resize
        ? { x: b.x, y: b.y, w: b.w + dx, h: b.h + dy, locked: false }
        : { x: b.x + dx, y: b.y + dy, w: b.w, h: b.h, locked: false };
      var api = window.ToolboxReportDiscussion;
      next = api ? api.normalizeBrandBox(next) : next;
      var live = sheetEl.querySelector('[data-rb-brand-box]');
      if (live) {
        live.style.left = next.x + '%';
        live.style.top = next.y + '%';
        live.style.width = next.w + '%';
        live.style.height = next.h + '%';
      }
      brandDrag.next = next;
    });

    function endBrandDrag() {
      if (!brandDrag) return;
      if (brandDrag.next) {
        applyBrandBox(brandDrag.next);
        markDirty();
        flushSave().catch(function () {});
      }
      brandDrag = null;
    }

    sheetEl.addEventListener('pointerup', endBrandDrag);
    sheetEl.addEventListener('pointercancel', endBrandDrag);

    // ---- Undo ---------------------------------------------------------
    // Everything here autosaves within a second, so a deletion is committed
    // before there is any chance to think better of it. The browser's own
    // undo cannot help: a paste, a reflow or a formatting command rebuilds the
    // markup and wipes its stack. History is therefore kept on the report
    // document itself -- snapshots of the pages -- so Ctrl+Z reaches anything
    // that changed the report, not just typing.
    var history = [];
    var historyAt = -1;
    var historyTimer = null;
    var restoring = false;
    var HISTORY_LIMIT = 60;

    /** Close any pending history step, so what follows is its own undo point.
     *  Same three lines undo() already uses before applying a step. */
    function flushHistoryNow() {
      if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; snapshotNow(); }
    }

    function snapshotNow() {
      if (restoring) return;
      var shot = JSON.stringify({ pages: pages, activeId: activeId });
      if (historyAt >= 0 && history[historyAt] === shot) return;
      history = history.slice(0, historyAt + 1);
      history.push(shot);
      if (history.length > HISTORY_LIMIT) history.shift();
      historyAt = history.length - 1;
      updateHistoryButtons();
    }

    // Typing settles before it becomes an undo step, so one keystroke is not
    // one step.
    function recordHistory() {
      if (restoring) return;
      if (historyTimer) clearTimeout(historyTimer);
      historyTimer = setTimeout(function () {
        historyTimer = null;
        snapshotNow();
      }, 700);
    }

    function applyHistory(index) {
      if (index < 0 || index >= history.length) return false;
      var shot = JSON.parse(history[index]);
      restoring = true;
      pages = shot.pages;
      activeId = shot.activeId;
      historyAt = index;
      renderPages();
      fitSheet(root);
      restoring = false;
      markDirty();
      flushSave().catch(function () {});
      updateHistoryButtons();
      return true;
    }

    function undo() {
      if (historyTimer) { clearTimeout(historyTimer); historyTimer = null; snapshotNow(); }
      return applyHistory(historyAt - 1);
    }

    function redo() { return applyHistory(historyAt + 1); }

    function updateHistoryButtons() {
      if (!formatToolbar || typeof formatToolbar.setHistory !== 'function') return;
      formatToolbar.setHistory(historyAt > 0, historyAt < history.length - 1);
    }

    document.addEventListener('keydown', function (event) {
      var meta = event.ctrlKey || event.metaKey;
      if (!meta) return;
      var key = (event.key || '').toLowerCase();
      if (key !== 'z' && key !== 'y') return;
      if (!root.contains(document.activeElement) && document.activeElement !== document.body) return;
      event.preventDefault();
      if (key === 'y' || event.shiftKey) redo();
      else undo();
    });

    // ---- Annotations -------------------------------------------------
    // Free elements: they do not register to anything and do not inherit a
    // locked layout, because their job is to point at something on this page.
    var overlayColor = (window.ToolboxReportOverlay &&
      window.ToolboxReportOverlay.COLORS[0]) || '#c14a2b';
    var overlayDrag = null;

    function overlayList(page) {
      if (!page) return null;
      page.meta = page.meta || {};
      if (!Array.isArray(page.meta.overlays)) page.meta.overlays = [];
      return page.meta.overlays;
    }

    function findOverlay(page, id) {
      var list = overlayList(page) || [];
      for (var i = 0; i < list.length; i += 1) if (list[i].id === id) return list[i];
      return null;
    }

    function storeOverlayImage(item, dataUrl) {
      if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) return;
      if (!window.ToolboxDB || typeof window.ToolboxDB.putMedia !== 'function') return;
      var mediaId = 'report-overlay-' + customerFileId + '-' + item.id;
      window.ToolboxDB.putMedia(mediaId, dataUrl).then(function () {
        item.mediaId = mediaId;
        overlayUrlCache[mediaId] = dataUrl;
        markDirty();
        renderPages();
        flushSave().catch(function () {});
      }).catch(function (err) {
        console.warn('Annotation picture could not be saved', err);
        setSaveStatus('Picture save failed');
      });
    }

    function pickOverlayImage(item) {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', function () {
        var file = input.files && input.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          storeOverlayImage(item, typeof reader.result === 'string' ? reader.result : '');
        };
        reader.readAsDataURL(file);
      });
      input.click();
    }

    // ---- Drawing: arm a tool, then draw on the sheet ----------------------
    //
    // Report Builder's annotations have always been click-to-insert: a preset
    // box lands at a fixed spot and you drag it where you meant. Distress has
    // always been pick-a-tool-then-draw. This is Distress's, because that is
    // what the investigator already knows and because the ink has to match the
    // marks made in the field.
    var inkTool = null;
    var inkThick = 2;
    var inkDrag = null;

    function setInkTool(name) {
      inkTool = name || null;
      if (!sheetEl) return;
      sheetEl.classList.toggle('rb-sheet--inking', !!inkTool);
      sheetEl.classList.toggle('rb-sheet--erasing', inkTool === 'eraser');
      if (inkTool && document.activeElement && document.activeElement.blur) {
        // A live caret would keep the toolbar holding a range that is about to
        // be meaningless, and a contenteditable under the shield cannot be
        // typed into anyway.
        try { document.activeElement.blur(); } catch (err) { /* not focusable */ }
      }
    }

    /** Put the pen down. Page changes and unmount MUST call this: a sheet left
     *  armed is a sheet nobody can click, which reads as a dead application. */
    function disarmInk() {
      if (!inkTool) return;
      setInkTool(null);
      if (formatToolbar && typeof formatToolbar.setTool === 'function') formatToolbar.setTool(null);
    }

    function sheetPercent(event) {
      var rect = sheetEl.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return null;
      return {
        x: ((event.clientX - rect.left) / rect.width) * 100,
        y: ((event.clientY - rect.top) / rect.height) * 100,
      };
    }

    // One user unit of the ink viewBox is 0.1 in. These are Distress's
    // thresholds expressed physically rather than in its plan pixels.
    var INK_STEP_PCT = 0.15 / 1.7;   // ~0.015 in between freehand points
    var INK_MIN_PCT = 1.2 / 1.7;     // ~0.12 in before a drag counts as a shape

    function beginInk(event) {
      var page = activePage();
      var api = window.ToolboxReportOverlay;
      if (!page || !api || !inkTool || inkTool === 'eraser') return;
      var at = sheetPercent(event);
      if (!at) return;
      event.preventDefault();
      // Close any pending history step so the stroke is its own undo point.
      flushHistoryNow();
      var item = {
        id: 'ov-' + Date.now().toString(36) + '-' + Math.floor(Math.random() * 1e6).toString(36),
        kind: inkTool === 'pencil' ? 'path' : inkTool,
        color: overlayColor,
        thick: inkThick,
      };
      if (item.kind === 'path') item.points = [[at.x, at.y]];
      else { item.x0 = at.x; item.y0 = at.y; item.x1 = at.x; item.y1 = at.y; }
      // Pushed immediately and edited in place, so the preview IS the shape --
      // the same trick Distress uses, and it means no separate preview path to
      // drift from the real one.
      overlayList(page).push(item);
      renderPages();
      inkDrag = { id: item.id, pointerId: event.pointerId, start: at };
      try {
        var layer = sheetEl.querySelector('[data-rb-ov-layer]');
        if (layer && layer.setPointerCapture) layer.setPointerCapture(event.pointerId);
      } catch (err) { /* capture is a convenience */ }
    }

    function moveInk(event) {
      if (!inkDrag || inkDrag.pointerId !== event.pointerId) return;
      var page = activePage();
      var item = page && findOverlay(page, inkDrag.id);
      if (!item) return;
      var at = sheetPercent(event);
      if (!at) return;
      event.preventDefault();
      if (item.kind === 'path') {
        var last = item.points[item.points.length - 1];
        if (Math.hypot(at.x - last[0], at.y - last[1]) < INK_STEP_PCT) return;
        item.points.push([at.x, at.y]);
      } else {
        item.x1 = at.x;
        item.y1 = at.y;
      }
      // Repaint this one shape only. renderPages() here would rebuild the sheet
      // 60x a second, and markDirty() would schedule an autosave and a history
      // snapshot on every move.
      repaintInk(item);
    }

    function repaintInk(item) {
      var api = window.ToolboxReportOverlay;
      var svg = sheetEl.querySelector('[data-rb-ov-ink]');
      if (!svg || !api) return;
      var old = svg.querySelector('g[data-rb-ov="' + item.id + '"]');
      var next = api.renderInk(api.normalize([item])[0] || item);
      if (old) svg.replaceChild(next, old);
      else svg.appendChild(next);
    }

    function endInk(event) {
      if (!inkDrag || inkDrag.pointerId !== event.pointerId) return;
      var page = activePage();
      var item = page && findOverlay(page, inkDrag.id);
      inkDrag = null;
      if (!page || !item) return;
      var tooSmall;
      if (item.kind === 'path') tooSmall = item.points.length < 2;
      else tooSmall = Math.hypot(item.x1 - item.x0, item.y1 - item.y0) < INK_MIN_PCT;
      if (tooSmall) {
        page.meta.overlays = overlayList(page).filter(function (o) { return o.id !== item.id; });
      } else if (item.kind === 'path') {
        item.points = decimateInk(item.points);
      }
      markDirty();
      renderPages();
      flushSave().catch(function () {});
    }

    /**
     * Freehand is the first unbounded-size data the report document has ever
     * carried, and every stroke rides in all 60 undo snapshots and in the
     * autosave. Drop points that sit on the line between their neighbours.
     */
    function decimateInk(points) {
      if (points.length < 3) return points;
      var out = [points[0]];
      for (var i = 1; i < points.length - 1; i += 1) {
        var a = out[out.length - 1], b = points[i], c = points[i + 1];
        var ab = Math.hypot(b[0] - a[0], b[1] - a[1]);
        var bc = Math.hypot(c[0] - b[0], c[1] - b[1]);
        var ac = Math.hypot(c[0] - a[0], c[1] - a[1]);
        if (ab + bc - ac > 0.04) out.push(b);
      }
      out.push(points[points.length - 1]);
      return out;
    }

    function eraseAt(event) {
      var hit = event.target.closest('[data-rb-ov]');
      if (!hit) return;
      var page = activePage();
      if (!page) return;
      event.preventDefault();
      var id = hit.getAttribute('data-rb-ov');
      flushHistoryNow();
      page.meta.overlays = overlayList(page).filter(function (o) { return o.id !== id; });
      markDirty();
      renderPages();
      flushSave().catch(function () {});
    }

    function insertOverlay(kind) {
      var page = activePage();
      var api = window.ToolboxReportOverlay;
      if (!page || !api) return;
      var list = overlayList(page);
      var item = api.create(kind);
      item.color = overlayColor;
      // Step each new annotation clear of the last, or inserting a circle and
      // an arrow drops them exactly on top of each other and only the upper
      // one can be grabbed.
      var step = (list.length % 5) * 4;
      item.x = Math.min(92, item.x + step);
      item.y = Math.min(88, item.y + step);
      list.push(item);
      markDirty();
      renderPages();
      flushSave().catch(function () {});
      if (kind === 'image') pickOverlayImage(item);
    }

    // Pictures are hydrated from the media store on open so a placed photo
    // comes back rather than leaving an empty frame.
    function hydrateOverlayImages() {
      if (!window.ToolboxDB || typeof window.ToolboxDB.getMedia !== 'function') return;
      var wanted = [];
      pages.forEach(function (page) {
        var list = page && page.meta && page.meta.overlays;
        if (!Array.isArray(list)) return;
        list.forEach(function (item) {
          if (item && item.mediaId && !overlayUrlCache[item.mediaId]) wanted.push(item.mediaId);
        });
      });
      if (!wanted.length) return;
      Promise.all(wanted.map(function (id) {
        return window.ToolboxDB.getMedia(id).then(function (value) {
          if (typeof value === 'string' && value) overlayUrlCache[id] = value;
        }).catch(function () { /* a missing picture is not a failed report */ });
      })).then(function () {
        if (token !== mountGeneration) return;
        renderPages();
      });
    }

    sheetEl.addEventListener('click', function (event) {
      var kill = event.target.closest('[data-rb-ov-remove]');
      if (!kill) return;
      event.preventDefault();
      var page = activePage();
      var list = overlayList(page);
      if (!list) return;
      var id = kill.getAttribute('data-rb-ov-remove');
      page.meta.overlays = list.filter(function (item) { return item.id !== id; });
      markDirty();
      renderPages();
      flushSave().catch(function () {});
    });

    // Dragging a pin on a Picture Locations page.
    //
    // Modelled on the cover-box drag: capture the CHILD box's rect once at
    // pointerdown and convert deltas against it, because a pin is positioned in
    // percent of the plan rect rather than of the sheet.
    //
    // The markers all share z-index 1, so a stack of three resolves by document
    // order and the last pin wins the pointerdown. That is the right one: drag
    // it clear and the next is exposed underneath, so a stack peels apart one
    // at a time without needing any stacking logic.
    var pinDrag = null;

    sheetEl.addEventListener('pointerdown', function (event) {
      if (inkTool) return;
      var marker = event.target.closest && event.target.closest('.rb-penlog__pin');
      if (!marker) return;
      var fit = marker.parentElement;
      if (!fit || !fit.classList.contains('rb-penlog__fit')) return;
      var rect = fit.getBoundingClientRect();
      if (rect.width < 8 || rect.height < 8) return;
      var page = activePage();
      var id = marker.getAttribute('data-pin-id');
      if (!page || !id) return;
      event.preventDefault();
      var offsets = penLogOffsetMap(page);
      pinDrag = {
        id: id,
        marker: marker,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        rectW: rect.width,
        rectH: rect.height,
        baseX: Number(marker.getAttribute('data-norm-x')) * 100,
        baseY: Number(marker.getAttribute('data-norm-y')) * 100,
        fromDx: (offsets[id] && offsets[id].dx) || 0,
        fromDy: (offsets[id] && offsets[id].dy) || 0,
      };
      // Above its neighbours for the duration, so the one being dragged cannot
      // be overtaken by a sibling it is passing over.
      marker.style.zIndex = '4';
      try { marker.setPointerCapture(event.pointerId); } catch (err) { /* convenience */ }
    });

    sheetEl.addEventListener('pointermove', function (event) {
      if (!pinDrag || pinDrag.pointerId !== event.pointerId) return;
      event.preventDefault();
      pinDrag.dx = pinDrag.fromDx + ((event.clientX - pinDrag.startX) / pinDrag.rectW) * 100;
      pinDrag.dy = pinDrag.fromDy + ((event.clientY - pinDrag.startY) / pinDrag.rectH) * 100;
      // Live on the node only: re-rendering the page on every move would rebuild
      // the whole sheet sixty times a second.
      pinDrag.marker.style.left = (pinDrag.baseX + pinDrag.dx) + '%';
      pinDrag.marker.style.top = (pinDrag.baseY + pinDrag.dy) + '%';
    });

    function endPinDrag(event) {
      if (!pinDrag || pinDrag.pointerId !== event.pointerId) return;
      var drag = pinDrag;
      pinDrag = null;
      drag.marker.style.zIndex = '';
      if (typeof drag.dx !== 'number') return;      // a click, not a drag
      var page = activePage();
      if (!page) return;
      applyPenLogOffset(page, drag.id, round2(drag.dx), round2(drag.dy));
      markDirty();
      renderPages();
      flushSave().catch(function () {});
    }
    sheetEl.addEventListener('pointerup', endPinDrag);
    sheetEl.addEventListener('pointercancel', endPinDrag);

    // Selecting the floor plan. Click it and its corner grips appear; click
    // anywhere else on the sheet and they go away again -- the same way the
    // logo and the cover boxes behave, and the way PowerPoint treats a picture.
    // Left permanently on they read as part of the drawing rather than as a
    // control, which is how they ended up in a PDF.
    //
    // This only observes: it never calls preventDefault and never stops
    // propagation, so the canvas's own pan, wheel zoom and grip drags are
    // untouched. While a drawing tool is armed the shield above swallows the
    // event first, so the plan is correctly not selectable then.
    document.addEventListener('pointerdown', function (event) {
      if (inkTool) return;
      if (!sheetEl || !sheetEl.isConnected) return;
      var target = event.target;
      if (!target || !target.closest) return;
      var onPlan = !!target.closest('[data-rb-topo-live]') ||
        !!target.closest('[data-plan-resize]');
      // Listening on the document rather than the sheet, because an imported
      // floor slide draws full bleed: the plan IS the whole sheet, so there is
      // nowhere on it to click off. Clicking the rail, the toolbar or the
      // margin around the page has to deselect, the way clicking away from a
      // picture does in PowerPoint.
      sheetEl.classList.toggle('rb-sheet--plan-selected', onPlan);
    }, true);

    // Drawing listens on the sheet too, but only acts while a tool is armed,
    // and the armed layer above has already stopped the event reaching anything
    // else. Registered FIRST so a stroke is never mistaken for a box drag.
    sheetEl.addEventListener('pointerdown', function (event) {
      if (!inkTool) return;
      if (inkTool === 'eraser') { eraseAt(event); return; }
      beginInk(event);
    });
    sheetEl.addEventListener('pointermove', function (event) { if (inkTool) moveInk(event); });
    sheetEl.addEventListener('pointerup', function (event) { if (inkTool) endInk(event); });
    sheetEl.addEventListener('pointercancel', function (event) { if (inkTool) endInk(event); });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') disarmInk();
    });

    sheetEl.addEventListener('pointerdown', function (event) {
      var grip = event.target.closest('[data-rb-ov-resize]');
      // Typing in an annotation must not drag it.
      if (!grip && event.target.closest('[data-rb-ov-field]')) return;
      if (!grip && event.target.closest('[data-rb-ov-remove]')) return;
      var host = grip ? null : event.target.closest('[data-rb-ov]');
      if (!grip && !host) return;
      var page = activePage();
      var id = grip ? grip.getAttribute('data-rb-ov-resize') : host.getAttribute('data-rb-ov');
      var item = findOverlay(page, id);
      if (!item) return;
      var rect = sheetEl.getBoundingClientRect();
      if (rect.width < 8) return;
      event.preventDefault();
      overlayDrag = {
        id: id,
        resize: !!grip,
        startX: event.clientX,
        startY: event.clientY,
        rect: rect,
        from: { x: item.x, y: item.y, w: item.w, h: item.h },
      };
    });

    sheetEl.addEventListener('pointermove', function (event) {
      if (!overlayDrag) return;
      var dx = ((event.clientX - overlayDrag.startX) / overlayDrag.rect.width) * 100;
      var dy = ((event.clientY - overlayDrag.startY) / overlayDrag.rect.height) * 100;
      var f = overlayDrag.from;
      var api = window.ToolboxReportOverlay;
      var next = overlayDrag.resize
        ? { x: f.x, y: f.y, w: Math.max(api.MIN_W, f.w + dx), h: Math.max(api.MIN_H, f.h + dy) }
        : { x: Math.max(0, Math.min(97, f.x + dx)), y: Math.max(0, Math.min(97, f.y + dy)), w: f.w, h: f.h };
      var live = sheetEl.querySelector('[data-rb-ov="' + overlayDrag.id + '"]');
      if (live) {
        live.style.left = next.x + '%';
        live.style.top = next.y + '%';
        live.style.width = next.w + '%';
        live.style.height = next.h + '%';
      }
      overlayDrag.next = next;
    });

    function endOverlayDrag() {
      if (!overlayDrag) return;
      if (overlayDrag.next) {
        var item = findOverlay(activePage(), overlayDrag.id);
        if (item) {
          item.x = overlayDrag.next.x;
          item.y = overlayDrag.next.y;
          item.w = overlayDrag.next.w;
          item.h = overlayDrag.next.h;
          markDirty();
          flushSave().catch(function () {});
        }
      }
      overlayDrag = null;
    }

    sheetEl.addEventListener('pointerup', endOverlayDrag);
    sheetEl.addEventListener('pointercancel', endOverlayDrag);

    // A discussion and its continuations are ONE flow, not pages that were
    // split once. Tighten the spacing or shrink the type and the room comes
    // back, so the text has to come back with it -- a split that only ever
    // ran one way would leave a half-empty second sheet behind forever.
    // Documents written while a lone <br> was being counted as a paragraph
    // break carry runs of empty paragraphs that doubled on every keystroke.
    // Fixing the parser does not clean what is already saved, so a run of two
    // or more blanks is collapsed to one when the report is opened. A single
    // blank line is a deliberate gap and is left alone.
    function repairBlankRuns() {
      var api = window.ToolboxReportText;
      if (!api) return false;
      var changed = false;
      pages.forEach(function (page) {
        var body = page && page.reportText && page.reportText.body;
        if (!body) return;
        var model = api.normalize(body);
        var out = [];
        var blanks = 0;
        model.paragraphs.forEach(function (para) {
          if (!para.runs.length) {
            blanks += 1;
            if (blanks > 1) { changed = true; return; }
          } else {
            blanks = 0;
          }
          out.push(para);
        });
        if (changed) page.reportText.body = api.compact({ paragraphs: out });
      });
      return changed;
    }

    function discussionChain() {
      var chain = [];
      var started = false;
      for (var i = 0; i < pages.length; i += 1) {
        var page = pages[i];
        var isDiscussion = page && page.type === 'section' && page.meta &&
          page.meta.sectionId === 'discussion';
        if (!isDiscussion) {
          if (started) break;
          continue;
        }
        if (!started && page.meta.continuation) continue;
        started = true;
        chain.push(page);
      }
      return chain;
    }

    // Bullets live inside a <ul>, so walk list items too or the paragraph
    // index stops matching the model.
    function firstOverflowIndex(body) {
      var limit = body.clientWidth - 1;
      var index = 0;
      var kids = body.children;
      for (var i = 0; i < kids.length; i += 1) {
        var el = kids[i];
        if (el.tagName === 'UL' || el.tagName === 'OL') {
          for (var j = 0; j < el.children.length; j += 1) {
            if (el.children[j].offsetLeft >= limit) return index;
            index += 1;
          }
        } else {
          if (el.offsetLeft >= limit) return index;
          index += 1;
        }
      }
      return -1;
    }

    function reflowDiscussion() {
      var chain = discussionChain();
      if (chain.length < 1) return false;
      var body = sheetEl.querySelector('.rb-discussion__body');
      var api = window.ToolboxReportText;
      if (!body || !api) return false;

      var all = [];
      chain.forEach(function (page) {
        var model = api.normalize((page.reportText || {}).body || '');
        all = all.concat(model.paragraphs);
      });
      while (all.length > 1 && !all[all.length - 1].runs.length) all.pop();
      if (!all.length) return false;

      // Every discussion sheet has identical body geometry, so one element
      // measures them all -- but it must not be the one being edited. Writing
      // into the live field destroyed the caret every time this ran, and a
      // re-flow that decided nothing had changed left it destroyed. The
      // measurement happens in a hidden copy sitting in the same place, so the
      // same container, width and type size apply and the investigator's
      // selection is never touched.
      var probe = body.cloneNode(false);
      probe.removeAttribute('contenteditable');
      probe.removeAttribute('data-rb-rich');
      probe.removeAttribute('data-rb-section-field');
      probe.setAttribute('aria-hidden', 'true');
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      body.parentNode.appendChild(probe);

      var sheets = [];
      var rest = all;
      var guard = 0;
      while (rest.length && guard < 40) {
        guard += 1;
        probe.innerHTML = api.toHtml({ paragraphs: rest });
        var cut = firstOverflowIndex(probe);
        if (cut < 0) { sheets.push(rest); rest = []; break; }
        if (cut <= 0) cut = 1; // always make progress
        sheets.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      if (rest.length) sheets.push(rest);
      if (probe.parentNode) probe.parentNode.removeChild(probe);

      var same = sheets.length === chain.length;
      if (same) {
        for (var s = 0; s < sheets.length && same; s += 1) {
          var before = JSON.stringify(api.compact((chain[s].reportText || {}).body || ''));
          var after = JSON.stringify(api.compact({ paragraphs: sheets[s] }));
          if (before !== after) same = false;
        }
      }
      if (same) return false;

      for (var k = 0; k < sheets.length; k += 1) {
        if (k < chain.length) {
          chain[k].reportText = chain[k].reportText || {};
          chain[k].reportText.body = api.compact({ paragraphs: sheets[k] });
        } else {
          var head = chain[0];
          var added = {
            id: 'discussion-cont-' + Date.now() + '-' + k,
            type: 'section',
            title: head.title,
            tocTitle: head.tocTitle || head.title,
            railLabel: 'Discussion (cont.)',
            includeInToc: false,
            note: '',
            sourceKey: null,
            meta: {
              // No logo copy: there is one placement for the whole book, so a
              // continuation sheet draws the same one every other sheet does.
              sectionId: 'discussion',
              continuation: true,
            },
            reportText: { body: api.compact({ paragraphs: sheets[k] }) },
          };
          var lastId = (chain[chain.length - 1] || head).id;
          var at = 0;
          for (var m = 0; m < pages.length; m += 1) if (pages[m].id === lastId) at = m;
          pages = insertPagesAt(pages, at + 1, [added]);
          chain.push(added);
        }
      }

      // Sheets no longer needed disappear; the text pulled back into the ones
      // above them.
      if (chain.length > sheets.length) {
        var drop = {};
        for (var d = sheets.length; d < chain.length; d += 1) drop[chain[d].id] = true;
        if (drop[activeId]) activeId = chain[Math.max(0, sheets.length - 1)].id;
        pages = pages.filter(function (page) { return !drop[page.id]; });
      }

      markDirty();
      return true;
    }

    function commitRichField(field) {
      if (!field) return false;
      var ovField = field.closest ? field.closest('[data-rb-ov-field]') : null;
      if (ovField) {
        var ovPage = activePage();
        var list = ovPage && ovPage.meta && ovPage.meta.overlays;
        if (!list) return false;
        var ovId = ovField.getAttribute('data-rb-ov-field');
        var api = window.ToolboxReportText;
        for (var i = 0; i < list.length; i += 1) {
          if (list[i].id !== ovId) continue;
          list[i].text = api ? api.compact(api.fromElement(ovField)) : ovField.textContent;
          markDirty();
          return true;
        }
        return false;
      }
      var sectionField = field.closest ? field.closest('[data-rb-section-field]') : null;
      if (sectionField) {
        var sectionPage = activePage();
        if (!sectionPage) return false;
        var sApi = window.ToolboxReportText;
        sectionPage.reportText = sectionPage.reportText || {};
        sectionPage.reportText[sectionField.getAttribute('data-rb-section-field')] =
          sApi ? sApi.compact(sApi.fromElement(sectionField)) : sectionField.textContent;
        markDirty();
        return true;
      }
      var coverField = field.closest ? field.closest('[data-rb-cover-field]') : null;
      if (!coverField) return false;
      var coverPage = activePage();
      if (!coverPage || coverPage.type !== 'cover') return false;
      coverPage.reportText = coverPage.reportText || seedCoverText(coverPage, pages);
      var coverKey = coverField.getAttribute('data-rb-cover-field') || '';
      var richApi = window.ToolboxReportText;
      var coverValue = richApi
        ? richApi.compact(richApi.fromElement(coverField))
        : coverField.textContent;
      if (coverKey.indexOf('contents:') === 0) {
        var lineIndex = parseInt(coverKey.slice(9), 10);
        if (!isFinite(lineIndex)) return false;
        coverPage.reportText.contents = Array.isArray(coverPage.reportText.contents)
          ? coverPage.reportText.contents
          : [];
        if (!coverPage.reportText.contents[lineIndex]) {
          coverPage.reportText.contents[lineIndex] = {
            pageId: coverField.getAttribute('data-rb-cover-page') || '',
            text: '',
          };
        }
        coverPage.reportText.contents[lineIndex].text = coverValue;
        coverPage.reportText.contents[lineIndex].pageId =
          coverField.getAttribute('data-rb-cover-page') ||
          coverPage.reportText.contents[lineIndex].pageId ||
          '';
      } else {
        coverPage.reportText[coverKey] = coverValue;
      }
      markDirty();
      return true;
    }

    // Narrative comes back from an AI collaborator as markdown. Parsing it
    // here means headings, bullets and bold arrive already formatted instead
    // of being reapplied by hand.
    sheetEl.addEventListener('paste', function (event) {
      var field = event.target.closest && event.target.closest('[data-rb-rich]');
      if (!field || field.getAttribute('contenteditable') !== 'true') return;
      var api = window.ToolboxReportText;
      if (!api || !event.clipboardData) return;
      if (clipboardImage(event)) return; // handled as the site overview
      var text = event.clipboardData.getData('text/plain');
      if (!text || !api.looksLikeMarkdown(text)) return;
      event.preventDefault();
      // No base size: headings come in bold at the field's own size, as the
      // shipped reports set them, rather than stepping up a scale.
      var html = api.toHtml(api.fromMarkdown(text, 0));
      if (!document.execCommand('insertHTML', false, html)) return;
      // insertHTML nests the whole paste inside whatever block the caret was
      // in, which produced one paragraph the height of the column. Rebuilding
      // the field from the model flattens it back into real sibling
      // paragraphs so the text can flow between columns.
      var normalized = api.compact(api.fromElement(field));
      field.innerHTML = api.toHtml(normalized);
      commitRichField(field);
      if (reflowDiscussion()) {
        renderPages();
        flushSave().catch(function () {});
      }
    });

    sheetEl.addEventListener('focusin', function (event) {
      var field = event.target.closest && event.target.closest('[data-rb-rich]');
      if (field && formatToolbar) formatToolbar.noteField(field);
    });

    // Typing and pasting change how much text there is, so the chain has to
    // be re-flowed -- but not on every keystroke, which would fight the
    // caret. It runs once typing pauses, and only re-renders if the split
    // actually changed. Without this, text typed or pasted past the bottom of
    // the page simply ran off into columns nobody could see, and text deleted
    // from a full page never pulled the continuation back.
    var reflowTimer = null;

    function scheduleDiscussionReflow(field) {
      if (!field || !field.closest('.rb-discussion')) return;
      if (reflowTimer) window.clearTimeout(reflowTimer);
      reflowTimer = window.setTimeout(function () {
        reflowTimer = null;
        var live = sheetEl.querySelector('[data-rb-rich="' + (field.getAttribute('data-rb-rich') || '') + '"]');
        var keep = captureSelectionOffsets(live || field);
        var changed = reflowDiscussion();
        if (changed) renderPages();
        restoreSelectionOffsets(sheetEl, keep);
        if (changed) flushSave().catch(function () {});
      }, 700);
    }

    sheetEl.addEventListener('input', function (event) {
      var richTarget = event.target.closest(
        '[data-rb-cover-field], [data-rb-section-field], [data-rb-ov-field]');
      if (richTarget) {
        if (!commitRichField(richTarget)) return;
        scheduleDiscussionReflow(richTarget);
        return;
      }
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

    function applyLayoutToFloorPages(layout) {
      var flApi = window.ToolboxReportFloorLayout;
      var next = flApi ? flApi.normalizeLayout(layout) : layout;
      floorLayout = next;
      pages.forEach(function (page) {
        if (!page || page.type !== 'floor' || (page.meta && page.meta.reserved)) return;
        page.meta = page.meta || {};
        page.meta.layout = flApi ? flApi.cloneLayout(next) : next;
      });
    }

    function importActiveFloorPage() {
      var current = activePage();
      if (!current || current.type !== 'floor' || (current.meta && current.meta.reserved)) return;
      if (!workingRecord) return;
      current.meta = current.meta || {};
      if (!current.meta.layout) {
        current.meta.layout = window.ToolboxReportFloorLayout
          ? window.ToolboxReportFloorLayout.cloneLayout(floorLayout)
          : floorLayout;
      }
      if (floorLayout && floorLayout.locked) {
        current.meta.layout = window.ToolboxReportFloorLayout
          ? window.ToolboxReportFloorLayout.cloneLayout(floorLayout)
          : floorLayout;
      }
      current.meta.imported = true;
      setSaveStatus('Importing…');
      attachEvidence(workingRecord, [current]).then(function (enriched) {
        if (token !== mountGeneration) return;
        var next = enriched && enriched[0];
        if (!next || !next.evidence || !next.evidence.figure || !next.evidence.figure.dataUrl) {
          current.meta.imported = false;
          setSaveStatus('Import failed — no topo figure');
          renderPages();
          return;
        }
        var index = activeIndex();
        pages[index] = next;
        markDirty();
        renderPages();
        fitSheet(root);
      }).catch(function (err) {
        current.meta.imported = false;
        console.warn('Floor Survey import failed', err);
        setSaveStatus('Import failed');
        renderPages();
      });
    }

    function refreshCoverOverviewUrl() {
      var mediaId = coverLayout && coverLayout.overviewMediaId;
      if (!mediaId || !window.ToolboxDB || typeof window.ToolboxDB.getMedia !== 'function') {
        coverOverviewUrl = '';
        return Promise.resolve('');
      }
      return window.ToolboxDB.getMedia(mediaId).then(function (url) {
        coverOverviewUrl = url || '';
        return coverOverviewUrl;
      }).catch(function () {
        coverOverviewUrl = '';
        return '';
      });
    }

    function setCoverOverview(dataUrl) {
      if (!dataUrl || dataUrl.indexOf('data:image/') !== 0) return;
      if (!window.ToolboxDB || typeof window.ToolboxDB.putMedia !== 'function') return;
      var mediaId = 'report-cover-overview-' + customerFileId;
      window.ToolboxDB.putMedia(mediaId, dataUrl).then(function () {
        var coverApi = window.ToolboxReportCoverLayout;
        coverLayout = coverApi ? coverApi.normalizeLayout(coverLayout) : coverLayout;
        coverLayout.overviewMediaId = mediaId;
        coverOverviewUrl = dataUrl;
        markDirty();
        renderPages();
        flushSave().catch(function () {});
      }).catch(function (err) {
        console.warn('Cover overview save failed', err);
        setSaveStatus('Overview save failed');
      });
    }

    function readImageFile(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        setCoverOverview(typeof reader.result === 'string' ? reader.result : '');
      };
      reader.readAsDataURL(file);
    }

    // Reads the image the investigator just captured straight off the system
    // clipboard. Needs a user gesture, which the button provides.
    function pasteCoverOverview() {
      if (!navigator.clipboard || typeof navigator.clipboard.read !== 'function') {
        setSaveStatus('Paste is unavailable here — use Add overview');
        return;
      }
      setSaveStatus('Reading clipboard…');
      navigator.clipboard.read().then(function (items) {
        for (var i = 0; i < items.length; i += 1) {
          var types = items[i].types || [];
          for (var j = 0; j < types.length; j += 1) {
            if (types[j].indexOf('image/') === 0) {
              return items[i].getType(types[j]).then(function (blob) {
                readImageFile(blob);
              });
            }
          }
        }
        setSaveStatus('No image on the clipboard');
        return null;
      }).catch(function (err) {
        console.warn('Clipboard read refused', err);
        setSaveStatus('Clipboard blocked — use Add overview');
      });
    }

    function pickCoverOverview() {
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.addEventListener('change', function () {
        readImageFile(input.files && input.files[0]);
      });
      input.click();
    }

    // The site overview comes from opening the property in Google Maps and
    // screenshotting it, so the image arrives on the clipboard, not as a file
    // on disk. Pasting anywhere on the cover drops it in; requiring a save-
    // then-browse round trip for every job is exactly the kind of busywork
    // this product exists to remove.
    function clipboardImage(event) {
      var data = event.clipboardData;
      if (!data) return null;
      var items = data.items || [];
      for (var i = 0; i < items.length; i += 1) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type || '')) {
          var file = items[i].getAsFile();
          if (file) return file;
        }
      }
      var files = data.files || [];
      for (var j = 0; j < files.length; j += 1) {
        if (/^image\//.test(files[j].type || '')) return files[j];
      }
      return null;
    }

    function onCoverImagePaste(event) {
      var current = activePage();
      if (!current) return;
      var file = clipboardImage(event);
      if (!file) return;
      event.preventDefault();
      if (current.type === 'cover') {
        setSaveStatus('Adding overview…');
        readImageFile(file);
        return;
      }
      // Anywhere else a pasted picture becomes a placed annotation, so the
      // site overview -- or anything else on the clipboard -- can go on a
      // Floor Survey sheet or any other page.
      var api = window.ToolboxReportOverlay;
      if (!api) return;
      var list = overlayList(current);
      if (!list) return;
      var item = api.create('image');
      item.color = overlayColor;
      list.push(item);
      setSaveStatus('Adding picture…');
      var reader = new FileReader();
      reader.onload = function () {
        storeOverlayImage(item, typeof reader.result === 'string' ? reader.result : '');
      };
      reader.readAsDataURL(file);
    }

    document.addEventListener('paste', onCoverImagePaste);
    coverPasteHandler = onCoverImagePaste;

    sheetEl.addEventListener('click', function (event) {
      if (event.target.closest('[data-rb-floor-import]')) {
        event.preventDefault();
        importActiveFloorPage();
        return;
      }
      var coverLock = event.target.closest('[data-rb-cover-lock]');
      if (coverLock) {
        event.preventDefault();
        var coverApi = window.ToolboxReportCoverLayout;
        coverLayout = coverApi ? coverApi.normalizeLayout(coverLayout) : coverLayout;
        var coverMode = coverLock.getAttribute('data-rb-cover-lock');
        coverLayout.locked = coverMode === 'lock';
        dirty = true;
        setSaveStatus('Saving…');
        renderPages();
        flushSave().catch(function () {});
        return;
      }
      var overviewAct = event.target.closest('[data-rb-cover-overview]');
      if (overviewAct) {
        event.preventDefault();
        var act = overviewAct.getAttribute('data-rb-cover-overview');
        if (act === 'pick') {
          pickCoverOverview();
          return;
        }
        if (act === 'paste') {
          pasteCoverOverview();
          return;
        }
        if (act === 'clear') {
          var cApi = window.ToolboxReportCoverLayout;
          coverLayout = cApi ? cApi.normalizeLayout(coverLayout) : coverLayout;
          coverLayout.overviewMediaId = '';
          coverOverviewUrl = '';
          markDirty();
          renderPages();
          flushSave().catch(function () {});
        }
        return;
      }
      var lockBtn = event.target.closest('[data-rb-floor-lock]');
      if (!lockBtn) return;
      event.preventDefault();
      var current = activePage();
      if (!current || current.type !== 'floor') return;
      var mode = lockBtn.getAttribute('data-rb-floor-lock');
      var flApi = window.ToolboxReportFloorLayout;
      var layout = (current.meta && current.meta.layout) || floorLayout;
      layout = flApi ? flApi.normalizeLayout(layout) : layout;
      if (mode === 'lock') {
        layout.locked = true;
        applyLayoutToFloorPages(layout);
      } else {
        layout.locked = false;
        floorLayout = flApi ? flApi.normalizeLayout(layout) : layout;
        current.meta = current.meta || {};
        current.meta.layout = flApi ? flApi.cloneLayout(floorLayout) : floorLayout;
      }
      dirty = true;
      setSaveStatus('Saving…');
      renderPages();
      flushSave().catch(function () {});
    });

    function stageRect(selector) {
      var stage = sheetEl.querySelector(selector || '[data-rb-floor-stage]');
      return stage ? stage.getBoundingClientRect() : null;
    }

    sheetEl.addEventListener('pointerdown', function (event) {
      if (event.target.closest('a, button, input, textarea, label, select')) return;
      // Clicking into report text places a caret; it does not start a move.
      // These fields used to be <input>, which the guard above covered. As
      // contenteditable regions they are not, and the preventDefault below
      // was swallowing every selection on the sheet. Boxes move from the
      // handle or from any part of the box that is not text.
      var editableTarget = event.target.closest('[data-rb-rich]');
      if (editableTarget && editableTarget.getAttribute('contenteditable') === 'true') return;
      var current = activePage();
      if (current && current.type === 'cover') {
        if (coverLayout && coverLayout.locked) return;
        var coverResize = event.target.closest('[data-rb-cover-resize]');
        var coverBox = event.target.closest('[data-rb-cover-box]');
        if (!coverBox) return;
        var coverStage = stageRect('[data-rb-cover-stage] .rb-cover__stage') || stageRect('[data-rb-cover-stage]');
        if (!coverStage || coverStage.width < 8 || coverStage.height < 8) return;
        event.preventDefault();
        var coverId = coverBox.getAttribute('data-rb-cover-box');
        var coverApi = window.ToolboxReportCoverLayout;
        var cLayout = coverApi ? coverApi.normalizeLayout(coverLayout) : coverLayout;
        coverDrag = {
          id: coverId,
          resize: !!coverResize,
          startX: event.clientX,
          startY: event.clientY,
          stageW: coverStage.width,
          stageH: coverStage.height,
          layout: cLayout,
        };
        try { coverBox.setPointerCapture(event.pointerId); } catch (_) {}
        return;
      }
      if (!current || current.type !== 'floor') return;
      if (current.meta && current.meta.layout && current.meta.layout.locked) return;
      if (floorLayout && floorLayout.locked) return;
      var resize = event.target.closest('[data-rb-floor-resize]');
      var box = event.target.closest('[data-rb-floor-box]');
      if (!box) return;
      // Inside the drawing the gestures are Floor Survey's: drag pans the plan,
      // the wheel zooms it, and it can be moved anywhere including off the
      // edge. Report Builder must not claim those -- the slide is meant to
      // behave exactly as the workspace it came from. The frame is moved and
      // sized from its handles, which sit on its edge, outside the drawing.
      if (!resize && event.target.closest('[data-rb-topo-live]')) return;
      var stage = stageRect('[data-rb-floor-stage]');
      if (!stage || stage.width < 8 || stage.height < 8) return;
      event.preventDefault();
      var id = box.getAttribute('data-rb-floor-box');
      var kind = box.getAttribute('data-rb-floor-kind') || 'topo';
      var layout = window.ToolboxReportFloorLayout
        ? window.ToolboxReportFloorLayout.normalizeLayout((current.meta && current.meta.layout) || floorLayout)
        : (current.meta && current.meta.layout) || floorLayout;
      floorDrag = {
        id: id,
        kind: kind,
        resize: !!resize,
        corner: resize ? (resize.getAttribute('data-rb-floor-corner') || 'se') : null,
        startX: event.clientX,
        startY: event.clientY,
        stageW: stage.width,
        stageH: stage.height,
        layout: layout,
      };
      try { box.setPointerCapture(event.pointerId); } catch (_) {}
    });

    sheetEl.addEventListener('pointermove', function (event) {
      if (coverDrag) {
        var coverPage = activePage();
        if (!coverPage || coverPage.type !== 'cover') return;
        var cdx = ((event.clientX - coverDrag.startX) / coverDrag.stageW) * 100;
        var cdy = ((event.clientY - coverDrag.startY) / coverDrag.stageH) * 100;
        var coverApi = window.ToolboxReportCoverLayout;
        var nextCover = coverApi
          ? coverApi.cloneLayout(coverDrag.layout)
          : JSON.parse(JSON.stringify(coverDrag.layout));
        var boxGeom = nextCover.boxes[coverDrag.id];
        var origin = coverDrag.layout.boxes[coverDrag.id];
        if (!boxGeom || !origin) return;
        if (coverDrag.resize) {
          boxGeom.w = origin.w + cdx;
          boxGeom.h = origin.h + cdy;
        } else {
          boxGeom.x = origin.x + cdx;
          boxGeom.y = origin.y + cdy;
        }
        nextCover = coverApi ? coverApi.normalizeLayout(nextCover) : nextCover;
        coverLayout = nextCover;
        var live = sheetEl.querySelector('[data-rb-cover-box="' + coverDrag.id + '"]');
        if (live && coverApi) live.style.cssText = coverApi.boxStyle(nextCover.boxes[coverDrag.id]);
        return;
      }
      if (!floorDrag) return;
      var current = activePage();
      if (!current || current.type !== 'floor') return;
      var dx = ((event.clientX - floorDrag.startX) / floorDrag.stageW) * 100;
      var dy = ((event.clientY - floorDrag.startY) / floorDrag.stageH) * 100;
      var layout = window.ToolboxReportFloorLayout
        ? window.ToolboxReportFloorLayout.cloneLayout(floorDrag.layout)
        : JSON.parse(JSON.stringify(floorDrag.layout));
      var flApi = window.ToolboxReportFloorLayout;
      if (floorDrag.id === 'topo') {
        if (floorDrag.resize) {
          // The held corner moves and the opposite one stays put, which is what
          // a corner handle means. Resizing only ever from the bottom right
          // meant the other three corners drifted every time.
          var minW = flApi ? flApi.MIN_TOPO_W : 35;
          var minH = flApi ? flApi.MIN_TOPO_H : 35;
          var o = floorDrag.layout.topo;
          var west = floorDrag.corner === 'nw' || floorDrag.corner === 'sw';
          var north = floorDrag.corner === 'nw' || floorDrag.corner === 'ne';
          var nextW = Math.max(minW, west ? o.w - dx : o.w + dx);
          var nextH = Math.max(minH, north ? o.h - dy : o.h + dy);
          layout.topo.w = nextW;
          layout.topo.h = nextH;
          layout.topo.x = west ? o.x + (o.w - nextW) : o.x;
          layout.topo.y = north ? o.y + (o.h - nextH) : o.y;
        } else {
          layout.topo.x = floorDrag.layout.topo.x + dx;
          layout.topo.y = floorDrag.layout.topo.y + dy;
        }
      } else {
        var overlay = null;
        for (var i = 0; i < layout.overlays.length; i += 1) {
          if (layout.overlays[i].id === floorDrag.id) overlay = layout.overlays[i];
        }
        if (!overlay) return;
        if (floorDrag.resize) {
          var base = 0;
          for (var j = 0; j < floorDrag.layout.overlays.length; j += 1) {
            if (floorDrag.layout.overlays[j].id === floorDrag.id) base = floorDrag.layout.overlays[j].scale;
          }
          overlay.scale = Math.max(flApi ? flApi.MIN_SCALE : 0.65, Math.min(flApi ? flApi.MAX_SCALE : 1.85, base + dx / 40));
        } else {
          var origin = null;
          for (var k = 0; k < floorDrag.layout.overlays.length; k += 1) {
            if (floorDrag.layout.overlays[k].id === floorDrag.id) origin = floorDrag.layout.overlays[k];
          }
          overlay.x = (origin ? origin.x : 0) + dx;
          overlay.y = (origin ? origin.y : 0) + dy;
        }
      }
      layout = flApi ? flApi.normalizeLayout(layout) : layout;
      current.meta = current.meta || {};
      current.meta.layout = layout;
      if (!floorLayout.locked) floorLayout = flApi ? flApi.cloneLayout(layout) : layout;
      var box = sheetEl.querySelector('[data-rb-floor-box="' + floorDrag.id + '"]');
      if (!box) return;
      if (floorDrag.id === 'topo') {
        box.style.left = layout.topo.x + '%';
        box.style.top = layout.topo.y + '%';
        box.style.width = layout.topo.w + '%';
        box.style.height = layout.topo.h + '%';
      } else {
        for (var n = 0; n < layout.overlays.length; n += 1) {
          if (layout.overlays[n].id === floorDrag.id) {
            box.style.left = layout.overlays[n].x + '%';
            box.style.top = layout.overlays[n].y + '%';
            box.style.transform = 'scale(' + layout.overlays[n].scale + ')';
          }
        }
      }
    });

    function endLayoutDrag() {
      if (coverDrag) {
        coverDrag = null;
        markDirty();
        return;
      }
      if (!floorDrag) return;
      floorDrag = null;
      markDirty();
    }
    sheetEl.addEventListener('pointerup', endLayoutDrag);
    sheetEl.addEventListener('pointercancel', endLayoutDrag);

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
      renumberFigures(pages);
      markDirty();
      renderPages();
    });

    laterBtn.addEventListener('click', function () {
      var index = activeIndex();
      if (index >= pages.length - 1) return;
      var moved = pages[index];
      pages[index] = pages[index + 1];
      pages[index + 1] = moved;
      renumberFigures(pages);
      markDirty();
      renderPages();
    });

    // Print the whole book, not just the open sheet. Every page already
    // carries its evidence (attachEvidence runs over all pages on load), so
    // each one is rendered into its own 11 x 17 sheet and handed to the
    // browser's print dialog -- which is also how a PDF comes out of it.
    // The deliverable is the PDF; there is no separate export path to keep
    // in step with what the investigator sees on screen.
    function buildPrintDeck() {
      var deck = document.createElement('div');
      deck.className = 'rb-print';
      deck.setAttribute('aria-hidden', 'true');
      pages.forEach(function (page) {
        var sheet = document.createElement('article');
        sheet.className = 'rb-sheet rb-sheet--print';
        deck.appendChild(sheet);
        // Only the on-screen render loop stamped this, so the printed deck
        // fell back to the default placement -- the PDF showed the logo in the
        // bottom-left corner no matter where it had been put and locked.
        page._brandBox = currentBrandBox(page);
        try {
          renderSheet(sheet, page, pages);
        } catch (err) {
          console.warn('Page could not be prepared for print', page && page.id, err);
        }
      });
      return deck;
    }

    /**
     * Lay the plan out again on every printed Picture Locations page.
     *
     * buildPrintDeck renders its sheets while the deck is still DETACHED, so
     * layoutPlans() sees clientWidth 0, sizes the plan rect to 0 x 0 and drops
     * --rb-pin-size, leaving the pins at the CSS fallback -- a size relative to
     * the page rather than to the plan. Anything positioned in percent of that
     * rect, which is every pin and every offset, is computed against nothing.
     *
     * The on-screen path already does this (renderPages re-runs the pen log's
     * layout in a rAF after rendering); the print path never did. It happened
     * to come right only because each printed sheet builds a fresh <img> whose
     * load handler re-runs the layout once the deck is attached -- a race, and
     * one that never resolves at all when the plan has no image.
     */
    function relayoutPrintedPlans(deck) {
      if (!deck || !window.ToolboxPenLog || typeof window.ToolboxPenLog.layoutPlans !== 'function') return;
      var roots = deck.querySelectorAll('.rb-penlog');
      for (var i = 0; i < roots.length; i += 1) {
        try { window.ToolboxPenLog.layoutPlans(roots[i]); } catch (err) { /* page is still printable */ }
      }
    }

    var printDeck = null;

    function clearPrintDeck() {
      if (printDeck && printDeck.parentNode) printDeck.parentNode.removeChild(printDeck);
      printDeck = null;
      document.body.classList.remove('is-printing');
      renderPages();
    }

    var printBtn = root.querySelector('#rb-print');
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        flushSave().catch(function () {}).then(function () {
          clearPrintDeck();
          printDeck = buildPrintDeck();
          document.body.appendChild(printDeck);
          document.body.classList.add('is-printing');
          relayoutPrintedPlans(printDeck);
          window.addEventListener('afterprint', clearPrintDeck, { once: true });
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () { window.print(); });
          });
        });
      });
    }

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

    setSaveStatus('Loading…');
    renderPages();
    watchSheet(root);

    if (window.ToolboxReportToolbar) {
      formatToolbar = window.ToolboxReportToolbar.mount(root, {
        onInsert: insertOverlay,
        onColor: function (value) { overlayColor = value; },
        onTool: setInkTool,
        onThick: function (level) { inkThick = level; },
        onHistory: function (which) { if (which === 'redo') redo(); else undo(); },
        onChange: function (field) {
          var keep = captureSelectionOffsets(field);
          commitRichField(field);
          // Changing spacing, size or typeface changes how much fits, so the
          // flow is re-run right where the room changed.
          if (reflowDiscussion()) {
            renderPages();
            flushSave().catch(function () {});
          }
          // Put the selection back so the next command acts on the same words.
          if (restoreSelectionOffsets(sheetEl, keep) && formatToolbar) {
            formatToolbar.refresh();
          }
        },
      });
    }
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
      var savedDoc = record && (record.reportBuilder || record.report);
      if (savedDoc && savedDoc.floorLayout && window.ToolboxReportFloorLayout) {
        floorLayout = window.ToolboxReportFloorLayout.normalizeLayout(savedDoc.floorLayout);
      }
      if (savedDoc && savedDoc.coverLayout && window.ToolboxReportCoverLayout) {
        coverLayout = window.ToolboxReportCoverLayout.normalizeLayout(savedDoc.coverLayout);
      }
      if (savedDoc && savedDoc.brandBox && window.ToolboxReportDiscussion) {
        brandBox = window.ToolboxReportDiscussion.normalizeBrandBox(savedDoc.brandBox);
      }
      if (savedDoc && savedDoc.floorCamera) floorCamera = savedDoc.floorCamera;
      if (savedDoc && savedDoc.floorView) floorView = reviveFloorView(savedDoc.floorView);
      if (savedDoc && Array.isArray(savedDoc.pages)) {
        savedDoc.pages.forEach(function (page) {
          if (page && page.meta && page.meta.floorView) {
            page.meta.floorView = reviveFloorView(page.meta.floorView);
          }
        });
      }
      if (savedDoc && savedDoc.floorFramed) floorFramed = true;
      var saved = savedReportPages(record);
      if (saved) {
        var before = saved.pages.map(function (page) {
          return page.id + ':' + ((page.meta && page.meta.photoKeys) || []).join(',') +
            ':' + !!(page.meta && page.meta.imported);
        }).join('|');
        pages = reconcileReportPages(saved.pages, freshPages, photoList);
        var after = pages.map(function (page) {
          return page.id + ':' + ((page.meta && page.meta.photoKeys) || []).join(',') +
            ':' + !!(page.meta && page.meta.imported);
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
      return refreshCoverOverviewUrl().then(function () {
        renderPages();
        fitSheet(root);
        if (loaded.assembledFresh || loaded.reconciled) {
          markDirty();
          flushSave().catch(function () {});
        } else {
          setSaveStatus(formatSavedAt(lastSavedAt));
          if (draftEl) draftEl.textContent = 'Saved';
        }
        return attachEvidence(workingRecord, pages.slice());
      }).then(function (enriched) {
        if (token !== mountGeneration) return;
        pages = enriched;
        adoptLegacyBrandBox();
        renderPages();
        fitSheet(root);
        // A book split under different spacing heals on open: if the text now
        // fits in fewer sheets it pulls back into them.
        hydrateOverlayImages();
        if (repairBlankRuns()) {
          renderPages();
          markDirty();
          flushSave().catch(function () {});
        }
        snapshotNow();
        window.requestAnimationFrame(function () {
          if (token !== mountGeneration) return;
          if (reflowDiscussion()) {
            renderPages();
            fitSheet(root);
            flushSave().catch(function () {});
          }
        });
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
      '    <div class="rb-toolbar__format" data-rb-format-host></div>' +
      '    <button type="button" id="rb-print" class="btn btn--secondary rb-print-btn">Print / PDF</button>' +
      '    <button type="button" id="rb-export-ai" class="btn btn--accent rb-export">Export for AI</button>' +
      '    <p class="rb-ai-status" id="rb-ai-status" aria-live="polite"></p>' +
      '  </div>' +
      '  <div class="rb-workspace">' +
      '    <aside class="rb-ws" aria-label="Report pages">' +
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
      // The rail is the workspace for whatever slide is open: Import at the
      // top, that workspace's own controls in the middle, and the way back to
      // the full application at the bottom. It is not a permanent list of
      // links, and it shows nothing on a slide that owns no source.
      '      <p class="eyebrow">Toolbox</p>' +
      '      <div id="rb-rail" class="rb-ws" data-rb-rail hidden>' +
      '        <h2 class="rb-ws__title" data-rb-rail-title>Floor Survey</h2>' +
      '        <div class="rb-ws__top" data-rb-rail-top></div>' +
      '        <div class="rb-ws__body" data-rb-rail-body></div>' +
      '        <div class="rb-ws__foot" data-rb-rail-foot></div>' +
      '      </div>' +
      '      <div id="rb-rail-idle" class="rb-panel__idle" data-rb-rail-idle>' +
      '        <h2>Report sheets</h2>' +
      '        <p class="rb-panel__lead">Open a Floor Survey, Distress or Pictures slide and its workspace appears here.</p>' +
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

  function unmount() {
    mountGeneration += 1;
    if (formatToolbar) {
      formatToolbar.destroy();
      formatToolbar = null;
    }
    if (coverPasteHandler) {
      document.removeEventListener('paste', coverPasteHandler);
      coverPasteHandler = null;
    }
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

  /**
   * Distress Put on report: pack photographs into Pictures slides on reportBuilder.
   * Does not write captions back to Distress. Returns { pageCount, photoCount, activePageId }.
   */
  function stagePicturesFromDistress(record) {
    if (!record || typeof record !== 'object') {
      return Promise.reject(new Error('Customer File is required.'));
    }
    var photoList = window.ToolboxReportEvidence &&
      typeof window.ToolboxReportEvidence.listDistressPhotos === 'function'
      ? window.ToolboxReportEvidence.listDistressPhotos(record)
      : [];
    if (!photoList.length) {
      return Promise.reject(new Error('No Distress photographs to put on the report.'));
    }
    var api = sourceApi();
    var source = api ? api.read(record) : null;
    var fresh = api ? withProperty(api.assemble(source), source) : { pages: [] };
    var saved = savedReportPages(record);
    var pages = saved
      ? reconcileReportPages(saved.pages, ensurePicturesInFreshPages(fresh.pages.slice(), photoList), photoList)
      : ensurePicturesInFreshPages(fresh.pages.slice(), photoList);
    var firstPictures = null;
    for (var i = 0; i < pages.length; i += 1) {
      if (pages[i].type === 'pictures') {
        firstPictures = pages[i];
        break;
      }
    }
    var activePageId = firstPictures ? firstPictures.id : (pages[0] && pages[0].id) || '';
    var prior = record.reportBuilder || record.report || null;
    var doc = persistableDocument(
      pages,
      activePageId,
      prior,
      prior && prior.floorLayout,
      prior && prior.coverLayout
    );
    record.reportBuilder = doc;
    record.updatedAt = doc.updatedAt;
    delete record.report;
    if (!window.ToolboxDB || typeof window.ToolboxDB.saveCustomerFile !== 'function') {
      return Promise.reject(new Error('Customer File save is not available.'));
    }
    return window.ToolboxDB.saveCustomerFile(record).then(function () {
      return {
        pageCount: pages.filter(function (p) { return p.type === 'pictures'; }).length,
        photoCount: photoList.length,
        activePageId: activePageId,
      };
    });
  }

  window.ToolboxReportBuilder = {
    mount: mount,
    unmount: unmount,
    stagePicturesFromDistress: stagePicturesFromDistress,
  };
})();
