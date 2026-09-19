// Toolbox — Room verify overlay adapted from field-reporter-pro.
// Proven interactions: openRoomVerify, room badges, FD place/drag/remove,
// room name picker scoped by building type. OCR is not included.
//
// Call ToolboxRoomVerify.open(ctx) where ctx provides:
//   getPlan() -> { dataUrl, width, height }
//   getRooms() / setRooms(rooms)
//   getFrontDoor() / setFrontDoor({x,y}|null)
//   getBuildingType() -> string
//   onChange() -> persist + refresh parent UI

(function () {
  'use strict';

  let ctx = null;
  let rvState = { scale: 1, tx: 0, ty: 0, minScale: 0.1 };
  let fdMode = false;
  let gesturesWired = false;

  function ensureDom() {
    if (document.getElementById('roomVerifyOverlay')) return;
    const overlay = document.createElement('div');
    overlay.id = 'roomVerifyOverlay';
    overlay.className = 'rv-overlay';
    overlay.innerHTML =
      '<div class="rv-head">' +
      '  <span id="rvTitle">Rooms — pinch zoom, drag move, tap plan to add</span>' +
      '  <button type="button" class="rv-btn" id="rvCloseBtn" aria-label="Done">Done</button>' +
      '</div>' +
      '<div class="rv-stage" id="rvStage">' +
      '  <div class="rv-content" id="rvWrap">' +
      '    <img id="rvImg" alt="Floor plan" draggable="false">' +
      '  </div>' +
      '</div>' +
      '<button type="button" class="rv-btn" id="rvFdBtn" aria-label="Place front door" title="Place FD marker · drag onto plan">FD</button>';
    document.body.appendChild(overlay);

    const picker = document.createElement('div');
    picker.id = 'rvPicker';
    picker.className = 'rv-picker';
    picker.innerHTML =
      '<div class="rv-picker-card">' +
      '  <h3 id="rvPickerTitle">Add room</h3>' +
      '  <div id="rvPickerActions" class="rv-pk-actions"></div>' +
      '  <div id="rvPickerGrid" class="rv-picker-grid"></div>' +
      '</div>';
    document.body.appendChild(picker);

    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.getElementById('rvCloseBtn').addEventListener('click', close);
    picker.addEventListener('click', function (e) {
      if (e.target === picker) picker.classList.remove('open');
    });
  }

  function plan() {
    return ctx && ctx.getPlan ? ctx.getPlan() : null;
  }

  function rooms() {
    return (ctx && ctx.getRooms ? ctx.getRooms() : null) || [];
  }

  function setRooms(list) {
    if (ctx && ctx.setRooms) ctx.setRooms(list);
  }

  function frontDoor() {
    return ctx && ctx.getFrontDoor ? ctx.getFrontDoor() : null;
  }

  function setFrontDoor(fd) {
    if (ctx && ctx.setFrontDoor) ctx.setFrontDoor(fd);
  }

  function buildingType() {
    return (ctx && ctx.getBuildingType ? ctx.getBuildingType() : null) || 'residential';
  }

  function notify() {
    if (ctx && ctx.onChange) ctx.onChange();
  }

  function fitToStage() {
    const stage = document.getElementById('rvStage');
    const p = plan();
    if (!stage || !p) return;
    const sw = stage.clientWidth;
    const sh = stage.clientHeight;
    const iw = p.width;
    const ih = p.height;
    if (!sw || !sh || !iw || !ih) return;
    const fit = Math.min(sw / iw, sh / ih);
    rvState.minScale = fit * 0.5;
    rvState.scale = fit;
    rvState.tx = (sw - iw * fit) / 2;
    rvState.ty = (sh - ih * fit) / 2;
  }

  function applyTransform() {
    const el = document.getElementById('rvWrap');
    if (!el) return;
    el.style.transform = 'translate(' + rvState.tx + 'px,' + rvState.ty + 'px) scale(' + rvState.scale + ')';
  }

  function zoomBy(factor, cx, cy) {
    const s = Math.max(rvState.minScale, Math.min(12, rvState.scale * factor));
    const r = document.getElementById('rvStage').getBoundingClientRect();
    const x = (cx - r.left) - rvState.tx;
    const y = (cy - r.top) - rvState.ty;
    rvState.tx -= x * (s / rvState.scale - 1);
    rvState.ty -= y * (s / rvState.scale - 1);
    rvState.scale = s;
    applyTransform();
  }

  function pointToPlan(cx, cy) {
    const stage = document.getElementById('rvStage');
    const p = plan();
    if (!stage || !p) return null;
    const r = stage.getBoundingClientRect();
    const x = ((cx - r.left) - rvState.tx) / rvState.scale / p.width;
    const y = ((cy - r.top) - rvState.ty) / rvState.scale / p.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x: x, y: y };
  }

  function attachFdDrag(el, onTap) {
    if (!el || el._fdDragWired) return;
    el._fdDragWired = true;
    let st = null;
    let ghost = null;
    const removeGhost = function () {
      if (ghost) { ghost.remove(); ghost = null; }
    };
    const moveGhost = function (x, y) {
      if (!ghost) {
        ghost = document.createElement('div');
        ghost.className = 'rv-fd';
        ghost.textContent = 'FD';
        ghost.style.position = 'fixed';
        ghost.style.pointerEvents = 'none';
        ghost.style.zIndex = '9999';
        ghost.style.opacity = '.9';
        document.body.appendChild(ghost);
      }
      ghost.style.left = x + 'px';
      ghost.style.top = y + 'px';
    };
    el.addEventListener('pointerdown', function (e) {
      e.stopPropagation();
      e.preventDefault();
      if (!plan()) return;
      st = { id: e.pointerId, sx: e.clientX, sy: e.clientY, moved: false };
      try { el.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    el.addEventListener('pointermove', function (e) {
      if (!st || e.pointerId !== st.id) return;
      e.stopPropagation();
      if (!st.moved && Math.hypot(e.clientX - st.sx, e.clientY - st.sy) < 6) return;
      st.moved = true;
      moveGhost(e.clientX, e.clientY);
    });
    const finish = function (e) {
      if (!st || e.pointerId !== st.id) return;
      e.stopPropagation();
      const moved = st.moved;
      st = null;
      removeGhost();
      try { el.releasePointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      if (!moved) { if (onTap) onTap(); return; }
      const pt = pointToPlan(e.clientX, e.clientY);
      if (!pt) return;
      setFrontDoor({ x: pt.x, y: pt.y });
      fdMode = false;
      const btn = document.getElementById('rvFdBtn');
      if (btn) btn.classList.remove('active');
      const title = document.getElementById('rvTitle');
      if (title) title.textContent = 'Rooms — pinch zoom, drag move, tap plan to add';
      renderBadges();
      notify();
    };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', function (e) {
      if (st && e.pointerId === st.id) { st = null; removeGhost(); }
    });
  }

  function toggleFdMode() {
    if (!plan()) return;
    fdMode = !fdMode;
    const btn = document.getElementById('rvFdBtn');
    const title = document.getElementById('rvTitle');
    if (btn) btn.classList.toggle('active', fdMode);
    if (title) {
      title.textContent = fdMode
        ? 'Tap the plan where the FRONT DOOR is'
        : 'Rooms — pinch zoom, drag move, tap plan to add';
    }
  }

  function removeFrontDoor() {
    if (confirm('Remove the front door marker?')) {
      setFrontDoor(null);
      renderBadges();
      notify();
    }
  }

  function pickRoomName(currentName, onPick, onDelete) {
    const BT = window.ToolboxBuildingTypes;
    const ov = document.getElementById('rvPicker');
    const grid = document.getElementById('rvPickerGrid');
    const title = document.getElementById('rvPickerTitle');
    const actions = document.getElementById('rvPickerActions');
    const type = buildingType();
    const label = BT.typeLabel(type);
    title.textContent = (currentName ? 'Edit room' : 'Add room') + ' — ' + label;
    grid.innerHTML = '';

    function mkRoomBtn(n, opts) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = n;
      btn.onclick = function () { ov.classList.remove('open'); onPick(n); };
      if (opts && opts.saved) {
        btn.title = 'Saved room — long-press to remove from saved list';
        let pressTimer = null;
        const startPress = function () {
          pressTimer = setTimeout(function () {
            pressTimer = 'fired';
            if (confirm('Remove "' + n + '" from ' + label + ' saved rooms?\n(Existing rooms on the plan are not affected.)')) {
              BT.removeCustomRoom(n, type);
              pickRoomName(currentName, onPick, onDelete);
            }
          }, 600);
        };
        const cancelPress = function () {
          if (pressTimer && pressTimer !== 'fired') clearTimeout(pressTimer);
          pressTimer = null;
        };
        btn.addEventListener('pointerdown', startPress);
        btn.addEventListener('pointerup', cancelPress);
        btn.addEventListener('pointerleave', cancelPress);
        btn.addEventListener('pointercancel', cancelPress);
        btn.addEventListener('click', function (e) {
          if (pressTimer === 'fired') {
            e.stopImmediatePropagation();
            e.preventDefault();
            pressTimer = null;
          }
        }, true);
      }
      return btn;
    }

    function mkHeader(text) {
      const h = document.createElement('div');
      h.className = 'rv-picker-header';
      h.textContent = text;
      return h;
    }

    const common = BT.getCommonRooms(type);
    const specialty = BT.getSpecialtyRooms(type);
    const customs = BT.getCustomRooms(type);

    if (common.length) {
      const h = mkHeader('Common');
      h.style.borderTop = 'none';
      h.style.marginTop = '0';
      grid.appendChild(h);
      common.forEach(function (n) { grid.appendChild(mkRoomBtn(n)); });
    }
    if (customs.length) {
      grid.appendChild(mkHeader('Saved (' + label + ')'));
      customs.forEach(function (n) { grid.appendChild(mkRoomBtn(n, { saved: true })); });
    }
    if (specialty.length) {
      grid.appendChild(mkHeader('All rooms'));
      specialty.forEach(function (n) { grid.appendChild(mkRoomBtn(n)); });
    }

    const other = document.createElement('button');
    other.type = 'button';
    other.textContent = '+ Other / new room…';
    other.style.gridColumn = '1 / -1';
    other.onclick = function () {
      const n = prompt('Room name:', currentName || '');
      if (!n || !n.trim()) return;
      const name = n.trim();
      const save = confirm('Save "' + name + '" to your ' + label + ' room list for future ' + label + ' projects?');
      if (save) BT.saveCustomRoom(name, type);
      ov.classList.remove('open');
      onPick(name);
    };
    grid.appendChild(other);

    actions.innerHTML = '';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.onclick = function () { ov.classList.remove('open'); };
    actions.appendChild(cancel);
    if (onDelete) {
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete';
      del.className = 'danger';
      del.onclick = function () { ov.classList.remove('open'); onDelete(); };
      actions.appendChild(del);
    }
    ov.classList.add('open');
  }

  function addRoomAt(cx, cy) {
    const p = plan();
    if (!p) return;
    const stage = document.getElementById('rvStage');
    const r = stage.getBoundingClientRect();
    const x = ((cx - r.left) - rvState.tx) / rvState.scale / p.width;
    const y = ((cy - r.top) - rvState.ty) / rvState.scale / p.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return;
    if (fdMode) {
      setFrontDoor({ x: x, y: y });
      fdMode = false;
      const btn = document.getElementById('rvFdBtn');
      if (btn) btn.classList.remove('active');
      const title = document.getElementById('rvTitle');
      if (title) title.textContent = 'Rooms — pinch zoom, drag move, tap plan to add';
      renderBadges();
      notify();
      return;
    }
    pickRoomName('', function (name) {
      const list = rooms().slice();
      list.push({ name: name, x: x, y: y });
      setRooms(list);
      renderBadges();
      notify();
    });
  }

  function editRoom(idx) {
    const list = rooms().slice();
    const room = list[idx];
    if (!room) return;
    pickRoomName(room.name, function (name) {
      list[idx] = { name: name, x: room.x, y: room.y };
      setRooms(list);
      renderBadges();
      notify();
    }, function () {
      list.splice(idx, 1);
      setRooms(list);
      renderBadges();
      notify();
    });
  }

  function renderBadges() {
    const wrap = document.getElementById('rvWrap');
    if (!wrap) return;
    Array.from(wrap.querySelectorAll('.rv-badge, .rv-fd')).forEach(function (b) { b.remove(); });
    rooms().forEach(function (room, idx) {
      const b = document.createElement('div');
      b.className = 'rv-badge';
      b.textContent = room.name;
      b.style.left = (room.x * 100) + '%';
      b.style.top = (room.y * 100) + '%';
      b.addEventListener('pointerdown', function (e) { e.stopPropagation(); });
      b.addEventListener('pointerup', function (e) { e.stopPropagation(); });
      b.addEventListener('click', function (e) { e.stopPropagation(); editRoom(idx); });
      b.addEventListener('touchend', function (e) { e.stopPropagation(); });
      wrap.appendChild(b);
    });
    const fd = frontDoor();
    if (fd && typeof fd.x === 'number' && typeof fd.y === 'number') {
      const el = document.createElement('div');
      el.className = 'rv-fd';
      el.textContent = 'FD';
      el.title = 'Front door — drag to move, tap to remove';
      el.style.left = (fd.x * 100) + '%';
      el.style.top = (fd.y * 100) + '%';
      el.addEventListener('touchend', function (e) { e.stopPropagation(); });
      attachFdDrag(el, removeFrontDoor);
      wrap.appendChild(el);
    }
  }

  function initGestures() {
    const stage = document.getElementById('rvStage');
    if (!stage || gesturesWired) return;
    gesturesWired = true;
    const pointers = new Map();
    let pinch = null;
    let drag = null;
    let tap = null;
    const isControl = function (target) {
      return target && target.closest && (
        target.closest('button') ||
        target.closest('.rv-badge') ||
        target.closest('.rv-fd') ||
        target.closest('.rv-picker')
      );
    };
    const beginPinch = function () {
      const pts = Array.from(pointers.values());
      if (pts.length < 2) { pinch = null; return; }
      const a = pts[0];
      const b = pts[1];
      const rect = stage.getBoundingClientRect();
      const cx = (a.x + b.x) / 2 - rect.left;
      const cy = (a.y + b.y) / 2 - rect.top;
      pinch = {
        dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
        scale: rvState.scale,
        contentX: (cx - rvState.tx) / rvState.scale,
        contentY: (cy - rvState.ty) / rvState.scale,
      };
      drag = null;
      tap = null;
    };
    stage.addEventListener('pointerdown', function (e) {
      if (isControl(e.target)) return;
      e.preventDefault();
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) { beginPinch(); return; }
      drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, tx: rvState.tx, ty: rvState.ty, moved: false };
      tap = { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
    });
    stage.addEventListener('pointermove', function (e) {
      if (!pointers.has(e.pointerId)) return;
      e.preventDefault();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size >= 2) {
        if (!pinch) beginPinch();
        const pts = Array.from(pointers.values());
        const a = pts[0];
        const b = pts[1];
        const dist = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
        const scale = Math.max(rvState.minScale, Math.min(12, pinch.scale * (dist / pinch.dist)));
        const rect = stage.getBoundingClientRect();
        const cx = (a.x + b.x) / 2 - rect.left;
        const cy = (a.y + b.y) / 2 - rect.top;
        rvState.scale = scale;
        rvState.tx = cx - pinch.contentX * scale;
        rvState.ty = cy - pinch.contentY * scale;
        applyTransform();
        return;
      }
      if (drag && drag.id === e.pointerId) {
        const dx = e.clientX - drag.sx;
        const dy = e.clientY - drag.sy;
        if (Math.hypot(dx, dy) > 6) {
          drag.moved = true;
          if (tap) tap.moved = true;
        }
        rvState.tx = drag.tx + dx;
        rvState.ty = drag.ty + dy;
        applyTransform();
      }
    });
    const endPointer = function (e) {
      const wasTap = tap && tap.id === e.pointerId && !tap.moved && (Date.now() - tap.t) < 350;
      pointers.delete(e.pointerId);
      if (pointers.size >= 2) {
        beginPinch();
      } else if (pointers.size === 1) {
        pinch = null;
        const p = Array.from(pointers.entries())[0];
        drag = { id: p[0], sx: p[1].x, sy: p[1].y, tx: rvState.tx, ty: rvState.ty, moved: true };
        tap = null;
      } else {
        pinch = null;
        drag = null;
        if (wasTap) addRoomAt(e.clientX, e.clientY);
        tap = null;
      }
    };
    stage.addEventListener('pointerup', endPointer);
    stage.addEventListener('pointercancel', endPointer);
    stage.addEventListener('wheel', function (e) {
      e.preventDefault();
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX, e.clientY);
    }, { passive: false });
    stage.addEventListener('dblclick', function (e) {
      e.preventDefault();
      fitToStage();
      applyTransform();
    });
  }

  function open(context) {
    ctx = context;
    ensureDom();
    initGestures();
    const p = plan();
    if (!p || !p.dataUrl) return;
    const img = document.getElementById('rvImg');
    const wrap = document.getElementById('rvWrap');
    wrap.style.width = p.width + 'px';
    wrap.style.height = p.height + 'px';
    img.style.width = '100%';
    img.style.height = '100%';
    img.src = p.dataUrl;
    fdMode = false;
    const fdBtn = document.getElementById('rvFdBtn');
    if (fdBtn) {
      fdBtn.classList.remove('active');
      attachFdDrag(fdBtn, toggleFdMode);
    }
    const title = document.getElementById('rvTitle');
    if (title) title.textContent = 'Rooms — pinch zoom, drag move, tap plan to add';
    renderBadges();
    document.getElementById('roomVerifyOverlay').classList.add('open');
    requestAnimationFrame(function () {
      fitToStage();
      applyTransform();
    });
  }

  function close() {
    const ov = document.getElementById('roomVerifyOverlay');
    if (ov) ov.classList.remove('open');
    const pk = document.getElementById('rvPicker');
    if (pk) pk.classList.remove('open');
    fdMode = false;
  }

  window.ToolboxRoomVerify = {
    open: open,
    close: close,
  };
})();
