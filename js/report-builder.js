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
  // 11x17 landscape at 96 CSS pixels to the inch. The sheet is drawn at this
  // size everywhere; every view only zooms it.
  var PAPER_W = 1632;
  var PAPER_H = 1056;
  var AUTOSAVE_DELAY_MS = 900;
  var PHOTOS_PER_PAGE = 10;
  var REPORT_SCHEMA = 'toolbox.report-builder';
  var REPORT_SCHEMA_VERSION = 1;
  var mountGeneration = 0;
  var penLogUi = {
    selectedPinId: '',
    noteMap: {},
    onNote: null,
    onSelect: null,
    layout: null,
  };
  var fitObserver = null;
  var formatToolbar = null;
  /**
   * Listeners this mount put on the document, so leaving can take them off.
   *
   * Report Builder added five of these on every visit and removed none. A
   * listener is a live reference to everything its function can see, which
   * here is the whole session: the pages, the rendered thumbnails, and every
   * photograph loaded into them. So each visit left a complete previous visit
   * behind, and the browser could not collect any of it -- about a megabyte
   * per lap on a job with twelve photographs, more on a real one. Tim,
   * switching between the applications: "I was getting a not enough memory
   * reload."
   */
  var mountListeners = [];
  /** A mount's own teardown, which module-level unmount cannot reach inside to do. */
  var mountCleanup = null;

  function onDocument(type, handler, options) {
    document.addEventListener(type, handler, options);
    mountListeners.push({ on: document, type: type, handler: handler, options: options });
  }

  /** The same, for something announced on the window rather than the page. */
  function onWindow(type, handler, options) {
    window.addEventListener(type, handler, options);
    mountListeners.push({ on: window, type: type, handler: handler, options: options });
  }

  function releaseMountListeners() {
    mountListeners.splice(0).forEach(function (item) {
      var target = item.on || document;
      try { target.removeEventListener(item.type, item.handler, item.options); } catch (_) {}
    });
  }
  // Object URLs for pictures placed on sheets, keyed by media id.
  var overlayUrlCache = {};
  var coverPasteHandler = null;
  var fitOnResize = null;
  var pageSeq = 1;

  /**
   * Zoom the paper to the stage.
   *
   * The sheet is always PAPER_W x PAPER_H -- 11x17 landscape -- and this only
   * scales it to whatever room the stage has. It used to resize the sheet
   * instead, which meant the page was a different number of pixels on every
   * window, and anything on it styled in pixels took up a different share of
   * the paper on every screen. That is what stopped the PDF ever agreeing
   * with the editor.
   */
  /**
   * How big the page is drawn on the stage.
   *
   * 0 means fit -- the whole sheet in the window, which is what it has
   * always done. Anything else is a scale the investigator chose, and the
   * stage scrolls to it.
   *
   * Tim, Oct 23, 2026: "if we can just kind of change the size of the font
   * for report builder discussion page... I don't say font, zoom in, zoom
   * out, so we can read it easier." The type on the page is not touched --
   * that would change the printed report. Only the magnification is.
   */
  var sheetZoom = 0;
  var ZOOM_STEPS = [0.5, 0.67, 0.75, 1, 1.25, 1.5, 2];
  var lastFitScale = 0;

  function fitSheet(root) {
    var stage = root && root.querySelector('.rb-stage');
    var sheet = root && root.querySelector('.rb-sheet');
    if (!stage || !sheet) return;
    var paper = sheet.parentNode && sheet.parentNode.classList
      && sheet.parentNode.classList.contains('rb-stage__paper') ? sheet.parentNode : null;
    var styles = window.getComputedStyle(stage);
    var padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    var padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    var availW = Math.max(0, stage.clientWidth - padX);
    var availH = Math.max(0, stage.clientHeight - padY);
    if (availW < 40 || availH < 40) return;
    var fit = Math.min(availW / PAPER_W, availH / PAPER_H);
    if (!(fit > 0)) return;
    lastFitScale = fit;
    var scale = sheetZoom > 0 ? sheetZoom : fit;
    sheet.style.width = '';
    sheet.style.height = '';
    sheet.style.transform = 'scale(' + scale + ')';
    if (paper) {
      paper.style.width = Math.floor(PAPER_W * scale) + 'px';
      paper.style.height = Math.floor(PAPER_H * scale) + 'px';
    }
    stage.classList.toggle('rb-stage--zoomed', sheetZoom > 0 && sheetZoom > fit);
    paintZoomLevel(root);
    fitCoverContents(root);
  }

  // The readout says what the page is drawn at, and "Fit" when the window
  // is choosing. A percentage with no word for the default would make the
  // way back to it something to work out rather than something to read.
  function paintZoomLevel(root) {
    var out = root && root.querySelector('#rb-zoom-level');
    if (!out) return;
    var pct = Math.round((sheetZoom > 0 ? sheetZoom : lastFitScale) * 100);
    out.textContent = sheetZoom > 0 ? pct + '%' : 'Fit';
    out.setAttribute('title', sheetZoom > 0
      ? 'Drawn at ' + pct + '% — click to fit the page to the window'
      : 'Fit: the whole page in the window (' + pct + '%)');
  }

  function stepZoom(root, dir) {
    var from = sheetZoom > 0 ? sheetZoom : lastFitScale;
    var next = null;
    if (dir > 0) {
      for (var i = 0; i < ZOOM_STEPS.length; i += 1) {
        if (ZOOM_STEPS[i] > from + 0.001) { next = ZOOM_STEPS[i]; break; }
      }
    } else {
      for (var j = ZOOM_STEPS.length - 1; j >= 0; j -= 1) {
        if (ZOOM_STEPS[j] < from - 0.001) { next = ZOOM_STEPS[j]; break; }
      }
    }
    if (next === null) return;
    sheetZoom = next;
    fitSheet(root);
  }

  function resetZoom(root) {
    sheetZoom = 0;
    fitSheet(root);
  }

  /**
   * Keep a grown contents box on the paper.
   *
   * The box is as tall as its figures now, which is right until there are
   * more figures than the sheet has room for. Rather than clip the list --
   * which is what it used to do, silently -- the type steps down until it
   * fits. A floor of 0.6 keeps it readable; at that size the frame holds
   * around fifty lines, which is past any real report.
   *
   * Measured rather than counted, because what fits depends on the sheet's
   * size on screen, the font the device has, and how long the titles are.
   */
  var CONTENTS_FIT_FLOOR = 0.6;

  function fitCoverContents(scope) {
    var root = scope || document;
    var boxes = root.querySelectorAll
      ? root.querySelectorAll('[data-rb-cover-box="contents"]')
      : [];
    for (var i = 0; i < boxes.length; i += 1) {
      var box = boxes[i];
      var sheet = box.closest ? box.closest('.rb-sheet') : null;
      if (!sheet) continue;
      box.style.setProperty('--rb-contents-fit', '1');
      var boxRect = box.getBoundingClientRect();
      var sheetRect = sheet.getBoundingClientRect();
      // ONE COORDINATE SYSTEM: the sheet's own pixels.
      //
      // A rect is in SCREEN pixels, so it carries whatever the stage is
      // drawn at. scrollHeight is in the element's OWN pixels and carries
      // nothing. Comparing the two meant the room left on the page was
      // wrong by exactly the display scale -- the same arithmetic reported
      // 1.130 at Fit and 1.837 at 100% for one unchanged box -- so a list
      // shrank on screen and did not shrink in print. The comment that used
      // to stand here claimed both came off the rects; scrollHeight never
      // did. Audit finding 6.
      //
      // Everything below is divided back into the sheet's own pixels, where
      // scrollHeight already lives, so the answer cannot depend on how big
      // the page happens to be drawn.
      var sheetOwnH = sheet.clientHeight;
      if (!(sheetOwnH > 40) || !(sheetRect.height > 40)) continue;
      var displayScale = sheetRect.height / sheetOwnH;
      if (!(displayScale > 0)) continue;
      var top = (boxRect.top - sheetRect.top) / displayScale;
      // The same breathing room the deck leaves under the frame.
      var room = sheetOwnH * 0.96 - top;
      var needs = box.scrollHeight;
      if (!(needs > 0) || !(room > 0) || needs <= room) continue;
      var fit = Math.max(CONTENTS_FIT_FLOOR, room / needs);
      box.style.setProperty('--rb-contents-fit', fit.toFixed(3));
    }
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

  /**
   * The drawing stage's share of the sheet's WIDTH, measured.
   *
   * An imported floor slide draws full bleed across the sheet except for the
   * title rail down its side; the rail's width is the stylesheet's business.
   * Measured at 86.336% on a rendered slide. Used only when there is no slide
   * on screen to measure -- composing from the cover or the discussion.
   */
  var STAGE_SHARE_OF_SHEET = 0.86336;

  /**
   * The DRAFT watermark, across the sheet.
   *
   * Hung off renderSheetFrame because that is the one call every page type
   * already makes -- cover, discussion, figure, pen log, pictures -- so no
   * sheet can be forgotten and none needs its own code.
   *
   * It is deliberately NOT editor chrome: a draft stamp that does not print
   * is worse than none at all. It is marked aria-hidden and takes no pointer
   * events, so it is neither read out nor in the way of the work.
   */
  function renderDraftStamp(sheet, on) {
    if (!on) return;
    var stamp = document.createElement('div');
    stamp.className = 'rb-sheet__draft';
    stamp.setAttribute('data-rb-draft', '1');
    stamp.setAttribute('aria-hidden', 'true');
    stamp.textContent = 'DRAFT';
    sheet.appendChild(stamp);
  }

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
    // A railed page carries the mark in its rail, at the foot, so there is
    // nothing to float in the corner -- and nothing to drag or lock either.
    if (pageTakesRail(page)) return false;
    return page.type !== 'cover';
  }

  /**
   * Does this sheet carry the figure rail?
   *
   * Every figure page does. Tim: "Everything gets the rail -- that's the
   * whole point of that rail, isn't it?" The exceptions are the two pages
   * that are not figures: the cover, which is its own design and carries its
   * own mark, and Discussion, which he excluded from the start ("this is
   * your template... on every figure page except Discussion").
   *
   * This is the same set the book numbers as figures, so the rail appears
   * exactly where a figure number does, and a new page type gets the rail
   * without anyone remembering to add it to a list.
   */
  // renderSheet is shared by the real sheet and the rail's thumbnails and
  // lives outside the editing closure, so the two facts it needs about a
  // floor page -- how many views it carries and which one is being driven --
  // are read through these rather than captured.
  function floorSlotsForPage(page) {
    var api = window.ToolboxReportFloorViews;
    if (api && typeof api.viewCount === 'function') return Math.max(1, api.viewCount(page));
    return page && page.meta && page.meta.floorTwoUp ? 2 : 1;
  }

  function floorActiveSlotForPage(page) {
    var n = Number(page && page._floorSlot) || 0;
    return Math.max(0, Math.min(floorSlotsForPage(page) - 1, n));
  }

  function floorViewsForPage(page) {
    var api = window.ToolboxReportFloorViews;
    if (api && typeof api.viewsFor === 'function') return api.viewsFor(page);
    return [];
  }

  function floorViewSpec(page, slot) {
    var api = window.ToolboxReportFloorViews;
    if (api && typeof api.viewAt === 'function') return api.viewAt(page, slot);
    return null;
  }

  // The one page in the deck that is written rather than drawn. Named here
  // because the DRAFT stamp and the rail both ask the question.
  function isDiscussionPage(page) {
    return !!(page && page.type === 'section' && page.meta &&
      page.meta.sectionId === 'discussion');
  }

  function pageTakesRail(page) {
    if (!page) return false;
    if (page.type === 'cover' || page.type === 'toc') return false;
    if (page.type === 'section' && page.meta && page.meta.sectionId === 'discussion') return false;
    // A reserved page is a placeholder -- "No Floor Survey is stored on this
    // Customer File" -- not a figure. Given a rail it announced a drawing
    // title, a survey date of nothing and "corrected for flooring
    // differences" over an empty sheet, which dresses up scaffolding as a
    // deliverable.
    if (page.meta && page.meta.reserved) return false;
    return true;
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
    // Lock logo used to stand on the paper beside the mark. It is in the side
    // rail with the slide's other controls, where Lock layout went: on the
    // sheet it was chrome printed over the report, and once the logo was
    // locked the mark stopped taking the pointer, so a button that only
    // appeared on hover could never have been reached to unlock it again.
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

  /**
   * Renumber the figures in the order the book is actually in.
   *
   * Earlier and Later put a sheet where the investigator wants it, so the
   * numbering has to follow the rail rather than the order the book would be
   * assembled in -- renumbering against the canonical order is how a sheet
   * moved up could end up stamped with the number of the one below it.
   */
  function renumberInPlace(pages) {
    var api = sourceApi();
    if (api && typeof api.assignFigureNumbers === 'function') api.assignFigureNumbers(pages);
    return pages;
  }

  /**
   * Where a kind of sheet belongs when the book has none of it yet.
   *
   * The saved order is the investigator's, so nothing is re-sorted on reopen
   * -- but a level surveyed after the last save has to arrive somewhere, and
   * "at the end" put Picture Locations after the Pictures sheets. It goes in
   * front of the first sheet that belongs after it: Cover, Discussion, Floor
   * Survey, Picture Locations, Pictures, anything else.
   */
  var PAGE_BANDS = { cover: 0, section: 1, floor: 2, distress: 3, pictures: 4 };

  function bandOf(page) {
    if (!page) return 5;
    var band = PAGE_BANDS[page.type];
    return typeof band === 'number' ? band : 5;
  }

  function firstIndexOfLaterBand(pages, type) {
    var band = PAGE_BANDS[type];
    if (typeof band !== 'number') return pages.length;
    for (var i = 0; i < pages.length; i += 1) {
      if (bandOf(pages[i]) > band) return i;
    }
    return pages.length;
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
      // A Diagnostics page is not composed into a report any more. Tim: "I
      // never said to add the diagnostics page. Diagnostics isn't even close
      // to being done." Nothing creates one now, but a report composed while
      // they existed still carried its page -- in the rail, in CONTENTS, and
      // in the print. Reconcile drops it so an older report comes back the
      // way a new one would be built.
      if (page.type === 'diagnostics') return false;
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
      var at = anchor >= 0 ? anchor + 1 : firstIndexOfLaterBand(pages, type);
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
        // Pictures come after the Picture Locations sheets that point at
        // them, which is the order ensurePicturesInFreshPages builds too.
        var at = lastIndexOfType(pages, 'pictures');
        if (at < 0) at = lastIndexOfType(pages, 'distress');
        if (at < 0) at = lastIndexOfType(pages, 'floor');
        at = at >= 0 ? at + 1 : firstIndexOfLaterBand(pages, 'pictures');
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

    // The saved order is the investigator's. Earlier and Later put a sheet
    // where they want it and autosave stores it -- and this is where that
    // choice was being thrown away, because re-sorting into assembly order on
    // every reopen undid the move. New source sheets are inserted at their own
    // anchor above, so a re-sort has nothing left to do here. A saved document
    // with no cover is not one of ours; let the assembler rebuild that one.
    if (!pages.some(function (page) { return page.type === 'cover'; })) return renumberFigures(pages);
    return renumberInPlace(pages);
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

  // Which way north is, from the way the front door faces.
  //
  // Distress Survey already answers this: frontDoorToNorthRotation — front of
  // building drawn at bottom of plan, rotation = 180 - bearing. Use that one.
  // Floor pages carry the canvas on meta.canvasId; Picture Locations carry it
  // on sourceRef.
  function northRotationFor(page, record) {
    var meta = (page && page.meta) || {};
    var canvasId = meta.canvasId || (page && page.sourceRef) || null;
    var ps = window.ToolboxPlanSetup;
    if (!ps || typeof ps.canvasById !== 'function' || !record || !canvasId) return null;
    var canvas = null;
    try { canvas = ps.canvasById(record, canvasId); } catch (err) { canvas = null; }
    var facing = canvas && typeof canvas.frontDoorFacing === 'string'
      ? canvas.frontDoorFacing.trim().toUpperCase()
      : '';
    if (!facing) return null;
    var bt = window.ToolboxBuildingTypes;
    if (!bt || typeof bt.frontDoorToNorthRotation !== 'function') return null;
    var deg = Number(bt.frontDoorToNorthRotation(facing));
    return isFinite(deg) ? deg : null;
  }

  // Chrome's "Save as PDF" defaults the filename from document.title.
  // Street underscore customer name — e.g. 15_Rabbitbrush_Janis_Fensterer.
  function printFileBasename(record) {
    function part(value) {
      return String(value == null ? '' : value)
        .trim()
        .replace(/[^A-Za-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
    }
    var street = part(addressParts(fullAddress(record) || displayAddress(record) || '').street);
    var name = part(displayCustomerName(record));
    if (street && name) return street + '_' + name;
    return street || name || 'Report';
  }

  function withPrintDocumentTitle(record, run) {
    var previous = document.title;
    var next = printFileBasename(record);
    if (next) document.title = next;
    var restore = function () { document.title = previous; };
    try {
      var result = typeof run === 'function' ? run() : null;
      if (result && typeof result.then === 'function') {
        return result.then(function (value) { return value; }, function (err) {
          restore();
          throw err;
        }).then(function (value) {
          // Title stays through the print dialog; afterprint puts it back.
          window.addEventListener('afterprint', restore, { once: true });
          return value;
        });
      }
      window.addEventListener('afterprint', restore, { once: true });
      return result;
    } catch (err) {
      restore();
      throw err;
    }
  }

  function renderNorthArrow(rotateDeg) {
    var wrap = document.createElement('div');
    wrap.className = 'rb-topo-page__north';
    wrap.setAttribute('aria-hidden', 'true');
    var deg = Number(rotateDeg);
    if (!isFinite(deg)) deg = 0;
    wrap.innerHTML =
      '<svg viewBox="0 0 40 52" focusable="false">' +
      '<g transform="rotate(' + deg + ' 20 26)">' +
      '<polygon points="20,2 28,22 20,18 12,22" fill="#111"/>' +
      '<polygon points="20,50 28,30 20,34 12,30" fill="#bbb"/>' +
      // Turned back the other way so the letter rides the arrowhead and
      // still reads upright on a plan that is not facing south.
      '<text x="20" y="16" text-anchor="middle" font-size="9" font-weight="700" fill="#111"' +
      ' transform="rotate(' + (-deg) + ' 20 13)">N</text>' +
      '</g>' +
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
    var dec = list.length ? list[0].decimalPlaces : 1;
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

  // The grid a Pictures page lays its photographs out on.
  //
  // Only the number across is chosen; the rows follow from how many pictures
  // the page holds, so 4 x 1 and 4 x 2 are one decision rather than two and
  // no choice can leave a photograph with nowhere to go. The rail names the
  // grid each choice produces -- 5 x 2, 4 x 2 -- because that is how the
  // layout is thought about: Tim, on a page carrying one stranded
  // photograph, "if we have 10 pictures per slide and we can change our grid
  // to 5 by 2 or 4 by 2 or 4 by 1, 5 by 1, then it would probably look less
  // improper."
  /**
   * How many pictures stand in a row: two, three, four or five.
   *
   * Tim, Oct 17: "three big pictures, two big pictures, four big pictures,
   * five big pictures, two in a row etc. Too small of a picture just does
   * not work -- some of that one by 10 that you had, or 10 by one, it just
   * did not work." So five is the ceiling, because narrower than that each
   * picture stops being readable.
   *
   * One across is back, Oct 20: "one row is acceptable. 5 by 1... 1 by 4, 1
   * by 3, 1 by 2, 1 by 1. The most rows are 2." Then, seeing 1 x 2 offered:
   * "1x2 NO." So a single column is one picture given the whole sheet and
   * nothing else -- two stacked down one column is the strip he threw out.
   */
  var PICTURES_ACROSS = [1, 2, 3, 4, 5];

  /**
   * How deep a Pictures sheet may stack before the pictures stop being worth
   * printing.
   *
   * The rows share the block's height between them, so every extra row makes
   * every picture shorter -- and a picture is sized by whichever of its two
   * dimensions runs out first, so a short row makes a NARROW picture too,
   * however wide its column is. Ten photographs two across is five rows: on a
   * 11x17 sheet that left each one about the size of a postage stamp,
   * marooned in a cell many times its size.
   *
   * Tim, looking at exactly that: "These are worthless views. Remove these."
   * And earlier, settling the same point: "Too small of a picture just does
   * not work."
   *
   * Two rows, and never a third. Tim, Oct 20: "we need to just worry about
   * pictures going in 5 columns, 2 rows. No more than 2 rows ever. So it
   * could be 4 by 2, it could be 1 by 4 or whatever, but no more than 2 rows.
   * Otherwise, it's too much."
   *
   * On a full page of ten that leaves five across; on shorter pages two,
   * three and four come back, which is what keeps "two big pictures" and
   * "three big pictures" available.
   */
  var MAX_PICTURE_ROWS = 2;

  /** The grids worth offering for a page holding this many photographs. */
  function picturesGrids(count) {
    var n = Math.max(1, Number(count) || 1);
    var fit = PICTURES_ACROSS.filter(function (cols) {
      // One column is one picture given the whole sheet, and nothing else:
      // two stacked down a single column is a strip. Tim, Oct 20: "1x2 NO."
      if (cols === 1) return n === 1;
      // The row cap stays until pages can SPLIT.
      //
      // Tim asked for every grid on every slide, and meant it with the
      // pagination attached: "two-picture, one-row ... 100 pictures ...
      // that's just 50 pages of two pictures each." Offering the tight grids
      // without that only deepens the page it is already on, which is the
      // postage-stamp view he had removed on Oct 20 -- "These are worthless
      // views. Remove these." Opening the menu alone hands him back the
      // thing he threw out, so it waits for the half that makes it safe.
      return Math.ceil(n / cols) <= MAX_PICTURE_ROWS;
    });
    // A page carrying more than even the widest grid can hold in three rows
    // still has to offer something: the shallowest there is.
    return fit.length ? fit : [PICTURES_ACROSS[PICTURES_ACROSS.length - 1]];
  }

  /**
   * The grid a page falls into when nobody has chosen one.
   *
   * Fewest empty cells, and the widest of those when two tie -- but never a
   * third row while a grid of two will hold the page, because rows share the
   * height between them and a third one is what makes the pictures too small
   * to read. Ten fall five and five; eight go four and four; four stand two
   * and two; three stand in a row of three.
   */
  function defaultPicturesAcross(count) {
    var n = Math.max(1, Number(count) || 1);
    var choices = picturesGrids(n);
    var widest = PICTURES_ACROSS[PICTURES_ACROSS.length - 1];
    var shallow = n <= widest * 2;
    var best = choices[choices.length - 1];
    var bestGaps = Infinity;
    choices.forEach(function (cols) {
      var rows = Math.ceil(n / cols);
      if (shallow && rows > 2) return;
      var gaps = (rows * cols) - n;
      if (gaps < bestGaps || (gaps === bestGaps && cols > best)) {
        best = cols;
        bestGaps = gaps;
      }
    });
    return best;
  }

  function picturesOnPage(page) {
    var evidence = (page && page.evidence) || {};
    if (Array.isArray(evidence.photos) && evidence.photos.length) return evidence.photos.length;
    var keys = page && page.meta && page.meta.photoKeys;
    return Array.isArray(keys) ? keys.length : 0;
  }

  function picturesAcross(page) {
    var n = page && page.meta ? Number(page.meta.picturesAcross) : 0;
    // The chosen shape is honoured as chosen. It used to be rejected when it
    // stacked deeper than three rows, because a shape was only a way of
    // arranging whatever had already been put on the page. A shape sets the
    // page's CAPACITY now, so nothing can stack too deep: the pictures that
    // do not fit are on the next sheet.
    if (PICTURES_ACROSS.indexOf(n) >= 0) return n;
    return defaultPicturesAcross(picturesOnPage(page));
  }

  /** How many rows deep the chosen shape is. */
  function picturesDown(page) {
    var n = page && page.meta ? Number(page.meta.picturesDown) : 0;
    if (n >= 1 && n <= MAX_PICTURE_ROWS) return n;
    return Math.max(1, Math.ceil(picturesOnPage(page) / picturesAcross(page)));
  }

  /**
   * Report readings pill height in CSS px from the Customer File layout.
   * Never from device-global stats-chip-size — capture and report stay apart.
   * 32px is the sheet default (matches CHROME_SCALE as scale 1× reference).
   */
  function pillPxFromLayout(layout) {
    var flApi = window.ToolboxReportFloorLayout;
    var chrome = (flApi && Number(flApi.CHROME_SCALE)) || 1;
    var scale = layout && layout.pillLock && Number(layout.pillLock.scale);
    if (isFinite(scale) && scale > 0) {
      return Math.max(8, Math.min(120, Math.round((scale / chrome) * 32)));
    }
    return 32;
  }

  /** Sheet-default pill lock scale (32px on the 11×17 chrome base). */
  function defaultPillLockScale() {
    var flApi = window.ToolboxReportFloorLayout;
    var chrome = (flApi && Number(flApi.CHROME_SCALE)) || 1;
    return chrome > 0 ? chrome : 1;
  }

  /**
   * The placements a new report starts from.
   *
   * VISION and DECISIONS both settle this: "Cover, discussion slots, TOC from
   * finished slide order, and other stable pieces stay template-friendly."
   * Where those boxes sit is house style, not something to redo on every job
   * -- Tim: "if we have a white space that we like and it does apply... that
   * might just be a template."
   *
   * It is kept beside Stats pill size, on the device, because that is the
   * shelf this product already has for a setting that is the investigator's
   * rather than the Customer File's. Making it follow him between devices is
   * a sync slice, and sync shape needs its own authorization.
   */
  var TEMPLATE_KEY = 'toolbox-report-template';

  var templateCache = null;

  function storedTemplate() {
    if (templateCache) return templateCache;
    try {
      var raw = window.localStorage.getItem(TEMPLATE_KEY);
      var value = raw ? JSON.parse(raw) : null;
      templateCache = value && typeof value === 'object' ? value : {};
    } catch (err) {
      templateCache = {};
    }
    return templateCache;
  }

  /** Merge one piece in, leaving the others as they were. */
  function saveTemplatePiece(piece) {
    if (!piece || typeof piece !== 'object') return false;
    try {
      var next = storedTemplate();
      Object.keys(piece).forEach(function (key) {
        if (piece[key] == null) delete next[key];
        else next[key] = JSON.parse(JSON.stringify(piece[key]));
      });
      window.localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next));
      templateCache = next;
      return true;
    } catch (err) {
      return false;
    }
  }

  function renderPicturesPage(page) {
    var meta = page.meta || {};
    var evidence = page.evidence || {};
    var captions = (page.reportText && page.reportText.captions) || {};
    var photos = Array.isArray(evidence.photos) ? evidence.photos : [];
    var root = document.createElement('div');
    root.className = 'rb-pictures-page';

    var grid = document.createElement('div');
    grid.className = 'rb-pictures-page__grid';
    var across = picturesAcross(page);
    var rows = Math.max(1, Math.ceil((photos.length || 1) / across));
    grid.style.setProperty('--rb-pics-cols', String(across));
    grid.style.setProperty('--rb-pics-rows', String(rows));
    // A single row is a row, not a band stretched down the whole sheet. The
    // rows share the block's height between them, so with only one of them it
    // took all of it -- and because a picture sits at the foot of its cell so
    // the captions line up, two photographs ended up along the bottom edge
    // under a page of white. Tim: "if we're going to have one row, it needs
    // to be centered or at the top, not at the bottom. That doesn't even make
    // sense at all."
    if (rows === 1) grid.classList.add('rb-pictures-page__grid--one-row');
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

  /**
   * The words fit the caption. The caption never moves the picture.
   *
   * A caption is a block of fixed height in every cell -- three lines deep,
   * set by the stylesheet from a size the shrinking does not touch. When a
   * description is too long for it the TYPE comes down, the way a deck author
   * would set it, and the plate above is left exactly where it is.
   *
   * It used to work the other way: the box grew to the words and the plate
   * gave way, so one long description lifted its own picture clear of the
   * row. Tim, looking at his own deck: "Pictures look good except for the one
   * in the upper right hand corner, which has apparently too much text to
   * center the picture." And: "I want to shrink the font. I said that
   * already."
   *
   * Half size is the floor. A description that will not fit even then is
   * longer than a plate caption, and the page is not the place to discover
   * it -- what shows is as much as half-size type holds.
   */
  var CAPTION_FLOOR = 0.5;

  function fitCaptions(root) {
    var fields = root.querySelectorAll('[data-rb-caption]');
    for (var i = 0; i < fields.length; i += 1) fitCaption(fields[i]);
  }

  function fitCaption(field) {
    if (!field) return;
    // Back to the stylesheet's size before measuring: a caption shortened
    // since the last pass must be allowed to grow back to full size.
    field.style.fontSize = '';
    var base = parseFloat(window.getComputedStyle(field).fontSize);
    if (!isFinite(base) || base <= 0) return;
    var size = base;
    var guard = 0;
    // The box is the stylesheet's and is never written to here. Only the
    // type changes, and only downwards.
    while (field.scrollHeight > field.clientHeight + 1 &&
      size > base * CAPTION_FLOOR && guard < 40) {
      size = Math.round((size - base * 0.04) * 100) / 100;
      field.style.fontSize = size + 'px';
      guard += 1;
    }
  }

  /**
   * Keep the street on one line, the way a deck author would.
   *
   * The decks set it at 60pt because "59 Lodge Trail" fits at 60pt. A longer
   * address does not: it wrapped, and the city line underneath it ran down
   * into the survey date. PowerPoint calls this shrink text on overflow, and
   * it is the same answer -- the type comes down until the line fits, and no
   * further than two thirds, which is still the largest thing on the page.
   */
  function fitStreetLine(root) {
    var fields = root.querySelectorAll('[data-rb-fit-line]');
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i];
      var base = parseFloat(field.getAttribute('data-rb-fit-line'));
      if (!isFinite(base) || base <= 0) continue;
      field.style.fontSize = base + 'cqh';
      var size = base;
      var guard = 0;
      // A line that does not fit WRAPS rather than overflowing, so the test
      // is the height: more than one line box deep means it has wrapped.
      var wrapped = function () {
        var line = parseFloat(window.getComputedStyle(field).lineHeight);
        if (!isFinite(line) || line <= 0) line = field.clientHeight;
        return field.scrollHeight > line * 1.5;
      };
      while (wrapped() && size > base * 0.6 && guard < 40) {
        size = Math.round((size - base * 0.04) * 1000) / 1000;
        field.style.fontSize = size + 'cqh';
        guard += 1;
      }
    }
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
  /**
   * One editable line of the cover. Always a div: the formatting controls in
   * the top rail work on rich text, which an <input> cannot hold, so every
   * field is a contenteditable rather than a form control. It used to take a
   * tag name and ignore it, which is how a test came to look for .value on
   * something that only ever had .textContent.
   */
  function coverField(className, fieldKey, value, locked) {
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
  // What the correction actually corrects for.
  //
  // The shipped decks say "Corrected for Floor Differences"; the figure rail
  // has always said flooring. Tim, asked which is right: "proper English
  // wins." It is flooring -- Floor Survey corrects a reading for the covering
  // underfoot, and calls it a flooring correction everywhere the investigator
  // meets it: "Correct for flooring", "Flooring correction", "Active flooring
  // corrections". The cover now says the same word as the rail and as the app.
  var CORRECTED_NOTE = 'Corrected for Flooring Differences';

  /**
   * Replace a line nobody has touched.
   *
   * Seeded cover text is written onto the page as soon as it renders, so a
   * Customer File built before this change carries the old wording as though
   * it had been typed. A line that still reads exactly as the old default was
   * never the investigator's word, so it takes the new one; anything else is
   * his and is left alone.
   */
  function retireOldWording(value, oldText, newText) {
    var api = window.ToolboxReportText;
    var plain = api && api.isModel(value) ? api.toPlain(value) : String(value == null ? '' : value);
    return plain.trim() === oldText ? newText : value;
  }

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
    // A run of sheets that all carry the same title is ONE line on the cover
    // with a span of figures across it, not one row each. A fourteen-figure
    // job listed Pictures ten times and every change of picture grid rewrote
    // the whole list. Tim: "then we're not killing our contents and changing
    // our cover sheet so crazily."
    var runs = [];
    entries.forEach(function (entry) {
      var last = runs[runs.length - 1];
      var n = typeof entry.figureNumber === 'number' ? entry.figureNumber : null;
      if (last && n !== null && last.figureNumberEnd !== null &&
          last.title === entry.title && n === last.figureNumberEnd + 1) {
        last.figureNumberEnd = n;
        return;
      }
      runs.push({
        pageId: entry.pageId,
        title: entry.title,
        type: entry.type,
        isDiscussion: entry.isDiscussion,
        figureNumber: n,
        figureNumberEnd: n,
      });
    });
    var contents = runs.map(function (entry) {
      var fallback = defaultContentsLine(entry);
      return {
        pageId: entry.pageId,
        text: keepRich(priorLines[entry.pageId], fallback),
        figureNumber: entry.figureNumber || null,
        figureNumberEnd: entry.figureNumberEnd || null,
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
      corrected: retireOldWording(
        keepRich(prior.corrected, CORRECTED_NOTE), 'Corrected for Floor Differences', CORRECTED_NOTE),
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

    // Lock layout and the line of instructions beside it used to stand on
    // the paper itself, bottom-left. They are the side rail's, with every
    // other control for the open slide. Tim, Oct 17: "yes, side rail
    // please." Locked, they used to vanish with the rest of the editor
    // chrome, which left no way to unlock a title page once it was locked.

    var stage = document.createElement('div');
    stage.className = 'rb-cover__stage';

    // "Prepared For:" sits in its own column with the contact stacked beside
    // it, which is how the decks tab it.
    var prepared = coverBoxShell('prepared', layout, locked);
    prepared.classList.add('rb-cover-box--prepared');
    addLine(prepared, 'rb-cover__label', 'Prepared For:');
    var contact = document.createElement('div');
    contact.className = 'rb-cover__contact';
    contact.appendChild(coverField('rb-cover__name', 'name', text.name, locked));
    contact.appendChild(coverField('rb-cover__email', 'email', text.email, locked));
    contact.appendChild(coverField('rb-cover__phone', 'phone', text.phone, locked));
    prepared.appendChild(contact);
    stage.appendChild(prepared);

    var identity = coverBoxShell('identity', layout, locked);
    identity.classList.add('rb-cover-box--identity');
    addLine(identity, 'rb-cover__product', 'FLOOR LEVEL SURVEY');
    var street = coverField('rb-cover__street', 'street', text.street, locked);
    street.setAttribute('data-rb-fit-line', '7.576');
    identity.appendChild(street);
    identity.appendChild(coverField('rb-cover__city', 'cityLine', text.cityLine, locked));
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
    dateRow.appendChild(coverField('rb-cover__date-value', 'surveyDate', text.surveyDate, locked));
    dateBox.appendChild(dateRow);
    dateBox.appendChild(coverField('rb-cover__corrected', 'corrected', text.corrected, locked));
    stage.appendChild(dateBox);

    var contents = coverBoxShell('contents', layout, locked);
    contents.classList.add('rb-cover-box--contents');
    // The contents box is as tall as its contents.
    //
    // It was a fixed rectangle, and the list inside it was clipped to that
    // rectangle. On a four-level job -- eleven figures -- the frame showed
    // seven and a half and the rest were simply gone, so the cover of a real
    // report told the client it contained less than it did. Tim: "the table
    // of content box doesn't change with the data... it doesn't automatically
    // adjust with the contents."
    //
    // The stored height is a floor now, not a ceiling, so a box dragged
    // taller keeps that size and a box with more in it grows past it. What it
    // must never do is hide a figure; if the grown box would run off the
    // bottom of the sheet, fitCoverContents steps the type down instead.
    var contentsBox = (layout.boxes && layout.boxes.contents) || null;
    if (contentsBox) {
      contents.style.height = 'auto';
      contents.style.minHeight = contentsBox.h + '%';
    }
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
      num.textContent = line.figureNumber
        ? ((line.figureNumberEnd && line.figureNumberEnd !== line.figureNumber)
          ? ('Figures ' + line.figureNumber + '\u2013' + line.figureNumberEnd)
          : ('Figure ' + line.figureNumber))
        : '';
      row.appendChild(num);
      var field = coverField('rb-cover__contents-field', 'contents:' + index, line.text, locked);
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
        // Whose property this is, for the rail. Same three fields every
        // railed page needs, read from the file rather than from whatever
        // the page happens to carry.
        var pName = displayCustomerName(record);
        var pAddr = addressParts(fullAddress(record) || displayAddress(record) || '');
        page.evidence = {
          customerName: pName,
          residenceTitle: residenceTitle(pName),
          address: pAddr.street || displayAddress(record),
          addressCity: pAddr.cityLine || '',
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
        var slide = distress.find(function (item) { return item.canvasId === page.sourceRef; }) || null;
        if (slide) {
          // Whose property this is, for the rail. The pins and the plan are
          // the slide's; the residence and the address belong to the file,
          // and the rail asks the page for both in one place.
          var dName = displayCustomerName(record);
          var dAddr = addressParts(fullAddress(record) || displayAddress(record) || '');
          slide.customerName = dName;
          slide.residenceTitle = residenceTitle(dName);
          slide.address = dAddr.street || displayAddress(record);
          slide.addressCity = dAddr.cityLine || '';
          var dNorth = northForCanvas(canvasById(record, page.sourceRef));
          if (dNorth != null) slide.northRotation = dNorth;
        }
        page.evidence = slide;
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
          northRotation: northForCanvas(canvasById(record, meta.canvasId)),
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
                northRotation: northForCanvas(canvasById(record, meta.canvasId)),
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


  /**
   * The sheets one Distress level's schedule runs across.
   *
   * A level's first Picture Locations page plus the continuation sheets that
   * follow it. They are contiguous and share a sourceRef, so the chain is read
   * off the page order rather than stored -- there is no second place for it
   * to be wrong.
   */
  function penLogChain(page, pages) {
    var chain = [];
    var at = -1;
    for (var i = 0; i < pages.length; i += 1) if (pages[i].id === page.id) at = i;
    if (at < 0) return [page];
    var head = at;
    while (head > 0 && isPenLogPage(pages[head]) && pages[head].meta.continuation &&
           isPenLogPage(pages[head - 1]) && pages[head - 1].sourceRef === pages[head].sourceRef) {
      head -= 1;
    }
    for (var j = head; j < pages.length; j += 1) {
      if (!isPenLogPage(pages[j])) break;
      if (j > head && (!pages[j].meta.continuation || pages[j].sourceRef !== pages[head].sourceRef)) break;
      chain.push(pages[j]);
    }
    return chain.length ? chain : [page];
  }

  /** The run of pins this sheet shows: from its own start to the next one's. */
  function penLogSliceFor(page, chain, pins) {
    var from = 0;
    var to = pins.length;
    for (var i = 0; i < chain.length; i += 1) {
      if (chain[i].id !== page.id) continue;
      from = penLogStart(chain[i]);
      to = i + 1 < chain.length ? penLogStart(chain[i + 1]) : pins.length;
    }
    from = Math.max(0, Math.min(pins.length, from));
    to = Math.max(from, Math.min(pins.length, to));
    return pins.slice(from, to);
  }

  /**
   * Whether this Picture Locations sheet draws the level's contour layer.
   *
   * On wherever there is one, because that is the view that tells the story:
   * Tim, having used it in the field, "this is most likely going to be the
   * view in Report Builder more often than not, because it's very telling."
   * It is a rendition of this page, not a change to the level -- the same
   * plan, the same pins, the same numbers -- so each sheet carries its own
   * choice and Distress's own layer choice is untouched.
   */
  function penLogShowsContour(page) {
    var want = page && page.meta ? page.meta.showContour : undefined;
    if (typeof want === 'boolean') return want;
    // A sheet that has not been told takes the default; the default is the
    // investigator's, and on is what it was before he set one.
    var fromTemplate = storedTemplate().penLogContour;
    return typeof fromTemplate === 'boolean' ? fromTemplate : true;
  }

  function penLogContour(page) {
    if (!penLogShowsContour(page)) return null;
    return (page.evidence && page.evidence.contour) || null;
  }

  function penLogStart(page) {
    var n = page && page.meta && page.meta.penLogFrom;
    return typeof n === 'number' && isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }

  function renderPenLogSheet(sheet, page, pages, thumb) {
    var notes = penLogNoteMap(page, penLogUi.noteMap);
    var pins = penLogPinsForPage(page, notes, penLogOffsetMap(page));
    var chain = penLogChain(page, pages);
    var shown = penLogSliceFor(page, chain, pins);
    if (!shown.some(function (pin) { return pin.id === penLogUi.selectedPinId; })) {
      penLogUi.selectedPinId = shown[0] ? shown[0].id : '';
    }
    // A continuation sheet carries its level's figure number, not one of its
    // own: it is Figure 2 carried on, not Figure 3. Worked out before the
    // sheet is drawn, because the sheet's own label has to say the same
    // number the rail prints on it -- a screen reader hearing "Figure 4" off
    // a sheet stamped FIGURE 2 is reading a different sheet.
    var head = chain[0] || page;
    var headFigure = (head.meta && head.meta.figureNumber) || null;
    if (!headFigure) {
      for (var h = 0; h < pages.length; h += 1) if (pages[h].id === head.id) headFigure = h + 1;
    }
    page._figureNumber = headFigure;
    page._figureCont = page !== head;

    // A preview measures itself at stamp size; keeping that would move the
    // pins on the real page.
    var penLogLayout = window.ToolboxPenLog.renderPage(sheet, {
      title: page.title,
      levelName: page.meta && page.meta.levelName,
      pageNumber: headFigure,
      figureCont: page !== head,
      plan: (page.evidence && page.evidence.plan) || {},
      contour: penLogContour(page),
      layout: page._penLogLayout || null,
      locked: !!thumb,
      // Present / Print deck: static notes, not textareas (Chrome print mush).
      printable: !!(sheet && sheet.classList && sheet.classList.contains('rb-sheet--print')),
      pins: shown,
      // The map is the whole level on every sheet of it: a reader looking up
      // photograph 31 on the second sheet needs the same plan in front of
      // them as the one who looked up photograph 3 on the first.
      allPins: pins,
      selectedPinId: penLogUi.selectedPinId,
      onNote: function (id, value, source) {
        if (typeof penLogUi.onNote === 'function') penLogUi.onNote(id, value, source);
      },
      onSelect: function (id) {
        if (typeof penLogUi.onSelect === 'function') penLogUi.onSelect(id);
      },
    });
    if (!thumb) penLogUi.layout = penLogLayout;
    var rail = railForPage(page, { noteEditable: !thumb });
    if (rail) sheet.appendChild(rail);
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
  /**
   * The live Floor Survey views a slide is hosting, by slot.
   *
   * There used to be exactly one, because a slide drew one plan. A sheet can
   * now carry two views of the same level -- Tim: "my thoughts are to be able
   * to put two views of floor on it... we have the colour contours and our
   * space allows, maybe I can just put another floor plan that shows the data
   * points" -- so each slot keeps its own mount and they are torn down
   * together when the slide changes.
   */
  var topoHosts = Object.create(null);

  function topoHostKey(page, slot) {
    var view = floorViewSpec(page, slot);
    if (view) {
      return [page && page.id, slot, view.id, view.canvasId, view.epochId,
        view.areaId || '', view.scope || ''].join('|');
    }
    var meta = (page && page.meta) || {};
    return [page && page.id, slot, meta.canvasId, meta.epochId,
      meta.areaId || '', meta.scope || ''].join('|');
  }

  function releaseTopoHost(slot) {
    var host = topoHosts[slot];
    if (!host) return;
    delete topoHosts[slot];
    if (host.api && typeof host.api.unmount === 'function') {
      try { host.api.unmount(); } catch (err) { /* already gone */ }
    }
    if (host.el && host.el.parentNode) host.el.parentNode.removeChild(host.el);
  }

  /**
   * Hand a camera to linked same-source companions on this slide.
   *
   * Same-source linked pairs share pan/zoom (Tim: side by side exactly).
   * Size-linked different floors and unlinked same-source views keep their
   * own cameras (GPT-027) — do not broadcast the book camera to every host.
   */
  function pushCameraToTopoHosts(camera, except, onlySlots) {
    if (!camera) return;
    var allow = onlySlots && onlySlots.length
      ? onlySlots.reduce(function (m, s) { m[Number(s)] = true; return m; }, Object.create(null))
      : null;
    Object.keys(topoHosts).forEach(function (slot) {
      if (Number(slot) === Number(except)) return;
      if (allow && !allow[Number(slot)]) return;
      var host = topoHosts[slot];
      if (!host || !host.api || typeof host.api.update !== 'function') return;
      host.api.update({ camera: camera });
    });
  }

  /**
   * The colour scales a sheet is showing, painted by Floor Survey.
   *
   * The scale on a Floor Survey page is the one from the Floor Survey screen
   * -- same grid, same contour values, same palette -- so the page asks Floor
   * Survey to paint it and places the picture. Painting means building the
   * boundary's grid, so each one is kept against what it was painted from and
   * re-used: a sheet and its thumbnail show the same picture, and nothing is
   * painted twice.
   */
  var legendImages = Object.create(null);
  var legendPainting = Object.create(null);

  /** What a painted scale depends on. A change to any of it is a new scale. */
  function legendKey(canvasId, areaId, scope, statsIndex, settings) {
    var view = settings || {};
    return [
      canvasId || '', scope === 'all' ? '' : (areaId || ''), statsIndex,
      view.palette || '', view.reversePalette ? 'r' : '',
      view.firstContour, view.contourStep, view.contourCount,
      view.minClamp, view.maxClamp, view.decimalPlaces,
    ].join('|');
  }

  function legendSourceForView(page, view) {
    var meta = (page && page.meta) || {};
    var canvasId = (view && view.canvasId) || meta.canvasId || '';
    var scope = (view && view.scope) || meta.scope || 'all';
    var areaId = scope === 'all' ? null : ((view && view.areaId) || meta.areaId || null);
    var settings = (view && view.settings) || (page && page._floorView) || null;
    return { canvasId: canvasId, scope: scope, areaId: areaId, settings: settings };
  }

  /**
   * Make sure every colour scale these pages need has been painted.
   *
   * Called from renderPages, and it draws the pages again once pictures have
   * arrived. The cache is what stops that from going round for ever: the
   * second pass finds every scale already painted and asks for nothing.
   *
   * Multi-view sheets paint one legend set per view source/settings (GPT-027).
   */
  function ensureFloorLegends(fileId, pages, redraw) {
    var api = window.ToolboxFloorSurvey;
    if (!api || typeof api.renderTopoLegendImage !== 'function') return;
    var wanted = [];
    (pages || []).forEach(function (page) {
      if (!page || page.type !== 'floor') return;
      var meta = page.meta || {};
      if (!meta.imported || !meta.canvasId) return;
      var views = floorViewsForPage(page);
      page._viewLegendUrls = page._viewLegendUrls || {};
      if (views.length > 1) {
        views.forEach(function (vs, vi) {
          var src = legendSourceForView(page, vs);
          var slotStats = page._viewStats && page._viewStats[vi];
          var stats = Array.isArray(slotStats) ? slotStats
            : (page._liveStats ||
              ((page.evidence && Array.isArray(page.evidence.stats)) ? page.evidence.stats : []));
          var count = Math.max(1, Array.isArray(stats) ? stats.length : 1);
          var urls = [];
          for (var i = 0; i < count; i += 1) {
            var key = legendKey(src.canvasId, src.areaId, src.scope, i, src.settings);
            urls.push(legendImages[key] || '');
            if (!legendImages[key] && !legendPainting[key]) {
              wanted.push({
                page: page, index: i, key: key, slot: vi,
                canvasId: src.canvasId, areaId: src.areaId, settings: src.settings,
              });
            }
          }
          page._viewLegendUrls[vi] = urls;
        });
        // Keep page._legendUrls as the active view's set for single-slot readers.
        var active = floorActiveSlotForPage(page);
        page._legendUrls = page._viewLegendUrls[active] || page._viewLegendUrls[0] || [];
        return;
      }
      var statsOne = page._liveStats ||
        ((page.evidence && Array.isArray(page.evidence.stats)) ? page.evidence.stats : []);
      var countOne = Math.max(1, statsOne.length);
      var urlsOne = [];
      var srcOne = legendSourceForView(page, views[0] || null);
      for (var j = 0; j < countOne; j += 1) {
        var keyOne = legendKey(srcOne.canvasId, srcOne.areaId, srcOne.scope, j, srcOne.settings);
        urlsOne.push(legendImages[keyOne] || '');
        if (!legendImages[keyOne] && !legendPainting[keyOne]) {
          wanted.push({
            page: page, index: j, key: keyOne, slot: 0,
            canvasId: srcOne.canvasId, areaId: srcOne.areaId, settings: srcOne.settings,
          });
        }
      }
      page._legendUrls = urlsOne;
      page._viewLegendUrls[0] = urlsOne;
    });
    if (!wanted.length) return;
    wanted.forEach(function (job) { legendPainting[job.key] = true; });
    Promise.all(wanted.map(function (job) {
      return api.renderTopoLegendImage({
        customerFileId: fileId,
        canvasId: job.canvasId || '',
        areaId: job.areaId || null,
        statsIndex: job.index,
        settings: job.settings || null,
      }).then(function (painted) {
        delete legendPainting[job.key];
        if (painted && painted.dataUrl) legendImages[job.key] = painted.dataUrl;
      }).catch(function () {
        delete legendPainting[job.key];
      });
    })).then(function () {
      if (typeof redraw === 'function') redraw();
    });
  }

  /** Every slot, or every slot past `keep`. */
  function releaseTopoHosts(keep) {
    Object.keys(topoHosts).forEach(function (slot) {
      if (typeof keep === 'number' && Number(slot) < keep) return;
      releaseTopoHost(slot);
    });
  }

  function mountTopoHost(page, slot, hooks) {
    var api = window.ToolboxFloorSurvey;
    if (!api || typeof api.mount !== 'function') return null;
    var n = Number(slot) || 0;
    var key = topoHostKey(page, n);
    var host = topoHosts[n];
    if (host && host.el && host.key === key) {
      host.hooks = hooks;
      // Lock View changes nothing about WHICH level is shown, so the host is
      // reused rather than rebuilt -- and the view was therefore never told.
      // Lock flipped its own label, saved, and left the slide as steerable as
      // before. Push it the way settings are pushed.
      if (host.api && typeof host.api.update === 'function') {
        host.api.update({
          locked: !!(hooks && hooks.locked),
          settings: (hooks && hooks.settings) || null,
          hostStatsPillPx: liveHostPillPx(page, hooks),
        });
      }
      return host.el;
    }
    releaseTopoHost(n);
    var el = document.createElement('div');
    el.className = 'rb-topo-live';
    el.setAttribute('data-rb-topo-live', '1');
    el.setAttribute('data-rb-topo-slot', String(n));
    host = { el: el, key: key, api: null, hooks: hooks };
    topoHosts[n] = host;
    var meta = page.meta || {};
    var view = floorViewSpec(page, n);
    var canvasId = (view && view.canvasId) || meta.canvasId || '';
    var scope = (view && view.scope) || meta.scope || 'all';
    var areaId = scope === 'all' ? null : ((view && view.areaId) || meta.areaId || null);
    // Live drawing is settingsOwnedByHost and receives report pill px from
    // hooks / page layout so it never subscribes to capture sizes.
    host.api = api.mount(el, {
      customerFileId: (hooks && hooks.customerFileId) || '',
      workspace: 'report-topo',
      canvasId: canvasId,
      areaId: areaId,
      camera: (hooks && hooks.camera) || null,
      settings: (hooks && hooks.settings) || null,
      locked: !!(hooks && hooks.locked),
      hostStatsPillPx: liveHostPillPx(page, hooks),
      onBack: function () {},
      onCameraChange: function (camera) {
        if (host.hooks && host.hooks.onCameraChange) host.hooks.onCameraChange(camera, n);
      },
      onSettingsChange: function (next) {
        if (host.hooks && host.hooks.onSettingsChange) host.hooks.onSettingsChange(next, n);
      },
      onStats: function (stats) {
        if (host.hooks && host.hooks.onStats) host.hooks.onStats(stats, n);
      },
      onReady: function (info) {
        if (host.hooks && host.hooks.onReady) host.hooks.onReady(info, n);
      },
    });
    return el;
  }

  /** Report pill px for a live topo host — never capture localStorage. */
  function liveHostPillPx(page, hooks) {
    if (hooks && isFinite(Number(hooks.hostStatsPillPx)) && Number(hooks.hostStatsPillPx) > 0) {
      return Number(hooks.hostStatsPillPx);
    }
    return pillPxFromLayout((page && page._bookFloorLayout) || null);
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
   * "Figure N" for the rail's foot.
   *
   * Floor and Pictures pages carry a figure number in their meta. A Picture
   * Locations sheet never has: its figure number has always been its place in
   * the book, which is what the page printed before the rail existed, and
   * which a continuation sheet needs anyway because it is a figure of its own.
   */
  function figureLabelFor(page) {
    var meta = (page && page.meta) || {};
    var n = meta.figureNumber || (page && page._figureNumber) || null;
    if (!n) return '';
    return 'Figure ' + n + (page && page._figureCont ? ' (cont.)' : '');
  }

  /**
   * Which way north points on this plan.
   *
   * Distress Survey already answers this: frontDoorToNorthRotation. Tim:
   * "If you're unsure on what the code is supposed to do, it is correct in
   * distress survey. What I want is already there." Returns degrees
   * clockwise from plan-up, or null when the facing was never set.
   */
  var NORTH_BEARINGS = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SW: 225, W: 270, NW: 315 };

  function northForCanvas(canvas) {
    if (!canvas) return null;
    var facing = String(canvas.frontDoorFacing || '').trim().toUpperCase();
    if (typeof NORTH_BEARINGS[facing] !== 'number') return null;
    var bt = window.ToolboxBuildingTypes;
    if (bt && typeof bt.frontDoorToNorthRotation === 'function') {
      return Number(bt.frontDoorToNorthRotation(facing)) || 0;
    }
    return ((180 - NORTH_BEARINGS[facing]) % 360 + 360) % 360;
  }

  function canvasById(record, canvasId) {
    var list = record && record.planSetup && Array.isArray(record.planSetup.canvases)
      ? record.planSetup.canvases
      : [];
    for (var i = 0; i < list.length; i += 1) {
      if (list[i] && list[i].id === canvasId) return list[i];
    }
    return null;
  }

  /**
   * The rail for a figure page.
   *
   * One rail serves every figure page: a section it has nothing for is simply
   * absent, so a Pictures page is the same component with no readings rather
   * than a second layout to keep in step with this one.
   */
  function railForPage(page, opts) {
    var api = window.ToolboxReportRail;
    if (!api || typeof api.render !== 'function') return null;
    var meta = page.meta || {};
    var ev = page.evidence || {};
    var text = page.reportText || {};
    // Live values, not what the page stored when it was first assembled.
    // A level renamed in Floor Survey, or a date set there afterwards, never
    // reached the stored meta -- which is why a sheet said "Boundary 1" and
    // had no survey date while the app showed "Main Floor" and 10/07/2026.
    // Live first: what the drawing is drawing. Evidence stored at import is
    // only a fallback for a slide whose view has not reported yet.
    var live = Array.isArray(page._liveStats) ? page._liveStats.filter(Boolean) : null;
    var stats = page.type === 'floor' && meta.imported
      ? (live && live.length ? live : (Array.isArray(ev.stats) ? ev.stats.filter(Boolean) : []))
      : [];
    var scopeTitle = meta.scope === 'all'
      ? (meta.scopeTitle || 'Combined')
      : ((stats.length === 1 && stats[0].name) || meta.scopeTitle || meta.levelName || '');
    var title;
    if (page.type === 'floor') {
      title = 'Floor Level Survey' + (scopeTitle ? '\n' + scopeTitle : '');
    } else if (page.type === 'distress') {
      var level = String(meta.levelName || '').trim();
      title = 'Picture/Damage Locations' + (level ? '\n' + level : '');
    } else if (page.type === 'pictures') {
      title = 'Pictures';
    } else {
      title = page.title || '';
    }
    var rawDate = page._surveyDate || meta.surveyDate || ev.surveyDate || '';
    var dateText = formatSurveyDate(rawDate, true);
    return api.render({
      // A compass belongs on a drawing of the building. A sheet of
      // photographs, or of property details, is not oriented to anything.
      north: page.type === 'floor' || page.type === 'distress',
      // _northRotation carries the report's own hand turn when there is one,
      // and otherwise the Distress rule for this level. A turn used to be
      // kept on the SHEET, so turning the rose on one drawing left every
      // other drawing of the same building pointing somewhere else -- and
      // the levels disagreed anyway, because each canvas keeps its own front
      // door facing and only the one being worked on is ever set.
      northRotation: typeof page._northRotation === 'number'
        ? page._northRotation
        : (typeof ev.northRotation === 'number' ? ev.northRotation : 0),
      residence: ev.residenceTitle || ev.customerName || '',
      address: ev.address || '',
      addressCity: ev.addressCity || '',
      title: title,
      // A field with no value shows a dash rather than leaving its heading
      // standing over nothing, which is what a sheet with no survey date
      // recorded looked like.
      surveyDate: longSurveyDate(rawDate) || dateText ||
        (page.type === 'floor' ? '\u2014' : ''),
      correctedNote: page.type === 'floor' ? 'Corrected for flooring differences' : '',
      stats: stats,
      note: text.railNote || '',
      noteEditable: !!(opts && opts.noteEditable),
      // Tim: "All text on the rail needs to be editable by the user." Every
      // block takes the investigator's words when there are any and the
      // generated line when there are not; the same flag that makes the note
      // writable makes the rest writable, so a thumbnail stays inert.
      editable: !!(opts && opts.noteEditable),
      edits: text.rail || {},
      figureLabel: figureLabelFor(page),
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
      renderDraftStamp(sheet, !!page._draftStamp);
      renderBrandLayer(sheet, page, page._brandBox || (page.meta && page.meta.brandBox));
      return;
    }
    if (!thumb) penLogUi.layout = null;

    var margin = document.createElement('div');
    margin.className = 'rb-sheet__margin';
    if (pageTakesRail(page)) margin.classList.add('rb-sheet__margin--railed');

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
      // Measured once the sheet is in the document and has a width: a
      // stamp and the real page are different sizes, and both are fitted.
      window.requestAnimationFrame(function () { fitStreetLine(sheet); });
    } else if (page.type === 'section' && page.meta && page.meta.sectionId === 'discussion' &&
               window.ToolboxReportDiscussion) {
      margin.classList.add('rb-sheet__margin--discussion');
      var discussionEl = window.ToolboxReportDiscussion.renderPage(page, {
        locked: !!(page.meta && page.meta.locked),
        facts: page._facts || null,
        box: page._discussionBox || null,
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
      // Measured once the sheet has a width, like the cover's street. Never
      // on a stamp: a thumbnail is too small to read either way, and there
      // are as many of them as there are pages.
      if (!thumb) window.requestAnimationFrame(function () { fitCaptions(sheet); });
    } else if (page.type === 'floor' && !(page.meta && page.meta.reserved)) {
      margin.classList.add('rb-sheet__margin--topo');
      // Once imported, the drawing gets the whole sheet: the inset box the
      // other pages use is a band of white the plan cannot be moved into, and
      // it clips the plan before the paper edge when it is panned.
      if (page.meta && page.meta.imported) margin.classList.add('rb-sheet__margin--topo-bleed');
      var fl = window.ToolboxReportFloorLayout;
      if (fl && typeof fl.renderPage === 'function') {
        var imported = !!(page.meta && page.meta.imported && page.evidence && page.evidence.figure);
        // ONE layout record for the whole report. The slide used to keep a
        // copy of its own, with the book's behind it and a factory default
        // behind that -- three places holding one answer, and whichever was
        // found first won. A slide nobody had touched fell through to the
        // default (the aerial at x 2.5, y 74) and disagreed with the slide
        // that had been arranged. Tim: "If I put the contour map in one
        // place, it needs to live in one place."
        var layout = page._bookFloorLayout || fl.defaultLayout();
        var rendered = fl.renderPage(page, page.evidence || {}, {
          imported: imported,
          layout: layout,
          formatSurveyDate: formatSurveyDate,
          renderNorthArrow: function () { return renderNorthArrow(page._northRotation || 0); },
          renderRelativeReadings: renderRelativeReadings,
          // Never in a preview. There is one live topo host and it is a
          // single DOM node: handing it to a thumbnail moves it off the
          // sheet and into the stamp, taking the drawing with it.
          mountTopo: thumb ? null : (page._mountTopo || null),
          // What a slide draws when the live view is on another slide. Only
          // the printed deck has one, and only for the slides that need it.
          stillTopo: thumb ? null : function (p, slot) {
            var shots = p && p._printTopo;
            return shots ? (shots[Number(slot) || 0] || '') : '';
          },
          topoSlots: thumb ? 1 : floorSlotsForPage(page),
          topoActiveSlot: thumb ? 0 : floorActiveSlotForPage(page),
          views: thumb ? null : floorViewsForPage(page),
          viewStats: thumb ? null : (page._viewStats || null),
          viewLegendUrls: thumb ? null : (page._viewLegendUrls || null),
          // The cover's aerial view, carried onto this page automatically and
          // taken off it with the x. Settled Oct 10, 2026.
          overviewUrl: page._overviewUrl || '',
          overviewHidden: !!(page.meta && page.meta.hideOverview),
          // The colour scale and the readings are drawn on the page now, from
          // whatever the drawing is drawing -- including how big the slide's
          // own Legend size says the scale should be.
          stats: page._liveStats || null,
          settings: page._floorView || null,
          // The colour scales, as pictures painted by Floor Survey. One per
          // boundary, in the order the readings come in.
          legendUrls: page._legendUrls || null,
          // Readings size from this report's floorLayout.pillLock only.
          // page._bookFloorLayout is set before render; never device localStorage.
          pillPx: pillPxFromLayout(page && page._bookFloorLayout),
        });
        // Back to the one record, not onto the slide. renderSheet runs
        // outside the closure that holds it, so the way in is handed over on
        // the page, like the aerial view and the view settings are.
        if (!thumb && typeof page._putFloorLayout === 'function') {
          page._putFloorLayout(rendered.layout);
        }
        margin.appendChild(rendered.root);
      } else if (!renderEvidence(margin, page)) {
        addLine(margin, 'rb-sheet__note', 'Floor Survey page unavailable.');
      }
    } else if (page.type === 'distress' || page.type === 'diagnostics') {
      var kicker = page.type === 'distress' ? 'Distress Survey' : 'Diagnostics';
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

    if (pageTakesRail(page)) {
      var rail = railForPage(page, { noteEditable: !thumb });
      if (rail) sheet.appendChild(rail);
    }

    if (window.ToolboxReportOverlay) {
      sheet.appendChild(window.ToolboxReportOverlay.renderLayer(
        page.meta && page.meta.overlays,
        { locked: false, mediaUrls: overlayUrlCache }
      ));
    }

    var hidePageNum = page.type === 'cover' ||
      // A railed page already says FIGURE N at the foot of its rail.
      pageTakesRail(page) ||
      // The decks carry no page number on the discussion sheet.
      (page.type === 'section' && page.meta && page.meta.sectionId === 'discussion');
    if (!hidePageNum) {
      var footer = document.createElement('p');
      footer.className = 'rb-sheet__page';
      footer.id = 'rb-sheet-page';
      footer.textContent = 'Page ' + (index + 1);
      margin.appendChild(footer);
    }
    sheet.appendChild(margin);
    renderSheetFrame(sheet);
    renderDraftStamp(sheet, !!page._draftStamp);
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

  function persistableDocument(pages, activePageId, prior, floorLayout, coverLayout, brandBox,
    floorCamera, floorView, floorFramed, discussionBox, penLogLayout, northRotation, draft) {
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
    // One writing area for the whole discussion, continuation sheets
    // included, so the re-flow measures the same box it splits by.
    var discBody = discussionBox || (prior && prior.discussionBox);
    if (discBody) doc.discussionBox = discApi ? discApi.normalizeBodyBox(discBody) : discBody;
    var penApi = window.ToolboxPenLog;
    var penBoxes = penLogLayout || (prior && prior.penLogLayout);
    if (penBoxes) {
      doc.penLogLayout = penApi && penApi.normalizeLayout
        ? penApi.normalizeLayout(penBoxes) : penBoxes;
    }
    var camera = floorCamera || (prior && prior.floorCamera);
    if (camera) doc.floorCamera = JSON.parse(JSON.stringify(camera));
    var view = floorView || (prior && prior.floorView);
    if (view) doc.floorView = JSON.parse(JSON.stringify(view));
    if (draft === true || draft === false) doc.draftStamp = !!draft;
    else if (prior && typeof prior.draftStamp === 'boolean') doc.draftStamp = prior.draftStamp;
    if (typeof northRotation === 'number') {
      doc.northRotation = northRotation;
    } else if (prior && typeof prior.northRotation === 'number') {
      doc.northRotation = prior.northRotation;
    }
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

  /**
   * Readings are measured in tenths of an inch, so tenths is what the app
   * prints. Slides saved before that was the default carry decimalPlaces: 2
   * -- not a choice anyone made, just the old default written into the page
   * the first time a control was touched -- and would keep printing a digit
   * that was never measured. Clearing it once lets the slide take the
   * default; a value chosen after today is kept.
   */
  var FLOOR_VIEW_DECIMALS_FIX = 1;

  function reviveFloorView(view) {
    if (!view || typeof view !== 'object') return view;
    var next = JSON.parse(JSON.stringify(view));
    // Each repair carries its own stamp. One shared stamp would re-run a
    // repair that had already been applied -- undoing a choice made since --
    // the next time another was added.
    if (!(next.decimalsFix >= FLOOR_VIEW_DECIMALS_FIX)) {
      delete next.decimalPlaces;
      next.decimalsFix = FLOOR_VIEW_DECIMALS_FIX;
    }
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
    /**
     * Which edit the document in hand is.
     *
     * A save snapshots the pages, then waits -- on an IndexedDB read of the
     * borrowed components and then on the write itself. Anything typed in
     * that window is NOT in the snapshot, and clearing `dirty` when the
     * snapshot lands threw it away: the armed timer saw a clean document and
     * returned, and the page said "Saved" over text that had never been
     * written. Reproduced on HEAD -- typed "Second edit while saving.",
     * stored "First edit.", one write, status "Saved".
     *
     * The counter moves on every edit. A save may only report itself done,
     * and only clear `dirty`, if the counter has not moved since it took its
     * snapshot. Otherwise the document is still ahead of the disk and must
     * stay that way until the next save catches up.
     */
    var editSeq = 0;
    var workingRecord = null;
    var saveTimer = null;
    var lastSavedAt = '';
    var floorLayout = window.ToolboxReportFloorLayout
      ? window.ToolboxReportFloorLayout.defaultLayout()
      : { locked: false, topo: { x: 10, y: 6, w: 80, h: 88 }, overlays: [] };
    var coverLayout = window.ToolboxReportCoverLayout
      ? window.ToolboxReportCoverLayout.defaultLayout()
      : { locked: false, boxes: {}, overviewMediaId: '' };
    // Which way north points on every drawing in this report. Null until the
    // first drawing is stamped, which seeds it from that level's front door.
    var reportNorth = null;
    // A DRAFT watermark across every sheet. Off unless it was turned on.
    var draftStamp = false;
    // One logo placement for the whole book. Null until the document says
    // otherwise, so a report saved before this still shows where its logo was
    // put (the per-sheet copy is adopted on open).
    var brandBox = null;
    // Where the discussion's writing area sits and how big it is. One
    // placement for the whole discussion; null until the investigator moves
    // it, and then it is his. Tim: "if you let me adjust the size of the box
    // then I can use the white space that I want."
    var discussionBox = null;
    // Where the plan and the schedule sit on a Picture Locations sheet. One
    // placement for the whole report, like the Floor Survey layout: level on
    // level, the sheets have to register with each other.
    var penLogBoxLayout = null;
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
    //
    // A sheet may carry two of those renditions at once. Tim: "We have the
    // colour contours and our space allows -- maybe I can just put another
    // floor plan that shows the data points." Both show the same level; only
    // what is drawn differs, and the camera stays the book's, so the two sit
    // side by side framed identically. The second lives on meta.floorView2:
    // two named fields rather than an array, because nothing has to be
    // migrated and a report written before today reads unchanged.
    function floorSlots(page) {
      return floorSlotsForPage(page);
    }
    /** Which of them the rail's controls are driving. Not saved: it is where
     *  the investigator is looking, not part of the report. */
    function floorSlot(page) {
      var n = Number(page && page._floorSlot) || 0;
      return Math.max(0, Math.min(floorSlots(page) - 1, n));
    }
    /**
     * Is this piece locked on this sheet?
     *
     * Three locks, each over one thing and over both its position and its
     * size. Tim: "I might want to lock floor survey, I might want to lock a
     * legend contour and then I might want to lock the high/low delta pin,
     * and all of those can be separate." The colour scale and the readings
     * have one each; the plan frame and the aerial view still answer to the
     * report-wide lock a report may already carry.
     */
    /** The size the rail's own control is drawing each piece at right now. */
    function liveLegendScale() {
      var view = floorViewFor(activePage());
      var n = Number(view && view.legendScale);
      return isFinite(n) && n > 0 ? n : 1;
    }

    function livePillScale() {
      // Prefer the report's stored lock; otherwise the sheet default — never
      // device-global capture prefs.
      var have = floorLayout && floorLayout.pillLock && Number(floorLayout.pillLock.scale);
      if (isFinite(have) && have > 0) return have;
      return defaultPillLockScale();
    }

    /**
     * A locked piece still answers its own size control.
     *
     * The lock keeps the size in the report so it is the same on every sheet
     * and on every machine. If the control that sets that size then did
     * nothing while the piece was locked, it would read as broken -- the same
     * fault as the pill not resizing at all, wearing a different hat. So the
     * control writes through: it changes the locked size, on every sheet at
     * once, which is what a locked piece means.
     */
    function pushPieceScale(which, scale) {
      var flApi = window.ToolboxReportFloorLayout;
      if (!flApi || !isFinite(scale) || scale <= 0) return false;
      var key = which === 'pill' ? 'pillLock' : 'legendLock';
      var next = flApi.normalizeLayout(floorLayout);
      var was = next[key] && next[key].scale;
      if (was === scale) return false;
      // One size for this piece, held by the report. The field name still
      // says lock because that is what saved reports carry; what it holds is
      // the size. It used to be written onto each slide in turn, and only
      // onto the slides whose own copy said locked.
      next[key] = { locked: true, scale: scale };
      putFloorLayout(next);
      markDirty();
      return true;
    }

    /**
     * The report's one floor layout, written.
     *
     * Where the legend sits, where the readings sit, where the aerial sits,
     * how the plan is framed and how big each piece is drawn: one record,
     * held by the report, read by every Floor Survey slide. Moving a piece on
     * any slide moves it on all of them, because they are all drawing this.
     */
    /**
     * Pin the size of each chrome piece into the record, once.
     *
     * Missing sizes get sheet code defaults (legend from the view or 1;
     * pill from CHROME_SCALE ≡ 32px). Existing positive scales are left
     * alone so reopen never resets a saved report. Never seeds from
     * device-global capture localStorage.
     */
    function seedPieceSizes(firstFloor) {
      var flApi = window.ToolboxReportFloorLayout;
      if (!flApi || !firstFloor) return;
      var next = flApi.normalizeLayout(floorLayout);
      var changed = false;
      if (!next.legendLock || !(Number(next.legendLock.scale) > 0)) {
        var view = floorViewFor(firstFloor);
        var n = Number(view && view.legendScale);
        next.legendLock = { locked: true, scale: (isFinite(n) && n > 0) ? n : 1 };
        changed = true;
      }
      if (!next.pillLock || !(Number(next.pillLock.scale) > 0)) {
        next.pillLock = { locked: true, scale: defaultPillLockScale() };
        changed = true;
      }
      if (!changed) return;
      putFloorLayout(next);
      markDirty();
    }

    var seededPieces = false;

    function putFloorLayout(next) {
      if (!next) return;
      var flApi = window.ToolboxReportFloorLayout;
      floorLayout = flApi ? flApi.normalizeLayout(next) : next;
      pages.forEach(function (fp) {
        if (!fp || fp.type !== 'floor') return;
        // A slide placed on its own is not following the shared record any
        // more, so it is not restamped from it.
        if (fp.meta && fp.meta.ownLayout) return;
        fp._bookFloorLayout = floorLayout;
      });
    }

    /** Is this slide placed on its own, rather than following the report? */
    function floorSlideOnItsOwn(page) {
      return !!(page && page.meta && page.meta.ownLayout);
    }

    /**
     * The way a slide's placement is written, which depends on whose it is.
     *
     * One record is the rule, and a Combined figure is the reason there is an
     * exception: it carries no colour scale and no readings pill -- that was
     * settled, they go in the rail -- so its whole left column is free and the
     * plan wants to sit in the middle of it rather than clear of chrome that
     * is not on the page. Tim: "on the combined view, I would probably put it
     * more towards the middle ... I don't have contours or pills to show."
     *
     * It is never automatic. A slide goes on its own because it was put
     * there, it says so while it is, and it can be put back. And when it IS
     * on its own it falls back to the shared record, never to the factory
     * default -- that default is what put an aerial in the corner of a slide
     * nobody had touched.
     */
    function putFloorLayoutFor(page) {
      return function (next) {
        if (!next) return;
        var flApi = window.ToolboxReportFloorLayout;
        if (!floorSlideOnItsOwn(page)) {
          putFloorLayout(next);
          return;
        }
        page.meta.ownLayout = flApi ? flApi.normalizeLayout(next) : next;
        page._bookFloorLayout = page.meta.ownLayout;
      };
    }

    /** Take this slide off the shared placement, or put it back on it. */
    function setFloorSlideOnItsOwn(page, onItsOwn) {
      if (!page || page.type !== 'floor') return;
      var flApi = window.ToolboxReportFloorLayout;
      page.meta = page.meta || {};
      if (onItsOwn) {
        if (page.meta.ownLayout) return;
        // Seeded from what the slide is showing RIGHT NOW, so nothing moves
        // at the moment it is taken off.
        page.meta.ownLayout = flApi
          ? flApi.cloneLayout(page._bookFloorLayout || floorLayout)
          : (page._bookFloorLayout || floorLayout);
        page._bookFloorLayout = page.meta.ownLayout;
      } else {
        if (!page.meta.ownLayout) return;
        delete page.meta.ownLayout;
        page._bookFloorLayout = floorLayout;
      }
      page._putFloorLayout = putFloorLayoutFor(page);
      markDirty();
      renderPages();
      flushSave().catch(function () {});
    }

    function floorViewFor(page, slot) {
      var at = typeof slot === 'number' ? slot : floorSlot(page);
      var view = floorViewSpec(page, at);
      var base = null;
      if (view && view.settings && typeof view.settings === 'object') {
        base = view.settings;
      } else {
        var meta = (page && page.meta) || {};
        if (at === 1) base = meta.floorView2 || meta.floorView || floorView;
        else if (meta.floorView) base = meta.floorView;
        else base = floorView;
      }
      // GPT-030/031: never hand the rail a null settings object (defaults would
      // advertise Legend=true while multi-view views[] chrome is off). Always
      // return an object, and pin showLegend / showStatsPill to views[].
      var synced = Object.assign({}, (base && typeof base === 'object') ? base : {});
      if (view) {
        if (typeof view.showLegend === 'boolean') synced.showLegend = view.showLegend;
        if (typeof view.showPill === 'boolean') synced.showStatsPill = view.showPill;
      }
      return synced;
    }
    function setFloorViewFor(page, next, slot) {
      if (!page) {
        floorView = next;
        return;
      }
      page.meta = page.meta || {};
      var at = typeof slot === 'number' ? slot : floorSlot(page);
      var viewsApi = window.ToolboxReportFloorViews;
      if (viewsApi) {
        var list = viewsApi.ensurePageViews(page);
        if (list[at]) {
          var stored = next;
          // GPT-030/031: views[] owns report legend/pill. TopoTab update() sends
          // one intentional patch at a time on top of resolved settings that
          // already mirror views[] via floorViewFor — so a showLegend /
          // showStatsPill delta vs views[] is a deliberate switch, even on a
          // fresh/null/sparse settings object. Contours/Readings patches keep
          // the same chrome in resolved, so they do not move views[].
          if (next && typeof next === 'object') {
            stored = Object.assign({}, next);
            if (typeof next.showLegend === 'boolean'
                && typeof list[at].showLegend === 'boolean'
                && next.showLegend !== list[at].showLegend) {
              list[at].showLegend = next.showLegend;
            }
            if (typeof next.showStatsPill === 'boolean'
                && typeof list[at].showPill === 'boolean'
                && next.showStatsPill !== list[at].showPill) {
              list[at].showPill = next.showStatsPill;
            }
            if (typeof list[at].showLegend === 'boolean') {
              stored.showLegend = list[at].showLegend;
            }
            if (typeof list[at].showPill === 'boolean') {
              stored.showStatsPill = list[at].showPill;
            }
          }
          list[at].settings = stored;
          // Keep legacy fields in sync for older readers / migration safety.
          if (at === 0) page.meta.floorView = stored;
          if (at === 1) page.meta.floorView2 = stored;
          return;
        }
      }
      if (at === 1) {
        page.meta.floorView2 = next;
        return;
      }
      page.meta.floorView = next;
      // Deliberately NOT written back to the document default. A slide that
      // has not been given its own rendition reads that default, so pushing
      // one slide's change into it would carry straight through to every
      // other slide -- which is the behaviour being fixed. The default stays
      // the baseline a slide opens at.
    }

    /**
     * Ordinary one-view figures share the book camera (GPT-028).
     * Multi-view: same-source LINKED companions share it; size-linked
     * different floors and unlinked same-source stay on view.camera (GPT-027).
     */
    function viewUsesSharedBookCamera(page, slot) {
      var viewsApi = window.ToolboxReportFloorViews;
      var list = viewsApi ? viewsApi.viewsFor(page) : floorViewsForPage(page);
      if (!list || list.length <= 1) return true;
      if (!viewsApi || typeof viewsApi.linkedSameSourceIndexes !== 'function') return false;
      return viewsApi.linkedSameSourceIndexes(list, Number(slot) || 0).length > 0;
    }

    function cameraForView(page, slot) {
      var view = floorViewSpec(page, slot);
      if (!view) return floorCamera;
      if (viewUsesSharedBookCamera(page, slot)) {
        return floorCamera || view.camera || null;
      }
      return view.camera || floorCamera;
    }
    // Whether the frame has been given the plan's proportion yet. Once it has,
    // the frame is whatever it has been dragged to and is never re-fitted.
    var floorFramed = false;
    var coverOverviewUrl = '';
    var floorDrag = null;
    var coverDrag = null;
    var discDrag = null;
    var penDrag = null;
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
    var penContourBtn = root.querySelector('#rb-penlog-contour');
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

    // One place that says "something changed", so no edit can set `dirty`
    // without also moving the counter a save is checked against.
    function noteEdit() {
      editSeq += 1;
      dirty = true;
    }

    function markDirty() {
      recordHistory();
      noteEdit();
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

    function flushSave(opts) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      if (!dirty || !workingRecord || !customerFileId) return Promise.resolve();
      if (!window.ToolboxDB || typeof window.ToolboxDB.saveCustomerFile !== 'function') {
        return Promise.reject(new Error('Customer File save is not available.'));
      }
      // The edit this save is carrying. Everything below is a snapshot of it.
      var savedSeq = editSeq;
      var drain = !!(opts && opts.drain);
      var drainPass = drain ? ((opts && opts._drainPass) || 0) + 1 : 0;
      var doc = persistableDocument(
        pages,
        activeId,
        workingRecord && (workingRecord.reportBuilder || workingRecord.report),
        floorLayout,
        coverLayout,
        brandBox,
        floorCamera,
        floorView,
        floorFramed,
        discussionBox,
        penLogBoxLayout,
        reportNorth,
        draftStamp
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
          if (editSeq !== savedSeq) {
            // Typed while this was in flight. What went down is already
            // behind the screen, so the document stays dirty and the status
            // does not claim otherwise. markDirty armed a timer for the
            // newer text; re-arm if some other path cleared it, so the
            // latest edit is written whatever happens next.
            lastSavedAt = doc.updatedAt;
            setSaveStatus('Edited');
            if (draftEl) draftEl.textContent = 'Edited';
            // GPT-035: Refresh drain writes the newer snapshot before reload.
            if (drain) {
              if (drainPass > 20) {
                throw new Error('Save could not finish before refresh');
              }
              return flushSave({ drain: true, _drainPass: drainPass });
            }
            if (!saveTimer) {
              saveTimer = setTimeout(function () {
                flushSave().catch(function () {});
              }, AUTOSAVE_DELAY_MS);
            }
            return;
          }
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
      noteEdit();
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
      if (penContourBtn) {
        var hasContour = !!(page.evidence && page.evidence.contour);
        var showing = penLogShowsContour(page);
        penContourBtn.hidden = !hasContour;
        penContourBtn.textContent = showing ? 'Contours on' : 'Contours off';
        penContourBtn.className = 'btn rb-ws__btn ' + (showing ? 'btn--accent' : 'btn--secondary');
        penContourBtn.setAttribute('data-rb-penlog-contour', showing ? 'off' : 'on');
        penContourBtn.setAttribute('aria-pressed', showing ? 'true' : 'false');
      }
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

    // Typing into a note changes how tall its row is, which changes how many
    // rows fit, which can add or drop a sheet -- but not on every keystroke,
    // which would take the caret with it. It settles once typing pauses, the
    // same way the discussion chain does.
    var penReflowTimer = null;

    function schedulePenLogReflow() {
      if (penReflowTimer) window.clearTimeout(penReflowTimer);
      penReflowTimer = window.setTimeout(function () {
        penReflowTimer = null;
        if (!reflowPenLog()) return;
        renderPages();
        flushSave().catch(function () {});
      }, 700);
    }

    penLogUi.onNote = function (id, value, source) {
      applyPenLogNote(id, value, source);
      var noteEl = root.querySelector('.rb-penlog__note[data-pin-id="' + id + '"]');
      if (penNoteField && penNoteField.getAttribute('data-pin-id') === id && document.activeElement !== penNoteField) {
        penNoteField.value = value || '';
      }
      if (noteEl && document.activeElement !== noteEl) noteEl.value = value || '';
      schedulePenLogReflow();
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

    // Leaving takes this visit's own state with it.
    //
    // thumbCache holds a rendered miniature of every page: detached screens,
    // each with its photographs, its compass and the rest of its drawing
    // still in them. floorShots holds a picture of every Floor Survey drawing
    // that has been looked at. Both belong to one visit, and unmount is a
    // module-level function that cannot see inside a mount -- so the mount
    // hands it the way to clear them. Measured before this: a job with twelve
    // photographs cost about a megabyte every time Report Builder was opened
    // and left, with a whole screen's worth of elements retained each time.
    mountCleanup = function () {
      Object.keys(thumbCache).forEach(function (key) { delete thumbCache[key]; });
      Object.keys(floorShots).forEach(function (key) { delete floorShots[key]; });
      if (floorShotTimer) {
        clearTimeout(floorShotTimer);
        floorShotTimer = null;
      }
    };

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
    var THUMB_SHEET_W = PAPER_W;
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
      // The survey date lives in Floor Survey and can be set after the report
      // was assembled, so it is read from the record on every render rather
      // than from what the page happened to capture.
      var liveDate = '';
      try {
        var fsRoot = workingRecord && workingRecord.floorSurvey;
        if (fsRoot && typeof fsRoot.inspectionDate === 'string') liveDate = fsRoot.inspectionDate;
      } catch (err) { liveDate = ''; }
      pages.forEach(function (p) { p._surveyDate = liveDate; });
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
        var curOwn = current.meta && current.meta.ownLayout;
        current._bookFloorLayout = curOwn
          ? (window.ToolboxReportFloorLayout
            ? window.ToolboxReportFloorLayout.normalizeLayout(curOwn)
            : curOwn)
          : floorLayout;
        current._putFloorLayout = putFloorLayoutFor(current);
        if (current.meta && current.meta.layout) delete current.meta.layout;
      }
      // Stamped on every page that needs it, not only on the one being
      // looked at. The print deck renders the same page objects, and a value
      // only the active page carried was missing from the printed sheet:
      // a Discussion printed as a blank sheet whenever the investigator had
      // moved to another slide before pressing Print.
      pages.forEach(function (item) {
        if (!item) return;
        if (item.type === 'cover') {
          item._coverLayout = coverLayout;
          item._overviewUrl = coverOverviewUrl;
        } else if (item.type === 'section' && item.meta &&
                   item.meta.sectionId === 'discussion') {
          item._facts = discussionFacts(item);
          item._discussionBox = discussionBox;
        } else if (isPenLogPage(item)) {
          item._penLogLayout = penLogBoxLayout;
        }
      });
      // The cover's aerial view belongs to the book, not to the cover, so
      // every Floor Survey page is handed it too -- the stamps as well as the
      // sheet, or the preview would disagree with the page it is a preview
      // of. Settled Oct 10, 2026.
      (pages || []).forEach(function (item) {
        if (!item) return;
        // Tim, Oct 23, 2026: "more on the discussion page as opposed to
        // every page." One switch, and it lands where the writing is.
        item._draftStamp = draftStamp && isDiscussionPage(item);
        // Which way north is on this level — Distress's frontDoorToNorthRotation
        // — on every drawing of the building (Floor and Picture Locations).
        // renderSheet / the rail run outside this closure.
        if (item.type === 'floor' || item.type === 'distress') {
          if (typeof reportNorth === 'number') {
            item._northRotation = reportNorth;
          } else {
            // The first drawing whose front door can actually be READ sets
            // north for the book. One building has one front door; the
            // per-canvas facing is Plan Setup's and only the level being
            // worked on is ever set, which is why the arrow pointed four
            // ways in one report.
            //
            // A rotation that could not be worked out must not latch. The
            // first render runs before the Customer File is in hand, so a
            // latched fallback pinned every drawing in the book at 0 -- due
            // south -- however the door actually faced. That is the arrow
            // being wrong on an east-facing house.
            var seeded = northRotationFor(item, workingRecord);
            if (typeof seeded === 'number') reportNorth = seeded;
            item._northRotation = typeof seeded === 'number' ? seeded : 0;
          }
          if (item.meta && typeof item.meta.northRotation === 'number') {
            delete item.meta.northRotation;
          }
        }
        if (item.type !== 'floor') return;
        item._overviewUrl = coverOverviewUrl;
        // The book's framing and chrome placement, on EVERY floor slide and
        // not only the one being looked at. Without it renderSheet falls
        // through to defaultLayout(), so the printed deck drew every slide
        // the investigator was not sitting on at the default frame: the plan
        // scaled up until it ran off the sheet, and the colour scale, the
        // pill and the aerial view each back in a default corner, on top of
        // the drawing. Same fault the Discussion had, same cure.
        if (!seededPieces) {
          seededPieces = true;
          seedPieceSizes(item);
        }
        // The report's placement, unless this slide was deliberately taken
        // off it. ownLayout is only ever there because somebody put it there.
        var ownLayout = item.meta && item.meta.ownLayout;
        item._bookFloorLayout = ownLayout
          ? (window.ToolboxReportFloorLayout
            ? window.ToolboxReportFloorLayout.normalizeLayout(ownLayout)
            : ownLayout)
          : floorLayout;
        item._putFloorLayout = putFloorLayoutFor(item);
        // Any copy a slide was saved with under the OLD model is dead weight
        // now and would only be a second answer waiting to be read again.
        // ownLayout is not that: it is a placement asked for by hand.
        if (item.meta && item.meta.layout) delete item.meta.layout;
        // How big the colour scale is drawn on the page. It is the slide's
        // own Legend size -- the same control that sizes it on the Floor
        // Survey screen -- and renderSheet runs outside this closure, so it
        // is handed over on the page like the aerial view is.
        item._floorView = floorViewFor(item);
      });
      // The colour scales, painted by Floor Survey. Asked for after the view
      // settings are on the pages, because they are part of what the scale is
      // drawn from.
      ensureFloorLegends(customerFileId, pages, renderPages);
      if (current) current._brandBox = currentBrandBox(current);
      // Only the slide being looked at hosts the live view; the others are not
      // in the DOM. The camera is the book's, so every level opens framed the
      // same way, and a change to it is stored for the book rather than the
      // slide.
      if (current && current.type === 'floor' && current.meta && current.meta.imported &&
          window.ToolboxFloorSurvey) {
        // Ensure views[] exists (migrates legacy two-up) before mounting hosts.
        floorViewsForPage(current);
        current._mountTopo = function (page, slot) {
          var at = Number(slot) || 0;
          var view = floorViewSpec(page, at);
          if (!(view && view.canvasId) && !(page.meta && page.meta.canvasId)) return null;
          return mountTopoHost(page, at, {
            customerFileId: customerFileId,
            camera: cameraForView(page, at),
            settings: floorViewFor(page, at),
            hostStatsPillPx: pillPxFromLayout(
              (page && page._bookFloorLayout) || floorLayout),
            // Never locked. The drawing is panned and zoomed like the
            // workspace it came from, on every slide.
            //
            // A report saved while Lock layout existed still carries
            // floorCamera.locked on it. That flag reaches PlanCanvas as
            // frozen, which stops the pan AND takes away the corner handles.
            // Removing the Lock button without clearing the flag left those
            // reports with a drawing that could not be moved or resized and
            // no control left to release it.
            locked: false,
            onCameraChange: function (camera, from) {
              var viewsApi = window.ToolboxReportFloorViews;
              var list = viewsApi ? viewsApi.viewsFor(page) : [];
              var fromView = list[Number(from) || 0] || null;
              var cam = {
                cx: camera.cx, cy: camera.cy, zoom: camera.zoom,
                rel: !!camera.rel,
              };
              // Persist onto the live view object (stable identity after GPT-027).
              function writeViewCamera(target) {
                if (!target) return;
                if (!target.camera || typeof target.camera !== 'object') target.camera = {};
                target.camera.cx = cam.cx;
                target.camera.cy = cam.cy;
                target.camera.zoom = cam.zoom;
                target.camera.rel = !!cam.rel;
              }
              var linkedSame = (fromView && viewsApi &&
                typeof viewsApi.linkedSameSourceIndexes === 'function')
                ? viewsApi.linkedSameSourceIndexes(list, Number(from) || 0)
                : [];
              // GPT-028: ordinary one-view figures update the shared book camera.
              // Multi-view shares it only with same-source linked companions.
              // Cross-source size-link / unlinked same-source stay independent.
              var shareBook = (list.length <= 1) || linkedSame.length > 0;
              if (shareBook) {
                var same = !!floorCamera &&
                  Math.abs((floorCamera.cx || 0) - (cam.cx || 0)) < 1e-4 &&
                  Math.abs((floorCamera.cy || 0) - (cam.cy || 0)) < 1e-4 &&
                  Math.abs((floorCamera.zoom || 0) - (cam.zoom || 0)) < 1e-4;
                if (same) return;
                floorCamera = cam;
                writeViewCamera(fromView);
                linkedSame.forEach(function (si) { writeViewCamera(list[si]); });
                if (linkedSame.length) {
                  pushCameraToTopoHosts(floorCamera, from, linkedSame);
                }
                markDirty();
                return;
              }
              // Deliberately independent composition — do not touch floorCamera.
              var prev = fromView && fromView.camera;
              var sameV = !!prev &&
                Math.abs((prev.cx || 0) - (cam.cx || 0)) < 1e-4 &&
                Math.abs((prev.cy || 0) - (cam.cy || 0)) < 1e-4 &&
                Math.abs((prev.zoom || 0) - (cam.zoom || 0)) < 1e-4;
              if (sameV) return;
              writeViewCamera(fromView);
              markDirty();
            },
              onSettingsChange: function (next, from) {
              setFloorViewFor(page, next, Number(from) || 0);
              markDirty();
            },
            // The rail's readings and the pill over the plan are the same
            // numbers, so they come from the same place: whatever the drawing
            // is drawing right now. Read from evidence stored at import, the
            // rail said 9.40 / 8.10 beside a pill reading 9.80 / 8.20.
            onStats: function (stats, from) {
              var live = Array.isArray(stats) ? stats : [];
              page._viewStats = page._viewStats || {};
              // Keep the boundary array; layout picks the stats object for the pill.
              page._viewStats[Number(from) || 0] = live;
              // Rail quotes the selected view.
              if ((Number(from) || 0) !== floorSlot(page)) return;
              var before = JSON.stringify(page._liveStats || null);
              if (before === JSON.stringify(live)) return;
              page._liveStats = live;
              var railEl = sheetEl && sheetEl.querySelector('.rb-rail__rail');
              var next = railForPage(page, { noteEditable: true });
              if (railEl && next) sheetEl.replaceChild(next, railEl);
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
              // Into the one record, which every slide is already reading.
              // It used to be written onto each slide as well, and the record
              // was then thrown away and rebuilt from the frame alone, losing
              // wherever the aerial and the chrome had been put.
              var framed = flApi.normalizeLayout(floorLayout);
              framed.topo = frame;
              putFloorLayout(framed);
              markDirty();
              renderPages();
              flushSave().catch(function () {});
            },
          });
        };
      } else {
        releaseTopoHosts();
      }
      renderSheet(sheetEl, current, pages);
      syncPenLogPanel(current);
      fitSheet(root);
      // The sheet is rebuilt on every render, so the box being worked on has
      // to be marked again or the pulls disappear mid-drag.
      if (typeof paintCoverSelection === 'function') paintCoverSelection();
      // A Floor Survey slide's drawing is live and belongs to the slide being
      // looked at, so its preview is a picture taken while it is on screen.
      scheduleFloorShot(current);
      if (penLogUi.layout && typeof penLogUi.layout.layout === 'function') {
        window.requestAnimationFrame(function () {
          if (penLogUi.layout && typeof penLogUi.layout.layout === 'function') {
            penLogUi.layout.layout();
          }
          // How many rows fit can only be answered once the sheet is drawn at
          // its real size, so the split is settled on the frame after the
          // page appears rather than when it is built. It reports no change
          // the second time round, so the re-render it asks for does not come
          // back again.
          if (isPenLogPage(current) && reflowPenLog()) {
            renderPages();
            flushSave().catch(function () {});
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

    /**
     * The way back to the application this sheet came from.
     *
     * Every sheet that owns a source gets one, which is what the rail is for:
     * a Pictures sheet and a Picture Locations sheet come from Distress
     * Survey, a Floor Survey sheet from Floor Survey. Only the Floor Survey
     * sheet had one, so from the other two the only way back was the
     * browser's Back button -- and the return the Distress copy offers
     * ("Return to report") had nothing to start it. The foot is cleared on
     * every slide, so a Pictures sheet cannot be left showing the Floor
     * Survey button belonging to the slide before it.
     */
    function setRailFootSource(key) {
      if (!railFootEl) return;
      railFootEl.textContent = '';
      // GPT-036: composition controls live under Sheet Layout in the body,
      // not jammed into the foot under Topo. Foot keeps the way back only.
      railFootEl.appendChild(railButton(
        key === 'floor' ? 'Open Floor Survey' : 'Open Distress Survey',
        'secondary', 'data-rb-source', key));
      var footHint = document.createElement('p');
      footHint.className = 'rb-panel__lead';
      footHint.textContent = 'For changes other than formatting.';
      railFootEl.appendChild(footHint);
    }

    // GPT-036: peer task tabs for Floor Survey sheets. Session-only; switching
    // tools must not clear selection, camera, or saved layout.
    var floorTaskTab = 'layout';
    // Second tier under Topo. Session-only, same rule: tools only.
    var floorTopoGroup = 'contours';

    function buildFloorTaskTabs() {
      var row = document.createElement('div');
      row.className = 'rb-ws__task-tabs';
      row.setAttribute('role', 'tablist');
      row.setAttribute('aria-label', 'Floor Survey sidebar');
      [
        ['layout', 'Sheet Layout'],
        ['topo', 'Topo'],
      ].forEach(function (pair) {
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rb-ws__task-tab' + (floorTaskTab === pair[0] ? ' is-active' : '');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('data-rb-floor-task', pair[0]);
        btn.setAttribute('aria-selected', floorTaskTab === pair[0] ? 'true' : 'false');
        btn.textContent = pair[1];
        row.appendChild(btn);
      });
      return row;
    }

    var FLOOR_TOPO_GROUPS = [
      ['contours', 'Contours'],
      ['readings', 'Readings'],
      ['legendhl', 'Legend & H/L'],
    ];

    function buildFloorTopoSubtabs() {
      var row = document.createElement('div');
      row.className = 'rb-ws__subtabs';
      row.setAttribute('role', 'tablist');
      row.setAttribute('aria-label', 'Topo controls');
      FLOOR_TOPO_GROUPS.forEach(function (pair) {
        var on = floorTopoGroup === pair[0];
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'rb-ws__subtab' + (on ? ' is-active' : '');
        btn.setAttribute('role', 'tab');
        btn.setAttribute('data-rb-rail-tab', pair[0]);
        btn.setAttribute('data-rb-topo-group', pair[0]);
        btn.id = 'rb-topo-tab-' + pair[0];
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        btn.setAttribute('aria-controls', 'rb-topo-group-panel');
        btn.tabIndex = on ? 0 : -1;
        btn.textContent = pair[1];
        row.appendChild(btn);
      });
      row.addEventListener('keydown', function (event) {
        var keys = FLOOR_TOPO_GROUPS.map(function (pair) { return pair[0]; });
        var idx = keys.indexOf(floorTopoGroup);
        if (idx < 0) idx = 0;
        var next = idx;
        if (event.key === 'ArrowRight') next = (idx + 1) % keys.length;
        else if (event.key === 'ArrowLeft') next = (idx + keys.length - 1) % keys.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = keys.length - 1;
        else return;
        event.preventDefault();
        floorTopoGroup = keys[next];
        var taskPage = activePage();
        if (taskPage) syncRail(taskPage);
        var focusBtn = railTopEl && railTopEl.querySelector(
          '[data-rb-topo-group="' + floorTopoGroup + '"]');
        if (focusBtn && focusBtn.focus) focusBtn.focus();
      });
      return row;
    }

    function floorSourceLabel(view, page) {
      var srcName = '';
      if (view && workingRecord && window.ToolboxPlanSetup) {
        try {
          var cv = window.ToolboxPlanSetup.canvasById(workingRecord, view.canvasId);
          srcName = (cv && cv.name) || '';
        } catch (err) { srcName = ''; }
      }
      if (!srcName && page) srcName = page.railLabel || page.title || '';
      return srcName;
    }

    function appendFloorSourcePicker(wrap, page, activeView) {
      var srcLabel = document.createElement('label');
      srcLabel.className = 'rb-panel__lead';
      srcLabel.textContent = 'View source (selected view)';
      wrap.appendChild(srcLabel);
      var srcSelect = document.createElement('select');
      srcSelect.className = 'rb-rail__select';
      srcSelect.setAttribute('data-rb-floor-view-source', '1');
      var seenSrc = Object.create(null);
      function addSourceOption(canvasId, epochId, areaId, scope, label) {
        var key = [canvasId || '', epochId || '', areaId || '', scope || 'all'].join('|');
        if (!canvasId || seenSrc[key]) return;
        seenSrc[key] = 1;
        var opt = document.createElement('option');
        opt.value = key;
        opt.textContent = label || 'Level';
        if (activeView &&
            String(activeView.canvasId || '') === String(canvasId || '') &&
            String(activeView.areaId || '') === String(areaId || '') &&
            String(activeView.scope || 'all') === String(scope || 'all')) {
          opt.selected = true;
        }
        srcSelect.appendChild(opt);
      }
      var fs = workingRecord && workingRecord.floorSurvey;
      var byCanvas = (fs && fs.byCanvasId) || {};
      var canvases = (workingRecord && workingRecord.planSetup && workingRecord.planSetup.canvases) || [];
      canvases.forEach(function (cv) {
        if (!cv || !cv.id) return;
        var layer = byCanvas[cv.id] || null;
        var areas = (layer && Array.isArray(layer.areas)) ? layer.areas : [];
        if (areas.length) {
          addSourceOption(cv.id, fs && fs.id, null, 'all',
            (cv.name || 'Level') + ' — Combined');
          areas.forEach(function (area) {
            if (!area || !area.id) return;
            addSourceOption(cv.id, fs && fs.id, area.id, 'area',
              (cv.name || 'Level') + ' — ' + (area.name || 'Boundary'));
          });
        } else {
          addSourceOption(cv.id, fs && fs.id, null, 'all', cv.name || 'Level');
        }
      });
      if (!srcSelect.options.length) {
        pages.forEach(function (fp) {
          if (!fp || fp.type !== 'floor' || !fp.meta || fp.meta.reserved) return;
          var m = fp.meta;
          addSourceOption(m.canvasId, m.epochId, m.areaId, m.scope || 'all',
            fp.railLabel || fp.title || m.levelName || 'Level');
        });
      }
      wrap.appendChild(srcSelect);
    }

    function buildFloorLayoutBody(page) {
      var wrap = document.createDocumentFragment();
      var onItsOwn = floorSlideOnItsOwn(page);
      var sheetHead = document.createElement('p');
      sheetHead.className = 'rb-ws__section-label';
      sheetHead.textContent = 'Sheet-wide';
      wrap.appendChild(sheetHead);
      var lockHint = document.createElement('p');
      lockHint.className = 'rb-panel__lead';
      lockHint.setAttribute('data-rb-floor-own-hint', onItsOwn ? 'own' : 'share');
      lockHint.textContent = onItsOwn
        ? 'This slide only — moving the plan, colour scale, readings or aerial '
          + 'here changes this slide alone.'
        : 'Shared placement — the plan, colour scale, readings and aerial sit in '
          + 'one place on every Floor Survey slide. Contours and palette stay per slide.';
      wrap.appendChild(lockHint);
      wrap.appendChild(railButton(
        onItsOwn ? 'Shared placement' : 'This slide only',
        onItsOwn ? 'secondary' : 'quiet',
        'data-rb-floor-own', onItsOwn ? 'share' : 'own'));

      var viewsNow = floorViewsForPage(page);
      var activeView = floorViewSpec(page, floorSlot(page));
      var viewHead = document.createElement('p');
      viewHead.className = 'rb-ws__section-label';
      viewHead.textContent = 'Selected view';
      wrap.appendChild(viewHead);
      var viewLead = document.createElement('p');
      viewLead.className = 'rb-panel__lead';
      viewLead.setAttribute('data-rb-floor-view-lead', '1');
      var srcName = floorSourceLabel(activeView, page);
      viewLead.textContent = viewsNow.length > 1
        ? ('View ' + (floorSlot(page) + 1) + ' of ' + viewsNow.length
          + (srcName ? (' — ' + srcName) : '')
          + '. Source, size link and Remove apply to it.')
        : 'One view on this sheet. Add or copy a view to compose.';
      wrap.appendChild(viewLead);
      wrap.appendChild(railButton('Add view', 'quiet', 'data-rb-floor-view', 'add'));
      wrap.appendChild(railButton('Copy view', 'quiet', 'data-rb-floor-view', 'copy'));
      if (viewsNow.length > 1) {
        wrap.appendChild(railButton('Remove view', 'quiet', 'data-rb-floor-view', 'remove'));
        var linked = !!(activeView && activeView.linkGroup);
        wrap.appendChild(railButton(
          linked ? 'Unlink size' : 'Link size',
          'quiet', 'data-rb-floor-view-link', linked ? 'off' : 'on'));
      }
      appendFloorSourcePicker(wrap, page, activeView);
      return wrap;
    }

    function buildFloorTopoIdentity(page) {
      var wrap = document.createDocumentFragment();
      var viewsNow = floorViewsForPage(page);
      var activeView = floorViewSpec(page, floorSlot(page));
      var srcName = floorSourceLabel(activeView, page);
      var lead = document.createElement('p');
      lead.className = 'rb-panel__lead';
      lead.setAttribute('data-rb-floor-topo-lead', '1');
      if (!activeView) {
        lead.textContent = 'No topo view on this sheet.';
      } else if (viewsNow.length > 1) {
        lead.textContent = 'Selected: View ' + (floorSlot(page) + 1) + ' of ' + viewsNow.length
          + (srcName ? (' — ' + srcName) : '')
          + '. Contours / Readings / Legend & H/L apply to it.';
      } else {
        lead.textContent = (srcName ? (srcName + ' — ') : '')
          + 'Contours / Readings / Legend & H/L for this view.';
      }
      wrap.appendChild(lead);
      if (viewsNow.length > 1 && activeView) {
        wrap.appendChild(railButton(
          activeView.showLegend ? 'Hide legend' : 'Show legend',
          'quiet', 'data-rb-floor-view-chrome', activeView.showLegend ? 'legend-off' : 'legend-on'));
        wrap.appendChild(railButton(
          activeView.showPill ? 'Hide H/L/Δ' : 'Show H/L/Δ',
          'quiet', 'data-rb-floor-view-chrome', activeView.showPill ? 'pill-off' : 'pill-on'));
      }
      return wrap;
    }

    function syncRail(page) {
      if (!railEl) return;
      if (page && page.type === 'cover') {
        releaseRailControls();
        railEl.hidden = false;
        if (railIdleEl) railIdleEl.hidden = true;
        if (railTitleEl) railTitleEl.textContent = 'Title page';
        var coverLocked = !!(coverLayout && coverLayout.locked);
        railTopEl.textContent = '';
        railTopEl.appendChild(railButton(
          coverLocked ? 'Unlock layout' : 'Lock layout',
          coverLocked ? 'secondary' : 'accent',
          'data-rb-cover-lock', coverLocked ? 'unlock' : 'lock'));
        var coverHint = document.createElement('p');
        coverHint.className = 'rb-panel__lead';
        coverHint.textContent = coverLocked
          ? 'Title layout locked. Unlock to edit text or move boxes.'
          : 'Edit any text. Drag boxes to place. Resize from the corner.';
        railTopEl.appendChild(coverHint);
        railTopEl.appendChild(railButton(
          'Use this as my default', 'quiet', 'data-rb-template', 'cover'));
        var coverDefaultHint = document.createElement('p');
        coverDefaultHint.className = 'rb-panel__lead';
        coverDefaultHint.textContent = 'New reports start with these boxes where they are here.';
        railTopEl.appendChild(coverDefaultHint);
        if (railBodyEl) railBodyEl.textContent = '';
        if (railFootEl) railFootEl.textContent = '';
        return;
      }
      if (pageTakesBrand(page)) {
        releaseRailControls();
        railEl.hidden = false;
        if (railIdleEl) railIdleEl.hidden = true;
        if (railTitleEl) railTitleEl.textContent = page.type === 'section' ? 'Discussion' : 'Sheet';
        var brandBox = window.ToolboxReportDiscussion
          ? window.ToolboxReportDiscussion.normalizeBrandBox(currentBrandBox(page))
          : (currentBrandBox(page) || {});
        var brandLocked = !!brandBox.locked;
        railTopEl.textContent = '';
        railTopEl.appendChild(railButton(
          brandLocked ? 'Unlock logo' : 'Lock logo',
          brandLocked ? 'secondary' : 'accent',
          'data-rb-brand-lock', brandLocked ? 'unlock' : 'lock'));
        var brandHint = document.createElement('p');
        brandHint.className = 'rb-panel__lead';
        brandHint.textContent = brandLocked
          ? 'The mark is placed. It sits here on every page that carries it.'
          : 'Drag the mark to move it. Drag its corner to size it. Lock when it sits where you want it.';
        railTopEl.appendChild(brandHint);
        // A box dragged small cannot be put back by hand, so the way back to
        // the placement the shipped decks measure is one button. Offered only
        // once it has been moved.
        var discApiRail = window.ToolboxReportDiscussion;
        if (page.type === 'section' && discApiRail &&
            typeof discApiRail.isDefaultBodyBox === 'function' &&
            !discApiRail.isDefaultBodyBox(discussionBox)) {
          railTopEl.appendChild(railButton(
            'Reset writing area', 'quiet', 'data-rb-disc-reset', '1'));
          var resetHint = document.createElement('p');
          resetHint.className = 'rb-panel__lead';
          resetHint.textContent = 'Back to where the reports put it.';
          railTopEl.appendChild(resetHint);
        }
        railTopEl.appendChild(railButton(
          'Use this as my default', 'quiet', 'data-rb-template', 'discussion'));
        var discDefaultHint = document.createElement('p');
        discDefaultHint.className = 'rb-panel__lead';
        discDefaultHint.textContent = 'New reports start with the writing area and the mark where they are here.';
        railTopEl.appendChild(discDefaultHint);
        if (railBodyEl) railBodyEl.textContent = '';
        if (railFootEl) railFootEl.textContent = '';
        return;
      }
      var isPictures = !!(page && page.type === 'pictures');
      if (isPictures) {
        releaseRailControls();
        railEl.hidden = false;
        if (railIdleEl) railIdleEl.hidden = true;
        if (railTitleEl) railTitleEl.textContent = 'Pictures';
        railTopEl.textContent = '';
        var acrossNow = picturesAcross(page);
        // Each button is named for the grid it makes of the pictures on this
        // page -- 5 x 2, 4 x 2, 4 x 1 -- rather than for its number of
        // columns, which is how the sheet is actually thought about.
        var onPage = Math.max(1, picturesOnPage(page));
        var row = document.createElement('div');
        row.className = 'rb-ws__row rb-ws__row--wrap';
        // Every shape, on every slide. A shape is a page capacity now, so
        // the tight ones add sheets instead of crushing one.
        var downNow = picturesDown(page);
        // Two rows at the most, and a single column only on its own: Tim,
        // Oct 20, "one row is acceptable. 5 by 1 ... 1 by 4, 1 by 3, 1 by 2,
        // 1 by 1. The most rows are 2", and on a stacked single column,
        // "1x2 NO."
        PICTURES_ACROSS.forEach(function (cols) {
          var deepest = cols === 1 ? 1 : 2;
          for (var down = 1; down <= deepest; down += 1) {
            var btn = railButton(String(cols) + ' \u00d7 ' + down,
              (cols === acrossNow && down === downNow) ? 'accent' : 'secondary',
              'data-rb-pics-across', cols + 'x' + down);
            row.appendChild(btn);
          }
        });
        railTopEl.appendChild(row);
        var picHint = document.createElement('p');
        picHint.className = 'rb-panel__lead';
        picHint.textContent = 'Across \u00d7 down sets how many a sheet holds. ' +
          'Fewer makes each picture bigger and adds sheets; the pictures flow on.';
        railTopEl.appendChild(picHint);
        if (railBodyEl) railBodyEl.textContent = '';
        setRailFootSource('distress');
        return;
      }
      var isFloor = !!(page && page.type === 'floor' && !(page.meta && page.meta.reserved));
      if (!isFloor) {
        releaseRailControls();
        railEl.hidden = true;
        // A Picture Locations sheet has a workspace -- the Pen Log panel
        // right below -- so telling the investigator to open a slide to see
        // one, directly above the one they are looking at, is noise.
        if (railIdleEl) railIdleEl.hidden = isPenLogPage(page);
        return;
      }
      railEl.hidden = false;
      if (railIdleEl) railIdleEl.hidden = true;
      if (railTitleEl) railTitleEl.textContent = 'Floor Survey';

      var imported = !!(page.meta && page.meta.imported);
      railTopEl.textContent = '';
      if (!imported) {
        releaseRailControls();
        if (railBodyEl) railBodyEl.textContent = '';
        railTopEl.appendChild(
          railButton('Import Floor Survey', 'accent', 'data-rb-floor-import', page.id || ''));
        var hint = document.createElement('p');
        hint.className = 'rb-panel__lead';
        hint.textContent = 'Brings this level onto the slide.';
        railTopEl.appendChild(hint);
        setRailFootSource('floor');
        return;
      }

      // GPT-036: Sheet Layout | Topo peer tabs — one group in the same-width
      // sidebar. Switching tabs changes tools only.
      railTopEl.appendChild(buildFloorTaskTabs());

      var api = window.ToolboxFloorSurvey;
      var meta = page.meta || {};
      var activeSpec = floorViewSpec(page, floorSlot(page));
      var ctrlCanvas = (activeSpec && activeSpec.canvasId) || meta.canvasId || '';
      var ctrlScope = (activeSpec && activeSpec.scope) || meta.scope || 'all';
      var ctrlArea = ctrlScope === 'all' ? null : ((activeSpec && activeSpec.areaId) || meta.areaId || null);
      var key = [page.id, ctrlCanvas, ctrlArea || '', ctrlScope,
        floorSlot(page), activeSpec && activeSpec.id].join('|');

      if (floorTaskTab === 'topo' && ctrlCanvas) {
        railTopEl.appendChild(buildFloorTopoSubtabs());
      }

      if (floorTaskTab === 'layout') {
        releaseRailControls();
        if (railBodyEl) {
          railBodyEl.textContent = '';
          railBodyEl.appendChild(buildFloorLayoutBody(page));
        }
      } else if (railBodyEl) {
        // Rebuild identity + chrome; keep the mounted Topo host when the view
        // key is unchanged so settings state is not torn down on every sync.
        var keepHost = (railControls.el && railControls.key === key) ? railControls.el : null;
        railBodyEl.textContent = '';
        railBodyEl.appendChild(buildFloorTopoIdentity(page));
        if (!api || typeof api.mount !== 'function' || !ctrlCanvas) {
          releaseRailControls();
          var empty = document.createElement('p');
          empty.className = 'rb-panel__lead';
          empty.setAttribute('data-rb-floor-topo-empty', '1');
          empty.textContent = ctrlCanvas
            ? 'Topo controls are unavailable for this view.'
            : 'No topo view to format. Add a view under Sheet Layout, or import a level.';
          railBodyEl.appendChild(empty);
        } else if (keepHost) {
          if (railControls.api && typeof railControls.api.update === 'function') {
            railControls.api.update({
              settings: floorViewFor(page),
              railGroup: floorTopoGroup,
              hostStatsPillPx: pillPxFromLayout(floorLayout),
            });
          }
          railBodyEl.appendChild(keepHost);
        } else {
          releaseRailControls();
          var host = document.createElement('div');
          host.className = 'rb-ws__controls';
          railBodyEl.appendChild(host);
          railControls = { el: host, key: key, api: null };
          railControls.api = api.mount(host, {
            customerFileId: customerFileId,
            workspace: 'report-topo-controls',
            canvasId: ctrlCanvas,
            areaId: ctrlArea,
            settings: floorViewFor(page),
            railGroup: floorTopoGroup,
            hostStatsPillPx: pillPxFromLayout(floorLayout),
            onHostStatsPillPxChange: function (px) {
              var flApi = window.ToolboxReportFloorLayout;
              var chrome = (flApi && Number(flApi.CHROME_SCALE)) || 1;
              var n = Number(px);
              if (!isFinite(n) || n <= 0) return;
              if (pushPieceScale('pill', (n / 32) * chrome)) {
                if (railControls.api && typeof railControls.api.update === 'function') {
                  railControls.api.update({ hostStatsPillPx: pillPxFromLayout(floorLayout) });
                }
                renderPages();
                flushSave().catch(function () {});
              }
            },
            onBack: function () {},
            onSettingsChange: function (next) {
              var live = activePage();
              setFloorViewFor(live, next);
              markDirty();
              pushPieceScale('legend', liveLegendScale());
              var topoHost = topoHosts[floorSlot(live)] || topoHosts[0];
              if (topoHost && topoHost.api && typeof topoHost.api.update === 'function') {
                topoHost.api.update({ settings: next });
              }
              renderPages();
              flushSave().catch(function () {});
            },
          });
        }
      }

      setRailFootSource('floor');
    }

    // The rail's buttons are built per slide, so they are handled by
    // delegation rather than by listeners attached once at mount.
    if (railEl) {
      railEl.addEventListener('click', function (event) {
        var groupBtn = event.target.closest('[data-rb-topo-group]');
        if (groupBtn) {
          event.preventDefault();
          var nextGroup = groupBtn.getAttribute('data-rb-topo-group');
          if (nextGroup !== 'contours' && nextGroup !== 'readings' && nextGroup !== 'legendhl') return;
          if (floorTopoGroup === nextGroup) return;
          floorTopoGroup = nextGroup;
          var groupPage = activePage();
          if (groupPage) syncRail(groupPage);
          return;
        }
        var taskBtn = event.target.closest('[data-rb-floor-task]');
        if (taskBtn) {
          event.preventDefault();
          var nextTask = taskBtn.getAttribute('data-rb-floor-task');
          if (nextTask !== 'layout' && nextTask !== 'topo') return;
          if (floorTaskTab === nextTask) return;
          floorTaskTab = nextTask;
          var taskPage = activePage();
          if (taskPage) syncRail(taskPage);
          return;
        }
        var ownBtn = event.target.closest('[data-rb-floor-own]');
        if (ownBtn) {
          event.preventDefault();
          var ownPage = activePage();
          if (!ownPage || ownPage.type !== 'floor') return;
          setFloorSlideOnItsOwn(ownPage, ownBtn.getAttribute('data-rb-floor-own') === 'own');
          return;
        }
        var templateBtn = event.target.closest('[data-rb-template]');
        if (templateBtn) {
          event.preventDefault();
          var which = templateBtn.getAttribute('data-rb-template');
          var saved;
          if (which === 'cover') {
            saved = saveTemplatePiece({ coverLayout: coverLayout });
          } else if (which === 'floor') {
            // How the building is framed, where the scale and the readings
            // sit on the page, and what is drawn inside the frame.
            saved = saveTemplatePiece({
              floorLayout: floorLayout,
              floorCamera: floorCamera,
              floorView: floorViewFor(activePage()) || floorView,
            });
          } else {
            // What the page is actually showing, not only what was moved: a
            // placement he is happy with as it stands is still the one he
            // means to keep.
            var dTmpl = window.ToolboxReportDiscussion;
            saved = saveTemplatePiece({
              discussionBox: dTmpl ? dTmpl.normalizeBodyBox(discussionBox) : discussionBox,
              brandBox: dTmpl ? dTmpl.normalizeBrandBox(currentBrandBox(activePage())) : brandBox,
            });
          }
          setSaveStatus(saved
            ? 'Saved as the default for new reports.'
            : 'The default could not be saved on this device.');
          return;
        }
        var discReset = event.target.closest('[data-rb-disc-reset]');
        if (discReset) {
          event.preventDefault();
          var dRapi = window.ToolboxReportDiscussion;
          discussionBox = dRapi ? dRapi.defaultBodyBox() : null;
          markDirty();
          if (reflowDiscussion()) flushSave().catch(function () {});
          renderPages();
          flushSave().catch(function () {});
          return;
        }
        var brandLockBtn = event.target.closest('[data-rb-brand-lock]');
        if (brandLockBtn) {
          event.preventDefault();
          var brandPage = activePage();
          if (!brandPage) return;
          var brandApi = window.ToolboxReportDiscussion;
          var brandNext = brandApi
            ? brandApi.normalizeBrandBox(currentBrandBox(brandPage))
            : (currentBrandBox(brandPage) || {});
          brandNext.locked = brandLockBtn.getAttribute('data-rb-brand-lock') === 'lock';
          applyBrandBox(brandNext);
          markDirty();
          renderPages();
          flushSave().catch(function () {});
          return;
        }
        var coverLock = event.target.closest('[data-rb-cover-lock]');
        if (coverLock) {
          event.preventDefault();
          var coverApi = window.ToolboxReportCoverLayout;
          coverLayout = coverApi ? coverApi.normalizeLayout(coverLayout) : coverLayout;
          coverLayout.locked = coverLock.getAttribute('data-rb-cover-lock') === 'lock';
          noteEdit();
          setSaveStatus('Saving…');
          renderPages();
          flushSave().catch(function () {});
          return;
        }
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
          var parts = String(acrossBtn.getAttribute('data-rb-pics-across')).split('x');
          var wantCols = Number(parts[0]);
          var wantRows = Number(parts[1]);
          if (PICTURES_ACROSS.indexOf(wantCols) < 0) return;
          if (!(wantRows >= 1 && wantRows <= MAX_PICTURE_ROWS)) return;
          if (picturesAcross(pic) === wantCols && picturesDown(pic) === wantRows) return;
          if (!repaginatePictures(wantCols, wantRows)) return;
          markDirty();
          renderPages();
          // The sheets changed, so what is on them has to be read again.
          attachEvidence(workingRecord, pages.slice()).then(function (enriched) {
            pages = enriched;
            renderPages();
            flushSave().catch(function () {});
          }).catch(function () { flushSave().catch(function () {}); });
          return;
        }
        var viewBtn = event.target.closest('[data-rb-floor-view]');
        if (viewBtn) {
          event.preventDefault();
          var fp = activePage();
          if (!fp || fp.type !== 'floor') return;
          var viewsApi = window.ToolboxReportFloorViews;
          if (!viewsApi) return;
          var action = viewBtn.getAttribute('data-rb-floor-view');
          viewsApi.ensurePageViews(fp);
          if (action === 'add' || action === 'copy') {
            viewsApi.addView(fp, floorSlot(fp));
            fp._floorSlot = floorSlots(fp) - 1;
          } else if (action === 'remove') {
            viewsApi.removeView(fp, floorSlot(fp));
            fp._floorSlot = Math.min(floorSlot(fp), floorSlots(fp) - 1);
          }
          fp.meta.floorTwoUp = floorSlots(fp) > 1;
          releaseTopoHosts();
          markDirty();
          renderPages();
          flushSave().catch(function () {});
          return;
        }
        var linkBtn = event.target.closest('[data-rb-floor-view-link]');
        if (linkBtn) {
          event.preventDefault();
          var lp = activePage();
          if (!lp || lp.type !== 'floor') return;
          var lApi = window.ToolboxReportFloorViews;
          if (!lApi) return;
          lApi.setViewLink(lp, floorSlot(lp), linkBtn.getAttribute('data-rb-floor-view-link') === 'on');
          markDirty();
          renderPages();
          flushSave().catch(function () {});
          return;
        }
        var chromeBtn = event.target.closest('[data-rb-floor-view-chrome]');
        if (chromeBtn) {
          event.preventDefault();
          var cp = activePage();
          if (!cp || cp.type !== 'floor') return;
          var cv = floorViewSpec(cp, floorSlot(cp));
          if (!cv) return;
          var chromeAct = chromeBtn.getAttribute('data-rb-floor-view-chrome');
          if (chromeAct === 'legend-on') cv.showLegend = true;
          if (chromeAct === 'legend-off') cv.showLegend = false;
          if (chromeAct === 'pill-on') cv.showPill = true;
          if (chromeAct === 'pill-off') cv.showPill = false;
          // Keep settings in lockstep with views[] chrome (GPT-030). Use the
          // full floorViewFor object so a later Legend & H/L switch is a
          // chrome-only delta, not a sparse {showLegend} vs full resolved miss.
          cv.settings = Object.assign({}, floorViewFor(cp) || {}, cv.settings || {});
          cv.settings.showLegend = !!cv.showLegend;
          cv.settings.showStatsPill = !!cv.showPill;
          markDirty();
          renderPages();
          flushSave().catch(function () {});
          return;
        }
        // Legacy two-up control (tests / old UI) — maps onto Add/Remove view.
        var twoBtn = event.target.closest('[data-rb-floor-twoup]');
        if (twoBtn) {
          event.preventDefault();
          var tp = activePage();
          if (!tp || tp.type !== 'floor') return;
          var tApi = window.ToolboxReportFloorViews;
          if (!tApi) return;
          tApi.ensurePageViews(tp);
          var on = twoBtn.getAttribute('data-rb-floor-twoup') === 'on';
          if (on && floorSlots(tp) < 2) {
            tApi.addView(tp, 0);
            tp._floorSlot = 1;
          } else if (!on && floorSlots(tp) > 1) {
            while (floorSlots(tp) > 1) tApi.removeView(tp, floorSlots(tp) - 1);
            tp._floorSlot = 0;
          }
          tp.meta.floorTwoUp = floorSlots(tp) > 1;
          releaseTopoHosts();
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

      railEl.addEventListener('change', function (event) {
        var srcSel = event.target && event.target.closest
          ? event.target.closest('[data-rb-floor-view-source]')
          : null;
        if (!srcSel) return;
        var sp = activePage();
        if (!sp || sp.type !== 'floor') return;
        var sApi = window.ToolboxReportFloorViews;
        var slotNow = floorSlot(sp);
        // Mutate the live list entry (stable identity). Do not clear size/align
        // linkGroup on source change — size linking is source-agnostic (GPT-027);
        // camera sharing already keys off sameSource + linkGroup.
        var listNow = sApi ? sApi.viewsFor(sp) : [];
        var sv = listNow[slotNow];
        if (!sv) return;
        var parts = String(srcSel.value || '').split('|');
        sv.canvasId = parts[0] || '';
        sv.epochId = parts[1] || null;
        sv.scope = parts[3] || 'all';
        // Combined = whole level; never keep a leftover boundary id (GPT-030).
        sv.areaId = sv.scope === 'all' ? null : (parts[2] || null);
        // Drop a stale independent camera so the new level opens framed, not
        // at the previous floor's pan. Linked same-source broadcast is N/A here.
        sv.camera = null;
        releaseTopoHosts();
        markDirty();
        renderPages();
        flushSave().catch(function () {});
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

    // Contours on or off for this Picture Locations sheet. The level's layer
    // is untouched, and so is what Distress is showing: this is how this page
    // is drawn, nothing more.
    if (penContourBtn) {
      penContourBtn.addEventListener('click', function (event) {
        event.preventDefault();
        var contourPage = activePage();
        if (!contourPage || !isPenLogPage(contourPage)) return;
        contourPage.meta = contourPage.meta || {};
        contourPage.meta.showContour =
          penContourBtn.getAttribute('data-rb-penlog-contour') === 'on';
        noteEdit();
        setSaveStatus('Saving…');
        renderPages();
        flushSave().catch(function () {});
      });
    }

    root.querySelectorAll('[data-rb-template="penlog"]').forEach(function (button) {
      button.addEventListener('click', function (event) {
        event.preventDefault();
        var penPage = activePage();
        if (!penPage || !isPenLogPage(penPage)) return;
        setSaveStatus(saveTemplatePiece({ penLogContour: penLogShowsContour(penPage) })
          ? 'Saved as the default for new reports.'
          : 'The default could not be saved on this device.');
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

    /**
     * A step of history, without a second copy of the photographs.
     *
     * A step used to be JSON.stringify of the pages. The pages carry their
     * evidence, and evidence carries every photograph on the slide as text,
     * so one step was the whole job written out again: measured at 54 MB on
     * a job with sixty photographs, and a step is taken every time anything
     * changes, up to sixty of them. Two or three edits on a real job is a
     * gigabyte, and the tab dies -- "Aw, Snap! Out of Memory", which is what
     * Tim and Lee hit moving between the workspaces on one file.
     *
     * A photograph never changes while the report is open, so a step does not
     * need its own copy of one. This copies the structure and keeps the same
     * text: in JavaScript, text handed from one object to another is not
     * copied, so sixty steps share one set of photographs between them.
     *
     * It follows JSON's rules deliberately, because that is what the history
     * was built on: a function is dropped from an object and becomes null in
     * a list, and undefined is dropped. A loop cannot occur in a report --
     * stringify would have thrown on one -- but if one ever did, it ends
     * here as null rather than running forever.
     */
    function cloneStep(value, seen) {
      if (value === null || typeof value !== 'object') {
        return typeof value === 'function' ? undefined : value;
      }
      var visited = seen || new Set();
      if (visited.has(value)) return null;
      visited.add(value);
      var out;
      if (Array.isArray(value)) {
        out = [];
        for (var i = 0; i < value.length; i += 1) {
          var item = cloneStep(value[i], visited);
          out.push(item === undefined ? null : item);
        }
      } else {
        out = {};
        Object.keys(value).forEach(function (key) {
          var next = cloneStep(value[key], visited);
          if (next !== undefined) out[key] = next;
        });
      }
      visited.delete(value);
      return out;
    }

    /** Has anything actually changed? Asked of what the report saves --
     *  which is the pages without their evidence, so it stays small. */
    function historySignature() {
      try {
        return JSON.stringify({
          pages: pages.map(persistablePage),
          activeId: activeId,
        });
      } catch (err) {
        return String(pages.length) + '|' + String(activeId);
      }
    }

    function snapshotNow() {
      if (restoring) return;
      var sig = historySignature();
      if (historyAt >= 0 && history[historyAt] && history[historyAt].sig === sig) return;
      history = history.slice(0, historyAt + 1);
      history.push({ sig: sig, pages: cloneStep(pages), activeId: activeId });
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
      var shot = history[index];
      if (!shot) return false;
      restoring = true;
      // A fresh copy, so stepping back twice to the same place does not hand
      // out the same objects to be edited in place.
      pages = cloneStep(shot.pages);
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

    onDocument('keydown', function (event) {
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

    /**
     * Placing a text box, the way PowerPoint places one.
     *
     * The button used to drop a box at a fixed spot on the page and leave the
     * investigator to drag it where they meant -- and it arrived with no
     * outline and no caret, so on white paper nothing appeared to have
     * happened at all. Now the button arms the tool, the pointer shows a
     * crosshair, and the next click or drag on the sheet says where the box
     * goes and how wide it is. A plain click gets a sensible default width,
     * which is what PowerPoint does too.
     */
    var textPlace = null;

    function beginTextBox(event) {
      var at = sheetPercent(event);
      if (!at) return;
      event.preventDefault();
      var ghost = document.createElement('div');
      ghost.className = 'rb-ov-ghost';
      ghost.style.left = at.x + '%';
      ghost.style.top = at.y + '%';
      ghost.style.width = '0%';
      ghost.style.height = '0%';
      sheetEl.appendChild(ghost);
      textPlace = { start: at, ghost: ghost, pointerId: event.pointerId };
      try { sheetEl.setPointerCapture(event.pointerId); } catch (err) { /* convenience */ }
    }

    function textPlaceRect(at) {
      var s = textPlace.start;
      return {
        x: Math.min(s.x, at.x),
        y: Math.min(s.y, at.y),
        w: Math.abs(at.x - s.x),
        h: Math.abs(at.y - s.y),
      };
    }

    function moveTextBox(event) {
      var at = sheetPercent(event);
      if (!at || !textPlace) return;
      var box = textPlaceRect(at);
      textPlace.ghost.style.left = box.x + '%';
      textPlace.ghost.style.top = box.y + '%';
      textPlace.ghost.style.width = box.w + '%';
      textPlace.ghost.style.height = box.h + '%';
    }

    function cancelTextBox() {
      if (!textPlace) return;
      if (textPlace.ghost.parentNode) textPlace.ghost.parentNode.removeChild(textPlace.ghost);
      textPlace = null;
    }

    function endTextBox(event) {
      if (!textPlace) return;
      var at = sheetPercent(event) || textPlace.start;
      var box = textPlaceRect(at);
      cancelTextBox();
      disarmInk();
      var page = activePage();
      var api = window.ToolboxReportOverlay;
      if (!page || !api) return;
      var item = api.create('text');
      item.color = overlayColor;
      // A click rather than a drag: the default measure, starting where the
      // pointer went down.
      var drawn = box.w > 3 && box.h > 1.5;
      item.x = Math.max(0, Math.min(97, drawn ? box.x : box.x));
      item.y = Math.max(0, Math.min(97, drawn ? box.y : box.y));
      if (drawn) {
        item.w = Math.max(api.MIN_W, box.w);
        item.h = Math.max(api.MIN_H, box.h);
      }
      flushHistoryNow();
      overlayList(page).push(item);
      markDirty();
      renderPages();
      flushSave().catch(function () {});
      focusOverlayField(item.id);
    }

    /** Put the caret in a box the moment it is placed, as PowerPoint does. */
    function focusOverlayField(id) {
      window.requestAnimationFrame(function () {
        var field = sheetEl.querySelector('[data-rb-ov-field="' + id + '"]');
        if (!field) return;
        try {
          // Without preventScroll the stage nudges itself to bring the new
          // box into view, so the sheet slides under the pointer at the
          // moment the box appears. The box is already in view: the
          // investigator just drew it.
          field.focus({ preventScroll: true });
          var range = document.createRange();
          range.selectNodeContents(field);
          range.collapse(true);
          var sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        } catch (err) { /* the box is still there to click */ }
      });
    }

    function insertOverlay(kind) {
      // A text box is placed, not dropped: the button arms the tool and the
      // next click or drag on the sheet says where it goes.
      if (kind === 'text') {
        setInkTool('textbox');
        if (formatToolbar && typeof formatToolbar.setTool === 'function') {
          formatToolbar.setTool('textbox');
        }
        return;
      }
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
    // Capture stats-pill-size-change must NOT rewrite this report. Report
    // pill size is floorLayout.pillLock only, changed from the rail stepper.

    onDocument('pointerdown', function (event) {
      if (inkTool) return;
      if (!sheetEl || !sheetEl.isConnected) return;
      var target = event.target;
      if (!target || !target.closest) return;
      var onPlan = !!target.closest('[data-rb-topo-live]') ||
        !!target.closest('[data-plan-resize]');
      // With two views on the sheet, clicking one is how the rail's controls
      // are pointed at it. Which one is selected is where the investigator is
      // looking, not part of the report, so it is never saved and never
      // printed.
      var frame = target.closest ? target.closest('[data-rb-topo-frame]') : null;
      if (frame) {
        var fpage = activePage();
        var want = Number(frame.getAttribute('data-rb-topo-frame')) || 0;
        if (fpage && floorSlots(fpage) > 1 && floorSlot(fpage) !== want) {
          fpage._floorSlot = want;
          renderPages();
        }
      }
      // Listening on the document rather than the sheet, because an imported
      // floor slide draws full bleed: the plan IS the whole sheet, so there is
      // nowhere on it to click off. Clicking the rail, the toolbar or the
      // margin around the page has to deselect, the way clicking away from a
      // picture does in PowerPoint.
      sheetEl.classList.toggle('rb-sheet--plan-selected', onPlan);
      pickBox(target);
    }, true);

    /**
     * The box being worked on, and only it, wears its pulls.
     *
     * Tim: chevrons are the resize pull, "and they only show up when the box
     * is highlighted, period." They used to come out on hover -- so they
     * appeared under a pointer that was only passing over, and a box reached
     * by any other means had none -- and on a Floor Survey sheet every box on
     * the page showed them at once as soon as the drawing was clicked.
     *
     * One marker, set here for every kind of box that moves. The cover sets
     * its own, by the same rule and at the same moment.
     */
    function pickBox(target) {
      if (!sheetEl || !sheetEl.isConnected) return;
      var picked = target && target.closest
        ? target.closest('[data-rb-floor-box],[data-rb-penlog-box],[data-rb-disc-box]')
        : null;
      if (picked && !sheetEl.contains(picked)) picked = null;
      var lit = sheetEl.querySelectorAll('.is-picked');
      for (var i = 0; i < lit.length; i += 1) {
        if (lit[i] !== picked) lit[i].classList.remove('is-picked');
      }
      if (picked) picked.classList.add('is-picked');
    }

    // Drawing listens on the sheet too, but only acts while a tool is armed,
    // and the armed layer above has already stopped the event reaching anything
    // else. Registered FIRST so a stroke is never mistaken for a box drag.
    sheetEl.addEventListener('pointerdown', function (event) {
      if (!inkTool) return;
      if (inkTool === 'eraser') { eraseAt(event); return; }
      if (inkTool === 'textbox') { beginTextBox(event); return; }
      beginInk(event);
    });
    sheetEl.addEventListener('pointermove', function (event) {
      if (textPlace) { moveTextBox(event); return; }
      if (inkTool) moveInk(event);
    });
    sheetEl.addEventListener('pointerup', function (event) {
      if (textPlace) { endTextBox(event); return; }
      if (inkTool) endInk(event);
    });
    sheetEl.addEventListener('pointercancel', function (event) {
      if (textPlace) { cancelTextBox(); return; }
      if (inkTool) endInk(event);
    });
    onDocument('keydown', function (event) {
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
        kind: item.kind,
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
      // A text box's height comes from its text, so its grip sets the width
      // and the measure the words wrap to. Dragging it up and down would be
      // setting a number the box then ignores.
      var textBox = overlayDrag.kind === 'text';
      var next = overlayDrag.resize
        ? {
          x: f.x, y: f.y,
          w: Math.max(api.MIN_W, f.w + dx),
          h: textBox ? f.h : Math.max(api.MIN_H, f.h + dy),
        }
        : { x: Math.max(0, Math.min(97, f.x + dx)), y: Math.max(0, Math.min(97, f.y + dy)), w: f.w, h: f.h };
      var live = sheetEl.querySelector('[data-rb-ov="' + overlayDrag.id + '"]');
      if (live) {
        live.style.left = next.x + '%';
        live.style.top = next.y + '%';
        live.style.width = next.w + '%';
        // A text box is sized by its text; its stored height is only the
        // floor, so it is written as min-height or the box stops growing.
        if (textBox) live.style.minHeight = next.h + '%';
        else live.style.height = next.h + '%';
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

    /**
     * Run each Distress level's schedule across as many sheets as it needs.
     *
     * The page used to rule a fixed number of rows and silently scroll
     * whatever did not fit, so a job with forty photographs printed a page
     * that was wrong and gave no sign of it. Now the rows are as tall as
     * their own text and the ones that do not fit go on another sheet.
     *
     * Measured, never estimated, and never stored as truth: the split is
     * recomputed from the rendered page every time, so tightening a note
     * pulls the next sheet's rows back up and a sheet nobody needs any more
     * disappears. Only the starting row index is written onto the page, and
     * only so the rail has a sheet to list.
     */
    function penLogBoxes() {
      var api = window.ToolboxPenLog;
      return api && api.normalizeLayout
        ? api.normalizeLayout(penLogBoxLayout)
        : (penLogBoxLayout || {});
    }

    function reflowPenLog() {
      var api = window.ToolboxPenLog;
      if (!api || typeof api.fitCount !== 'function') return false;
      var current = activePage();
      if (!current || !isPenLogPage(current)) return false;
      var chain = penLogChain(current, pages);
      var head = chain[0];
      if (!head) return false;
      var pins = penLogPinsForPage(head, penLogNoteMap(head, penLogUi.noteMap),
        penLogOffsetMap(head));
      if (!pins.length) return false;

      // One measurement pass over the whole level: fill a sheet, then start
      // the next from where it stopped.
      var starts = [];
      var at = 0;
      var guard = 0;
      while (at < pins.length && guard < 200) {
        starts.push(at);
        at += api.fitCount(pins.slice(at), penLogBoxes().schedule);
        guard += 1;
      }
      if (!starts.length) starts = [0];

      var same = starts.length === chain.length;
      for (var i = 0; same && i < starts.length; i += 1) {
        if (penLogStart(chain[i]) !== starts[i]) same = false;
      }
      if (same) return false;

      for (var k = 0; k < starts.length; k += 1) {
        if (k < chain.length) {
          chain[k].meta = chain[k].meta || {};
          chain[k].meta.penLogFrom = starts[k];
          continue;
        }
        var level = (head.meta && head.meta.levelName) || 'Level';
        var added = {
          id: head.id + '-cont-' + k,
          type: 'distress',
          title: head.title,
          tocTitle: head.tocTitle || head.title,
          railLabel: (head.railLabel || 'Picture Locations') + ' (cont.)',
          includeInToc: false,
          note: '',
          sourceKey: 'distress',
          sourceRef: head.sourceRef || null,
          meta: {
            reserved: false,
            penLog: true,
            continuation: true,
            penLogFrom: starts[k],
            levelName: level,
            pinCount: (head.meta && head.meta.pinCount) || 0,
            photoCount: (head.meta && head.meta.photoCount) || 0,
          },
          // Shared with the sheet it continues: one level, one set of pins
          // and one plan, so there is nothing for a second copy to disagree
          // with.
          evidence: head.evidence || null,
        };
        var lastId = (chain[chain.length - 1] || head).id;
        var atIndex = 0;
        for (var m = 0; m < pages.length; m += 1) if (pages[m].id === lastId) atIndex = m;
        pages = insertPagesAt(pages, atIndex + 1, [added]);
        chain.push(added);
      }

      if (chain.length > starts.length) {
        var drop = {};
        for (var d = starts.length; d < chain.length; d += 1) drop[chain[d].id] = true;
        if (drop[activeId]) activeId = chain[Math.max(0, starts.length - 1)].id;
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
      // Any other block of the rail: the client, the address, the drawing
      // title, the date and its note, a boundary's name, a reading's label or
      // its number, a section heading, the figure number. Emptying one drops
      // the override rather than storing a blank, which is how the generated
      // line comes back.
      var railField = field.closest ? field.closest('[data-rb-rail-field]') : null;
      if (railField) {
        var fieldPage = activePage();
        if (!fieldPage) return false;
        var fApi = window.ToolboxReportText;
        var fieldKey = railField.getAttribute('data-rb-rail-field') || '';
        if (!fieldKey) return false;
        fieldPage.reportText = fieldPage.reportText || {};
        fieldPage.reportText.rail = fieldPage.reportText.rail || {};
        var written = fApi ? fApi.compact(fApi.fromElement(railField)) : railField.textContent;
        if (fApi && typeof fApi.isEmpty === 'function' && fApi.isEmpty(written)) {
          delete fieldPage.reportText.rail[fieldKey];
        } else {
          fieldPage.reportText.rail[fieldKey] = written;
        }
        markDirty();
        return true;
      }
      var railNote = field.closest ? field.closest('[data-rb-rail-note]') : null;
      if (railNote) {
        var railPage = activePage();
        if (!railPage) return false;
        var rApi = window.ToolboxReportText;
        railPage.reportText = railPage.reportText || {};
        railPage.reportText.railNote = rApi
          ? rApi.compact(rApi.fromElement(railNote))
          : railNote.textContent;
        markDirty();
        return true;
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
      // The clipboard's HTML flavour first, because that is the one that
      // carries the formatting.
      //
      // Only text/plain was read before. A list copied out of a browser
      // flattens in that flavour: the marker and its text arrive on separate
      // lines and the nesting is gone before Toolbox sees any of it. That is
      // what put every bullet's text on the line below its marker and
      // levelled three indent levels into one. Tim: "what I'm looking for is
      // a right-click paste as formatted."
      //
      // Nothing from the clipboard is inserted as markup. It is parsed in a
      // detached document, read into the report's own model, and written
      // back out as the report's own markup -- so a paste carries structure
      // and styling, and carries nothing else in with it.
      // One reader for the clipboard, shared with the right-click menu.
      // This used to be a second copy of it, so the typeface normalization
      // added to the other one did not happen on Ctrl+V -- a pasted span
      // kept its own face while the same paste from the menu did not.
      var html = richHtmlFromClipboardHtml(event.clipboardData.getData('text/html'));
      if (!html) {
        var text = event.clipboardData.getData('text/plain');
        if (!text || !api.looksLikeMarkdown(text)) return;
        // No base size: headings come in bold at the field's own size, as the
        // shipped reports set them, rather than stepping up a scale.
        html = api.toHtml(api.fromMarkdown(text, 0));
      }
      event.preventDefault();
      insertRichHtml(field, html);
    });

    /**
     * Put prepared markup in at the caret and settle the field.
     *
     * insertHTML nests the whole paste inside whatever block the caret was
     * in, which produced one paragraph the height of the column. Rebuilding
     * the field from the model flattens it back into real sibling paragraphs
     * so the text can flow between columns.
     */
    function insertRichHtml(field, html) {
      var api = window.ToolboxReportText;
      if (!field || !api || !html) return false;
      if (!document.execCommand('insertHTML', false, html)) return false;
      var normalized = api.compact(api.fromElement(field));
      field.innerHTML = api.toHtml(normalized);
      commitRichField(field);
      if (reflowDiscussion()) {
        renderPages();
        flushSave().catch(function () {});
      }
      return true;
    }

    /** The report's own markup for a block of clipboard HTML. */
    /**
     * The one thing a paste does NOT bring: its typeface.
     *
     * Tim, Oct 23, 2026: "a pasted paragraph should keep it size and color but
     * I should be able to change it." Size and colour are his to change from
     * the bar, so they arrive and he changes what he does not want. A FACE is
     * different -- one report is one typeface, settled the same day, and a
     * narrative pasted out of a chat answer carries that chat's family on
     * every block and every span. Left in, one report ends up set in four
     * fonts and there is nothing on the page to say why.
     *
     * This runs on the CLIPBOARD, not in fromElement. fromElement is also the
     * editor's own reader on every keystroke, so stripping there would strip
     * the font Tim himself chose out of his own saved text.
     */
    function stripPastedTypeface(root) {
      if (!root || typeof root.querySelectorAll !== 'function') return;
      var all = root.querySelectorAll('*');
      for (var i = 0; i < all.length; i += 1) {
        var el = all[i];
        if (el.style && el.style.fontFamily) el.style.fontFamily = '';
        // Without styleWithCSS the browser writes <font face="..."> instead.
        if (el.tagName === 'FONT' && el.hasAttribute('face')) el.removeAttribute('face');
      }
      if (root.style && root.style.fontFamily) root.style.fontFamily = '';
    }

    function richHtmlFromClipboardHtml(pastedHtml) {
      var api = window.ToolboxReportText;
      if (!api || !pastedHtml || typeof window.DOMParser !== 'function') return '';
      try {
        var parsed = new window.DOMParser().parseFromString(pastedHtml, 'text/html');
        var body = parsed && parsed.body;
        if (!body) return '';
        var junk = body.querySelectorAll('script, style, meta, link, title');
        for (var j = 0; j < junk.length; j += 1) junk[j].remove();
        if (!body.textContent.trim()) return '';
        stripPastedTypeface(body);
        return api.toHtml(api.compact(api.fromElement(body)));
      } catch (err) {
        return '';
      }
    }

    /** The report's own markup for a block of plain text, styling nothing. */
    function richHtmlFromPlainText(text) {
      var api = window.ToolboxReportText;
      if (!api || !text) return '';
      var model = { paragraphs: String(text).replace(/\r\n?/g, '\n').split('\n')
        .map(function (line) {
          return { align: 'left', bullet: false, numbered: false, indent: 0,
            dir: 'ltr', runs: line ? [{ text: line }] : [] };
        }) };
      return api.toHtml(api.compact(model));
    }

    sheetEl.addEventListener('focusin', function (event) {
      var field = event.target.closest && event.target.closest('[data-rb-rich]');
      if (field && formatToolbar) formatToolbar.noteField(field);
    });

    // A block of the rail emptied and left behind goes back to the line the
    // Customer File generates for it. Waiting for the investigator to leave
    // the block, rather than acting on the keystroke that empties it, is what
    // lets them clear a line and type a new one: the generated text would
    // otherwise land back under the caret mid-edit.
    // An empty text box is thrown away when it is left, as PowerPoint throws
    // one away. Placing a box, thinking better of it and clicking elsewhere
    // used to leave an invisible empty box on the page for ever.
    sheetEl.addEventListener('focusout', function (event) {
      var ovField = event.target.closest && event.target.closest('[data-rb-ov-field]');
      if (ovField && !ovField.textContent.trim()) {
        var ovPage = activePage();
        var list = ovPage && ovPage.meta && ovPage.meta.overlays;
        var ovId = ovField.getAttribute('data-rb-ov-field');
        if (list && list.some(function (o) { return o.id === ovId && o.kind === 'text'; })) {
          ovPage.meta.overlays = list.filter(function (o) { return o.id !== ovId; });
          markDirty();
          renderPages();
          flushSave().catch(function () {});
          return;
        }
      }
      var field = event.target.closest && event.target.closest('[data-rb-rail-field]');
      if (!field || field.textContent.trim()) return;
      var page = activePage();
      var rail = page && page.reportText && page.reportText.rail;
      if (rail && rail[field.getAttribute('data-rb-rail-field')]) return;
      renderPages();
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
        '[data-rb-cover-field], [data-rb-section-field], [data-rb-ov-field], ' +
        '[data-rb-rail-note], [data-rb-rail-field]');
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
      // As it is typed, so the writer sees what will print.
      fitCaption(field);
      markDirty();
    });

    /**
     * Put the Floor Survey drawings on their sheets, without being asked.
     *
     * A Floor Survey sheet opened as a dashed empty box and an "Import Floor
     * Survey" button, once per level. Tim: "I wonder if we even need to hit a
     * button to bring in the contour... Toolbox knows we have three levels,
     * they can bring the three levels in on one, and then the main level, and
     * then subsequent levels thereafter. I don't know why it needs to be hit."
     * It does know -- the pages are already one per figure, in order -- so the
     * button was asking the investigator to tell it something it had worked
     * out itself.
     *
     * This runs BEFORE evidence is attached, which is the only place it can
     * run. A floor page's drawing is composed by attachEvidence, and only for
     * a page that already says it is imported, so a sheet with no figure can
     * never grow one by being asked afterwards. Marking first means the one
     * evidence pass the report already does composes them.
     *
     * A level that cannot produce a drawing is put back afterwards by
     * dropFailedFloorImports, so it shows the button rather than an empty
     * frame. Returns whether anything changed.
     */
    function markFloorPagesForImport() {
      var flApi = window.ToolboxReportFloorLayout;
      var changed = false;
      pages.forEach(function (page) {
        if (!page || page.type !== 'floor') return;
        var meta = page.meta || {};
        if (meta.reserved || meta.imported) return;
        // A level to draw, and something to draw it from: either Floor
        // Survey composes it live, or a rendering was stored earlier.
        if (!meta.canvasId) return;
        if (!meta.compose && !meta.figureMediaId) return;
        page.meta = meta;
        // A garage arrives as readings, not contours. Tim, Oct 20: "I just
        // want data points in the garage. Period. I can always change them
        // later." Only ever seeded here, on the slide's first import, and
        // only when the slide has no rendition of its own -- Points only is
        // the rail's existing control, so changing it afterwards is the same
        // one click as on any other slide, and that choice is then kept.
        if (meta.pointsOnly && !page.meta.floorView) {
          var seeded = floorView ? JSON.parse(JSON.stringify(floorView)) : {};
          seeded.mode = 'points-only';
          page.meta.floorView = seeded;
        }
        page.meta.imported = true;
        page.meta.autoImported = true;
        changed = true;
      });
      return changed;
    }

    /** Anything that could not be drawn goes back to offering the button. */
    function dropFailedFloorImports() {
      var changed = false;
      pages.forEach(function (page) {
        if (!page || page.type !== 'floor') return;
        var meta = page.meta || {};
        if (!meta.autoImported) return;
        delete page.meta.autoImported;
        var figure = page.evidence && page.evidence.figure;
        if (figure) return;
        page.meta.imported = false;
        changed = true;
      });
      return changed;
    }

    function importActiveFloorPage() {
      var current = activePage();
      if (!current || current.type !== 'floor' || (current.meta && current.meta.reserved)) return;
      if (!workingRecord) return;
      current.meta = current.meta || {};
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
      // The x on the site overview. Settled Oct 10, 2026: the cover's aerial
      // view appears on every Floor Survey page by itself, "and then if it's
      // not right you just delete it" -- on that page, leaving the cover and
      // the other pages alone.
      var overviewBtn = event.target.closest('[data-rb-floor-overview]');
      if (overviewBtn) {
        event.preventDefault();
        var overviewPage = activePage();
        if (!overviewPage || overviewPage.type !== 'floor') return;
        overviewPage.meta = overviewPage.meta || {};
        overviewPage.meta.hideOverview = true;
        noteEdit();
        setSaveStatus('Saving…');
        renderPages();
        flushSave().catch(function () {});
        return;
      }
      // The old single Lock layout had no button left to press: it lived on
      // a toolbar that an imported sheet never draws. Three locks in the rail
      // replaced it -- Lock floor survey, Lock contour legend, Lock
      // high/low/delta -- and each is handled above.
    });

    function stageRect(selector) {
      var stage = sheetEl.querySelector(selector || '[data-rb-floor-stage]');
      return stage ? stage.getBoundingClientRect() : null;
    }

    // Turning north.
    //
    // North is not always up: a plan comes in at whatever rotation it was
    // drawn at, and the mark has to agree with it. Dragging the rose turns
    // the whole instrument about its centre — N rides with the arrow, the
    // same as Distress Survey. The angle is the page's, so each sheet can
    // say something different; a hand turn pins that sheet.
    var northDrag = null;

    function northAngle(event) {
      if (!northDrag) return 0;
      var now = Math.atan2(event.clientY - northDrag.cy, event.clientX - northDrag.cx);
      var deg = northDrag.from + ((now - northDrag.start) * 180) / Math.PI;
      deg = Math.round(deg) % 360;
      return deg < 0 ? deg + 360 : deg;
    }

    function applyRoseRotation(rail, deg) {
      if (!rail) return;
      var g = rail.querySelector('.rb-rail__rose-rot');
      if (g) g.setAttribute('transform', 'rotate(' + deg + ')');
      rail.style.setProperty('--rb-north-rotation', deg + 'deg');
    }

    function currentNorthRotation(page) {
      if (typeof reportNorth === 'number') return reportNorth;
      if (!page) return 0;
      if (typeof page._northRotation === 'number') return page._northRotation;
      var ev = page.evidence || {};
      if (typeof ev.northRotation === 'number') return ev.northRotation;
      return 0;
    }

    sheetEl.addEventListener('pointerdown', function (event) {
      var compass = event.target.closest ? event.target.closest('.rb-rail__compass') : null;
      if (!compass) return;
      var page = activePage();
      var rose = compass.querySelector('.rb-rail__rose');
      if (!page || !rose) return;
      var box = rose.getBoundingClientRect();
      northDrag = {
        page: page,
        rail: compass.closest('.rb-rail__rail'),
        cx: box.left + box.width / 2,
        cy: box.top + box.height / 2,
        start: Math.atan2(event.clientY - box.top - box.height / 2,
          event.clientX - box.left - box.width / 2),
        from: currentNorthRotation(page),
      };
      try { compass.setPointerCapture(event.pointerId); } catch (err) { /* not captured */ }
      event.preventDefault();
      event.stopPropagation();
    }, true);

    onDocument('pointermove', function (event) {
      if (!northDrag) return;
      applyRoseRotation(northDrag.rail, northAngle(event));
      event.preventDefault();
    });

    onDocument('pointerup', function (event) {
      if (!northDrag) return;
      var deg = northAngle(event);
      var page = northDrag.page;
      applyRoseRotation(northDrag.rail, deg);
      northDrag = null;
      if (reportNorth === deg) return;
      reportNorth = deg;
      markDirty();
      renderPages();
      flushSave().catch(function () {});
    });

    /**
     * Which cover box is being worked on.
     *
     * The pulls used to appear on hover alone. Two things made that fail in
     * practice: a box is mostly text, so pointing at it often means pointing
     * at a field rather than the box, and the contents frame had a list
     * hanging out below its own rectangle -- so the rows Tim was clicking
     * were not inside the box at all, and nothing lit up. Tim: "I do like the
     * corner pull but I don't like them visible all the time. I wanted them
     * to where you highlighted it, but I highlighted that box numerous times
     * yesterday and it would not show the pulls."
     *
     * So a click selects a box and the pulls stay out until something else is
     * clicked. Hover still shows them, for anyone who already knows where
     * they are.
     */
    var coverSelected = '';

    function paintCoverSelection() {
      if (!sheetEl) return;
      var boxes = sheetEl.querySelectorAll('[data-rb-cover-box]');
      for (var i = 0; i < boxes.length; i += 1) {
        var id = boxes[i].getAttribute('data-rb-cover-box');
        boxes[i].classList.toggle('is-active', !!coverSelected && id === coverSelected);
      }
    }

    function selectCoverBox(id) {
      if (coverSelected === (id || '')) return;
      coverSelected = id || '';
      paintCoverSelection();
    }

    // A click anywhere on the sheet decides which box is being worked on;
    // one outside them all puts the pulls away.
    sheetEl.addEventListener('pointerdown', function (event) {
      var inBox = event.target.closest('[data-rb-cover-box]');
      selectCoverBox(inBox ? inBox.getAttribute('data-rb-cover-box') : '');
    }, true);

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
      var penGrip = event.target.closest('[data-rb-penlog-move], [data-rb-penlog-resize]');
      if (penGrip) {
        var penStage = stageRect('.rb-penlog');
        if (!penStage || penStage.width < 8 || penStage.height < 8) return;
        event.preventDefault();
        var penResize = !!event.target.closest('[data-rb-penlog-resize]');
        penDrag = {
          which: penGrip.getAttribute(penResize ? 'data-rb-penlog-resize' : 'data-rb-penlog-move'),
          resize: penResize,
          startX: event.clientX,
          startY: event.clientY,
          // Inches, because the pen log's own model is in inches on a
          // 11x17 sheet rather than in percentages of it.
          perInX: penStage.width / 17,
          perInY: penStage.height / 11,
          boxes: penLogBoxes(),
        };
        try { penGrip.setPointerCapture(event.pointerId); } catch (_) {}
        return;
      }
      var discGrip = event.target.closest('[data-rb-disc-move], [data-rb-disc-resize]');
      if (discGrip) {
        var discStage = stageRect('.rb-sheet__margin--discussion');
        if (!discStage || discStage.width < 8 || discStage.height < 8) return;
        event.preventDefault();
        var dApi = window.ToolboxReportDiscussion;
        discDrag = {
          resize: !!event.target.closest('[data-rb-disc-resize]'),
          startX: event.clientX,
          startY: event.clientY,
          stageW: discStage.width,
          stageH: discStage.height,
          box: dApi ? dApi.normalizeBodyBox(discussionBox) : discussionBox,
        };
        try { discGrip.setPointerCapture(event.pointerId); } catch (_) {}
        return;
      }
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
      var resize = event.target.closest('[data-rb-floor-resize]');
      var box = event.target.closest('[data-rb-floor-box]');
      if (!box) return;
      // Every piece is movable on every slide. They are all drawing the
      // report's one layout record, so moving one here moves it everywhere --
      // which is what the locks were copying by hand.
      var dragKind = box.getAttribute('data-rb-floor-kind') || 'topo';
      // Inside the drawing the gestures are Floor Survey's: drag pans the plan,
      // the wheel zooms it, and it can be moved anywhere including off the
      // edge. Report Builder must not claim those -- the slide is meant to
      // behave exactly as the workspace it came from. The frame is moved and
      // sized from its handles, which sit on its edge, outside the drawing.
      if (!resize && event.target.closest('[data-rb-topo-live]')) return;
      // The x is a button, not a grab handle.
      if (event.target.closest('[data-rb-floor-overview]')) return;
      var stage = stageRect('[data-rb-floor-stage]');
      if (!stage || stage.width < 8 || stage.height < 8) return;
      event.preventDefault();
      var id = box.getAttribute('data-rb-floor-box');
      var kind = box.getAttribute('data-rb-floor-kind') || 'topo';
      var layout = window.ToolboxReportFloorLayout
        ? window.ToolboxReportFloorLayout.normalizeLayout(floorLayout)
        : floorLayout;
      var viewId = (id && id.indexOf('topo-view:') === 0) ? id.slice(10) : null;
      var viewIndex = -1;
      var viewFrame = null;
      if (viewId && current.meta) {
        var vList = floorViewsForPage(current);
        for (var vi = 0; vi < vList.length; vi += 1) {
          if (vList[vi] && vList[vi].id === viewId) {
            viewIndex = vi;
            viewFrame = JSON.parse(JSON.stringify(vList[vi].frame));
            break;
          }
        }
      }
      floorDrag = {
        id: id,
        kind: kind,
        viewId: viewId,
        viewIndex: viewIndex,
        resize: !!resize,
        corner: resize ? (resize.getAttribute('data-rb-floor-corner') || 'se') : null,
        startX: event.clientX,
        startY: event.clientY,
        stageW: stage.width,
        stageH: stage.height,
        layout: layout,
        viewFrame: viewFrame,
      };
      // Captured by the element the pointer is ACTUALLY on -- the handle when
      // one was grabbed, the box otherwise.
      //
      // Capturing on the box left the pointer free to wander onto the live
      // drawing, whose own pointer handling then took it: mid-drag the canvas
      // held the capture and the box did not, so every pointermove was
      // retargeted there and this drag never saw one. The aerial's pulls were
      // visible, were what the pointer found, and still did nothing.
      // Tim: "I cannot resize the picture. Or the topo."
      var grabbed = resize || box;
      try { grabbed.setPointerCapture(event.pointerId); } catch (_) {}
      floorDrag.grabbed = grabbed;
      // And nothing downstream gets a say in this gesture.
      event.stopPropagation();
    });

    sheetEl.addEventListener('pointermove', function (event) {
      if (penDrag) {
        var pdx = (event.clientX - penDrag.startX) / penDrag.perInX;
        var pdy = (event.clientY - penDrag.startY) / penDrag.perInY;
        var penApi2 = window.ToolboxPenLog;
        var nextPen = JSON.parse(JSON.stringify(penDrag.boxes));
        var moving = nextPen[penDrag.which];
        if (!moving) return;
        if (penDrag.resize) {
          moving.w += pdx;
          moving.h += pdy;
        } else {
          moving.x += pdx;
          moving.y += pdy;
        }
        penLogBoxLayout = penApi2 && penApi2.normalizeLayout
          ? penApi2.normalizeLayout(nextPen) : nextPen;
        // Moved live; the split waits for the pointer to come up, because
        // re-measuring the whole level sixty times a second would rebuild
        // every sheet of it.
        var livePen = sheetEl.querySelector('[data-rb-penlog-box="' + penDrag.which + '"]');
        if (livePen) {
          var b = penLogBoxLayout[penDrag.which];
          livePen.style.left = ((b.x / 17) * 100) + '%';
          livePen.style.top = ((b.y / 11) * 100) + '%';
          livePen.style.width = ((b.w / 17) * 100) + '%';
          livePen.style.height = ((b.h / 11) * 100) + '%';
        }
        return;
      }
      if (discDrag) {
        var ddx = ((event.clientX - discDrag.startX) / discDrag.stageW) * 100;
        var ddy = ((event.clientY - discDrag.startY) / discDrag.stageH) * 100;
        var dApi2 = window.ToolboxReportDiscussion;
        var nextBox = {
          x: discDrag.box.x + (discDrag.resize ? 0 : ddx),
          y: discDrag.box.y + (discDrag.resize ? 0 : ddy),
          w: discDrag.box.w + (discDrag.resize ? ddx : 0),
          h: discDrag.box.h + (discDrag.resize ? ddy : 0),
        };
        discussionBox = dApi2 ? dApi2.normalizeBodyBox(nextBox) : nextBox;
        // Moved live on the sheet; the re-flow waits for the pointer to come
        // up, because splitting the narrative again on every pixel would
        // rebuild the book sixty times a second.
        var liveBox = sheetEl.querySelector('[data-rb-disc-box]');
        if (liveBox && dApi2) liveBox.style.cssText = dApi2.bodyStyle
          ? dApi2.bodyStyle(discussionBox)
          : liveBox.style.cssText;
        return;
      }
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
      var viewsApi = window.ToolboxReportFloorViews;
      var dragPage = activePage();
      if (floorDrag.viewId && floorDrag.viewFrame && viewsApi && dragPage) {
        var minW = viewsApi.MIN_FRAME_W || 18;
        var minH = viewsApi.MIN_FRAME_H || 25;
        var o = floorDrag.viewFrame;
        var nextFrame;
        if (floorDrag.resize) {
          var west = floorDrag.corner === 'nw' || floorDrag.corner === 'sw';
          var north = floorDrag.corner === 'nw' || floorDrag.corner === 'ne';
          var nextW = Math.max(minW, west ? o.w - dx : o.w + dx);
          var nextH = Math.max(minH, north ? o.h - dy : o.h + dy);
          nextFrame = {
            x: west ? o.x + (o.w - nextW) : o.x,
            y: north ? o.y + (o.h - nextH) : o.y,
            w: nextW,
            h: nextH,
            z: o.z,
          };
        } else {
          nextFrame = { x: o.x + dx, y: o.y + dy, w: o.w, h: o.h, z: o.z };
        }
        nextFrame = viewsApi.normalizeFrame(nextFrame);
        var list = viewsApi.viewsFor(dragPage);
        if (list[floorDrag.viewIndex]) {
          if (list[floorDrag.viewIndex].linkGroup) {
            viewsApi.applyLinkedGeometry(list, floorDrag.viewIndex, nextFrame);
          } else {
            list[floorDrag.viewIndex].frame = nextFrame;
          }
        }
        // Live update all view frames on the sheet.
        list.forEach(function (v) {
          if (!v) return;
          var el = sheetEl.querySelector('[data-rb-floor-box="topo-view:' + v.id + '"]');
          if (!el) return;
          el.style.left = v.frame.x + '%';
          el.style.top = v.frame.y + '%';
          el.style.width = v.frame.w + '%';
          el.style.height = v.frame.h + '%';
        });
        return;
      }
      if (floorDrag.id === 'overview') {
        var ov = floorDrag.layout.overview;
        if (floorDrag.resize) {
          var ovMinW = flApi ? flApi.MIN_OVERVIEW_W : 6;
          var ovMinH = flApi ? flApi.MIN_OVERVIEW_H : 6;
          var ovWest = floorDrag.corner === 'nw' || floorDrag.corner === 'sw';
          var ovNorth = floorDrag.corner === 'nw' || floorDrag.corner === 'ne';
          var ovW = Math.max(ovMinW, ovWest ? ov.w - dx : ov.w + dx);
          var ovH = Math.max(ovMinH, ovNorth ? ov.h - dy : ov.h + dy);
          layout.overview.w = ovW;
          layout.overview.h = ovH;
          layout.overview.x = ovWest ? ov.x + (ov.w - ovW) : ov.x;
          layout.overview.y = ovNorth ? ov.y + (ov.h - ovH) : ov.y;
        } else {
          layout.overview.x = ov.x + dx;
          layout.overview.y = ov.y + dy;
        }
      } else if (floorDrag.id === 'topo') {
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
        // Legend / H/L/Δ (and any other overlay). Multi-view chrome ids are
        // legend-<viewId> / pill-<viewId>; seed the overlay if a older layout
        // never wrote that id so the drag cannot die silently.
        var overlay = null;
        for (var i = 0; i < layout.overlays.length; i += 1) {
          if (layout.overlays[i].id === floorDrag.id) overlay = layout.overlays[i];
        }
        if (!overlay) {
          var seedBox = sheetEl.querySelector('[data-rb-floor-box="' + floorDrag.id + '"]');
          var seedX = seedBox ? (parseFloat(seedBox.style.left) || 0) : 0;
          var seedY = seedBox ? (parseFloat(seedBox.style.top) || 0) : 0;
          overlay = {
            id: floorDrag.id,
            kind: floorDrag.kind || 'legend',
            statsIndex: 0,
            x: seedX,
            y: seedY,
            z: 3,
            scale: 1,
          };
          layout.overlays.push(overlay);
          if (floorDrag.layout && Array.isArray(floorDrag.layout.overlays)) {
            floorDrag.layout.overlays.push(JSON.parse(JSON.stringify(overlay)));
          }
        }
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
          overlay.x = (origin ? origin.x : overlay.x) + dx;
          overlay.y = (origin ? origin.y : overlay.y) + dy;
        }
      }
      // Written through the slide, not straight at the report.
      //
      // For a slide following the shared placement this IS the report's one
      // record, so every Floor Survey slide has moved by the time the drag
      // ends -- that is the rule. For a slide that was deliberately placed on
      // its own, it is that slide's. Writing the record directly here made
      // the drag ignore which of the two it was, so moving a piece on a slide
      // placed on its own moved every other slide with it.
      layout = flApi ? flApi.normalizeLayout(layout) : layout;
      (current._putFloorLayout || putFloorLayout)(layout);
      var box = sheetEl.querySelector('[data-rb-floor-box="' + floorDrag.id + '"]');
      if (!box) return;
      if (floorDrag.id === 'overview') {
        box.style.left = layout.overview.x + '%';
        box.style.top = layout.overview.y + '%';
        box.style.width = layout.overview.w + '%';
        box.style.height = layout.overview.h + '%';
      } else if (floorDrag.id === 'topo') {
        box.style.left = layout.topo.x + '%';
        box.style.top = layout.topo.y + '%';
        box.style.width = layout.topo.w + '%';
        box.style.height = layout.topo.h + '%';
      } else {
        // Moving a piece moves it. It does not resize it.
        //
        // The colour scale and the readings are sized by one control each --
        // Legend size and Stats pill size, the same two that size them in
        // Floor Survey -- and renderPage draws them at that size. This wrote
        // a second size over the top: the per-piece `scale` left in the
        // layout by an older build that gave these two corner handles. So a
        // piece sat at one size until it was touched and jumped to another
        // the moment it was dragged, and whichever of the two was right was
        // luck. Tim: "the high-low delta pill needs to be selected and moved
        // before it sizes right... legends, you have to select before they
        // size right."
        //
        // One size, from the control. The drag writes position only.
        for (var n = 0; n < layout.overlays.length; n += 1) {
          if (layout.overlays[n].id === floorDrag.id) {
            box.style.left = layout.overlays[n].x + '%';
            box.style.top = layout.overlays[n].y + '%';
          }
        }
      }
    });

    function endLayoutDrag() {
      if (penDrag) {
        var wasResize = penDrag.resize;
        penDrag = null;
        markDirty();
        // A schedule given more or less room holds a different number of
        // rows, so the level is split again before the sheets are drawn.
        if (wasResize) reflowPenLog();
        renderPages();
        flushSave().catch(function () {});
        return;
      }
      if (discDrag) {
        discDrag = null;
        markDirty();
        // The room changed, so the split has to change with it: text that no
        // longer fits moves on, and text that now does comes back.
        if (reflowDiscussion()) flushSave().catch(function () {});
        renderPages();
        return;
      }
      if (coverDrag) {
        coverDrag = null;
        markDirty();
        return;
      }
      if (!floorDrag) return;
      var endPage = activePage();
      if (floorDrag.viewId && endPage && window.ToolboxReportFloorViews) {
        var vApi = window.ToolboxReportFloorViews;
        var vList = vApi.viewsFor(endPage);
        var ix = floorDrag.viewIndex;
        if (vList[ix]) {
          var snapped = vApi.snapFrame(vList[ix].frame, vList, ix);
          if (vList[ix].linkGroup) vApi.applyLinkedGeometry(vList, ix, snapped);
          else vList[ix].frame = snapped;
        }
        floorDrag = null;
        markDirty();
        renderPages();
        flushSave().catch(function () {});
        return;
      }
      // Legend / pill / overview moves update floorLayout during pointermove;
      // flush so a reload cannot silently discard the drop (same as view frames).
      floorDrag = null;
      markDirty();
      flushSave().catch(function () {});
    }
    sheetEl.addEventListener('pointerup', endLayoutDrag);
    sheetEl.addEventListener('pointercancel', endLayoutDrag);

    /**
     * Right-click in a writing area: Paste as formatted, Paste unformatted.
     *
     * Ctrl+V already pastes formatted and Ctrl+Shift+V already pastes plain,
     * but Tim does not want to hold a shortcut in his head: "I want to be
     * able to right-click and click paste as formatted, or right-click paste
     * unformatted."
     *
     * A page cannot open the system menu, so this is the report's own, and
     * reading the clipboard from script is something Chrome asks about the
     * first time. That prompt is the browser's, not ours; if it is refused,
     * the menu says so and names the keys that always work rather than
     * failing quietly.
     */
    var pasteMenu = null;
    var pasteMenuField = null;

    function closePasteMenu() {
      if (pasteMenu && pasteMenu.parentNode) pasteMenu.parentNode.removeChild(pasteMenu);
      pasteMenu = null;
      pasteMenuField = null;
      document.removeEventListener('pointerdown', pasteMenuAway, true);
      document.removeEventListener('keydown', pasteMenuKey, true);
    }

    function pasteMenuAway(event) {
      if (event.target.closest && event.target.closest('[data-rb-pastemenu]')) return;
      closePasteMenu();
    }

    function pasteMenuKey(event) {
      if (event.key === 'Escape') closePasteMenu();
    }

    function pasteMenuSay(message) {
      if (!pasteMenu) return;
      var note = pasteMenu.querySelector('.rb-stackmenu__note');
      if (!note) {
        note = document.createElement('p');
        note.className = 'rb-stackmenu__note';
        pasteMenu.appendChild(note);
      }
      note.textContent = message;
    }

    function pasteFromClipboard(formatted) {
      var field = pasteMenuField;
      if (!field) return;
      var nav = window.navigator;
      var clip = nav && nav.clipboard;
      if (!clip) {
        pasteMenuSay('This browser will not let a page read the clipboard. Ctrl+V pastes formatted, Ctrl+Shift+V pastes plain.');
        return;
      }
      var done = function (html) {
        closePasteMenu();
        field.focus();
        restorePasteCaretInto(field);
        insertRichHtml(field, html);
      };
      var failed = function () {
        pasteMenuSay('Toolbox was not allowed to read the clipboard. Ctrl+V pastes formatted, Ctrl+Shift+V pastes plain.');
      };
      if (!formatted) {
        if (typeof clip.readText !== 'function') { failed(); return; }
        clip.readText().then(function (text) {
          var html = richHtmlFromPlainText(text);
          if (html) done(html); else closePasteMenu();
        }).catch(failed);
        return;
      }
      if (typeof clip.read !== 'function') {
        // Older Chrome: text is all that can be had, so say what is being
        // given rather than pretending the formatting came through.
        if (typeof clip.readText !== 'function') { failed(); return; }
        clip.readText().then(function (text) {
          var html = richHtmlFromPlainText(text);
          if (html) done(html); else closePasteMenu();
        }).catch(failed);
        return;
      }
      clip.read().then(function (items) {
        var list = items || [];
        var pick = null;
        for (var i = 0; i < list.length && !pick; i += 1) {
          var types = (list[i] && list[i].types) || [];
          if (types.indexOf('text/html') >= 0) pick = list[i];
        }
        if (pick) {
          return pick.getType('text/html').then(function (blob) {
            return blob.text();
          }).then(function (raw) {
            var html = richHtmlFromClipboardHtml(raw);
            if (html) done(html); else closePasteMenu();
          });
        }
        return clip.readText().then(function (text) {
          var html = richHtmlFromPlainText(text);
          if (html) done(html); else closePasteMenu();
        });
      }).catch(failed);
    }

    // The caret has to be put back AFTER the menu goes, because removing the
    // menu is itself a DOM change and the range kept from the right-click is
    // the only record of where the investigator was pointing.
    var pendingCaret = null;
    function restorePasteCaretInto(field) {
      if (!pendingCaret || !field) return;
      var sel = window.getSelection();
      if (sel) { sel.removeAllRanges(); sel.addRange(pendingCaret); }
      pendingCaret = null;
    }

    sheetEl.addEventListener('contextmenu', function (event) {
      var field = event.target.closest && event.target.closest('[data-rb-rich]');
      if (!field || field.getAttribute('contenteditable') !== 'true') return;
      event.preventDefault();
      closePasteMenu();
      closeStackMenu();
      var sel = window.getSelection();
      pendingCaret = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      pasteMenuField = field;
      pasteMenu = document.createElement('div');
      pasteMenu.className = 'rb-stackmenu';
      pasteMenu.setAttribute('data-rb-pastemenu', '1');
      [['Paste as formatted', '1'], ['Paste unformatted', '0']].forEach(function (choice) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'rb-stackmenu__item';
        item.setAttribute('data-rb-paste-as', choice[1]);
        item.textContent = choice[0];
        item.addEventListener('click', function (ev) {
          ev.preventDefault();
          pasteFromClipboard(choice[1] === '1');
        });
        pasteMenu.appendChild(item);
      });
      pasteMenu.style.left = Math.round(event.clientX) + 'px';
      pasteMenu.style.top = Math.round(event.clientY) + 'px';
      document.body.appendChild(pasteMenu);
      document.addEventListener('pointerdown', pasteMenuAway, true);
      document.addEventListener('keydown', pasteMenuKey, true);
    });

    /**
     * Right-click a piece of a Floor Survey page to move it behind or in
     * front of the others.
     *
     * Tim: "I need to be able to right click and put images behind or in
     * front." Two choices and nothing else -- the drawing, the aerial view,
     * the colour scale and the readings all sit on one stack, so "behind" and
     * "in front" mean the same thing whichever two pieces overlap.
     */
    var stackMenu = null;

    function stackMenuAway(event) {
      if (event.target.closest && event.target.closest('[data-rb-stackmenu]')) return;
      closeStackMenu();
    }

    function stackMenuKey(event) {
      if (event.key === 'Escape') closeStackMenu();
    }

    function closeStackMenu() {
      if (stackMenu && stackMenu.parentNode) stackMenu.parentNode.removeChild(stackMenu);
      stackMenu = null;
      // The two listeners the menu needs live only while it is open: the
      // report is mounted again every time the investigator comes back to it,
      // and listeners left on the document would pile up one deep per visit.
      document.removeEventListener('pointerdown', stackMenuAway, true);
      document.removeEventListener('keydown', stackMenuKey, true);
    }

    function restackFloorPiece(box, toFront) {
      var page = activePage();
      var flApi = window.ToolboxReportFloorLayout;
      if (!page || page.type !== 'floor' || !flApi) return;
      var layout = flApi.normalizeLayout(floorLayout);
      var id = box.getAttribute('data-rb-floor-box') || '';
      var kind = box.getAttribute('data-rb-floor-kind') || 'topo';
      var stack = [layout.topo.z, layout.overview.z].concat(
        layout.overlays.map(function (item) { return item.z; }));
      var want = toFront
        ? Math.max.apply(null, stack) + 1
        : Math.min.apply(null, stack) - 1;
      want = Math.max(flApi.MIN_STACK, Math.min(flApi.MAX_STACK, want));
      if (kind === 'topo') {
        layout.topo.z = want;
      } else if (kind === 'overview') {
        layout.overview.z = want;
      } else {
        var found = false;
        layout.overlays.forEach(function (item) {
          if (item.id !== id) return;
          item.z = want;
          found = true;
        });
        if (!found) return;
      }
      // Through the slide as well: bringing a piece forward on a slide placed
      // on its own is that slide's business.
      (page._putFloorLayout || putFloorLayout)(layout);
      markDirty();
      renderPages();
      flushSave().catch(function () {});
    }

    sheetEl.addEventListener('contextmenu', function (event) {
      var box = event.target.closest('[data-rb-floor-box]');
      if (!box) { closeStackMenu(); return; }
      var page = activePage();
      var flApi = window.ToolboxReportFloorLayout;
      if (!page || page.type !== 'floor' || !flApi) return;
      event.preventDefault();
      closeStackMenu();
      stackMenu = document.createElement('div');
      stackMenu.className = 'rb-stackmenu';
      stackMenu.setAttribute('data-rb-stackmenu', '1');
      [['Bring to front', true], ['Send to back', false]].forEach(function (choice) {
        var item = document.createElement('button');
        item.type = 'button';
        item.className = 'rb-stackmenu__item';
        item.setAttribute('data-rb-stack', choice[1] ? 'front' : 'back');
        item.textContent = choice[0];
        item.addEventListener('click', function () {
          closeStackMenu();
          restackFloorPiece(box, choice[1]);
        });
        stackMenu.appendChild(item);
      });
      document.body.appendChild(stackMenu);
      // Kept on the screen: a piece near the right or the bottom edge would
      // otherwise open its menu off the page.
      var w = stackMenu.offsetWidth;
      var h = stackMenu.offsetHeight;
      stackMenu.style.left = Math.max(4, Math.min(window.innerWidth - w - 4, event.clientX)) + 'px';
      stackMenu.style.top = Math.max(4, Math.min(window.innerHeight - h - 4, event.clientY)) + 'px';
      document.addEventListener('pointerdown', stackMenuAway, true);
      document.addEventListener('keydown', stackMenuKey, true);
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
      renumberInPlace(pages);
      markDirty();
      renderPages();
    });

    laterBtn.addEventListener('click', function () {
      var index = activeIndex();
      if (index >= pages.length - 1) return;
      var moved = pages[index];
      pages[index] = pages[index + 1];
      pages[index + 1] = moved;
      renumberInPlace(pages);
      markDirty();
      renderPages();
    });

    // Print the whole book, not just the open sheet. Every page already
    // carries its evidence (attachEvidence runs over all pages on load), so
    // each one is rendered into its own 11 x 17 sheet and handed to the
    // browser's print dialog -- which is also how a PDF comes out of it.
    // The deliverable is the PDF; there is no separate export path to keep
    // in step with what the investigator sees on screen.
    /**
     * Shrink every picture in the printed deck to what the paper can show.
     *
     * A phone hands over a 4032 x 3024 photograph. On a Pictures sheet it is
     * printed about two and a half inches wide -- call it 500 dots at 200 to
     * the inch. The other 23 million pixels are carried into the PDF and
     * thrown away by whatever opens it. Tim, on a deck he had just saved:
     * "I was trying to attach a recently saved PDF but it's too big... The
     * PDF rendered horribly." Measured on his file: 53.9 MB.
     *
     * So each picture is redrawn, once, at the size it will actually print,
     * and the deck carries that instead. Nothing in the Customer File is
     * touched -- the original photograph stays exactly as captured, and only
     * this throwaway deck holds the smaller copy.
     *
     * 200 dots to the inch is the target. It is what a photograph in a
     * printed report needs; past that the file grows and the page does not
     * change. A picture already smaller than its target is left alone, so
     * nothing is ever blown up.
     */
    var PRINT_DPI = 200;
    var SHEET_INCHES = 17;

    /**
     * Wait until the deck has actually been laid out.
     *
     * Measured too early, an <img> reports its natural width rather than the
     * width it will print at -- so a 4032px photograph looked like a 4032px
     * box, "wide enough to need 8400 dots", and every picture was left alone.
     * The first attempt at this shrank nothing at all and said so: 0 redrawn,
     * 21.9 MB to 21.9 MB.
     */
    function deckSettled(deck) {
      var waits = [].slice.call(deck.querySelectorAll('img'))
        .filter(function (img) { return !(img.complete && img.naturalWidth > 0); })
        .map(function (img) {
          return new Promise(function (done) {
            img.addEventListener('load', done, { once: true });
            img.addEventListener('error', done, { once: true });
          });
        });
      return Promise.all(waits).then(function () {
        return new Promise(function (done) {
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () { done(); });
          });
        });
      });
    }

    /**
     * The report's own faces, loaded.
     *
     * Every fit on the deck is a measurement of text, and text measured
     * before its face has loaded is measured in the fallback face -- wider
     * or narrower letters, so a caption is shrunk by the wrong amount and a
     * street line wraps when it would have fitted. The fits ran immediately
     * on attach, which is before this resolves.
     */
    function fontsReady() {
      if (!document.fonts || typeof document.fonts.ready !== 'object') return Promise.resolve();
      return Promise.resolve(document.fonts.ready).catch(function () {});
    }

    /** Measurable and truthful: pictures decoded, faces loaded, frames past. */
    function deckReady(deck) {
      if (!deck) return Promise.resolve();
      return Promise.all([deckSettled(deck), fontsReady()]).then(function () {});
    }

    /**
     * Settle one deck: lay the plans out, then fit what has to fit.
     *
     * Every one of these is a measurement, and they all measure the sheet at
     * the editor's 680 x 440 -- the same numbers the editor itself used --
     * so they arrive at the same answers it did. The sheet is enlarged to the
     * paper afterwards by a transform, which changes nothing that was
     * measured.
     */
    function settlePrintDeck(deck) {
      if (!deck) return;
      relayoutPrintedPlans(deck);
      // The printed cover is a fresh sheet, so its contents is measured and
      // stepped down on its own.
      fitCoverContents(deck);
      // And so is every printed caption and street line.
      fitCaptions(deck);
      fitStreetLine(deck);
    }

    function shrinkPrintImages(deck) {
      if (!deck) return Promise.resolve({ before: 0, after: 0, redrawn: 0 });
      return deckSettled(deck).then(function () { return shrinkSettledDeck(deck); });
    }

    function shrinkSettledDeck(deck) {
      var sheet = deck.querySelector('.rb-sheet');
      var sheetPx = sheet ? sheet.getBoundingClientRect().width : 0;
      if (!(sheetPx > 0)) return Promise.resolve({ before: 0, after: 0, redrawn: 0 });
      var jobs = [];
      var before = 0;
      var after = 0;
      var redrawn = 0;
      [].slice.call(deck.querySelectorAll('img')).forEach(function (img) {
        var src = img.getAttribute('src') || '';
        if (src.indexOf('data:image/') !== 0) return;
        before += Math.round(src.length * 0.75);
        var drawn = img.getBoundingClientRect().width;
        if (!(drawn > 0) || !(img.naturalWidth > 0)) { after += Math.round(src.length * 0.75); return; }
        // How wide this picture prints, and therefore how many dots it needs.
        var inches = (drawn / sheetPx) * SHEET_INCHES;
        var want = Math.max(1, Math.round(inches * PRINT_DPI));
        if (img.naturalWidth <= want) { after += Math.round(src.length * 0.75); return; }
        var scale = want / img.naturalWidth;
        var canvas = document.createElement('canvas');
        canvas.width = want;
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        var ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        jobs.push(new Promise(function (done) {
          var paint = function () {
            try {
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              // A drawing with flat colour and hard lines keeps its edges in
              // PNG and smears in JPEG; a photograph is the other way about.
              // Whatever it came in as is what it goes out as.
              var asPng = /^data:image\/png/i.test(src);
              var next = canvas.toDataURL(asPng ? 'image/png' : 'image/jpeg', 0.82);
              if (next && next.length < src.length) {
                img.setAttribute('src', next);
                after += Math.round(next.length * 0.75);
                redrawn += 1;
              } else {
                after += Math.round(src.length * 0.75);
              }
            } catch (err) {
              after += Math.round(src.length * 0.75);
            }
            done();
          };
          if (img.complete && img.naturalWidth > 0) paint();
          else img.addEventListener('load', paint, { once: true });
        }));
      });
      return Promise.all(jobs).then(function () {
        return { before: before, after: after, redrawn: redrawn };
      });
    }

    /**
     * Paint a still picture of every floor slide's drawing, before printing.
     *
     * The live contour view is one element per slot for the whole page, so
     * only the slide being looked at can hold it. On paper every slide is
     * shown at once, so the rest need a picture of their own. This composes
     * one per slide -- with that slide's own display settings, and one frame
     * shared by the whole job so every level lands at the same scale in the
     * same place, which is what Lock view means on screen.
     *
     * The slide that does hold the live view gets a still too: the deck is
     * built detached, and a live view mounted into nothing measures nothing.
     */
    /**
     * Re-cut the whole picture run to a chosen shape.
     *
     * A shape is a page capacity -- five across and two down holds ten -- and
     * the photographs flow over as many sheets as that needs. Tim:
     * "two-picture, one-row ... 100 pictures ... that's just 50 pages of two
     * pictures each. It gets determined from that point forward."
     *
     * Captions travel with their photograph, not with the sheet it used to be
     * on, or re-cutting would scatter the wording the investigator typed.
     */
    function repaginatePictures(cols, rows) {
      var capacity = Math.max(1, (Number(cols) || 1) * (Number(rows) || 1));
      var idx = [];
      pages.forEach(function (item, i) { if (item && item.type === 'pictures') idx.push(i); });
      if (!idx.length) return false;
      // One contiguous block, or this cannot put it back where it was.
      if (idx[idx.length - 1] - idx[0] + 1 !== idx.length) return false;
      var keys = [];
      var captions = {};
      idx.forEach(function (i) {
        var item = pages[i];
        var pk = (item.meta && Array.isArray(item.meta.photoKeys)) ? item.meta.photoKeys : [];
        pk.forEach(function (k) { if (k && keys.indexOf(k) < 0) keys.push(k); });
        var c = (item.reportText && item.reportText.captions) || null;
        if (!c) return;
        Object.keys(c).forEach(function (k) {
          if (typeof captions[k] !== 'string') captions[k] = c[k];
        });
      });
      if (!keys.length) return false;
      var wanted = Math.ceil(keys.length / capacity);
      var existing = idx.map(function (i) { return pages[i]; });
      var out = [];
      for (var n = 0; n < wanted; n += 1) {
        var chunk = keys.slice(n * capacity, (n + 1) * capacity);
        var sheet = existing[n] || buildPicturesPage([], 0, nextPicturesPageId(pages.concat(out)));
        sheet.meta = sheet.meta || {};
        sheet.meta.photoKeys = chunk;
        sheet.meta.picturesAcross = Number(cols);
        sheet.meta.picturesDown = Number(rows);
        var keep = {};
        chunk.forEach(function (k) {
          if (typeof captions[k] === 'string') keep[k] = captions[k];
        });
        sheet.reportText = sheet.reportText || {};
        sheet.reportText.captions = keep;
        sheet.railLabel = wanted > 1 ? ('Pictures \u00b7 ' + (n + 1)) : 'Pictures';
        out.push(sheet);
      }
      pages = pages.slice(0, idx[0]).concat(out, pages.slice(idx[idx.length - 1] + 1));
      pages = renumberFigures(pages);
      return true;
    }

    /**
     * The region of plan space a printed slide should paint.
     *
     * The still was painted from the DATA extent -- the smallest rectangle
     * holding the readings -- and then letterboxed into the frame. That has
     * no idea where the investigator panned or how far they zoomed, so the
     * printed drawing came out centred and larger than the one on screen.
     * Tim, on exactly that: "I need this to look like it does in the report
     * builder."
     *
     * The book already stores the camera the live view reports. Turned back
     * into a plan-space rectangle of the frame's own shape, it is the region
     * the screen is showing -- so the still paints that, and the two agree.
     * Anything missing falls back to the shared data extent, which is what
     * printed before.
     */
    function cameraExtentFor(page, fallback, slot) {
      var at = typeof slot === 'number' ? slot : 0;
      var view = floorViewSpec(page, at);
      // GPT-029: same effective-camera policy as live mounts (cameraForView).
      // Prefer shared floorCamera for ordinary / same-source-linked figures so
      // a stale view.camera on a previously visited sibling cannot compose the
      // print still from the wrong pan while the editor shows the book camera.
      var cam = cameraForView(page, at);
      if (!cam || !cam.rel || !(Number(cam.zoom) > 0)) return fallback;
      var ps = window.ToolboxPlanSetup;
      var meta = (page && page.meta) || {};
      var canvasId = (view && view.canvasId) || meta.canvasId;
      if (!ps || typeof ps.canvasById !== 'function' || !workingRecord || !canvasId) return fallback;
      var canvas = null;
      try { canvas = ps.canvasById(workingRecord, canvasId); } catch (err) { canvas = null; }
      var plan = canvas && canvas.plan;
      var planW = plan && Number(plan.width) > 0 ? Number(plan.width) : 0;
      var planH = plan && Number(plan.height) > 0 ? Number(plan.height) : 0;
      if (!planW || !planH) return fallback;
      var frameAspect = 0;
      if (page && page.meta && page.meta.imported) {
        var stageAspect = 0;
        var stageEl = root.querySelector('.rb-stage .rb-sheet [data-rb-floor-stage]');
        if (stageEl) {
          var sr = stageEl.getBoundingClientRect();
          if (sr.width > 8 && sr.height > 8) stageAspect = sr.width / sr.height;
        }
        if (!(stageAspect > 0)) {
          stageAspect = (17 * STAGE_SHARE_OF_SHEET) / 11;
        }
        // Prefer the stored free-frame geometry for this view (Checkpoint 1).
        var fr = view && view.frame;
        var sharePct = fr && Number(fr.w) > 0 ? Number(fr.w) : null;
        var heightPct = fr && Number(fr.h) > 0 ? Number(fr.h) : 100;
        if (!(sharePct > 0)) {
          var slots = floorSlotsForPage(page);
          var flApi = window.ToolboxReportFloorLayout;
          sharePct = (flApi && typeof flApi.frameShare === 'function')
            ? flApi.frameShare(slots)
            : (100 - (slots - 1) * 2) / slots;
        }
        // Frame aspect on paper = (share of stage width × stage aspect) / (share of stage height).
        frameAspect = stageAspect * (sharePct / 100) / (heightPct / 100);
      } else {
        var layout = page._bookFloorLayout || null;
        var topo = layout && layout.topo;
        if (!topo || !(Number(topo.w) > 0) || !(Number(topo.h) > 0)) return fallback;
        frameAspect = (Number(topo.w) * 17) / (Number(topo.h) * 11);
      }
      if (!(frameAspect > 0)) return fallback;
      var planAspect = planW / planH;
      var regionW = planAspect > frameAspect ? planW : planH * frameAspect;
      var regionH = planAspect > frameAspect ? planW / frameAspect : planH;
      var zoom = Number(cam.zoom) || 1;
      regionW /= zoom;
      regionH /= zoom;
      var cx = Number(cam.cx);
      var cy = Number(cam.cy);
      if (!isFinite(cx)) cx = 0.5;
      if (!isFinite(cy)) cy = 0.5;
      return {
        x: cx * planW - regionW / 2,
        y: cy * planH - regionH / 2,
        w: regionW,
        h: regionH,
      };
    }

    function composeFloorStills() {
      var api = window.ToolboxFloorSurvey;
      if (!api || typeof api.composeReportTopoFigureForPage !== 'function' || !workingRecord) {
        return Promise.resolve(0);
      }
      var getMedia = window.ToolboxDB && window.ToolboxDB.getMedia
        ? window.ToolboxDB.getMedia.bind(window.ToolboxDB)
        : null;
      var wanted = [];
      pages.forEach(function (page) {
        if (!page || page.type !== 'floor') return;
        var meta = page.meta || {};
        if (meta.reserved) return;
        floorViewsForPage(page);
        var slots = floorSlotsForPage(page);
        var anySource = false;
        for (var slot = 0; slot < slots; slot += 1) {
          var vs = floorViewSpec(page, slot);
          if ((vs && vs.canvasId) || meta.canvasId) {
            anySource = true;
            wanted.push({ page: page, slot: slot, view: vs });
          }
        }
        if (!anySource && meta.canvasId) wanted.push({ page: page, slot: 0, view: null });
      });
      if (!wanted.length) return Promise.resolve(0);

      var painted = 0;
      return wanted.reduce(function (chain, job) {
        return chain.then(function () {
          var meta = job.page.meta || {};
          var view = job.view;
          var canvasId = (view && view.canvasId) || meta.canvasId;
          var epochId = (view && view.epochId) || meta.epochId;
          var areaId = view
            ? (view.scope === 'all' ? null : (view.areaId || null))
            : (meta.scope === 'all' ? null : (meta.areaId || null));
          var scope = (view && view.scope) || meta.scope || 'all';
          var fallbackExtent = null;
          var extentPromise = (typeof api.reportTopoExtentForPage === 'function')
            ? api.reportTopoExtentForPage(workingRecord, {
              canvasId: canvasId,
              epochId: epochId,
              areaId: areaId,
              scope: scope,
              settings: floorViewFor(job.page, job.slot) || null,
            }).catch(function () { return null; })
            : Promise.resolve(null);
          return extentPromise.then(function (extent) {
            fallbackExtent = extent || null;
            return api.composeReportTopoFigureForPage(workingRecord, {
              canvasId: canvasId,
              epochId: epochId,
              areaId: areaId,
              scope: scope,
              settings: floorViewFor(job.page, job.slot) || null,
              extent: cameraExtentFor(job.page, fallbackExtent, job.slot),
            }, getMedia).then(function (composed) {
              if (!composed || !composed.dataUrl) {
                throw new Error('Floor still compose returned no image for slot ' + job.slot);
              }
              job.page._printTopo = job.page._printTopo || {};
              job.page._printTopo[job.slot] = composed.dataUrl;
              painted += 1;
            }).catch(function (err) {
              console.error('Floor slide could not be painted for print', canvasId, err);
              throw err;
            });
          });
        });
      }, Promise.resolve()).then(function () {
        if (painted < wanted.length) {
          throw new Error('Floor still compose incomplete: ' + painted + '/' + wanted.length);
        }
        return painted;
      });
    }

    function clearFloorStills() {
      pages.forEach(function (page) {
        if (page && page._printTopo) delete page._printTopo;
      });
    }

    /**
     * The size the editing sheet is right now, and the scale onto the paper.
     *
     * fitSheet() gives the editing sheet whatever width the stage has, so the
     * sheet is a different number of pixels on every window. Anything inside
     * it styled in pixels rather than container units therefore takes up a
     * different FRACTION of the sheet at every size -- the Pictures caption
     * plate is one -- and every fit that measures text is measuring at that
     * size. Building the printed deck at any other size is what made the PDF
     * disagree with the editor. So the printed deck is built at the size the
     * editor is, and scaled from there.
     *
     * 11x17 landscape is 1632 x 1056 CSS pixels at 96dpi. The sheet already
     * holds the 17:11 shape, so scaling by 1632 / width lands the height on
     * 1056 exactly.
     */
    function printSheetSize() {
      // The sheet is the paper, so the printed deck is built at the paper's
      // own size and printed at 1:1. The scale is kept rather than deleted
      // because it is what makes the deck independent of how a sheet happens
      // to be sized: if the paper ever changes, this is the one place.
      return { w: PAPER_W, h: PAPER_H, sx: 1, sy: 1 };
    }

    function buildPrintDeck() {
      var deck = document.createElement('div');
      deck.className = 'rb-print';
      deck.setAttribute('aria-hidden', 'true');
      var size = printSheetSize();
      deck.style.setProperty('--rb-print-sheet-w', size.w + 'px');
      deck.style.setProperty('--rb-print-sheet-h', size.h + 'px');
      deck.style.setProperty('--rb-print-scale-x', String(size.sx));
      deck.style.setProperty('--rb-print-scale-y', String(size.sy));
      pages.forEach(function (page) {
        // The sheet is built at the EDITOR's size and the page box is what
        // becomes the sheet of paper. A scaled element reserves only its
        // unscaled space in flow, so the paper -- and the page break -- has
        // to be the box around it, never the sheet itself.
        var paper = document.createElement('div');
        paper.className = 'rb-print__page';
        var sheet = document.createElement('article');
        sheet.className = 'rb-sheet rb-sheet--print';
        paper.appendChild(sheet);
        deck.appendChild(paper);
        // Only the on-screen render loop stamped this, so the printed deck
        // fell back to the default placement -- the PDF showed the logo in the
        // bottom-left corner no matter where it had been put and locked.
        page._brandBox = currentBrandBox(page);
        // The printed deck never borrows the live view, even for the slide
        // that is holding it. Taking it would move it off the screen sheet,
        // and the deck is built detached, where a live view measures nothing
        // and draws itself into a corner. Every printed slide draws its own
        // still, so they all print the same way.
        var liveMount = page._mountTopo;
        page._mountTopo = null;
        try {
          renderSheet(sheet, page, pages);
        } catch (err) {
          // A sheet that could not be built says so ON the sheet.
          //
          // This used to warn to the console and hand the printer whatever
          // had been assembled before the throw. On a Floor Survey slide the
          // rail is built first, so the sheet went out with its title block,
          // its figure number and its logo -- and no drawing, no colour
          // scale, no readings, nothing to say anything was wrong. A report
          // walked out of here with four blank figures in it and the only
          // trace was a line in a console nobody had open.
          //
          // It still prints the rest of the report: one page that cannot be
          // built is not a reason to refuse the other seventeen.
          console.warn('Page could not be prepared for print', page && page.id, err);
          var failed = document.createElement('p');
          failed.className = 'rb-sheet__failed';
          failed.setAttribute('data-rb-sheet-failed', '1');
          failed.textContent = 'This figure could not be prepared for printing. '
            + 'Close the print dialog, open this slide in Report Builder, and print again.';
          sheet.appendChild(failed);
        } finally {
          page._mountTopo = liveMount;
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
      clearFloorStills();
      document.body.classList.remove('is-printing');
      renderPages();
    }

    var printBtn = root.querySelector('#rb-print');
    if (printBtn) {
      printBtn.addEventListener('click', function () {
        flushSave().catch(function () {}).then(function () {
          clearPrintDeck();
          return composeFloorStills();
        }).then(function () {
          printDeck = buildPrintDeck();
          document.body.appendChild(printDeck);
          document.body.classList.add('is-printing');
          // Nothing is measured until the deck can be measured truthfully.
          return deckReady(printDeck);
        }).then(function () {
          settlePrintDeck(printDeck);
          window.addEventListener('afterprint', clearPrintDeck, { once: true });
          // Every picture redrawn at the size it prints, before the dialog
          // opens: once it is open the deck is what it is.
          return withPrintDocumentTitle(workingRecord, function () {
            return shrinkPrintImages(printDeck).then(function (weighed) {
              window.__toolboxPrintWeight = weighed;
              if (weighed) {
                console.info('Report print: ' + weighed.redrawn + ' pictures redrawn, ' +
                  (weighed.before / 1048576).toFixed(1) + ' MB to ' +
                  (weighed.after / 1048576).toFixed(1) + ' MB.');
              }
              window.requestAnimationFrame(function () {
                window.requestAnimationFrame(function () { window.print(); });
              });
            });
          });
        }).catch(function (err) {
          // GPT-027: do not hand a silently incomplete PDF when a still fails.
          console.error('Print/PDF could not compose floor stills', err);
          clearPrintDeck();
          setSaveStatus('Print failed — a floor figure could not be composed');
        });
      });
    }

    /**
     * The flip chart: the report, one sheet at a time, full screen.
     *
     * It shows the PRINTED deck, not the editing sheets -- the same deck the
     * printer is handed, composed contour maps and all -- so what is flipped
     * through is what comes out of the PDF. A preview that showed something
     * else would be worth nothing, which is the whole reason for it. Tim:
     * "that allows me to see the report before I PDF it or anything else
     * there is my chart view that I've been looking for."
     *
     * The wheel flips it, because that is how he asked to drive it: "I can
     * just scroll my mouse back-and-forth to make sure they flip correctly."
     */
    var presentDeck = null;
    var presentAt = 0;
    var presentBar = null;
    var presentOff = [];
    var wheelPile = 0;
    var wheelRestAt = 0;

    function presentSheets() {
      return presentDeck ? [].slice.call(presentDeck.querySelectorAll('.rb-sheet')) : [];
    }

    function fitPresentSheet() {
      var sheets = presentSheets();
      var sheet = sheets[presentAt];
      if (!sheet) return;
      var w = sheet.offsetWidth || 1;
      var h = sheet.offsetHeight || 1;
      // A little air around the paper so the edge of the sheet reads as an
      // edge rather than running off the screen.
      var scale = Math.min((window.innerWidth - 32) / w, (window.innerHeight - 32) / h);
      if (!(scale > 0)) scale = 1;
      var left = Math.max(0, (window.innerWidth - w * scale) / 2);
      var top = Math.max(0, (window.innerHeight - h * scale) / 2);
      sheet.style.transform =
        'translate(' + Math.round(left) + 'px, ' + Math.round(top) + 'px) scale(' + scale + ')';
    }

    function showPresentSheet(next) {
      var sheets = presentSheets();
      if (!sheets.length) return;
      presentAt = Math.max(0, Math.min(sheets.length - 1, next));
      sheets.forEach(function (sheet, at) {
        sheet.classList.toggle('is-present-current', at === presentAt);
        if (at !== presentAt) sheet.style.transform = '';
      });
      fitPresentSheet();
      if (presentBar) {
        var count = presentBar.querySelector('.rb-present-bar__count');
        var back = presentBar.querySelector('[data-present="back"]');
        var on = presentBar.querySelector('[data-present="next"]');
        if (count) count.textContent = (presentAt + 1) + ' of ' + sheets.length;
        if (back) back.disabled = presentAt === 0;
        if (on) on.disabled = presentAt === sheets.length - 1;
      }
    }

    function closePresentation() {
      presentOff.forEach(function (off) { try { off(); } catch (_) {} });
      presentOff = [];
      if (presentBar && presentBar.parentNode) presentBar.parentNode.removeChild(presentBar);
      presentBar = null;
      if (presentDeck && presentDeck.parentNode) presentDeck.parentNode.removeChild(presentDeck);
      presentDeck = null;
      document.body.classList.remove('is-presenting');
      clearFloorStills();
      renderPages();
      fitSheet(root);
    }

    function buildPresentBar(total) {
      var bar = document.createElement('div');
      bar.className = 'rb-present-bar';
      bar.setAttribute('role', 'group');
      bar.setAttribute('aria-label', 'Presentation controls');
      bar.innerHTML =
        '<button type="button" data-present="back" aria-label="Previous sheet">‹</button>' +
        '<span class="rb-present-bar__count">1 of ' + total + '</span>' +
        '<button type="button" data-present="next" aria-label="Next sheet">›</button>' +
        '<button type="button" data-present="print">Print</button>' +
        '<button type="button" data-present="close">Close</button>';
      bar.addEventListener('click', function (event) {
        var hit = event.target.closest('[data-present]');
        if (!hit) return;
        event.stopPropagation();
        var what = hit.getAttribute('data-present');
        if (what === 'close') closePresentation();
        else if (what === 'print') printWhatIsShowing();
        else if (what === 'back') showPresentSheet(presentAt - 1);
        else if (what === 'next') showPresentSheet(presentAt + 1);
      });
      return bar;
    }

    /**
     * Print what is on the screen.
     *
     * The flip chart IS the printed deck -- the same deck, settled the same
     * way -- so there is nothing to compose or re-render here. It hands the
     * deck it is already showing to the printer and goes back to the sheet
     * it was on. Tim: "if I get to the last slide and I'm not happy with it
     * I just push a button that says print ... it uses the presentation,
     * just render the PDF. I think you're over complicating everything."
     *
     * Photographs still have to be cut down to print size first. The Print /
     * PDF button does that; Present's Print used to skip it, so a flip-chart
     * PDF walked out the door at phone resolution and either choked the mail
     * client or rendered as mush.
     */
    function printWhatIsShowing() {
      if (!presentDeck) return;
      // The shown sheet is placed and scaled by an inline transform, and an
      // inline style beats any stylesheet -- it would have gone to the
      // printer still scaled to the window. It is taken off for the print
      // and put back after.
      var shown = presentDeck.querySelector('.rb-sheet.is-present-current');
      var shownTransform = shown ? shown.style.transform : '';
      if (shown) shown.style.transform = '';
      // --present hides every sheet but the current one. Shrink needs a real
      // drawn width on every photograph, so drop the framing for the weigh
      // (same layout the Print / PDF button uses) and put it back after.
      var wasPresent = presentDeck.classList.contains('rb-print--present');
      if (wasPresent) presentDeck.classList.remove('rb-print--present');
      if (shown) shown.classList.remove('is-present-current');
      document.body.classList.add('is-printing');
      var back = function () {
        document.body.classList.remove('is-printing');
        if (wasPresent && presentDeck) {
          presentDeck.classList.add('rb-print--present');
          if (shown) {
            shown.classList.add('is-present-current');
            shown.style.transform = shownTransform;
          }
          fitPresentSheet();
        }
      };
      window.addEventListener('afterprint', back, { once: true });
      withPrintDocumentTitle(workingRecord, function () {
        return shrinkPrintImages(presentDeck).then(function (weighed) {
          window.__toolboxPrintWeight = weighed;
          window.requestAnimationFrame(function () {
            window.requestAnimationFrame(function () { window.print(); });
          });
        });
      });
    }

    function listenWhilePresenting(target, type, handler, options) {
      target.addEventListener(type, handler, options);
      presentOff.push(function () { target.removeEventListener(type, handler, options); });
    }

    function openPresentation() {
      if (presentDeck) return Promise.resolve();
      var presentBtn = root.querySelector('#rb-present');
      // The button is a glyph now, so the waiting state cannot be a word in
      // place of it -- that would throw the screen away and never put it
      // back. It goes on the tooltip and on aria-busy instead.
      if (presentBtn) {
        presentBtn.disabled = true;
        presentBtn.setAttribute('aria-busy', 'true');
        presentBtn.setAttribute('title', 'Preparing Presentation view…');
      }
      return flushSave().catch(function () {}).then(function () {
        return composeFloorStills();
      }).then(function () {
        presentDeck = buildPrintDeck();
        presentDeck.removeAttribute('aria-hidden');
        // Nothing on a slide being shown to somebody is typeable. The deck is
        // built by the same renderer as the editing sheets, which leaves its
        // text fields editable.
        [].slice.call(presentDeck.querySelectorAll('[contenteditable]')).forEach(function (el) {
          el.setAttribute('contenteditable', 'false');
        });
        // Measure FIRST as a normal print deck (off-screen, every sheet in
        // layout), THEN flip into presentation framing. Adding --present
        // first hid every sheet with display:none, so CONTENTS fit, caption
        // shrink, street fit and pin layout all measured against zero size.
        // Present and the PDF printed from it then looked nothing like the
        // editor Tim had just approved.
        document.body.appendChild(presentDeck);

        // Plan images on Picture Locations, and the report's own faces, are
        // not there on attach. Everything here is a measurement, so nothing
        // is measured until they are -- then once, not twice.
        return deckReady(presentDeck).then(function () {
          settlePrintDeck(presentDeck);

          presentDeck.classList.add('rb-print--present');
          document.body.classList.add('is-presenting');

          presentBar = buildPresentBar(presentSheets().length);
          document.body.appendChild(presentBar);

          listenWhilePresenting(window, 'resize', fitPresentSheet);
          listenWhilePresenting(window, 'keydown', function (event) {
            if (!presentDeck) return;
            var key = event.key;
            if (key === 'Escape') { event.preventDefault(); closePresentation(); return; }
            if (key === 'ArrowRight' || key === 'ArrowDown' || key === 'PageDown' || key === ' ') {
              event.preventDefault(); showPresentSheet(presentAt + 1); return;
            }
            if (key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp') {
              event.preventDefault(); showPresentSheet(presentAt - 1); return;
            }
            if (key === 'Home') { event.preventDefault(); showPresentSheet(0); return; }
            if (key === 'End') { event.preventDefault(); showPresentSheet(presentSheets().length - 1); }
          });
          // One notch of a wheel is one sheet. A trackpad sends a stream of
          // small deltas rather than notches, so they are piled up to a
          // threshold and the pile is dropped once the hand stops -- otherwise
          // one flick runs the whole report past.
          listenWhilePresenting(presentDeck, 'wheel', function (event) {
            event.preventDefault();
            var now = Date.now();
            if (now - wheelRestAt > 220) wheelPile = 0;
            wheelRestAt = now;
            wheelPile += event.deltaY;
            if (wheelPile >= 40) { wheelPile = 0; showPresentSheet(presentAt + 1); }
            else if (wheelPile <= -40) { wheelPile = 0; showPresentSheet(presentAt - 1); }
          }, { passive: false });
          listenWhilePresenting(presentDeck, 'click', function (event) {
            if (event.target.closest('.rb-present-bar')) return;
            // The right half goes on, the left half goes back, the way a
            // slideshow does.
            showPresentSheet(event.clientX > window.innerWidth / 2 ? presentAt + 1 : presentAt - 1);
          });

          showPresentSheet(0);
        });
      }).catch(function (err) {
        // GPT-027: surface incomplete still compose instead of a blank Present deck.
        console.error('Presentation could not be opened', err);
        setSaveStatus('Presentation failed — a floor figure could not be composed');
        closePresentation();
      }).then(function () {
        if (presentBtn) {
          presentBtn.disabled = false;
          presentBtn.removeAttribute('aria-busy');
          presentBtn.setAttribute('title', 'Presentation view');
        }
      });
    }

    var zoomIn = root.querySelector('#rb-zoom-in');
    var zoomOut = root.querySelector('#rb-zoom-out');
    var zoomLevel = root.querySelector('#rb-zoom-level');
    if (zoomIn) zoomIn.addEventListener('click', function () { stepZoom(root, 1); });
    if (zoomOut) zoomOut.addEventListener('click', function () { stepZoom(root, -1); });
    if (zoomLevel) zoomLevel.addEventListener('click', function () { resetZoom(root); });

    var draftBtn = root.querySelector('#rb-draft');
    function syncDraftButton() {
      if (!draftBtn) return;
      draftBtn.setAttribute('aria-pressed', draftStamp ? 'true' : 'false');
      draftBtn.classList.toggle('is-on', draftStamp);
      draftBtn.textContent = draftStamp ? 'Draft stamp: on' : 'Draft stamp';
    }
    syncDraftButton();
    if (draftBtn) {
      draftBtn.addEventListener('click', function () {
        draftStamp = !draftStamp;
        syncDraftButton();
        markDirty();
        renderPages();
      });
    }

    var presentBtn = root.querySelector('#rb-present');
    if (presentBtn) {
      presentBtn.addEventListener('click', function () { openPresentation(); });
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
      // What this report was given stands. Only a report that has never been
      // placed takes the template -- otherwise setting a new default would
      // reach back and move every book already written.
      var template = storedTemplate();
      // A report arranged before there was one record kept its placement on
      // the SLIDES, and the renderer read a slide's own copy BEFORE the
      // book's -- so a slide copy is what was actually on screen. Take it, or
      // opening an older report under one record would quietly throw the
      // arrangement away and fall back to the book's stale copy. The first
      // floor slide that carries one is the one that was being worked on.
      var legacyFloor = null;
      if (savedDoc && Array.isArray(savedDoc.pages)) {
        for (var lf = 0; lf < savedDoc.pages.length; lf += 1) {
          var lp = savedDoc.pages[lf];
          if (lp && lp.type === 'floor' && !(lp.meta && lp.meta.reserved) &&
            lp.meta && lp.meta.layout) {
            legacyFloor = lp.meta.layout;
            break;
          }
        }
      }
      // A report whose rose was turned before this kept the turn on the
      // SHEET. Take it, or opening it would spin the arrow back.
      if (savedDoc && typeof savedDoc.northRotation === 'number') {
        reportNorth = savedDoc.northRotation;
      } else if (savedDoc && Array.isArray(savedDoc.pages)) {
        for (var ln = 0; ln < savedDoc.pages.length; ln += 1) {
          var np = savedDoc.pages[ln];
          if (np && np.meta && typeof np.meta.northRotation === 'number') {
            reportNorth = np.meta.northRotation;
            break;
          }
        }
      }
      if (savedDoc && typeof savedDoc.draftStamp === 'boolean') {
        draftStamp = savedDoc.draftStamp;
        syncDraftButton();
      }
      var floorSeed = legacyFloor || (savedDoc && savedDoc.floorLayout) || template.floorLayout;
      if (floorSeed && window.ToolboxReportFloorLayout) {
        floorLayout = window.ToolboxReportFloorLayout.normalizeLayout(floorSeed);
      }
      var coverSeed = (savedDoc && savedDoc.coverLayout) || template.coverLayout;
      if (coverSeed && window.ToolboxReportCoverLayout) {
        coverLayout = window.ToolboxReportCoverLayout.normalizeLayout(coverSeed);
      }
      var brandSeed = (savedDoc && savedDoc.brandBox) || template.brandBox;
      if (brandSeed && window.ToolboxReportDiscussion) {
        brandBox = window.ToolboxReportDiscussion.normalizeBrandBox(brandSeed);
      }
      var discSeed = (savedDoc && savedDoc.discussionBox) || template.discussionBox;
      if (discSeed && window.ToolboxReportDiscussion) {
        discussionBox = window.ToolboxReportDiscussion.normalizeBodyBox(discSeed);
      }
      var penSeed = (savedDoc && savedDoc.penLogLayout) || template.penLogLayout;
      if (penSeed && window.ToolboxPenLog && window.ToolboxPenLog.normalizeLayout) {
        penLogBoxLayout = window.ToolboxPenLog.normalizeLayout(penSeed);
      }
      var cameraSeed = (savedDoc && savedDoc.floorCamera) || template.floorCamera;
      if (cameraSeed) {
        floorCamera = JSON.parse(JSON.stringify(cameraSeed));
        // Dropped on the way in, so an old report's lock cannot outlive the
        // button that set it.
        delete floorCamera.locked;
      }
      var viewSeed = (savedDoc && savedDoc.floorView) || template.floorView;
      if (viewSeed) floorView = reviveFloorView(viewSeed);
      if (savedDoc && Array.isArray(savedDoc.pages)) {
        savedDoc.pages.forEach(function (page) {
          if (!page || !page.meta || page.type !== 'floor') return;
          // Checkpoint 1: migrate legacy two-up into views[] and revive every
          // view's settings (fixes the old floorView2 revive gap).
          if (window.ToolboxReportFloorViews) {
            window.ToolboxReportFloorViews.ensurePageViews(page);
            (page.meta.views || []).forEach(function (v) {
              if (v && v.settings) v.settings = reviveFloorView(v.settings);
            });
            if (page.meta.views && page.meta.views[0] && page.meta.views[0].settings) {
              page.meta.floorView = page.meta.views[0].settings;
            }
            if (page.meta.views && page.meta.views[1] && page.meta.views[1].settings) {
              page.meta.floorView2 = page.meta.views[1].settings;
            }
          } else if (page.meta.floorView) {
            page.meta.floorView = reviveFloorView(page.meta.floorView);
          }
          if (page.meta.floorView2) {
            page.meta.floorView2 = reviveFloorView(page.meta.floorView2);
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
        var autoImported = markFloorPagesForImport();
        return attachEvidence(workingRecord, pages.slice()).then(function (enriched) {
          return { enriched: enriched, autoImported: autoImported };
        });
      }).then(function (outcome) {
        if (token !== mountGeneration) return;
        var enriched = outcome.enriched;
        pages = enriched;
        dropFailedFloorImports();
        if (outcome.autoImported) {
          markDirty();
          flushSave().catch(function () {});
        }
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
          var moved = reflowDiscussion();
          if (reflowPenLog()) moved = true;
          if (moved) {
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
      '    <div class="rb-zoom" role="group" aria-label="Page size on screen">' +
      '      <button type="button" id="rb-zoom-out" class="rb-zoom__btn"' +
      ' title="Zoom out" aria-label="Zoom out">\u2212</button>' +
      '      <button type="button" id="rb-zoom-level" class="rb-zoom__level">Fit</button>' +
      '      <button type="button" id="rb-zoom-in" class="rb-zoom__btn"' +
      ' title="Zoom in" aria-label="Zoom in">+</button>' +
      '    </div>' +
      '    <button type="button" id="rb-draft" class="btn btn--quiet rb-draft-btn" aria-pressed="false">Draft stamp</button>' +
      // A screen, not a word. PowerPoint puts the views on glyphs and the
      // name belongs to the view, not the verb: this opens Presentation
      // view. The name is on the button for anyone who cannot see the
      // glyph, and on the tooltip for anyone who can.
      '    <button type="button" id="rb-present" class="btn btn--secondary rb-present-btn"' +
      ' title="Presentation view" aria-label="Presentation view">' +
      '      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
      '        <rect x="2.6" y="4" width="18.8" height="12.4" rx="1.6"></rect>' +
      '        <path d="M9 20.6h6"></path>' +
      '        <path d="M12 16.4v4.2"></path>' +
      '      </svg>' +
      '    </button>' +
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
      '      <div class="rb-stage__paper">' +
      '        <article class="rb-sheet" aria-label="' + SHEET_RATIO_LABEL + ' report sheet">' +
      '        </article>' +
      '      </div>' +
      '    </div>' +
      '    <aside class="rb-panel" aria-label="Toolbox">' +
      // The rail is the workspace for whatever slide is open: Import at the
      // top, that workspace's own controls in the middle, and the way back to
      // the full application at the bottom. It is not a permanent list of
      // links, and it shows nothing on a slide that owns no source.
      '      <p class="eyebrow">Toolbox</p>' +
      '      <div id="rb-rail" class="rb-ws" data-rb-rail hidden>' +
      '        <div class="rb-ws__sticky">' +
      '          <h2 class="rb-ws__title" data-rb-rail-title>Floor Survey</h2>' +
      '          <div class="rb-ws__top" data-rb-rail-top></div>' +
      '        </div>' +
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
      // A Picture Locations sheet's workspace is this panel, not the rail, so
      // its way back to the application sits here. At the top rather than the
      // foot the other workspaces use: under a level with twenty
      // photographs, a button below the list is a long scroll from the sheet
      // it belongs to.
      // Shown only on a level Floor Survey has written a contour for; a
      // button offering a layer that does not exist is worse than no button.
      '        <button type="button" class="btn rb-ws__btn" id="rb-penlog-contour" data-rb-penlog-contour="off" hidden></button>' +
      '        <button type="button" class="btn btn--quiet rb-ws__btn" data-rb-template="penlog">Use this as my default</button>' +
      '        <button type="button" class="btn btn--secondary rb-ws__btn" data-rb-source="distress">Open Distress Survey</button>' +
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
    // Everything this mount was holding goes with it.
    //
    // Leaving Report Builder tore down the screen and kept the contents: the
    // pictures it had loaded, the colour scales it had painted, the live
    // Floor Survey views it had mounted, and the pen log's callbacks -- which
    // close over the whole session, so the entire previous visit stayed
    // reachable through them. Measured on a job with twelve photographs it
    // cost about a megabyte every time the investigator went in and came out,
    // and none of it came back under a forced collection. Tim, switching
    // between the applications: "I was getting a not enough memory reload."
    // The same walk with no photographs on the job was flat, which is what
    // pointed at the pictures.
    if (mountCleanup) {
      try { mountCleanup(); } catch (_) { /* leaving anyway */ }
      mountCleanup = null;
    }
    releaseMountListeners();
    releaseTopoHosts();
    overlayUrlCache = {};
    legendImages = Object.create(null);
    legendPainting = Object.create(null);
    penLogUi.onNote = null;
    penLogUi.onSelect = null;
    penLogUi.layout = null;
    penLogUi.noteMap = {};
    penLogUi.selectedPinId = '';
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
