// Toolbox — short-lived Report Builder jump context.
// Set when leaving Report Builder for a source app; cleared on return or CF hub.

(function () {
  'use strict';

  var KEY = 'toolbox.reportReturn';

  function read() {
    try {
      var raw = sessionStorage.getItem(KEY);
      if (!raw) return null;
      var data = JSON.parse(raw);
      if (!data || !data.customerFileId) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function write(data) {
    try {
      if (!data || !data.customerFileId) {
        sessionStorage.removeItem(KEY);
        return;
      }
      sessionStorage.setItem(KEY, JSON.stringify({
        customerFileId: String(data.customerFileId),
        pageId: data.pageId ? String(data.pageId) : '',
        sourceKey: data.sourceKey ? String(data.sourceKey) : '',
        at: Date.now(),
      }));
    } catch (_) {}
  }

  function clear() {
    try { sessionStorage.removeItem(KEY); } catch (_) {}
  }

  function forFile(customerFileId) {
    var data = read();
    if (!data || !customerFileId) return null;
    if (String(data.customerFileId) !== String(customerFileId)) return null;
    return data;
  }

  window.ToolboxReportSession = {
    read: read,
    write: write,
    clear: clear,
    forFile: forFile,
  };
})();
