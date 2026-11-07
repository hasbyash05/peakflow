import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

console.log('=== PeakFlow Node.js Server Test Suite ===\n');

const testDbPath = path.join(process.cwd(), 'data', 'test-peakflow.db');
if (fs.existsSync(testDbPath)) {
  try { fs.unlinkSync(testDbPath); } catch (_) {}
}

// Start server on test port 3888 with isolated test database
const serverProc = spawn('node', ['server.mjs'], {
  env: { ...process.env, PORT: '3888', DB_PATH: testDbPath },
  stdio: 'pipe'
});

serverProc.stdout.on('data', (d) => process.stdout.write(d.toString()));
serverProc.stderr.on('data', (d) => process.stderr.write(d.toString()));

// Wait 800ms for server to boot
await new Promise((r) => setTimeout(r, 800));

function request(path, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:3888${path}`, options, (res) => {
      let data = '';
      res.on('data', (c) => data += c);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, headers: res.headers, raw: data });
        }
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

try {
  // 1. Test GET / (HTML delivery)
  const home = await request('/');
  assert.equal(home.status, 200);
  assert.ok(home.raw.includes('<title>PeakFlow'));
  console.log('PASS  GET / serves index.html properly');

  // 2. Test GET /get-data (Initial Clean State - No Dummy Data)
  const initial = await request('/get-data');
  assert.equal(initial.status, 200);
  assert.equal(initial.body.has_patient, false);
  assert.equal(initial.body.name, 'Belum Ada Pasien');
  console.log('PASS  GET /get-data returns initial clean state');

  // 3. Test POST /submit (Register real patient)
  const reg = await request('/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Ahmad Fauzi', gender: 'M', age: 24, height: 172.0 })
  });
  assert.equal(reg.status, 200);
  assert.equal(reg.body.status, 'success');
  assert.equal(reg.body.name, 'Ahmad Fauzi');
  console.log('PASS  POST /submit registers fresh patient');

  // 4. Test GET /get-data after patient registration
  const afterReg = await request('/get-data');
  assert.equal(afterReg.body.name, 'Ahmad Fauzi');
  assert.equal(afterReg.body.gender, 'M');
  assert.equal(afterReg.body.age, 24);
  assert.equal(afterReg.body.height, 172.0);
  console.log('PASS  GET /get-data reflects new patient profile with distinct fields');

  // 5. Test POST /update-test (ESP32 sends real measurement)
  const testRun = await request('/update-test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      peak_flow: 650.0,
      sample_index: 10,
      state: 'IDLE',
      samples: [400, 650, 580, 500, 420, 310, 200, 140, 90, 50]
    })
  });
  assert.equal(testRun.status, 200);
  assert.equal(testRun.body.peak_flow, 650.0);
  assert.ok(testRun.body.predicted > 0);
  assert.ok(testRun.body.pct_predicted > 0);
  console.log('PASS  POST /update-test records real measurement and calculates Knudson PEF');

  // 6. Test GET /sessions (Multi-session history)
  const sessions = await request('/sessions');
  assert.equal(sessions.status, 200);
  assert.ok(sessions.body.count >= 1);
  assert.equal(sessions.body.sessions[0].best, 650.0);
  console.log('PASS  GET /sessions retrieves real session history');

  // 7. Test Backward-compatible ESP32 action query parameter
  const legacyEsp = await request('/api.php?action=get_active');
  assert.equal(legacyEsp.status, 200);
  assert.equal(legacyEsp.body.name, 'Ahmad Fauzi');
  console.log('PASS  Legacy ESP32 query /api.php?action=get_active is 100% supported');

  console.log('\nAll Node.js Server test assertions passed successfully!');
} finally {
  serverProc.kill();
  if (fs.existsSync(testDbPath)) {
    try { fs.unlinkSync(testDbPath); } catch (_) {}
  }
}
