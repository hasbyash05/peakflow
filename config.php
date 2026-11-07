<?php
/**
 * PeakFlow Respiratory Portal — Konfigurasi & Basis Data
 * Domain: ta.ukmiptek.org
 * Versi: 2.1.1 (Production Release)
 * 
 * Mendukung 2 mode database:
 * 1. 'sqlite' (DEFAULT - OTOMATIS):
 *    -> Tanpa perlu buka phpMyAdmin sama sekali!
 *    -> Tanpa perlu buat database/user/password di cPanel!
 *    -> Otomatis membuat file data/peakflow.db dan tabel secara instan.
 * 2. 'mysql':
 *    -> Jika Anda sengaja ingin menggunakan MySQL cPanel.
 */

declare(strict_types=1);

defined('PEAKFLOW_APP') or define('PEAKFLOW_APP', true);

// ==========================================================
// 1. Pilihan Driver Basis Data: 'sqlite' (Otomatis) atau 'mysql'
// ==========================================================
$db_driver = 'sqlite'; // Default 'sqlite' agar langsung jalan tanpa phpMyAdmin

// Kredensial MySQL (Hanya jika Anda sengaja ingin beralih ke MySQL)
$db_host = 'localhost';
$db_user = 'u5cfvtpd_peakflow';
$db_pass = '';
$db_name = 'u5cfvtpd_peakflow';
$db_port = 3306;

// ==========================================================
// 2. Konstanta Perangkat Keras & Standar Medis (PRD v2.0.0)
// ==========================================================
const CALIBRATION_FACTOR = 1.5; // Kunci ke 1.5 sesuai KTI §3.12.2
const FIRMWARE_VERSION   = '2.1.1';
const BUILD_DATE         = '2026-04-08';
const APP_NAME           = 'PeakFlow Respiratory Portal';

// ==========================================================
// 3. Inisialisasi Koneksi PDO (PHP Data Objects)
// ==========================================================
function getDbConnection(): PDO {
    global $db_driver, $db_host, $db_user, $db_pass, $db_name, $db_port;
    static $pdo = null;

    if ($pdo === null) {
        // ------------------------------------------------------
        // Mode 1: SQLite (Otomatis tanpa phpMyAdmin & tanpa password)
        // ------------------------------------------------------
        if ($db_driver === 'sqlite' || empty($db_pass)) {
            $dataDir = __DIR__ . '/data';
            if (!is_dir($dataDir)) {
                @mkdir($dataDir, 0777, true);
            }
            $dbPath = $dataDir . '/peakflow.db';
            try {
                $pdo = new PDO("sqlite:" . $dbPath);
                $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
                $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
                $pdo->exec("PRAGMA journal_mode = WAL;");

                // Auto-create tabel-tabel jika belum ada
                $pdo->exec("
                    CREATE TABLE IF NOT EXISTS patient_records (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      name TEXT NOT NULL,
                      gender TEXT NOT NULL DEFAULT 'M',
                      age INTEGER NOT NULL,
                      height REAL NOT NULL,
                      peak_flow REAL NOT NULL DEFAULT 0.0,
                      flow_status TEXT NOT NULL DEFAULT 'Siap',
                      is_active INTEGER NOT NULL DEFAULT 1,
                      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS sessions (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      session_id TEXT UNIQUE NOT NULL,
                      patient_id INTEGER,
                      name TEXT NOT NULL,
                      gender TEXT NOT NULL DEFAULT 'M',
                      age INTEGER NOT NULL,
                      height REAL NOT NULL,
                      best_flow REAL NOT NULL,
                      predicted_flow REAL NOT NULL,
                      pct_predicted REAL NOT NULL,
                      zone TEXT NOT NULL DEFAULT 'neutral',
                      samples_json TEXT NOT NULL,
                      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                    );

                    CREATE TABLE IF NOT EXISTS print_queue (
                      id INTEGER PRIMARY KEY AUTOINCREMENT,
                      patient_id INTEGER,
                      status TEXT NOT NULL DEFAULT 'pending',
                      requested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                      printed_at DATETIME
                    );
                ");
                return $pdo;
            } catch (PDOException $e) {
                // Jika SQLite gagal, coba fallback ke MySQL
            }
        }

        // ------------------------------------------------------
        // Mode 2: MySQL (Hanya jika password terisi dan dipilih)
        // ------------------------------------------------------
        $dsn = "mysql:host={$db_host};port={$db_port};dbname={$db_name};charset=utf8mb4";
        $options = [
            PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES   => false,
        ];
        try {
            $pdo = new PDO($dsn, $db_user, $db_pass, $options);
        } catch (PDOException $e) {
            http_response_code(500);
            echo json_encode([
                'status'  => 'error',
                'message' => 'Gagal membuka basis data (SQLite dan MySQL tidak dapat diakses).',
                'error'   => $e->getMessage()
            ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE);
            exit;
        }
    }
    return $pdo;
}

// ==========================================================
// 4. Rumus Prediksi Knudson 1983 (PRD §7.2 & KTI §2.2.2)
// ==========================================================
function computePredictedPEF(int $age, string $gender, float $height): float {
    if ($gender === 'F' || strtoupper($gender) === 'FEMALE') {
        $lps = -1.79 + (0.0342 * $height) - (0.0255 * $age);
    } else {
        $lps = -2.49 + (0.0464 * $height) - (0.0335 * $age);
    }
    return round($lps * 60, 1);
}

// ==========================================================
// 5. Klasifikasi Zona Klinis GINA 2024
// ==========================================================
function classifyZone(float $pct): string {
    if ($pct >= 80.0) return 'green';
    if ($pct >= 60.0) return 'yellow';
    return 'red';
}

// ==========================================================
// 6. Validasi Input Data Pasien
// ==========================================================
function validatePatientData(string $name, string $gender, int $age, float $height): array {
    $errors = [];
    $name = trim($name);
    if (empty($name)) {
        $errors[] = 'Nama pasien wajib diisi';
    } elseif (mb_strlen($name) > 50) {
        $errors[] = 'Nama pasien maksimal 50 karakter';
    }

    $gender = strtoupper($trim = trim($gender));
    if ($gender !== 'M' && $gender !== 'F') {
        $errors[] = 'Jenis kelamin harus M (Laki-laki) atau F (Perempuan)';
    }

    if ($age < 18 || $age > 80) {
        $errors[] = 'Usia harus antara 18 hingga 80 tahun';
    }

    if ($height < 120.0 || $height > 220.0) {
        $errors[] = 'Tinggi badan harus antara 120 hingga 220 cm';
    }

    return [
        'valid'  => empty($errors),
        'errors' => $errors,
        'data'   => [
            'name'   => $name,
            'gender' => $gender,
            'age'    => $age,
            'height' => round($height, 1)
        ]
    ];
}

// ==========================================================
// 7. Helper Response JSON
// ==========================================================
function jsonOut(array $data, int $statusCode = 200): void {
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-cache, no-store, must-revalidate');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}
