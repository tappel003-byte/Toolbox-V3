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

    const stored = rows.filter(function (row) { return row && !row.missing; });
    const absent = rows.filter(function (row) { return row && row.missing; });
    absent.forEach(function (row) {
      missing.push(trim(row.label) || leafOf(row.key));
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
      } catch (_) {
        // Named, counted, and the copy goes on. Silently dropping it is how
        // an archive ends up quietly incomplete.
        failed.push(trim(row.label) || leafOf(row.key));
      }
      done += 1;
      report(name);
    }

    // ---- the files the copy makes for itself ----------------------------
    const madeHere = [];

    const details = Summary.customerDetailsText(components.customer, components.index);
    if (details) {
      zip.file(root + '/Customer details.txt', details);
      madeHere.push({ name: 'Customer details.txt', what: 'who the job was for, and where' });
    }

    const readings = Summary.readingsCsv(components.floor, components.plans);
    if (readings) {
      zip.file(root + '/Floor Survey readings.csv', readings);
      madeHere.push({
        name: 'Floor Survey readings.csv',
        what: 'every reading, raw and corrected, with its position',
      });
    } else {
      missing.push('A readings CSV. No Floor Survey readings are stored for this job.');
    }

    const pins = Summary.pinsCsv(components.distress, components.plans, components.floor);
    if (pins) {
      zip.file(root + '/Distress Survey pins.csv', pins);
      madeHere.push({
        name: 'Distress Survey pins.csv',
        what: 'each numbered pin, its room, its note and its photographs',
      });
    } else {
      missing.push('A pin list. No Distress Survey pins are stored for this job.');
    }

    /**
     * The finished documents, named honestly.
     *
     * Floor Survey writes a recovery PDF, so a job that has one really does
     * carry a PDF of that survey. Report Builder prints from the application
     * and does not store the printed file, and Distress has no PDF at all
     * today -- so those are reported ABSENT rather than produced. Saying
     * otherwise, or quietly leaving the line out, is the fabricated report
     * the brief forbids.
     */
    if (!folders['Floor Survey']) {
      missing.push('A PDF of the Floor Survey. None is stored for this job.');
    }
    missing.push('A finished report PDF. Toolbox prints the report from the ' +
      'application and does not keep the printed file, so the Cabinet has ' +
      'never held one. Report/ holds the pictures placed in it, and the ' +
      'report Toolbox can rebuild is Technical/report.json.');
    if (!folders['Photographs/Distress Survey']) {
      missing.push('A PDF of the Distress Survey. Toolbox does not produce one.');
    }

    failed.forEach(function (label) {
      missing.push(label + ' — stored, but could not be read when this copy was taken.');
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
