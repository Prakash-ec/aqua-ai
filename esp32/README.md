# Aqua AI ESP32 Sensor Node

Firmware for sending real sensor readings from an ESP32 to the Aqua AI backend.

## Endpoint used

`POST /readings/ingest` with header `X-Device-Token: <device token>`

## Setup

1. **Create the device** in the Aqua AI web app (Devices page → Add Device).
   The API returns a **device token once** — copy it immediately; it is not shown again
   (only a salted hash is stored server-side).
2. **Edit `aqua_ai_esp32.ino`** and fill in:
   - `WIFI_SSID` / `WIFI_PASSWORD` — your Wi-Fi credentials
   - `AQUA_AI_SERVER` — the **LAN IP of the machine running the backend**
     (e.g. `http://192.168.1.50:8001`). **Never use `127.0.0.1`** — that is the ESP32
     itself, not your PC.
   - `DEVICE_ID` — the device id shown in the Aqua AI app
   - `DEVICE_TOKEN` — the token from step 1
3. Wire real sensors to the analog/digital pins per the `SENSOR_*` pin defines and
   calibrate the conversion functions for your actual sensors.
4. Flash with the Arduino IDE (ESP32 board package installed).

## Notes

- Readings are sent every `SEND_INTERVAL_MS` (default 30 s) using a non-blocking
  `millis()` cadence.
- Wi-Fi auto-reconnects; HTTP failures are logged to Serial and retried next cycle.
- The sketch sends **only real analogRead-based values** — no simulated data.
- The ESP32 and the backend must be on the same network (or route to it).
