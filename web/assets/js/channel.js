// One sensor channel: sample storage, smooth playhead, statistics and autoscale.
import { SampleRing } from './ring.js';
import { Spectrum } from './dsp.js';

export const HISTORY_SECONDS = 30;
// The traces' pixel columns are binned by sample index, so any change to the rate
// used for layout re-bins them. Only follow the measured rate when it really moves.
const RATE_HYSTERESIS = 0.001;
const MAX_STATS_SAMPLES = 1 << 18;

export class Channel {
  constructor(info, fullScaleG) {
    this.id = info.id;
    this.name = info.name;
    this.port = info.port;
    this.scale = fullScaleG / 32768; // raw -> g
    this.ring = new SampleRing();
    this.spectrum = new Spectrum();
    this.rate = 0; // sample rate used for layout: steady
    this.measuredRate = 0; // latest server estimate
    this.expected = null; // next sample index the server should send (u32)
    this.head = 0; // display playhead, absolute fractional sample index
    this.headReady = false;
    this.lastArrival = 0;
    this.maxGap = 0.05; // recent worst-case gap between frames, seconds
    this.stats = { mean: [0, 0, 0], rms: [0, 0, 0], p2p: [0, 0, 0], ready: false };
    this.dc = [0, 0, 0]; // smoothed mean used for DC removal
    this.yRange = { lo: -1, hi: 1, ready: false };
    this.rangeScratch = new Float64Array(6);
  }

  /** Forget stream continuity, e.g. after a reconnect. */
  resync() {
    this.expected = null;
  }

  push(first, rate, samples) {
    const n = samples.length / 3;
    if (this.expected !== null && first !== this.expected) {
      const gap = (first - this.expected) >>> 0;
      if (gap < this.ring.capacity) this.ring.fillGap(gap);
      else this.restart(); // server restarted or we fell hopelessly behind
    }
    this.expected = (first + n) >>> 0;
    if (rate > 0) {
      this.measuredRate = rate;
      if (!this.rate || Math.abs(rate / this.rate - 1) > RATE_HYSTERESIS) this.rate = rate;
      this.ring.reserve(rate * HISTORY_SECONDS);
    }
    this.ring.ingest(samples, n);

    const now = performance.now() / 1000;
    if (this.lastArrival) {
      const gap = now - this.lastArrival;
      this.maxGap = Math.max(gap, this.maxGap * Math.exp(-gap / 2));
    }
    this.lastArrival = now;
  }

  restart() {
    this.ring.reset();
    this.headReady = false;
    this.stats.ready = false;
    this.yRange.ready = false;
  }

  get hasData() {
    return this.rate > 0 && this.ring.count > 1;
  }

  /** Seconds of data the ring holds at the current rate. */
  get historySeconds() {
    return this.rate ? (this.ring.count - this.ring.oldest) / this.rate : 0;
  }

  /**
   * Advance the playhead smoothly. Frames arrive in bursts every ~10 ms, so the
   * display trails the newest sample by a little more than the worst recent gap
   * and glides at the sample rate instead of jumping per frame.
   */
  advance(dt) {
    if (!this.hasData) return;
    const newest = this.ring.count - 1;
    const latency = Math.min(0.5, Math.max(0.04, this.maxGap * 1.5 + 0.02));
    const target = newest - latency * this.rate;
    if (!this.headReady || Math.abs(target - this.head) > this.rate * 0.5) {
      this.head = target;
      this.headReady = true;
    } else {
      this.head += this.rate * dt + (target - this.head) * Math.min(1, dt * 3);
    }
    this.head = Math.min(Math.max(this.head, this.ring.oldest), newest);
  }

  /** Mean, AC RMS and peak-to-peak per axis over the second of data ending at `end`. */
  updateStats(end) {
    const { ring } = this;
    end = Math.floor(end) + 1;
    const n = Math.min(Math.round(this.rate), end - ring.oldest, MAX_STATS_SAMPLES);
    if (n < 2) return;
    const { raw, mask } = ring;
    const sum = [0, 0, 0], sq = [0, 0, 0], lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (let i = end - n; i < end; i++) {
      const b = (i & mask) * 3;
      for (let a = 0; a < 3; a++) {
        const v = raw[b + a];
        sum[a] += v;
        sq[a] += v * v;
        if (v < lo[a]) lo[a] = v;
        if (v > hi[a]) hi[a] = v;
      }
    }
    for (let a = 0; a < 3; a++) {
      const mean = sum[a] / n;
      this.stats.mean[a] = mean * this.scale;
      this.stats.rms[a] = Math.sqrt(Math.max(0, sq[a] / n - mean * mean)) * this.scale;
      this.stats.p2p[a] = (hi[a] - lo[a]) * this.scale;
    }
    if (!this.stats.ready) this.dc = [...this.stats.mean];
    this.stats.ready = true;
  }

  /** Ease the DC estimate toward the latest mean so removing it never jolts the trace. */
  updateDc(dt) {
    for (let a = 0; a < 3; a++) this.dc[a] += (this.stats.mean[a] - this.dc[a]) * Math.min(1, dt * 2);
  }

  /**
   * Animate the y-range toward the data in view: grow quickly so peaks are never
   * clipped for long, shrink slowly so the axis doesn't twitch.
   */
  updateYRange(head, windowSamples, axes, removeDc, fixedG, dt) {
    let lo, hi;
    if (fixedG) {
      [lo, hi] = [-fixedG, fixedG];
    } else {
      const r = this.rangeScratch;
      if (!this.ring.range(head - windowSamples, head + 1, r)) return;
      lo = Infinity;
      hi = -Infinity;
      for (let a = 0; a < 3; a++) {
        if (!axes[a]) continue;
        const offset = removeDc ? this.dc[a] : 0;
        lo = Math.min(lo, r[a] * this.scale - offset);
        hi = Math.max(hi, r[a + 3] * this.scale - offset);
      }
      if (!isFinite(lo)) return;
      const span = Math.max(hi - lo, 0.05);
      const mid = (hi + lo) / 2;
      lo = mid - span * 0.56;
      hi = mid + span * 0.56;
    }
    const range = this.yRange;
    if (!range.ready) {
      Object.assign(range, { lo, hi, ready: true });
      return;
    }
    const ease = (current, target, growing) => current + (target - current) * Math.min(1, dt * (growing ? 12 : 1.5));
    range.lo = ease(range.lo, lo, lo < range.lo);
    range.hi = ease(range.hi, hi, hi > range.hi);
  }
}
