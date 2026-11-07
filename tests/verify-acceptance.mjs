import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  CONFIG,
  KTI_FIXTURES,
  classifyZone,
  computePEF,
  computePctPredicted,
  computePredictedPEF,
  formatThermalReceipt,
  generateExpiratoryCurve,
  renderAsciiGraph,
  validatePatientInput
} from '../src/peakflow-core.js';

const rootDir = process.cwd();
const htmlPath = path.join(rootDir, 'index.html');
const corePath = path.join(rootDir, 'src', 'peakflow-core.js');

const htmlContent = fs.readFileSync(htmlPath, 'utf8');
const coreContent = fs.readFileSync(corePath, 'utf8');

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS  ${name}`);
}

console.log('=== PeakFlow Respiratory Portal — PRD v2.0.0 Verification Suite ===\n');

// 1. Calibration factor & no 1.8 in production code (§12.1 & §14.1)
test('CALIBRATION_FACTOR is locked to 1.5 and 1.8 is absent from production code', () => {
  assert.equal(CONFIG.CALIBRATION_FACTOR, 1.5);
  assert.equal(/\b1\.8\b/.test(htmlContent), false, 'Found forbidden 1.8 in index.html');
  assert.equal(/\b1\.8\b/.test(coreContent), false, 'Found forbidden 1.8 in src/peakflow-core.js');
  assert.equal(computePEF(192.5, 200, 1.5), 641.7);
});

// 2. KTI §4.6 Fixtures (§17.1 & §12.1)
for (const fx of KTI_FIXTURES) {
  test(`KTI Fixture: ${fx.label}`, () => {
    const predicted = computePredictedPEF(fx.profile.age, fx.profile.sex, fx.profile.height_cm);
    const pct = computePctPredicted(fx.reading.best_lpm, predicted);
    const zone = classifyZone(pct);

    assert.equal(predicted, fx.expected.predicted_lpm, `Predicted mismatch for ${fx.profile.name}`);
    assert.equal(pct, fx.expected.pct_predicted, `% Predicted mismatch for ${fx.profile.name}`);
    assert.equal(zone, fx.expected.zone, `Zone mismatch for ${fx.profile.name}`);
  });
}

// 3. GINA 2024 3-Zone boundaries (FR-M3)
test('GINA 2024 3-zone thresholds (Green >= 80%, Yellow 60-79.9%, Red < 60%)', () => {
  assert.equal(classifyZone(80.0), 'green');
  assert.equal(classifyZone(95.5), 'green');
  assert.equal(classifyZone(79.9), 'yellow');
  assert.equal(classifyZone(60.0), 'yellow');
  assert.equal(classifyZone(59.9), 'red');
  assert.equal(classifyZone(37.2), 'red');
});

// 4. Patient form validation (FR-P1)
test('Patient input validation enforces name <= 50, gender M/F, age 18-80, height 120-220 cm', () => {
  assert.equal(validatePatientInput({ name: 'Yoganata', gender: 'M', age: 21, height: 170 }).valid, true);
  assert.equal(validatePatientInput({ name: '', gender: 'M', age: 21, height: 170 }).valid, false);
  assert.equal(validatePatientInput({ name: 'A'.repeat(51), gender: 'M', age: 21, height: 170 }).valid, false);
  assert.equal(validatePatientInput({ name: 'Budi', gender: 'X', age: 21, height: 170 }).valid, false);
  assert.equal(validatePatientInput({ name: 'Budi', gender: 'M', age: 17, height: 170 }).valid, false);
  assert.equal(validatePatientInput({ name: 'Budi', gender: 'M', age: 81, height: 170 }).valid, false);
  assert.equal(validatePatientInput({ name: 'Budi', gender: 'M', age: 25, height: 119 }).valid, false);
  assert.equal(validatePatientInput({ name: 'Budi', gender: 'M', age: 25, height: 221 }).valid, false);
});

// 5. Thermal receipt & server-side ASCII bar chart (FR-C1 & FR-C2)
test('Thermal receipt matches FR-C1 template and 32-char width constraint (57.5 mm)', () => {
  const samples = generateExpiratoryCurve(641.7);
  const receipt = formatThermalReceipt({
    profile: { name: 'Yoganata', gender: 'M', age: 21, height: 170 },
    best: 641.7,
    predicted: 672.0,
    pct_predicted: 95.5,
    zone: 'green',
    samples,
    started_at: '2026-04-07T07:32:00.000Z'
  });

  assert.ok(receipt.includes('── PEAKFLOW ──'));
  assert.ok(receipt.includes('Nama    : Yoganata'));
  assert.ok(receipt.includes('Usia    : 21 th (M)'));
  assert.ok(receipt.includes('Tinggi  : 170 cm'));
  assert.ok(receipt.includes('PEF     : 641.7 L/min'));
  assert.ok(receipt.includes('Prediksi: 672.0 L/min'));
  assert.ok(receipt.includes('Zona    : HIJAU (95.5%)'));
  assert.ok(receipt.includes('1000|'));
  assert.ok(receipt.includes(' 600|'));
  assert.ok(receipt.includes('  50|'));
  assert.ok(receipt.includes('   0+--------------------'));
  assert.ok(receipt.includes('Semarang, 7 Apr 2026 14:32'));

  const lines = receipt.split('\n');
  for (const line of lines) {
    assert.ok(line.length <= 32, `Receipt line exceeds 32 chars (${line.length}): "${line}"`);
  }
});

// 6. /get-data bug fix verification (§3 #1 & §12.1)
test('/get-data endpoint maps name, gender, age, height from distinct profile fields', () => {
  assert.ok(htmlContent.includes('name: edgeServer.profile.name'));
  assert.ok(htmlContent.includes('gender: edgeServer.profile.gender'));
  assert.ok(htmlContent.includes('age: edgeServer.profile.age'));
  assert.ok(htmlContent.includes('height: edgeServer.profile.height'));
});

// 7. CSS & Apple Design System enforcement (§11, §12.1, §14.2)
test('CSS has zero hardcoded hex values outside :root and zero !important declarations', () => {
  assert.equal(/!important/i.test(htmlContent), false, 'Found forbidden !important in index.html');

  const withoutRoot = htmlContent.replace(/:root\s*\{[\s\S]*?\}/, '');
  const strayHex = withoutRoot.match(/#[0-9a-fA-F]{3,8}\b/g);
  assert.equal(strayHex, null, `Found hardcoded hex outside :root: ${strayHex ? strayHex.join(', ') : ''}`);
});

test('Zero external dependencies & complete viewport meta (§14.2)', () => {
  assert.ok(htmlContent.includes('<title>PeakFlow'));
  assert.ok(htmlContent.includes('width=device-width, initial-scale=1, viewport-fit=cover'));
  assert.equal(/https?:\/\/fonts\.googleapis/i.test(htmlContent), false);
  assert.equal(/<script[^>]+src=["']https?:/i.test(htmlContent), false);
  assert.equal(/<link[^>]+href=["']https?:/i.test(htmlContent), false);
});

// 8. Gzip size budget for ESP32 PROGMEM (§8 & §14.2)
test('Edge HTML gzip <= 15 KB and JS gzip <= 8 KB (§8 & §14.2)', () => {
  const htmlGzipBytes = zlib.gzipSync(Buffer.from(htmlContent, 'utf8')).length;
  const scriptMatch = htmlContent.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, 'Inline script tag must exist');
  const jsGzipBytes = zlib.gzipSync(Buffer.from(scriptMatch[1], 'utf8')).length;

  console.log(`      -> HTML gzipped size : ${htmlGzipBytes} bytes (limit: 15360 bytes / 15 KB)`);
  console.log(`      -> JS gzipped size   : ${jsGzipBytes} bytes (limit: 8192 bytes / 8 KB)`);

  assert.ok(htmlGzipBytes <= 15360, `HTML gzip size ${htmlGzipBytes} exceeds 15 KB`);
  assert.ok(jsGzipBytes <= 8192, `JS gzip size ${jsGzipBytes} exceeds 8 KB`);
});

console.log(`\nAll ${passed} acceptance test suites passed.`);

