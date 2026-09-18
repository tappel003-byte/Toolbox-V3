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

  function getApiKey() {
    return (window.ToolboxConfig && window.ToolboxConfig.geoapifyApiKey) || '';
  }

  function isAvailable() {
    return !!getApiKey();
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

    const url = AUTOCOMPLETE_URL + '?text=' + encodeURIComponent(text) +
      '&format=json&limit=5&apiKey=' + encodeURIComponent(apiKey);

    return fetch(url, { signal: controller.signal })
      .then(function (res) {
        if (!res.ok) throw new Error('Geoapify autocomplete failed: ' + res.status);
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
        console.warn('Geoapify autocomplete unavailable:', err);
        return [];
      });
  }

  function reverseGeocode(lat, lon) {
    const apiKey = getApiKey();
    if (!apiKey) return Promise.resolve(null);

    const url = REVERSE_URL + '?lat=' + encodeURIComponent(lat) + '&lon=' + encodeURIComponent(lon) +
      '&format=json&limit=1&apiKey=' + encodeURIComponent(apiKey);

    return fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Geoapify reverse geocode failed: ' + res.status);
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
        console.warn('Geoapify reverse geocode unavailable:', err);
        return null;
      });
  }

  window.ToolboxGeo = {
    isAvailable: isAvailable,
    fetchAutocomplete: fetchAutocomplete,
    reverseGeocode: reverseGeocode,
  };
})();
