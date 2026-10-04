"""Mock ESP8266 + LSM6DS3: sends synthetic accelerometer samples over UDP.

Packets use the same layout as the firmware's FIFO dump: 6 bytes per sample
(X, Y, Z as little-endian int16, +/-16 g full scale), so UDPServer.py decodes
them exactly like real sensor data.

Usage: python mockSensor.py [--rate 100] [--samples-per-packet 1] [--host 127.0.0.1]
"""
import argparse
import math
import random
import socket
import struct
import time

from UDPServer import UDP_PORT_NO_1, UDP_PORT_NO_2, UDP_PORT_NO_3

FULL_SCALE_G = 16


def to_raw(g):
    raw = round(g / FULL_SCALE_G * 32768)
    return max(-32768, min(32767, raw))


def channel1(t):
    # Steady machine vibration: slow sway with a 12 Hz ripple on top
    return 1 + 0.4 * math.sin(2 * math.pi * 0.5 * t) + 0.08 * math.sin(2 * math.pi * 12 * t)


def channel2(t):
    # 2 Hz vibration whose amplitude swells and fades every 10 s
    envelope = 0.5 + 0.5 * math.sin(2 * math.pi * 0.1 * t)
    return 1 + 0.4 * envelope * math.sin(2 * math.pi * 2 * t)


def channel3(t):
    # Periodic impacts: decaying 8 Hz ring every 3 s
    tau = t % 3
    return 1 + 0.8 * math.exp(-tau / 0.3) * math.sin(2 * math.pi * 8 * tau)


CHANNELS = [(UDP_PORT_NO_1, channel1), (UDP_PORT_NO_2, channel2), (UDP_PORT_NO_3, channel3)]


def sample_bytes(z_g):
    x = to_raw(random.gauss(0, 0.01))
    y = to_raw(random.gauss(0, 0.01))
    z = to_raw(z_g + random.gauss(0, 0.01))
    return struct.pack("<hhh", x, y, z)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--rate", type=float, default=100, help="samples per second per channel")
    parser.add_argument("--samples-per-packet", type=int, default=1)
    args = parser.parse_args()

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    packet_interval = args.samples_per_packet / args.rate
    print(f"Sending {args.rate:g} Hz ({args.samples_per_packet} sample(s)/packet) to "
          f"{args.host} ports {', '.join(str(p) for p, _ in CHANNELS)}")

    n = 0
    start = time.perf_counter()
    next_send = start
    last_report, last_n = start, 0
    while True:
        for port, signal in CHANNELS:
            payload = b"".join(sample_bytes(signal((n + i) / args.rate))
                               for i in range(args.samples_per_packet))
            sock.sendto(payload, (args.host, port))
        n += args.samples_per_packet

        now = time.perf_counter()
        if now - last_report >= 5:
            print(f"{(n - last_n) / (now - last_report):.1f} samples/s per channel, {n} total")
            last_report, last_n = now, n

        # Schedule against absolute deadlines so sleep jitter doesn't accumulate
        next_send += packet_interval
        delay = next_send - time.perf_counter()
        if delay > 0:
            time.sleep(delay)


if __name__ == "__main__":
    main()
