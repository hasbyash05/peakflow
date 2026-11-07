-- ==========================================================
-- PeakFlow Respiratory Portal — Database Schema
-- Versi: 2.1.1 (Production Release)
-- Target: MySQL 5.7+ / MariaDB 10.3+ (cPanel phpMyAdmin)
-- ==========================================================

SET NAMES utf8mb4;
SET time_zone = '+07:00';
SET foreign_key_checks = 0;

-- ----------------------------------------------------------
-- 1. Tabel Pasien (patient_records)
-- Sesuai arsitektur KTI & endpoint ESP32
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `patient_records` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(50) NOT NULL COMMENT 'Nama pasien (maks 50 karakter)',
  `gender` ENUM('M', 'F') NOT NULL DEFAULT 'M' COMMENT 'Jenis kelamin (M = Laki-laki, F = Perempuan)',
  `age` INT UNSIGNED NOT NULL COMMENT 'Usia (18-80 tahun)',
  `height` DECIMAL(5, 1) NOT NULL COMMENT 'Tinggi badan dalam cm (120-220)',
  `peak_flow` DECIMAL(6, 1) NOT NULL DEFAULT 0.0 COMMENT 'Nilai PEF terbaik dalam L/min',
  `flow_status` VARCHAR(50) NOT NULL DEFAULT 'Siap' COMMENT 'Status klinis (normal / tidak normal / Siap)',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1 COMMENT '1 = Pasien aktif saat ini, 0 = Nonaktif',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  INDEX `idx_is_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 2. Tabel Riwayat Sesi Pengukuran (sessions)
-- Menyimpan 10 sampel per embusan & metadata klinis GINA
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `session_id` VARCHAR(64) NOT NULL COMMENT 'UUID / ID unik sesi',
  `patient_id` INT UNSIGNED NULL COMMENT 'Relasi ke patient_records.id',
  `name` VARCHAR(50) NOT NULL,
  `gender` ENUM('M', 'F') NOT NULL DEFAULT 'M',
  `age` INT UNSIGNED NOT NULL,
  `height` DECIMAL(5, 1) NOT NULL,
  `best_flow` DECIMAL(6, 1) NOT NULL COMMENT 'Nilai tertinggi dari 10 sampel (L/min)',
  `predicted_flow` DECIMAL(6, 1) NOT NULL COMMENT 'Nilai prediksi Knudson 1983 (L/min)',
  `pct_predicted` DECIMAL(5, 1) NOT NULL COMMENT 'Persentase terhadap prediksi (%)',
  `zone` ENUM('green', 'yellow', 'red', 'neutral') NOT NULL DEFAULT 'neutral' COMMENT 'Zona GINA 2024',
  `samples_json` TEXT NOT NULL COMMENT 'Array JSON 10 sampel (200ms per sampel)',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_session_id` (`session_id`),
  INDEX `idx_patient_id` (`patient_id`),
  INDEX `idx_created_at` (`created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------
-- 3. Tabel Flag Cetak Struk Thermal (print_queue)
-- Sinkronisasi trigger cetak web dengan polling ESP32
-- ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS `print_queue` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `patient_id` INT UNSIGNED NULL,
  `status` ENUM('pending', 'printing', 'done', 'error') NOT NULL DEFAULT 'pending',
  `requested_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `printed_at` TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (`id`),
  INDEX `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
