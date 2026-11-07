<?php
/**
 * PeakFlow Respiratory Portal — REST API Router
 * Domain: ta.ukmiptek.org
 * Versi: 2.1.1 (Production Release)
 * 
 * Melayani:
 * 1. ESP32 Firmware via HTTPS (POST /update-test, GET /get-data, GET /check-print, POST /submit)
 * 2. Web Portal Apple-Style (index.html)
 * 3. LiteSpeed Web Server cPanel ta.ukmiptek.org
 */

declare(strict_types=1);

require_once __DIR__ . '/config.php';

// Tangani preflight OPTIONS request untuk CORS
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    http_response_code(204);
    exit;
}

$pdo = getDbConnection();
$method = $_SERVER['REQUEST_METHOD'];

// Tentukan action baik dari query parameter ?action=... maupun dari URL path
$action = $_GET['action'] ?? '';
$path = parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
if (empty($action)) {
    if (str_ends_with($path, '/submit')) $action = 'save_patient';
    elseif (str_ends_with($path, '/update-test')) $action = 'update_test';
    elseif (str_ends_with($path, '/get-data')) $action = 'get_active';
    elseif (str_ends_with($path, '/sessions')) $action = 'sessions';
    elseif (str_ends_with($path, '/print')) $action = 'print';
    elseif (str_ends_with($path, '/check-print')) $action = 'check_print';
    elseif (str_ends_with($path, '/export.csv') || str_ends_with($path, '/export')) $action = 'export_csv';
    else $action = 'get_active';
}

// Tangkap payload JSON dari body jika ada
$rawInput = file_get_contents('php://input');
$jsonBody = [];
if (!empty($rawInput)) {
    $decoded = json_decode($rawInput, true);
    if (is_array($decoded)) {
        $jsonBody = $decoded;
    }
}

// Gabungkan JSON body dengan $_POST
$payload = array_merge($_POST, $jsonBody);

switch ($action) {

    // ------------------------------------------------------
    // 1. GET /api.php?action=get_active atau GET /get-data
    // ------------------------------------------------------
    case 'get_active':
    case 'get_data':
        $stmt = $pdo->prepare("SELECT * FROM patient_records WHERE is_active = 1 ORDER BY id DESC LIMIT 1");
        $stmt->execute();
        $patient = $stmt->fetch();

        if (!$patient) {
            jsonOut([
                'status'        => 'Siap',
                'has_patient'   => false,
                'name'          => 'Belum Ada Pasien',
                'gender'        => 'M',
                'age'           => 0,
                'height'        => 0.0,
                'peak'          => 0.0,
                'predicted'     => 0.0,
                'pct_predicted' => 0.0,
                'zone'          => 'neutral',
                'state'         => 'IDLE',
                'battery'       => 100,
                'wifi_mode'     => 'STA · ta.ukmiptek.org',
                'wifi_bars'     => 4,
                'printer_ok'    => true,
                'sample_index'  => 0,
                'samples'       => array_fill(0, 10, 0.0),
                'session_id'    => '',
                'data'          => null
            ]);
        }

        $age = (int)$patient['age'];
        $gender = (string)$patient['gender'];
        $height = (float)$patient['height'];
        $peak = (float)$patient['peak_flow'];

        $predicted = computePredictedPEF($age, $gender, $height);
        $pct = $predicted > 0 ? round(($peak / $predicted) * 100, 1) : 0.0;
        $zone = $peak > 0 ? classifyZone($pct) : 'neutral';

        // Ambil sampel terakhir dari sesi terkini jika ada
        $sampleList = array_fill(0, 10, 0.0);
        $activeSessionId = '';
        $stmtSes = $pdo->prepare("SELECT session_id, samples_json FROM sessions WHERE patient_id = ? ORDER BY id DESC LIMIT 1");
        $stmtSes->execute([$patient['id']]);
        $lastSes = $stmtSes->fetch();
        if ($lastSes && !empty($lastSes['samples_json'])) {
            $parsedSamples = json_decode($lastSes['samples_json'], true);
            if (is_array($parsedSamples)) {
                $sampleList = $parsedSamples;
            }
            $activeSessionId = $lastSes['session_id'];
        }

        jsonOut([
            'status'        => $patient['flow_status'] ?? 'Siap Melakukan Pengukuran',
            'has_patient'   => true,
            'name'          => $patient['name'],
            'gender'        => $patient['gender'],
            'age'           => $age,
            'height'        => $height,
            'peak'          => $peak,
            'predicted'     => $predicted,
            'pct_predicted' => $pct,
            'zone'          => $zone,
            'state'         => 'IDLE',
            'battery'       => 100,
            'wifi_mode'     => 'STA · ta.ukmiptek.org',
            'wifi_bars'     => 4,
            'printer_ok'    => true,
            'sample_index'  => $peak > 0 ? 10 : 0,
            'samples'       => $sampleList,
            'session_id'    => $activeSessionId,
            'data'          => [
                'id'          => (int)$patient['id'],
                'name'        => $patient['name'],
                'gender'      => $patient['gender'],
                'age'         => $age,
                'height'      => $height,
                'peak_flow'   => $peak,
                'flow_status' => $patient['flow_status'],
                'is_active'   => 1
            ]
        ]);
        break;

    // ------------------------------------------------------
    // 2. POST /api.php?action=save_patient atau POST /submit
    // ------------------------------------------------------
    case 'save_patient':
    case 'submit':
        if ($method !== 'POST') {
            jsonOut(['status' => 'error', 'message' => 'Metode harus POST'], 405);
        }

        $name   = (string)($payload['name'] ?? '');
        $gender = (string)($payload['gender'] ?? 'M');
        $age    = (int)($payload['age'] ?? 0);
        $height = (float)($payload['height'] ?? 0.0);

        $val = validatePatientData($name, $gender, $age, $height);
        if (!$val['valid']) {
            jsonOut(['status' => 'error', 'errors' => $val['errors']], 400);
        }

        $d = $val['data'];

        // Nonaktifkan semua pasien lama
        $pdo->exec("UPDATE patient_records SET is_active = 0 WHERE is_active = 1");

        // Simpan data pasien baru yang aktif
        $ins = $pdo->prepare("INSERT INTO patient_records (name, gender, age, height, peak_flow, flow_status, is_active) VALUES (?, ?, ?, ?, 0.0, 'Siap', 1)");
        $ins->execute([$d['name'], $d['gender'], $d['age'], $d['height']]);
        $newId = $pdo->lastInsertId();

        jsonOut([
            'status'     => 'success',
            'message'    => 'Data tersimpan',
            'patient_id' => (int)$newId,
            'patient'    => $d
        ]);
        break;

    // ------------------------------------------------------
    // 3. POST /api.php?action=update_test atau POST /update-test
    // Dikirimkan oleh ESP32 setelah 10 sampel embusan
    // ------------------------------------------------------
    case 'update_test':
        if ($method !== 'POST') {
            jsonOut(['status' => 'error', 'message' => 'Metode harus POST'], 405);
        }

        $peakFlow = (float)($payload['peak_flow'] ?? $payload['peak'] ?? 0.0);
        $flowStatus = (string)($payload['flow_status'] ?? ($peakFlow > 0 ? 'Selesai' : 'Siap'));
        $rawSamples = $payload['samples'] ?? [];
        $samples = [];

        if (is_string($rawSamples)) {
            $decodedS = json_decode($rawSamples, true);
            $samples = is_array($decodedS) ? $decodedS : array_map('floatval', explode(',', $rawSamples));
        } elseif (is_array($rawSamples)) {
            $samples = array_map('floatval', $rawSamples);
        }

        while (count($samples) < 10) $samples[] = 0.0;
        $samples = array_slice($samples, 0, 10);

        // Ambil pasien aktif
        $stmtAct = $pdo->prepare("SELECT * FROM patient_records WHERE is_active = 1 ORDER BY id DESC LIMIT 1");
        $stmtAct->execute();
        $patient = $stmtAct->fetch();

        if ($patient) {
            // Update peak flow pada baris pasien aktif
            $upd = $pdo->prepare("UPDATE patient_records SET peak_flow = ?, flow_status = ? WHERE id = ?");
            $upd->execute([$peakFlow, $flowStatus, $patient['id']]);

            // Jika ada nilai embusan, catat ke tabel sesi
            if ($peakFlow > 0) {
                $predicted = computePredictedPEF((int)$patient['age'], (string)$patient['gender'], (float)$patient['height']);
                $pct = $predicted > 0 ? round(($peakFlow / $predicted) * 100, 1) : 0.0;
                $zone = classifyZone($pct);
                $sessionId = 'ses_' . date('Ymd_His') . '_' . bin2hex(random_bytes(3));

                $insSes = $pdo->prepare("INSERT INTO sessions (session_id, patient_id, name, gender, age, height, best_flow, predicted_flow, pct_predicted, zone, samples_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
                $insSes->execute([
                    $sessionId,
                    $patient['id'],
                    $patient['name'],
                    $patient['gender'],
                    $patient['age'],
                    $patient['height'],
                    $peakFlow,
                    $predicted,
                    $pct,
                    $zone,
                    json_encode($samples)
                ]);
            }
        }

        jsonOut(['status' => 'success', 'peak_flow' => $peakFlow, 'flow_status' => $flowStatus]);
        break;

    // ------------------------------------------------------
    // 4. POST /api.php?action=print atau POST /print
    // ------------------------------------------------------
    case 'print':
        if ($method !== 'POST') {
            jsonOut(['status' => 'error', 'message' => 'Metode harus POST'], 405);
        }

        $stmtAct = $pdo->prepare("SELECT id FROM patient_records WHERE is_active = 1 ORDER BY id DESC LIMIT 1");
        $stmtAct->execute();
        $p = $stmtAct->fetch();
        $patId = $p ? $p['id'] : null;

        $insQueue = $pdo->prepare("INSERT INTO print_queue (patient_id, status) VALUES (?, 'pending')");
        $insQueue->execute([$patId]);

        jsonOut(['ok' => true, 'state' => 'printing', 'message' => 'Perintah cetak thermal dikirim ke antrean']);
        break;

    // ------------------------------------------------------
    // 5. GET /api.php?action=check_print atau GET /check-print
    // Di-polling oleh ESP32 untuk mendeteksi trigger cetak dari web
    // ------------------------------------------------------
    case 'check_print':
        $stmtPr = $pdo->prepare("SELECT id FROM print_queue WHERE status = 'pending' ORDER BY id ASC LIMIT 1");
        $stmtPr->execute();
        $job = $stmtPr->fetch();

        if ($job) {
            $upd = $pdo->prepare("UPDATE print_queue SET status = 'printing', printed_at = NOW() WHERE id = ?");
            $upd->execute([$job['id']]);
            jsonOut(['print' => 1, 'flagPrintReport' => true, 'job_id' => (int)$job['id']]);
        } else {
            jsonOut(['print' => 0, 'flagPrintReport' => false]);
        }
        break;

    // ------------------------------------------------------
    // 6. GET /api.php?action=sessions atau GET /sessions
    // Riwayat 20 sesi terakhir untuk grafik dan kalender
    // ------------------------------------------------------
    case 'sessions':
        $stmtAll = $pdo->prepare("SELECT * FROM sessions ORDER BY id DESC LIMIT 20");
        $stmtAll->execute();
        $rows = $stmtAll->fetchAll();

        $sessionList = [];
        foreach ($rows as $r) {
            $samples = json_decode($r['samples_json'] ?? '[]', true);
            if (!is_array($samples)) $samples = array_fill(0, 10, 0.0);

            $sessionList[] = [
                'session_id'    => $r['session_id'],
                'started_at'    => date('c', strtotime($r['created_at'])),
                'profile'       => [
                    'name'   => $r['name'],
                    'gender' => $r['gender'],
                    'age'    => (int)$r['age'],
                    'height' => (float)$r['height']
                ],
                'best'          => (float)$r['best_flow'],
                'predicted'     => (float)$r['predicted_flow'],
                'pct_predicted' => (float)$r['pct_predicted'],
                'zone'          => $r['zone'],
                'samples'       => $samples
            ];
        }

        jsonOut([
            'status'   => 'success',
            'count'    => count($sessionList),
            'sessions' => $sessionList
        ]);
        break;

    // ------------------------------------------------------
    // 7. GET /api.php?action=export_csv atau GET /export.csv
    // ------------------------------------------------------
    case 'export_csv':
    case 'export':
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="peakflow_export_' . date('Ymd_His') . '.csv"');

        $out = fopen('php://output', 'w');
        fputcsv($out, [
            'session_id', 'started_at_utc', 'name', 'gender', 'age', 'height_cm',
            'best_lpm', 'predicted_lpm', 'pct_predicted', 'zone',
            's1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'
        ]);

        $stmtCsv = $pdo->prepare("SELECT * FROM sessions ORDER BY id DESC");
        $stmtCsv->execute();
        while ($r = $stmtCsv->fetch()) {
            $samples = json_decode($r['samples_json'] ?? '[]', true);
            if (!is_array($samples)) $samples = array_fill(0, 10, 0.0);
            while (count($samples) < 10) $samples[] = 0.0;

            $row = [
                $r['session_id'],
                date('c', strtotime($r['created_at'])),
                $r['name'],
                $r['gender'],
                $r['age'],
                number_format((float)$r['height'], 1, '.', ''),
                number_format((float)$r['best_flow'], 1, '.', ''),
                number_format((float)$r['predicted_flow'], 1, '.', ''),
                number_format((float)$r['pct_predicted'], 1, '.', ''),
                $r['zone']
            ];
            for ($i = 0; $i < 10; $i++) {
                $row[] = number_format((float)($samples[$i] ?? 0.0), 1, '.', '');
            }
            fputcsv($out, $row);
        }
        fclose($out);
        exit;

    default:
        jsonOut(['status' => 'error', 'message' => "Aksi tidak dikenali: '{$action}'"], 404);
        break;
}
