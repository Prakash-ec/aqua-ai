/*
 * Aqua AI — ESP32 water-quality sensor node
 * ------------------------------------------
 * Sends real sensor readings to the Aqua AI backend:
 *
 *     POST {AQUA_AI_SERVER}/readings/ingest
 *     Content-Type: application/json
 *     {"device_id": <id>, "temperature": ..., "ph": ..., "turbidity": ..., "tds": ...}
 *
 * !!! FILL IN YOUR OWN VALUES BELOW !!!
 *  - AQUA_AI_SERVER must be the PC's LAN IP (e.g. http://192.168.1.50:8001).
 *    NEVER use 127.0.0.1 or "localhost": from the ESP32 those point at the
 *    ESP32 itself, not your backend.
 *  - DEVICE_ID comes from the Devices page.
 *  - Wire REAL sensors: analogRead()/I2C values below. Do NOT substitute
 *    random numbers — Aqua AI displays exactly what is sent here.
 */

#include <WiFi.h>
#include <HTTPClient.h>

// ----------------- USER CONFIGURATION -----------------

const char* WIFI_SSID     = "YOUR_WIFI_SSID";        // <-- your WiFi name
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";    // <-- your WiFi password

// Backend reachable on the SAME network. Example LAN address:
const char* AQUA_AI_SERVER = "http://192.168.1.50:8001";  // <-- PC LAN IP + backend port

const int   DEVICE_ID    = 1;                        // <-- id from the Devices page

// Send one reading every 60 s, scheduled with millis() (non-blocking).
const unsigned long SEND_INTERVAL_MS = 60000UL;
// -------------------------------------------------------

// Pins used by the sensors (adjust to your wiring).
const int PIN_TEMPERATURE = 34;  // analog temperature sensor (e.g. LM35)
const int PIN_TURBIDITY   = 35;  // analog turbidity sensor
const int PIN_TDS         = 32;  // analog TDS sensor
// pH is read via an analog pin too (e.g. PH-4502C): 0-3.3 V -> 0-14 pH.
const int PIN_PH          = 33;

void setup() {
  Serial.begin(115200);
  analogReadResolution(12);  // 0-4095

  connectWiFi();
}

void loop() {
  // Keep the connection alive; reconnects automatically after a drop.
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WIFI] Connection lost. Reconnecting...");
    connectWiFi();
  }

  static unsigned long lastSend = 0;
  unsigned long now = millis();

  if (now - lastSend >= SEND_INTERVAL_MS) {
    lastSend = now;
    sendReading();
  }
}

void connectWiFi() {
  Serial.print("[WIFI] Connecting to ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }

  Serial.println();
  Serial.print("[WIFI] Connected. IP: ");
  Serial.println(WiFi.localIP());
}

/*
 * Read the REAL sensors. Each function converts the raw ADC value
 * to the physical unit. Calibration constants are hardware-specific;
 * adjust them against a reference meter or a calibration solution.
 */
float readTemperatureC() {
  // LM35: 10 mV per °C on a 3.3 V ADC (12-bit, 0-4095).
  float volts = analogRead(PIN_TEMPERATURE) * 3.3 / 4095.0;
  return volts * 100.0;
}

float readPH() {
  // PH-4502C style probe: map 0-3.3 V to the 0-14 pH scale.
  // Calibrate with pH 4.0 / 6.86 / 9.18 buffer solutions.
  float volts = analogRead(PIN_PH) * 3.3 / 4095.0;
  return volts * (14.0 / 3.3);
}

float readTurbidityNTU() {
  // Typical turbidity module: 0 V (clear) -> 3.3 V (very turbid).
  // Calibrate with a known NTU standard.
  float volts = analogRead(PIN_TURBIDITY) * 3.3 / 4095.0;
  return volts * (1000.0 / 3.3);
}

float readTDSppm() {
  // Gravity-style TDS sensor: voltage-to-ppm linear approximation
  // with temperature compensation omitted for clarity. Calibrate
  // against a 342 ppm NaCl solution.
  float volts = analogRead(PIN_TDS) * 3.3 / 4095.0;
  return volts * (1000.0 / 3.3);
}

void sendReading() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Skipped: no WiFi.");
    return;
  }

  // Real sensor values — nothing is generated here.
  float temperature = readTemperatureC();
  float ph          = readPH();
  float turbidity   = readTurbidityNTU();
  float tds         = readTDSppm();

  String payload = "{";
  payload += "\"device_id\":" + String(DEVICE_ID);
  payload += ",\"temperature\":" + String(temperature, 2);
  payload += ",\"ph\":" + String(ph, 2);
  payload += ",\"turbidity\":" + String(turbidity, 2);
  payload += ",\"tds\":" + String(tds, 2);
  payload += "}";

  HTTPClient http;
  String url = String(AQUA_AI_SERVER) + "/readings/ingest";

  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(10000);  // 10 s so a slow backend cannot hang the loop

  Serial.print("[HTTP] POST ");
  Serial.println(url);

  int code = http.POST(payload);

  if (code > 0) {
    Serial.print("[HTTP] Status: ");
    Serial.print(code);
    if (code == 201) {
      Serial.println("  (reading accepted)");
    } else {
      Serial.print("  body: ");
      Serial.println(http.getString().substring(0, 200));  // error detail
    }
  } else {
    Serial.print("[HTTP] Request failed: ");
    Serial.println(http.errorToString(code));
  }

  http.end();
}
