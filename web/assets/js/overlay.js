// 2D layer beneath the WebGL traces: grids, tick labels, crosshairs and markers.

const MINUS = '−';

export function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  return (norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10) * mag;
}

function decimalsFor(step) {
  return Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
}

function signed(text, value) {
  return value < 0 ? MINUS + text.replace('-', '') : text;
}

/** `step` sets the precision; `unitStep` (default: step) picks s, ms or µs. */
export function formatSeconds(t, step, unitStep = step) {
  if (Math.abs(t) < step / 2) return '0';
  if (unitStep >= 0.1) return signed(`${t.toFixed(decimalsFor(step))} s`, t);
  if (unitStep >= 1e-4) return signed(`${(t * 1e3).toFixed(decimalsFor(step * 1e3))} ms`, t);
  return signed(`${(t * 1e6).toFixed(decimalsFor(step * 1e6))} µs`, t);
}

export function formatHz(f) {
  if (f >= 1000) return `${(f / 1000).toFixed(f >= 10000 ? 1 : 2)} kHz`;
  return `${f.toFixed(f >= 100 ? 0 : 1)} Hz`;
}

function compactHz(f) {
  return f >= 1000 ? `${+(f / 1000).toFixed(2)}k` : `${+f.toFixed(1)}`;
}

export function formatValue(v, step) {
  if (Math.abs(v) < step / 2) return '0';
  return signed(v.toFixed(decimalsFor(step)), v);
}

/** Tick positions along `length` px for [lo, hi]; `at` runs left-to-right (or top-to-bottom when flip). */
export function linearTicks(lo, hi, length, spacing, format, flip = false) {
  const step = niceStep(hi - lo, length / spacing);
  const ticks = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-6; v += step) {
    const f = (v - lo) / (hi - lo);
    ticks.push({ at: (flip ? 1 - f : f) * length, label: format(v, step), zero: Math.abs(v) < step / 2 });
  }
  return ticks;
}

export function frequencyTicks(fLo, fHi, width, log) {
  if (!log) return linearTicks(fLo, fHi, width, 64, compactHz);
  const ticks = [];
  for (let decade = 10 ** Math.floor(Math.log10(fLo)); decade <= fHi; decade *= 10) {
    for (const m of [1, 2, 5]) {
      const f = decade * m;
      if (f >= fLo && f <= fHi) ticks.push({ at: (Math.log(f / fLo) / Math.log(fHi / fLo)) * width, label: compactHz(f) });
    }
  }
  return ticks;
}

export class Overlay {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    this.colors = {
      grid: css.getPropertyValue('--grid').trim(),
      zero: css.getPropertyValue('--grid-strong').trim(),
      label: css.getPropertyValue('--label').trim(),
      text: css.getPropertyValue('--text').trim(),
      font: `10.5px ${css.getPropertyValue('--mono').trim()}`,
    };
  }

  begin(dpr) {
    const { canvas, ctx } = this;
    const width = Math.round(window.innerWidth * dpr);
    const height = Math.round(window.innerHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    this.dpr = dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    ctx.font = this.colors.font;
  }

  /** Snap a CSS coordinate to the centre of a device pixel so hairlines stay crisp. */
  snap(v) {
    return (Math.floor(v * this.dpr) + 0.5) / this.dpr;
  }

  axes(rect, xTicks, yTicks, { xLabels = true, yUnit = '', xUnit = '' } = {}) {
    const { ctx } = this;
    ctx.lineWidth = 1 / this.dpr;
    for (const zero of [false, true]) {
      ctx.beginPath();
      if (!zero) {
        for (const t of xTicks) {
          const x = this.snap(rect.left + t.at);
          ctx.moveTo(x, rect.top);
          ctx.lineTo(x, rect.bottom);
        }
      }
      for (const t of yTicks) {
        if (!!t.zero !== zero) continue;
        const y = this.snap(rect.top + t.at);
        ctx.moveTo(rect.left, y);
        ctx.lineTo(rect.right, y);
      }
      ctx.strokeStyle = zero ? this.colors.zero : this.colors.grid;
      ctx.stroke();
    }

    ctx.fillStyle = this.colors.label;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const t of yTicks) {
      const y = rect.top + t.at;
      if (y >= rect.top + 3 && y <= rect.bottom - 3) ctx.fillText(t.label, rect.left - 6, y);
    }
    if (yUnit) {
      ctx.textBaseline = 'top';
      ctx.fillText(yUnit, rect.left - 6, rect.top - 13);
    }
    if (xLabels) {
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      for (const t of xTicks) {
        const half = ctx.measureText(t.label).width / 2;
        const x = Math.min(Math.max(rect.left + t.at, rect.left + half), rect.right - half);
        ctx.fillText(t.label, x, rect.bottom + 4);
      }
      if (xUnit) {
        ctx.textAlign = 'left';
        ctx.fillText(xUnit, rect.right + 4, rect.bottom + 4);
      }
    }
  }

  crosshair(rect, x) {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1 / this.dpr;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.4)';
    ctx.beginPath();
    const sx = this.snap(rect.left + x);
    ctx.moveTo(sx, rect.top);
    ctx.lineTo(sx, rect.bottom);
    ctx.stroke();
    ctx.restore();
  }

  /** Peak marker: a small ring at (x, y) with a label pill above it. */
  marker(rect, x, y, color, text) {
    const { ctx } = this;
    const px = rect.left + x, py = Math.max(rect.top + 22, rect.top + y);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(px, py, 3.5, 0, Math.PI * 2);
    ctx.stroke();
    const w = ctx.measureText(text).width + 10;
    const lx = Math.min(Math.max(px - w / 2, rect.left + 2), rect.right - w - 2);
    ctx.fillStyle = 'rgba(8, 11, 18, 0.85)';
    ctx.beginPath();
    ctx.roundRect(lx, py - 20, w, 15, 4);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, lx + 5, py - 12.5);
    ctx.restore();
  }

  /** Small caption pinned to the plot's top-right corner. */
  badge(rect, text) {
    const { ctx } = this;
    ctx.fillStyle = this.colors.label;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(text, rect.right - 8, rect.top + 6);
  }

  message(rect, text) {
    const { ctx } = this;
    ctx.fillStyle = this.colors.label;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, (rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
  }
}
