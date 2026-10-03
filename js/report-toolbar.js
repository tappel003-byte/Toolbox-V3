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

  var activeField = null;

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
    exec('styleWithCSS', 'false');
    apply();
    var legacy = field.querySelectorAll('font');
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
    }
  }

  function setSize(field, pt) {
    if (!field || !isFinite(pt) || pt <= 0) return;
    applyInline(field, function () {
      exec('fontSize', SIZE_MARKER);
      var marked = field.querySelectorAll('font[size="' + SIZE_MARKER + '"]');
      for (var i = 0; i < marked.length; i += 1) marked[i].setAttribute('data-rb-pt', pt);
    });
  }

  function setFont(field, family) {
    if (!field || !family) return;
    applyInline(field, function () { exec('fontName', family); });
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
      var node = sel.getRangeAt(0).commonAncestorContainer;
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

  function optionList(values, selected) {
    return values.map(function (v) {
      return '<option value="' + v + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + v + '</option>';
    }).join('');
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

  function html() {
    return (
      '<div class="rb-format" role="toolbar" aria-label="Formatting">' +
      '  <span class="rb-format__group">' +
      '    <select class="rb-format__font" data-rb-fmt="font" aria-label="Font">' +
      optionList(FONTS, 'Calibri') +
      '    </select>' +
      '    <select class="rb-format__size" data-rb-fmt="size" aria-label="Font size">' +
      optionList(SIZES, 14) +
      '    </select>' +
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
    var sizeSel = bar.querySelector('[data-rb-fmt="size"]');
    var fontSel = bar.querySelector('[data-rb-fmt="font"]');
    var hint = bar.querySelector('[data-rb-fmt-hint]');

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
      if (state.size && sizeSel && SIZES.indexOf(parseInt(state.size, 10)) !== -1) sizeSel.value = state.size;
      if (state.font && fontSel && FONTS.indexOf(state.font) !== -1) fontSel.value = state.font;
    }

    bar.addEventListener('mousedown', hold);
    bar.addEventListener('touchstart', hold, { passive: false });

    bar.addEventListener('click', function (event) {
      var btn = event.target.closest('button[data-rb-fmt]');
      if (!btn) return;
      event.preventDefault();
      var field = currentField();
      if (!field) return;
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
      } else if (!run(command, field)) {
        return;
      }
      onChange(field);
      refresh();
    });

    [sizeSel, fontSel].forEach(function (select) {
      if (!select) return;
      select.addEventListener('change', function () {
        var field = currentField();
        if (!field) return;
        if (select === sizeSel) setSize(field, parseFloat(select.value));
        else setFont(field, select.value);
        onChange(field);
        refresh();
      });
    });

    document.addEventListener('selectionchange', refresh);
    refresh();

    return {
      refresh: refresh,
      noteField: function (field) { activeField = field || null; refresh(); },
      destroy: function () { document.removeEventListener('selectionchange', refresh); },
    };
  }

  window.ToolboxReportToolbar = {
    mount: mount,
    FONTS: FONTS,
    SIZES: SIZES,
    currentField: currentField,
  };
})();
