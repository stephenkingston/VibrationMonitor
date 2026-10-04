import { Connection } from './connection.js';
import { Channel, HISTORY_SECONDS } from './channel.js';
import { Renderer, hexToRgb } from './renderer.js';
import { Overlay, linearTicks, frequencyTicks, formatSeconds, formatHz, formatValue } from './overlay.js';
import { Spectrogram, ALL_AXES } from './spectrogram.js';
import { exportCsv } from './export.js';

const $ = (selector, root = document) => root.querySelector(selector);
const css = getComputedStyle(document.documentElement);
const AXIS_NAMES = ['X', 'Y', 'Z'];
const AXIS_HEX = ['--axis-x', '--axis-y', '--axis-z'].map((name) => css.getPropertyValue(name).trim());
const AXIS_RGB = AXIS_HEX.map(hexToRgb);
const SPECTRUM_INTERVAL_MS = 66;
const STATS_INTERVAL_MS = 200;
const SPECTROGRAM_BUDGET_MS = 4;

const state = {
  windowSec: 10,
  paused: false,
  pauseHeads: new Map(),
  pauseDb: 0, // spectrogram colour scale frozen at pause time
  offsetSec: 0, // when paused: how far the view sits behind the pause point
  axes: [true, true, true],
  removeDc: false,
  fixedG: 0, // 0 = autoscale
  spectrumDb: true,
  logFreq: true,
  hover: null,
  drag: null,
};

let channels = [];
let plots = [];
let renderer, overlay, spectrogram, connection;
let spectrogramPlot;

// ---------- View helpers ----------

/** Absolute sample index at the right edge of the view for a channel. */
function viewHead(ch) {
  if (!state.paused) return ch.head;
  return (state.pauseHeads.get(ch) ?? ch.head) - state.offsetSec * ch.rate;
}

function viewTimes() {
  const end = state.paused ? -state.offsetSec : 0;
  return { start: end - state.windowSec, end };
}

/** Top of the spectrogram colour scale; held while paused so the image doesn't shift. */
function spectrogramTop() {
  return state.paused ? state.pauseDb : spectrogram.peakDb;
}

function liveChannels() {
  return channels.filter((ch) => ch.hasData);
}

function windowLimits() {
  const live = liveChannels();
  const maxRate = live.length ? Math.max(...live.map((ch) => ch.rate)) : Infinity;
  const capacitySeconds = Math.min(HISTORY_SECONDS, ...live.map((ch) => (ch.ring.capacity * 0.98) / ch.rate));
  return { min: Math.max(1e-3, 24 / maxRate), max: capacitySeconds };
}

function setWindow(seconds) {
  const { min, max } = windowLimits();
  state.windowSec = Math.min(max, Math.max(min, seconds));
  clampOffset();
  syncPressed($('#window-select'), (v) => Math.abs(+v - state.windowSec) < 1e-6 * state.windowSec);
}

function clampOffset() {
  if (!state.paused) return;
  const live = liveChannels();
  const max = Math.min(...live.map((ch) => (state.pauseHeads.get(ch) - ch.ring.oldest) / ch.rate)) - state.windowSec;
  state.offsetSec = Math.min(Math.max(state.offsetSec, 0), Math.max(0, isFinite(max) ? max : 0));
}

function setPaused(paused) {
  if (paused === state.paused) return;
  state.paused = paused;
  if (paused) {
    state.pauseHeads = new Map(channels.map((ch) => [ch, ch.head]));
    state.pauseDb = spectrogram.peakDb;
    state.offsetSec = 0;
  }
  document.body.classList.toggle('paused', paused);
  $('#pause-btn span').textContent = paused ? 'Live' : 'Pause';
}

// ---------- Layout ----------

function measure() {
  for (const plot of plots) {
    const r = plot.el.getBoundingClientRect();
    plot.rect = { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  }
}

function channelRow(ch) {
  const row = document.createElement('section');
  row.className = 'panel channel-row';
  row.innerHTML = `
    <div class="side">
      <div class="ch-title"><span class="ch-badge">CH ${ch.id + 1}</span><span class="ch-port">UDP ${ch.port}</span></div>
      <div class="ch-rate waiting"><span class="value">waiting…</span><span class="unit"></span></div>
      <ul class="ch-stats" title="AC RMS over the last second and the dominant frequency">
        ${AXIS_NAMES.map((name, a) => `<li><span class="name axis-${a}">${name}</span><span class="rms">—</span><span class="peak">—</span></li>`).join('')}
      </ul>
    </div>
    <div class="plot-cell"><div class="plot time-plot"></div></div>
    <div class="plot-cell spectrum-cell"><div class="plot spectrum-plot"></div></div>`;
  ch.dom = {
    rate: $('.ch-rate', row),
    stats: [...row.querySelectorAll('.ch-stats li')].map((li) => ({ li, rms: $('.rms', li), peak: $('.peak', li) })),
  };
  return row;
}

function buildChannels(hello) {
  const dashboard = $('#dashboard');
  dashboard.querySelectorAll('.channel-row').forEach((row) => row.remove());
  channels.forEach((ch) => renderer.forgetRing(ch.ring));
  channels = hello.channels.map((info) => new Channel(info, hello.fullScaleG));
  dashboard.style.setProperty('--channels', channels.length);

  plots = [];
  for (const ch of channels) {
    const row = channelRow(ch);
    dashboard.insertBefore(row, $('#spectrogram-row'));
    const time = { kind: 'time', el: $('.time-plot', row), channel: ch };
    const spectrum = { kind: 'spectrum', el: $('.spectrum-plot', row), channel: ch };
    attachTimeInteractions(time);
    attachHover(spectrum);
    plots.push(time, spectrum);
  }
  plots.push(spectrogramPlot);

  const picker = $('#spectrogram-channel');
  picker.innerHTML = channels.map((ch) => `<button data-value="${ch.id}">CH ${ch.id + 1}</button>`).join('');
  spectrogram.configure(channels[0] ?? null, spectrogram.axis);
  syncPressed(picker, (v) => +v === spectrogram.channel?.id);
  measure();
}

// ---------- Interaction ----------

function hoverAt(plot, event) {
  const r = plot.el.getBoundingClientRect();
  state.hover = {
    plot,
    u: Math.min(1, Math.max(0, (event.clientX - r.left) / r.width)),
    v: Math.min(1, Math.max(0, (event.clientY - r.top) / r.height)),
    x: event.clientX,
    y: event.clientY,
  };
}

function attachHover(plot) {
  plot.el.addEventListener('pointermove', (e) => hoverAt(plot, e));
  plot.el.addEventListener('pointerleave', () => {
    if (!state.drag) state.hover = null;
  });
}

/** Time plots and the spectrogram share one time axis: scroll zooms, drag pans, double-click returns to live. */
function attachTimeInteractions(plot) {
  const { el } = plot;
  attachHover(plot);
  el.addEventListener('wheel', (e) => {
    e.preventDefault();
    const delta = e.deltaY * (e.deltaMode === 1 ? 16 : 1);
    const u = (e.clientX - el.getBoundingClientRect().left) / el.clientWidth;
    const before = state.windowSec;
    setWindow(before * Math.exp(delta * 0.0015));
    if (state.paused) {
      // Keep the time under the cursor fixed; while live the right edge stays pinned to now
      state.offsetSec += (before - state.windowSec) * (1 - u);
      clampOffset();
    }
  }, { passive: false });
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    el.setPointerCapture(e.pointerId);
    state.drag = { x: e.clientX };
    document.body.classList.add('dragging');
  });
  el.addEventListener('pointermove', (e) => {
    if (!state.drag) return;
    const dx = e.clientX - state.drag.x;
    if (!dx) return;
    setPaused(true);
    state.offsetSec += (dx / el.clientWidth) * state.windowSec;
    clampOffset();
    state.drag.x = e.clientX;
  });
  const endDrag = () => {
    state.drag = null;
    document.body.classList.remove('dragging');
  };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('dblclick', () => setPaused(false));
}

/** Make a segmented control's buttons reflect state via aria-pressed. */
function syncPressed(group, isOn) {
  for (const button of group.querySelectorAll('button')) button.setAttribute('aria-pressed', isOn(button.dataset.value));
}

function segmented(selector, onSelect) {
  const group = $(selector);
  group.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (button) onSelect(button.dataset.value, group);
  });
  return group;
}

function toggle(button, initial, onChange) {
  button.setAttribute('aria-pressed', initial);
  button.addEventListener('click', () => {
    const on = button.getAttribute('aria-pressed') !== 'true';
    if (onChange(on) !== false) button.setAttribute('aria-pressed', on);
  });
}

function wireControls() {
  segmented('#window-select', (v) => setWindow(+v));
  setWindow(state.windowSec);

  const scale = segmented('#scale-select', (v, group) => {
    state.fixedG = +v;
    syncPressed(group, (x) => +x === state.fixedG);
  });
  syncPressed(scale, (x) => +x === state.fixedG);

  document.querySelectorAll('#axis-toggles .axis').forEach((button) => {
    const a = +button.dataset.axis;
    toggle(button, state.axes[a], (on) => {
      if (!on && state.axes.filter(Boolean).length === 1) return false; // keep one axis visible
      state.axes[a] = on;
    });
  });
  toggle($('#dc-toggle'), state.removeDc, (on) => {
    state.removeDc = on;
  });

  const units = segmented('#spectrum-units', (v, group) => {
    state.spectrumDb = v === 'db';
    channels.forEach((ch) => (ch.specRange = null));
    syncPressed(group, (x) => (x === 'db') === state.spectrumDb);
    updateSpectra();
  });
  syncPressed(units, (x) => (x === 'db') === state.spectrumDb);
  toggle($('#log-toggle'), state.logFreq, (on) => {
    state.logFreq = on;
  });

  segmented('#spectrogram-channel', (v, group) => {
    spectrogram.configure(channels[+v], spectrogram.axis);
    syncPressed(group, (x) => +x === +v);
  });
  const sgAxis = segmented('#spectrogram-axis', (v, group) => {
    spectrogram.configure(spectrogram.channel, +v);
    syncPressed(group, (x) => +x === +v);
  });
  syncPressed(sgAxis, (x) => +x === ALL_AXES);

  $('#pause-btn').addEventListener('click', () => setPaused(!state.paused));
  const exportButton = $('#export-btn');
  exportButton.addEventListener('click', async () => {
    if (exportButton.disabled) return;
    const label = $('span', exportButton);
    exportButton.disabled = true;
    try {
      const { windowSec } = state;
      await exportCsv(liveChannels().map((channel) => {
        const end = Math.floor(viewHead(channel)) + 1;
        return { channel, start: Math.max(channel.ring.oldest, Math.ceil(end - windowSec * channel.rate)), end };
      }), (fraction) => (label.textContent = `Exporting ${Math.round(fraction * 100)}%`));
    } finally {
      exportButton.disabled = false;
      label.textContent = 'Export CSV';
    }
  });

  // Space and Escape work anywhere except on a control focused from the keyboard
  const shortcutTarget = (e) => e.target === document.body || (e.target.tagName === 'BUTTON' && !e.target.matches(':focus-visible'));
  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space' && shortcutTarget(e)) e.preventDefault();
  });
  window.addEventListener('keydown', (e) => {
    if (!shortcutTarget(e)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      setPaused(!state.paused);
    } else if (e.code === 'Escape') {
      setPaused(false);
    }
  });
}

// ---------- Periodic updates ----------

function updateSpectra() {
  liveChannels().forEach(updateSpectrum);
}

function updateSpectrum(ch) {
  const sp = ch.spectrum;
  const end = Math.floor(viewHead(ch)) + 1;
  if (!ch.hasData || !sp.update(ch.ring, end, ch.rate, ch.scale, state.axes, !state.paused)) return;
  if (!ch.display || ch.display[0].length !== sp.bins) ch.display = [0, 1, 2].map(() => new Float32Array(sp.bins));
  let top = 0;
  for (let a = 0; a < 3; a++) {
    if (!state.axes[a]) continue;
    const amp = sp.amp[a], out = ch.display[a];
    for (let k = 0; k < amp.length; k++) {
      out[k] = state.spectrumDb ? 20 * Math.log10(amp[k] + 1e-9) : amp[k];
      if (k > 1 && amp[k] > top) top = amp[k];
    }
    renderer.setSeries(`${ch.id}:${a}`, out);
  }
  // Ease the vertical range toward the strongest component: 100 dB of range, or 0..peak in g
  const ceiling = Math.ceil((20 * Math.log10(top + 1e-9) + 8) / 10) * 10;
  const [lo, hi] = state.spectrumDb ? [ceiling - 100, ceiling] : [0, Math.max(top * 1.25, 1e-3)];
  if (!ch.specRange) ch.specRange = { lo, hi };
  const ease = state.paused ? 1 : 0.25; // nothing to smooth when the data isn't moving
  ch.specRange.lo += (lo - ch.specRange.lo) * ease;
  ch.specRange.hi += (hi - ch.specRange.hi) * ease;
}

function formatRate(rate) {
  if (rate >= 1e6) return [(rate / 1e6).toFixed(2), 'MHz'];
  if (rate >= 1e3) return [(rate / 1e3).toFixed(2), 'kHz'];
  return [rate.toFixed(1), 'Hz'];
}

function updateStats(now) {
  if (state.windowSec > windowLimits().max) setWindow(state.windowSec);
  for (const ch of channels) {
    const rate = ch.dom.rate;
    rate.classList.toggle('waiting', !ch.hasData);
    if (!ch.hasData) continue;
    ch.updateStats(viewHead(ch));
    const [value, unit] = formatRate(ch.measuredRate);
    $('.value', rate).textContent = value;
    $('.unit', rate).textContent = unit;
    ch.dom.stats.forEach(({ li, rms, peak }, a) => {
      li.classList.toggle('off', !state.axes[a]);
      rms.textContent = `${ch.stats.rms[a].toFixed(3)} g`;
      const p = ch.spectrum.peaks?.[a];
      peak.textContent = p ? formatHz(p.freq) : '—';
    });
  }

  const sg = spectrogram;
  if (sg.bins && sg.channel?.rate) {
    const top = spectrogramTop();
    $('#db-max').textContent = `${Math.round(top)} dB`;
    $('#db-mid').textContent = `${Math.round(top - 40)}`;
    $('#db-min').textContent = `${Math.round(top - 80)} dB`;
    $('#sg-fft').textContent = `${sg.size} pt Hann`;
    $('#sg-df').textContent = formatHz(sg.channel.rate / sg.size);
    $('#sg-dt').textContent = formatSeconds(sg.hop / sg.channel.rate, sg.hop / sg.channel.rate / 10);
  }

  const status = $('#status');
  const recent = channels.filter((ch) => now - (ch.lastData || 0) < 1000).length;
  let label;
  if (connection.state !== 'open') {
    status.dataset.state = connection.state;
    label = connection.state === 'connecting' ? 'Connecting…' : 'Server offline — retrying';
  } else if (state.paused) {
    status.dataset.state = 'paused';
    label = 'Paused · Space to resume';
  } else if (recent) {
    status.dataset.state = 'live';
    label = `Live · ${recent} sensor${recent > 1 ? 's' : ''}`;
  } else {
    status.dataset.state = 'idle';
    label = 'Waiting for sensors';
  }
  $('.label', status).textContent = label;
}

const perf = { frames: 0, work: 0, since: performance.now(), bytes: 0 };

function updatePerf(now) {
  const elapsed = (now - perf.since) / 1000;
  if (elapsed < 1 || !perf.frames) return;
  const totalRate = liveChannels().reduce((sum, ch) => sum + ch.rate, 0);
  const throughput = (connection.bytes - perf.bytes) / elapsed;
  $('#perf-fps').textContent = `${Math.round(perf.frames / elapsed)} fps · ${(perf.work / perf.frames).toFixed(1)} ms`;
  $('#perf-rate').textContent = `${(totalRate / 1000).toFixed(totalRate >= 1e5 ? 0 : 1)} kS/s · ${(throughput / 1e6).toFixed(2)} MB/s`;
  Object.assign(perf, { frames: 0, work: 0, since: now, bytes: connection.bytes });
}

// ---------- Drawing ----------

function spectrumAxis(sp) {
  const binHz = sp.rate / sp.size;
  const fLo = state.logFreq ? Math.max(1, binHz * 2) : 0;
  return { binHz, fLo, fHi: sp.rate / 2 };
}

function freqToU(f, { fLo, fHi }) {
  return state.logFreq ? Math.log(f / fLo) / Math.log(fHi / fLo) : (f - fLo) / (fHi - fLo);
}

function uToFreq(u, { fLo, fHi }) {
  return state.logFreq ? fLo * (fHi / fLo) ** u : fLo + u * (fHi - fLo);
}

function drawTimePlot(plot, isFirst) {
  const { channel: ch, rect } = plot;
  const t = viewTimes();
  const range = ch.yRange;
  overlay.axes(rect, linearTicks(t.start, t.end, rect.width, 96, formatSeconds),
    range.ready ? linearTicks(range.lo, range.hi, rect.height, 30, formatValue, true) : [], { yUnit: 'g' });
  if (!ch.hasData) {
    overlay.message(rect, `Waiting for data on UDP ${ch.port}…`);
    return;
  }
  const head = viewHead(ch);
  for (let a = 0; a < 3; a++) {
    if (!state.axes[a]) continue;
    renderer.drawTrace(rect, ch.ring, {
      head,
      windowSamples: state.windowSec * ch.rate,
      axis: a,
      color: AXIS_RGB[a],
      scale: ch.scale,
      offset: state.removeDc ? ch.dc[a] : 0,
      yLo: range.lo,
      yHi: range.hi,
    });
  }
  const hover = state.hover;
  if (hover && hover.plot.kind !== 'spectrum') overlay.crosshair(rect, hover.u * rect.width);
  if (isFirst && state.paused) overlay.badge(rect, 'PAUSED · double-click for live');
}

function drawSpectrumPlot(plot) {
  const { channel: ch, rect } = plot;
  const sp = ch.spectrum;
  if (!sp.size || !ch.specRange || !ch.hasData) {
    overlay.axes(rect, [], []);
    overlay.message(rect, 'Spectrum');
    return;
  }
  const axis = spectrumAxis(sp);
  const { lo, hi } = ch.specRange;
  overlay.axes(rect, frequencyTicks(axis.fLo, axis.fHi, rect.width, state.logFreq),
    linearTicks(lo, hi, rect.height, 28, formatValue, true), { yUnit: state.spectrumDb ? 'dB' : 'g' });
  overlay.badge(rect, `Hz · Δf ${formatHz(axis.binHz)}`);

  let best = null;
  for (let a = 0; a < 3; a++) {
    if (!state.axes[a]) continue;
    renderer.drawSeries(rect, `${ch.id}:${a}`, {
      b0: axis.fLo / axis.binHz,
      b1: axis.fHi / axis.binHz,
      log: state.logFreq,
      yLo: lo,
      yHi: hi,
      color: AXIS_RGB[a],
    });
    const peak = sp.peaks[a];
    const u = peak ? freqToU(peak.freq, axis) : -1;
    if (u >= 0 && u <= 1 && (!best || peak.amp > best.peak.amp)) best = { peak, a, u };
  }
  if (best) {
    const value = state.spectrumDb ? 20 * Math.log10(best.peak.amp) : best.peak.amp;
    overlay.marker(rect, best.u * rect.width, (1 - (value - lo) / (hi - lo)) * rect.height, AXIS_HEX[best.a], formatHz(best.peak.freq));
  }
  const hover = state.hover;
  if (hover && hover.plot.kind === 'spectrum' && hover.plot.channel.spectrum.rate) {
    const f = uToFreq(hover.u, spectrumAxis(hover.plot.channel.spectrum));
    overlay.crosshair(rect, freqToU(f, axis) * rect.width);
  }
}

function drawSpectrogramPlot(plot) {
  const { rect } = plot;
  const sg = spectrogram;
  const ch = sg.channel;
  const t = viewTimes();
  const ready = ch?.hasData && sg.bins;
  const fLo = state.logFreq && ready ? Math.max(1, (ch.rate / sg.size) * 2) : 0;
  const fHi = ready ? ch.rate / 2 : 1;
  const fTicks = ready ? frequencyTicks(fLo, fHi, rect.height, state.logFreq).map((tick) => ({ ...tick, at: rect.height - tick.at })) : [];
  overlay.axes(rect, linearTicks(t.start, t.end, rect.width, 96, formatSeconds), fTicks, { yUnit: 'Hz' });
  if (!ready) {
    overlay.message(rect, 'Spectrogram');
    return;
  }
  renderer.drawSpectrogram(rect, sg, {
    head: viewHead(ch),
    windowSamples: state.windowSec * ch.rate,
    fLo: fLo / fHi,
    fHi: 1,
    log: state.logFreq,
    dbMin: spectrogramTop() - 80,
    dbMax: spectrogramTop(),
  });
  const hover = state.hover;
  if (hover && hover.plot.kind !== 'spectrum') overlay.crosshair(rect, hover.u * rect.width);
}

function updateTooltip() {
  const tip = $('#tooltip');
  const hover = state.hover;
  if (!hover || state.drag) {
    tip.hidden = true;
    return;
  }
  const { plot } = hover;
  const rows = [];
  let head = '';
  if (plot.kind === 'spectrum') {
    const sp = plot.channel.spectrum;
    if (!sp.rate) return void (tip.hidden = true);
    const axis = spectrumAxis(sp);
    const f = uToFreq(hover.u, axis);
    const k = Math.min(sp.bins - 1, Math.round(f / axis.binHz));
    head = `CH ${plot.channel.id + 1} · ${formatHz(f)}`;
    for (let a = 0; a < 3; a++) {
      if (!state.axes[a]) continue;
      const amp = sp.amp[a][k];
      rows.push([a, state.spectrumDb ? `${(20 * Math.log10(amp + 1e-9)).toFixed(1)} dB` : `${amp.toFixed(4)} g`]);
    }
  } else {
    const t = viewTimes();
    const time = t.start + hover.u * state.windowSec;
    const ch = plot.kind === 'time' ? plot.channel : spectrogram.channel;
    if (!ch?.hasData) return void (tip.hidden = true);
    if (plot.kind === 'spectrogram') {
      const nyq = ch.rate / 2;
      const fLo = state.logFreq ? Math.max(1, (ch.rate / spectrogram.size) * 2) : 0;
      const f = state.logFreq ? fLo * (nyq / fLo) ** (1 - hover.v) : (1 - hover.v) * nyq;
      head = `CH ${ch.id + 1} · ${formatSeconds(time, state.windowSec / 1000, state.windowSec / 10)} · ${formatHz(f)}`;
    } else {
      head = `CH ${ch.id + 1} · ${formatSeconds(time, state.windowSec / 1000, state.windowSec / 10)}`;
      const index = Math.round(viewHead(ch) - (1 - hover.u) * state.windowSec * ch.rate);
      if (index >= ch.ring.oldest && index < ch.ring.count) {
        for (let a = 0; a < 3; a++) {
          if (state.axes[a]) rows.push([a, `${formatValue(ch.ring.value(index, a) * ch.scale, 0.001)} g`]);
        }
      }
    }
  }
  tip.innerHTML = `<div class="head">${head}</div>` + rows.map(([a, text]) =>
    `<div class="row axis-${a}"><b></b><span>${AXIS_NAMES[a]}</span><span>${text}</span></div>`).join('');
  tip.hidden = false;
  const { offsetWidth: w, offsetHeight: h } = tip;
  const x = hover.x + 16 + w > window.innerWidth ? hover.x - 16 - w : hover.x + 16;
  const y = hover.y + 16 + h > window.innerHeight ? hover.y - 16 - h : hover.y + 16;
  tip.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  tip.style.left = tip.style.top = '0';
}

function draw() {
  const dpr = renderer.beginFrame();
  overlay.begin(dpr);
  let first = true;
  for (const plot of plots) {
    if (!plot.rect) continue;
    if (plot.kind === 'time') {
      drawTimePlot(plot, first);
      first = false;
    } else if (plot.kind === 'spectrum') {
      drawSpectrumPlot(plot);
    } else {
      drawSpectrogramPlot(plot);
    }
  }
  updateTooltip();
}

// ---------- Main loop ----------

let lastFrame = performance.now();
let lastSpectrum = 0;
let spectrumCursor = 0;
let lastStats = 0;

function frame(now) {
  const dt = Math.min(0.1, (now - lastFrame) / 1000);
  lastFrame = now;
  const started = performance.now();

  for (const ch of channels) {
    ch.advance(dt);
    renderer.syncRing(ch.ring);
    if (state.removeDc) ch.updateDc(dt);
  }
  const sgChannel = spectrogram.channel;
  if (sgChannel) spectrogram.update(SPECTROGRAM_BUDGET_MS, viewHead(sgChannel) - state.windowSec * sgChannel.rate);
  spectrogram.decay(dt);
  renderer.syncSpectrogram(spectrogram);
  // One channel's spectrum per tick, round-robin, so FFT work never piles into a single frame
  if (channels.length && now - lastSpectrum > SPECTRUM_INTERVAL_MS / channels.length) {
    lastSpectrum = now;
    updateSpectrum(channels[spectrumCursor++ % channels.length]);
  }
  if (now - lastStats > STATS_INTERVAL_MS) {
    lastStats = now;
    updateStats(now);
  }
  for (const ch of liveChannels()) {
    ch.updateYRange(viewHead(ch), state.windowSec * ch.rate, state.axes, state.removeDc, state.fixedG, dt);
  }
  draw();

  perf.frames++;
  perf.work += performance.now() - started;
  updatePerf(now);
  requestAnimationFrame(frame);
}

function fatal(message) {
  const box = $('#fatal');
  box.textContent = message;
  box.hidden = false;
}

function init() {
  try {
    renderer = new Renderer($('#gl-layer'));
  } catch (err) {
    fatal(err.message);
    return;
  }
  $('#gl-layer').addEventListener('webglcontextlost', () => fatal('The graphics context was lost. Reload the page to continue.'));
  overlay = new Overlay($('#grid-layer'));
  spectrogram = new Spectrogram(Math.min(4096, renderer.maxTexture));
  spectrogramPlot = { kind: 'spectrogram', el: $('#spectrogram-plot') };
  attachTimeInteractions(spectrogramPlot);
  plots = [spectrogramPlot];
  wireControls();

  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
  connection = new Connection(url, {
    onHello(hello) {
      const same = channels.length === hello.channels.length && hello.channels.every((c, i) => channels[i].port === c.port);
      if (same) channels.forEach((ch) => ch.resync());
      else buildChannels(hello);
    },
    onSamples(index, first, rate, samples) {
      const ch = channels[index];
      if (!ch) return;
      ch.push(first, rate, samples);
      ch.lastData = performance.now();
    },
  });

  window.addEventListener('resize', measure);
  window.addEventListener('scroll', measure, { passive: true });
  new ResizeObserver(measure).observe($('#dashboard'));
  measure();
  requestAnimationFrame(frame);
}

init();
