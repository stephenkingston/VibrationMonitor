# Vibration Monitor

Real-time vibration monitoring for LSM6DS3 accelerometers that stream their FIFO over UDP from an ESP8266 (firmware: [LSM6DS3_FIFO_with_ESP8266](https://github.com/stephenkingston/LSM6DS3_FIFO_with_ESP8266)).

- Live X/Y/Z traces for each sensor, rendered with WebGL2 at the display's refresh rate
- Live FFT spectrum per channel with peak detection, in dB or g, on a linear or log frequency axis
- Scrolling spectrogram for any channel and axis (or all axes combined)
- Per-axis RMS and dominant frequency
- Pause, pan and zoom through the last 30 seconds of history; all plots share one time axis
- DC removal (hides gravity), autoscale or fixed ±2/4/16 g
- CSV export of whatever is in view

## Quick start

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python server.py                    # UI at http://127.0.0.1:5000
.venv/bin/python mockSensor.py --rate 10000   # optional: fake sensors on UDP 6789-6791
```

`server.py --help` lists the options. Use `--host 0.0.0.0` to open the UI from other machines on the LAN. Sensors are mapped to channels by UDP port (`--udp-ports`, default `6789,6790,6791`).

### Controls

| | |
|---|---|
| Scroll on a time plot or the spectrogram | Zoom the time window |
| Drag | Pan back through history (pauses) |
| Double-click, Esc | Back to live |
| Space | Pause / resume |
| Hover | Values under the cursor |

## How it works

```
ESP8266 ──UDP──▶ server.py ──binary WebSocket──▶ browser
 (raw FIFO bytes)  (batches bytes,             (ring buffer ─▶ GPU textures ─▶ WebGL2)
                    never decodes them)
```

**Server.** A single asyncio process ([aiohttp](https://docs.aiohttp.org/)). UDP payloads are appended to a per-channel buffer and flushed every 10 ms to each browser as one binary frame: a 12-byte header (channel, running sample index, measured sample rate) followed by the untouched int16 X/Y/Z samples. Python does no per-sample work, and a slow client only drops its own frames.

**Browser.** No build step or dependencies; plain ES modules in `web/assets/js`.

- `ring.js` keeps a fixed-size ring buffer per channel (sized for 30 s at the measured rate), plus a min/max pyramid over blocks of 64 and 4096 samples. Memory stays flat no matter how long it runs.
- `renderer.js` mirrors the ring and pyramid into integer textures. Each trace is drawn as one quad per pixel column, and its vertex shader reads that column's min/max from the coarsest pyramid level that resolves it. Drawing cost therefore doesn't grow with the sample rate or window length, and only new samples are uploaded each frame.
- The display playhead trails the newest sample slightly and glides at the sample rate, so traces scroll smoothly even though data arrives in 10 ms bursts.
- `dsp.js` and `spectrogram.js` run the FFTs (radix-2, Hann window) under a per-frame time budget.

Measured in Chrome on an M1 Mac: 3 channels × ~480 kHz (1.4 MS/s, 8 MB/s) at a steady 100 fps with ~2 ms of JavaScript per frame. The Python mock sensor tops out around there; the UI itself isn't the limit.

## Mock sensor

`mockSensor.py` emits packets in the firmware's exact format, so it exercises the whole pipeline. Channel 1 is a motor with a drifting shaft speed and harmonics; channel 2 is a repeating frequency sweep plus 50 Hz hum; channel 3 is periodic impacts that ring at several resonances. `--rate` sets samples per second per channel. Components above 0.45 × the rate are left out so nothing aliases.

## Repository layout

| Path | |
|---|---|
| `server.py` | UDP → WebSocket bridge and static file server |
| `mockSensor.py` | Synthetic sensors |
| `web/` | The UI |
| `analysis/` | Recorded stepper-motor data and the Octave FFT script used to study it |
| `docs/` | The original 2020 demo UI (published with GitHub Pages) |
