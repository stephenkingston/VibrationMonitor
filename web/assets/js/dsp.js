// FFT, windowing and amplitude-spectrum estimation.
import { nextPow2, stableSize } from './ring.js';

const ffts = new Map();
const windows = new Map();

class FFT {
  constructor(n) {
    this.n = n;
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / n);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / n);
    }
  }

  /** In-place iterative radix-2 transform. */
  transform(re, im) {
    const { n, rev, cos, sin } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const i = start + k, j = i + half;
          const wr = cos[t], wi = sin[t];
          const xr = re[j] * wr - im[j] * wi;
          const xi = re[j] * wi + im[j] * wr;
          re[j] = re[i] - xr;
          im[j] = im[i] - xi;
          re[i] += xr;
          im[i] += xi;
        }
      }
    }
  }
}

export function fft(n) {
  if (!ffts.has(n)) ffts.set(n, new FFT(n));
  return ffts.get(n);
}

export function hann(n) {
  if (!windows.has(n)) {
    const w = new Float64Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
    windows.set(n, { w, sum });
  }
  return windows.get(n);
}

/** Load a mean-removed, Hann-windowed segment of one axis into re (and zero im). */
export function loadSegment(ring, start, n, axis, re, im, w) {
  const { raw, mask } = ring;
  let sum = 0;
  for (let i = 0; i < n; i++) sum += re[i] = raw[((start + i) & mask) * 3 + axis];
  const mean = sum / n;
  for (let i = 0; i < n; i++) {
    re[i] = (re[i] - mean) * w[i];
    im[i] = 0;
  }
}

/**
 * Strongest local maximum above ~1 Hz, refined to sub-bin accuracy. Returns null
 * unless the peak clearly stands out from the average level (i.e. it isn't noise).
 */
export function findPeak(amp, binHz) {
  const first = Math.max(2, Math.ceil(1 / binHz));
  let best = -1, bestAmp = 1e-4, sum = 0;
  for (let k = first; k < amp.length - 1; k++) {
    const v = amp[k];
    sum += v;
    if (v > bestAmp && v >= amp[k - 1] && v >= amp[k + 1]) [best, bestAmp] = [k, v];
  }
  if (best < 0 || bestAmp < (8 * sum) / (amp.length - 1 - first)) return null;
  const a = Math.log(amp[best - 1] + 1e-12), b = Math.log(amp[best] + 1e-12), c = Math.log(amp[best + 1] + 1e-12);
  const denom = a - 2 * b + c;
  const delta = denom < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  return { freq: (best + delta) * binHz, amp: bestAmp };
}

/** Live amplitude spectrum (peak g per bin) of the three axes of one channel. */
export class Spectrum {
  constructor() {
    this.size = 0;
    this.version = 0;
    this.fresh = [true, true, true];
  }

  /** `smooth` averages successive spectra; pass false when the data isn't moving. */
  update(ring, end, rate, scale, axes, smooth = true) {
    let size = stableSize(this.size, rate, (r) => Math.min(16384, Math.max(512, nextPow2(r * 0.5))));
    const available = end - ring.oldest;
    while (size > available && size > 64) size >>= 1;
    if (size > available || !rate) return false;
    if (size !== this.size) {
      this.size = size;
      this.bins = size / 2;
      this.re = new Float64Array(size);
      this.im = new Float64Array(size);
      this.amp = [0, 1, 2].map(() => new Float32Array(size / 2));
      this.peaks = [null, null, null];
      this.fresh = [true, true, true];
    }
    const { w, sum } = hann(size);
    const transform = fft(size);
    const norm = (2 * scale) / sum;
    const { re, im } = this;
    for (let a = 0; a < 3; a++) {
      if (!axes[a]) {
        this.fresh[a] = true;
        continue;
      }
      loadSegment(ring, end - size, size, a, re, im, w);
      transform.transform(re, im);
      const amp = this.amp[a];
      const alpha = this.fresh[a] || !smooth ? 1 : 0.35;
      for (let k = 0; k < size / 2; k++) {
        amp[k] += (Math.sqrt(re[k] * re[k] + im[k] * im[k]) * norm - amp[k]) * alpha;
      }
      this.fresh[a] = false;
      this.peaks[a] = findPeak(amp, rate / size);
    }
    this.rate = rate;
    this.version++;
    return true;
  }
}
