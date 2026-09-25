// Toolbox — Report Builder draft stored on the Customer File report component.
//
// The draft is the investigator's page list: order, additions, duplicates,
// removals, authored wording, and the selected page. It references Customer
// File media ids already stored with plans, Distress, Floor Survey, and
// Diagnostics. It does not copy photograph or PDF bytes.
//
// Opening a saved draft keeps that wording and order, then inserts source
// pages that were not in the report the last time it was saved. A page the
// investigator removed stays removed. Sync already ships record.reportBuilder
// as the report component; this module only fills that object.

(function () {
  'use strict';

  var SCHEMA = 'toolbox.report-draft';
  var SCHEMA_VERSION = 1;

  function text(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function cloneMeta(meta) {
    if (!meta || typeof meta !== 'object') return null;
    var copy;
    try {
      copy = JSON.parse(JSON.stringify(meta));
    } catch (err) {
      return null;
    }
    stripDataUrls(copy);
    return copy;
  }

  function stripDataUrls(value) {
    if (!value || typeof value !== 'object') return;
    Object.keys(value).forEach(function (key) {
      var item = value[key];
      if (typeof item === 'string' && item.indexOf('data:') === 0) {
        delete value[key];
        return;
      }
      if (item && typeof item === 'object') stripDataUrls(item);
    });
  }

  function asSourcePage(page) {
    return {
      id: page.id,
      type: page.type,
      title: page.title || '',
      tocTitle: page.tocTitle || page.title || '',
      railLabel: page.railLabel || page.title || '',
      note: page.note || '',
      body: '',
      sourceKey: page.sourceKey || null,
      sourceRef: page.sourceRef || null,
      sourceId: page.id,
      origin: 'source',
      includeInToc: page.includeInToc !== false,
      titleEdited: false,
      meta: cloneMeta(page.meta),
    };
  }

  function persistPage(page) {
    return {
      id: page.id,
      type: page.type || 'sheet',
      title: page.title || '',
      tocTitle: page.tocTitle || page.title || '',
      railLabel: page.railLabel || page.title || '',
      note: page.note || '',
      body: typeof page.body === 'string' ? page.body : '',
      sourceKey: page.sourceKey || null,
      sourceRef: page.sourceRef || null,
      sourceId: page.sourceId || null,
      origin: page.origin || 'source',
      includeInToc: page.includeInToc !== false,
      titleEdited: !!page.titleEdited,
      meta: cloneMeta(page.meta),
    };
  }

  function blankFromSequence(sequence) {
    var pages = ((sequence && sequence.pages) || []).map(asSourcePage);
    return {
      pages: pages,
      selectedPageId: pages[0] ? pages[0].id : '',
      seenSourceIds: pages.map(function (page) { return page.sourceId; }).filter(Boolean),
    };
  }

  function read(record) {
    var raw = record && (record.reportBuilder || record.report);
    if (!raw || raw.schema !== SCHEMA || !Array.isArray(raw.pages)) return null;
    return raw;
  }

  function refreshSourcePage(saved, fresh) {
    var next = asSourcePage(fresh);
    next.body = typeof saved.body === 'string' ? saved.body : '';
    if (saved.titleEdited) {
      next.title = saved.title || next.title;
      next.tocTitle = saved.tocTitle || saved.title || next.tocTitle;
      next.railLabel = saved.railLabel || saved.title || next.railLabel;
      next.titleEdited = true;
    }
    if (saved.meta && saved.meta.slideId && next.meta) next.meta.slideId = saved.meta.slideId;
    return next;
  }

  function keepWithoutFresh(saved) {
    if (text(saved.body)) return true;
    if (saved.origin === 'added' || saved.origin === 'duplicate') return true;
    if (saved.meta && (saved.meta.slideId || saved.meta.areaId)) return true;
    return false;
  }

  function hasSource(pages, sourceId) {
    return pages.some(function (page) {
      if (!page || page.origin === 'added' || page.origin === 'duplicate') return false;
      return (page.sourceId || page.id) === sourceId;
    });
  }

  function sourceIndex(pages, sourceId, last) {
    var found = -1;
    for (var i = 0; i < pages.length; i += 1) {
      var page = pages[i];
      if (!page || page.origin === 'added' || page.origin === 'duplicate') continue;
      if ((page.sourceId || page.id) === sourceId) {
        found = i;
        if (!last) return i;
      }
    }
    return found;
  }

  function insertIndex(merged, freshPages, index) {
    var prev;
    var next;
    for (prev = index - 1; prev >= 0; prev -= 1) {
      var after = sourceIndex(merged, freshPages[prev].id, true);
      if (after !== -1) return after + 1;
    }
    for (next = index + 1; next < freshPages.length; next += 1) {
      var before = sourceIndex(merged, freshPages[next].id, false);
      if (before !== -1) return before;
    }
    return merged.length;
  }

  function merge(draft, sequence) {
    var freshPages = (sequence && sequence.pages) || [];
    if (!draft || draft.schema !== SCHEMA || !Array.isArray(draft.pages) || !draft.pages.length) {
      return blankFromSequence(sequence);
    }
    var freshById = {};
    freshPages.forEach(function (page) {
      if (page && page.id) freshById[page.id] = page;
    });
    var seen = {};
    (draft.seenSourceIds || []).forEach(function (id) {
      if (id) seen[id] = true;
    });
    var merged = [];
    draft.pages.forEach(function (saved) {
      if (!saved || !saved.id || saved.derived) return;
      if (saved.origin === 'added' || saved.origin === 'duplicate') {
        merged.push(persistPage(saved));
        return;
      }
      var sourceId = saved.sourceId || saved.id;
      if (sourceId) seen[sourceId] = true;
      var fresh = freshById[sourceId];
      if (!fresh) {
        if (keepWithoutFresh(saved)) merged.push(persistPage(saved));
        return;
      }
      merged.push(refreshSourcePage(saved, fresh));
    });
    freshPages.forEach(function (fresh, index) {
      if (!fresh || !fresh.id || seen[fresh.id] || hasSource(merged, fresh.id)) {
        if (fresh && fresh.id) seen[fresh.id] = true;
        return;
      }
      var at = insertIndex(merged, freshPages, index);
      merged.splice(at, 0, asSourcePage(fresh));
      seen[fresh.id] = true;
    });
    if (!merged.length) return blankFromSequence(sequence);
    var selected = draft.selectedPageId;
    if (!merged.some(function (page) { return page.id === selected; })) {
      selected = merged[0].id;
    }
    return {
      pages: merged,
      selectedPageId: selected,
      seenSourceIds: Object.keys(seen),
    };
  }

  function payload(state) {
    var pages = (state && state.pages) || [];
    return {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      selectedPageId: state && state.selectedPageId || '',
      seenSourceIds: ((state && state.seenSourceIds) || []).slice(),
      pages: pages.filter(function (page) { return page && !page.derived; }).map(persistPage),
    };
  }

  function save(customerFileId, state) {
    if (!customerFileId) return Promise.reject(new Error('Customer File is required.'));
    if (!window.ToolboxDB || typeof window.ToolboxDB.getCustomerFile !== 'function') {
      return Promise.reject(new Error('Customer File storage is not available.'));
    }
    if (window.ToolboxSync && typeof window.ToolboxSync.isCheckedOutElsewhere === 'function' &&
        window.ToolboxSync.isCheckedOutElsewhere(customerFileId)) {
      var locked = new Error(
        (typeof window.ToolboxSync.foreignCheckoutLabel === 'function' &&
          window.ToolboxSync.foreignCheckoutLabel(customerFileId)) ||
        'Checked out on another device.'
      );
      locked.code = 'checkout';
      return Promise.reject(locked);
    }
    return window.ToolboxDB.getCustomerFile(customerFileId).then(function (record) {
      if (!record || record.deletedAt) {
        throw new Error('Customer File is not on this device.');
      }
      var now = new Date().toISOString();
      var next = payload(state);
      next.updatedAt = now;
      record.reportBuilder = next;
      record.updatedAt = now;
      return window.ToolboxDB.saveCustomerFile(record).then(function () {
        return next;
      });
    });
  }

  var api = {
    SCHEMA: SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    blankFromSequence: blankFromSequence,
    read: read,
    merge: merge,
    payload: payload,
    save: save,
  };

  if (typeof window !== 'undefined') window.ToolboxReportDraft = api;
  if (typeof globalThis !== 'undefined') globalThis.ToolboxReportDraft = api;
})();
