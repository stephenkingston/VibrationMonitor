// Fixed-capacity store for interleaved XYZ int16 samples, plus a two-level
// min/max pyramid so any time span can be summarised with bounded work. The
// same arrays are mirrored into GPU textures by the renderer.

export const L1_SHIFT = 6; // 64 samples per level-1 block
export const L2_SHIFT = 12; // 4096 samples per level-2 block
const L1_MASK = (1 << L1_SHIFT) - 1;
const L2_MASK = (1 << L2_SHIFT) - 1;
const MIN_CAPACITY = 1 << 16;
const MAX_CAPACITY = 1 << 23;

export function nextPow2(n) {
  return 2 ** Math.ceil(Math.log2(Math.max(1, n)));
}

/**
 * A power-of-two size derived from a measured rate, with hysteresis: the measured
 * rate wobbles slightly, and resizing on every wobble would reset the consumer.
 */
export function stableSize(current, rate, sizeFor) {
  if (current && sizeFor(rate * 0.95) <= current && current <= sizeFor(rate * 1.05)) return current;
  return sizeFor(rate);
}

// Sample indices are absolute counts that can pass 2^32 after hours at high
// rates. Bitwise ops wrap them mod 2^32, which is harmless because every
// capacity here divides 2^32.

export class SampleRing {
  constructor() {
    this.count = 0; // absolute index of the next sample
    this.first = 0; // absolute index of the first sample kept (rises when the ring grows)
    this.generation = 0; // bumped whenever the arrays are replaced
    this.allocate(MIN_CAPACITY);
  }

  allocate(capacity) {
    this.capacity = capacity;
    this.mask = capacity - 1;
    this.raw = new Int16Array(capacity * 3);
    this.min1 = new Int16Array((capacity >> L1_SHIFT) * 3);
    this.max1 = new Int16Array((capacity >> L1_SHIFT) * 3);
    this.min2 = new Int16Array((capacity >> L2_SHIFT) * 3);
    this.max2 = new Int16Array((capacity >> L2_SHIFT) * 3);
    this.open1 = this.open2 = false;
    this.dirtyFrom = this.count; // first sample not yet uploaded to the GPU
    this.generation++;
  }

  reset() {
    this.count = this.first = 0;
    this.allocate(this.capacity);
  }

  /** Oldest sample index whose pyramid blocks are still intact. */
  get oldest() {
    return Math.max(this.first, this.count - this.capacity + (1 << L2_SHIFT));
  }

  /** Grow (never shrink) so `samples` fit, keeping the newest data. */
  reserve(samples) {
    const capacity = Math.min(MAX_CAPACITY, nextPow2(samples));
    if (capacity <= this.capacity) return;
    const keep = Math.min(this.count, this.capacity);
    const kept = this.copy(this.count - keep, keep);
    this.count -= keep;
    this.first = Math.max(this.first, this.count);
    this.allocate(capacity);
    this.ingest(kept, keep);
  }

  /** Copy n samples starting at absolute index `from` into a new array. */
  copy(from, n) {
    const out = new Int16Array(n * 3);
    const slot = from & this.mask;
    const first = Math.min(n, this.capacity - slot);
    out.set(this.raw.subarray(slot * 3, (slot + first) * 3));
    if (first < n) out.set(this.raw.subarray(0, (n - first) * 3), first * 3);
    return out;
  }

  /** Append n interleaved XYZ samples. */
  ingest(src, n) {
    if (n <= 0) return;
    if (n > this.capacity) {
      // Only the newest `capacity` samples can be kept
      const skip = n - this.capacity;
      src = src.subarray(skip * 3);
      this.count += skip;
      n = this.capacity;
      this.open1 = this.open2 = false;
    }
    const start = this.count;
    const { mask, raw, min1, max1, min2, max2 } = this;
    const slot = start & mask;
    const first = Math.min(n, this.capacity - slot);
    raw.set(src.subarray(0, first * 3), slot * 3);
    if (first < n) raw.set(src.subarray(first * 3, n * 3), 0);

    let open1 = this.open1;
    let open2 = this.open2;
    for (let i = 0, k = 0; i < n; i++, k += 3) {
      const s = (start + i) & mask;
      const x = src[k], y = src[k + 1], z = src[k + 2];
      let b = (s >> L1_SHIFT) * 3;
      if (!open1 || (s & L1_MASK) === 0) {
        min1[b] = max1[b] = x;
        min1[b + 1] = max1[b + 1] = y;
        min1[b + 2] = max1[b + 2] = z;
        open1 = true;
      } else {
        if (x < min1[b]) min1[b] = x; else if (x > max1[b]) max1[b] = x;
        if (y < min1[b + 1]) min1[b + 1] = y; else if (y > max1[b + 1]) max1[b + 1] = y;
        if (z < min1[b + 2]) min1[b + 2] = z; else if (z > max1[b + 2]) max1[b + 2] = z;
      }
      b = (s >> L2_SHIFT) * 3;
      if (!open2 || (s & L2_MASK) === 0) {
        min2[b] = max2[b] = x;
        min2[b + 1] = max2[b + 1] = y;
        min2[b + 2] = max2[b + 2] = z;
        open2 = true;
      } else {
        if (x < min2[b]) min2[b] = x; else if (x > max2[b]) max2[b] = x;
        if (y < min2[b + 1]) min2[b + 1] = y; else if (y > max2[b + 1]) max2[b + 1] = y;
        if (z < min2[b + 2]) min2[b + 2] = z; else if (z > max2[b + 2]) max2[b + 2] = z;
      }
    }
    this.open1 = open1;
    this.open2 = open2;
    this.count = start + n;
  }

  /** Repeat the latest sample over n samples the server dropped for us. */
  fillGap(n) {
    n = Math.min(n, this.capacity);
    const last = this.count > 0 ? this.copy(this.count - 1, 1) : new Int16Array(3);
    const fill = new Int16Array(n * 3);
    for (let i = 0; i < n; i++) fill.set(last, i * 3);
    this.ingest(fill, n);
  }

  /** Raw value of one axis at an absolute sample index. */
  value(index, axis) {
    return this.raw[(index & this.mask) * 3 + axis];
  }

  /**
   * Raw min/max per axis over samples [from, to) into out = [minX, minY, minZ, maxX, maxY, maxZ].
   * Uses the coarsest level that keeps the loop under ~4096 steps, so results may include
   * up to one block of samples just outside the range.
   */
  range(from, to, out) {
    from = Math.max(Math.ceil(from), this.oldest);
    to = Math.min(Math.floor(to), this.count);
    out[0] = out[1] = out[2] = Infinity;
    out[3] = out[4] = out[5] = -Infinity;
    if (to <= from) return false;
    const n = to - from;
    let lows = this.raw, highs = this.raw, shift = 0;
    if (n > 4096 << L1_SHIFT) [lows, highs, shift] = [this.min2, this.max2, L2_SHIFT];
    else if (n > 4096) [lows, highs, shift] = [this.min1, this.max1, L1_SHIFT];
    const step = 1 << shift;
    for (let s = from - (from & (step - 1)); s < to; s += step) {
      const b = ((s & this.mask) >> shift) * 3;
      for (let a = 0; a < 3; a++) {
        if (lows[b + a] < out[a]) out[a] = lows[b + a];
        if (highs[b + a] > out[a + 3]) out[a + 3] = highs[b + a];
      }
    }
    return true;
  }
}
