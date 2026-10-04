// CSV export of the samples in view. Time is relative to the right edge of the view.
const ROWS_PER_CHUNK = 50000;

const pad = (n) => String(n).padStart(2, '0');

/**
 * `ranges` is [{ channel, start, end }] with absolute sample indices (end exclusive).
 * Builds the file in chunks, yielding between them so the UI keeps rendering.
 */
export async function exportCsv(ranges, onProgress) {
  const parts = ['channel,time_s,x_g,y_g,z_g\n'];
  const total = ranges.reduce((sum, r) => sum + Math.max(0, r.end - r.start), 0);
  let done = 0;
  for (const { channel, start, end } of ranges) {
    const { raw, mask } = channel.ring;
    const { scale, rate } = channel;
    for (let from = start; from < end; from += ROWS_PER_CHUNK) {
      const to = Math.min(end, from + ROWS_PER_CHUNK);
      const rows = new Array(to - from);
      for (let i = from; i < to; i++) {
        const b = (i & mask) * 3;
        rows[i - from] = `${channel.id + 1},${((i - end + 1) / rate).toFixed(6)},${(raw[b] * scale).toFixed(5)},${(raw[b + 1] * scale).toFixed(5)},${(raw[b + 2] * scale).toFixed(5)}`;
      }
      parts.push(rows.join('\n') + '\n');
      done += to - from;
      onProgress?.(done / total);
      await new Promise((resolve) => setTimeout(resolve));
    }
  }
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob(parts, { type: 'text/csv' }));
  link.download = `vibration-${stamp}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10000);
  return total;
}
