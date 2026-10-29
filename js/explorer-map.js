// Toolbox — File Explorer map.
//
// The jobs the Cabinet holds, as pins on a map. Pan or zoom to an area and the
// jobs in it are listed under the map. Tiles come from Geoapify (the key in
// js/config.js, the same one the address search uses), so the map needs a
// network connection; nothing else in Toolbox does, and File Explorer already
// reads the server.
//
// A pin is drawn only where the job carries coordinates -- the property's
// latitude and longitude, captured when the address was picked or the
// device's location was used. A job without them is not placed anywhere;
// the caller lists it as having no location. Nothing here geocodes an address
// or guesses a position.
//
// A small map of our own rather than a library: square tiles, Web Mercator,
// drag, wheel, pinch and two buttons. It is the least that does the job, and
// it adds nothing to download or to keep up to date.

(function () {
  'use strict';

  const TILE = 256;
  const MIN_ZOOM = 3;
  const MAX_ZOOM = 18;
  const CLUSTER_PX = 46;
  const TILE_URL = 'https://maps.geoapify.com/v1/tile/osm-bright/';

  function apiKey() {
    return (window.ToolboxConfig && window.ToolboxConfig.geoapifyApiKey) || '';
  }

  function clamp(value, lo, hi) {
    return Math.max(lo, Math.min(hi, value));
  }

  /** Latitude/longitude to world pixels at a zoom. */
  function project(lat, lon, zoom) {
    const size = TILE * Math.pow(2, zoom);
    const sin = Math.sin(clamp(lat, -85.05112878, 85.05112878) * Math.PI / 180);
    return {
      x: (lon + 180) / 360 * size,
      y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * size,
    };
  }

  function unproject(x, y, zoom) {
    const size = TILE * Math.pow(2, zoom);
    const lon = x / size * 360 - 180;
    const n = Math.PI - 2 * Math.PI * y / size;
    const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
    return { lat: lat, lon: lon };
  }

  /** Is this a place on the Earth, and not the 0,0 an empty field leaves? */
  function hasPlace(job) {
    if (!job) return false;
    const lat = job.lat;
    const lon = job.lon;
    if (typeof lat !== 'number' || typeof lon !== 'number') return false;
    if (!isFinite(lat) || !isFinite(lon)) return false;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
    return !(lat === 0 && lon === 0);
  }

  function create(host, options) {
    const opts = options || {};
    const onView = typeof opts.onView === 'function' ? opts.onView : function () {};
    const onPick = typeof opts.onPick === 'function' ? opts.onPick : function () {};

    const root = document.createElement('div');
    root.className = 'explorer-map';
    const tilesEl = document.createElement('div');
    tilesEl.className = 'explorer-map__tiles';
    const pinsEl = document.createElement('div');
    pinsEl.className = 'explorer-map__pins';
    const zoomBox = document.createElement('div');
    zoomBox.className = 'explorer-map__zoom';
    const zoomIn = document.createElement('button');
    zoomIn.type = 'button';
    zoomIn.textContent = '+';
    zoomIn.setAttribute('aria-label', 'Zoom in');
    const zoomOut = document.createElement('button');
    zoomOut.type = 'button';
    zoomOut.textContent = '−';
    zoomOut.setAttribute('aria-label', 'Zoom out');
    zoomBox.appendChild(zoomIn);
    zoomBox.appendChild(zoomOut);
    const credit = document.createElement('p');
    credit.className = 'explorer-map__credit';
    credit.innerHTML = '<a href="https://www.geoapify.com/" target="_blank" rel="noopener">Powered by Geoapify</a> · ' +
      '<a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · ' +
      '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';
    const say = document.createElement('p');
    say.className = 'explorer-map__say';
    say.hidden = true;
    root.appendChild(tilesEl);
    root.appendChild(pinsEl);
    root.appendChild(zoomBox);
    root.appendChild(credit);
    root.appendChild(say);
    host.appendChild(root);

    // The continental United States until there are jobs to frame.
    let zoom = 4;
    let center = project(39, -98, zoom);
    let jobs = [];
    const tiles = new Map();
    let tileFailures = 0;
    let tileLoads = 0;
    let viewTimer = 0;
    let destroyed = false;
    const retina = (window.devicePixelRatio || 1) > 1.25;
    const key = apiKey();

    function size() {
      return { w: root.clientWidth || 1, h: root.clientHeight || 1 };
    }

    function message(text) {
      say.hidden = !text;
      say.textContent = text || '';
    }

    if (!key) message('The map needs a Geoapify key in Toolbox settings. The jobs are listed below.');
    else if (navigator.onLine === false) message('The map needs a network connection. The jobs are listed below.');

    function tileUrl(z, x, y) {
      return TILE_URL + z + '/' + x + '/' + y + (retina ? '@2x' : '') + '.png?apiKey=' + encodeURIComponent(key);
    }

    function drawTiles() {
      if (!key) return;
      const view = size();
      const left = center.x - view.w / 2;
      const top = center.y - view.h / 2;
      const count = Math.pow(2, zoom);
      const x0 = Math.floor(left / TILE);
      const x1 = Math.floor((left + view.w) / TILE);
      const y0 = Math.max(0, Math.floor(top / TILE));
      const y1 = Math.min(count - 1, Math.floor((top + view.h) / TILE));
      const wanted = new Set();
      for (let ty = y0; ty <= y1; ty++) {
        for (let tx = x0; tx <= x1; tx++) {
          const wrapped = ((tx % count) + count) % count;
          const id = zoom + '/' + tx + '/' + ty;
          wanted.add(id);
          let img = tiles.get(id);
          if (!img) {
            img = document.createElement('img');
            img.className = 'explorer-map__tile';
            img.alt = '';
            img.draggable = false;
            img.decoding = 'async';
            img.onload = function () { tileLoads += 1; if (say.dataset.tiles) message(''); };
            img.onerror = function () {
              tileFailures += 1;
              if (!tileLoads && tileFailures >= 4) {
                say.dataset.tiles = '1';
                message('The map tiles could not be loaded. The pins and the list still work.');
              }
            };
            img.src = tileUrl(zoom, wrapped, ty);
            tiles.set(id, img);
            tilesEl.appendChild(img);
          }
          img.style.transform = 'translate(' + Math.round(tx * TILE - left) + 'px,' + Math.round(ty * TILE - top) + 'px)';
        }
      }
      tiles.forEach(function (img, id) {
        if (!wanted.has(id)) {
          img.remove();
          tiles.delete(id);
        }
      });
    }

    function screenOf(job) {
      const view = size();
      const p = project(job.lat, job.lon, zoom);
      const world = TILE * Math.pow(2, zoom);
      // The copy of the world nearest the centre, so a pin is not lost across
      // the date line.
      let x = p.x - center.x;
      if (x > world / 2) x -= world;
      if (x < -world / 2) x += world;
      return { x: x + view.w / 2, y: p.y - center.y + view.h / 2 };
    }

    /**
     * Pins closer than a fingertip become one numbered pin. Each job joins
     * the first group whose middle is within reach, so two pins never sit on
     * top of each other the way fixed grid cells let them at a cell edge.
     */
    function clusters() {
      const view = size();
      const groups = [];
      jobs.forEach(function (job) {
        const s = screenOf(job);
        if (s.x < -CLUSTER_PX || s.y < -CLUSTER_PX || s.x > view.w + CLUSTER_PX || s.y > view.h + CLUSTER_PX) return;
        let home = null;
        for (let i = 0; i < groups.length; i++) {
          const g = groups[i];
          if (Math.hypot(g.x - s.x, g.y - s.y) < CLUSTER_PX) { home = g; break; }
        }
        if (!home) {
          groups.push({ jobs: [job], sx: s.x, sy: s.y, x: s.x, y: s.y });
          return;
        }
        home.jobs.push(job);
        home.sx += s.x;
        home.sy += s.y;
        home.x = home.sx / home.jobs.length;
        home.y = home.sy / home.jobs.length;
      });
      return groups;
    }

    function drawPins() {
      pinsEl.innerHTML = '';
      clusters().forEach(function (group) {
        const pin = document.createElement('button');
        pin.type = 'button';
        const many = group.jobs.length > 1;
        pin.className = 'explorer-map__pin' + (many ? ' explorer-map__pin--many' : '');
        pin.style.transform = 'translate(' + Math.round(group.x) + 'px,' + Math.round(group.y) + 'px)';
        pin.textContent = many ? String(group.jobs.length) : '';
        pin.setAttribute('aria-label', many
          ? group.jobs.length + ' jobs here'
          : (group.jobs[0].displayName || 'Customer File'));
        pin.title = many ? group.jobs.length + ' jobs' : (group.jobs[0].displayName || '');
        pin.dataset.ids = group.jobs.map(function (job) { return job.id; }).join(' ');
        pin.addEventListener('click', function (event) {
          event.stopPropagation();
          // Several jobs on one spot: zoom in until they part, and once they
          // cannot part (the same house, or the closest zoom) list them.
          const samePlace = group.jobs.every(function (job) {
            return Math.abs(job.lat - group.jobs[0].lat) < 1e-6 && Math.abs(job.lon - group.jobs[0].lon) < 1e-6;
          });
          if (many && !samePlace && zoom < MAX_ZOOM) {
            zoomAt(Math.min(MAX_ZOOM, zoom + 2), group.x, group.y);
            return;
          }
          onPick(group.jobs.slice());
        });
        pinsEl.appendChild(pin);
      });
    }

    function inView() {
      const view = size();
      return jobs.filter(function (job) {
        const s = screenOf(job);
        return s.x >= 0 && s.y >= 0 && s.x <= view.w && s.y <= view.h;
      });
    }

    function render() {
      if (destroyed) return;
      drawTiles();
      drawPins();
      zoomIn.disabled = zoom >= MAX_ZOOM;
      zoomOut.disabled = zoom <= MIN_ZOOM;
      clearTimeout(viewTimer);
      viewTimer = setTimeout(function () {
        if (!destroyed) onView(inView());
      }, 120);
    }

    function zoomAt(next, sx, sy) {
      next = clamp(Math.round(next), MIN_ZOOM, MAX_ZOOM);
      if (next === zoom) return;
      const view = size();
      const px = sx == null ? view.w / 2 : sx;
      const py = sy == null ? view.h / 2 : sy;
      const at = unproject(center.x - view.w / 2 + px, center.y - view.h / 2 + py, zoom);
      const after = project(at.lat, at.lon, next);
      zoom = next;
      center = { x: after.x - (px - view.w / 2), y: after.y - (py - view.h / 2) };
      render();
    }

    zoomIn.addEventListener('click', function (event) { event.stopPropagation(); zoomAt(zoom + 1); });
    zoomOut.addEventListener('click', function (event) { event.stopPropagation(); zoomAt(zoom - 1); });

    // Drag with one finger or the mouse, pinch with two.
    const pointers = new Map();
    let pinchFrom = 0;
    let moved = false;
    root.addEventListener('pointerdown', function (event) {
      if (event.target.closest && event.target.closest('button, a')) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try { root.setPointerCapture(event.pointerId); } catch (_) {}
      moved = false;
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        pinchFrom = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      }
    });
    root.addEventListener('pointermove', function (event) {
      const prev = pointers.get(event.pointerId);
      if (!prev) return;
      const now = { x: event.clientX, y: event.clientY };
      if (pointers.size === 1) {
        center = { x: center.x - (now.x - prev.x), y: center.y - (now.y - prev.y) };
        if (Math.abs(now.x - prev.x) + Math.abs(now.y - prev.y) > 0) moved = true;
        pointers.set(event.pointerId, now);
        render();
        return;
      }
      pointers.set(event.pointerId, now);
      if (pointers.size === 2 && pinchFrom) {
        const pts = Array.from(pointers.values());
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const ratio = dist / pinchFrom;
        if (ratio > 1.6 || ratio < 0.62) {
          const box = root.getBoundingClientRect();
          zoomAt(zoom + (ratio > 1 ? 1 : -1), (pts[0].x + pts[1].x) / 2 - box.left, (pts[0].y + pts[1].y) / 2 - box.top);
          pinchFrom = dist;
        }
      }
    });
    const release = function (event) {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchFrom = 0;
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    root.addEventListener('dblclick', function (event) {
      if (event.target.closest && event.target.closest('button, a')) return;
      const box = root.getBoundingClientRect();
      zoomAt(zoom + 1, event.clientX - box.left, event.clientY - box.top);
    });
    let wheelAt = 0;
    root.addEventListener('wheel', function (event) {
      event.preventDefault();
      const stamp = Date.now();
      if (stamp - wheelAt < 220) return;
      wheelAt = stamp;
      const box = root.getBoundingClientRect();
      zoomAt(zoom + (event.deltaY < 0 ? 1 : -1), event.clientX - box.left, event.clientY - box.top);
    }, { passive: false });

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(function () { render(); });
      resizeObserver.observe(root);
    }

    /** Frame every located job, or keep the current view when there are none. */
    function fit() {
      if (!jobs.length) { render(); return; }
      const view = size();
      let best = MIN_ZOOM;
      for (let z = 15; z >= MIN_ZOOM; z--) {
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        jobs.forEach(function (job) {
          const p = project(job.lat, job.lon, z);
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        if (maxX - minX <= view.w - 80 && maxY - minY <= view.h - 80) { best = z; break; }
      }
      zoom = Math.min(best, 14);
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      jobs.forEach(function (job) {
        const p = project(job.lat, job.lon, zoom);
        minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
      });
      center = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
      render();
    }

    return {
      element: root,
      /** Only jobs with a real place are drawn; the rest are the caller's to list. */
      setJobs: function (list, refit) {
        jobs = (list || []).filter(hasPlace);
        if (refit) fit();
        else render();
      },
      fit: fit,
      jobsInView: inView,
      view: function () { return { zoom: zoom, center: unproject(center.x, center.y, zoom) }; },
      zoomTo: function (next) { zoomAt(next); },
      panBy: function (dx, dy) { center = { x: center.x + dx, y: center.y + dy }; render(); },
      destroy: function () {
        destroyed = true;
        clearTimeout(viewTimer);
        if (resizeObserver) resizeObserver.disconnect();
        root.remove();
      },
    };
  }

  window.ToolboxExplorerMap = {
    create: create,
    hasPlace: hasPlace,
    project: project,
  };
})();
