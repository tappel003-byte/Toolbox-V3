/**
 * A copy of a job that still explains itself in 2031.
 *
 * The File Cabinet stores a job the way a program stores it: `cf/{id}/
 * floor.json` beside flat `media/ph_8f21c0a9` keys with no names and no
 * folders. That is right for the Cabinet and useless as an archive. Tim, on
 * what the Cabinet is for: "ours is potentially going to be the repository
 * for all of our job files," with "a copy downloaded to their own server as
 * backup." A backup whose filenames are storage keys is a backup nobody can
 * read.
 *
 * So the copy taken out is arranged the way a person would arrange it: one
 * folder named for the customer, the address and the field work date; the
 * photographs under the names the investigator already gave them, by pin and
 * room; the plans; the readings as a CSV; the pins as a list; a page of
 * customer details; and a README that says what the job was and — the part
 * that matters — what is NOT in the folder.
 *
 * NOTHING IS RENAMED IN STORAGE. The R2 keys stay exactly as they are; this
 * only decides what the copy's own folders and filenames are called. And
 * nothing here is manufactured: a report PDF that was never printed is
 * reported as absent, never produced.
 *
 * The raw records are preserved under Technical/, because they are the only
 * thing that could rebuild this job inside Toolbox.
 */
(function () {
  'use strict';

  function trim(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  /**
   * Where a stored object lands in the copy.
   *
   * Keyed on the purpose the Cabinet's own listing already assigns, so the
   * folders here and the folders on screen cannot drift apart.
   */
  const FOLDER_FOR = {
    plan: 'Plans',
    contour: 'Plans',
    'distress-photo': 'Photographs/Distress Survey',
    'quick-capture': 'Photographs/Quick Capture',
    'unassigned-photo': 'Photographs/Unassigned',
    'general-photo': 'Photographs/General',
    'floor-pdf': 'Floor Survey',
    'floor-figure': 'Floor Survey',
    'diagnostics-figure': 'Diagnostics',
    'report-overview': 'Report',
    'report-picture': 'Report',
  };

  /** What each folder is, for the cover sheet. */
  const FOLDER_IS = {
    'Plans': 'the plan picture of each level, and its contour where one was drawn',
    'Photographs/Distress Survey': 'the numbered damage photographs, named by pin and room',
    'Photographs/Quick Capture': 'photographs taken outside the numbered survey',
    'Photographs/Unassigned': 'photographs not yet attached to a pin',
    'Photographs/General': 'general photographs of the property',
    'Floor Survey': 'what Floor Survey produced — its recovery PDF and figures',
    'Diagnostics': 'figures produced by Diagnostics',
    'Report': 'pictures placed in the report',
    'Other': 'stored files that belong to none of the above',
    'Technical': 'the records Toolbox writes, which could rebuild this job',
  };

  function folderFor(row, isRecord) {
    if (isRecord) return 'Technical';
    const purpose = trim(row && row.purpose);
    return FOLDER_FOR[purpose] || 'Other';
  }

  /** The media id a row is stored under, or '' for a cf/ record. */
  function mediaIdOf(row) {
    const key = String((row && row.key) || '');
    return key.indexOf('media/') === 0 ? key.slice('media/'.length) : '';
  }

  /** The leaf name of a stored key, for anything with no better name. */
  function leafOf(key) {
    const parts = String(key || '').split('/');
    const leaf = parts[parts.length - 1] || 'file';
    return leaf.replace(/[\\/:*?"<>|]+/g, '_');
  }

  /** Never let two files in one folder claim the same name. */
  function uniqueIn(used, folder, name) {
    const path = folder ? folder + '/' + name : name;
    if (!used[path]) {
      used[path] = 1;
      return path;
    }
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let n = used[path];
    let candidate;
    do {
      n += 1;
      candidate = (folder ? folder + '/' : '') + stem + '-' + n + ext;
    } while (used[candidate]);
    used[path] = n;
    used[candidate] = 1;
    return candidate;
  }

  /**
   * Build the copy.
   *
   * opts:
   *   id          the Customer File id
   *   name        who the job is for
   *   address     the property
   *   objects     the Cabinet listing's rows, purposes and all
   *   components  the parsed records, for the summary and the CSVs
   *   fetchObject (id, key) -> Promise<{ buffer }>
   *   nameFor     (row) -> a readable filename, from the Explorer's own
   *               naming, so a picture saved alone and the same picture in
   *               this copy are called the same thing
   *   isRecord    (row) -> is this one of Toolbox's own record files
   *   onProgress  ({ done, total, label }) -> void
   *
   * Resolves to { blob, filename, written, total, failed, missing }. A single
   * unreadable object does not lose the other ninety-nine: it is counted,
   * named in the README, and the copy still comes out.
   */
  async function buildJobArchive(opts) {
    const options = opts || {};
    const Summary = window.ToolboxExplorerSummary;
    if (!window.JSZip) throw new Error('ZIP support is unavailable.');
    if (!Summary) throw new Error('Explorer summaries are unavailable.');

    const components = options.components || {};
    const rows = (options.objects || []).slice();
    const root = Summary.archiveFolderName({
      name: options.name,
      address: options.address,
      components: components,
      fallbackDate: options.fallbackDate,
    });

    const zip = new window.JSZip();
    const used = Object.create(null);
    const failed = [];
    const missing = [];
    const folders = Object.create(null);
    /**
     * WHAT ACTUALLY LANDED, which is the only thing the README may describe.
     *
     * `packed` maps a storage key to the path the bytes really took, suffix
     * and all, so the pin list and the mapping file can point at files that
     * exist. `havePurpose` counts by what a thing IS rather than by which
     * folder exists -- a Floor Survey figure and a Floor Survey recovery PDF
     * both land in Floor Survey/, so testing the folder said a job with a
     * figure and no PDF had a PDF.
     */
    const packed = Object.create(null);
    const havePurpose = Object.create(null);
    const mediaMap = [];

    const stored = rows.filter(function (row) { return row && !row.missing; });
    const absent = rows.filter(function (row) { return row && row.missing; });
    absent.forEach(function (row) {
      missing.push((trim(row.label) || leafOf(row.key)) +
        ' \u2014 referenced by this job, but the File Cabinet does not hold it.');
      if (mediaIdOf(row)) {
        mediaMap.push({ id: mediaIdOf(row), path: '', label: trim(row.label) });
      }
    });

    const total = stored.length;
    let done = 0;
    const report = function (label) {
      if (typeof options.onProgress === 'function') {
        options.onProgress({ done: done, total: total, label: label || '' });
      }
    };
    report('');

    for (let i = 0; i < stored.length; i += 1) {
      const row = stored[i];
      const isRecord = typeof options.isRecord === 'function' ? !!options.isRecord(row) : false;
      const folder = folderFor(row, isRecord);
      let name = '';
      if (typeof options.nameFor === 'function') {
        try { name = trim(options.nameFor(row)); } catch (_) { name = ''; }
      }
      if (!name) name = leafOf(row.key);
      const path = uniqueIn(used, folder, name);
      try {
        const loaded = await options.fetchObject(options.id, row.key);
        zip.file(root + '/' + path, loaded.buffer);
        folders[folder] = (folders[folder] || 0) + 1;
        packed[row.key] = path;
        const purpose = trim(row.purpose) || 'other';
        havePurpose[purpose] = (havePurpose[purpose] || 0) + 1;
        if (mediaIdOf(row)) {
          mediaMap.push({ id: mediaIdOf(row), path: path, label: trim(row.label) });
        }
      } catch (_) {
        // Named, counted, and the copy goes on. Silently dropping it is how
        // an archive ends up quietly incomplete.
        failed.push(trim(row.label) || leafOf(row.key));
        if (mediaIdOf(row)) {
          mediaMap.push({ id: mediaIdOf(row), path: '', label: trim(row.label) });
        }
      }
      done += 1;
      report(name);
    }

    // ---- the files the copy makes for itself ----------------------------
    const madeHere = [];

    /**
     * A component that could not be READ is not a component that is ABSENT.
     *
     * "No Floor Survey readings are stored for this job" and "the stored
     * Floor Survey could not be read" lead to opposite actions, and the
     * second one is the one worth acting on. The copy is told which by the
     * Explorer, which gets it from the explore route.
     */
    const unreadable = {};
    (Array.isArray(options.unreadable) ? options.unreadable : []).forEach(function (name) {
      unreadable[trim(name)] = true;
    });
    const sayAbsent = function (name, absentLine, unreadableLine) {
      missing.push(unreadable[name] ? unreadableLine : absentLine);
    };

    const details = Summary.customerDetailsText(components.customer, components.index);
    if (details) {
      zip.file(root + '/Customer details.txt', details);
      madeHere.push({ name: 'Customer details.txt', what: 'who the job was for, and where' });
    } else {
      sayAbsent('customer',
        'Customer details. No customer information is stored for this job.',
        'Customer details. The stored customer information could not be read, ' +
        'so none of it is in this copy. It is still in the File Cabinet.');
    }

    const readingNotes = [];
    const readings = Summary.readingsCsv(components.floor, components.plans, readingNotes);
    if (readings) {
      zip.file(root + '/Floor Survey readings.csv', readings);
      madeHere.push({
        name: 'Floor Survey readings.csv',
        what: 'every reading, raw and corrected, with its position',
      });
    } else {
      sayAbsent('floor',
        'A readings CSV. No Floor Survey readings are stored for this job.',
        'A readings CSV. The stored Floor Survey could not be read, so no ' +
        'readings could be written out. They are still in the File Cabinet.');
    }
    readingNotes.forEach(function (note) { missing.push(note); });

    /**
     * The pin list is built AFTER the packing, because its photograph column
     * is a path into this folder and nothing knows those paths until the
     * bytes have landed -- including the suffix a name collision forced.
     */
    const pathForMedia = function (mediaId) {
      const id = trim(mediaId);
      return id ? (packed['media/' + id] || '') : '';
    };
    const pins = Summary.pinsCsv(components.distress, components.plans,
      components.floor, pathForMedia);
    if (pins) {
      zip.file(root + '/Distress Survey pins.csv', pins);
      madeHere.push({
        name: 'Distress Survey pins.csv',
        what: 'each numbered pin, its room, its note, and the file each of its ' +
          'photographs is in',
      });
    } else {
      sayAbsent('distress',
        'A pin list. No Distress Survey pins are stored for this job.',
        'A pin list. The stored Distress Survey could not be read, so no pins ' +
        'could be written out. They are still in the File Cabinet.');
    }

    const mapCsv = Summary.mediaMapCsv(mediaMap);
    if (mapCsv) {
      zip.file(root + '/Technical/Photograph and plan file names.csv', mapCsv);
    }

    /**
     * The finished documents, named honestly, from WHAT WAS PACKED.
     *
     * This used to test whether a folder existed. A Floor Survey figure and a
     * Floor Survey recovery PDF both land in Floor Survey/, so a job with a
     * figure and no PDF was told it had a PDF. And whether Distress
     * photographs exist says nothing at all about whether a Distress PDF
     * does -- Toolbox does not produce one either way -- so one gated the
     * other for no reason and both lines vanished together.
     *
     * Counted by purpose now, which is what the thing IS.
     */
    if (!havePurpose['floor-pdf']) {
      sayAbsent('floor',
        'A PDF of the Floor Survey. None is stored for this job' +
        (havePurpose['floor-figure'] ? ', though its figures are in Floor Survey/.' : '.'),
        'A PDF of the Floor Survey. The stored Floor Survey could not be read, ' +
        'so whether it has one is unknown.');
    }

    // Toolbox does not produce one, whatever else the job holds.
    if (components.distress || unreadable.distress) {
      missing.push('A PDF of the Distress Survey. Toolbox does not produce one.');
    }

    /**
     * The report, described by the files this copy actually wrote.
     *
     * The record is written under its readable label, so naming
     * "Technical/report.json" pointed at a file that is not there. And
     * Report/ only exists when the report had pictures placed in it.
     */
    const reportRecordPath = packed['cf/' + options.id + '/report.json'] || '';
    const reportParts = ['A finished report PDF. Toolbox prints the report from ' +
      'the application and does not keep the printed file, so the File Cabinet ' +
      'has never held one.'];
    if (folders['Report']) {
      reportParts.push('Report/ holds the pictures placed in it.');
    }
    if (reportRecordPath) {
      reportParts.push('The report Toolbox can rebuild is ' + reportRecordPath + '.');
    } else if (unreadable.report) {
      reportParts.push('The stored report could not be read, so it is not in this copy.');
    } else {
      reportParts.push('No report has been started for this job.');
    }
    missing.push(reportParts.join(' '));

    if (unreadable.plans) {
      missing.push('The plans record could not be read, so the levels could not ' +
        'be named and the plan pictures are listed under their stored names.');
    }
    if (unreadable.diagnostics) {
      missing.push('The stored Diagnostics could not be read.');
    }

    failed.forEach(function (label) {
      missing.push(label + ' \u2014 stored, but could not be read when this copy was taken.');
    });

    const folderList = Object.keys(folders).sort().map(function (key) {
      return {
        name: key + '/',
        what: folders[key] + (folders[key] === 1 ? ' file — ' : ' files — ') +
          (FOLDER_IS[key] || 'stored files'),
      };
    });

    const cover = Summary.coverSheet({
      name: options.name,
      address: options.address,
      components: components,
      folders: madeHere.concat(folderList),
      missing: missing,
    });
    zip.file(root + '/README.txt', cover);

    const blob = await zip.generateAsync({ type: 'blob' });
    return {
      blob: blob,
      filename: root + '.zip',
      root: root,
      written: total - failed.length,
      total: total,
      failed: failed,
      missing: missing,
    };
  }

  window.ToolboxExplorerArchive = {
    buildJobArchive: buildJobArchive,
    folderFor: folderFor,
    leafOf: leafOf,
  };
})();
