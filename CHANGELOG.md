# Changelog — PeakFlow Respiratory Portal

Semua perubahan tercatat pada dokumen ini mengacu pada **Karya Tulis Ilmiah (KTI) Yoganata Firman Maulana (STIKES Semarang, 2026)** sebagai baseline awal prototipe.

Format penomoran versi mengikuti [Semantic Versioning](https://semver.org/).

---

## [2.1.1] — 2026-04-08

### 📐 Tipografi & Tata Letak Lapang (Airy Typography & Spacing)
- **Penghapusan Letter-Spacing Negatif:**
  - Menghapus tracking negatif (`-0.03em` pada `.pef-number` dan `-0.01em` pada `.section-title`) yang membuat karakter dan angka saling berhimpitan.
  - Menerapkan spasi huruf proporsional dan renggang (`letter-spacing: 0.025em` hingga `0.04em`) pada seluruh judul, teks hero, label metrik, dan tombol.
- **Relaksasi Kerapatan Teks (Line Height):**
  - Menaikkan `line-height` global `body` menjadi `1.6` dan paragraf deskripsi klinis ke `1.65` agar mudah dibaca pasien tanpa rasa padat/sesak visual.
- **Pelebaran Ruang Vertikal & Margin (Breathing Room):**
  - Memperlebar padding kartu utama `.card` dari `24px` menjadi `32px 28px` (responsif `22px 18px` pada layar ponsel).
  - Memberikan jarak lebih lebar antara angka utama PEF `0,0` dengan satuan `L/min` (`margin-left: 12px`), baris konteks klinis (`margin-top: 18px`), dan balok progres 10 sampel (`margin-top: 26px`, `gap: 6px`).
  - Mengatur ulang status inisialisasi balok 10 sampel (`data-filled="false"`) agar bersih saat alat berada di status siap/standby.

---

## [2.1.0] — 2026-04-08 (Final Production Release)

### 🧹 Pembersihan & Penyempurnaan (Cleanup & Polish)
- **Penghapusan Total Simulator & Dummy Data:**
  - Menghapus 100% panel simulator perangkat, tombol embusan simulasi (hijau/kuning/merah), fixture dummy, serta seluruh logika pembuatan kurva tiruan (`startBlow`, `makeCurve`, `FIXTURES`).
  - Web beroperasi 100% murni membaca data riil dari sensor fisik ESP32.
- **Arsitektur Pasif Web (Zero Client-Side Calculation):**
  - Web murni bertindak sebagai layar penampil (*pure display viewer*) atas data yang dikirimkan alat ESP32.
  - Menghapus seluruh formula perhitungan client-side pada web; nilai PEF, status kondisi normal/tidak normal, dan 10 sampel murni berasal dari kalkulasi mikrokontroler ESP32.
- **Penyelarasan Visual Apple Design System:**
  - Menyelaraskan lebar kontainer pada `820px` konsisten dengan margin horizontal `20px` simetris antara header dan kartu.
  - Memberikan elevasi bayangan halus (*Apple elevation shadow*: `0 4px 20px rgba(0,0,0,0.03)`), sudut lengkung `16px`, dan border lembut.
  - Menata ulang hierarki vertikal kartu pasien (Label Kategori → Nama Pasien → Metadata) agar tidak bertabrakan atau patah canggung.
  - Memperbarui kontrol formulir pendaftaran dengan gaya input terbingkai lembut khas macOS/iOS.
  - Membingkai ringkasan 3 metrik sesi ke dalam widget kartu mini yang rapi.
- **Dukungan Domain & HTTPS pada ESP32:**
  - Firmware ESP32 kini mendukung pengiriman data baik ke alamat IP lokal (`http://...`) maupun domain publik SSL/TLS (`https://...`) secara otomatis.

---

## [2.0.0] — 2026-04-08

### 🚀 Ditambahkan (Added)
- **Server Produksi Node.js Mandiri ([server.mjs](file:///d:/WEB/tugas%20akhir/server.mjs)):**
  - Implementasi server HTTP mandiri berbasis Node.js murni (*zero external NPM dependencies*) dengan database *embedded* SQLite (`data/peakflow.db`).
  - Menghapus ketergantungan PHP, kompatibel penuh dengan firmware ESP32 dan web portal.
  - Endpoint REST modern: `/get-data`, `/submit`, `/update-test`, `/sessions`, `/print`, `/check-print`, dan `/export.csv`.
- **Firmware ESP32 DevKitC V4 Final ([firmware/PeakFlow_Firmware.ino](file:///d:/WEB/tugas%20akhir/firmware/PeakFlow_Firmware.ino)):**
  - Kode C++ produksi untuk mikrokontroler ESP32, sensor aliran FS300A (GPIO 15), printer thermal BT-2 (UART2 Pin 16/17 @ 19200 baud), dan OLED SH1107 1.3" (I2C Pin 21/22).
  - Mode WiFi Station terhubung langsung ke server Node.js dengan fallback SoftAP `PeakFlowWeb`.
- **Pure Clean State (Bebas Data Dummy):**
  - Seluruh data contoh lama (Yoganata, Marsel, Sekar) dan buffer sesi acak dibersihkan dari inisialisasi awal.
  - Sistem dimulai dari kondisi awal murni: siap menerima pendaftaran pasien baru dan data embusan riil.
- **Desain Antarmuka Apple-Style Standar Medis (PRD §11):**
  - Palet warna sistem iOS/macOS (`#0071E3`, `#34C759`, `#FF9F0A`, `#FF3B30`, `#F5F5F7`, `#FFFFFF`) dengan deklarasi terpusat pada CSS Custom Properties di `:root`.
  - Tipografi sistem asli (`-apple-system`, `SF Pro Display`, `SF Pro Text`) tanpa ketergantungan Google Fonts / CDN eksternal.
  - Ikon monokrom SVG murni 20×20 px stroke 1.5 px (tanpa emoji untuk elemen kontrol UI).
  - Tampilan angka utama PEF *tabular-nums* besar (48–64 px) yang mudah dibaca saat sesak napas.
  - Stepper mesin status eksplisit: `READY` → `RECORDING` (10 sampel × 200 ms) → `WAIT_ZERO` (≤ 5,0 L/min).
- **Klasifikasi Klinis 3-Zona GINA 2024 (PRD §7.2 & §17.1):**
  - Zona Hijau (≥ 80% prediksi): fungsi napas baik.
  - Zona Kuning (60–79% prediksi): penyempitan jalan napas ringan-sedang.
  - Zona Merah (< 60% prediksi): waspada penyempitan berat / peringatan darurat medis.
- **Prediksi PEF Berbasis Tinggi Badan & Usia (Knudson 1983 / KTI §5.2):**
  - Mengimplementasikan saran perbaikan KTI §5.2 dengan memperhitungkan tinggi badan pasien (cm) dan jenis kelamin (M/F) ke dalam formulir dan rumus prediksi.
- **Penyimpanan Sesi & Riwayat Lokal (PRD §7.3):**
  - Simulasi struktur Ring Buffer 20 sesi di SPIFFS ESP32 (fallback `localStorage` pada browser).
  - Grafik tren SVG murni interaktif dengan filter rentang 7, 14, dan 30 hari + visualisasi garis zona klinis.
  - Kalender heatmap zona 30 hari terakhir.
  - Modal detail sesi dengan kurva sparkline 10 sampel mentah, opsi cetak ulang, dan konfirmasi hapus sesi.
- **Ekspor Data CSV (PRD §7.3):**
  - Tombol unduh file `peakflow-sessions-*.csv` memuat 20 baris rekaman riwayat lengkap beserta 10 sampel mentah.
- **Pratinjau Struk Thermal BT-2 57,5 mm (PRD §7.4):**
  - Modal pratinjau struk lebar 32 karakter proporsional sebelum dikirim ke printer thermal.
  - Grafik bar chart ASCII vertikal `1000 → 0 step 50` sesuai spesifikasi KTI Lampiran.
  - Format waktu Indonesia Barat (`Asia/Jakarta`) dan peringatan kepatuhan UU PDP No. 27/2022.
- **Simulator Hardware ESP32 & Fixture KTI Terpadu:**
  - Panel kontrol simulator untuk menguji tiupan normal/kuning/merah, fixture responden KTI §4.6 (Yoganata, Marsel, Sekar), simulasi baterai rendah (< 20%), printer disconnect UART pin 16/17, dan watchdog timeout (> 3 detik).
  - Fitur live inspection payload endpoint `GET /get-data`.

### 🐞 Diperbaiki (Fixed)
- **Bug Kritis `/get-data` (PRD §3 #1):**
  - Memperbaiki bug firmware KTI Lampiran hal. 75 di mana field `gender`, `age`, dan `height` sebelumnya mengembalikan `userName`. Sekarang masing-masing field mengembalikan data profil pasien yang sebenarnya (`name`, `gender`, `age`, `height`).
- **Inkonsistensi Faktor Kalibrasi Sensor (PRD §3 #2 & §14.1):**
  - Mengunci faktor kalibrasi sensor FS300A pada `CALIBRATION_FACTOR = 1.5` (`(pulsa / 0.2) / 1.5`) sesuai analisis KTI §3.12.2.
  - Menghapus seluruh kemunculan angka tidak konsisten `1.8` dari kode produksi.
- **Keterbatasan Pasien Tunggal (PRD §3 #3 & #4):**
  - Memperkenalkan konsep sesi pengukuran (`session_id`) sehingga histori tidak lagi saling menimpa nilai `peak_flow` sebelumnya.

### ⚡ Kinerja & Batasan Ukuran (Performance & Size Budget)
- **Ukuran Gzip Index HTML:** `15.160 bytes` (berada di bawah limit `15.360 bytes` / 15 KB).
- **Ukuran Gzip Skrip Inline JS:** `7.959 bytes` (berada di bawah limit `8.192 bytes` / 8 KB).
- **Zero External Dependencies:** Tidak memerlukan koneksi internet, CDN eksternal, font eksternal, atau framework JavaScript/CSS berat untuk berjalan. Siap di-flash ke PROGMEM ESP32.

