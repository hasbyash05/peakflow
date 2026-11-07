/**
 * =============================================================================
 * PeakFlow Respiratory Meter — ESP32 Firmware v2.0.0 (FINAL PRODUCTION)
 * Rancang Bangun Peak Flow Meter untuk Deteksi Penderita Asma Berbasis IoT
 * dengan Output Print Thermal
 * 
 * Target Hardware: ESP32 DevKitC V4
 * Sensor: FS300A G3/4 Hall-Effect (GPIO 15)
 * Printer: BT-2 Mini Thermal Printer (UART2: GPIO 16 RX, GPIO 17 TX @ 19200 baud)
 * Display: OLED SH1107 1.3" 128x64 (I2C: GPIO 21 SDA, GPIO 22 SCL)
 * Indikator: Status LED Onboard (GPIO 2)
 * Baterai: Sensor Tegangan Baterai 18650 (ADC GPIO 34)
 * 
 * Target Server: Node.js Server (http://domain-atau-ip:3000/update-test)
 * Standar Medis: GINA 2024 (3 Zona) & Knudson 1983 (dengan Tinggi Badan)
 * Kalibrasi: CALIBRATION_FACTOR = 1.5 (Terkunci Sesuai KTI §3.12.2)
 * Status: PURE CLEAN — Tanpa Data Dummy / Murni Data Baru
 * =============================================================================
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SH110X.h>

// -----------------------------------------------------------------------------
// KONFIGURASI PIN HARDWARE (KTI Bab III & Lampiran)
// -----------------------------------------------------------------------------
#define PIN_FLOW_SENSOR    15   // FS300A Interrupt Input
#define PIN_STATUS_LED     2    // Status LED Onboard
#define PIN_BATTERY_ADC    34   // Pembaca tegangan baterai 18650
#define PIN_PRINTER_RX     16   // UART2 RX (ke TX Printer)
#define PIN_PRINTER_TX     17   // UART2 TX (ke RX Printer)

// Konfigurasi Printer Thermal BT-2
#define PRINTER_BAUD_RATE  19200
HardwareSerial PrinterSerial(2);

// Konfigurasi Display OLED SH1107 128x64 I2C (Alamat 0x3C)
#define OLED_ADDR          0x3C
Adafruit_SH1107 display(64, 128, &Wire);

// -----------------------------------------------------------------------------
// KONFIGURASI JARINGAN & SERVER NODE.JS (MENDUKUNG DOMAIN MAUPUN IP)
// -----------------------------------------------------------------------------
// Contoh pengiriman ke domain web publik (HTTPS atau HTTP):
//   const char* SERVER_BASE = "https://tastikessemarang.com/peakflow";
// Contoh pengiriman ke server Node.js lokal di jaringan Wi-Fi:
//   const char* SERVER_BASE = "http://192.168.1.50:3000";
const char* WIFI_SSID     = "NAMA_WIFI_ANDA";     // Ganti dengan SSID WiFi/Hotspot Anda
const char* WIFI_PASSWORD = "PASSWORD_WIFI";      // Ganti dengan Password WiFi Anda
const char* SERVER_BASE   = "http://192.168.1.50:3000"; // Ganti dengan Domain atau IP Server Node.js Anda

// Mode Cadangan SoftAP (Jika WiFi Luar Tidak Terhubung)
const char* AP_SSID       = "PeakFlowWeb";
const char* AP_PASSWORD   = "12345678";

// -----------------------------------------------------------------------------
// PARAMETER KALIBRASI & MEDIS (KTI §3.12.2, GINA 2024, Knudson 1983)
// -----------------------------------------------------------------------------
#define CALIBRATION_FACTOR 1.5  // Formula KTI §3.12.2: (pulsa / 0.2) / 1.5
const float FLOW_START_THRESHOLD = 5.0; // Minimal 5.0 L/min untuk mulai record
const int   SAMPLE_COUNT         = 10;  // 10 sampel
const int   SAMPLE_INTERVAL_MS   = 200; // 200 ms per sampel (Total 2,0 detik)

// -----------------------------------------------------------------------------
// STRUKTUR DATA STATE & PASIEN (MURNI BERSIH TANPA DATA DUMMY)
// -----------------------------------------------------------------------------
enum DeviceState {
  STATE_IDLE,
  STATE_RECORDING,
  STATE_WAIT_ZERO,
  STATE_PRINTING
};

DeviceState currentState = STATE_IDLE;

struct PatientProfile {
  String name = "";
  char   gender = 'M';
  int    age = 0;
  float  height = 0.0;
  bool   isRegistered = false;
} currentPatient;

volatile unsigned long pulseCounter = 0;
float samples[SAMPLE_COUNT];
int   sampleIdx = 0;
float currentPeak = 0.0;
unsigned long lastSampleTime = 0;
unsigned long lastServerPoll = 0;

// Interrupt Service Routine untuk Sensor Aliran FS300A
void IRAM_ATTR onFlowSensorPulse() {
  pulseCounter++;
}

// -----------------------------------------------------------------------------
// FUNGSI PERHITUNGAN MEDIS
// -----------------------------------------------------------------------------
float computePredictedPEF(int age, char gender, float heightCm) {
  if (age <= 0 || heightCm <= 0) return 0.0;
  if (gender == 'F' || gender == 'f') {
    return max(100.0, 4.0 * heightCm - 1.5 * (float)age - 170.0);
  } else {
    return max(100.0, 5.6 * heightCm - 2.0 * (float)age - 238.0);
  }
}

String classifyZone(float pef, float predicted) {
  if (predicted <= 0.0 || pef <= 0.0) return "NEUTRAL";
  float pct = (pef / predicted) * 100.0;
  if (pct >= 80.0) return "HIJAU";
  if (pct >= 60.0) return "KUNING";
  return "MERAH";
}

int readBatteryPercent() {
  int raw = analogRead(PIN_BATTERY_ADC);
  float voltage = (raw / 4095.0) * 2.0 * 3.3 * 1.05; // Voltage divider
  int pct = (int)((voltage - 3.2) / (4.2 - 3.2) * 100.0);
  return constrain(pct, 0, 100);
}

// -----------------------------------------------------------------------------
// PENGIRIMAN DATA KE SERVER NODE.JS (DOMAIN MAUPUN IP · HTTP MAUPUN HTTPS)
// -----------------------------------------------------------------------------
void sendTestToServer(float peak, float samplesArr[], int sampleCount) {
  if (WiFi.status() != WL_CONNECTED) return;

  HTTPClient http;
  WiFiClient client;
  WiFiClientSecure secureClient;
  String url = String(SERVER_BASE) + "/update-test";

  if (url.startsWith("https://")) {
    secureClient.setInsecure(); // Mengizinkan HTTPS ke domain publik
    http.begin(secureClient, url);
  } else {
    http.begin(client, url);
  }

  http.addHeader("Content-Type", "application/json");

  float pred = computePredictedPEF(currentPatient.age, currentPatient.gender, currentPatient.height);
  String zoneStr = classifyZone(peak, pred);
  float pct = pred > 0 ? (peak / pred) * 100.0 : 0.0;
  String flowStatus = (pct >= 80.0 || (pred == 0.0 && peak >= 400.0)) ? "normal" : "tidak normal";

  StaticJsonDocument<512> doc;
  doc["peak_flow"] = peak;
  doc["flow_status"] = flowStatus;
  doc["predicted"] = pred;
  doc["pct_predicted"] = pct;
  doc["zone"] = (zoneStr == "HIJAU") ? "green" : ((zoneStr == "KUNING") ? "yellow" : "red");
  doc["sample_index"] = sampleCount;
  doc["state"] = "IDLE";
  doc["battery"] = readBatteryPercent();
  doc["printer_ok"] = 1;

  JsonArray sArr = doc.createNestedArray("samples");
  for (int i = 0; i < sampleCount; i++) {
    sArr.add(samplesArr[i]);
  }

  String payload;
  serializeJson(doc, payload);
  int httpCode = http.POST(payload);
  http.end();
}

void pollServerState() {
  if (WiFi.status() != WL_CONNECTED) return;

  // 1. Ambil data pasien aktif
  HTTPClient http;
  WiFiClient client;
  WiFiClientSecure secureClient;
  String urlGet = String(SERVER_BASE) + "/get-data";

  if (urlGet.startsWith("https://")) {
    secureClient.setInsecure();
    http.begin(secureClient, urlGet);
  } else {
    http.begin(client, urlGet);
  }

  int httpCode = http.GET();
  if (httpCode == HTTP_CODE_OK) {
    String resp = http.getString();
    DynamicJsonDocument doc(1024);
    deserializeJson(doc, resp);

    if (doc["has_patient"] == true) {
      currentPatient.name = doc["name"].as<String>();
      String g = doc["gender"].as<String>();
      currentPatient.gender = g.length() > 0 ? g[0] : 'M';
      currentPatient.age = doc["age"].as<int>();
      currentPatient.height = doc["height"].as<float>();
      currentPatient.isRegistered = true;
    } else {
      currentPatient.isRegistered = false;
      currentPatient.name = "";
    }
  }
  http.end();

  // 2. Cek perintah cetak struk dari web
  HTTPClient httpPrint;
  WiFiClient clientP;
  WiFiClientSecure secureClientP;
  String urlPrint = String(SERVER_BASE) + "/check-print";

  if (urlPrint.startsWith("https://")) {
    secureClientP.setInsecure();
    httpPrint.begin(secureClientP, urlPrint);
  } else {
    httpPrint.begin(clientP, urlPrint);
  }

  int pCode = httpPrint.GET();
  if (pCode == HTTP_CODE_OK) {
    DynamicJsonDocument pDoc(128);
    deserializeJson(pDoc, httpPrint.getString());
    if (pDoc["print"] == true && currentPeak > 0.0) {
      printThermalReceipt();
    }
  }
  httpPrint.end();
}

// -----------------------------------------------------------------------------
// PENCETAKAN STRUK THERMAL BT-2 (57.5 mm · 32 Karakter)
// -----------------------------------------------------------------------------
void printThermalReceipt() {
  digitalWrite(PIN_STATUS_LED, HIGH);
  PrinterSerial.write(0x1B); PrinterSerial.write(0x40); // ESC @ (Reset Printer)
  PrinterSerial.write(0x1B); PrinterSerial.write(0x61); PrinterSerial.write(0x01); // Center align

  PrinterSerial.println("── PEAKFLOW ──");
  PrinterSerial.println("PORTAL RESPIRATORI");
  PrinterSerial.write(0x1B); PrinterSerial.write(0x61); PrinterSerial.write(0x00); // Left align
  PrinterSerial.println("--------------------------------");

  if (currentPatient.isRegistered) {
    PrinterSerial.printf("Nama    : %s\n", currentPatient.name.c_str());
    PrinterSerial.printf("Usia    : %d th (%c)\n", currentPatient.age, currentPatient.gender);
    PrinterSerial.printf("Tinggi  : %.0f cm\n", currentPatient.height);
  } else {
    PrinterSerial.println("Pasien  : Belum Terdaftar");
  }

  float pred = computePredictedPEF(currentPatient.age, currentPatient.gender, currentPatient.height);
  String zone = classifyZone(currentPeak, pred);
  float pct = pred > 0 ? (currentPeak / pred) * 100.0 : 0.0;

  PrinterSerial.println("--------------------------------");
  PrinterSerial.printf("PEF     : %.1f L/min\n", currentPeak);
  PrinterSerial.printf("Prediksi: %.1f L/min\n", pred);
  PrinterSerial.printf("Zona    : %s (%.1f%%)\n", zone.c_str(), pct);
  PrinterSerial.println("--------------------------------");

  // Grafik ASCII Bar Chart (1000 -> 0 step 50)
  for (int lvl = 1000; lvl >= 50; lvl -= 50) {
    char row[33];
    snprintf(row, sizeof(row), "%4d|", lvl);
    for (int i = 0; i < SAMPLE_COUNT; i++) {
      strcat(row, (samples[i] >= lvl) ? " *" : "  ");
    }
    PrinterSerial.println(row);
  }
  PrinterSerial.println("   0+--------------------");
  PrinterSerial.println("      1 2 3 4 5 6 7 8 9 0");
  PrinterSerial.println("--------------------------------");
  PrinterSerial.println("Semarang (WIB)");
  PrinterSerial.println("\n\n\n"); // Feed paper

  digitalWrite(PIN_STATUS_LED, LOW);
}

// -----------------------------------------------------------------------------
// UPDATE TAMPILAN OLED SH1107 (128x64)
// -----------------------------------------------------------------------------
void updateOLED() {
  display.clearDisplay();
  display.setTextColor(SH110X_WHITE);
  display.setTextSize(1);
  display.setCursor(0, 0);

  display.print("PEAKFLOW  Bat:");
  display.print(readBatteryPercent());
  display.println("%");
  display.println("---------------------");

  if (currentState == STATE_RECORDING) {
    display.setTextSize(2);
    display.setCursor(0, 16);
    display.print("MENGUKUR");
    display.setTextSize(1);
    display.setCursor(0, 38);
    display.printf("Sampel %d/10...", sampleIdx);
    display.drawRect(0, 50, 128, 8, SH110X_WHITE);
    display.fillRect(2, 52, (sampleIdx * 124) / 10, 4, SH110X_WHITE);
  } else if (currentState == STATE_WAIT_ZERO) {
    display.setTextSize(1);
    display.setCursor(0, 20);
    display.println("Lepas Embusan...");
    display.printf("PEF: %.1f L/min\n", currentPeak);
  } else {
    if (currentPatient.isRegistered) {
      display.printf("Pasien: %s\n", currentPatient.name.c_str());
    } else {
      display.println("Pasien: Belum Ada");
    }

    display.setTextSize(2);
    display.setCursor(0, 28);
    display.printf("%.1f", currentPeak);
    display.setTextSize(1);
    display.println(" L/m");

    float pred = computePredictedPEF(currentPatient.age, currentPatient.gender, currentPatient.height);
    display.setCursor(0, 52);
    display.printf("Zona: %s", classifyZone(currentPeak, pred).c_str());
  }

  display.display();
}

// -----------------------------------------------------------------------------
// SETUP & INITIALIZATION
// -----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  PrinterSerial.begin(PRINTER_BAUD_RATE, SERIAL_8N1, PIN_PRINTER_RX, PIN_PRINTER_TX);

  pinMode(PIN_FLOW_SENSOR, INPUT_PULLUP);
  pinMode(PIN_STATUS_LED, OUTPUT);
  pinMode(PIN_BATTERY_ADC, INPUT);
  attachInterrupt(digitalPinToInterrupt(PIN_FLOW_SENSOR), onFlowSensorPulse, RISING);

  // Inisialisasi OLED SH1107
  display.begin(OLED_ADDR, true);
  display.display();
  delay(500);

  // Sambungkan ke WiFi untuk kirim data ke Server Node.js
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long startAttempt = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - startAttempt < 8000) {
    delay(500);
    digitalWrite(PIN_STATUS_LED, !digitalRead(PIN_STATUS_LED));
  }

  if (WiFi.status() != WL_CONNECTED) {
    // Fallback ke SoftAP jika WiFi tidak terdeteksi
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
  }

  digitalWrite(PIN_STATUS_LED, LOW);
  updateOLED();
}

// -----------------------------------------------------------------------------
// MAIN LOOP
// -----------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  // 1. Hitung Flow Rate saat ini (L/min) dengan CALIBRATION_FACTOR 1.5
  if (now - lastSampleTime >= SAMPLE_INTERVAL_MS) {
    unsigned long dt = now - lastSampleTime;
    lastSampleTime = now;

    noInterrupts();
    unsigned long pulses = pulseCounter;
    pulseCounter = 0;
    interrupts();

    float dtSec = (float)dt / 1000.0;
    float currentFlow = (dtSec > 0) ? ((float)pulses / dtSec) / CALIBRATION_FACTOR : 0.0;

    // Mesin Status Pengukuran (State Machine)
    if (currentState == STATE_IDLE) {
      if (currentFlow >= FLOW_START_THRESHOLD) {
        currentState = STATE_RECORDING;
        sampleIdx = 0;
        currentPeak = 0.0;
        digitalWrite(PIN_STATUS_LED, HIGH);
      }
    } else if (currentState == STATE_RECORDING) {
      samples[sampleIdx] = currentFlow;
      if (currentFlow > currentPeak) {
        currentPeak = currentFlow;
      }
      sampleIdx++;
      if (sampleIdx >= SAMPLE_COUNT) {
        currentState = STATE_WAIT_ZERO;
      }
    } else if (currentState == STATE_WAIT_ZERO) {
      if (currentFlow <= FLOW_START_THRESHOLD) {
        currentState = STATE_IDLE;
        digitalWrite(PIN_STATUS_LED, LOW);
        // Kirim hasil pengukuran nyata ke Server Node.js
        sendTestToServer(currentPeak, samples, SAMPLE_COUNT);
      }
    }

    updateOLED();
  }

  // 2. Polling status pasien baru & perintah cetak dari server setiap 1,5 detik
  if (now - lastServerPoll >= 1500 && currentState == STATE_IDLE) {
    lastServerPoll = now;
    pollServerState();
  }
}

