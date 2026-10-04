// WebGL2 renderer. Samples live in integer textures laid out as ring buffers; each
// trace is drawn as one quad per pixel column whose vertex shader finds the
// column's min/max from the coarsest pyramid level that resolves it. Draw cost
// depends on plot width, not on the sample rate or window length.
import { L1_SHIFT, L2_SHIFT } from './ring.js';

const TRACE_VS = `#version 300 es
precision highp float;
precision highp int;
precision highp isampler2D;

uniform isampler2D u_raw, u_min1, u_max1, u_min2, u_max2;
uniform ivec3 u_wShift;   // log2 texture width per level
uniform int u_mask;       // ring capacity - 1
uniform int u_refSlot;    // ring slot of reference sample R
uniform int u_level;
uniform float u_spp;      // samples per pixel column
uniform float u_c0;       // first column's start, in samples relative to R
uniform float u_xOffset;  // first column's x, in pixels (<= 0)
uniform float u_relMin, u_relMax;
uniform vec3 u_axis;      // one-hot axis selector
uniform float u_scale, u_offset;
uniform vec2 u_yRange, u_size;
uniform float u_pad;

flat out float v_lo, v_hi;
out float v_y;

int slotOf(int rel) { return (u_refSlot + rel + u_mask + 1) & u_mask; }
ivec2 texel(int slot, int shift) { return ivec2(slot & ((1 << shift) - 1), slot >> shift); }

float raw(int rel) {
  return dot(vec3(texelFetch(u_raw, texel(slotOf(rel), u_wShift.x), 0).xyz), u_axis);
}

float rawAt(float rel) {
  float r0 = floor(rel);
  float v0 = raw(int(r0));
  float f = rel - r0;
  return f > 0.0 ? mix(v0, raw(int(r0) + 1), f) : v0;
}

void main() {
  int j = gl_InstanceID;
  float a = max(u_c0 + float(j) * u_spp, u_relMin);
  float b = min(u_c0 + float(j + 1) * u_spp, u_relMax);
  if (b <= a) {
    gl_Position = vec4(2.0, 2.0, 0.0, 1.0);
    v_lo = v_hi = v_y = 0.0;
    return;
  }

  float lo, hi;
  if (u_level == 0) {
    // Exact: interpolated endpoints plus every sample inside the column
    float va = rawAt(a), vb = rawAt(b);
    lo = min(va, vb);
    hi = max(va, vb);
    int i1 = int(floor(b));
    for (int i = int(ceil(a)), k = 0; k < 66 && i <= i1; i++, k++) {
      float v = raw(i);
      lo = min(lo, v);
      hi = max(hi, v);
    }
  } else {
    int shift = u_level == 1 ? ${L1_SHIFT} : ${L2_SHIFT};
    int wShift = u_level == 1 ? u_wShift.y : u_wShift.z;
    int blockMask = ((u_mask + 1) >> shift) - 1;
    int first = slotOf(int(floor(a))) >> shift;
    int n = (((slotOf(int(ceil(b)) - 1) >> shift) - first + blockMask + 1) & blockMask) + 1;
    lo = 1e9;
    hi = -1e9;
    for (int k = 0; k < 72 && k < n; k++) {
      ivec2 t = texel((first + k) & blockMask, wShift);
      vec3 mn = vec3(u_level == 1 ? texelFetch(u_min1, t, 0).xyz : texelFetch(u_min2, t, 0).xyz);
      vec3 mx = vec3(u_level == 1 ? texelFetch(u_max1, t, 0).xyz : texelFetch(u_max2, t, 0).xyz);
      lo = min(lo, dot(mn, u_axis));
      hi = max(hi, dot(mx, u_axis));
    }
  }

  float span = u_yRange.y - u_yRange.x;
  float yLo = ((lo * u_scale - u_offset) - u_yRange.x) / span * u_size.y;
  float yHi = ((hi * u_scale - u_offset) - u_yRange.x) / span * u_size.y;
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  float x = float(j) + u_xOffset + corner.x;
  float y = mix(yLo - u_pad, yHi + u_pad, corner.y);
  v_lo = yLo;
  v_hi = yHi;
  v_y = y;
  gl_Position = vec4(x / u_size.x * 2.0 - 1.0, y / u_size.y * 2.0 - 1.0, 0.0, 1.0);
}`;

// Shared by traces and spectra: a bright core along the min/max band edges, a
// translucent body where the band is wide (dense signal) and a soft glow outside.
const BAND_FS = `#version 300 es
precision highp float;
precision highp int;
uniform vec3 u_color;
uniform float u_lineHalf, u_glow, u_glowStrength, u_body, u_fillAlpha;
uniform int u_fill;
flat in float v_lo, v_hi;
in float v_y;
out vec4 outColor;
void main() {
  float a;
  if (u_fill == 1) {
    float t = clamp(v_y / max(v_hi, 1.0), 0.0, 1.0);
    a = u_fillAlpha * t * t;
  } else {
    float outside = max(max(v_lo - v_y, v_y - v_hi), 0.0);
    float inside = min(v_y - v_lo, v_hi - v_y);
    float core = 1.0 - smoothstep(u_lineHalf - 0.6, u_lineHalf + 0.6, outside);
    core *= mix(1.0, u_body, smoothstep(u_lineHalf, u_lineHalf + 2.5, inside));
    float glow = u_glowStrength * exp(-outside * outside / (u_glow * u_glow));
    a = max(core, glow);
  }
  outColor = vec4(u_color * a, a);
}`;

const SERIES_VS = `#version 300 es
precision highp float;
precision highp int;
uniform sampler2D u_data;
uniform int u_wShift, u_count;
uniform float u_b0, u_b1;   // bin range across the plot
uniform int u_log, u_fill;
uniform vec2 u_yRange, u_size;
uniform float u_pad;
flat out float v_lo, v_hi;
out float v_y;

float value(int i) {
  i = clamp(i, 0, u_count - 1);
  return texelFetch(u_data, ivec2(i & ((1 << u_wShift) - 1), i >> u_wShift), 0).r;
}
float valueAt(float bin) {
  float b0 = floor(bin);
  return mix(value(int(b0)), value(int(b0) + 1), bin - b0);
}
float binAt(float x) {
  float t = x / u_size.x;
  return u_log == 1 ? u_b0 * pow(u_b1 / u_b0, t) : mix(u_b0, u_b1, t);
}

// Peak per pixel column, as spectrum analysers display it
float columnMax(int j) {
  float a = binAt(float(j)), b = binAt(float(j + 1));
  float hi = max(valueAt(a), valueAt(b));
  int i0 = int(ceil(a)), i1 = int(floor(b));
  int stride = max(1, (i1 - i0 + 1) / 64);
  for (int k = 0; k < 64; k++) {
    int i = i0 + k * stride;
    if (i > i1) break;
    hi = max(hi, value(i));
  }
  return hi;
}

void main() {
  int j = gl_InstanceID;
  float peak = columnMax(j);
  float prev = j > 0 ? columnMax(j - 1) : peak;
  // Lines span from the previous column's peak so the trace stays connected
  float lo = u_fill == 1 ? u_yRange.x : min(peak, prev);
  float hi = u_fill == 1 ? peak : max(peak, prev);
  float span = u_yRange.y - u_yRange.x;
  float yLo = (lo - u_yRange.x) / span * u_size.y;
  float yHi = (hi - u_yRange.x) / span * u_size.y;
  float pad = u_fill == 1 ? 0.0 : u_pad;
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  float y = mix(yLo - pad, yHi + pad, corner.y);
  v_lo = yLo;
  v_hi = yHi;
  v_y = y;
  gl_Position = vec4((float(j) + corner.x) / u_size.x * 2.0 - 1.0, y / u_size.y * 2.0 - 1.0, 0.0, 1.0);
}`;

const SPECTRO_VS = `#version 300 es
out vec2 v_uv;
void main() {
  v_uv = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  gl_Position = vec4(v_uv * 2.0 - 1.0, 0.0, 1.0);
}`;

const SPECTRO_FS = `#version 300 es
precision highp float;
uniform sampler2D u_spec, u_lut;
uniform float u_rows;                 // texture height = column ring length
uniform float u_colStart, u_colSpan;  // visible columns
uniform float u_validFrom, u_validTo; // computed columns, relative to u_colStart
uniform float u_edge;                 // last column drawn (the newest one is stretched to the head)
uniform float u_fLo, u_fHi, u_halfBin;
uniform int u_log;
uniform float u_dbMin, u_dbMax;
in vec2 v_uv;
out vec4 outColor;
void main() {
  float c = v_uv.x * u_colSpan;
  if (c < u_validFrom - 0.5 || c > u_edge) {
    outColor = vec4(0.0);
    return;
  }
  c = clamp(c, u_validFrom, u_validTo);
  float f = u_log == 1 ? u_fLo * pow(u_fHi / u_fLo, v_uv.y) : mix(u_fLo, u_fHi, v_uv.y);
  float db = texture(u_spec, vec2(f + u_halfBin, (u_colStart + c + 0.5) / u_rows)).r;
  float t = clamp((db - u_dbMin) / (u_dbMax - u_dbMin), 0.0, 1.0);
  outColor = vec4(texture(u_lut, vec2(t, 0.5)).rgb, 1.0);
}`;

// matplotlib "inferno" at tenths
export const INFERNO = ['#000004', '#160b39', '#420a68', '#6a176e', '#932667', '#bc3754', '#dd513a', '#f37819', '#fca50a', '#f6d746', '#fcffa4'];

export function hexToRgb(hex) {
  const v = parseInt(hex.trim().replace('#', ''), 16);
  return [(v >> 16) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
}

function compile(gl, vsSource, fsSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vsSource], [gl.FRAGMENT_SHADER, fsSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  const uniforms = {};
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const name = gl.getActiveUniform(program, i).name;
    uniforms[name] = gl.getUniformLocation(program, name);
  }
  return { program, uniforms };
}

function texture(gl, internalFormat, width, height, format, type, filter = gl.NEAREST) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, width, height, 0, format, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

/** A ring-buffer texture: slot i lives at (i % width, i / width). */
class RingTexture {
  constructor(gl, slots, maxWidth) {
    this.gl = gl;
    this.slots = slots;
    this.width = Math.min(slots, maxWidth);
    this.shift = Math.log2(this.width);
    this.tex = texture(gl, gl.RGB16I, this.width, slots / this.width, gl.RGB_INTEGER, gl.SHORT);
  }

  /** Upload `count` slots starting at `slot` (wrapping) from interleaved XYZ `data`. */
  upload(data, slot, count) {
    const { gl, width, slots } = this;
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    const put = (s, w, h) => gl.texSubImage2D(gl.TEXTURE_2D, 0, s % width, Math.floor(s / width), w, h, gl.RGB_INTEGER, gl.SHORT, data, s * 3);
    count = Math.min(count, slots);
    while (count > 0) {
      let run = Math.min(count, slots - slot); // contiguous until the ring wraps
      count -= run;
      let s = slot;
      slot = (slot + run) % slots;
      if (s % width) {
        const n = Math.min(run, width - (s % width));
        put(s, n, 1);
        s += n;
        run -= n;
      }
      if (run >= width) {
        const rows = Math.floor(run / width);
        put(s, width, rows);
        s += rows * width;
        run -= rows * width;
      }
      if (run > 0) put(s, run, 1);
    }
  }

  dispose() {
    this.gl.deleteTexture(this.tex);
  }
}

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: true, premultipliedAlpha: true, powerPreference: 'high-performance' });
    if (!gl) throw new Error('This browser does not support WebGL2.');
    this.gl = gl;
    this.canvas = canvas;
    this.maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.texWidth = Math.min(4096, this.maxTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.vao = gl.createVertexArray();
    this.trace = compile(gl, TRACE_VS, BAND_FS);
    this.series = compile(gl, SERIES_VS, BAND_FS);
    this.spectro = compile(gl, SPECTRO_VS, SPECTRO_FS);
    this.rings = new Map(); // SampleRing -> GPU mirror
    this.seriesTextures = new Map(); // key -> { tex, count, shift }
    this.spectroTex = null;
    this.lut = this.createLut();
  }

  createLut() {
    const { gl } = this;
    const data = new Uint8Array(256 * 4);
    const stops = INFERNO.map(hexToRgb);
    for (let i = 0; i < 256; i++) {
      const p = (i / 255) * (stops.length - 1);
      const k = Math.min(stops.length - 2, Math.floor(p));
      const f = p - k;
      for (let c = 0; c < 3; c++) data[i * 4 + c] = Math.round((stops[k][c] * (1 - f) + stops[k + 1][c] * f) * 255);
      data[i * 4 + 3] = 255;
    }
    const tex = texture(gl, gl.RGBA8, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, gl.LINEAR);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 256, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return tex;
  }

  /** Match the drawing buffer to the window; returns the device pixel ratio. */
  beginFrame() {
    const { gl, canvas } = this;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(window.innerWidth * dpr);
    const height = Math.round(window.innerHeight * dpr);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.SCISSOR_TEST);
    gl.enable(gl.BLEND);
    gl.bindVertexArray(this.vao);
    this.dpr = dpr;
    return dpr;
  }

  /** Point the viewport at a plot's on-screen rect (CSS pixels); returns its size in device pixels. */
  setRect(rect) {
    const { gl, dpr, canvas } = this;
    const x0 = Math.round(rect.left * dpr), x1 = Math.round(rect.right * dpr);
    const y0 = Math.round(rect.top * dpr), y1 = Math.round(rect.bottom * dpr);
    const w = x1 - x0, h = y1 - y0;
    if (w <= 0 || h <= 0 || y1 < 0 || y0 > canvas.height) return null;
    gl.viewport(x0, canvas.height - y1, w, h);
    gl.scissor(x0, canvas.height - y1, w, h);
    return { w, h };
  }

  /** Mirror new samples (and their pyramid blocks) into the ring's textures. */
  syncRing(ring) {
    let gpu = this.rings.get(ring);
    if (!gpu || gpu.generation !== ring.generation) {
      if (gpu) gpu.levels.forEach((t) => t.dispose());
      const { gl, texWidth } = this;
      const cap = ring.capacity;
      gpu = {
        generation: ring.generation,
        levels: [
          new RingTexture(gl, cap, texWidth),
          new RingTexture(gl, cap >> L1_SHIFT, texWidth),
          new RingTexture(gl, cap >> L1_SHIFT, texWidth),
          new RingTexture(gl, cap >> L2_SHIFT, texWidth),
          new RingTexture(gl, cap >> L2_SHIFT, texWidth),
        ],
      };
      this.rings.set(ring, gpu);
      ring.dirtyFrom = Math.max(0, ring.count - cap);
    }
    const from = Math.max(ring.dirtyFrom, ring.count - ring.capacity);
    const to = ring.count;
    if (to > from) {
      const [raw, min1, max1, min2, max2] = gpu.levels;
      raw.upload(ring.raw, from & ring.mask, to - from);
      for (const [lo, hi, shift, mins, maxs] of [[min1, max1, L1_SHIFT, ring.min1, ring.max1], [min2, max2, L2_SHIFT, ring.min2, ring.max2]]) {
        const b0 = Math.floor(from / 2 ** shift), b1 = Math.floor((to - 1) / 2 ** shift);
        const slot = b0 & (lo.slots - 1);
        lo.upload(mins, slot, b1 - b0 + 1);
        hi.upload(maxs, slot, b1 - b0 + 1);
      }
    }
    ring.dirtyFrom = ring.count;
  }

  forgetRing(ring) {
    const gpu = this.rings.get(ring);
    if (gpu) gpu.levels.forEach((t) => t.dispose());
    this.rings.delete(ring);
  }

  /** Draw one axis of a channel: `head` is the absolute sample at the right edge. */
  drawTrace(rect, ring, p) {
    const size = this.setRect(rect);
    const gpu = this.rings.get(ring);
    if (!size || !gpu) return;
    const { gl } = this;
    const { program, uniforms: u } = this.trace;
    const spp = p.windowSamples / size.w;
    const level = spp <= 48 ? 0 : spp <= 48 << L1_SHIFT ? 1 : 2;
    const R = Math.floor(p.head);
    const kStart = Math.floor((p.head - p.windowSamples) / spp);
    gl.useProgram(program);
    gpu.levels.forEach((t, i) => {
      gl.activeTexture(gl.TEXTURE0 + i);
      gl.bindTexture(gl.TEXTURE_2D, t.tex);
    });
    gl.uniform1i(u.u_raw, 0);
    gl.uniform1i(u.u_min1, 1);
    gl.uniform1i(u.u_max1, 2);
    gl.uniform1i(u.u_min2, 3);
    gl.uniform1i(u.u_max2, 4);
    gl.uniform3i(u.u_wShift, gpu.levels[0].shift, gpu.levels[1].shift, gpu.levels[3].shift);
    gl.uniform1i(u.u_mask, ring.mask);
    gl.uniform1i(u.u_refSlot, R & ring.mask);
    gl.uniform1i(u.u_level, level);
    gl.uniform1f(u.u_spp, spp);
    gl.uniform1f(u.u_c0, kStart * spp - R);
    gl.uniform1f(u.u_xOffset, (kStart * spp - (p.head - p.windowSamples)) / spp);
    gl.uniform1f(u.u_relMin, ring.oldest - R);
    gl.uniform1f(u.u_relMax, p.head - R);
    gl.uniform3f(u.u_axis, p.axis === 0 ? 1 : 0, p.axis === 1 ? 1 : 0, p.axis === 2 ? 1 : 0);
    gl.uniform1f(u.u_scale, p.scale);
    gl.uniform1f(u.u_offset, p.offset);
    gl.uniform2f(u.u_yRange, p.yLo, p.yHi);
    gl.uniform2f(u.u_size, size.w, size.h);
    this.setBandStyle(u, p.color, 0);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, size.w + 2);
  }

  setBandStyle(u, color, fill) {
    const { gl, dpr } = this;
    const lineHalf = 0.75 * dpr, glow = 5 * dpr;
    gl.uniform3f(u.u_color, color[0], color[1], color[2]);
    gl.uniform1f(u.u_lineHalf, lineHalf);
    gl.uniform1f(u.u_glow, glow);
    gl.uniform1f(u.u_glowStrength, 0.22);
    gl.uniform1f(u.u_body, 0.38);
    gl.uniform1f(u.u_fillAlpha, 0.28);
    gl.uniform1f(u.u_pad, lineHalf + glow * 1.8);
    gl.uniform1i(u.u_fill, fill);
  }

  /** Upload a 1-D series (e.g. a spectrum in display units). */
  setSeries(key, values) {
    const { gl } = this;
    let entry = this.seriesTextures.get(key);
    if (!entry || entry.count !== values.length) {
      if (entry) gl.deleteTexture(entry.tex);
      const width = Math.min(values.length, this.texWidth);
      entry = { count: values.length, shift: Math.log2(width), width };
      entry.tex = texture(gl, gl.R32F, width, values.length / width, gl.RED, gl.FLOAT);
      this.seriesTextures.set(key, entry);
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, entry.width, entry.count / entry.width, gl.RED, gl.FLOAT, values);
  }

  /** Draw a series over bins [b0, b1] as a glowing line with a gradient fill. */
  drawSeries(rect, key, p) {
    const size = this.setRect(rect);
    const entry = this.seriesTextures.get(key);
    if (!size || !entry) return;
    const { gl } = this;
    const { program, uniforms: u } = this.series;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, entry.tex);
    gl.uniform1i(u.u_data, 5);
    gl.uniform1i(u.u_wShift, entry.shift);
    gl.uniform1i(u.u_count, entry.count);
    gl.uniform1f(u.u_b0, p.b0);
    gl.uniform1f(u.u_b1, p.b1);
    gl.uniform1i(u.u_log, p.log ? 1 : 0);
    gl.uniform2f(u.u_yRange, p.yLo, p.yHi);
    gl.uniform2f(u.u_size, size.w, size.h);
    gl.blendFunc(gl.ONE, gl.ONE);
    for (const fill of [1, 0]) {
      this.setBandStyle(u, p.color, fill);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, size.w + 1);
    }
  }

  /** Upload pending spectrogram columns (rows of the texture). */
  syncSpectrogram(sg) {
    const { gl } = this;
    if (!sg.bins) return;
    if (!this.spectroTex || this.spectroTex.generation !== sg.generation) {
      if (this.spectroTex) gl.deleteTexture(this.spectroTex.tex);
      const tex = texture(gl, gl.R16F, sg.bins, sg.columns, gl.RED, gl.FLOAT, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      this.spectroTex = { tex, generation: sg.generation };
    }
    gl.bindTexture(gl.TEXTURE_2D, this.spectroTex.tex);
    for (const { column, row } of sg.pending) {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, column % sg.columns, sg.bins, 1, gl.RED, gl.FLOAT, row);
    }
    sg.recycle();
  }

  drawSpectrogram(rect, sg, p) {
    const size = this.setRect(rect);
    if (!size || !this.spectroTex || sg.last < sg.first) return;
    const { gl } = this;
    const { program, uniforms: u } = this.spectro;
    const colStart = (p.head - p.windowSamples - sg.size / 2) / sg.hop;
    const colSpan = p.windowSamples / sg.hop;
    gl.useProgram(program);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.spectroTex.tex);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.lut);
    gl.uniform1i(u.u_spec, 6);
    gl.uniform1i(u.u_lut, 7);
    gl.uniform1f(u.u_rows, sg.columns);
    gl.uniform1f(u.u_colStart, ((colStart % sg.columns) + sg.columns) % sg.columns);
    gl.uniform1f(u.u_colSpan, colSpan);
    gl.uniform1f(u.u_validFrom, sg.first - colStart);
    gl.uniform1f(u.u_validTo, sg.last - colStart);
    // Each column is centred half an FFT window before its newest sample
    gl.uniform1f(u.u_edge, sg.last - colStart + sg.size / (2 * sg.hop) + 0.5);
    gl.uniform1f(u.u_fLo, p.fLo);
    gl.uniform1f(u.u_fHi, p.fHi);
    gl.uniform1f(u.u_halfBin, 0.5 / sg.bins);
    gl.uniform1i(u.u_log, p.log ? 1 : 0);
    gl.uniform1f(u.u_dbMin, p.dbMin);
    gl.uniform1f(u.u_dbMax, p.dbMax);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
}
