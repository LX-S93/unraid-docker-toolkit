/* Docker Toolkit – IPAM page */
$(function () {
  var TYPE = { gateway: 'Gateway', container: 'Container', template: 'Template', manual: 'Device', scan: 'Device (scan)' };
  var NETS = {}, q = '', hideEmpty = true, showTpl = false;
  try { hideEmpty = localStorage.getItem('dt-hide-empty') !== '0'; showTpl = localStorage.getItem('dt-show-tpl') === '1'; } catch (e) {}
  $('#dt-hide-empty').prop('checked', hideEmpty);
  $('#dt-show-tpl').prop('checked', showTpl);

  function msg(t, bad) { $('#dt-msg').toggleClass('dt-bad', !!bad).text(t).show(); }
  function toL(ip) { return ip.split('.').reduce(function (s, x) { return s * 256 + (+x); }, 0); }
  function toIp(n) { return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.'); }
  function cidr(c) {
    var p = c.split('/'), len = +p[1], mask = len === 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0, net = (toL(p[0]) & mask) >>> 0;
    return { first: net + 1, last: ((net | ~mask) >>> 0) - 1 };
  }
  function reserved(n, ip) {
    var v = toL(ip);
    return (n.reserved || []).filter(function (r) { return v >= toL(r.from) && v <= toL(r.to || r.from); })[0];
  }
  function ago(ts) {
    if (!ts) return '';
    var d = Math.round((Date.now() / 1000 - ts) / 60);
    return d < 60 ? d + ' min ago' : (d < 1440 ? Math.round(d / 60) + ' h ago' : Math.round(d / 1440) + ' days ago');
  }
  function day(ts) { return ts ? new Date(ts * 1000).toISOString().slice(0, 10) : ''; }
  function icon(e) {
    if (e.type === 'gateway') return '<i class="fa fa-sign-out dt-ico-fa"></i>';
    if (e.type === 'manual' || e.type === 'scan') return '<i class="fa fa-desktop dt-ico-fa"></i>';
    var local = '/state/plugins/dynamix.docker.manager/images/' + encodeURIComponent(e.name) + '-icon.png';
    return '<img class="dt-ico' + (e.orphan ? ' dt-faded' : '') + '" src="' + local + '" onerror="this.onerror=null;this.src=\'' + DT.esc(e.icon || '/plugins/dynamix.docker.manager/images/question.png') + '\'">';
  }
  function visible(list) { return (list || []).filter(function (e) { return showTpl || !e.orphan; }); }
  function cls(entries, conflict, latent, res) {
    if (conflict) return 'conflict';
    if (latent && showTpl) return 'latent';
    if (!entries.length) return res ? 'res' : 'free';
    var e = entries[0];
    if (e.type === 'gateway') return 'gw';
    if (e.type === 'container') return e.running ? 'run' : 'stop';
    if (e.type === 'template') return 'tpl';
    return 'dev';
  }
  function matches(e, ip) {
    if (!q) return true;
    return (ip + ' ' + (e ? (e.name || '') + ' ' + (e.mac || '') : '')).toLowerCase().indexOf(q) >= 0;
  }
  function chip(t, c, title) { return '<span class="dt-chip ' + c + '"' + (title ? ' title="' + DT.esc(title) + '"' : '') + '>' + t + '</span>'; }
  function btn(cls, label, data, extra) {
    var d = Object.keys(data).map(function (k) { return ' data-' + k + '="' + DT.esc(data[k]) + '"'; }).join('');
    return '<button type="button" class="dt-act ' + cls + (extra ? ' ' + extra : '') + '"' + d + '>' + label + '</button>';
  }

  function actions(e, ip, conflict) {
    var a = [], hot = conflict ? 'dt-hot' : '';
    if (e.type === 'container') {
      if (e.has_tpl && (!e.fixed_ip || !e.fixed_mac)) a.push(btn('dt-pin', 'Pin', { name: e.name }, 'dt-good'));
      if (e.has_tpl) a.push(btn('dt-chg', 'Change IP', { name: e.name, ip: ip, exists: 1 }, hot));
    } else if (e.type === 'template') {
      if (e.orphan) {
        a.push(btn('dt-chg', 'Change IP', { name: e.name, ip: ip, exists: 0 }, hot));
        a.push(btn('dt-arch', 'Archive', { name: e.name }));
      } else {
        a.push(btn('dt-rebuild', 'Recreate now', { name: e.name }));
        a.push(btn('dt-chg', 'Change IP', { name: e.name, ip: ip, exists: 1 }, hot));
      }
    } else if (e.type === 'scan' || e.type === 'manual') {
      if (e.type === 'scan') a.push(btn('dt-edit', 'Pin', { ip: ip, name: e.name, mac: e.mac, note: e.note || '' }, 'dt-good'));
      a.push(btn('dt-move', 'Change IP', { ip: ip, name: e.name }, hot));
      a.push(btn('dt-edit', 'Edit', { ip: ip, name: e.name, mac: e.mac, note: e.note || '' }));
      a.push(btn('dt-del', 'Remove', { ip: ip }));
    }
    return a.join('');
  }

  function card(nn) {
    var n = NETS[nn], r = cidr(n.subnet), tiles = [], rows = [], hits = 0;
    var cnt = 0, run = 0, orphans = 0;
    for (var v = r.first; v <= r.last && v < r.first + 1024; v++) {
      var ip = toIp(v), list = visible(n.used[ip]), res = reserved(n, ip);
      var conflict = n.conflicts.indexOf(ip) >= 0, latent = (n.latent || []).indexOf(ip) >= 0;
      var c = cls(list, conflict, latent, res), hit = q && (list.length ? list.some(function (e) { return matches(e, ip); }) : matches(null, ip));
      if (hit) hits++;
      var tip = ip + (list.length ? '\n' + list.map(function (e) { return (e.orphan ? 'Leftover template' : (TYPE[e.type] || e.type)) + ': ' + (e.name || '–') + (e.mac ? ' (' + e.mac + ')' : ''); }).join('\n') : (res ? '\nReserved: ' + (res.note || '') : '\nfree'));
      tiles.push('<div class="dt-tile t-' + c + (hit ? ' hit' : '') + (q && !hit ? ' dim' : '') + '" data-ip="' + ip + '" title="' + DT.esc(tip) + '">' +
        '<span class="o">.' + (v & 255) + '</span>' + (list.length && list[0].type !== 'gateway' ? '<span class="n">' + DT.esc((list[0].name || '').slice(0, 9)) + '</span>' : '') + '</div>');
    }
    Object.keys(n.used).forEach(function (ip) {
      var conflict = n.conflicts.indexOf(ip) >= 0, latent = (n.latent || []).indexOf(ip) >= 0;
      n.used[ip].forEach(function (e) {
        if (e.type === 'container') { cnt++; if (e.running) run++; }
        if (e.orphan) orphans++;
        if (e.type === 'gateway' || (e.orphan && !showTpl)) return;
        var st = [];
        if (e.type === 'container') st.push(e.running ? chip('running', 'c-run') : chip('stopped', 'c-stop'));
        if (e.type === 'template' && e.orphan) st.push(chip('leftover template', 'c-tpl', 'The container was removed or renamed; Unraid kept its template' + (e.mtime ? ' (last changed ' + day(e.mtime) + ')' : '')));
        if (e.type === 'template' && !e.orphan) st.push(chip('pending – applies on recreate', 'c-warn'));
        if (e.type === 'container' && !e.has_tpl) st.push(chip('no template', 'c-stop'));
        if ((e.type === 'container' && e.has_tpl) || (e.type === 'template' && !e.orphan)) {
          st.push(e.fixed_ip ? chip('fixed IP', 'c-ok') : chip('dynamic IP', 'c-warn'));
          st.push(e.fixed_mac ? chip('fixed MAC', 'c-ok') : chip('random MAC', 'c-warn'));
        }
        if (e.type === 'scan') st.push(chip('seen ' + ago(e.seen), 'c-dev', 'Found by network scan – Pin to keep it as a fixed entry'));
        if (e.type === 'manual') st.push(chip('fixed entry', 'c-dev'));
        if (conflict) st.push(chip('duplicate IP', 'c-bad'));
        else if (latent && !e.orphan) st.push(chip('also in a leftover template', 'c-warn'));
        rows.push('<tr data-ip="' + ip + '" class="' + (conflict ? 'dt-conflict' : '') + (e.orphan ? ' dt-orphan' : '') + (q && !matches(e, ip) ? ' dt-hide' : '') + '">' +
          '<td>' + icon(e) + '</td><td><b>' + DT.esc(e.name || '–') + '</b>' + (e.note ? '<br><span class="dt-muted">' + DT.esc(e.note) + '</span>' : '') + '</td>' +
          '<td><code>' + ip + '</code></td><td><code>' + DT.esc(e.mac || '') + '</code></td><td>' + st.join(' ') + '</td><td class="dt-acts">' + actions(e, ip, conflict) + '</td></tr>');
      });
    });
    var hasDev = Object.keys(n.used).some(function (ip) { return visible(n.used[ip]).some(function (e) { return e.type !== 'gateway'; }); });
    if (hideEmpty && !q && !cnt && !hasDev && !n.no_ip.length) return '';
    if (q && !hits && !n.no_ip.some(function (x) { return x.name.toLowerCase().indexOf(q) >= 0; })) return '';
    var used = n.total - n.free_count, pct = n.total ? Math.round(used / n.total * 100) : 0;
    var state = n.conflicts.length ? chip(n.conflicts.length + ' duplicate', 'c-bad') : (n.free_count === 0 ? chip('full', 'c-bad') : (pct >= 80 ? chip('almost full', 'c-warn') : chip('ok', 'c-ok')));
    var res = (n.reserved || []).map(function (x, i) {
      return '<span class="dt-chip c-res">' + x.from + (x.to && x.to !== x.from ? ' – ' + x.to : '') + (x.note ? ' · ' + DT.esc(x.note) : '') + ' <a href="#" class="dt-resdel" data-idx="' + i + '">×</a></span>';
    }).join(' ');
    var noip = n.no_ip.length ? '<div class="dt-noip"><b>Containers without an IP</b> <span class="dt-muted">(Docker assigns a random one on start)</span><br>' +
      n.no_ip.map(function (x) { return '<span class="dt-noip-item">' + icon({ type: 'container', name: x.name, icon: x.icon }) + ' ' + DT.esc(x.name) + ' ' + btn('dt-chg', 'Assign IP', { name: x.name, ip: '', exists: 1 }, 'dt-good') + '</span>'; }).join('') + '</div>' : '';
    var nOrph = orphans + (n.orphans_no_ip || []).length;
    var orphNote = !nOrph ? '' : (!showTpl
      ? '<p class="dt-muted dt-small">' + nOrph + ' leftover templates of removed containers hidden – <a href="#" class="dt-show-tpl-link">show</a></p>'
      : '<p class="dt-small"><span class="dt-muted">' + nOrph + ' leftover templates shown' + (n.orphans_no_ip.length ? ' (' + n.orphans_no_ip.length + ' without IP: ' + n.orphans_no_ip.map(DT.esc).join(', ') + ')' : '') + ' – </span>' +
        '<a href="#" class="dt-hide-tpl-link">hide</a> · <a href="#" class="dt-arch-all">archive all ' + nOrph + ' in ' + nn + '</a></p>');
    return '<div class="dt-card" data-net="' + nn + '">' +
      '<div class="dt-card-head"><span class="dt-net-name">' + nn + '</span><span class="dt-muted">' + n.subnet + ' · gateway ' + (n.gateway || '–') + ' · ' + n.driver + '</span>' +
      '<span class="dt-grow"></span>' + state + ' <span class="dt-muted">' + run + '/' + cnt + ' containers running · ' + used + '/' + n.total + ' used · ' + n.free_count + ' free</span></div>' +
      '<div class="dt-bar dt-bar-wide"><div style="width:' + pct + '%"></div></div>' +
      '<div class="dt-map">' + tiles.join('') + '</div>' + noip +
      (rows.length ? '<table class="dt-table dt-assign"><thead><tr><th></th><th>Name</th><th>IP</th><th>MAC</th><th>Status</th><th></th></tr></thead><tbody>' + rows.join('') + '</tbody></table>' : '') +
      orphNote +
      '<div class="dt-actions"><button class="dt-scan">Scan network</button> <button class="dt-add">Add device</button> <button class="dt-resadd">Reserve range</button> ' + res +
      (n.free.length ? ' <span class="dt-muted">next free: <code>' + n.free[0] + '</code></span>' : '') + '</div></div>';
  }
  function render() {
    var html = Object.keys(NETS).map(card).join('');
    $('#dt-nets').html(html || '<p class="dt-muted">Nothing found.</p>');
  }
  function load() {
    return DT.get({ action: 'state' }).done(function (r) { NETS = r.networks; render(); }).fail(function (x) { msg(DT.err(x), true); });
  }
  function done(p) { return p.done(function (r) { if (r && r.message) msg(r.message); load(); }).fail(function (x) { msg(DT.err(x), true); }); }
  function netOf(el) { return $(el).closest('.dt-card').data('net'); }

  /* ---------- dialog ---------- */
  var $dlg = $('<div id="dt-dlg"><div class="dt-dlg-box"><div class="dt-dlg-title"></div><div class="dt-dlg-body"></div>' +
    '<div class="dt-dlg-foot"><span class="dt-dlg-err dt-bad"></span><span class="dt-grow"></span><button type="button" class="dt-dlg-cancel">Cancel</button> <button type="button" class="dt-dlg-ok">Apply</button></div></div></div>').appendTo('body');
  var dlgOk = null;
  function dialog(title, body, ok) {
    $dlg.find('.dt-dlg-title').text(title);
    $dlg.find('.dt-dlg-body').html(body);
    $dlg.find('.dt-dlg-err').text('');
    $dlg.find('.dt-dlg-ok').prop('disabled', false).text('Apply');
    dlgOk = ok;
    $dlg.show();
    $dlg.find('input[type=text]').first().focus().select();
  }
  function closeDlg() { $dlg.hide(); dlgOk = null; }
  $dlg.on('click', '.dt-dlg-cancel', closeDlg)
    .on('click', function (ev) { if (ev.target === this) closeDlg(); })
    .on('click', '.dt-dlg-ok', function () {
      if (!dlgOk) return;
      var b = $(this).prop('disabled', true).text('Working …');
      dlgOk().done(function (r) { closeDlg(); if (r && r.message) msg(r.message); load(); })
        .fail(function (x) { b.prop('disabled', false).text('Apply'); $dlg.find('.dt-dlg-err').text(DT.err(x)); });
    })
    .on('keydown', 'input', function (ev) { if (ev.key === 'Enter') $dlg.find('.dt-dlg-ok').click(); if (ev.key === 'Escape') closeDlg(); })
    .on('click', '.dt-pick', function () { $dlg.find('#dt-newip').val($(this).text()); });
  function freePicker(n) {
    return n.free.length ? '<div class="dt-picks">Free: ' + n.free.slice(0, 12).map(function (ip) { return '<a href="#" class="dt-pick" onclick="return false">' + ip + '</a>'; }).join(' ') + '</div>' : '<p class="dt-bad">No free address left in this network.</p>';
  }

  /* ---------- events ---------- */
  $('#dt-search').on('input', function () { q = $.trim(this.value).toLowerCase(); render(); });
  $('#dt-hide-empty').on('change', function () {
    hideEmpty = this.checked; try { localStorage.setItem('dt-hide-empty', hideEmpty ? '1' : '0'); } catch (e) {}
    render();
  });
  function setShowTpl(v) {
    showTpl = v; $('#dt-show-tpl').prop('checked', v);
    try { localStorage.setItem('dt-show-tpl', v ? '1' : '0'); } catch (e) {}
    render();
  }
  $('#dt-show-tpl').on('change', function () { setShowTpl(this.checked); });
  $('#dt-nets').on('click', '.dt-show-tpl-link', function (ev) { ev.preventDefault(); setShowTpl(true); })
    .on('click', '.dt-hide-tpl-link', function (ev) { ev.preventDefault(); setShowTpl(false); })
    .on('click', '.dt-arch-all', function (ev) {
      ev.preventDefault();
      var nn = netOf(this), n = NETS[nn], names = (n.orphans_no_ip || []).slice();
      Object.keys(n.used).forEach(function (ip) { n.used[ip].forEach(function (e) { if (e.orphan && names.indexOf(e.name) < 0) names.push(e.name); }); });
      dialog('Archive ' + names.length + ' leftover templates in ' + nn,
        '<p>These templates belong to containers that no longer exist:</p><p class="dt-small">' + names.map(DT.esc).join(', ') + '</p>' +
        '<p class="dt-muted dt-small">They disappear from Apps › Previous Apps and from this page. The files are kept in /boot/config/plugins/docker.toolkit/archived-templates.</p>',
        function () {
          var dfd = $.Deferred(), i = 0, ok = 0;
          (function next() {
            if (i >= names.length) return dfd.resolve({ message: ok + ' of ' + names.length + ' templates archived' });
            DT.post({ action: 'tpl_archive', name: names[i++] }).done(function () { ok++; }).always(next);
          })();
          return dfd.promise();
        });
      $dlg.find('.dt-dlg-ok').text('Archive all');
    });

  $('#dt-nets').on('click', '.dt-tile', function () {
    var ip = $(this).data('ip'), row = $(this).closest('.dt-card').find('tr[data-ip="' + ip + '"]');
    $('.dt-assign tr.sel').removeClass('sel');
    if (row.length) { row.addClass('sel'); row[0].scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
  }).on('click', '.dt-scan', function () {
    var nn = netOf(this), b = $(this).prop('disabled', true).text('Scanning …');
    DT.post({ action: 'scan', net: nn }).done(function (r) { msg(nn + ': ' + r.alive + ' addresses answered, ' + r.new + ' new devices added'); load(); })
      .fail(function (x) { b.prop('disabled', false).text('Scan network'); msg(DT.err(x), true); });
  }).on('click', '.dt-pin', function () {
    var b = $(this).prop('disabled', true);
    done(DT.post({ action: 'pin', name: $(this).data('name') })).fail(function () { b.prop('disabled', false); });
  }).on('click', '.dt-chg', function () {
    var nn = netOf(this), d = $(this).data(), n = NETS[nn];
    var sug = n.free[0] || '';
    dialog((d.ip ? 'Change IP of ' : 'Assign IP to ') + d.name,
      (d.ip ? '<p>Current: <code>' + d.ip + '</code> in ' + nn + '</p>' : '<p>Network ' + nn + ' (' + n.subnet + ')</p>') +
      '<p>New IP: <input type="text" id="dt-newip" value="' + sug + '" style="width:160px"></p>' + freePicker(n) +
      (+d.exists ? '<p><label><input type="checkbox" id="dt-recreate" checked> Recreate the container now so the new IP is used (short downtime; containers sharing its network are recreated too)</label></p>'
        : '<p class="dt-muted">Leftover template – only the template is changed.</p>') +
      '<p class="dt-muted dt-small">A fixed MAC is set as well if the template has none. A backup of all templates is created first.</p>',
      function () {
        return DT.post({ action: 'set_ip', net: nn, name: d.name, ip: $.trim($('#dt-newip').val()), recreate: $('#dt-recreate').is(':checked') ? 1 : 0 });
      });
  }).on('click', '.dt-move', function () {
    var nn = netOf(this), d = $(this).data(), n = NETS[nn];
    dialog('Change IP of ' + (d.name || d.ip),
      '<p>Current: <code>' + d.ip + '</code> in ' + nn + '</p><p>New IP: <input type="text" id="dt-newip" value="' + (n.free[0] || '') + '" style="width:160px"></p>' + freePicker(n) +
      '<p class="dt-warn dt-small">This only updates the IPAM record. Set the new address on the device itself (or in its DHCP reservation).</p>',
      function () { return DT.post({ action: 'host_move', net: nn, ip: d.ip, newip: $.trim($('#dt-newip').val()) }); });
  }).on('click', '.dt-rebuild', function () {
    var name = $(this).data('name');
    dialog('Recreate ' + name, '<p>Recreate <b>' + DT.esc(name) + '</b> from its template now? It is stopped and started again (short downtime); containers sharing its network are recreated too.</p>',
      function () { return DT.post({ action: 'rebuild', name: name }); });
  }).on('click', '.dt-arch', function () {
    var name = $(this).data('name');
    dialog('Archive template ' + name,
      '<p>Move the leftover template <b>' + DT.esc(name) + '</b> out of Unraid\'s template folder?</p><p class="dt-muted dt-small">It disappears from Apps › Previous Apps and from this page. The file is kept in /boot/config/plugins/docker.toolkit/archived-templates and can be moved back any time.</p>',
      function () { return DT.post({ action: 'tpl_archive', name: name }); });
    $dlg.find('.dt-dlg-ok').text('Archive');
  }).on('click', '.dt-add, .dt-edit', function (ev) {
    ev.preventDefault();
    var nn = netOf(this), d = $(this).data(), isNew = $(this).hasClass('dt-add');
    dialog(isNew ? 'Add device to ' + nn : 'Device ' + (d.ip || ''),
      '<table class="dt-form"><tr><td>IP</td><td><input type="text" id="dt-h-ip" value="' + DT.esc(d.ip || NETS[nn].free[0] || '') + '"' + (isNew ? '' : ' disabled') + '></td></tr>' +
      '<tr><td>Name</td><td><input type="text" id="dt-h-name" value="' + DT.esc(d.name || '') + '"></td></tr>' +
      '<tr><td>MAC</td><td><input type="text" id="dt-h-mac" value="' + DT.esc(d.mac || '') + '" placeholder="optional"></td></tr>' +
      '<tr><td>Note</td><td><input type="text" id="dt-h-note" value="' + DT.esc(d.note || '') + '" placeholder="optional"></td></tr></table>' +
      '<p class="dt-muted dt-small">Saved as a fixed entry: the address counts as used and is never suggested for containers.</p>',
      function () {
        return DT.post({ action: 'host_set', net: nn, ip: $.trim($('#dt-h-ip').val()), name: $.trim($('#dt-h-name').val()), mac: $.trim($('#dt-h-mac').val()), note: $.trim($('#dt-h-note').val()) });
      });
  }).on('click', '.dt-del', function () {
    done(DT.post({ action: 'host_del', net: netOf(this), ip: $(this).data('ip') }));
  }).on('click', '.dt-resadd', function () {
    var nn = netOf(this);
    dialog('Reserve range in ' + nn,
      '<table class="dt-form"><tr><td>From</td><td><input type="text" id="dt-r-from"></td></tr><tr><td>To</td><td><input type="text" id="dt-r-to" placeholder="empty = single address"></td></tr>' +
      '<tr><td>Purpose</td><td><input type="text" id="dt-r-note" placeholder="e.g. DHCP pool of the firewall"></td></tr></table>',
      function () { return DT.post({ action: 'reserve_add', net: nn, from: $.trim($('#dt-r-from').val()), to: $.trim($('#dt-r-to').val()), note: $.trim($('#dt-r-note').val()) }); });
  }).on('click', '.dt-resdel', function (ev) {
    ev.preventDefault();
    done(DT.post({ action: 'reserve_del', net: netOf(this), idx: $(this).data('idx') }));
  });

  $('#dt-import').on('click', function () {
    var b = $(this).prop('disabled', true);
    DT.get({ action: 'import', apply: 0 }).done(function (r) {
      b.prop('disabled', false);
      var ch = r.changes.filter(function (c) { return Object.keys(c.set).length; });
      var html = ch.length
        ? '<p><b>' + ch.length + ' containers</b> get fixed values in their template (running containers keep their current IP/MAC):</p><table class="dt-table"><tr><th>Container</th><th>Network</th><th>Fixed IP</th><th>Fixed MAC</th></tr>' +
          ch.map(function (c) { return '<tr><td>' + DT.esc(c.name) + '</td><td>' + c.network + '</td><td>' + (c.set.MyIP || '<span class="dt-muted">already fixed</span>') + '</td><td>' + (c.set.MyMAC ? '<code>' + c.set.MyMAC + '</code>' : '<span class="dt-muted">already fixed</span>') + '</td></tr>'; }).join('') +
          '</table><p><button id="dt-import-go">Apply now</button> <span class="dt-muted">A backup of all templates is created first.</span></p>'
        : '<p class="dt-ok">All containers with an IP already have a fixed IP and MAC in their template.</p>';
      $('#dt-import-preview').html(html).show();
    }).fail(function (x) { b.prop('disabled', false); msg(DT.err(x), true); });
  });
  $('#dt-import-preview').on('click', '#dt-import-go', function () {
    var b = $(this).prop('disabled', true).text('Applying …');
    DT.post({ action: 'import', apply: 1 }).done(function (r) {
      $('#dt-import-preview').html('<p class="dt-ok">Done. Backup: <code>' + DT.esc(r.backup || '') + '</code></p>');
      load();
    }).fail(function (x) { b.prop('disabled', false).text('Apply now'); msg(DT.err(x), true); });
  });
  load();
});
