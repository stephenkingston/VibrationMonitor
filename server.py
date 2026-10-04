"""UDP -> WebSocket bridge for LSM6DS3 vibration sensors, plus the web UI.

Each sensor sends raw LSM6DS3 FIFO dumps over UDP: 6 bytes per sample
(X, Y, Z as little-endian int16). Python never decodes the samples; it batches
the bytes per channel and forwards them to every browser as binary WebSocket
frames, so throughput is bounded by the network rather than by the interpreter.

Binary frame layout (little-endian):
    u8  type          1 = samples
    u8  channel       index into the hello message's channel list
    u16 reserved
    u32 first_index   running sample counter of the first sample (wraps)
    f32 rate_hz       measured sample rate for the channel
    ... int16 x, y, z per sample

Usage: python server.py [--port 5000] [--udp-ports 6789,6790,6791]
"""
import argparse
import asyncio
import collections
import logging
import pathlib
import socket
import struct
import time

from aiohttp import web

SAMPLE_BYTES = 6
FRAME_HEADER = struct.Struct("<BBHIf")
FRAME_SAMPLES = 1
FULL_SCALE_G = 16  # CTRL1_XL = 0x84 in the firmware selects +/-16 g
RATE_WINDOW_S = 2.0
IDLE_RESET_S = 0.5
MAX_QUEUED_FRAMES = 512  # per client; frames beyond this are dropped for slow clients
UDP_RECV_BUFFER = 4 * 1024 * 1024

WEB_DIR = pathlib.Path(__file__).parent / "web"
log = logging.getLogger("vibration")


class Channel:
    def __init__(self, index, port):
        self.index = index
        self.port = port
        self.pending = bytearray()
        self.total = 0  # samples received
        self.sent = 0  # samples forwarded to clients
        self.rate = 0.0
        self.last_packet = 0.0
        self.marks = collections.deque()  # (time, total) for rate estimation

    def receive(self, data):
        now = time.monotonic()
        if now - self.last_packet > IDLE_RESET_S:
            # Stream (re)started: measure the rate from this packet onwards
            self.marks.clear()
            self.marks.append((now, self.total))
        self.last_packet = now
        usable = len(data) - len(data) % SAMPLE_BYTES
        self.pending += memoryview(data)[:usable]
        self.total += usable // SAMPLE_BYTES

    def update_rate(self, now):
        if not self.marks or now - self.marks[-1][0] >= 0.25:
            self.marks.append((now, self.total))
        while len(self.marks) > 2 and now - self.marks[0][0] > RATE_WINDOW_S:
            self.marks.popleft()
        start, start_total = self.marks[0]
        if now - start >= 0.25 and self.total > start_total:
            self.rate = (self.total - start_total) / (now - start)

    def take_frame(self):
        if not self.pending:
            return None
        header = FRAME_HEADER.pack(FRAME_SAMPLES, self.index, 0, self.sent & 0xFFFFFFFF, self.rate)
        frame = header + self.pending
        self.sent += len(self.pending) // SAMPLE_BYTES
        self.pending = bytearray()
        return frame


class SensorProtocol(asyncio.DatagramProtocol):
    def __init__(self, channel):
        self.channel = channel

    def datagram_received(self, data, addr):
        self.channel.receive(data)


class Client:
    def __init__(self, ws):
        self.ws = ws
        self.queue = asyncio.Queue(maxsize=MAX_QUEUED_FRAMES)
        self.dropped = 0

    def offer(self, frame):
        try:
            self.queue.put_nowait(frame)
        except asyncio.QueueFull:
            self.dropped += 1

    async def pump(self):
        try:
            while True:
                await self.ws.send_bytes(await self.queue.get())
        except (ConnectionResetError, RuntimeError):
            pass


async def flush_loop(app):
    channels, clients = app["channels"], app["clients"]
    interval = app["flush_interval"]
    while True:
        await asyncio.sleep(interval)
        now = time.monotonic()
        for channel in channels:
            channel.update_rate(now)
            frame = channel.take_frame()
            if frame:
                for client in clients:
                    client.offer(frame)


async def sensors_and_flusher(app):
    loop = asyncio.get_running_loop()
    transports = []
    for channel in app["channels"]:
        transport, _ = await loop.create_datagram_endpoint(
            lambda channel=channel: SensorProtocol(channel), local_addr=(app["udp_host"], channel.port))
        # A larger kernel buffer absorbs bursts while the event loop is busy sending
        transport.get_extra_info("socket").setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, UDP_RECV_BUFFER)
        transports.append(transport)
        log.info("Listening for channel %d on UDP %s:%d", channel.index + 1, app["udp_host"], channel.port)
    flusher = asyncio.create_task(flush_loop(app))
    yield
    flusher.cancel()
    for transport in transports:
        transport.close()


async def websocket(request):
    app = request.app
    ws = web.WebSocketResponse(heartbeat=20, compress=False)
    await ws.prepare(request)
    await ws.send_json({
        "type": "hello",
        "version": 1,
        "fullScaleG": FULL_SCALE_G,
        "channels": [{"id": c.index, "name": f"Channel {c.index + 1}", "port": c.port} for c in app["channels"]],
    })
    client = Client(ws)
    app["clients"].add(client)
    pump = asyncio.create_task(client.pump())
    log.info("Client connected (%d total)", len(app["clients"]))
    try:
        async for _ in ws:
            pass  # the UI doesn't send anything yet
    finally:
        app["clients"].discard(client)
        pump.cancel()
        log.info("Client disconnected (%d dropped frames)", client.dropped)
    return ws


async def close_clients(app):
    # Open WebSockets would otherwise hold up shutdown until aiohttp's timeout
    for client in list(app["clients"]):
        await client.ws.close(code=1001, message=b"Server shutting down")


async def index(request):
    return web.FileResponse(WEB_DIR / "index.html")


async def no_cache(request, response):
    # Let the browser revalidate assets so edits show up on reload
    response.headers["Cache-Control"] = "no-cache"


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="127.0.0.1", help="HTTP bind address (0.0.0.0 to share on the LAN)")
    parser.add_argument("--port", type=int, default=5000, help="HTTP port for the UI")
    parser.add_argument("--udp-host", default="0.0.0.0", help="UDP bind address (0.0.0.0 receives broadcasts)")
    parser.add_argument("--udp-ports", default="6789,6790,6791", help="comma-separated, one per sensor channel")
    parser.add_argument("--flush-ms", type=float, default=10, help="how often batched samples are pushed to browsers")
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")

    app = web.Application()
    app["channels"] = [Channel(i, int(p)) for i, p in enumerate(args.udp_ports.split(","))]
    app["clients"] = set()
    app["udp_host"] = args.udp_host
    app["flush_interval"] = args.flush_ms / 1000
    app.cleanup_ctx.append(sensors_and_flusher)
    app.on_response_prepare.append(no_cache)
    app.on_shutdown.append(close_clients)
    app.router.add_get("/", index)
    app.router.add_get("/ws", websocket)
    app.router.add_static("/assets", WEB_DIR / "assets")
    web.run_app(app, host=args.host, port=args.port, print=lambda _: log.info(
        "Vibration Monitor at http://%s:%d", args.host, args.port))


if __name__ == "__main__":
    main()
