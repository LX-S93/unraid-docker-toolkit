/* Docker Toolkit – shared helpers */
var DT = window.DT || {};
DT.API = '/plugins/docker.toolkit/include/api.php';
DT.get = function (params) {
  return $.ajax({ url: DT.API, data: params, dataType: 'json', cache: false });
};
DT.post = function (params) {
  params = $.extend({ csrf_token: (typeof csrf_token !== 'undefined' ? csrf_token : '') }, params);
  return $.ajax({ url: DT.API, method: 'POST', data: params, dataType: 'json' });
};
DT.err = function (x) {
  var m = (x && x.responseJSON && x.responseJSON.error) || (x && x.statusText) || 'Error';
  return m;
};
DT.esc = function (s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
};
DT.fmtMb = function (mb) {
  if (mb == null) return '–';
  if (mb === 0) return 'unlimited';
  return mb >= 1024 ? (mb / 1024).toLocaleString('en-US', { maximumFractionDigits: 2 }) + ' GB' : mb + ' MB';
};
/* read/write memory limit in Extra Parameters (same logic as PHP) */
DT.memFromExtra = function (s) {
  var m = (' ' + (s || '')).match(/(?:--memory(?:=|\s+)|\s-m\s*)([0-9.]+)([bkmgBKMG]?)(?=\s|$)/);
  if (!m) return null;
  var v = parseFloat(m[1]), u = (m[2] || '').toLowerCase();
  if (u === 'g') return Math.round(v * 1024);
  if (u === 'm') return Math.round(v);
  if (u === 'k') return Math.round(v / 1024);
  return Math.round(v / 1048576);
};
DT.memToExtra = function (s, mb) {
  s = (' ' + (s || '')).replace(/\s*(--memory-swap(=|\s+)\S+|--memory(=|\s+)\S+|(^|\s)-m\s*\S+)/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (mb > 0) {
    var v = mb % 1024 === 0 ? (mb / 1024) + 'g' : mb + 'm';
    s = (s + ' --memory=' + v + ' --memory-swap=' + v).trim();
  }
  return s;
};
window.DT = DT;
