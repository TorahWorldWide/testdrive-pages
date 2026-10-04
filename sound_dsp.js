"use strict";
// SoundDsp: the sound editing that the Sounds page and the game share. A layer of a sound (a row in
// Assets/StreamingAssets/Sounds.json) can carry optional edit fields; this turns one recording's samples into the
// edited samples. The game runs the very same steps from Assets/Scripts/SfxDsp.cs (C# `double` where this has JS
// numbers), so what the page plays is what the game plays. Keep the two files identical in WHAT they compute.
// Tests: docs/claude-tools/sound_dsp_test.mjs (it also writes docs/claude-tools/sound_dsp_fixtures.json) and the
// C# test, which must reproduce those fixtures within 1e-4 (lengths exactly).
//
// The layer fields (all optional; absent = off = the recording exactly as it is):
//   cuts       {"<take>": [start, end]}  seconds; where each recording starts and ends (per take, because a layer's
//              takes are different recordings). end <= start, or end missing, = to the end of the recording.
//   reverse    true = the cut plays backwards.
//   fadeIn, fadeOut   0 to 2 s.
//   eqLow      -15 to 15 dB, a low shelf at 200 Hz.      eqHigh  -15 to 15 dB, a high shelf at 5000 Hz.
//   eqMid      -15 to 15 dB, a peak at 1200 Hz (Q 0.9).
//   drive      0 to 1, distortion (a soft clip).
//   echo       0 to 1, how loud the repeats are;  echoDelay  0.02 to 1 s between repeats (default 0.25).
//   reverb     0 to 1, how loud the room is.
//   delay      0 to 2 s: this layer starts this long after the sound starts. Scheduling only: process() ignores it.
//
// The steps of process(), on each channel alone, in this order. Everything is computed in double precision, and every
// step stores its result as 32-bit floats before the next step starts. No randomness.
//   1. Cut      keep samples [floor(s*sr), floor(e*sr)), at least 1 sample (s, e = start, end clamped into the recording).
//               A cut that runs to the end ends at sample N exactly (floor((N/sr)*sr) is N-1 for about 8% of lengths).
//   2. Reverse
//   3. Fades    fade in first (x[i] *= i / nIn), then fade out (x[i] *= (L-1-i) / nOut)
//   4. EQ       RBJ cookbook biquads (Direct Form I) in the order low, mid, high; a band only if its gain is not 0
//   5. Drive    x = tanh(k*x) / tanh(k)
//   6. Echo     a feedback delay; the sound ends 8 echo delays later than it did
//   7. Reverb   4 combs in parallel, 2 allpasses in series; the sound ends 1.5 s later than it did
//   8. Clamp    every sample to [-1, 1]
// "round" is round-half-up, floor(v + 0.5), in both files. C#'s Math.Round rounds halves to even and would disagree:
// the 5.0 ms allpass at 44100 Hz is exactly 220.5 samples (here: 221; Math.Round: 220).
//
// The API (a classic script: load it before sounds.js; it defines one global const, SoundDsp):
//   SoundDsp.FIELDS      the sliders' table: { name, label, unit, min, max, default, step, processing, hint } per number field
//   SoundDsp.isPlain(layer, take)   true = use the recording exactly as it is (skip process)
//   SoundDsp.process(channels, sampleRate, layer, take)   Float32Array[] in, new Float32Array[] out (longer by the tails)

const SoundDsp = (() => {
  // ---- Shared constants. The same block, with the same values, is at the top of Assets/Scripts/SfxDsp.cs. ----
  //  EQ: 200 Hz low shelf, 1200 Hz peak with Q 0.9, 5000 Hz high shelf (slope 1); f0 is at most 0.45 x the sample rate.
  //  Drive: k = 1 + 20 x drive.
  //  Echo: feedback 0.4, a tail of 8 echoes.
  //  Reverb: combs 29.7 / 37.1 / 41.1 / 43.7 ms with feedback 0.77; allpasses 5.0 / 1.7 ms with gain 0.7; a tail of 1.5 s.
  const EQ_LOW_HZ = 200, EQ_MID_HZ = 1200, EQ_MID_Q = 0.9, EQ_HIGH_HZ = 5000, EQ_MAX_F0_OF_SR = 0.45;
  const DRIVE_BASE = 1, DRIVE_PER_UNIT = 20;
  const ECHO_FEEDBACK = 0.4, ECHO_TAIL_ECHOES = 8, ECHO_DELAY_MIN_SECONDS = 0.02, ECHO_DELAY_MAX_SECONDS = 1;
  const COMB_MS = [29.7, 37.1, 41.1, 43.7], COMB_FEEDBACK = 0.77;
  const ALLPASS_MS = [5.0, 1.7], ALLPASS_GAIN = 0.7, REVERB_TAIL_SECONDS = 1.5;

  // ---- The fields the page shows as sliders (cuts and reverse have their own controls). `processing` is false for
  // the one field that only schedules. The defaults here are the only copy: isPlain() and process() read them. ----
  const field = (name, label, unit, min, max, def, step, processing, hint) =>
    Object.freeze({ name, label, unit, min, max, default: def, step, processing, hint });
  const FIELDS = Object.freeze([
    field("fadeIn", "Fade in", "s", 0, 2, 0, 0.01, true,
      "Brings the volume up from silence over this long. Softens a hard start."),
    field("fadeOut", "Fade out", "s", 0, 2, 0, 0.01, true,
      "Takes the volume down to silence over this long at the end of the cut."),
    field("eqLow", "Low (200 Hz)", "dB", -15, 15, 0, 0.5, true,
      "Bass. Boost for weight, cut to remove rumble."),
    field("eqMid", "Mid (1.2 kHz)", "dB", -15, 15, 0, 0.5, true,
      "The middle, where voices and metal clanks sit. Boost to push it forward, cut to hollow it out."),
    field("eqHigh", "High (5 kHz)", "dB", -15, 15, 0, 0.5, true,
      "Treble. Boost for bite and sparkle, cut to soften hiss."),
    field("drive", "Drive", "", 0, 1, 0, 0.01, true,
      "Distortion: squashes the loud parts into a gritty edge. 0 is off."),
    field("echo", "Echo", "", 0, 1, 0, 0.01, true,
      "How loud the repeats are. 0 is off. The repeats fade away by themselves."),
    field("echoDelay", "Echo delay", "s", 0.02, 1, 0.25, 0.01, true,
      "The time between repeats. Only matters when Echo is above 0."),
    field("reverb", "Reverb", "", 0, 1, 0, 0.01, true,
      "How much room sound is added. 0 is off. Makes the sound ring out a little longer."),
    field("delay", "Starts after", "s", 0, 2, 0, 0.01, false,
      "Starts this layer this long after the sound starts, to line layers up in time. The recording itself is not changed."),
  ]);

  // ---- Small helpers ----
  const num = (v, fallback) => (typeof v === "number" && Number.isFinite(v)) ? v : fallback;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const roundHalfUp = v => Math.floor(v + 0.5);
  const msToSamples = (ms, sr) => Math.max(1, roundHalfUp(ms * sr / 1000));

  // The cut of one take: null when the layer has none for it, else { start, end }. A missing end is Infinity, which
  // cutRange() treats as "to the end".
  function cutOf(layer, take) {
    const cuts = layer.cuts;
    if (!cuts || typeof cuts !== "object" || !Object.prototype.hasOwnProperty.call(cuts, take)) return null;
    const c = cuts[take];
    return Array.isArray(c) ? { start: num(c[0], 0), end: num(c[1], Infinity) } : null;
  }

  // The layer's numbers as process() uses them. Anything that is not a finite number counts as absent.
  function settings(layer, take) {
    const l = (layer && typeof layer === "object") ? layer : {};
    const s = { cut: cutOf(l, take), reverse: l.reverse === true };
    for (const f of FIELDS) s[f.name] = num(l[f.name], f.default);
    return s;
  }

  // true when this take is used exactly as recorded: no cut for it, not reversed, and every processing field absent or
  // at its default. (`delay` is not processing: a delayed layer can still be plain.)
  function isPlain(layer, take) {
    const l = (layer && typeof layer === "object") ? layer : {};
    if (cutOf(l, take) || l.reverse === true) return false;
    for (const f of FIELDS) if (f.processing && num(l[f.name], f.default) !== f.default) return false;
    return true;
  }

  // ---- Step 1: the sample range [a, b) to keep, at least 1 sample ----
  function cutRange(n, sr, cut) {
    if (!cut) return [0, n];
    const duration = n / sr;
    const s = clamp(cut.start, 0, duration);
    const toEnd = !(cut.end > cut.start);
    const e = toEnd ? duration : Math.min(cut.end, duration);
    const a = Math.min(Math.floor(s * sr), n - 1);
    // A cut that runs to the end keeps the last sample: floor((n / sr) * sr) can come out one short of n.
    const b = (toEnd || e >= duration) ? n : Math.floor(e * sr);
    return [a, Math.min(Math.max(b, a + 1), n)];
  }

  // ---- Step 3: fades, in place. Fade in first, then fade out; the product is formed in double. ----
  function fadeStep(x, sr, fadeIn, fadeOut) {
    const L = x.length;
    const nIn = Math.min(L, Math.max(0, roundHalfUp(fadeIn * sr)));
    const nOut = Math.min(L, Math.max(0, roundHalfUp(fadeOut * sr)));
    if (nIn === 0 && nOut === 0) return x;
    for (let i = 0; i < L; i++) {
      let v = x[i];
      if (i < nIn) v *= i / nIn;
      if (i >= L - nOut) v *= (L - 1 - i) / nOut;
      x[i] = v;
    }
    return x;
  }

  // ---- Step 4: EQ. The RBJ Audio EQ Cookbook, as the spec writes it. Each returns { b0, b1, b2, a0, a1, a2 }. ----
  function peakCoefficients(gainDb, hz, q, sr) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * Math.min(hz, EQ_MAX_F0_OF_SR * sr) / sr;
    const c = Math.cos(w0), sn = Math.sin(w0);
    const alpha = sn / (2 * q);
    return {
      b0: 1 + alpha * A, b1: -2 * c, b2: 1 - alpha * A,
      a0: 1 + alpha / A, a1: -2 * c, a2: 1 - alpha / A,
    };
  }
  function shelfCoefficients(low, gainDb, hz, sr) {
    const A = Math.pow(10, gainDb / 40);
    const w0 = 2 * Math.PI * Math.min(hz, EQ_MAX_F0_OF_SR * sr) / sr;
    const c = Math.cos(w0), sn = Math.sin(w0);
    const alpha = sn / 2 * Math.sqrt(2);          // slope S = 1
    const k = 2 * Math.sqrt(A) * alpha;
    if (low) {
      return {
        b0: A * ((A + 1) - (A - 1) * c + k),
        b1: 2 * A * ((A - 1) - (A + 1) * c),
        b2: A * ((A + 1) - (A - 1) * c - k),
        a0: (A + 1) + (A - 1) * c + k,
        a1: -2 * ((A - 1) + (A + 1) * c),
        a2: (A + 1) + (A - 1) * c - k,
      };
    }
    return {
      b0: A * ((A + 1) + (A - 1) * c + k),
      b1: -2 * A * ((A - 1) + (A + 1) * c),
      b2: A * ((A + 1) + (A - 1) * c - k),
      a0: (A + 1) - (A - 1) * c + k,
      a1: 2 * ((A - 1) - (A + 1) * c),
      a2: (A + 1) - (A - 1) * c - k,
    };
  }
  // Direct Form I, state 0 at the start, in place on doubles.
  function biquad(buf, c) {
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < buf.length; i++) {
      const x0 = buf[i];
      const y0 = (c.b0 * x0 + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2) / c.a0;
      buf[i] = y0;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    }
  }
  function eqStep(x, sr, s) {
    const bands = [];
    if (s.eqLow !== 0) bands.push(shelfCoefficients(true, s.eqLow, EQ_LOW_HZ, sr));
    if (s.eqMid !== 0) bands.push(peakCoefficients(s.eqMid, EQ_MID_HZ, EQ_MID_Q, sr));
    if (s.eqHigh !== 0) bands.push(shelfCoefficients(false, s.eqHigh, EQ_HIGH_HZ, sr));
    if (!bands.length) return x;
    const buf = Float64Array.from(x);               // the bands run in double; only the end of the step is float32
    for (const c of bands) biquad(buf, c);
    for (let i = 0; i < x.length; i++) x[i] = buf[i];
    return x;
  }

  // ---- Step 5: drive (a soft clip), in place ----
  function driveStep(x, amount) {
    if (!(amount > 0)) return x;
    const k = DRIVE_BASE + DRIVE_PER_UNIT * amount;
    const norm = Math.tanh(k);
    for (let i = 0; i < x.length; i++) x[i] = Math.tanh(k * x[i]) / norm;
    return x;
  }

  // ---- Step 6: echo, a feedback delay with a tail of 8 echoes ----
  function echoStep(x, sr, level, delaySeconds) {
    if (!(level > 0)) return x;
    const d = Math.max(1, roundHalfUp(clamp(delaySeconds, ECHO_DELAY_MIN_SECONDS, ECHO_DELAY_MAX_SECONDS) * sr));
    const n = x.length + ECHO_TAIL_ECHOES * d;
    const padded = new Float32Array(n);
    padded.set(x);
    const w = new Float64Array(n);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      w[i] = (i >= d) ? padded[i - d] + ECHO_FEEDBACK * w[i - d] : 0;
      out[i] = padded[i] + level * w[i];
    }
    return out;
  }

  // ---- Step 7: reverb, a small Schroeder network (4 combs in parallel, 2 allpasses in series) and a tail of 1.5 s ----
  function reverbStep(x, sr, level) {
    if (!(level > 0)) return x;
    const n = x.length + roundHalfUp(REVERB_TAIL_SECONDS * sr);
    const padded = new Float32Array(n);
    padded.set(x);
    let wet = new Float64Array(n);
    const comb = new Float64Array(n);
    for (const ms of COMB_MS) {
      const D = msToSamples(ms, sr);
      for (let i = 0; i < n; i++) {
        comb[i] = (i >= D) ? padded[i - D] + COMB_FEEDBACK * comb[i - D] : 0;
        wet[i] += comb[i];
      }
    }
    for (let i = 0; i < n; i++) wet[i] /= COMB_MS.length;
    for (const ms of ALLPASS_MS) {
      const D = msToSamples(ms, sr);
      const y = new Float64Array(n);
      for (let i = 0; i < n; i++) y[i] = -ALLPASS_GAIN * wet[i] + ((i >= D) ? wet[i - D] + ALLPASS_GAIN * y[i - D] : 0);
      wet = y;
    }
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = padded[i] + level * wet[i];
    return out;
  }

  // ---- All the steps, on one channel ----
  function processChannel(input, sr, s) {
    const n = input.length;
    if (n === 0) return new Float32Array(0);
    const [a, b] = cutRange(n, sr, s.cut);
    let x = new Float32Array(b - a);
    for (let i = 0; i < x.length; i++) x[i] = input[a + i];
    if (s.reverse) x.reverse();
    x = fadeStep(x, sr, s.fadeIn, s.fadeOut);
    x = eqStep(x, sr, s);
    x = driveStep(x, s.drive);
    x = echoStep(x, sr, s.echo, s.echoDelay);
    x = reverbStep(x, sr, s.reverb);
    for (let i = 0; i < x.length; i++) {                    // step 8: clamp to [-1, 1]
      if (x[i] > 1) x[i] = 1; else if (x[i] < -1) x[i] = -1;
    }
    return x;
  }

  // channels: one Float32Array per channel (an AudioBuffer's getChannelData, or the game's samples); sampleRate in Hz;
  // layer: the layer row; take: the take's name (selects the layer's cut). Returns new Float32Arrays (never the input
  // arrays, which stay untouched), longer than the input when there is an echo or reverb tail. A plain layer comes
  // back as an exact copy; callers skip the call when isPlain() is true.
  function processTake(channels, sampleRate, layer, take) {
    if (!(sampleRate > 0)) throw new RangeError("SoundDsp.process: sampleRate must be above 0");
    const s = settings(layer, take);
    const out = [];
    for (let ch = 0; ch < channels.length; ch++) out.push(processChannel(channels[ch], sampleRate, s));
    return out;
  }

  return Object.freeze({ FIELDS, isPlain, process: processTake });
})();
