<?php
// Docker Toolkit – shared functions (memory limits + IPAM)
const DT_CFG = '/boot/config/plugins/docker.toolkit';
const DT_TPL = '/boot/config/plugins/dockerMan/templates-user';

function dt_json_read($f, $def) {
  $p = DT_CFG . "/$f";
  if (!is_file($p)) return $def;
  $d = json_decode(file_get_contents($p), true);
  return is_array($d) ? $d : $def;
}

function dt_json_write($f, $d) {
  @mkdir(DT_CFG, 0777, true);
  $p = DT_CFG . "/$f";
  file_put_contents("$p.tmp", json_encode($d, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
  rename("$p.tmp", $p);
}

function dt_settings() {
  return array_merge(['default_mem_mb' => 2048], dt_json_read('settings.json', []));
}

function dt_sh($cmd) {
  $o = [];
  exec($cmd . ' 2>/dev/null', $o);
  return $o;
}

function dt_host_mem_mb() {
  foreach (file('/proc/meminfo') as $l) {
    if (preg_match('/^MemTotal:\s+(\d+)/', $l, $m)) return intdiv((int)$m[1], 1024);
  }
  return 0;
}

// ---------- RAM ----------
function dt_parse_mem($s) {
  if (!preg_match('/^(\d+(?:\.\d+)?)([bkmg]?)b?$/i', trim($s), $m)) return null;
  $v = (float)$m[1];
  switch (strtolower($m[2])) {
    case 'g': return (int)round($v * 1024);
    case 'm': return (int)round($v);
    case 'k': return (int)round($v / 1024);
    default:  return (int)round($v / 1048576);
  }
}

function dt_extra_get_mem($extra) {
  if (preg_match('/(?:--memory(?:=|\s+)|(?<!\S)-m\s*)([0-9.]+[bkmgBKMG]?)(?=\s|$)/', ' ' . $extra, $m)) return dt_parse_mem($m[1]);
  return null;
}

function dt_mem_str($mb) {
  return ($mb % 1024 == 0) ? ($mb / 1024) . 'g' : $mb . 'm';
}

function dt_extra_set_mem($extra, $mb) {
  $extra = preg_replace('/\s*(?:--memory-swap(?:=|\s+)\S+|--memory(?:=|\s+)\S+|(?<!\S)-m\s*\S+)/', '', ' ' . $extra);
  $extra = trim(preg_replace('/\s+/', ' ', $extra));
  if ($mb > 0) {
    $v = dt_mem_str($mb);
    $extra = trim("$extra --memory=$v --memory-swap=$v");
  }
  return $extra;
}

// ---------- Templates ----------
function dt_templates() {
  $r = [];
  foreach (glob(DT_TPL . '/my-*.xml') as $f) {
    $x = @simplexml_load_file($f);
    if (!$x || !(string)$x->Name) continue;
    $r[(string)$x->Name] = [
      'file' => $f, 'name' => (string)$x->Name, 'network' => trim((string)$x->Network),
      'ip' => trim((string)$x->MyIP), 'mac' => strtolower(trim((string)$x->MyMAC)),
      'extra' => trim((string)$x->ExtraParams), 'icon' => trim((string)$x->Icon),
    ];
  }
  return $r;
}

function dt_tpl_update($file, $changes) {
  $dom = new DOMDocument();
  $dom->preserveWhiteSpace = true;
  if (!@$dom->load($file)) return false;
  $root = $dom->documentElement;
  foreach ($changes as $tag => $val) {
    $n = null;
    foreach ($root->childNodes as $c) {
      if ($c->nodeType === XML_ELEMENT_NODE && $c->nodeName === $tag) { $n = $c; break; }
    }
    if (!$n) { $n = $dom->createElement($tag); $root->appendChild($n); }
    while ($n->firstChild) $n->removeChild($n->firstChild);
    $n->appendChild($dom->createTextNode($val));
  }
  return $dom->save($file) !== false;
}

function dt_backup_templates() {
  @mkdir(DT_CFG . '/backups', 0777, true);
  $f = DT_CFG . '/backups/templates-' . date('Ymd-His') . '.tgz';
  exec('tar -czf ' . escapeshellarg($f) . ' -C ' . escapeshellarg(dirname(DT_TPL)) . ' templates-user 2>&1', $o, $rc);
  if ($rc !== 0) throw new Exception('Template backup failed');
  return $f;
}

// ---------- Docker ----------
function dt_containers() {
  $ids = dt_sh('docker ps -aq --no-trunc');
  if (!$ids) return [];
  $arr = json_decode(shell_exec('docker inspect ' . implode(' ', array_map('escapeshellarg', $ids)) . ' 2>/dev/null'), true) ?: [];
  $r = [];
  foreach ($arr as $c) {
    $name = ltrim($c['Name'], '/');
    $nets = [];
    foreach (($c['NetworkSettings']['Networks'] ?? []) as $n => $v) {
      $ip = $v['IPAddress'] ?? '';
      if (!$ip) $ip = $v['IPAMConfig']['IPv4Address'] ?? '';
      $mac = strtolower($v['MacAddress'] ?? '');
      if (!$mac) $mac = strtolower($c['Config']['MacAddress'] ?? '');
      $nets[$n] = ['ip' => $ip, 'mac' => $mac];
    }
    $r[$name] = [
      'name' => $name, 'running' => !empty($c['State']['Running']),
      'mem_limit_mb' => intdiv((int)($c['HostConfig']['Memory'] ?? 0), 1048576),
      'netmode' => $c['HostConfig']['NetworkMode'] ?? '', 'nets' => $nets,
    ];
  }
  return $r;
}

function dt_mem_usage() {
  $r = [];
  foreach (dt_sh("docker stats --no-stream --format '{{.Name}}|{{.MemUsage}}'") as $l) {
    [$n, $u] = array_pad(explode('|', $l, 2), 2, '');
    $u = trim(explode('/', $u)[0]);
    if (preg_match('/^([0-9.]+)\s*([KMGT]i?B|B)$/', $u, $m)) {
      $f = ['B' => 1 / 1048576, 'KiB' => 1 / 1024, 'KB' => 1 / 1024, 'MiB' => 1, 'MB' => 1, 'GiB' => 1024, 'GB' => 1024, 'TiB' => 1048576, 'TB' => 1048576][$m[2]] ?? 1;
      $r[$n] = (int)round((float)$m[1] * $f);
    }
  }
  return $r;
}

function dt_ram_list() {
  $cons = dt_containers();
  $tpls = dt_templates();
  $use = dt_mem_usage();
  $out = [];
  foreach (array_unique(array_merge(array_keys($cons), array_keys($tpls))) as $n) {
    $c = $cons[$n] ?? null;
    $t = $tpls[$n] ?? null;
    $out[] = [
      'name' => $n, 'exists' => (bool)$c, 'running' => $c ? $c['running'] : false,
      'usage_mb' => $use[$n] ?? null, 'active_mb' => $c ? $c['mem_limit_mb'] : null,
      'template_mb' => $t ? dt_extra_get_mem($t['extra']) : null, 'has_template' => (bool)$t,
    ];
  }
  usort($out, fn($a, $b) => strnatcasecmp($a['name'], $b['name']));
  return $out;
}

function dt_set_mem($name, $mb, $live) {
  $msg = [];
  $t = dt_templates()[$name] ?? null;
  if ($t) {
    if (!dt_tpl_update($t['file'], ['ExtraParams' => dt_extra_set_mem($t['extra'], $mb)])) throw new Exception('Could not save template');
    $msg[] = 'template updated';
  }
  $c = dt_containers()[$name] ?? null;
  if ($live && $c) {
    if ($mb > 0) {
      exec('docker update --memory=' . (int)$mb . 'm --memory-swap=' . (int)$mb . 'm ' . escapeshellarg($name) . ' 2>&1', $o, $rc);
      $msg[] = $rc === 0 ? 'applied to running container' : ('docker update: ' . implode(' ', $o));
    } else {
      $msg[] = 'unlimited takes effect after the container is recreated';
    }
  }
  return implode(', ', $msg);
}

// ---------- IPAM ----------
function dt_cidr($cidr) {
  [$ip, $len] = explode('/', $cidr);
  $len = (int)$len;
  $n = ip2long($ip);
  $mask = $len == 0 ? 0 : ((0xFFFFFFFF << (32 - $len)) & 0xFFFFFFFF);
  $net = $n & $mask;
  $bc = $net | (~$mask & 0xFFFFFFFF);
  return [$net, $bc, $len];
}

function dt_in_subnet($ip, $cidr) {
  [$a, $b] = dt_cidr($cidr);
  $n = ip2long($ip);
  return $n !== false && $n > $a && $n < $b;
}

function dt_in_reserved($ip, $reserved) {
  $n = ip2long($ip);
  foreach ($reserved as $r) {
    $f = ip2long($r['from']);
    $t = ip2long($r['to'] ?: $r['from']);
    if ($n >= $f && $n <= $t) return true;
  }
  return false;
}

function dt_networks() {
  $list = [];
  foreach (dt_sh("docker network ls --format '{{.Name}}|{{.Driver}}'") as $l) {
    [$n, $d] = array_pad(explode('|', $l), 2, '');
    if (in_array($d, ['macvlan', 'ipvlan'])) $list[$n] = $d;
  }
  if (!$list) return [];
  $arr = json_decode(shell_exec('docker network inspect ' . implode(' ', array_map('escapeshellarg', array_keys($list))) . ' 2>/dev/null'), true) ?: [];
  $r = [];
  foreach ($arr as $i) {
    foreach (($i['IPAM']['Config'] ?? []) as $cfg) {
      if (empty($cfg['Subnet']) || strpos($cfg['Subnet'], ':') !== false) continue;
      $r[$i['Name']] = [
        'name' => $i['Name'], 'driver' => $i['Driver'], 'subnet' => $cfg['Subnet'],
        'gateway' => $cfg['Gateway'] ?? '', 'range' => $cfg['IPRange'] ?? '', 'parent' => $i['Options']['parent'] ?? '',
      ];
      break;
    }
  }
  uksort($r, 'strnatcmp');
  return $r;
}

function dt_all_macs($cons, $tpls, $ipam) {
  $m = [];
  foreach ($cons as $c) foreach ($c['nets'] as $v) if ($v['mac']) $m[] = $v['mac'];
  foreach ($tpls as $t) if ($t['mac']) $m[] = $t['mac'];
  foreach (($ipam['networks'] ?? []) as $n) foreach (($n['hosts'] ?? []) as $h) if (!empty($h['mac'])) $m[] = strtolower($h['mac']);
  return array_unique($m);
}

function dt_gen_mac($name, $net, $taken) {
  for ($s = 0; $s < 1000; $s++) {
    $h = md5("$net|$name|$s");
    $mac = '02:' . implode(':', str_split(substr($h, 0, 10), 2));
    if (!in_array($mac, $taken)) return $mac;
  }
  throw new Exception('No free MAC address found');
}

function dt_ipam_state() {
  $nets = dt_networks();
  $cons = dt_containers();
  $tpls = dt_templates();
  $ipam = dt_json_read('ipam.json', ['networks' => []]);
  $out = [];
  foreach ($nets as $nn => $net) {
    [$a, $b, $len] = dt_cidr($net['subnet']);
    $used = [];
    $add = function ($ip, $e) use (&$used) { if ($ip) $used[$ip][] = $e; };
    if ($net['gateway']) $add($net['gateway'], ['type' => 'gateway', 'name' => 'Gateway']);
    foreach ($cons as $c) {
      if (!isset($c['nets'][$nn])) continue;
      $t = $tpls[$c['name']] ?? null;
      $add($c['nets'][$nn]['ip'], ['type' => 'container', 'name' => $c['name'], 'mac' => $c['nets'][$nn]['mac'], 'running' => $c['running'], 'icon' => $t['icon'] ?? '',
        'has_tpl' => (bool)$t, 'fixed_ip' => $t && $t['ip'] !== '', 'fixed_mac' => $t && $t['mac'] !== '']);
    }
    foreach ($tpls as $t) {
      if ($t['network'] !== $nn || !$t['ip']) continue;
      if (isset($cons[$t['name']]['nets'][$nn]) && $cons[$t['name']]['nets'][$nn]['ip'] === $t['ip']) continue;
      $orphan = !isset($cons[$t['name']]);
      $add($t['ip'], ['type' => 'template', 'name' => $t['name'], 'mac' => $t['mac'], 'icon' => $t['icon'], 'orphan' => $orphan,
        'has_tpl' => true, 'fixed_ip' => true, 'fixed_mac' => $t['mac'] !== '', 'mtime' => @filemtime($t['file'])]);
    }
    $cfg = $ipam['networks'][$nn] ?? [];
    foreach (($cfg['hosts'] ?? []) as $ip => $h) {
      $add($ip, ['type' => $h['source'] ?? 'manual', 'name' => $h['name'] ?? '', 'mac' => $h['mac'] ?? '', 'note' => $h['note'] ?? '', 'seen' => $h['seen'] ?? null]);
    }
    $reserved = $cfg['reserved'] ?? [];
    $hard = function ($list) { return array_values(array_filter($list, fn($e) => empty($e['orphan']))); };
    $free = [];
    $freeCount = 0;
    $total = max(0, $b - $a - 1);
    $limit = min($b, $a + 4097);
    for ($i = $a + 1; $i < $limit; $i++) {
      $ip = long2ip($i);
      if ((isset($used[$ip]) && $hard($used[$ip])) || dt_in_reserved($ip, $reserved)) continue;
      $freeCount++;
      if (count($free) < 64) $free[] = $ip;
    }
    $conflicts = [];
    $latent = [];
    foreach ($used as $ip => $list) {
      $key = fn($e) => $e['type'] . ':' . $e['name'];
      $real = array_unique(array_map($key, array_filter($hard($list), fn($e) => $e['type'] !== 'scan')));
      $all = array_unique(array_map($key, $list));
      if (count($real) > 1) $conflicts[] = $ip;
      elseif (count($all) > 1) $latent[] = $ip;
    }
    // existing containers in this network without an IP / leftover templates without IP
    $noip = [];
    $orphansNoIp = [];
    foreach ($tpls as $t) {
      if ($t['network'] !== $nn || $t['ip'] || !empty($cons[$t['name']]['nets'][$nn]['ip'])) continue;
      if (isset($cons[$t['name']])) $noip[] = ['name' => $t['name'], 'running' => $cons[$t['name']]['running'], 'icon' => $t['icon']];
      else $orphansNoIp[] = $t['name'];
    }
    uksort($used, fn($x, $y) => ip2long($x) <=> ip2long($y));
    $out[$nn] = $net + ['used' => $used, 'free' => $free, 'free_count' => $freeCount, 'total' => $total,
      'reserved' => $reserved, 'conflicts' => $conflicts, 'latent' => $latent, 'no_ip' => $noip, 'orphans_no_ip' => $orphansNoIp];
  }
  return $out;
}

function dt_import($apply) {
  $nets = dt_networks();
  $cons = dt_containers();
  $tpls = dt_templates();
  $ipam = dt_json_read('ipam.json', ['networks' => []]);
  $taken = dt_all_macs($cons, $tpls, $ipam);
  $changes = [];
  $backup = null;
  foreach ($tpls as $t) {
    $nn = $t['network'];
    if (!isset($nets[$nn]) || !isset($cons[$t['name']])) continue;
    $cur = $cons[$t['name']]['nets'][$nn] ?? ['ip' => '', 'mac' => ''];
    $ch = [];
    if ($t['ip'] === '' && $cur['ip']) $ch['MyIP'] = $cur['ip'];
    if ($t['mac'] === '') {
      $mac = $cur['mac'] ?: dt_gen_mac($t['name'], $nn, $taken);
      $taken[] = $mac;
      $ch['MyMAC'] = $mac;
    }
    $note = '';
    if ($t['ip'] === '' && !$cur['ip']) $note = 'No IP known (container not running) – set an IP in the container';
    if (!$ch && !$note) continue;
    $changes[] = ['name' => $t['name'], 'network' => $nn, 'set' => $ch, 'note' => $note];
    if ($apply && $ch) {
      if (!$backup) $backup = dt_backup_templates();
      if (!dt_tpl_update($t['file'], $ch)) throw new Exception('Error saving ' . $t['name']);
    }
  }
  return ['changes' => $changes, 'backup' => $backup];
}

function dt_scan($nn) {
  $net = dt_networks()[$nn] ?? null;
  if (!$net) throw new Exception('Unknown network');
  [$a, $b] = dt_cidr($net['subnet']);
  if ($b - $a > 1024) throw new Exception('Network too large to scan (max. /22)');
  $ips = [];
  for ($i = $a + 1; $i < $b; $i++) $ips[] = long2ip($i);
  $tmp = tempnam('/tmp', 'dtscan');
  file_put_contents($tmp, implode("\n", $ips) . "\n");
  $alive = dt_sh('xargs -P 64 -I{} sh -c ' . escapeshellarg('ping -c1 -W1 {} >/dev/null 2>&1 && echo {}') . ' < ' . escapeshellarg($tmp));
  @unlink($tmp);
  $neigh = [];
  foreach (dt_sh('ip neigh show') as $l) {
    if (preg_match('/^(\S+) .* lladdr (\S+)/', $l, $m)) $neigh[$m[1]] = strtolower($m[2]);
  }
  $ipam = dt_json_read('ipam.json', ['networks' => []]);
  $state = dt_ipam_state()[$nn];
  $hosts = $ipam['networks'][$nn]['hosts'] ?? [];
  $new = 0;
  foreach ($alive as $ip) {
    $known = false;
    foreach (($state['used'][$ip] ?? []) as $e) if (in_array($e['type'], ['container', 'template', 'gateway'])) $known = true;
    if ($known) continue;
    if (!isset($hosts[$ip])) { $hosts[$ip] = ['source' => 'scan', 'name' => '', 'mac' => '', 'note' => '']; $new++; }
    $hosts[$ip]['seen'] = time();
    if (!empty($neigh[$ip]) && empty($hosts[$ip]['mac'])) $hosts[$ip]['mac'] = $neigh[$ip];
  }
  $ipam['networks'][$nn]['hosts'] = $hosts;
  $ipam['networks'][$nn]['last_scan'] = time();
  dt_json_write('ipam.json', $ipam);
  return ['alive' => count($alive), 'new' => $new];
}

function dt_valid_ip($ip) {
  return filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) !== false;
}

function dt_host_set($nn, $ip, $name, $mac, $note) {
  if (!dt_valid_ip($ip)) throw new Exception('Invalid IP address');
  if ($mac !== '' && !preg_match('/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i', $mac)) throw new Exception('Invalid MAC address');
  $ipam = dt_json_read('ipam.json', ['networks' => []]);
  $old = $ipam['networks'][$nn]['hosts'][$ip] ?? [];
  $ipam['networks'][$nn]['hosts'][$ip] = ['source' => 'manual', 'name' => $name, 'mac' => strtolower($mac), 'note' => $note, 'seen' => $old['seen'] ?? null];
  dt_json_write('ipam.json', $ipam);
}

function dt_host_del($nn, $ip) {
  $ipam = dt_json_read('ipam.json', ['networks' => []]);
  unset($ipam['networks'][$nn]['hosts'][$ip]);
  dt_json_write('ipam.json', $ipam);
}

function dt_reserve_add($nn, $from, $to, $note) {
  if (!dt_valid_ip($from) || ($to !== '' && !dt_valid_ip($to))) throw new Exception('Invalid IP address');
  $ipam = dt_json_read('ipam.json', ['networks' => []]);
  $ipam['networks'][$nn]['reserved'][] = ['from' => $from, 'to' => $to ?: $from, 'note' => $note];
  dt_json_write('ipam.json', $ipam);
}

function dt_reserve_del($nn, $idx) {
  $ipam = dt_json_read('ipam.json', ['networks' => []]);
  array_splice($ipam['networks'][$nn]['reserved'], (int)$idx, 1);
  dt_json_write('ipam.json', $ipam);
}

// ---------- per-entry actions ----------
const DT_REBUILD = '/usr/local/emhttp/plugins/dynamix.docker.manager/scripts/rebuild_container';

function dt_valid_mac($mac) {
  return (bool)preg_match('/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i', $mac);
}

// write the container's current IP/MAC into its template
function dt_pin($name) {
  $t = dt_templates()[$name] ?? null;
  if (!$t) throw new Exception("No Unraid template for $name");
  $c = dt_containers()[$name] ?? null;
  $cur = $c['nets'][$t['network']] ?? ['ip' => '', 'mac' => ''];
  $ch = [];
  if ($t['ip'] === '') {
    if (!$cur['ip']) throw new Exception("$name has no IP right now – use Change IP instead");
    $ch['MyIP'] = $cur['ip'];
  }
  if ($t['mac'] === '') {
    $mac = $cur['mac'];
    if (!$mac) $mac = dt_gen_mac($name, $t['network'], dt_all_macs(dt_containers(), dt_templates(), dt_json_read('ipam.json', ['networks' => []])));
    $ch['MyMAC'] = $mac;
  }
  if (!$ch) return "$name already has a fixed IP and MAC";
  dt_backup_templates();
  if (!dt_tpl_update($t['file'], $ch)) throw new Exception("Error saving $name");
  return "$name: fixed " . implode(' and ', array_map(fn($k) => $k === 'MyIP' ? 'IP ' . $ch[$k] : 'MAC ' . $ch[$k], array_keys($ch))) . ' (no restart needed)';
}

// check that $ip can be given to $name in network $nn
function dt_ip_check($nn, $ip, $self) {
  if (!dt_valid_ip($ip)) throw new Exception('Invalid IP address');
  $st = dt_ipam_state()[$nn] ?? null;
  if (!$st) throw new Exception('Unknown network');
  if (!dt_in_subnet($ip, $st['subnet'])) throw new Exception("$ip is not in " . $st['subnet']);
  if ($ip === $st['gateway']) throw new Exception("$ip is the gateway");
  if (dt_in_reserved($ip, $st['reserved'])) throw new Exception("$ip is in a reserved range");
  foreach (($st['used'][$ip] ?? []) as $e) {
    if (!empty($e['orphan']) || $e['name'] === $self) continue;
    throw new Exception("$ip is already used by " . ($e['name'] ?: $e['type']));
  }
}

function dt_rebuild($name, &$log = []) {
  if (!is_executable(DT_REBUILD)) throw new Exception('Unraid rebuild script not found');
  exec(DT_REBUILD . ' ' . escapeshellarg($name) . ' 2>&1', $o, $rc);
  $log[] = $rc === 0 ? "$name recreated" : "$name: rebuild failed (" . trim(implode(' ', $o)) . ')';
  // containers that share this container's network must be recreated too
  $cons = dt_containers();
  foreach (dt_templates() as $t) {
    if ($t['network'] === "container:$name" && isset($cons[$t['name']])) {
      exec(DT_REBUILD . ' ' . escapeshellarg($t['name']) . ' 2>&1', $o2, $rc2);
      $log[] = $rc2 === 0 ? $t['name'] . ' recreated (shares network)' : $t['name'] . ': rebuild failed';
    }
  }
  return $log;
}

// give a container/template a new fixed IP (and a fixed MAC if it has none)
function dt_set_ip($nn, $name, $ip, $recreate) {
  @set_time_limit(600);
  $tpls = dt_templates();
  $t = $tpls[$name] ?? null;
  if (!$t) throw new Exception("No Unraid template for $name");
  if ($t['network'] !== $nn) throw new Exception("$name is configured for network " . $t['network']);
  dt_ip_check($nn, $ip, $name);
  $cons = dt_containers();
  $ch = ['MyIP' => $ip];
  if ($t['mac'] === '') {
    $cur = $cons[$name]['nets'][$nn]['mac'] ?? '';
    $ch['MyMAC'] = $cur ?: dt_gen_mac($name, $nn, dt_all_macs($cons, $tpls, dt_json_read('ipam.json', ['networks' => []])));
  }
  dt_backup_templates();
  if (!dt_tpl_update($t['file'], $ch)) throw new Exception("Error saving $name");
  $log = ["$name: template set to $ip"];
  if (isset($cons[$name])) {
    if ($recreate) dt_rebuild($name, $log);
    else $log[] = 'takes effect when the container is recreated (Edit → Apply)';
  }
  return implode(' · ', $log);
}

// move a leftover template out of Unraid's template folder (restorable)
function dt_tpl_archive($name) {
  $t = dt_templates()[$name] ?? null;
  if (!$t) throw new Exception("No template for $name");
  if (isset(dt_containers()[$name])) throw new Exception("$name still exists as a container");
  $dir = DT_CFG . '/archived-templates';
  @mkdir($dir, 0777, true);
  $dst = $dir . '/' . basename($t['file']);
  if (is_file($dst)) $dst = preg_replace('/\.xml$/', '-' . date('Ymd-His') . '.xml', $dst);
  if (!@rename($t['file'], $dst)) throw new Exception('Could not move template');
  return "$name archived to $dst";
}

// move a device record to a new IP
function dt_host_move($nn, $ip, $newip) {
  dt_ip_check($nn, $newip, '');
  $ipam = dt_json_read('ipam.json', ['networks' => []]);
  $h = $ipam['networks'][$nn]['hosts'][$ip] ?? null;
  if (!$h) throw new Exception('Unknown device');
  unset($ipam['networks'][$nn]['hosts'][$ip]);
  $h['source'] = 'manual';
  $h['note'] = trim(($h['note'] ?? '') . " (was $ip)");
  $ipam['networks'][$nn]['hosts'][$newip] = $h;
  dt_json_write('ipam.json', $ipam);
  return "Device moved to $newip – set this address on the device itself";
}
