/**
 * PeakFlow Respiratory Portal — Pure Calculation & Protocol Core
 * Source of Truth: KTI Yoganata Firman Maulana (STIKES Semarang, 2026) & PRD v2.0.0
 *
 * Pure functions only — no DOM or hardware I/O side effects (§14.1).
 */

export const CONFIG = Object.freeze({
  FW_VERSION: '1.1.0',
  BUILD_DATE: '2026-04-08',
  DEVICE_ID: 'PFM-02623052',
  CALIBRATION_FACTOR: 1.5, // Locked per KTI §3.12.2 & PRD §14.1
  SENSOR_PIN: 15,
  PRINTER_RX_PIN: 16,
  PRINTER_TX_PIN: 17,
  SAMPLE_INTERVAL_MS: 200,
  MAX_SAMPLES: 10,
  FLOW_START_THRESHOLD: 5.0,
  ZONE_GREEN_MIN_PCT: 80.0,
  ZONE_YELLOW_MIN_PCT: 60.0,
  POLL_INTERVAL_MS: 400,
  WATCHDOG_TIMEOUT_MS: 3000,
  MAX_SESSIONS_RING: 20,
  BATTERY_LOW_PCT: 20
});

export const DeviceState = Object.freeze({
  IDLE: 'IDLE',
  RECORDING: 'RECORDING',
  WAIT_ZERO: 'WAIT_ZERO',
  PRINTING: 'PRINTING',
  ERROR: 'ERROR'
});

/**
 * Round number to 1 decimal place
 * @param {number} val
 * @returns {number}
 */
export function round1(val) {
  const n = Number(val);
  if (!Number.isFinite(n)) return 0.0;
  return Math.round((n + Number.EPSILON) * 10) / 10;
}

/**
 * Format decimal using Indonesian locale comma (e.g., 641.7 -> "641,7")
 * @param {number} val
 * @param {number} [decimals=1]
 * @returns {string}
 */
export function formatIDNumber(val, decimals = 1) {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0,0';
  return n.toFixed(decimals).replace('.', ',');
}

/**
 * Compute instantaneous Expiratory Flow (L/min) from FS300A pulse count
 * KTI §3.12.2: flow = (pulses / (interval_ms / 1000)) / CALIBRATION_FACTOR
 *
 * @param {number} pulseCount
 * @param {number} [intervalMs=CONFIG.SAMPLE_INTERVAL_MS]
 * @param {number} [calibrationFactor=CONFIG.CALIBRATION_FACTOR]
 * @returns {number} Flow in L/min rounded to 1 decimal
 */
export function computePEF(
  pulseCount,
  intervalMs = CONFIG.SAMPLE_INTERVAL_MS,
  calibrationFactor = CONFIG.CALIBRATION_FACTOR
) {
  if (pulseCount <= 0 || intervalMs <= 0 || calibrationFactor <= 0) return 0.0;
  const seconds = intervalMs / 1000.0;
  const rawLpm = (pulseCount / seconds) / calibrationFactor;
  return round1(rawLpm);
}

/**
 * Compute Predicted PEF (L/min) based on Age, Sex, and Height (cm)
 * Knudson 1983 / KTI §5.2 & §17.1 baseline regression:
 * - Male (M):   5.6 * height_cm - 2.0 * age - 238.0  (21yo, 170cm -> 672.0 L/min)
 * - Female (F): 4.0 * height_cm - 1.5 * age - 170.0  (20yo, 160cm -> 440.0 L/min)
 *
 * @param {number} age Years (18-80)
 * @param {'M'|'F'} sex 'M' or 'F'
 * @param {number} heightCm Height in cm (120-220)
 * @returns {number} Predicted PEF in L/min (1 decimal)
 */
export function computePredictedPEF(age, sex, heightCm) {
  const a = Number(age);
  const h = Number(heightCm);
  const s = String(sex || 'M').toUpperCase();

  if (!Number.isFinite(a) || !Number.isFinite(h) || a <= 0 || h <= 0) {
    return 0.0;
  }

  let predicted = 0.0;
  if (s === 'F') {
    predicted = 4.0 * h - 1.5 * a - 170.0;
  } else {
    predicted = 5.6 * h - 2.0 * a - 238.0;
  }

  return Math.max(100.0, round1(predicted));
}

/**
 * Compute % of predicted PEF
 * @param {number} bestLpm
 * @param {number} predictedLpm
 * @returns {number} Percentage rounded to 1 decimal
 */
export function computePctPredicted(bestLpm, predictedLpm) {
  const b = Number(bestLpm);
  const p = Number(predictedLpm);
  if (!Number.isFinite(b) || !Number.isFinite(p) || p <= 0 || b <= 0) {
    return 0.0;
  }
  return round1((b / p) * 100.0);
}

/**
 * Classify GINA 2024 3-color clinical zone (KTI §2.2.2 & PRD FR-M3)
 * - green  : >= 80.0%
 * - yellow : 60.0% - 79.9%
 * - red    : < 60.0%
 *
 * @param {number} pctPredicted
 * @returns {'green'|'yellow'|'red'}
 */
export function classifyZone(pctPredicted) {
  const pct = Number(pctPredicted);
  if (pct >= CONFIG.ZONE_GREEN_MIN_PCT) return 'green';
  if (pct >= CONFIG.ZONE_YELLOW_MIN_PCT) return 'yellow';
  return 'red';
}

/**
 * Indonesian clinical label for zone
 * @param {'green'|'yellow'|'red'} zone
 * @returns {{ label: string, upper: string, summary: string }}
 */
export function getZoneMeta(zone) {
  switch (zone) {
    case 'green':
      return {
        label: 'Zona Hijau',
        upper: 'HIJAU',
        summary: 'Fungsi jalan napas baik (≥ 80% prediksi). Lanjutkan pemantauan rutin.'
      };
    case 'yellow':
      return {
        label: 'Zona Kuning',
        upper: 'KUNING',
        summary: 'Penyempitan jalan napas ringan-sedang (60–79% prediksi). Evaluasi aktivitas & rencana aksi asma.'
      };
    case 'red':
    default:
      return {
        label: 'Zona Merah',
        upper: 'MERAH',
        summary: 'Waspada penyempitan jalan napas berat (< 60% prediksi). Segera konsultasikan ke tenaga kesehatan.'
      };
  }
}

/**
 * Validate patient form inputs per FR-P1
 * @param {{ name: string, gender: string, age: number|string, height: number|string }} input
 * @returns {{ valid: boolean, errors: Record<string, string>, cleaned?: { name: string, gender: 'M'|'F', age: number, height: number } }}
 */
export function validatePatientInput(input) {
  const errors = {};
  const rawName = String(input?.name ?? '').trim();
  const rawGender = String(input?.gender ?? '').trim().toUpperCase();
  const rawAge = Number(input?.age);
  const rawHeight = Number(input?.height);

  if (!rawName) {
    errors.name = 'Nama pasien wajib diisi.';
  } else if (rawName.length > 50) {
    errors.name = 'Nama maksimal 50 karakter.';
  }

  if (rawGender !== 'M' && rawGender !== 'F') {
    errors.gender = 'Pilih jenis kelamin (Laki-laki / Perempuan).';
  }

  if (!Number.isInteger(rawAge) || rawAge < 18 || rawAge > 80) {
    errors.age = 'Usia harus bilangan bulat antara 18 hingga 80 tahun (sesuai subjek KTI §1.3).';
  }

  if (!Number.isFinite(rawHeight) || rawHeight < 120 || rawHeight > 220) {
    errors.height = 'Tinggi badan harus antara 120 hingga 220 cm.';
  }

  const valid = Object.keys(errors).length === 0;
  return {
    valid,
    errors,
    cleaned: valid
      ? {
          name: rawName,
          gender: /** @type {'M'|'F'} */ (rawGender),
          age: rawAge,
          height: round1(rawHeight)
        }
      : undefined
  };
}

/**
 * Format timestamp in Asia/Jakarta for thermal receipt ("Semarang, 7 Apr 2026 14:32")
 * @param {string|number|Date} isoOrDate
 * @returns {string}
 */
export function formatReceiptTimestamp(isoOrDate) {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const parts = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(d);

  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const day = Number(map.day || d.getDate());
  const monthIdx = Math.max(0, Math.min(11, Number(map.month || d.getMonth() + 1) - 1));
  const year = map.year || d.getFullYear();
  const hour = String(map.hour || '00').padStart(2, '0');
  const minute = String(map.minute || '00').padStart(2, '0');
  return `Semarang, ${day} ${months[monthIdx]} ${year} ${hour}:${minute}`;
}

/**
 * Pure server-side ASCII bar chart generator (1000 -> 0 step 50) for 57.5mm thermal printer (32 chars max width)
 * KTI Lampiran hal. 72 & PRD FR-C1 / FR-C2
 *
 * @param {number[]} samples Array of up to 10 sample readings in L/min
 * @returns {string} Multi-line ASCII graph (every line <= 32 chars)
 */
export function renderAsciiGraph(samples = []) {
  const norm = Array.from({ length: CONFIG.MAX_SAMPLES }, (_, i) => Number(samples[i] ?? 0));
  const lines = [];

  for (let level = 1000; level >= 50; level -= 50) {
    const label = String(level).padStart(4, ' ');
    let row = `${label}|`;
    for (let i = 0; i < CONFIG.MAX_SAMPLES; i++) {
      const val = norm[i];
      row += val >= level ? ' *' : '  ';
    }
    lines.push(row);
  }

  lines.push('   0+--------------------');
  lines.push('      1 2 3 4 5 6 7 8 9 0');
  return lines.join('\n');
}

/**
 * Pure function to render complete 32-char thermal receipt per PRD FR-C1
 * @param {{
 *   profile: { name: string, gender: 'M'|'F', age: number, height: number },
 *   best: number,
 *   predicted: number,
 *   pct_predicted: number,
 *   zone: 'green'|'yellow'|'red',
 *   samples: number[],
 *   started_at?: string
 * }} data
 * @returns {string}
 */
export function formatThermalReceipt(data) {
  const name = String(data?.profile?.name || '-').slice(0, 22);
  const age = Number(data?.profile?.age || 0);
  const gender = String(data?.profile?.gender || 'M').toUpperCase();
  const height = Number(data?.profile?.height || 0);
  const best = round1(data?.best || 0).toFixed(1);
  const predicted = round1(data?.predicted || 0).toFixed(1);
  const pct = round1(data?.pct_predicted || 0).toFixed(1);
  const zoneMeta = getZoneMeta(data?.zone || 'red');
  const asciiGraph = renderAsciiGraph(data?.samples || []);
  const footerDate = formatReceiptTimestamp(data?.started_at || new Date().toISOString());

  return [
    '── PEAKFLOW ──',
    `Nama    : ${name}`,
    `Usia    : ${age} th (${gender})`,
    `Tinggi  : ${Math.round(height)} cm`,
    '──',
    `PEF     : ${best} L/min`,
    `Prediksi: ${predicted} L/min`,
    `Zona    : ${zoneMeta.upper} (${pct}%)`,
    '──',
    asciiGraph,
    '──',
    footerDate
  ].join('\n');
}

/**
 * Generate a realistic 10-sample expiratory blow curve peaking at `targetPeakLpm`
 * Sample 0: rapid rise, Sample 1: peak (targetPeakLpm), Samples 2..9: exponential decay
 * @param {number} targetPeakLpm
 * @returns {number[]} 10 samples (1 decimal)
 */
export function generateExpiratoryCurve(targetPeakLpm) {
  const peak = round1(Math.max(0, Number(targetPeakLpm)));
  if (peak <= 0) return Array(CONFIG.MAX_SAMPLES).fill(0.0);
  const ratios = [0.68, 1.0, 0.86, 0.71, 0.56, 0.42, 0.30, 0.20, 0.13, 0.08];
  const curve = ratios.map((r, idx) => {
    if (idx === 1) return peak;
    return round1(peak * r);
  });
  return curve;
}

/**
 * Official KTI §4.6 Test Fixtures (PRD §17.1)
 */
export const KTI_FIXTURES = Object.freeze([
  {
    id: 'kti-yoganata',
    label: 'Kasus 1 — Yoganata (Normal · Gambar 4.6)',
    profile: { name: 'Yoganata', sex: 'M', age: 21, height_cm: 170 },
    reading: { best_lpm: 641.7 },
    expected: { predicted_lpm: 672.0, pct_predicted: 95.5, zone: 'green' }
  },
  {
    id: 'kti-marsel',
    label: 'Kasus 2 — Marsel (Tidak Normal · Tabel 4.8)',
    profile: { name: 'Marsel', sex: 'M', age: 21, height_cm: 170 },
    reading: { best_lpm: 250.0 },
    expected: { predicted_lpm: 672.0, pct_predicted: 37.2, zone: 'red' }
  },
  {
    id: 'kti-sekar',
    label: 'Kasus 3 — Sekar (Wanita Normal · Tabel 4.8)',
    profile: { name: 'Sekar', sex: 'F', age: 20, height_cm: 160 },
    reading: { best_lpm: 419.0 },
    expected: { predicted_lpm: 440.0, pct_predicted: 95.2, zone: 'green' }
  }
]);

