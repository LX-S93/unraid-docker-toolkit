<?php
// Docker Toolkit – JSON API (read via GET, write only via POST with csrf_token)
require_once __DIR__ . '/lib.php';
header('Content-Type: application/json; charset=utf-8');

function dt_out($d) { echo json_encode(['ok' => true] + $d, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE); exit; }
function dt_post() { if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') throw new Exception('POST required'); }
function dt_req($k, $def = '') { return trim((string)($_REQUEST[$k] ?? $def)); }

try {
  $a = dt_req('action');
  switch ($a) {
    case 'state':
      dt_out(['settings' => dt_settings(), 'host_mem_mb' => dt_host_mem_mb(), 'networks' => dt_ipam_state()]);
    case 'ram':
      dt_out(['settings' => dt_settings(), 'host_mem_mb' => dt_host_mem_mb(), 'containers' => dt_ram_list()]);
    case 'mac':
      $cons = dt_containers(); $tpls = dt_templates();
      $taken = dt_all_macs($cons, $tpls, dt_json_read('ipam.json', ['networks' => []]));
      $name = dt_req('name');
      $tm = $tpls[$name]['mac'] ?? '';
      $taken = array_values(array_diff($taken, [$tm]));
      dt_out(['mac' => dt_gen_mac($name ?: uniqid(), dt_req('net'), $taken)]);
    case 'set_default':
      dt_post();
      $mb = max(0, (int)dt_req('mb'));
      $s = dt_settings(); $s['default_mem_mb'] = $mb;
      dt_json_write('settings.json', $s);
      dt_out(['settings' => $s]);
    case 'set_mem':
      dt_post();
      dt_out(['message' => dt_set_mem(dt_req('name'), max(0, (int)dt_req('mb')), dt_req('live', '1') === '1')]);
    case 'import':
      if (dt_req('apply') === '1') dt_post();
      dt_out(dt_import(dt_req('apply') === '1'));
    case 'scan':
      dt_post();
      dt_out(dt_scan(dt_req('net')));
    case 'host_set':
      dt_post();
      dt_host_set(dt_req('net'), dt_req('ip'), dt_req('name'), dt_req('mac'), dt_req('note'));
      dt_out([]);
    case 'host_del':
      dt_post();
      dt_host_del(dt_req('net'), dt_req('ip'));
      dt_out([]);
    case 'reserve_add':
      dt_post();
      dt_reserve_add(dt_req('net'), dt_req('from'), dt_req('to'), dt_req('note'));
      dt_out([]);
    case 'reserve_del':
      dt_post();
      dt_reserve_del(dt_req('net'), dt_req('idx'));
      dt_out([]);
    case 'pin':
      dt_post();
      dt_out(['message' => dt_pin(dt_req('name'))]);
    case 'set_ip':
      dt_post();
      dt_out(['message' => dt_set_ip(dt_req('net'), dt_req('name'), dt_req('ip'), dt_req('recreate') === '1')]);
    case 'rebuild':
      dt_post();
      @set_time_limit(600);
      dt_out(['message' => implode(' · ', dt_rebuild(dt_req('name')))]);
    case 'tpl_archive':
      dt_post();
      dt_out(['message' => dt_tpl_archive(dt_req('name'))]);
    case 'host_move':
      dt_post();
      dt_out(['message' => dt_host_move(dt_req('net'), dt_req('ip'), dt_req('newip'))]);
    default:
      throw new Exception('Unknown action');
  }
} catch (Throwable $e) {
  http_response_code(400);
  echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
}
