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
//
// Zoom is continuous: a pinch or a wheel turn scales the tiles under the
// fingers and the sharper level loads in behind them, so the map never goes
// blank between levels. Two looks, Map (streets, Geoapify) and Satellite (aerial
// photographs, Esri World Imagery, with place names over them), and a search
// box that moves the map to a town or street. The search only moves the view;
// it never changes a job. Zoom stops at MAX_ZOOM, where the aerial photographs
// still show a house and do not turn to mush.

(function () {
  'use strict';

  const TILE = 256;
  const MIN_ZOOM = 3;
  const MAX_ZOOM = 18;
  const CLUSTER_PX = 46;
  const TILE_URL = 'https://maps.geoapify.com/v1/tile/osm-bright/';
  const SAT_HOST = 'https://server.arcgisonline.com/ArcGIS/rest/services/';
  const SAT_HOST_KEYED = 'https://ibasemaps-api.arcgis.com/arcgis/rest/services/';
  const AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';
  const STYLE_KEY = 'toolbox.explorerMapStyle';
  const LABEL_ZOOM = 14;
  // Where the work is. Tim, Oct 29, 2026: "99% of our work will be in the
  // state of New Mexico." The map opens on the state, and widens only when a
  // located job lies outside it, so nothing is ever framed out of view.
  const HOME = [
    { lat: 37.0, lon: -109.05 },
    { lat: 31.33, lon: -103.0 },
  ];

  function apiKey() {
    return (window.ToolboxConfig && window.ToolboxConfig.geoapifyApiKey) || '';
  }

  /** Optional Esri key. Without one the public imagery service is used. */
  function esriKey() {
    return (window.ToolboxConfig && window.ToolboxConfig.esriApiKey) || '';
  }

  function savedStyle() {
    try {
      return window.localStorage.getItem(STYLE_KEY) === 'satellite' ? 'satellite' : 'street';
    } catch (_) { return 'street'; }
  }

  /** How close to zoom for what a search found. */
  function zoomForResult(type) {
    const t = String(type || '');
    if (t === 'country') return 4;
    if (t === 'state') return 6;
    if (t === 'county') return 9;
    if (t === 'city' || t === 'postcode') return 12;
    if (t === 'suburb' || t === 'district' || t === 'locality') return 14;
    if (t === 'street') return 16;
    return 17;
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
    const placesEl = document.createElement('div');
    placesEl.className = 'explorer-map__tiles explorer-map__tiles--places';
    const pinsEl = document.createElement('div');
    pinsEl.className = 'explorer-map__pins';
    const labelsEl = document.createElement('div');
    labelsEl.className = 'explorer-map__labels';
    const foundEl = document.createElement('div');
    foundEl.className = 'explorer-map__foundpin';
    foundEl.hidden = true;
    const zoomBox = document.createElement('div');
    zoomBox.className = 'explorer-map__zoom';
    zoomBox.setAttribute('data-map-ui', '');
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

    // Map | Satellite
    const styleBox = document.createElement('div');
    styleBox.className = 'explorer-map__style';
    styleBox.setAttribute('data-map-ui', '');
    styleBox.setAttribute('role', 'group');
    styleBox.setAttribute('aria-label', 'Map look');
    const styleButtons = {};
    [['street', 'Map'], ['satellite', 'Satellite']].forEach(function (pair) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = pair[1];
      b.dataset.style = pair[0];
      styleButtons[pair[0]] = b;
      styleBox.appendChild(b);
    });

    // Search for a town or street: moves the view, changes nothing else.
    const finder = document.createElement('form');
    finder.className = 'explorer-map__find';
    finder.setAttribute('data-map-ui', '');
    finder.setAttribute('role', 'search');
    finder.autocomplete = 'off';
    const finderInput = document.createElement('input');
    finderInput.type = 'search';
    finderInput.className = 'explorer-map__findinput';
    finderInput.placeholder = 'Find a town or street';
    finderInput.setAttribute('aria-label', 'Find a place on the map');
    finderInput.enterKeyHint = 'search';
    const foundList = document.createElement('ul');
    foundList.className = 'explorer-map__found';
    foundList.hidden = true;
    finder.appendChild(finderInput);
    finder.appendChild(foundList);

    const credit = document.createElement('p');
    credit.className = 'explorer-map__credit';
    const say = document.createElement('p');
    say.className = 'explorer-map__say';
    say.hidden = true;
    root.appendChild(tilesEl);
    root.appendChild(placesEl);
    root.appendChild(foundEl);
    root.appendChild(labelsEl);
    root.appendChild(pinsEl);
    root.appendChild(finder);
    root.appendChild(zoomBox);
    root.appendChild(styleBox);
    root.appendChild(credit);
    root.appendChild(say);
    host.appendChild(root);

    // New Mexico until the view is framed to the window.
    let zoom = 6;
    let center = project(34.2, -106.0, zoom);
    let jobs = [];
    let style = savedStyle();
    // key: layer|z/x/y -> { img, layer, z, tx, ty, settled }
    const tiles = new Map();
    let wantedNow = [];
    let tileFailures = 0;
    let tileLoads = 0;
    let viewTimer = 0;
    let destroyed = false;
    let found = null;
    const retina = (window.devicePixelRatio || 1) > 1.25;
    const key = apiKey();

    function size() {
      return { w: root.clientWidth || 1, h: root.clientHeight || 1 };
    }

    function message(text) {
      say.hidden = !text;
      say.textContent = text || '';
    }

    function satUrl(layer, z, x, y) {
      const eKey = esriKey();
      const path = layer === 'places'
        ? 'Reference/World_Boundaries_and_Places/MapServer/tile/'
        : 'World_Imagery/MapServer/tile/';
      return (eKey ? SAT_HOST_KEYED : SAT_HOST) + path + z + '/' + y + '/' + x + (eKey ? '?token=' + encodeURIComponent(eKey) : '');
    }

    /** The tile layers the current look draws, bottom first. */
    function layerList() {
      if (style === 'satellite') {
        return [
          { id: 'base', el: tilesEl, url: function (z, x, y) { return satUrl('base', z, x, y); } },
          { id: 'places', el: placesEl, url: function (z, x, y) { return satUrl('places', z, x, y); } },
        ];
      }
      if (!key) return [];
      return [{
        id: 'base',
        el: tilesEl,
        url: function (z, x, y) {
          return TILE_URL + z + '/' + x + '/' + y + (retina ? '@2x' : '') + '.png?apiKey=' + encodeURIComponent(key);
        },
      }];
    }

    function paintCredit() {
      credit.innerHTML = style === 'satellite'
        ? '<a href="https://www.esri.com/" target="_blank" rel="noopener">Imagery © Esri, Maxar, Earthstar Geographics</a>'
        : '<a href="https://www.geoapify.com/" target="_blank" rel="noopener">Powered by Geoapify</a> · ' +
          '<a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> · ' +
          '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a>';
    }

    function paintStatus() {
      if (style === 'street' && !key) message('The street map needs a Geoapify key in Toolbox settings. Satellite and the job list still work.');
      else if (navigator.onLine === false) message('The map needs a network connection. The jobs are listed below.');
      else if (!say.dataset.tiles) message('');
      Object.keys(styleButtons).forEach(function (name) {
        const on = name === style;
        styleButtons[name].classList.toggle('is-on', on);
        styleButtons[name].setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      root.dataset.style = style;
      finder.hidden = !key;
    }

    function setStyle(next) {
      if (next === style) return;
      style = next;
      try { window.localStorage.setItem(STYLE_KEY, style); } catch (_) {}
      tiles.forEach(function (rec) { rec.img.remove(); });
      tiles.clear();
      tileFailures = 0;
      tileLoads = 0;
      delete say.dataset.tiles;
      paintCredit();
      paintStatus();
      render();
    }
    Object.keys(styleButtons).forEach(function (name) {
      styleButtons[name].addEventListener('click', function (event) { event.stopPropagation(); setStyle(name); });
    });
    paintCredit();
    paintStatus();

    function placeTile(rec, left, top) {
      const ts = TILE * Math.pow(2, zoom - rec.z);
      // A hair of overlap hides the seam between scaled tiles.
      const px = Math.abs(ts - TILE) < 1e-6 ? TILE : ts + 0.6;
      rec.img.style.width = px + 'px';
      rec.img.style.height = px + 'px';
      rec.img.style.transform = 'translate(' + Math.round(rec.tx * ts - left) + 'px,' + Math.round(rec.ty * ts - top) + 'px)';
    }

    /** Once everything in view has loaded, the blurrier tiles kept behind it can go. */
    function prune() {
      const ready = wantedNow.every(function (rec) { return rec.settled; });
      if (!ready && tiles.size < 700) return;
      const keep = new Set(wantedNow);
      tiles.forEach(function (rec, id) {
        if (!keep.has(rec)) {
          rec.img.remove();
          tiles.delete(id);
        }
      });
    }

    function drawTiles() {
      const layers = layerList();
      if (!layers.length) return;
      const view = size();
      const left = center.x - view.w / 2;
      const top = center.y - view.h / 2;
      const z = clamp(Math.floor(zoom + 1e-9), MIN_ZOOM, MAX_ZOOM);
      const ts = TILE * Math.pow(2, zoom - z);
      const count = Math.pow(2, z);
      const x0 = Math.floor(left / ts);
      const x1 = Math.floor((left + view.w) / ts);
      const y0 = Math.max(0, Math.floor(top / ts));
      const y1 = Math.min(count - 1, Math.floor((top + view.h) / ts));
      wantedNow = [];
      layers.forEach(function (layer) {
        for (let ty = y0; ty <= y1; ty++) {
          for (let tx = x0; tx <= x1; tx++) {
            const wrapped = ((tx % count) + count) % count;
            const id = layer.id + '|' + z + '/' + tx + '/' + ty;
            let rec = tiles.get(id);
            if (!rec) {
              const img = document.createElement('img');
              img.className = 'explorer-map__tile';
              img.alt = '';
              img.draggable = false;
              img.decoding = 'async';
              rec = { img: img, layer: layer.id, z: z, tx: tx, ty: ty, settled: false };
              img.onload = function () {
                rec.settled = true;
                tileLoads += 1;
                if (say.dataset.tiles) { delete say.dataset.tiles; paintStatus(); }
                prune();
              };
              img.onerror = function () {
                rec.settled = true;
                tileFailures += 1;
                if (!tileLoads && tileFailures >= 4) {
                  say.dataset.tiles = '1';
                  message('The map tiles could not be loaded. The pins and the list still work.');
                }
                prune();
              };
              img.src = layer.url(z, wrapped, ty);
              tiles.set(id, rec);
              layer.el.appendChild(img);
            }
            wantedNow.push(rec);
          }
        }
      });
      tiles.forEach(function (rec) { placeTile(rec, left, top); });
      prune();
    }

    function screenOf(job) {
      return screenAt(job.lat, job.lon);
    }

    function screenAt(lat, lon) {
      const view = size();
      const p = project(lat, lon, zoom);
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
      labelsEl.innerHTML = '';
      const taken = [];
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
          if (many && !samePlace && zoom < MAX_ZOOM - 0.01) {
            zoomAt(Math.min(MAX_ZOOM, zoom + 2), group.x, group.y);
            return;
          }
          onPick(group.jobs.slice());
        });
        pinsEl.appendChild(pin);

        // Close in, a lone pin carries its job's name, so a house can be
        // told from the next one without opening it. A label that would sit
        // on another one is left off.
        const name = !many && zoom >= LABEL_ZOOM ? String(group.jobs[0].displayName || '').trim() : '';
        if (name) {
          const w = Math.min(190, name.length * 7 + 12);
          const box = { l: group.x + 12, t: group.y - 10, r: group.x + 12 + w, b: group.y + 10 };
          const clash = taken.some(function (o) { return box.l < o.r && box.r > o.l && box.t < o.b && box.b > o.t; });
          if (!clash) {
            taken.push(box);
            const label = document.createElement('span');
            label.className = 'explorer-map__label';
            label.textContent = name;
            label.style.transform = 'translate(' + Math.round(box.l) + 'px,' + Math.round(box.t) + 'px)';
            labelsEl.appendChild(label);
          }
        }
      });
    }

    function drawFound() {
      if (!found) { foundEl.hidden = true; return; }
      const s = screenAt(found.lat, found.lon);
      foundEl.hidden = false;
      foundEl.style.transform = 'translate(' + Math.round(s.x) + 'px,' + Math.round(s.y) + 'px)';
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
      drawFound();
      zoomIn.disabled = zoom >= MAX_ZOOM - 0.01;
      zoomOut.disabled = zoom <= MIN_ZOOM + 0.01;
      clearTimeout(viewTimer);
      viewTimer = setTimeout(function () {
        if (!destroyed) onView(inView());
      }, 120);
    }

    /** Zoom to any level (fractions included), keeping the point under (sx, sy) still. */
    function setZoom(next, sx, sy) {
      next = clamp(next, MIN_ZOOM, MAX_ZOOM);
      if (Math.abs(next - zoom) < 1e-9) return;
      const view = size();
      const px = sx == null ? view.w / 2 : sx;
      const py = sy == null ? view.h / 2 : sy;
      const at = unproject(center.x - view.w / 2 + px, center.y - view.h / 2 + py, zoom);
      const after = project(at.lat, at.lon, next);
      zoom = next;
      center = { x: after.x - (px - view.w / 2), y: after.y - (py - view.h / 2) };
      render();
    }

    /** The buttons, a double tap and a pin step in whole levels. */
    function zoomAt(next, sx, sy) {
      setZoom(Math.round(next), sx, sy);
    }

    zoomIn.addEventListener('click', function (event) { event.stopPropagation(); zoomAt(Math.floor(zoom + 1e-9) + 1); });
    zoomOut.addEventListener('click', function (event) { event.stopPropagation(); zoomAt(Math.ceil(zoom - 1e-9) - 1); });

    const UI = 'button, a, input, [data-map-ui]';

    // Drag with one finger or the mouse; pinch with two, following the fingers.
    const pointers = new Map();
    let pinch = null;
    root.addEventListener('pointerdown', function (event) {
      if (event.target.closest && event.target.closest(UI)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      try { root.setPointerCapture(event.pointerId); } catch (_) {}
      if (pointers.size === 2) {
        const pts = Array.from(pointers.values());
        pinch = {
          dist: Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y)),
          zoom: zoom,
          mx: (pts[0].x + pts[1].x) / 2,
          my: (pts[0].y + pts[1].y) / 2,
        };
      }
    });
    root.addEventListener('pointermove', function (event) {
      const prev = pointers.get(event.pointerId);
      if (!prev) return;
      const now = { x: event.clientX, y: event.clientY };
      if (pointers.size === 1) {
        center = { x: center.x - (now.x - prev.x), y: center.y - (now.y - prev.y) };
        pointers.set(event.pointerId, now);
        render();
        return;
      }
      pointers.set(event.pointerId, now);
      if (pointers.size === 2 && pinch) {
        const pts = Array.from(pointers.values());
        const dist = Math.max(1, Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y));
        const mx = (pts[0].x + pts[1].x) / 2;
        const my = (pts[0].y + pts[1].y) / 2;
        // The pair of fingers drags the map as well as scaling it.
        center = { x: center.x - (mx - pinch.mx), y: center.y - (my - pinch.my) };
        pinch.mx = mx;
        pinch.my = my;
        const box = root.getBoundingClientRect();
        const target = pinch.zoom + Math.log(dist / pinch.dist) / Math.LN2;
        if (Math.abs(clamp(target, MIN_ZOOM, MAX_ZOOM) - zoom) < 1e-9) render();
        else setZoom(target, mx - box.left, my - box.top);
      }
    });
    const release = function (event) {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinch = null;
    };
    root.addEventListener('pointerup', release);
    root.addEventListener('pointercancel', release);
    root.addEventListener('dblclick', function (event) {
      if (event.target.closest && event.target.closest(UI)) return;
      const box = root.getBoundingClientRect();
      zoomAt(Math.floor(zoom + 1e-9) + 1, event.clientX - box.left, event.clientY - box.top);
    });
    root.addEventListener('wheel', function (event) {
      if (event.target.closest && event.target.closest('.explorer-map__found')) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 0.06 : 0.004;
      const step = clamp(-event.deltaY * unit, -1, 1);
      const box = root.getBoundingClientRect();
      setZoom(zoom + step, event.clientX - box.left, event.clientY - box.top);
    }, { passive: false });

    let resizeObserver = null;
    if (typeof ResizeObserver === 'function') {
      resizeObserver = new ResizeObserver(function () { render(); });
      resizeObserver.observe(root);
    }

    // ---- search for a place
    let findTimer = 0;
    let findController = null;
    let findSeq = 0;

    function closeFound() {
      foundList.hidden = true;
      foundList.innerHTML = '';
    }

    function goTo(lat, lon, level) {
      found = { lat: lat, lon: lon };
      zoom = clamp(level, MIN_ZOOM, MAX_ZOOM);
      center = project(lat, lon, zoom);
      render();
    }

    function showFound(results) {
      foundList.innerHTML = '';
      if (!results.length) {
        const none = document.createElement('li');
        none.className = 'explorer-map__found-none';
        none.textContent = 'No place found.';
        foundList.appendChild(none);
        foundList.hidden = false;
        return;
      }
      results.forEach(function (result) {
        const li = document.createElement('li');
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = result.formatted || result.name || '';
        b.addEventListener('click', function () {
          finderInput.value = b.textContent;
          closeFound();
          goTo(result.lat, result.lon, zoomForResult(result.result_type));
        });
        li.appendChild(b);
        foundList.appendChild(li);
      });
      foundList.hidden = false;
    }

    function search(text, immediate) {
      const query = String(text || '').trim();
      clearTimeout(findTimer);
      if (findController) findController.abort();
      if (query.length < 3 || !key) {
        closeFound();
        return Promise.resolve([]);
      }
      const seq = ++findSeq;
      const run = function () {
        if (navigator.onLine === false) {
          foundList.innerHTML = '<li class="explorer-map__found-none">Searching needs a network connection.</li>';
          foundList.hidden = false;
          return Promise.resolve([]);
        }
        findController = typeof AbortController === 'function' ? new AbortController() : null;
        const url = AUTOCOMPLETE_URL + '?text=' + encodeURIComponent(query) +
          '&filter=countrycode:us&bias=proximity:-106.0,34.4&format=json&limit=5&apiKey=' + encodeURIComponent(key);
        return fetch(url, findController ? { signal: findController.signal } : undefined)
          .then(function (res) {
            if (!res.ok) throw new Error('HTTP ' + res.status);
            return res.json();
          })
          .then(function (data) {
            if (seq !== findSeq || destroyed) return [];
            const list = ((data && data.results) || []).filter(function (r) {
              return r && typeof r.lat === 'number' && typeof r.lon === 'number';
            });
            showFound(list);
            return list;
          })
          .catch(function (err) {
            if (err && err.name === 'AbortError') return [];
            if (seq === findSeq && !destroyed) {
              foundList.innerHTML = '<li class="explorer-map__found-none">The search could not be reached.</li>';
              foundList.hidden = false;
            }
            return [];
          });
      };
      if (immediate) return run();
      return new Promise(function (resolve) {
        findTimer = setTimeout(function () { resolve(run()); }, 280);
      });
    }

    finderInput.addEventListener('input', function () {
      if (!finderInput.value.trim()) { found = null; closeFound(); drawFound(); return; }
      search(finderInput.value, false);
    });
    finder.addEventListener('submit', function (event) {
      event.preventDefault();
      search(finderInput.value, true).then(function (list) {
        if (list && list[0]) {
          finderInput.value = list[0].formatted || finderInput.value;
          closeFound();
          goTo(list[0].lat, list[0].lon, zoomForResult(list[0].result_type));
          if (finderInput.blur) finderInput.blur();
        }
      });
    });
    finderInput.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') closeFound();
    });

    /** Frame New Mexico, and any located job outside it. */
    function fit() {
      const view = size();
      const points = HOME.concat(jobs);
      let best = MIN_ZOOM;
      for (let z = 15; z >= MIN_ZOOM; z--) {
        let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
        points.forEach(function (job) {
          const p = project(job.lat, job.lon, z);
          minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
          minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
        });
        if (maxX - minX <= view.w - 24 && maxY - minY <= view.h - 24) { best = z; break; }
      }
      zoom = best;
      let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
      points.forEach(function (job) {
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
      style: function () { return style; },
      setStyle: setStyle,
      goTo: goTo,
      destroy: function () {
        destroyed = true;
        clearTimeout(viewTimer);
        clearTimeout(findTimer);
        if (findController) findController.abort();
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
