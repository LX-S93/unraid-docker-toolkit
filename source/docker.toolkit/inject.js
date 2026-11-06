/* Docker Toolkit – additions to the Add/Update Container pages */
$(function () {
  var $ex = $('input[name="contExtraParams"]'), $net = $('select[name="contNetwork"]'),
      $ip = $('input[name="contMyIP"]'), $mac = $('input[name="contMyMAC"]'), $name = $('input[name="contName"]');
  if (!$ex.length || $ex.data('dt')) return;
  $ex.data('dt', 1);
  var isNew = location.pathname.indexOf('AddContainer') >= 0 && !$('input[name="existingContainer"]').val();
  var st = null;

  /* ---------- RAM limit slider (sensible steps) ---------- */
  var STEPS = [256, 512, 768, 1024, 1536, 2048, 3072, 4096, 6144, 8192, 12288, 16384, 24576, 32768, 49152, 65536];
  var $row = $('<dl class="dt-row"><dt>Memory limit:</dt><dd>' +
    '<input type="range" class="dt-range" min="0" step="1" value="5"> <span class="dt-val"></span>' +
    '<label class="dt-unl"><input type="checkbox"> unlimited</label>' +
    '<div class="dt-hint dt-muted"></div></dd></dl>');
  var $anc = $('input[name="contPrivileged"]').closest('dl');
  ($anc.length ? $anc : $ex.closest('dl')).after($row);
  var $rng = $row.find('.dt-range'), $unl = $row.find('.dt-unl input'), $val = $row.find('.dt-val'), $hint = $row.find('.dt-hint');
  function setSteps(hostMb) {
    var s = STEPS.filter(function (v) { return v <= hostMb; });
    if (s.length) STEPS = s;
    $rng.attr('max', STEPS.length - 1);
  }
  function idxFor(mb) {
    var best = 0;
    STEPS.forEach(function (v, i) { if (Math.abs(v - mb) < Math.abs(STEPS[best] - mb)) best = i; });
    return best;
  }
  function showMem() {
    var cur = DT.memFromExtra($ex.val());
    if (cur == null) { $unl.prop('checked', true); $rng.prop('disabled', true); $val.text('unlimited'); }
    else {
      $unl.prop('checked', false); $rng.prop('disabled', false).val(idxFor(cur));
      $val.text(DT.fmtMb(cur));
    }
  }
  // write into Extra Parameters and tell Unraid the form changed (enables "Apply")
  function setExtra(v) { $ex.val(v).trigger('input').trigger('change'); }
  $rng.attr('max', STEPS.length - 1);
  $rng.on('input', function () { $val.text(DT.fmtMb(STEPS[+this.value])); })
      .on('change', function () { setExtra(DT.memToExtra($ex.val(), STEPS[+this.value])); });
  $unl.on('change', function () {
    setExtra(DT.memToExtra($ex.val(), this.checked ? 0 : STEPS[+$rng.val()]));
  });
  $ex.on('change keyup', showMem);

  /* ---------- IP / MAC ---------- */
  var $ipBtn = $('<button type="button" class="dt-btn">Next free IP</button>'), $ipInfo = $('<span class="dt-info"></span>');
  var $macBtn = $('<button type="button" class="dt-btn">Generate MAC</button>'), $macInfo = $('<span class="dt-info"></span>');
  $ip.after($('<div class="dt-line"></div>').append($ipBtn, $ipInfo));
  $mac.after($('<div class="dt-line"></div>').append($macBtn, $macInfo));
  function netInfo() { return st && st.networks[$net.val()]; }
  function owners(ip) {
    var n = netInfo(); if (!n || !n.used[ip]) return [];
    var me = $name.val();
    return n.used[ip].filter(function (e) { return e.name !== me; });
  }
  function label(e) {
    var t = { template: 'template, container not created', scan: 'device', manual: 'device', gateway: 'gateway' }[e.type];
    if (e.type === 'container' && !e.running) t = 'container stopped';
    return DT.esc(e.name || e.type) + (t ? ' (' + t + ')' : '');
  }
  function checkIp() {
    var n = netInfo(), ip = $.trim($ip.val());
    if (!n) { $ipBtn.hide(); $macBtn.hide(); $ipInfo.text(''); $macInfo.text(''); return; }
    $ipBtn.show(); $macBtn.show();
    if (!ip) { $ipInfo.html('<span class="dt-warn">without a fixed IP Docker picks any address</span>'); return; }
    var o = owners(ip);
    var inNet = (function () {
      var p = n.subnet.split('/'), toL = function (a) { return a.split('.').reduce(function (s, x) { return s * 256 + (+x); }, 0); };
      var len = +p[1], base = toL(p[0]), mask = len === 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0, v = toL(ip);
      return /^\d+\.\d+\.\d+\.\d+$/.test(ip) && ((v & mask) >>> 0) === ((base & mask) >>> 0);
    })();
    if (!inNet) $ipInfo.html('<span class="dt-bad">not in ' + n.subnet + '</span>');
    else if (o.length) $ipInfo.html('<span class="dt-bad">in use: ' + o.map(label).join(', ') + '</span>');
    else $ipInfo.html('<span class="dt-ok">free</span> <span class="dt-muted">(' + n.free_count + ' free addresses in ' + $net.val() + ')</span>');
  }
  function suggestIp() {
    var n = netInfo(); if (!n) return;
    var f = n.free.filter(function (ip) { return !owners(ip).length; });
    if (f.length) { $ip.val(f[0]).trigger('change'); }
    else $ipInfo.html('<span class="dt-bad">no free address left</span>');
    checkIp();
  }
  function genMac() {
    DT.get({ action: 'mac', name: $name.val(), net: $net.val() }).done(function (r) {
      $mac.val(r.mac).trigger('change'); $macInfo.html('<span class="dt-ok">fixed MAC set</span>');
    });
  }
  function currentMac() {
    var n = netInfo(), me = $name.val(); if (!n) return '';
    for (var ip in n.used) for (var i = 0; i < n.used[ip].length; i++) {
      var e = n.used[ip][i]; if (e.type === 'container' && e.name === me && e.mac) return e.mac;
    }
    return '';
  }
  function autoFill() {
    var n = netInfo(); if (!n) { checkIp(); return; }
    if (!$.trim($ip.val()) && isNew) suggestIp();
    if (!$.trim($mac.val())) {
      var cm = currentMac();
      if (cm) { $mac.val(cm).trigger('input'); $macInfo.html('<span class="dt-ok">current MAC kept – stays the same from now on</span>'); }
      else genMac();
    }
    checkIp();
  }
  $ipBtn.on('click', suggestIp);
  $macBtn.on('click', genMac);
  $ip.on('change keyup', checkIp);
  $net.on('change', autoFill);

  DT.get({ action: 'state' }).done(function (r) {
    st = r;
    setSteps(r.host_mem_mb);
    var def = r.settings.default_mem_mb;
    $hint.text('Default for new containers: ' + DT.fmtMb(def) + ' · saved as --memory in Extra Parameters on Apply');
    if (isNew && DT.memFromExtra($ex.val()) == null && def > 0) $ex.val(DT.memToExtra($ex.val(), def));
    showMem();
    autoFill();
  }).fail(function () { showMem(); $hint.text('Docker Toolkit: could not load data'); });
});
