# 🫁 PeakFlow Respiratory Portal (v2.0.0 — Final Production)

> **Prinsip Inti:** *Alat adalah sumber data utama. Web murni penampil kiriman alat.*  
> Web hanya menerima dan menampilkan data yang dikirimkan langsung oleh alat fisik ESP32. Tidak ada rumus perhitungan baru di sisi web.  
> **Status:** **PURE CLEAN PRODUCTION** — Tanpa Data Dummy, Tanpa Data Percobaan Masa Lalu, Murni Data Pengukuran Baru.

Dokumen ini adalah realisasi produk final dari **Karya Tulis Ilmiah (KTI) Yoganata Firman Maulana — Rancang Bangun Peak Flow Meter untuk Deteksi Penderita Asma Berbasis IoT dengan Output Print Thermal (STIKES Semarang, 2026)**.

---

## 📋 Daftar Isi
1. [Arsitektur Sistem (ESP32 + Node.js)](#-arsitektur-sistem)
2. [Spesifikasi Hardware & Pinout](#-spesifikasi-hardware--pinout)
3. [Cara Menjalankan Server Node.js](#-cara-menjalankan-server-nodejs)
4. [Firmware ESP32 (Arduino IDE)](#-firmware-esp32-arduino-ide)
5. [Kontrak REST API Server](#-kontrak-rest-api-server)
6. [Standar Medis & Rumus Prediksi](#-standar-medis--rumus-prediksi)
7. [Verifikasi & Pengujian Otomatis](#-verifikasi--pengujian-otomatis)

---

## 🏗 Arsitektur Sistem

Sistem beroperasi dalam mode terhubung (Mode Station / STA):

```
+-------------------------------------------------------------+
|                     ALAT PEAKFLOW (ESP32)                   |
|  - Sensor FS300A (GPIO 15)                                  |
|  - Printer Thermal BT-2 (UART2 Pin 16/17 @ 19200 baud)       |
|  - OLED SH1107 1.3" 128x64 (I2C SDA=21, SCL=22)             |
|  - Terhubung ke WiFi Klinik/Rumah                           |
+-------------------------------------------------------------+
                              │
                              ▼ (HTTP POST /update-test tiap embusan)
+-------------------------------------------------------------+
|                SERVER NODE.JS (server.mjs)                  |
|  - Native HTTP Engine (Port 3000)                           |
|  - Zero External NPM Dependencies                           |
|  - Database Embedded SQLite (data/peakflow.db)              |
|  - Menyimpan Histori Multi-Pasien & Multi-Sesi Real         |
+-------------------------------------------------------------+
                              ▲
                              │ (Polling HTTP GET tiap 400 ms)
+-------------------------------------------------------------+
|             PORTAL WEB APPLE-STYLE (index.html)             |
|  - Akses via: http://localhost:3000                         |
|  - Pure Clean State (Tanpa Data Dummy)                      |
|  - Grafik Tren SVG Interaktif, Kalender 30 Hari & Struk     |
+-------------------------------------------------------------+
```

---

## 🔌 Spesifikasi Hardware & Pinout

Mengikuti spesifikasi final KTI Bab III & Lampiran:

| Komponen | Spesifikasi Teknis | Antarmuka ESP32 | Keterangan |
|---|---|---|---|
| **Mikrokontroler** | ESP32 DevKitC V4 (Xtensa Dual-Core 240 MHz) | Onboard | NVS + WiFi Station Mode |
| **Sensor Aliran Udara** | FS300A G3/4 (Hall-effect flow sensor) | **GPIO 15** (Input Pulsa) | Faktor Kalibrasi: `1.5` (`(pulsa/0.2)/1.5`) |
| **Printer Thermal** | BT-2 Mini Thermal Printer (57.5 mm, 384 dots) | **UART2: Pin 16 (RX2), Pin 17 (TX2)** | Baud rate: `19200` bps |
| **Display Alat** | OLED SH1107 1.3" (128×64) | **I2C: Pin 21 (SDA), Pin 22 (SCL)** | Alamat I2C: `0x3C` |
| **Indikator Fisik** | LED 2-Warna / Onboard RGB | **GPIO 2** | Indikator status alat |
| **Catu Daya** | 2× Baterai Lithium 18650 + BMS + Step-Up LM2596 | 5V DC ke VIN & Thermal | ADC Pin 34 (Sensor tegangan baterai) |

---

## 🚀 Cara Menjalankan Server Node.js

Server menggunakan runtime bawaan Node.js tanpa perlu mengunduh library luar (`zero npm install`):

```bash
# 1. Jalankan server produksi
npm start
# atau
node server.mjs
```

Setelah server aktif, buka peramban ke:  
👉 **`http://localhost:3000`**

### Status Awal Murni (*Clean Slate*):
* **Pasien:** Menunggu pendaftaran pasien baru (Klik tombol **Daftar Pasien**).
* **Nilai PEF:** `0,0 L/min` (Menunggu embusan napas pertama).
* **Riwayat:** Bersih tanpa histori palsu / percobaan masa lalu.

---

## 💻 Firmware ESP32 (Arduino IDE)

Berkas firmware perangkat keras tersedia di:  
📁 **[`firmware/PeakFlow_Firmware.ino`](file:///d:/WEB/tugas%20akhir/firmware/PeakFlow_Firmware.ino)**

### Panduan Upload Firmware:
1. Buka berkas `firmware/PeakFlow_Firmware.ino` menggunakan **Arduino IDE**.
2. Pasang library yang dibutuhkan via Library Manager:
   - `Adafruit SH110X`
   - `Adafruit GFX Library`
   - `ArduinoJson` (v6 / v7)
3. Sesuaikan konstanta jaringan pada baris 53:
   ```cpp
   const char* WIFI_SSID     = "NAMA_WIFI_ANDA";
   const char* WIFI_PASSWORD = "PASSWORD_WIFI";
   const char* SERVER_BASE   = "http://IP_KOMPUTER_ANDA:3000";
   ```
4. Pilih Board: **ESP32 Dev Module**, lalu klik **Upload**.
5. Alat akan otomatis terhubung ke WiFi dan siap mengirimkan data secara *real-time*.

---

## 🌐 Kontrak REST API Server

| Method | Endpoint | Fungsi | Payload / Respon |
|---|---|---|---|
| `GET` | `/` | Antarmuka web Apple-Style | HTML5 lengkap (< 15 KB gzip) |
| `GET` | `/get-data` | Telemetri live & status alat (polling tiap 400 ms) | Respon JSON profil pasien aktif, status embusan, baterai |
| `POST` | `/submit` | Mendaftarkan pasien nyata baru | JSON: `{"name":"...","gender":"M"|"F","age":24,"height":172}` |
| `POST` | `/update-test` | Menerima data embusan dari ESP32 | JSON: `{"peak_flow":641.7,"samples":[...],"sample_index":10}` |
| `GET` | `/sessions` | Mengambil seluruh rekaman sesi nyata | JSON riwayat sesi terurut waktu terbaru |
| `POST` | `/print` | Memicu pencetakan struk dari web | JSON: `{"status":"success"}` |
| `GET` | `/check-print` | Dipoll oleh ESP32 untuk deteksi cetak | JSON: `{"print":true|false}` |
| `GET` | `/export.csv` | Mengunduh file CSV seluruh rekaman sesi | File teks `text/csv` berisi 10 sampel mentah per baris |

> **Catatan Kompatibilitas:** Server juga mendukung format query lama dari KTI (misalnya `/api.php?action=get_active` dan `/api.php?action=update_test`).

---

## 🩺 Standar Medis & Rumus Prediksi

### 1. Klasifikasi 3-Zona GINA 2024
- 🟢 **Zona Hijau (≥ 80% prediksi):** Fungsi jalan napas baik. Lanjutkan pemantauan rutin.
- 🟡 **Zona Kuning (60–79.9% prediksi):** Penyempitan napas ringan-sedang. Evaluasi rencana aksi asma.
- 🔴 **Zona Merah (< 60% prediksi):** Penyempitan berat / peringatan bahaya darurat medis.

### 2. Formula Prediksi PEF Normal (Knudson et al., 1983)
Menggunakan tinggi badan dan usia pasien sesuai rekomendasi KTI §5.2:
- **Laki-laki (M):**  
  $$\text{PEF Prediksi (L/min)} = 5.6 \times \text{Tinggi (cm)} - 2.0 \times \text{Usia (th)} - 238.0$$
- **Perempuan (F):**  
  $$\text{PEF Prediksi (L/min)} = 4.0 \times \text{Tinggi (cm)} - 1.5 \times \text{Usia (th)} - 170.0$$

---

## 🧪 Verifikasi & Pengujian Otomatis

Seluruh logika klinis, batas ukuran, dan server Node.js diuji secara otomatis:

```bash
# Uji Kriteria Klinis, Kalibrasi & Aturan CSS:
npm test

# Uji Server Node.js & Alur API:
node tests/test-server.mjs
```

### Ringkasan Hasil Pengujian:
- ✅ `PASS` Faktor Kalibrasi terkunci ke `1.5` dan angka inkonsisten `1.8` bersih dari kode produksi.
- ✅ `PASS` Formula Knudson 1983 & Batas Zona GINA 2024 terverifikasi 100%.
- ✅ `PASS` Validasi formulir pasien (nama ≤ 50 karakter, usia 18–80, tinggi 120–220 cm).
- ✅ `PASS` Struk thermal BT-2 patuh batas 32 karakter dan grafik ASCII `1000 → 0 step 50`.
- ✅ `PASS` Perbaikan bug `/get-data` (field nama, gender, usia, tinggi terpisah).
- ✅ `PASS` Server Node.js siap melayani ESP32 dan Web Portal dengan data murni baru.
- ✅ `PASS` Anggaran ukuran gzip ESP32 terpenuhi (< 15 KB HTML, < 8 KB JS).
