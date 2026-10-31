// Toolbox — Geoapify address autocomplete and reverse geocoding.
//
// This is a convenience layered onto the existing Property / site address
// field. Every function here degrades to "do nothing, change nothing" when
// there's no API key, the device is offline, or the request fails — callers
// must never let that block manual address entry or Customer File work.
//
// Geoapify is the selected provider for this Milestone 1 convenience only;
// this module intentionally does not build a multi-provider abstraction.

(function () {
  'use strict';

  const AUTOCOMPLETE_URL = 'https://api.geoapify.com/v1/geocode/autocomplete';
  const REVERSE_URL = 'https://api.geoapify.com/v1/geocode/reverse';
  const SEARCH_URL = 'https://api.geoapify.com/v1/geocode/search';
  const LOOKUP_CACHE = 'toolboxAddressLookup:v1:';

  function getApiKey() {
    return (window.ToolboxConfig && window.ToolboxConfig.geoapifyApiKey) || '';
  }

  function isAvailable() {
    return !!getApiKey();
  }

  // Every failure (network error, non-2xx response, bad JSON) is swallowed
  // into an empty result by design, so a caller can never be broken by a
  // Geoapify problem. That silence is also exactly why a live failure is
  // invisible on-device -- lastAutocompleteError/lastReverseError record
  // *why* the last request came back empty (e.g. "HTTP 401") so the UI can
  // show a short, honest status instead of pretending nothing happened.
  // They say nothing about a genuine zero-result search.
  let lastAutocompleteError = null;
  let lastReverseError = null;

  function describeFailure(err) {
    if (err && typeof err.status === 'number') return 'HTTP ' + err.status;
    if (err && err.message) return err.message;
    return 'request failed';
  }

  // Aborting the previous in-flight autocomplete request (rather than just
  // ignoring its response) is the primary defense against a slow keystroke
  // response landing after a newer one — callers add a second guard of
  // their own since abort isn't guaranteed to land before the response.
  let autocompleteController = null;

  function fetchAutocomplete(text) {
    const apiKey = getApiKey();
    if (!apiKey || !text) return Promise.resolve([]);

    if (autocompleteController) autocompleteController.abort();
    const controller = new AbortController();
    autocompleteController = controller;
    lastAutocompleteError = null;

    const url = AUTOCOMPLETE_URL + '?text=' + encodeURIComponent(text) +
      '&format=json&limit=5&apiKey=' + encodeURIComponent(apiKey);

    return fetch(url, { signal: controller.signal })
      .then(function (res) {
        if (!res.ok) {
          const err = new Error('Geoapify autocomplete failed: ' + res.status);
          err.status = res.status;
          throw err;
        }
        return res.json();
      })
      .then(function (data) {
        const results = (data && data.results) || [];
        return results
          .filter(function (r) { return r && r.formatted && typeof r.lat === 'number' && typeof r.lon === 'number'; })
          .map(function (r) { return { label: r.formatted, lat: r.lat, lon: r.lon }; });
      })
      .catch(function (err) {
        if (err && err.name === 'AbortError') return null; // superseded by a newer request
        lastAutocompleteError = describeFailure(err);
        console.warn('Geoapify autocomplete unavailable:', err);
        return [];
      });
  }

  function reverseGeocode(lat, lon) {
    const apiKey = getApiKey();
    if (!apiKey) return Promise.resolve(null);
    lastReverseError = null;

    const url = REVERSE_URL + '?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) +
      '&format=json&limit=1&apiKey=' + encodeURIComponent(apiKey);

    return fetch(url)
      .then(function (res) {
        if (!res.ok) {
          const err = new Error('Geoapify reverse geocode failed: ' + res.status);
          err.status = res.status;
          throw err;
        }
        return res.json();
      })
      .then(function (data) {
        const first = data && data.results && data.results[0];
        if (!first || !first.formatted) return null;
        return {
          label: first.formatted,
          lat: typeof first.lat === 'number' ? first.lat : lat,
          lon: typeof first.lon === 'number' ? first.lon : lon,
        };
      })
      .catch(function (err) {
        lastReverseError = describeFailure(err);
        console.warn('Geoapify reverse geocode unavailable:', err);
        return null;
      });
  }

  /**
   * Where a typed address is, for File Explorer's map -- the third and last
   * way a job is placed (Tim, Oct 29, 2026), after the picked address and
   * the Floor Survey base point.
   *
   * Only an answer that names the house or its street is taken. A match on
   * the town, the county or the state would put a pin somewhere the job is
   * not, so it is refused and the job stays listed as having no location.
   * Answers are kept on this device, so the same address is asked once.
   * Never written to the Customer File.
   */
  const LOOKUP_TYPES = { building: 1, amenity: 1, street: 1 };

  function lookupKey(text) {
    return LOOKUP_CACHE + String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }

  function geocodeAddress(text) {
    const apiKey = getApiKey();
    const address = String(text || '').trim();
    if (!apiKey || !address) return Promise.resolve(null);
    try {
      const kept = window.localStorage && window.localStorage.getItem(lookupKey(address));
      if (kept) {
        const parsed = JSON.parse(kept);
        if (parsed && parsed.none) return Promise.resolve(null);
        if (parsed && typeof parsed.lat === 'number' && typeof parsed.lon === 'number') return Promise.resolve(parsed);
      }
    } catch (_) {}
    const url = SEARCH_URL + '?text=' + encodeURIComponent(address) +
      '&filter=countrycode:us&bias=proximity:-106.0,34.4&format=json&limit=1&apiKey=' + encodeURIComponent(apiKey);
    return fetch(url)
      .then(function (res) {
        if (!res.ok) {
          const err = new Error('Geoapify search failed: ' + res.status);
          err.status = res.status;
          throw err;
        }
        return res.json();
      })
      .then(function (data) {
        const first = data && data.results && data.results[0];
        const confidence = first && first.rank && typeof first.rank.confidence === 'number' ? first.rank.confidence : 0;
        const found = first && LOOKUP_TYPES[first.result_type] && confidence >= 0.6 &&
          typeof first.lat === 'number' && typeof first.lon === 'number'
          ? { lat: first.lat, lon: first.lon, label: first.formatted || '' }
          : null;
        try {
          if (window.localStorage) window.localStorage.setItem(lookupKey(address), JSON.stringify(found || { none: true }));
        } catch (_) {}
        return found;
      })
      .catch(function (err) {
        // A failed request is not an answer: nothing is kept, and the next
        // look tries again.
        console.warn('Geoapify address search unavailable:', err);
        return null;
      });
  }

  window.ToolboxGeo = {
    geocodeAddress: geocodeAddress,
    isAvailable: isAvailable,
    fetchAutocomplete: fetchAutocomplete,
    reverseGeocode: reverseGeocode,
    getLastAutocompleteError: function () { return lastAutocompleteError; },
    getLastReverseError: function () { return lastReverseError; },
  };
})();
