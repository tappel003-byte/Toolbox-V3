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
  var LINE_SPACING = [
    { value: 'lh:1', label: 'Single' },
    { value: 'lh:1.15', label: '1.15' },
    { value: 'lh:1.25', label: '1.25' },
    { value: 'lh:1.5', label: '1.5' },
    { value: 'lh:2', label: 'Double' },
    { value: 'sa:0', label: 'No space after' },
    { value: 'sa:9', label: 'Space after (9 pt)' },
  ];

  var activeField = null;
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
      state.bullet = document.queryCommandState('insertUnorderedList');
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
  function alignButton(which, label) {
    var rows = {
      left: [10, 6, 10, 7],
      center: [10, 6, 10, 7],
      right: [10, 6, 10, 7],
    }[which];
    var x = function (w) {
      if (which === 'center') return (12 - w / 2).toFixed(1);
      if (which === 'right') return (22 - w).toFixed(1);
      return '2';
    };
    var bars = rows.map(function (w, i) {
      return '<rect x="' + x(w) + '" y="' + (3 + i * 4.5) + '" width="' + w + '" height="2" rx="1"/>';
    }).join('');
    return '    <button type="button" class="rb-format__btn" data-rb-fmt="' + which + '"' +
      ' aria-label="' + label + '" title="' + label + '">' +
      '<svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true">' +
      bars + '</svg></button>';
  }

  // Annotation colour. Three is enough to be legible on a plan, a photo or
  // white paper without becoming a palette.
  function colorSwatches() {
    var api = window.ToolboxReportOverlay;
    var colors = (api && api.COLORS) || ['#c0392b', '#1a1a1a', '#e0a800'];
    return colors.map(function (c, i) {
      return '    <button type="button" class="rb-format__swatch' + (i === 0 ? ' is-on' : '') +
        '" data-rb-ov-color="' + c + '" style="background:' + c + '"' +
        ' aria-label="Annotation colour" title="Annotation colour"></button>';
    }).join('');
  }

  function spacingMenu() {
    var items = LINE_SPACING.map(function (opt) {
      return '<button type="button" class="rb-format__item" data-rb-pick="spacing"' +
        ' data-rb-value="' + opt.value + '">' + opt.label + '</button>';
    }).join('');
    return (
      '    <span class="rb-format__menu" data-rb-menu="spacing">' +
      '      <button type="button" class="rb-format__btn" data-rb-open="spacing"' +
      '        aria-haspopup="true" aria-expanded="false" aria-label="Line spacing"' +
      '        title="Line spacing">&#8597;&#9662;</button>' +
      '      <span class="rb-format__list" data-rb-list="spacing" hidden>' + items + '</span>' +
      '    </span>'
    );
  }

  function html() {
    return (
      '<div class="rb-format" role="toolbar" aria-label="Formatting">' +
      '  <span class="rb-format__group rb-format__group--history">' +
      '    <button type="button" class="rb-format__btn" data-rb-history="undo" aria-label="Undo" title="Undo (Ctrl+Z)" disabled>&#8630;</button>' +
      '    <button type="button" class="rb-format__btn" data-rb-history="redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled>&#8631;</button>' +
      '  </span>' +
      '  <span class="rb-format__group">' +
      menu('font', FONTS, 'Calibri', 'Font', 104) +
      menu('size', SIZES, 14, 'Font size', 52) +
      '    <button type="button" class="rb-format__btn" data-rb-fmt="grow" aria-label="Increase font size" title="Increase font size">A&#9652;</button>' +
      '    <button type="button" class="rb-format__btn" data-rb-fmt="shrink" aria-label="Decrease font size" title="Decrease font size">A&#9662;</button>' +
      '  </span>' +
      '  <span class="rb-format__group">' +
      '    <button type="button" class="rb-format__btn rb-format__btn--b" data-rb-fmt="bold" aria-label="Bold" title="Bold">B</button>' +
      '    <button type="button" class="rb-format__btn rb-format__btn--i" data-rb-fmt="italic" aria-label="Italic" title="Italic">I</button>' +
      '    <button type="button" class="rb-format__btn rb-format__btn--u" data-rb-fmt="underline" aria-label="Underline" title="Underline">U</button>' +
      '  </span>' +
      '  <span class="rb-format__group">' +
      '    <button type="button" class="rb-format__btn" data-rb-fmt="bullet" aria-label="Bullets" title="Bullets">&#8226;&#8212;</button>' +
      '    <button type="button" class="rb-format__btn" data-rb-fmt="outdent" aria-label="Decrease indent" title="Decrease indent">&#8676;</button>' +
      '    <button type="button" class="rb-format__btn" data-rb-fmt="indent" aria-label="Increase indent" title="Increase indent">&#8677;</button>' +
      '  </span>' +
      '  <span class="rb-format__group">' +
      alignButton('left', 'Align left') +
      alignButton('center', 'Align center') +
      alignButton('right', 'Align right') +
      '    <button type="button" class="rb-format__btn" data-rb-fmt="dir" aria-label="Text direction" title="Text direction">&#8644;</button>' +
      spacingMenu() +
      '  </span>' +
      '  <span class="rb-format__group rb-format__group--insert">' +
      '    <button type="button" class="rb-format__btn" data-rb-insert="text" aria-label="Insert text box" title="Text box">&#9647;T</button>' +
      '    <button type="button" class="rb-format__btn" data-rb-insert="ellipse" aria-label="Insert circle" title="Circle">&#9711;</button>' +
      '    <button type="button" class="rb-format__btn" data-rb-insert="arrow" aria-label="Insert arrow" title="Arrow">&#8599;</button>' +
      '    <button type="button" class="rb-format__btn" data-rb-insert="image" aria-label="Insert picture" title="Picture">&#9634;&#9679;</button>' +
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
      case 'bullet': exec('insertUnorderedList'); break;
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
      var insert = event.target.closest('[data-rb-insert]');
      if (insert) {
        event.preventDefault();
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

    return {
      refresh: refresh,
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
