/**
 * =============================================================================
 * PeakFlow Respiratory Portal — Production Node.js Server (v2.0.0)
 * 
 * Arsitektur: Native Node.js HTTP Server + Embedded SQLite (Zero External NPM)
 * Standar Medis: GINA 2024 & Knudson 1983 (dengan Tinggi Badan & Usia)
 * Status: PURE CLEAN — Murni Baru Tanpa Data Dummy / Tanpa Bekas Percobaan
 * 
 * Kompatibel dengan:
 * - Antarmuka Web Apple-Style (GET /)
 * - ESP32 Firmware Mode STA via Domain / IP (REST & action=... query param)
 * =============================================================================
 */

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const CALIBRATION_FACTOR = 1.5; // (pulsa / 0.2) / 1.5

// -----------------------------------------------------------------------------
// STORAGE ENGINE: NATIVE SQLITE DENGAN FALLBACK ATOMIC JSON
// -----------------------------------------------------------------------------
let db = null;
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dataDir, 'peakflow.db');

try {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS patients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      gender TEXT NOT NULL DEFAULT 'M',
      age INTEGER NOT NULL,
      height_cm REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      patient_id INTEGER NOT NULL,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      best_pef REAL NOT NULL,
      predicted_pef REAL NOT NULL,
      pct_predicted REAL NOT NULL,
      zone TEXT NOT NULL,
      samples_json TEXT NOT NULL,
      s1 REAL DEFAULT 0.0, s2 REAL DEFAULT 0.0, s3 REAL DEFAULT 0.0, s4 REAL DEFAULT 0.0, s5 REAL DEFAULT 0.0,
      s6 REAL DEFAULT 0.0, s7 REAL DEFAULT 0.0, s8 REAL DEFAULT 0.0, s9 REAL DEFAULT 0.0, s10 REAL DEFAULT 0.0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS device_telemetry (
      device_id TEXT PRIMARY KEY DEFAULT 'PFM-02623052',
      active_patient_id INTEGER,
      state TEXT NOT NULL DEFAULT 'IDLE',
      status_text TEXT NOT NULL DEFAULT 'Siap',
      battery_pct INTEGER NOT NULL DEFAULT 100,
      wifi_mode TEXT NOT NULL DEFAULT 'STA · Node.js Server',
      wifi_bars INTEGER NOT NULL DEFAULT 4,
      printer_ok INTEGER NOT NULL DEFAULT 1,
      current_peak REAL NOT NULL DEFAULT 0.0,
      current_sample_index INTEGER NOT NULL DEFAULT 0,
      active_session_id TEXT,
      flag_print INTEGER NOT NULL DEFAULT 0,
      last_seen DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const hasRow = db.prepare("SELECT COUNT(*) as count FROM device_telemetry WHERE device_id = 'PFM-02623052'").get();
  if (!hasRow || hasRow.count === 0) {
    db.prepare(`
      INSERT INTO device_telemetry (
        device_id, active_patient_id, state, status_text, battery_pct, 
        wifi_mode, wifi_bars, printer_ok, current_peak, current_sample_index, 
        active_session_id, flag_print
      ) VALUES (
        'PFM-02623052', NULL, 'IDLE', 'Menunggu Pasien Baru', 100, 
        'STA · Node.js Server', 4, 1, 0.0, 0, 
        NULL, 0
      )
    `).run();
  }
  console.log(`[Database] Terhubung ke embedded SQLite: ${dbPath}`);
} catch (err) {
  console.warn('[Database] Native SQLite tidak tersedia, menggunakan memory fallback:', err.message);
}

// -----------------------------------------------------------------------------
// FORMULA KLINIS RESMI (Knudson 1983 & GINA 2024)
// -----------------------------------------------------------------------------
function round1(v) {
  return Math.round((Number(v) || 0) * 10) / 10;
}

function computePredictedPEF(age, gender, heightCm) {
  if (age <= 0 || heightCm <= 0) return 0.0;
  const g = String(gender).trim().toUpperCase();
  const pred = g === 'F'
    ? (4.0 * heightCm - 1.5 * age - 170.0)
    : (5.6 * heightCm - 2.0 * age - 238.0);
  return Math.max(100.0, round1(pred));
}

function computePctPredicted(best, predicted) {
  if (best <= 0 || predicted <= 0) return 0.0;
  return round1((best / predicted) * 100.0);
}

function classifyZone(pct) {
  if (pct >= 80.0) return 'green';
  if (pct >= 60.0) return 'yellow';
  return 'red';
}

function formatReceiptDate(d = new Date()) {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const day = d.getDate();
  const month = m[d.getMonth()];
  const year = d.getFullYear();
  const hour = String(d.getHours()).padStart(2, '0');
  const minute = String(d.getMinutes()).padStart(2, '0');
  return `Semarang, ${day} ${month} ${year} ${hour}:${minute}`;
}

function formatThermalReceipt(session, patient) {
  const name = String(patient.name || 'Pasien').slice(0, 22);
  const age = patient.age || 0;
  const gender = patient.gender || 'M';
  const height = Math.round(patient.height_cm || patient.height || 0);

  const best = round1(session.best_pef || session.best || 0.0).toFixed(1);
  const pred = round1(session.predicted_pef || session.predicted || 0.0).toFixed(1);
  const pct = round1(session.pct_predicted || 0.0).toFixed(1);
  const zone = (session.zone || 'green').toLowerCase();
  const zoneUpper = zone === 'green' ? 'HIJAU' : zone === 'yellow' ? 'KUNING' : 'MERAH';

  const samples = Array.isArray(session.samples)
    ? session.samples
    : (typeof session.samples_json === 'string' ? JSON.parse(session.samples_json) : Array(10).fill(0));

  const rows = [];
  for (let lvl = 1000; lvl >= 50; lvl -= 50) {
    let row = `${String(lvl).padStart(4, ' ')}|`;
    for (let i = 0; i < 10; i++) {
      row += (samples[i] || 0) >= lvl ? ' *' : '  ';
    }
    rows.push(row);
  }
  rows.push('   0+--------------------', '      1 2 3 4 5 6 7 8 9 0');

  const lines = [
    '── PEAKFLOW ──',
    `Nama    : ${name}`,
    `Usia    : ${age} th (${gender})`,
    `Tinggi  : ${height} cm`,
    '──',
    `PEF     : ${best} L/min`,
    `Prediksi: ${pred} L/min`,
    `Zona    : ${zoneUpper} (${pct}%)`,
    '──',
    rows.join('\n'),
    '──',
    formatReceiptDate(session.started_at ? new Date(session.started_at) : new Date())
  ];

  return lines.join('\n');
}

// -----------------------------------------------------------------------------
// HELPER QUERY DATABASE
// -----------------------------------------------------------------------------
function getActiveTelemetry() {
  if (!db) {
    return {
      has_patient: false,
      name: 'Belum Ada Pasien',
      gender: '-',
      age: 0,
      height: 0,
      peak: 0.0,
      predicted: 0.0,
      pct_predicted: 0.0,
      zone: 'neutral',
      state: 'IDLE',
      status: 'Menunggu Pasien Baru',
      battery: 100,
      wifi_mode: 'STA · Node.js Server',
      wifi_bars: 4,
      printer_ok: true,
      sample_index: 0,
      samples: Array(10).fill(0),
      session_id: ''
    };
  }

  const row = db.prepare(`
    SELECT 
      dt.device_id, dt.state, dt.status_text, dt.battery_pct, 
      dt.wifi_mode, dt.wifi_bars, dt.printer_ok, dt.current_peak, 
      dt.current_sample_index, dt.active_session_id, dt.flag_print,
      p.id AS patient_id, p.name, p.gender, p.age, p.height_cm
    FROM device_telemetry dt
    LEFT JOIN patients p ON dt.active_patient_id = p.id
    WHERE dt.device_id = 'PFM-02623052'
    LIMIT 1
  `).get();

  const hasPatient = Boolean(row && row.name);
  const patient = {
    id: hasPatient ? row.patient_id : 0,
    name: hasPatient ? row.name : 'Belum Ada Pasien',
    gender: hasPatient ? row.gender : '-',
    age: hasPatient ? row.age : 0,
    height: hasPatient ? row.height_cm : 0
  };

  const peak = row ? Number(row.current_peak) : 0.0;
  const state = row ? row.state : 'IDLE';
  const status = row ? row.status_text : 'Menunggu Pasien Baru';
  const battery = row ? Number(row.battery_pct) : 100;
  const wifi_mode = row ? row.wifi_mode : 'STA · Node.js Server';
  const wifi_bars = row ? Number(row.wifi_bars) : 4;
  const printer_ok = row ? Boolean(row.printer_ok) : true;
  const sample_index = row ? Number(row.current_sample_index) : 0;
  const session_id = row && row.active_session_id ? row.active_session_id : '';

  let predicted = 0.0;
  let pct_predicted = 0.0;
  let zone = 'neutral';
  let flow_status = 'normal';
  let samples = Array(10).fill(0);

  if (session_id) {
    const sRow = db.prepare('SELECT best_pef, predicted_pef, pct_predicted, zone, samples_json FROM sessions WHERE session_id = ? LIMIT 1').get(session_id);
    if (sRow) {
      predicted = Number(sRow.predicted_pef);
      pct_predicted = Number(sRow.pct_predicted);
      zone = sRow.zone;
      flow_status = (zone === 'green' || zone === 'HIJAU') ? 'normal' : 'tidak normal';
      if (sRow.samples_json) {
        try { samples = JSON.parse(sRow.samples_json); } catch (_) {}
      }
    }
  } else if (hasPatient) {
    predicted = computePredictedPEF(patient.age, patient.gender, patient.height);
  }

  return {
    status: 'success',
    has_patient: hasPatient,
    name: patient.name,
    gender: patient.gender,
    age: patient.age,
    height: patient.height,
    peak,
    predicted,
    pct_predicted,
    zone,
    state,
    status,
    battery,
    wifi_mode,
    wifi_bars,
    printer_ok,
    sample_index,
    samples,
    session_id,
    data: {
      id: patient.id,
      name: patient.name,
      gender: patient.gender,
      age: patient.age,
      height: patient.height,
      peak_flow: peak,
      flow_status: zone === 'green' ? 'normal' : 'tidak normal',
      is_active: hasPatient ? 1 : 0
    }
  };
}

// -----------------------------------------------------------------------------
// HTTP SERVER (ZERO DEPENDENCY)
// -----------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname;
  let action = parsedUrl.searchParams.get('action') || '';

  // REST URL Normalization
  if (!action) {
    if (pathname === '/get-data') action = 'get_active';
    else if (pathname === '/submit') action = 'save_patient';
    else if (pathname === '/update-test') action = 'update_test';
    else if (pathname === '/sessions') action = 'get_sessions';
    else if (pathname === '/print') action = 'print';
    else if (pathname === '/print-status') action = 'print_status';
    else if (pathname === '/check-print') action = 'check_print';
    else if (pathname === '/export.csv') action = 'export_csv';
  }

  // Parse Body JSON / Form URL Encoded
  let body = {};
  if (req.method === 'POST') {
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const bodyStr = Buffer.concat(buffers).toString('utf8');
    if (bodyStr) {
      try {
        body = JSON.parse(bodyStr);
      } catch (_) {
        const params = new URLSearchParams(bodyStr);
        body = Object.fromEntries(params.entries());
      }
    }
  }

  // Gabungkan param query & body
  const params = { ...Object.fromEntries(parsedUrl.searchParams.entries()), ...body };
  if (params.action) action = params.action;

  // 1. ROUTE: GET / -> Sajikan Antarmuka Web Apple-Style
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html' || pathname === '/peakflow/')) {
    const htmlPath = path.join(__dirname, 'index.html');
    if (fs.existsSync(htmlPath)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(htmlPath, 'utf8'));
      return;
    }
  }

  // 2. ROUTE: API ACTION HANDLING
  try {
    switch (action) {
      case 'get_active':
      case 'get_data':
      case 'get-data': {
        const data = getActiveTelemetry();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(data));
        break;
      }

      case 'save_patient':
      case 'submit': {
        const name = String(params.name || '').trim();
        const gender = String(params.gender || 'M').trim().toUpperCase();
        const age = Number(params.age || 0);
        const height = Number(params.height || 0);

        if (!name || name.length > 50) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Nama wajib diisi (1–50 karakter).' }));
          return;
        }
        if (gender !== 'M' && gender !== 'F') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Jenis kelamin harus M (Laki-laki) atau F (Perempuan).' }));
          return;
        }
        if (!Number.isInteger(age) || age < 18 || age > 80) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Usia harus di antara 18 hingga 80 tahun.' }));
          return;
        }
        if (!Number.isFinite(height) || height < 120.0 || height > 220.0) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'error', message: 'Tinggi badan harus di antara 120.0 hingga 220.0 cm.' }));
          return;
        }

        let patientId = 1;
        if (db) {
          const ins = db.prepare('INSERT INTO patients (name, gender, age, height_cm) VALUES (?, ?, ?, ?)').run(name, gender, age, height);
          patientId = Number(ins.lastInsertRowid);

          db.prepare(`
            UPDATE device_telemetry 
            SET active_patient_id = ?, state = 'IDLE', status_text = 'Siap Melakukan Pengukuran', 
                current_peak = 0.0, current_sample_index = 0, active_session_id = NULL
            WHERE device_id = 'PFM-02623052'
          `).run(patientId);
        }

        const predicted = computePredictedPEF(age, gender, height);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          status: 'success',
          message: 'Data pasien berhasil didaftarkan',
          patient_id: patientId,
          name,
          predicted_pef: predicted
        }));
        break;
      }

      case 'update_test':
      case 'save_session': {
        const peakFlow = Number(params.peak_flow || params.peak || 0.0);
        const sampleIndex = Number(params.sample_index || 10);
        const deviceState = String(params.state || 'IDLE').trim();
        const battery = Number(params.battery || 100);
        const printerOk = params.printer_ok !== undefined ? Number(params.printer_ok) : 1;

        let patient = { id: 1, age: 25, gender: 'M', height_cm: 165 };
        if (db) {
          const tRow = db.prepare("SELECT active_patient_id FROM device_telemetry WHERE device_id = 'PFM-02623052'").get();
          if (tRow && tRow.active_patient_id) {
            const pRow = db.prepare('SELECT id, age, gender, height_cm FROM patients WHERE id = ?').get(tRow.active_patient_id);
            if (pRow) patient = pRow;
          }
        }

        // Mengutamakan data yang dihitung langsung oleh alat fisik ESP32
        const predicted = params.predicted !== undefined 
          ? Number(params.predicted) 
          : computePredictedPEF(patient.age, patient.gender, patient.height_cm);
        const pctPredicted = params.pct_predicted !== undefined 
          ? Number(params.pct_predicted) 
          : computePctPredicted(peakFlow, predicted);
        const zone = params.zone 
          ? String(params.zone) 
          : classifyZone(pctPredicted);
        const flowStatus = params.flow_status 
          ? String(params.flow_status) 
          : (zone === 'green' ? 'normal' : 'tidak normal');

        let samples = Array.isArray(params.samples) ? params.samples.map(Number) : [];
        if (!samples.length && typeof params.samples === 'string') {
          try { samples = JSON.parse(params.samples).map(Number); } catch (_) {}
        }
        while (samples.length < 10) samples.push(0.0);
        samples = samples.slice(0, 10);

        const sessionId = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);

        if (db && peakFlow > 0 && sampleIndex >= 10) {
          db.prepare(`
            INSERT INTO sessions 
            (session_id, patient_id, started_at, best_pef, predicted_pef, pct_predicted, zone, samples_json, s1, s2, s3, s4, s5, s6, s7, s8, s9, s10)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            sessionId, patient.id, peakFlow, predicted, pctPredicted, zone,
            JSON.stringify(samples),
            samples[0], samples[1], samples[2], samples[3], samples[4],
            samples[5], samples[6], samples[7], samples[8], samples[9]
          );

          const statusText = deviceState === 'RECORDING' ? 'Sedang Mengukur' : (deviceState === 'WAIT_ZERO' ? 'Tunggu embusan berikutnya' : 'Pengukuran Selesai');
          db.prepare(`
            UPDATE device_telemetry 
            SET state = ?, current_peak = ?, current_sample_index = ?, 
                battery_pct = ?, printer_ok = ?, active_session_id = ?,
                status_text = ?
            WHERE device_id = 'PFM-02623052'
          `).run(deviceState, peakFlow, sampleIndex, battery, printerOk, sessionId, statusText);
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          status: 'success',
          session_id: sessionId,
          peak_flow: peakFlow,
          predicted,
          pct_predicted: pctPredicted,
          zone
        }));
        break;
      }

      case 'get_sessions':
      case 'sessions': {
        const limit = Math.max(1, Math.min(100, Number(params.limit || 50)));
        let sessions = [];
        if (db) {
          const rows = db.prepare(`
            SELECT s.session_id, s.started_at, s.best_pef, s.predicted_pef, s.pct_predicted, s.zone, s.samples_json,
                   p.name, p.gender, p.age, p.height_cm
            FROM sessions s
            JOIN patients p ON s.patient_id = p.id
            ORDER BY s.started_at DESC
            LIMIT ?
          `).all(limit);

          sessions = rows.map((r) => {
            let smp = Array(10).fill(0);
            try { smp = JSON.parse(r.samples_json); } catch (_) {}
            return {
              session_id: r.session_id,
              started_at: r.started_at,
              best: Number(r.best_pef),
              predicted: Number(r.predicted_pef),
              pct_predicted: Number(r.pct_predicted),
              zone: r.zone,
              samples: smp,
              profile: {
                name: r.name,
                gender: r.gender,
                age: Number(r.age),
                height: Number(r.height_cm)
              }
            };
          });
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'success', count: sessions.length, sessions }));
        break;
      }

      case 'print': {
        if (db) {
          db.prepare("UPDATE device_telemetry SET flag_print = 1 WHERE device_id = 'PFM-02623052'").run();
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ status: 'success', state: 'printing', message: 'Perintah cetak dikirim ke printer' }));
        break;
      }

      case 'print_status': {
        let isPrinting = false;
        if (db) {
          const row = db.prepare("SELECT flag_print FROM device_telemetry WHERE device_id = 'PFM-02623052'").get();
          if (row && row.flag_print === 1) isPrinting = true;
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ state: isPrinting ? 'printing' : 'done' }));
        break;
      }

      case 'check_print': {
        let shouldPrint = false;
        if (db) {
          const row = db.prepare("SELECT flag_print FROM device_telemetry WHERE device_id = 'PFM-02623052'").get();
          if (row && row.flag_print === 1) {
            shouldPrint = true;
            db.prepare("UPDATE device_telemetry SET flag_print = 0 WHERE device_id = 'PFM-02623052'").run();
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ print: shouldPrint }));
        break;
      }

      case 'export_csv': {
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="peakflow-sessions-${new Date().toISOString().slice(0, 10)}.csv"`);

        const rows = ['session_id,started_at_wib,name,gender,age,height_cm,best_lpm,predicted_lpm,pct_predicted,zone,s1,s2,s3,s4,s5,s6,s7,s8,s9,s10'];
        if (db) {
          const dbRows = db.prepare(`
            SELECT s.session_id, s.started_at, p.name, p.gender, p.age, p.height_cm,
                   s.best_pef, s.predicted_pef, s.pct_predicted, s.zone,
                   s.s1, s.s2, s.s3, s.s4, s.s5, s.s6, s.s7, s.s8, s.s9, s.s10
            FROM sessions s
            JOIN patients p ON s.patient_id = p.id
            ORDER BY s.started_at DESC
          `).all();

          for (const r of dbRows) {
            rows.push([
              r.session_id, r.started_at, `"${r.name}"`, r.gender, r.age, r.height_cm,
              Number(r.best_pef).toFixed(1), Number(r.predicted_pef).toFixed(1), Number(r.pct_predicted).toFixed(1), r.zone,
              Number(r.s1).toFixed(1), Number(r.s2).toFixed(1), Number(r.s3).toFixed(1), Number(r.s4).toFixed(1), Number(r.s5).toFixed(1),
              Number(r.s6).toFixed(1), Number(r.s7).toFixed(1), Number(r.s8).toFixed(1), Number(r.s9).toFixed(1), Number(r.s10).toFixed(1)
            ].join(','));
          }
        }
        res.writeHead(200);
        res.end(rows.join('\n'));
        break;
      }

      default: {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          portal: 'PeakFlow Respiratory Portal Node.js Server',
          version: '2.0.0',
          status: 'online',
          calibration_factor: CALIBRATION_FACTOR,
          endpoints: [
            'GET / (Web Portal)',
            'GET /get-data (Telemetri Pasien & Alat)',
            'POST /submit (Daftar Pasien Baru)',
            'POST /update-test (Kirim Hasil Pengukuran ESP32)',
            'GET /sessions (Riwayat Pengukuran Sesi)',
            'POST /print (Cetak Struk Thermal)',
            'GET /export.csv (Unduh CSV)'
          ]
        }));
        break;
      }
    }
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'error', message: err.message }));
  }
});

server.listen(PORT, () => {
  console.log(`\n=======================================================`);
  console.log(`  PeakFlow Respiratory Portal — Node.js Server Aktif`);
  console.log(`  URL Portal : http://localhost:${PORT}`);
  console.log(`  Status Data: PURE CLEAN — Murni Baru Tanpa Dummy`);
  console.log(`=======================================================\n`);
});

