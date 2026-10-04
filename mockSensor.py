"""Mock ESP8266 + LSM6DS3 sensors: streams synthetic vibration data over UDP.

Packets use the firmware's FIFO layout: 6 bytes per sample (X, Y, Z as
little-endian int16, +/-16 g full scale), sent every 10 ms like the firmware's
FIFO polling loop. Signals are generated with numpy, so rates well past
100 kHz per channel are fine.

    Channel 1  motor: shaft speed drifting around 28 Hz, harmonics, orbit on X/Y
    Channel 2  sweep: repeating log chirp on X, 50 Hz hum on Y
    Channel 3  impacts: periodic hits ringing at several resonances

Components above 0.45x the sample rate are left out so nothing aliases.

Usage: python mockSensor.py [--rate 10000] [--packet-ms 10] [--host 127.0.0.1]
"""
import argparse
import socket
import time

import numpy as np

PORTS = (6789, 6790, 6791)
FULL_SCALE_G = 16
RAW_PER_G = 32768 / FULL_SCALE_G
NOISE_G = 0.01
MAX_DATAGRAM = 1440  # bytes; Ethernet-MTU sized, and under macOS's 9216-byte UDP limit

TAU = 2 * np.pi


def tone(rate, freq, amp, phase):
    """amp * sin(phase), or 0 if freq would alias at this sample rate."""
    return amp * np.sin(phase) if freq < 0.45 * rate else 0.0


def motor(t, rate):
    f0, drift, drift_hz = 28.0, 6.0, 0.05
    # Integrate the drifting shaft frequency to get a continuous phase
    phase = TAU * (f0 * t - drift / (TAU * drift_hz) * np.cos(TAU * drift_hz * t))
    top = f0 + drift
    swell = 1 + 0.3 * np.sin(TAU * 0.2 * t)
    x = swell * (tone(rate, top, 0.35, phase) + tone(rate, 2 * top, 0.12, 2 * phase + 0.4)
                 + tone(rate, 5 * top, 0.05, 5 * phase))
    y = swell * (tone(rate, top, 0.30, phase + np.pi / 2) + tone(rate, 3 * top, 0.08, 3 * phase + 1.1))
    z = 1 + tone(rate, 2 * top, 0.10, 2 * phase) + 0.15 * np.sin(TAU * 0.5 * t)
    return x, y, z


def sweep(t, rate):
    period, f_lo = 8.0, 5.0
    f_hi = min(0.4 * rate, 2000.0)
    tau = t % period
    k = f_hi / f_lo
    phase = TAU * f_lo * period / np.log(k) * (k ** (tau / period) - 1)
    x = 0.4 * np.sin(phase) * np.minimum(1, (period - tau) * 4)  # fade out before the restart
    y = tone(rate, 50, 0.15, TAU * 50 * t) + tone(rate, 150, 0.05, TAU * 150 * t)
    z = 1 + 0.2 * np.sin(TAU * 0.3 * t)
    return x, y, z


def impacts(t, rate):
    tau = t % 1.5
    ring = np.exp(-tau / 0.12) * (tone(rate, 180, 0.8, TAU * 180 * tau) + tone(rate, 420, 0.4, TAU * 420 * tau + 0.5)
                                  + tone(rate, 1350, 0.2, TAU * 1350 * tau))
    slow = 0.5 * np.exp(-tau / 0.3) * np.sin(TAU * 8 * tau)
    return 0.6 * ring, 0.35 * ring + 0.3 * slow, 1 + 0.9 * ring + slow


SIGNALS = (motor, sweep, impacts)


def packet(signal, t, rate, rng):
    g = np.column_stack(signal(t, rate)) + rng.normal(0, NOISE_G, (len(t), 3))
    return np.clip(np.rint(g * RAW_PER_G), -32768, 32767).astype("<i2").tobytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--rate", type=float, default=10000, help="samples per second per channel")
    parser.add_argument("--packet-ms", type=float, default=10, help="send interval (the firmware polls every 10 ms)")
    args = parser.parse_args()

    per_packet = max(1, round(args.rate * args.packet_ms / 1000))
    interval = per_packet / args.rate
    offsets = np.arange(per_packet)
    rng = np.random.default_rng()
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    print(f"Sending {args.rate:g} Hz ({per_packet} samples/packet) to {args.host} ports "
          f"{', '.join(map(str, PORTS))}")

    n = 0
    start = next_send = last_report = time.perf_counter()
    last_n = 0
    while True:
        t = (n + offsets) / args.rate
        for port, signal in zip(PORTS, SIGNALS):
            data = packet(signal, t, args.rate, rng)
            for i in range(0, len(data), MAX_DATAGRAM):
                sock.sendto(data[i:i + MAX_DATAGRAM], (args.host, port))
        n += per_packet

        now = time.perf_counter()
        if now - last_report >= 5:
            print(f"{(n - last_n) / (now - last_report):,.0f} samples/s per channel")
            last_report, last_n = now, n

        # Schedule against absolute deadlines so sleep jitter doesn't accumulate
        next_send += interval
        delay = next_send - time.perf_counter()
        if delay > 0:
            time.sleep(delay)
        elif delay < -1:
            next_send = time.perf_counter()  # fell far behind; don't try to catch up in a burst


if __name__ == "__main__":
    main()
