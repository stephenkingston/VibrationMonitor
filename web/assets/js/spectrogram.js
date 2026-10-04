// Rolling spectrogram for one channel: FFT columns at a fixed hop, queued for upload.
import { nextPow2, stableSize } from './ring.js';
import { fft, hann, loadSegment } from './dsp.js';
import { HISTORY_SECONDS } from './channel.js';

export const ALL_AXES = 3;

export class Spectrogram {
  constructor(maxColumns) {
    this.maxColumns = maxColumns;
    this.channel = null;
    this.axis = ALL_AXES;
    this.generation = 0;
    this.pending = []; // { column, row } awaiting upload
    this.pool = [];
    this.peakDb = -40;
    this.configure(null, ALL_AXES);
  }

  configure(channel, axis) {
    this.channel = channel;
    this.axis = axis;
    this.size = 0;
    this.restart();
  }

  restart() {
    this.next = null; // next column index to compute
    this.first = 0; // oldest column still in the texture
    this.last = -1; // newest computed column
    this.recycle();
  }

  recycle() {
    for (const { row } of this.pending) this.pool.push(row);
    this.pending.length = 0;
  }

  /** Column c covers samples [c * hop, c * hop + size). `viewStart` is the first sample in view. */
  update(budgetMs, viewStart) {
    const ch = this.channel;
    if (!ch || !ch.hasData) return;
    const { ring, rate } = ch;
    const size = stableSize(this.size, rate, (r) => Math.min(4096, Math.max(128, nextPow2(r / 8))));
    const hop = stableSize(this.hop, rate, (r) => Math.max(size / 8, nextPow2((r * HISTORY_SECONDS) / this.maxColumns)));
    if (size !== this.size || hop !== this.hop) {
      Object.assign(this, { size, hop, bins: size / 2, columns: this.maxColumns });
      this.pool.length = 0;
      this.restart();
      this.generation++;
    }

    const newestStart = ring.count - size;
    const oldestUseful = Math.max(Math.ceil(ring.oldest / hop), Math.floor(newestStart / hop) - this.columns + 1);
    if (this.next === null || this.next < oldestUseful) {
      // Starting fresh or hopelessly behind: begin at the left edge of the view
      this.next = Math.max(oldestUseful, Math.floor((viewStart - size) / hop), 0);
      this.first = this.next;
      this.recycle();
    }

    const { w, sum } = hann(size);
    const transform = fft(size);
    const re = (this.re ||= new Float64Array(4096));
    const im = (this.im ||= new Float64Array(4096));
    const norm2 = ((2 * ch.scale) / sum) ** 2;
    const axes = this.axis === ALL_AXES ? [0, 1, 2] : [this.axis];
    const started = performance.now();
    const budget = newestStart - this.next * hop > rate * 0.25 ? budgetMs * 2.5 : budgetMs; // catch up faster
    while (this.next * hop <= newestStart && performance.now() - started < budget) {
      const row = this.pool.pop() || new Float32Array(this.bins);
      row.fill(0);
      for (const a of axes) {
        loadSegment(ring, this.next * hop, size, a, re, im, w);
        transform.transform(re, im);
        for (let k = 0; k < this.bins; k++) row[k] += (re[k] * re[k] + im[k] * im[k]) * norm2;
      }
      let rowMax = -200;
      for (let k = 1; k < this.bins; k++) {
        const db = 10 * Math.log10(row[k] + 1e-20);
        row[k] = db;
        if (db > rowMax) rowMax = db;
      }
      row[0] = row[1];
      this.peakDb = Math.max(this.peakDb, rowMax);
      this.pending.push({ column: this.next, row });
      this.last = this.next++;
    }
    this.first = Math.max(this.first, this.last - this.columns + 1);
  }

  /** Let the colour scale follow the loudest recent content. */
  decay(dt) {
    this.peakDb -= dt * 4;
  }
}
