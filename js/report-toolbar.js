// Toolbox — Report Builder formatting toolbar.
//
// Always across the top of Report Builder, every page, the way PowerPoint's
// Home ribbon is always there: Pages on the left, canvas in the middle,
// Toolbox on the right, formatting across the top.
//
// The governing test for this toolbar is whether it looks and feels like
// PowerPoint. Where a browser command and PowerPoint disagree, PowerPoint
// wins.
//
// Selection commands use document.execCommand. It is formally deprecated and
// still the only thing that gets native selection behaviour -- partial words,
// across runs, with the caret where the investigator left it -- in every
// browser Toolbox runs on. Its output markup is messy and deliberately not
// stored: ToolboxReportText.fromElement reads the result back into the
// paragraph/run model, so what gets saved stays clean regardless.

(function () {
  'use strict';

  var FONTS = ['Calibri', 'Arial', 'Georgia', 'Times New Roman'];
  var SIZES = [8, 9, 10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 40, 48, 54, 60, 72];
  var SIZE_MARKER = '7'; // legacy execCommand bucket, rewritten immediately
  // Line spacing, as PowerPoint offers it: a multiplier, plus space after the
  // paragraph on its own. An address block wants the lines tight AND no gap
  // beneath each line; narrative wants the deck's 9 pt between paragraphs.
  // "Single" is whatever the FONT declares -- ascent + descent + line gap --
  // not a fixed number. Calibri is about 1.22, Arial about 1.15, Georgia about
  // 1.14. Every option below is a multiple of that, as PowerPoint's line
  // spacing is, so it is measured from the actual typeface rather than assumed.
  var singleCache = {};

  function singleFor(fontFamily, fontSize) {
    var key = fontFamily + '|' + fontSize;
    if (singleCache[key]) return singleCache[key];
    var probe = document.createElement('div');
    probe.textContent = 'Hxg';
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;' +
      'white-space:nowrap;line-height:normal;padding:0;border:0;margin:0;' +
      'font-family:' + fontFamily + ';font-size:' + fontSize + 'px;';
    document.body.appendChild(probe);
    var ratio = probe.offsetHeight / fontSize;
    document.body.removeChild(probe);
    if (!isFinite(ratio) || ratio <= 0) ratio = 1.2;
    ratio = Math.round(ratio * 1000) / 1000;
    singleCache[key] = ratio;
    return ratio;
  }

  // A line is as tall as its tallest content, so a paragraph mixing typefaces
  // takes the loosest single among them.
  function singleForBlock(block) {
    var base = window.getComputedStyle(block);
    var size = parseFloat(base.fontSize) || 16;
    var best = singleFor(base.fontFamily, size);
    var runs = block.querySelectorAll('*');
    for (var i = 0; i < runs.length; i += 1) {
      var cs = window.getComputedStyle(runs[i]);
      var rs = parseFloat(cs.fontSize) || size;
      var r = singleFor(cs.fontFamily, rs) * (rs / size);
      if (r > best) best = r;
    }
    return best;
  }

  // Re-resolve any block whose spacing was chosen as a multiple, so changing
  // the typeface moves the lines with it instead of leaving the old font's
  // number behind.
  function resolveSpacing(field) {
    if (!field) return;
    var blocks = field.querySelectorAll('[data-rb-line-spacing]');
    for (var i = 0; i < blocks.length; i += 1) {
      var mult = parseFloat(blocks[i].getAttribute('data-rb-line-spacing'));
      if (!isFinite(mult) || mult <= 0) continue;
      blocks[i].style.lineHeight = (mult * singleForBlock(blocks[i])).toFixed(3);
    }
  }
  // PowerPoint's own wording. The distinction matters and the old labels hid
  // it: line spacing is the space BETWEEN LINES WITHIN a paragraph, and does
  // nothing to single-line paragraphs. The gap between separate paragraphs is
  // space after. Someone trying to close up an address block needs the second
  // one, and "No space after" did not say so.
  var LINE_SPACING = [
    { value: 'lh:1', label: 'Single' },
    { value: 'lh:1.15', label: '1.15' },
    { value: 'lh:1.25', label: '1.25' },
    { value: 'lh:1.5', label: '1.5' },
    { value: 'lh:2', label: 'Double' },
    { value: 'sep', label: '' },
    { value: 'sa:0', label: 'Remove Space After Paragraph' },
    { value: 'sa:9', label: 'Add Space After Paragraph' },
  ];

  var activeField = null;
  // The armed drawing tool, and the chosen weight. Module-level like
  // activeField, because the bar is remounted when pages re-render and the
  // investigator's choice should survive that the way Distress's does.
  var armedTool = null;
  var thickLevel = 2;
  // Opening a native <select> blurs the field and destroys the selection, so
  // the command would land on nothing. preventDefault on mousedown cannot help
  // -- it would stop the dropdown opening at all. The live range is therefore
  // remembered while the caret is in a field and restored before any command.
  var savedRange = null;

  function rememberSelection() {
    var sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    var range = sel.getRangeAt(0);
    var holder = range.commonAncestorContainer;
    var el = holder && holder.nodeType === 3 ? holder.parentNode : holder;
    if (el && el.closest && el.closest('[data-rb-rich]')) {
      savedRange = range.cloneRange();
      activeField = el.closest('[data-rb-rich]');
    }
  }

  function restoreSelection() {
    if (!savedRange) return false;
    var sel = window.getSelection();
    if (!sel) return false;
    try {
      sel.removeAllRanges();
      sel.addRange(savedRange);
      if (activeField && activeField.focus) activeField.focus();
      return true;
    } catch (err) {
      return false;
    }
  }

  function fieldOf(node) {
    var el = node && node.nodeType === 3 ? node.parentNode : node;
    return el && el.closest ? el.closest('[data-rb-rich]') : null;
  }

  function currentField() {
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      var f = fieldOf(sel.getRangeAt(0).commonAncestorContainer);
      if (f) return f;
    }
    return activeField && document.contains(activeField) ? activeField : null;
  }

  function exec(cmd, value) {
    try { return document.execCommand(cmd, false, value); } catch (err) { return false; }
  }

  // execCommand('fontSize') only speaks the legacy 1-7 buckets, so mark the
  // selection with one and rewrite those nodes to the real point size.
  function applyInline(field, apply) {
    if (!field) return;
    restoreSelection();
    exec('styleWithCSS', false);
    apply();
    var legacy = field.querySelectorAll('font');
    var replaced = [];
    for (var i = 0; i < legacy.length; i += 1) {
      var font = legacy[i];
      var span = document.createElement('span');
      var size = font.getAttribute('size');
      var face = font.getAttribute('face');
      if (size === SIZE_MARKER && font.hasAttribute('data-rb-pt')) {
        span.style.fontSize = (parseFloat(font.getAttribute('data-rb-pt')) *
          window.ToolboxReportText.PT_TO_CQH).toFixed(3) + 'cqh';
      }
      if (face) span.style.fontFamily = "'" + face.replace(/['"]/g, '') + "'";
      while (font.firstChild) span.appendChild(font.firstChild);
      font.parentNode.replaceChild(span, font);
      replaced.push(span);
    }
    // Swapping those nodes out collapses the selection, which left the NEXT
    // command with nothing to act on -- setting a size and then a typeface
    // lost the typeface. Re-select what was just changed so a run of commands
    // behaves the way it does in a ribbon: pick a size, then a font, then
    // bold, all on the same words.
    if (replaced.length) {
      try {
        var range = document.createRange();
        range.setStartBefore(replaced[0]);
        range.setEndAfter(replaced[replaced.length - 1]);
        var sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      } catch (err) { /* leave the caret where the browser put it */ }
    }
    rememberSelection();
  }

  function setSizeThenResolve(field) { resolveSpacing(field); }

  function setSize(field, pt) {
    if (!field || !isFinite(pt) || pt <= 0) return;
    applyInline(field, function () {
      exec('fontSize', SIZE_MARKER);
      var marked = field.querySelectorAll('font[size="' + SIZE_MARKER + '"]');
      for (var i = 0; i < marked.length; i += 1) marked[i].setAttribute('data-rb-pt', pt);
    });
    setSizeThenResolve(field);
  }

  function setFont(field, family) {
    if (!field || !family) return;
    applyInline(field, function () { exec('fontName', family); });
    // Single means something different in Arial than in Calibri.
    resolveSpacing(field);
  }

  // Indent and direction are paragraph properties, so they are applied to the
  // block directly. execCommand('indent') wraps in <blockquote> in some
  // engines, which is not what a report paragraph means.
  function blocksInSelection(field) {
    var sel = window.getSelection();
    if (!field || !sel || !sel.rangeCount) return [];
    var range = sel.getRangeAt(0);
    var all = field.querySelectorAll('div,p,li');
    var out = [];
    for (var i = 0; i < all.length; i += 1) {
      if (range.intersectsNode(all[i])) out.push(all[i]);
    }
    if (!out.length) {
      var node = range.commonAncestorContainer;
      var block = (node.nodeType === 3 ? node.parentNode : node);
      block = block && block.closest ? block.closest('div,p,li') : null;
      if (block && field.contains(block)) out.push(block);
      else out.push(field);
    }
    return out;
  }

  function applySpacing(field, token) {
    // Size and font reach this through applyInline, which restores the range
    // first. Spacing did not, so if anything had disturbed the selection the
    // command silently applied to nothing.
    restoreSelection();
    var parts = String(token || '').split(':');
    var kind = parts[0];
    var value = parseFloat(parts[1]);
    if (!isFinite(value)) return;
    blocksInSelection(field).forEach(function (block) {
      if (kind === 'lh') {
        // Store the CHOICE, not just the number it resolves to.
        block.setAttribute('data-rb-line-spacing', String(value));
        block.style.lineHeight = (value * singleForBlock(block)).toFixed(3);
      } else {
        block.style.marginBottom = (value * window.ToolboxReportText.PT_TO_CQH).toFixed(3) + 'cqh';
      }
    });
  }

  function stepIndent(field, delta) {
    blocksInSelection(field).forEach(function (block) {
      var current = parseFloat(block.style.marginLeft) || 0;
      var next = Math.max(0, Math.min(32, current + delta * 4));
      block.style.marginLeft = next ? next + '%' : '';
    });
  }

  // Bullets are a paragraph property, not inline markup, so execCommand is
  // the wrong tool twice over. It builds a bare <ul><li>, which in this app
  // computes list-style-type:none and padding-left:0 -- the list is there but
  // invisible, so the button read as doing nothing. And it nests that <ul>
  // INSIDE the paragraph div it came from, which left a stray blank paragraph
  // behind once the document was read back and re-rendered.
  //
  // So the intent is written onto the blocks and the field is rebuilt from the
  // model, which is what produces <ul class="rb-rt__list"> with real markers.
  function isBulletBlock(block) {
    return block.tagName === 'LI' || (block.classList && block.classList.contains('rb-rt__p--bullet'));
  }

  function toggleBullet(field) {
    restoreSelection();
    var api = window.ToolboxReportText;
    if (!field || !api) return;
    var blocks = blocksInSelection(field).filter(function (b) { return b !== field; });
    if (!blocks.length) return;
    var turnOff = blocks.every(isBulletBlock);
    blocks.forEach(function (b) { b.setAttribute('data-rb-bullet', turnOff ? '0' : '1'); });
    var keep = api.captureOffsets(field);
    field.innerHTML = api.toHtml(api.fromElement(field));
    api.restoreOffsets(field, keep);
    rememberSelection();
  }

  function toggleDirection(field) {
    blocksInSelection(field).forEach(function (block) {
      block.style.direction = block.style.direction === 'rtl' ? '' : 'rtl';
    });
  }

  function selectionState(field) {
    var state = { bold: false, italic: false, underline: false, bullet: false, align: 'left', size: '', font: '' };
    if (!field) return state;
    try {
      state.bold = document.queryCommandState('bold');
      state.italic = document.queryCommandState('italic');
      state.underline = document.queryCommandState('underline');
      // queryCommandState only recognises lists it built itself; the
      // Bullets button owns this markup, so the blocks are the truth.
      var bulletBlocks = blocksInSelection(field).filter(function (b) { return b !== field; });
      state.bullet = !!bulletBlocks.length && bulletBlocks.every(isBulletBlock);
      if (document.queryCommandState('justifyCenter')) state.align = 'center';
      else if (document.queryCommandState('justifyRight')) state.align = 'right';
    } catch (err) { /* selection outside a field */ }
    var sel = window.getSelection();
    if (sel && sel.rangeCount) {
      // The COMMON ANCESTOR of a selection spanning a styled run is that
      // run's parent, so reading the font from it reported the paragraph's
      // font and the menu snapped back to Calibri after setting Arial. Read
      // from the deepest node the selection actually starts in.
      var range = sel.getRangeAt(0);
      var node = range.startContainer;
      if (node.nodeType === 1 && node.childNodes[range.startOffset]) {
        node = node.childNodes[range.startOffset];
      }
      var el = node.nodeType === 3 ? node.parentNode : node;
      if (el && field.contains(el)) {
        var px = parseFloat(window.getComputedStyle(el).fontSize);
        var sheet = field.closest('.rb-sheet');
        if (isFinite(px) && sheet && sheet.clientHeight) {
          var cqh = (px / sheet.clientHeight) * 100;
          state.size = String(Math.round(cqh / window.ToolboxReportText.PT_TO_CQH));
        }
        state.font = window.getComputedStyle(el).fontFamily.split(',')[0].replace(/['"]/g, '');
      }
    }
    return state;
  }

  // A native <select> takes focus when it opens, which destroys the caret and
  // leaves the command with nothing to act on. The buttons on this bar survive
  // because the bar swallows mousedown; a native dropdown cannot be made to.
  // These menus are ordinary elements on the same bar, so the selection is
  // never lost -- which is also how a ribbon behaves.
  function menu(kind, values, selected, label, width) {
    var items = values.map(function (v) {
      return '<button type="button" class="rb-format__item" data-rb-pick="' + kind + '"' +
        ' data-rb-value="' + v + '"' + (String(v) === String(selected) ? ' aria-current="true"' : '') +
        '>' + v + '</button>';
    }).join('');
    return (
      '<span class="rb-format__menu" data-rb-menu="' + kind + '">' +
      '  <button type="button" class="rb-format__menu-btn" data-rb-open="' + kind + '"' +
      '    style="min-width:' + width + 'px" aria-haspopup="true" aria-expanded="false"' +
      '    aria-label="' + label + '"><span data-rb-current="' + kind + '">' + selected + '</span>' +
      '    <span class="rb-format__caret" aria-hidden="true">&#9662;</span></button>' +
      '  <span class="rb-format__list" data-rb-list="' + kind + '" hidden>' + items + '</span>' +
      '</span>'
    );
  }

  // The three alignment commands need three distinguishable icons. A single
  // unicode glyph renders identically for all three, so the bars are drawn.
  // The icons the Home ribbon uses, drawn rather than approximated with
  // whatever Unicode had a glyph for. "A up arrow" was literally the letter A
  // and a triangle; the text box was an outline character next to a T. These
  // are the shapes PowerPoint shows, at one weight, in one 24-unit grid.
  function svg(body, extra) {
    return '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"' +
      ' fill="none" stroke="currentColor" stroke-width="1.7"' +
      ' stroke-linecap="round" stroke-linejoin="round"' + (extra || '') + '>' +
      body + '</svg>';
  }

  // The letter A as PowerPoint draws it on the size and text-box buttons.
  function letterA(x, y, w, h) {
    var half = w / 2;
    return '<path d="M' + x + ' ' + (y + h) + 'L' + (x + half) + ' ' + y +
      'L' + (x + w) + ' ' + (y + h) + 'M' + (x + w * 0.22) + ' ' + (y + h * 0.62) +
      'h' + (w * 0.56) + '"/>';
  }

  var ICONS = {
    // Curved arrows, the direction each one travels.
    undo: svg('<path d="M8 9H15.5a4.5 4.5 0 0 1 0 9H10"/><path d="M11 5.5 7 9l4 3.5"/>'),
    redo: svg('<path d="M16 9H8.5a4.5 4.5 0 0 0 0 9H14"/><path d="M13 5.5 17 9l-4 3.5"/>'),

    // Big A, small A, and the arrow saying which way the size goes.
    grow: svg(letterA(2, 5, 13, 15) + '<path d="M19.5 19V6M16.8 8.5l2.7-2.7 2.7 2.7"/>'),
    shrink: svg(letterA(2, 5, 13, 15) + '<path d="M19.5 6v13M16.8 16.5l2.7 2.7 2.7-2.7"/>'),

    // Three marks and three lines.
    bullet: svg('<path d="M9 6.5h12M9 12h12M9 17.5h12"/>' +
      '<circle cx="4" cy="6.5" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="4" cy="12" r="1.5" fill="currentColor" stroke="none"/>' +
      '<circle cx="4" cy="17.5" r="1.5" fill="currentColor" stroke="none"/>'),

    // Lines with the indented ones pushed in, and the arrow pointing the way.
    indent: svg('<path d="M3 4.5h18M10 9.5h11M10 14.5h11M3 19.5h18"/>' +
      '<path d="M3 8.5 6.5 12 3 15.5z" fill="currentColor" stroke="none"/>'),
    outdent: svg('<path d="M3 4.5h18M10 9.5h11M10 14.5h11M3 19.5h18"/>' +
      '<path d="M6.5 8.5 3 12l3.5 3.5z" fill="currentColor" stroke="none"/>'),

    // Lines with a double-headed arrow beside them.
    spacing: svg('<path d="M10 5h11M10 10h11M10 15h11M10 20h11"/>' +
      '<path d="M4.5 4v16M2.5 6 4.5 4l2 2M2.5 18l2 2 2-2"/>'),

    // Text direction: the letter turned on its side, with the arrow.
    dir: svg('<path d="M4 20V8M4 8 7 11M4 8 1.2 11" />' +
      '<path d="M10.5 19.5 15 5l4.5 14.5M12 15.5h6"/>'),

    // A text box is a box with an A in it.
    text: svg('<rect x="2.5" y="4.5" width="19" height="15" rx="1.5"/>' +
      letterA(7.5, 8.5, 9, 7)),
    ellipse: svg('<circle cx="12" cy="12" r="8.5"/>'),
    arrow: svg('<path d="M5 19 18.5 5.5"/><path d="M11.5 5.5h7v7"/>'),
    // Pictures: a frame with a hill and a sun in it.
    // Distress Survey's drawing tools, drawn in this bar's language rather
    // than pasted in as its emoji glyphs: same family of apps, different
    // screen. Order and meaning match survey.html's toolbar exactly.
    pencil: svg(
      '<path d="M4 20l1-4.2L15.2 5.6a2 2 0 0 1 2.8 0l1.4 1.4a2 2 0 0 1 0 2.8L9.2 19.8 5 21z"/>' +
      '<path d="M13.6 7.2l3.2 3.2"/>',
    ),
    rect: svg('<rect x="3.5" y="5.5" width="17" height="13" rx="1"/>'),
    // The drawn shape's kind is 'circle'; the legacy boxed one is 'ellipse'.
    // Both buttons want the same glyph, so the icon is registered under both
    // names -- asking for a name the map does not have renders a blank button,
    // which is exactly what happened here.
    circle: svg('<circle cx="12" cy="12" r="8.5"/>'),
    eraser: svg(
      '<path d="M8.6 19.5H5.4a1.6 1.6 0 0 1-1.1-2.7L13.9 7a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8l-6.6 6.6z"/>' +
      '<path d="M8.6 19.5h11.9"/><path d="M11.4 9.5l5.7 5.7"/>',
    ),
    image: svg('<rect x="2.5" y="4.5" width="19" height="15" rx="1.5"/>' +
      '<circle cx="8" cy="9.5" r="1.6"/>' +
      '<path d="M3 17l5-4.5 3.5 3L15.5 11l5.5 5"/>'),
  };

  // The three weights, as bars of the weight they set -- Distress shows the
  // same thing with a styled span. Solid bars, so they opt out of the outline
  // convention the way the alignment icons do.
  function thickButton(level, label) {
    var h = { 1: 1.6, 2: 3, 3: 5 }[level] || 3;
    var y = 12 - h / 2;
    return '<button type="button" class="rb-format__btn rb-format__btn--icon" ' +
      'data-rb-thick="' + level + '" aria-label="' + label + '" title="' + label + '">' +
      '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" fill="currentColor">' +
      '<rect x="3" y="' + y + '" width="18" height="' + h + '" rx="' + (h / 2) + '"/>' +
      '</svg></button>';
  }

  function iconBtn(attr, which, label, hint) {
    return '    <button type="button" class="rb-format__btn rb-format__btn--icon" ' +
      attr + '="' + which + '" aria-label="' + label + '" title="' + (hint || label) + '">' +
      (ICONS[which] || '') + '</button>';
  }

  function alignButton(which, label) {
    // Full and short lines alternating, the way the ribbon draws them, on the
    // same 24-unit grid and at the same size as every other icon here.
    var widths = [18, 11, 18, 12];
    var x = function (w) {
      if (which === 'center') return (12 - w / 2).toFixed(1);
      if (which === 'right') return (21 - w).toFixed(1);
      return '3';
    };
    var bars = widths.map(function (w, i) {
      return '<rect x="' + x(w) + '" y="' + (4.5 + i * 4.3) + '" width="' + w + '" height="2" rx="1"/>';
    }).join('');
    return '    <button type="button" class="rb-format__btn rb-format__btn--icon" data-rb-fmt="' + which + '"' +
      ' aria-label="' + label + '" title="' + label + '">' +
      '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true">' +
      bars + '</svg></button>';
  }

  // Annotation colour. Three is enough to be legible on a plan, a photo or
  // white paper without becoming a palette.
  function colorSwatches() {
    var api = window.ToolboxReportOverlay;
    // Fallback only if report-overlay.js has not loaded. It is the same five,
    // because a stale copy here silently reinstates a palette nobody chose.
    var colors = (api && api.COLORS) || ['#c14a2b', '#111111', '#1d4ed8', '#16a34a', '#ea7317'];
    return colors.map(function (c, i) {
      return '    <button type="button" class="rb-format__swatch' + (i === 0 ? ' is-on' : '') +
        '" data-rb-ov-color="' + c + '" style="background:' + c + '"' +
        ' aria-label="Annotation colour" title="Annotation colour"></button>';
    }).join('');
  }

  function spacingMenu() {
    var items = LINE_SPACING.map(function (opt) {
      if (opt.value === 'sep') return '<span class="rb-format__sep"></span>';
      return '<button type="button" class="rb-format__item" data-rb-pick="spacing"' +
        ' data-rb-spacing="' + opt.value + '"' +
        ' data-rb-value="' + opt.value + '">' + opt.label + '</button>';
    }).join('');
    return (
      '    <span class="rb-format__menu" data-rb-menu="spacing">' +
      '      <button type="button" class="rb-format__btn" data-rb-open="spacing"' +
      '        aria-haspopup="true" aria-expanded="false" aria-label="Line spacing"' +
      '        title="Line spacing">' + ICONS.spacing +
      '        <span class="rb-format__caret" aria-hidden="true">&#9662;</span></button>' +
      '      <span class="rb-format__list" data-rb-list="spacing" hidden>' + items + '</span>' +
      '    </span>'
    );
  }

  function html() {
    return (
      '<div class="rb-format" role="toolbar" aria-label="Formatting">' +
      '  <span class="rb-format__group rb-format__group--history">' +
      '    <button type="button" class="rb-format__btn rb-format__btn--icon" data-rb-history="undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>' + ICONS.undo + '</button>' +
      '    <button type="button" class="rb-format__btn rb-format__btn--icon" data-rb-history="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled>' + ICONS.redo + '</button>' +
      '  </span>' +
      '  <span class="rb-format__group">' +
      menu('font', FONTS, 'Calibri', 'Font', 104) +
      menu('size', SIZES, 14, 'Font size', 52) +
      iconBtn('data-rb-fmt', 'grow', 'Increase font size') +
      iconBtn('data-rb-fmt', 'shrink', 'Decrease font size') +
      '  </span>' +
      '  <span class="rb-format__group">' +
      '    <button type="button" class="rb-format__btn rb-format__btn--b" data-rb-fmt="bold" aria-label="Bold" title="Bold">B</button>' +
      '    <button type="button" class="rb-format__btn rb-format__btn--i" data-rb-fmt="italic" aria-label="Italic" title="Italic">I</button>' +
      '    <button type="button" class="rb-format__btn rb-format__btn--u" data-rb-fmt="underline" aria-label="Underline" title="Underline">U</button>' +
      '  </span>' +
      '  <span class="rb-format__group">' +
      iconBtn('data-rb-fmt', 'bullet', 'Bullets') +
      iconBtn('data-rb-fmt', 'outdent', 'Decrease indent') +
      iconBtn('data-rb-fmt', 'indent', 'Increase indent') +
      '  </span>' +
      '  <span class="rb-format__group">' +
      alignButton('left', 'Align left') +
      alignButton('center', 'Align center') +
      alignButton('right', 'Align right') +
      iconBtn('data-rb-fmt', 'dir', 'Text direction') +
      spacingMenu() +
      '  </span>' +
      // Distress Survey's drawing toolbar, in its order: pencil, rectangle,
      // circle, arrow, text, eraser, then weights, then colours. Text and
      // Picture stay click-to-insert because Report Builder's text annotation
      // is rich text on the report's own model -- formattable with this whole
      // bar -- where Distress's is a plain string in a drawn box. Porting that
      // would be a downgrade.
      '  <span class="rb-format__group rb-format__group--draw">' +
      iconBtn('data-rb-tool', 'pencil', 'Pencil', 'Pencil') +
      iconBtn('data-rb-tool', 'rect', 'Rectangle', 'Rectangle') +
      iconBtn('data-rb-tool', 'circle', 'Circle', 'Circle') +
      iconBtn('data-rb-tool', 'arrow', 'Arrow — drag to point', 'Arrow') +
      iconBtn('data-rb-insert', 'text', 'Insert text box', 'Text box') +
      iconBtn('data-rb-tool', 'eraser', 'Eraser — click a mark', 'Eraser') +
      iconBtn('data-rb-insert', 'image', 'Insert picture', 'Picture') +
      '  </span>' +
      '  <span class="rb-format__group rb-format__group--ink">' +
      thickButton(1, 'Thin') +
      thickButton(2, 'Medium') +
      thickButton(3, 'Thick') +
      colorSwatches() +
      '  </span>' +
      '  <span class="rb-format__hint" data-rb-fmt-hint>Select text on the sheet to format it.</span>' +
      '</div>'
    );
  }

  // The toolbar must not steal the selection when it is clicked, or the
  // command would apply to nothing.
  function hold(event) { event.preventDefault(); }

  function run(command, field) {
    switch (command) {
      case 'bold': exec('bold'); break;
      case 'italic': exec('italic'); break;
      case 'underline': exec('underline'); break;
      case 'bullet': toggleBullet(field); break;
      case 'left': exec('justifyLeft'); break;
      case 'center': exec('justifyCenter'); break;
      case 'right': exec('justifyRight'); break;
      case 'indent': stepIndent(field, 1); break;
      case 'outdent': stepIndent(field, -1); break;
      case 'dir': toggleDirection(field); break;
      default: return false;
    }
    return true;
  }

  function setArmedTool(name) {
    armedTool = name || null;
    var bars = document.querySelectorAll('[data-rb-format-host] .rb-format');
    for (var b = 0; b < bars.length; b += 1) {
      var btns = bars[b].querySelectorAll('[data-rb-tool]');
      for (var i = 0; i < btns.length; i += 1) {
        btns[i].classList.toggle('is-on', btns[i].getAttribute('data-rb-tool') === armedTool);
      }
    }
  }

  function setThick(level) {
    thickLevel = level;
    var bars = document.querySelectorAll('[data-rb-format-host] .rb-format');
    for (var b = 0; b < bars.length; b += 1) {
      var btns = bars[b].querySelectorAll('[data-rb-thick]');
      for (var i = 0; i < btns.length; i += 1) {
        btns[i].classList.toggle('is-on', Number(btns[i].getAttribute('data-rb-thick')) === thickLevel);
      }
    }
  }

  function mount(root, options) {
    var host = root.querySelector('[data-rb-format-host]');
    if (!host) return null;
    host.innerHTML = html();
    var bar = host.querySelector('.rb-format');
    var onChange = (options && options.onChange) || function () {};
    var hint = bar.querySelector('[data-rb-fmt-hint]');

    function closeMenus() {
      var lists = bar.querySelectorAll('[data-rb-list]');
      for (var i = 0; i < lists.length; i += 1) lists[i].hidden = true;
      var opens = bar.querySelectorAll('[data-rb-open]');
      for (var j = 0; j < opens.length; j += 1) opens[j].setAttribute('aria-expanded', 'false');
    }

    // Which line spacing and space-after the selection already has. Without
    // this, choosing Single when the text is already Single looks like the
    // control doing nothing.
    function markCurrentSpacing(field) {
      var items = bar.querySelectorAll('[data-rb-spacing]');
      for (var i = 0; i < items.length; i += 1) items[i].removeAttribute('aria-current');
      if (!field) return;
      var blocks = blocksInSelection(field);
      if (!blocks.length) return;
      var block = blocks[0];
      var single = singleForBlock(block);
      var cs = window.getComputedStyle(block);
      var size = parseFloat(cs.fontSize) || 16;
      var lh = parseFloat(cs.lineHeight);
      if (isFinite(lh) && size) {
        var multiple = (lh / size) / single;
        var nearest = null;
        var best = 0.08;
        [1, 1.15, 1.25, 1.5, 2].forEach(function (v) {
          var d = Math.abs(multiple - v);
          if (d < best) { best = d; nearest = v; }
        });
        if (nearest !== null) {
          var el = bar.querySelector('[data-rb-spacing="lh:' + nearest + '"]');
          if (el) el.setAttribute('aria-current', 'true');
        }
      }
      var mb = parseFloat(cs.marginBottom);
      var hasSpace = isFinite(mb) && mb > 1;
      var saEl = bar.querySelector('[data-rb-spacing="' + (hasSpace ? 'sa:9' : 'sa:0') + '"]');
      if (saEl) saEl.setAttribute('aria-current', 'true');
    }

    function setCurrent(kind, value) {
      var label = bar.querySelector('[data-rb-current="' + kind + '"]');
      if (label) label.textContent = value;
      var items = bar.querySelectorAll('[data-rb-pick="' + kind + '"]');
      for (var i = 0; i < items.length; i += 1) {
        if (String(items[i].getAttribute('data-rb-value')) === String(value)) {
          items[i].setAttribute('aria-current', 'true');
        } else {
          items[i].removeAttribute('aria-current');
        }
      }
    }

    function refresh() {
      var field = currentField();
      bar.classList.toggle('is-ready', !!field);
      if (hint) hint.textContent = field ? '' : 'Select text on the sheet to format it.';
      var state = selectionState(field);
      ['bold', 'italic', 'underline', 'bullet'].forEach(function (k) {
        var btn = bar.querySelector('[data-rb-fmt="' + k + '"]');
        if (btn) btn.classList.toggle('is-on', !!state[k]);
      });
      ['left', 'center', 'right'].forEach(function (k) {
        var btn = bar.querySelector('[data-rb-fmt="' + k + '"]');
        if (btn) btn.classList.toggle('is-on', state.align === k);
      });
      markCurrentSpacing(field);
      if (state.size && SIZES.indexOf(parseInt(state.size, 10)) !== -1) setCurrent('size', state.size);
      if (state.font && FONTS.indexOf(state.font) !== -1) setCurrent('font', state.font);
    }

    bar.addEventListener('mousedown', hold);
    bar.addEventListener('touchstart', hold, { passive: false });

    bar.addEventListener('click', function (event) {
      var swatch = event.target.closest('[data-rb-ov-color]');
      if (swatch) {
        event.preventDefault();
        var swatches = bar.querySelectorAll('[data-rb-ov-color]');
        for (var s = 0; s < swatches.length; s += 1) swatches[s].classList.remove('is-on');
        swatch.classList.add('is-on');
        if (typeof options.onColor === 'function') {
          options.onColor(swatch.getAttribute('data-rb-ov-color'));
        }
        return;
      }
      var hist = event.target.closest('[data-rb-history]');
      if (hist) {
        event.preventDefault();
        if (hist.disabled) return;
        if (typeof options.onHistory === 'function') {
          options.onHistory(hist.getAttribute('data-rb-history'));
        }
        return;
      }
      var tool = event.target.closest('[data-rb-tool]');
      if (tool) {
        event.preventDefault();
        var want = tool.getAttribute('data-rb-tool');
        // Clicking the armed tool again puts it away, as Distress does.
        var next = armedTool === want ? null : want;
        setArmedTool(next);
        if (typeof options.onTool === 'function') options.onTool(next);
        return;
      }
      var thick = event.target.closest('[data-rb-thick]');
      if (thick) {
        event.preventDefault();
        var level = Number(thick.getAttribute('data-rb-thick')) || 2;
        setThick(level);
        if (typeof options.onThick === 'function') options.onThick(level);
        return;
      }
      var insert = event.target.closest('[data-rb-insert]');
      if (insert) {
        event.preventDefault();
        // Placing a box is not drawing, so it puts the pen down.
        if (armedTool) {
          setArmedTool(null);
          if (typeof options.onTool === 'function') options.onTool(null);
        }
        if (typeof options.onInsert === 'function') {
          options.onInsert(insert.getAttribute('data-rb-insert'));
        }
        return;
      }
      var btn = event.target.closest('button[data-rb-fmt]');
      if (!btn) return;
      event.preventDefault();
      var field = currentField() || activeField;
      if (!field) return;
      restoreSelection();
      var command = btn.getAttribute('data-rb-fmt');
      if (command === 'grow' || command === 'shrink') {
        var state = selectionState(field);
        var now = parseInt(state.size, 10);
        if (!isFinite(now)) now = 14;
        var index = SIZES.indexOf(now);
        if (index === -1) {
          index = 0;
          for (var i = 0; i < SIZES.length; i += 1) if (SIZES[i] <= now) index = i;
        }
        var next = SIZES[Math.max(0, Math.min(SIZES.length - 1, index + (command === 'grow' ? 1 : -1)))];
        setSize(field, next);
        setCurrent('size', next);
      } else if (!run(command, field)) {
        return;
      } else {
        rememberSelection();
      }
      onChange(field);
      refresh();
    });

    bar.addEventListener('click', function (event) {
      var opener = event.target.closest('[data-rb-open]');
      if (opener) {
        event.preventDefault();
        var kind = opener.getAttribute('data-rb-open');
        var list = bar.querySelector('[data-rb-list="' + kind + '"]');
        var wasOpen = list && !list.hidden;
        closeMenus();
        if (list && !wasOpen) {
          list.hidden = false;
          opener.setAttribute('aria-expanded', 'true');
        }
        return;
      }
      var pick = event.target.closest('[data-rb-pick]');
      if (!pick) return;
      event.preventDefault();
      closeMenus();
      var which = pick.getAttribute('data-rb-pick');
      var value = pick.getAttribute('data-rb-value');
      var field = currentField() || activeField;
      if (!field) return;
      if (which === 'size') setSize(field, parseFloat(value));
      else if (which === 'spacing') applySpacing(field, value);
      else setFont(field, value);
      if (which !== 'spacing') setCurrent(which, value);
      onChange(field);
      refresh();
    });

    document.addEventListener('mousedown', function (event) {
      if (!event.target.closest || !event.target.closest('.rb-format__menu')) closeMenus();
    });

    function onSelectionChange() {
      rememberSelection();
      refresh();
    }
    document.addEventListener('selectionchange', onSelectionChange);
    refresh();
    // The bar is rebuilt whenever pages re-render, so paint the armed tool and
    // the chosen weight back onto the fresh buttons.
    setArmedTool(armedTool);
    setThick(thickLevel);

    return {
      refresh: refresh,
      /** The armed tool, or null. Report Builder disarms on page change and
       *  on unmount -- a sheet left armed is a sheet nobody can click. */
      armedTool: function () { return armedTool; },
      setTool: function (name) { setArmedTool(name); },
      thick: function () { return thickLevel; },
      setHistory: function (canUndo, canRedo) {
        var u = bar.querySelector('[data-rb-history="undo"]');
        var r = bar.querySelector('[data-rb-history="redo"]');
        if (u) u.disabled = !canUndo;
        if (r) r.disabled = !canRedo;
      },
      noteField: function (field) { activeField = field || null; refresh(); },
      destroy: function () { document.removeEventListener('selectionchange', onSelectionChange); },
    };
  }

  window.ToolboxReportToolbar = {
    mount: mount,
    FONTS: FONTS,
    SIZES: SIZES,
    currentField: currentField,
  };
})();
