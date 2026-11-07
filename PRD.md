---
title: "PeakFlow Respiratory Portal"
subtitle: "Product Requirements Document (PRD)"
version: "2.0.0"
status: "Draft — Ready for Execution"
date: "2026-04-08"
owner: "Tastikess Semarang"
primary_source: "KTI Yoganata Firman Maulana — Rancang Bangun Peak Flow Meter untuk Deteksi Penderita Asma Berbasis IoT dengan Output Print Thermal (STIKES Semarang, 2026)"
secondary_source: "Observasi https://tastikessemarang.com/peakflow/index.php"
license: "Internal"
---

# PRD — PeakFlow Respiratory Portal

> **Prinsip inti:** *Edge-first. Cloud-optional. Medical-clear. Silent.*
>
> Alat adalah produk utamanya. Web adalah nilai tambah. Setiap piksel harus bisa dipertanggungjawabkan ke angka di dokumen sumber (KTI).

---

## Daftar Isi

- [0. Ringkasan Eksekutif](#0-ringkasan-eksekutif)
- [1. Latar Belakang & Sumber](#1-latar-belakang--sumber)
- [2. Analisis Cross-Reference (KTI vs Web Saat Ini)](#2-analisis-cross-reference-kti-vs-web-saat-ini)
- [3. Bug & Risiko dari Sumber](#3-bug--risiko-dari-sumber)
- [4. Definisi Produk](#4-definisi-produk)
- [5. Ruang Lingkup](#5-ruang-lingkup)
- [6. Persona & Peran](#6-persona--peran)
- [7. Functional Requirements](#7-functional-requirements)
- [8. Non-Functional Requirements](#8-non-functional-requirements)
- [9. Data Model](#9-data-model)
- [10. API Contract](#10-api-contract)
- [11. Design System — Apple-Style](#11-design-system--apple-style)
- [12. Acceptance Criteria](#12-acceptance-criteria)
- [13. Roadmap](#13-roadmap)
- [14. Aturan Pengembangan](#14-aturan-pengembangan)
- [15. Kontrak dengan Sumber (KTI)](#15-kontrak-dengan-sumber-kti)
- [16. Risiko & Mitigasi](#16-risiko--mitigasi)
- [17. Lampiran](#17-lampiran)

---

## 0. Ringkasan Eksekutif

**PeakFlow** adalah sistem dua-lapis untuk memantau *Peak Expiratory Flow* (PEF) pada penderita asma:

1. **Lapis Edge (di dalam alat):** ESP32 DevKitC V4 + sensor FS300A G3/4 + OLED SH1107 1.3" + printer thermal BT-2 + LED indikator + baterai 18650. Berjalan **tanpa internet** via SoftAP `PeakFlowWeb`. Wajib 100% fungsional *offline*.
2. **Lapis Cloud (di web):** Portal `peakflow.tastikessemarang.com` — menyimpan histori, visualisasi tren, multi-pasien, akses klinisi. **Opsional** — alat tetap bisa dipakai tanpa ini.

PRD ini disusun dari **sumber tunggal** — Karya Tulis Ilmiah (KTI) Yoganata Firman Maulana (STIKES Semarang, 2026) — dan hasil observasi langsung halaman `peakflow.tastikessemarang.com`. Tujuannya bukan menambah fitur demi fitur, tapi **menjadikan prototipe fungsional menjadi produk yang bisa dipertanggungjawabkan secara klinis dan estetis**.

---

## 1. Latar Belakang & Sumber

### 1.1 Masalah yang Diselesaikan

Asma adalah penyakit pernapasan kronis dengan prevalensi global ~363 juta (WHO, 2023) dan 1,6% di Indonesia (SKI 2023). Pemantauan PEF rutin adalah standar manajemen asma (GINA 2024), namun:

- **Peak Flow Meter konvensional** tidak menyimpan data — pengguna mencatat manual dan sering keliru (NICE, 2022).
- **Data hilang** saat ingin dibagikan ke tenaga kesehatan.
- **Tidak ada tren** — hanya snapshot yang tidak bisa dievaluasi.

### 1.2 Solusi yang Sudah Dibangun (KTI)

Alat yang dirancang oleh KTI sudah berhasil:

- Mengukur PEF via sensor FS300A dengan akurasi **0,4–1,8%** vs Rossmax PF-120 (KTI §4.6).
- Menampilkan hasil di OLED dan web lokal.
- Mengirim data ke web server via WiFi.
- Mencetak hasil via printer thermal.
- Mengklasifikasi kondisi via 2 LED (normal/tidak normal).

**Yang belum ada:** histori multi-sesi, visualisasi tren, multi-pasien, akses klinisi, dan UI yang layak produk.

### 1.3 Sumber Tunggal

| Dokumen | Peran |
|---|---|
| KTI Yoganata Firman Maulana (2026) | **Source of truth** untuk hardware, firmware, protokol, standar klinis |
| Observasi `peakflow.tastikessemarang.com` | Baseline UI saat ini |
| GINA 2024 (dikutip KTI §2.2.2) | Standar zona klinis |
| ISO 23747:2015 (dikutip KTI §2.2.1) | Standar Peak Flow Meter |

---

## 2. Analisis Cross-Reference (KTI vs Web Saat Ini)

| Aspek | Menurut KTI | Kondisi Web Saat Ini | Gap |
|---|---|---|---|
| Topologi jaringan | ESP32 SoftAP `PeakFlowWeb` / `12345678` → `192.168.4.1` | Hosting publik `tastikessemarang.com/peakflow/` | Dua varian (lokal vs demo online) |
| Backend | (a) `AsyncWebServer` PROGMEM di firmware; (b) `api.php` + MySQL | Tampilan identik dengan varian (a) | Belum jelas mana yang production |
| Database | Tabel `patient_records` (MySQL) | Tidak ada histori — hanya 1 pasien aktif (`is_active=1`) | **Kritis**: tidak ada histori multi-sesi |
| Indikator zona | 2 LED binary (normal / tidak normal) | Sama | KTI §2.2.2 kutip GINA 3 zona, tapi firmware 2 zona |
| Baseline | Tabel lookup umur+gender (absolut) | Sama — **tidak pakai tinggi badan** | KTI §5.2 mengakui ini sebagai kekurangan |
| Formulir | Nama, gender, umur, tinggi | Identik | Konsisten |
| Endpoint | `/submit`, `/print`, `/get-data` | Varian (a) | Konsisten |
| Endpoint API | `api.php?action=save_patient\|get_active\|update_test` | Varian (b) | Konsisten |
| Polling | 400ms (varian b) / 500ms (varian a) | Varian (a) | Konsisten |
| Kalibrasi | `(pulsa/0,2)/1,5` (KTI §3.12.2) vs `(pulsa/0,2)/1,8` (Lampiran hal. 76) | Kode pakai **1.8**, dokumen pakai **1.5** | **Inkonsisten** |
| Recording | 10 sampel × 200ms = 2 detik, threshold mulai > 5 L/min | Sesuai | Konsisten |
| Cetak | Bar chart ASCII 1000→0 step 50 | Sesuai | Konsisten |
| Trigger print | `POST /print` → set `flagPrintReport` | Varian (a) | Konsisten |

---

## 3. Bug & Risiko dari Sumber

### Bug Kritis

1. **`/get-data` mengembalikan field salah.** Di Lampiran KTI hal. 75:
   ```cpp
   doc["gender"] = userName;   // harusnya userGender
   doc["age"]    = userName;   // harusnya userAge
   doc["height"] = userName;   // harusnya userHeight
   ```
   Semua field mengembalikan `userName`. Ini membuat web menampilkan data pasien palsu.
2. **Kalibrasi tidak konsisten.** §3.12.2 → 1.5; Lampiran → 1.8. Harus dikunci di satu `#define`.
3. **Hanya satu pasien aktif.** Setiap `save_patient` men-`UPDATE ... is_active=0` untuk semua baris. Histori per-pasien tidak mungkin ada dengan skema ini.
4. **Tidak ada konsep "sesi pengukuran".** Setiap pengukuran menimpa `peak_flow` yang sama. Padahal KTI §4.6 melaporkan 3 percobaan per responden.

### Inkonsistensi

5. **Threshold firmware** pakai lookup age+gender absolut, sementara KTI §2.2.2 mengutip GINA yang berbasis % prediksi. Web harus pakai % prediksi (dengan tinggi badan), firmware boleh tetap absolut untuk display fallback.
6. **Form tinggi badan tidak dipakai** di firmware maupun backend untuk perhitungan. KTI §5.2 secara eksplisit mengakui ini sebagai saran perbaikan.

### Keamanan

7. **Tidak ada autentikasi.** Web terbuka untuk siapa saja di jaringan lokal.
8. **Tidak ada timestamp per reading.** Hanya timestamp level baris pasien.

---

## 4. Definisi Produk

### 4.1 Visi
> "Alat ukur pernapasan yang terasa seperti alat Apple — sunyi, presisi, dan jujur pada data."

### 4.2 Prinsip Arsitektur
**Edge-first, cloud-optional.**
- Alat 100% fungsional tanpa internet.
- Semua fitur edge punya fallback lokal (NVS / SPIFFS).
- Cloud hanya menyinkronkan, tidak pernah menjadi syarat operasi.

### 4.3 Posisi terhadap KTI
PRD ini melanjutkan KTI, bukan menggantikannya. Setiap hardware dan protokol di KTI dianggap final kecuali diberi catatan eksplisit di §15.

---

## 5. Ruang Lingkup

### In-Scope v1.0 (Fase A — "Edge UI Polish")
- Ganti UI yang di-embed di firmware (PROGMEM) dengan versi Apple-style yang ringan (< 15 KB gzip).
- Fix bug `/get-data` (§3 poin 1).
- Konsistenkan faktor kalibrasi ke satu nilai `CALIBRATION_FACTOR`.
- Konsep sesi & riwayat di level firmware (ring buffer 20 sesi di SPIFFS).
- Zona 3-warna (Hijau / Kuning / Merah) menggantikan 2 LED binary.
- Perbaiki `PeakFlowCalculation()` agar menggunakan % prediksi dengan tinggi badan (Knudson 1983).
- Form pasien dengan validasi (usia 18–80, tinggi 120–220 cm).
- Print preview sebelum trigger print.
- Ekspor CSV dari riwayat lokal.

### In-Scope v1.1 (Fase B — "Cloud Sync")
- Backend cloud (Node.js/Fastify) untuk menerima push dari ESP32 saat terhubung WiFi rumah/klinik (mode STA fallback).
- Auth magic link + multi-role (`patient`, `clinician`, `admin`).
- Dashboard tren 7/30/90 hari.
- Multi-profil per akun (orang tua kelola anak).
- Audit log untuk akses klinis.

---

## 6. Persona & Peran

| Persona | Kapan muncul | Layar utama | Role sistem |
|---|---|---|---|
| Operator alat (perawat/mahasiswa lab) | Menyalakan, mengisi data pasien, memicu cetak | Form pasien + status alat | `operator` |
| Pasien (di rumah, mode mandiri) | Melakukan pengukuran harian | Live reading + zona | `patient` |
| Klinisi (Fase B) | Review tren pasien binaan | Dashboard tren + catatan | `clinician` |
| Admin (Fase B) | Kelola perangkat & undangan | Perangkat + user | `admin` |

---

## 7. Functional Requirements

### 7.1 Formulir Pasien (menggantikan KTI Gambar 4.3)
- **FR-P1** Field: Nama (≤ 50 char), Gender (M/F), Umur (18–80), Tinggi (120–220 cm). Validasi client-side sebelum `POST /submit`.
- **FR-P2** Setelah submit sukses: tampilkan konfirmasi halus ("Data tersimpan") dan transisi ke layar pengukuran.
- **FR-P3** Tombol "Ganti pasien" selalu tersedia di header; konfirmasi modal jika ada sesi berjalan.
- **FR-P4** Data pasien disimpan di NVS ESP32 (survive reboot) dan dikirim ke cloud jika mode STA aktif.

### 7.2 Layar Pengukuran (Live — menggantikan KTI Gambar 4.6)
- **FR-M1** State machine eksplisit & terlihat: `READY` → `RECORDING` (progress bar 10 sampel) → `WAIT_ZERO` (tunggu flow ≤ 5 L/min) → `READY`.
- **FR-M2** Tampilkan angka besar `XXX,X L/min` (system font) + di bawahnya `% prediksi` + `zona`.
- **FR-M3** Zona: Hijau ≥80% · Kuning 60–79% · Merah <60% (GINA 2024).
- **FR-M4** Selama `RECORDING`, tampilkan progress bar minimalis (10 tick, 200ms/tick).
- **FR-M5** Setelah selesai: tampilkan kartu ringkasan — best of session, delta vs personal best, delta vs sesi sebelumnya.
- **FR-M6** Tombol "Ukur Lagi" dan "Cetak" sejajar. Cetak minta konfirmasi (mencegah pemborosan kertas thermal).
- **FR-M7** Watchdog: jika ESP32 tidak update dalam 3 detik → banner `Alat tidak merespon`.

### 7.3 Riwayat & Tren (Baru — tidak ada di KTI)
- **FR-H1** Ring buffer 20 sesi terakhir disimpan di SPIFFS. Setiap sesi: timestamp, nilai, % prediksi, zona, 10 raw sample.
- **FR-H2** Grafik tren 7/14/30 hari (SVG murni, tanpa library > 5 KB).
- **FR-H3** Kalender heatmap mini: 30 kotak, warna = zona terbaik hari itu.
- **FR-H4** Tap sesi → modal detail: 10 raw sample dalam sparkline + tombol "Cetak ulang".
- **FR-H5** Ekspor CSV via `GET /export.csv?session=all`.

### 7.4 Cetak (menggantikan `printReport()` di KTI Lampiran hal. 72)
- **FR-C1** Format struk thermal (lebar 57,5 mm / 32 char):
  ```text
  ── PEAKFLOW ──
  Nama    : Yoganata
  Usia    : 21 th (M)
  Tinggi  : 170 cm
  ──
  PEF     : 641.7 L/min
  Prediksi: 672.0 L/min
  Zona    : HIJAU (95.5%)
  ──
  [grafik ASCII 1000→0 step 50]
  ──
  Semarang, 7 Apr 2026 14:32
  ```
- **FR-C2** Grafik ASCII wajib dirender server-side (fungsi murni agar bisa diuji).
- **FR-C3** Endpoint `POST /print` mengembalikan 202 dan memicu `flagPrintReport`. Status cetak dipoll di `/print-status` (`idle|printing|done|error`).
- **FR-C4** Jika printer tidak terdeteksi (heartbeat UART), tampilkan error sebelum kirim.

### 7.5 Hardware Status (menggantikan `currentStatusStr`)
- **FR-HW1** Status human-readable: `Menunggu`, `Siap`, `Mengukur`, `Tunggu embusan berikutnya`, `Selesai`, `Printer tidak terhubung`, `Baterai lemah`.
- **FR-HW2** Baterai: baca ADC, tampilkan ikon baterai + % (threshold: < 20% → peringatan).
- **FR-HW3** Signal: jika mode STA, tampilkan kualitas WiFi (0–4 bar).
- **FR-HW4** Firmware version di footer.

### 7.6 Mode STA (Cloud Sync) — Fase B
- **FR-S1** Jika tersimpan SSID/password di NVS, ESP32 otomatis coba STA saat boot. Fallback ke SoftAP jika gagal (timeout 10 detik).
- **FR-S2** Kirim POST ke `https://api.tastikessemarang.com/v1/sessions`.
- **FR-S3** Retry 3× dengan backoff, lalu simpan di SPIFFS sebagai queue (max 20 sesi).

---

## 8. Non-Functional Requirements

| Kategori | Requirement | Justifikasi (KTI) |
|---|---|---|
| Firmware size | ≤ 1,4 MB (dari 4 MB flash) | Harus muat HTML PROGMEM + library |
| HTML gzip | ≤ 15 KB | AsyncWebServer memakai PROGMEM |
| Cold boot → ready | ≤ 3 detik | KTI §4.2 prosedur operasional |
| End-to-end latency | ≤ 700 ms (polling 400ms + render) | KTI §3.12.2 |
| Akurasi | error ≤ 2% vs Rossmax PF-120 | KTI §4.6 (0,4–1,8%) |
| Waktu pakai baterai | ≥ 4 jam aktif | 18650 1800mAh (KTI §2.2.7) |
| Aksesibilitas | WCAG 2.2 AA | Standar wajib |
| Privasi | UU PDP 27/2022 — consent + enkripsi | Data kesehatan |
| Browser | 2 versi terakhir Chrome/Edge/Safari/Firefox + Safari iOS | Jangkauan |

---

## 9. Data Model

```sql
patient_records (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  gender        CHAR(1)      NOT NULL,
  age           INT          NOT NULL,
  height        DECIMAL(5,1) NOT NULL,
  peak_flow     DECIMAL(5,1) DEFAULT 0.0,
  status        VARCHAR(20)  DEFAULT 'READY',
  is_active     TINYINT      DEFAULT 1,
  timestamp     TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
);

sessions (
  id             BIGINT AUTO_INCREMENT PRIMARY KEY,
  patient_id     INT NOT NULL REFERENCES patient_records(id),
  device_id      VARCHAR(32),
  started_at     TIMESTAMP,
  ended_at       TIMESTAMP,
  best_peak_flow DECIMAL(5,1),
  predicted_pef  DECIMAL(5,1),
  pct_predicted  DECIMAL(5,1),
  zone           ENUM('green','yellow','red'),
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

readings (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  session_id   BIGINT NOT NULL REFERENCES sessions(id),
  sample_index TINYINT NOT NULL,
  value_lpm    DECIMAL(6,1) NOT NULL,
  taken_at     TIMESTAMP
);
```

---

## 10. API Contract

| Method | Path | Request | Response | Perubahan dari KTI |
|---|---|---|---|---|
| `GET` | `/` | — | HTML | Diperbarui (Apple-style) |
| `POST` | `/submit` | form: `name, gender, age, height` | `200 "Data tersimpan"` | + validasi server-side |
| `GET` | `/get-data` | — | `{name, gender, age, height, peak, predicted, zone, status, battery, session_id}` | FIX bug: field benar |
| `POST` | `/print` | `{session_id}` | `202 {print_id}` | + print tracking |
| `GET` | `/print-status` | — | `{state, error?}` | Baru |
| `GET` | `/sessions` | `?limit=20` | `[{session}]` | Baru |
| `GET` | `/export.csv` | `?from=&to=` | CSV | Baru |
| `POST` | `/config` | `{calibration_factor}` | `200` | Baru (khusus operator) |
| `GET` | `/version` | — | `{firmware, build_date}` | Baru |

---

## 11. Design System — Apple-Style

- **Prinsip:** Edge-friendly. Medical-clear. Silent.
- **Tipografi:** `-apple-system, "SF Pro Text", "SF Pro Display", system-ui, sans-serif`. Skala: `11 / 13 / 15 / 17 / 22 / 28 / 48 / 64` px. Weight: `400`, `600`, `700`. Letter-spacing `-0.02em` untuk angka besar.
- **Warna:** Base `#FFFFFF`, `#F5F5F7`, `#1D1D1F`, `#6E6E73`, `#D2D2D7`. Aksen tunggal `#0071E3`. Status klinis: Hijau `#34C759`, Kuning `#FF9F0A`, Merah `#FF3B30`.
- **Spasi & Layout:** 8pt grid, max-width `720px` (mobile) / `980px` (desktop), whitespace minimal `32px` antar section. Radius: `8` (input), `12` (card), `18` (modal), `980` (pill button).
- **Motion:** `cubic-bezier(0.4, 0, 0.2, 1)`, `200ms` transisi state, `400ms` modal.

---

## 12. Acceptance Criteria (Fase A)

- [x] Bug `/get-data` fix: `GET` mengembalikan `name`, `gender`, `age`, `height` sesuai input (bukan semua `userName`).
- [x] `CALIBRATION_FACTOR = 1.5` didefinisikan satu kali di config. Grep tidak menemukan `1.8` di kode produksi.
- [x] Zona: `641.7 L/min` pada pria 21 th/170 cm → predicted `672.0` → `95,5%` → `HIJAU`. Unit test lulus.
- [x] Recording 10 sampel: progress bar bergerak dari 0 ke 10 dalam ≤ 2,2 detik.
- [x] Pindah dari `READY` ke `RECORDING` dalam ≤ 300 ms setelah flow > 5 L/min.
- [x] Print via web menghasilkan struk sesuai template FR-C1, tercetak < 10 detik.
- [x] Riwayat 20 sesi bertahan setelah reboot (SPIFFS / localStorage persistence).
- [x] Ekspor CSV berisi ≥ 20 baris dengan kolom lengkap.
- [x] Lighthouse mobile: Performance ≥ 85, Accessibility ≥ 95.
- [x] Tidak ada hex hardcode di CSS (semua CSS var di `:root`).
- [x] Berjalan sempurna dengan WiFi internet dimatikan (SoftAP only / zero external dependency).

---

## 13. Roadmap

| Fase | Durasi | Deliverable Utama | Milestone |
|---|---|---|---|
| A0 — Audit & Fix | 1 minggu | Bug `/get-data`, kalibrasi, config | Rilis firmware 1.0.1 |
| A1 — Edge UI | 2 minggu | Redesign form + layar ukur + riwayat lokal | Rilis firmware 1.1.0 (Apple-style) |
| A2 — Cetak & Ekspor | 1 minggu | Template struk + CSV | Rilis firmware 1.2.0 |
| A3 — Uji Akurasi Ulang | 1 minggu | Bandingkan vs Rossmax PF-120 (protokol KTI §4.6) | Laporan uji |
| B1 — Cloud Backend | 3 minggu | API + auth + sync | Cloud staging |
| B2 — Dashboard Klinisi | 2 minggu | Tren 7/30/90, catatan, ekspor PDF | Cloud beta |
| B3 — Beta Tertutup | 2 minggu | 1 klinik / 1 lab STIKES | Umpan balik |
| v1.0 Launch | 1 minggu | Publik terbatas | Rilis produksi |

---

## 14. Aturan Pengembangan

Lihat implementasi pada `index.html`, `src/peakflow-core.js`, dan `tests/verify-acceptance.mjs`.

---

## 15. Kontrak dengan Sumber (KTI)

| Hal | Nilai | Rujukan KTI |
|---|---|---|
| Sensor | FS300A G3/4 | §2.2.6, §3.3 |
| Mikrokontroler | ESP32 DevKitC V4 | §2.2.3 |
| Display lokal | OLED SH1107 1.3" 128×128 I2C | Lampiran hal. 67 |
| Printer | BT-2, 57,5 mm, 19200 baud, UART pin 16/17 | Lampiran hal. 67 |
| Protokol sensor | Falling-edge interrupt, pulse count / interval / factor | §3.12.2 |
| Interval sampling | 200 ms | §3.12.2 |
| Sampel per sesi | 10 (2 detik) | §3.12.2 |
| Threshold mulai | 5 L/min | §3.12.2 |
| Format struk | "PEAKFLOW" + grafik ASCII 1000→0 step 50 | Lampiran hal. 72 & FR-C1 |
| Standar klinis | GINA 2024 zona 80/60 | §2.2.2 |

---

## 16. Risiko & Mitigasi

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Hardware tidak stabil (sensor/printer) | Pengukuran gagal | Watchdog, retry, status human-readable |
| Data medis bocor | Pelanggaran UU PDP | Enkripsi, audit log, peringatan cetak struk |
| Desain jatuh ke "AI slop" | Kehilangan kepercayaan | Design review checklist (§11.7) wajib |
| Kalibrasi tidak konsisten | Data tidak valid | Kunci `CALIBRATION_FACTOR = 1.5`, unit test |
| Regresi bug `/get-data` | Data pasien salah | Integration test mem-assert setiap field |

---

## 17. Lampiran — Fixture Uji (dari KTI §4.6)

### Kasus 1 — Pasien Normal (Yoganata, Gambar 4.6)
```json
{
  "profile": { "name": "Yoganata", "sex": "M", "age": 21, "height_cm": 170 },
  "reading": { "best_lpm": 641.7 },
  "expected": {
    "predicted_lpm": 672.0,
    "pct_predicted": 95.5,
    "zone": "green"
  }
}
```

### Kasus 2 — Pasien Tidak Normal (Marsel, Tabel 4.8)
```json
{
  "profile": { "name": "Marsel", "sex": "M", "age": 21, "height_cm": 170 },
  "reading": { "best_lpm": 250.0 },
  "expected": {
    "predicted_lpm": 672.0,
    "pct_predicted": 37.2,
    "zone": "red"
  }
}
```

### Kasus 3 — Pasien Wanita (Sekar, Tabel 4.8)
```json
{
  "profile": { "name": "Sekar", "sex": "F", "age": 20, "height_cm": 160 },
  "reading": { "best_lpm": 419.0 },
  "expected": {
    "predicted_lpm": 440.0,
    "pct_predicted": 95.2,
    "zone": "green"
  }
}
```

