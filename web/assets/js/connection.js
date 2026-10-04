// WebSocket client for the server's sample stream; see server.py for the frame layout.
const HEADER_BYTES = 12;
const FRAME_SAMPLES = 1;

export class Connection {
  constructor(url, { onHello, onSamples }) {
    Object.assign(this, { url, onHello, onSamples });
    this.state = 'connecting'; // 'open' | 'offline'
    this.bytes = 0; // received, for throughput display
    this.retries = 0;
    this.connect();
  }

  connect() {
    this.state = 'connecting';
    const ws = new WebSocket(this.url);
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => {
      this.retries = 0;
      this.state = 'open';
    };
    ws.onmessage = ({ data }) => {
      if (typeof data === 'string') {
        const message = JSON.parse(data);
        if (message.type === 'hello') this.onHello(message);
        return;
      }
      this.bytes += data.byteLength;
      const view = new DataView(data);
      if (view.getUint8(0) !== FRAME_SAMPLES) return;
      const samples = new Int16Array(data, HEADER_BYTES, (data.byteLength - HEADER_BYTES) >> 1);
      this.onSamples(view.getUint8(1), view.getUint32(4, true), view.getFloat32(8, true), samples);
    };
    ws.onclose = () => {
      this.state = 'offline';
      setTimeout(() => this.connect(), Math.min(4000, 250 * 2 ** this.retries++));
    };
  }
}
