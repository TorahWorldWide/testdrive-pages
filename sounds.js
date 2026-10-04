"use strict";
// The Sounds page. Shows every character with play buttons on the parts that make a sound, plays
// each sound the way the game does, and lets you change what a sound is made of (which recordings,
// how loud, how high). Saves to Assets/StreamingAssets/Sounds.json, which the game re-reads within
// a second of every save.
//
// The library on the left holds new sounds to try: Freesound (searched live), Kenney's packs (on
// disk), the recordings already in the game, and your starred picks. They play in the player bar
// along the bottom (one <audio>, streamed). Drag one onto a play button to replace that sound, or
// onto a layer in the mixer, or press "Use for…" in the player bar. Saving brings the new
// recordings into the game (Assets/Resources/Sfx/lib) through the server (library.py).
//
// Sounds.json: sounds[]: { id, about, layers[]: { takes[], volume (0-1), pitchMin, pitchMax, ...optional } }
// A take is a recording in Assets/Resources/Sfx ("cloth1", "lib/fs123-..."), a sound made in code
// ("~whoosh"), or, until it's saved, a library sound ("kenney:pack/file.ogg", "freesound:123").
//
// Each layer can also be shaped (round 19: "Cut and effects" in the mixer). These fields are OPTIONAL:
// a missing one is off, and a layer with none of them plays its recordings untouched, as before.
// The page (sound_dsp.js) and the game (Assets/Scripts/SfxDsp.cs) run the same algorithm on the samples,
// in this order: cut, reverse, fades, EQ, drive, echo, reverb (spec: .superpowers/sdd/2026-10-04-next-
// session-plan/r19-sound-dsp-spec.md). The page writes a field only when it's not at its default.
//   field      type    range              default  meaning
//   cuts       object  {"<take>": [start, end]} s   where each recording starts and ends (per take: a layer's
//                                                   takes are different recordings); end <= start = to the end
//   reverse    bool                       false    the cut plays backwards
//   fadeIn     number  0-2 s              0        fades in from silence
//   fadeOut    number  0-2 s              0        fades out to silence
//   eqLow      number  -15..15 dB         0        low shelf at 200 Hz (bass)
//   eqMid      number  -15..15 dB         0        peak at 1200 Hz, Q 0.9 (middle)
//   eqHigh     number  -15..15 dB         0        high shelf at 5000 Hz (treble)
//   drive      number  0-1                0        distortion (soft clip)
//   echo       number  0-1                0        echo level
//   echoDelay  number  0.02-1 s           0.25     time between echoes
//   reverb     number  0-1                0        reverb level (a small room)
//   delay      number  0-2 s              0        this layer starts this long after the sound starts
//                                                   (layering in time; not processing)
// Example row: { "takes": ["cloth1"], "volume": 0.6, "pitchMin": 1, "pitchMax": 1.2,
//                "cuts": {"cloth1": [0.02, 0.3]}, "fadeOut": 0.05, "eqHigh": 4, "delay": 0.1 }
// A library sound loses the silence at its start and end when it comes into the game, so it's cut (and reversed
// or faded) only where the page plays the game's copy: after Save, on the PC's page (playsOriginal).

const MASTER = 0.8; // Sfx.masterVolume in the game
const DRAG_TYPE = "application/x-testdrive-sound";

// What each sound id is called on this page.
const NAMES = {
  Jump: "Jump", AirJump: "Double jump", Land: "Landing", Kill: "Enemy dies", EnemyHit: "Enemy is hit",
  Hurt: "You get hit", ArmorBreak: "Armour breaks", Arrow: "Crossbow shot", Sword: "Sword swing",
  Club: "Giant's girder", Punch: "Punch", Spear: "Spear thrust", Hammer: "Hammer swing", HammerHit: "Hammer hit",
  KnifeThrow: "Knife throw", FastDrop: "Fast drop (C)", Slam: "Ground slam", RockThrow: "Scrap throw",
  RockImpact: "Scrap lands", Buy: "Buy", Equip: "Equip a weapon", WaveStart: "Wave starts", WaveEnd: "Wave ends",
  Dash: "Dash", BowDraw: "Crossbow draw", ArrowFlyBy: "Bolt flies past", ArrowHit: "Bolt hits you",
  ArrowStick: "Bolt sticks in the ground", Empty: "Out of knives",
};

// What each recording (or family of takes) already in the game is called on this page.
const RECORDINGS = {
  footstep_grass: "Footsteps on grass", cloth: "Cloth swish", impactPunch_heavy: "Heavy punch",
  impactPunch_medium: "Punch", impactSoft_heavy: "Heavy soft thud", impactSoft_medium: "Soft thud",
  impactMetal_heavy: "Metal clang", impactPlate_heavy: "Metal plate", impactMining: "Pickaxe on rock",
  impactBell_heavy: "Heavy bell", knifeSlice: "Blade swish", drawKnife: "Drawing a blade", handleCoins: "Coins",
  metalClick: "Metal click", bowRelease: "Bow release (twang)", bowDraw: "Bow draw (creak)",
  arrowFlyBy: "Arrow fly-by", arrowHitBody: "Arrow into flesh", arrowHitGround: "Arrow into ground",
  "~whoosh": "Whoosh (made in code)", "~wind": "Wind (made in code)", "~gore": "Gore splat (made in code)",
  "~thud": "Thud (made in code)", "~boom": "Deep boom (made in code)", "~drums": "War drums (made in code)",
};

// Quick searches in the library.
const CHIPS = ["footstep", "sword", "bow", "arrow", "punch", "hit", "whoosh", "explosion", "monster", "growl",
  "scream", "grunt", "metal", "rock", "splash", "coins", "click", "magic", "jump", "drum"];

const SOURCES = {
  freesound: { tab: "Freesound", note: "Freesound.org, free (CC0) sounds only." },
  kenney: { tab: "Kenney", note: "Kenney's 10 packs, free (CC0), on your computer." },
  game: { tab: "In the game", note: "Recordings the game already has." },
  picks: { tab: "★ Picks", note: "Sounds you starred, from any tab." },
};

// The cards. Each play button sits on a part of a portrait: 'at' is a part found in the game
// (portraits.json), dx/dy nudge it (in parts of the picture), 'left'/'below' move its label.
// docs/claude-tools/portraits.cs crops each picture to leave room for these nudges (its Room table):
// move a button here, give it room there.
const SHARED = [
  { sound: "EnemyHit", label: "Hit" },
  { sound: "Kill", label: "Dies" },
];
const CARDS = [
  { kind: "portrait", title: "You", color: "#F28C28", subject: "Player", note: "You, the cyborg: moving and getting hurt.", spots: [
    { sound: "AirJump", label: "Double jump", at: "top", dy: -0.06 },
    { sound: "Hurt", label: "You get hit", at: "center" },
    { sound: "Dash", label: "Dash (Shift)", at: "right", dx: -0.1, below: true },
    { sound: "FastDrop", label: "Fast drop (C)", at: "left", dx: 0.08, dy: 0.12, left: true },
    { sound: "Jump", label: "Jump", at: "feet", dx: -0.24, dy: 0.1, left: true },
    { sound: "Land", label: "Landing", at: "feet", dy: 0.24 },
    { sound: "Slam", label: "Ground slam", at: "feet", dx: 0.24, dy: 0.1 },
  ] },
  { kind: "strip", title: "Your weapons", color: "#D9B36A", note: "F attacks. Hold F in the air for an air attack.", items: [
    { subject: "Fist", name: "Fists", aspect: 1.3, spots: [{ sound: "Punch", label: "Punch", at: "center", below: true }] },
    { subject: "Sword", name: "Sword", spots: [{ sound: "Sword", label: "Swing", at: "center", below: true }] },
    { subject: "Spear", name: "Spear", spots: [{ sound: "Spear", label: "Thrust", at: "center", below: true }] },
    { subject: "Hammer", name: "War hammer", spots: [
      { sound: "Hammer", label: "Swing", at: "center", dx: -0.2, below: true },
      { sound: "HammerHit", label: "Hit", at: "tip", below: true }] },
    { subject: "ThrownKnife", name: "Throwing knives", spots: [
      { sound: "KnifeThrow", label: "Throw", at: "tip", below: true },
      { sound: "Empty", label: "None left", at: "tail", below: true }] },
  ] },
  { kind: "portrait", title: "Basic", type: "Basic", subject: "Basic", note: "The brainwashed soldier. Hit, dies and armour sound the same on every enemy.", spots: [
    { sound: "ArmorBreak", label: "Armour breaks", at: "helmet" },
    { ...SHARED[0], at: "center", dx: 0.1 },
    { ...SHARED[1], at: "center", dx: 0.1, dy: 0.16 },
    { silent: true, label: "Footsteps: no sound yet", at: "feet", dy: 0.12 },
  ] },
  { kind: "portrait", title: "Archer", type: "Archer", subject: "Archer", note: "A half-robot with a crossbow arm. The crossbow creaks first: that's your warning.", spots: [
    { sound: "BowDraw", label: "Draws the crossbow", at: "bow", dy: -0.08 },
    { sound: "Arrow", label: "Shoots", at: "bow", dy: 0.08 },
    { ...SHARED[0], at: "center", dx: 0.2 },
    { ...SHARED[1], at: "center", dx: 0.2, dy: 0.16 },
    { silent: true, label: "Footsteps: no sound yet", at: "feet", dy: 0.05 },
  ], sidekick: { subject: "Arrow", name: "Its bolt", aspect: 3, spots: [
    { sound: "ArrowFlyBy", label: "Flies past you", at: "tail", below: true },
    { sound: "ArrowHit", label: "Hits you", at: "center", below: true },
    { sound: "ArrowStick", label: "Hits the ground", at: "tip", below: true },
  ] } },
  { kind: "portrait", title: "Rock thrower", type: "RockThrower", subject: "RockThrower", note: "A squat robot. It lifts a chunk of scrap over its head before throwing.", spots: [
    { sound: "RockThrow", label: "Throws", at: "rock" },
    { ...SHARED[0], at: "center", dx: 0.2 },
    { ...SHARED[1], at: "center", dx: 0.2, dy: 0.16 },
    { silent: true, label: "Footsteps: no sound yet", at: "feet", dy: 0.05 },
  ], sidekick: { subject: "Rock", name: "Its scrap", spots: [
    { sound: "RockImpact", label: "Lands", at: "center", below: true },
  ] } },
  { kind: "portrait", title: "Giant", type: "Giant", subject: "Giant", size: 25, note: "A 4 m combat robot. It raises its steel girder, then swings.", spots: [
    { sound: "Club", label: "Swings the girder", at: "club", below: true },
    { ...SHARED[0], at: "center", dx: 0.16 },
    { ...SHARED[1], at: "center", dx: 0.16, dy: 0.16 },
    { silent: true, label: "Footsteps: no sound yet", at: "feet", dx: 0.06 },
  ] },
  { kind: "portrait", title: "Worm", type: "Worm", subject: "Worm", note: "A mechanical drill worm. Armoured ones carry metal plates on their segments.", spots: [
    { ...SHARED[0], at: "head", dx: 0.12, dy: -0.12 },
    { ...SHARED[1], at: "head", dx: 0.12, dy: 0.06 },
    { sound: "ArmorBreak", label: "A plate breaks", at: "middle", left: true },
    { silent: true, label: "Tunnelling and leaping: no sound yet", at: "tail", left: true },
  ] },
  { kind: "signs", title: "The game", color: "#F2C14E", note: "Waves and the shop.", signs: [
    { sound: "WaveStart", big: "WAVE 3", small: "A wave starts" },
    { sound: "WaveEnd", big: "COMPLETE", small: "A wave ends" },
    { sound: "Buy", big: "₪ Buy", small: "You buy in the shop" },
    { sound: "Equip", big: "Equip", small: "You pick a weapon" },
  ] },
];

const state = {
  plan: null, recordings: [], credits: {}, portraits: {}, enemies: {}, file: "", hasFreesound: false,
  selected: null, saved: "", undo: [], redo: [], pending: null,
  meta: {},       // take or library ref -> { title, author, source, link, seconds }
  lib: { source: "freesound", query: "", sort: "best", short: true, pack: "", items: [], sel: -1,
         fs: { results: [], page: 0, more: false, count: 0, busy: false, error: "", query: null },
         kenney: null, picks: [] },
};

const $ = id => document.getElementById(id);
const ICONS = {
  play: `<svg class="icon-play" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z"/></svg>`,
  pause: `<svg class="icon-pause" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4h4v16h-4zM13.5 4h4v16h-4z"/></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.3l2.6 5.5 6 .8-4.4 4.1 1.1 6L12 16.8l-5.3 2.9 1.1-6-4.4-4.1 6-.8z"/></svg>`,
};
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const snapshot = () => JSON.stringify(state.plan);
const soundById = id => state.plan.sounds.find(s => s.id === id);
const nameOf = id => NAMES[id] || id;
const isNew = take => take.startsWith("kenney:") || take.startsWith("freesound:"); // not in the game yet
const seconds = s => s == null ? "" : s < 10 ? s.toFixed(1) + " s" : Math.round(s) + " s";
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ---------- shaping a layer: the optional fields (the table at the top) ----------

// The algorithm lives in sound_dsp.js (SoundDsp); the game runs the same one (SfxDsp.cs). Without it the
// page still plays and edits everything else; only the "Cut and effects" panel is missing.
const DSP = typeof SoundDsp === "object" && SoundDsp && typeof SoundDsp.process === "function" ? SoundDsp : null;
// The sliders' names, ranges, defaults, steps, units and explanations come from SoundDsp.FIELDS (one copy,
// shared with the game's numbers); these are only for a field the table leaves without words.
const FX_TEXT = {
  fadeIn: ["Fade in", "Rises from silence over this long at the start."],
  fadeOut: ["Fade out", "Sinks to silence over this long at the end."],
  eqLow: ["Low (200 Hz)", "Bass: a low shelf at 200 Hz."],
  eqMid: ["Mid (1.2 kHz)", "The middle: a peak at 1200 Hz."],
  eqHigh: ["High (5 kHz)", "Treble: a high shelf at 5000 Hz."],
  drive: ["Drive", "Distortion: grit and crunch (soft clipping)."],
  echo: ["Echo", "How loud the repeats are."],
  echoDelay: ["Echo delay", "Time between the repeats."],
  reverb: ["Reverb", "How much room sound is added."],
  delay: ["Starts after", "This layer starts this long after the sound starts, to line layers up in time."],
};
const FX_GROUPS = [["Fades", ["fadeIn", "fadeOut"]], ["EQ", ["eqLow", "eqMid", "eqHigh"]],
  ["Effects", ["drive", "echo", "echoDelay", "reverb"]], ["Timing", ["delay"]]];
// The numeric fields: { name, min, max, def, step, unit, label, help }.
const FX = (() => {
  if (!DSP) return [];
  const raw = Array.isArray(DSP.FIELDS) ? DSP.FIELDS : Object.entries(DSP.FIELDS || {}).map(([name, f]) => ({ name, ...f }));
  const list = raw.filter(f => f && typeof f.name === "string" && Number.isFinite(+f.min) && Number.isFinite(+f.max)
      && f.name !== "cuts" && f.name !== "reverse")
    .map(f => ({ name: f.name, min: +f.min, max: +f.max, def: +(f.default ?? f.def ?? 0), step: +f.step || (f.max - f.min) / 100,
      unit: f.unit || "", label: f.label || FX_TEXT[f.name]?.[0] || f.name, help: f.hint || FX_TEXT[f.name]?.[1] || "" }));
  // 'delay' is scheduling, not processing: if the shared table leaves it out, the page still needs it.
  if (!list.some(f => f.name === "delay"))
    list.push({ name: "delay", min: 0, max: 2, def: 0, step: 0.01, unit: "s", label: FX_TEXT.delay[0], help: FX_TEXT.delay[1] });
  return list;
})();
const fxByName = Object.fromEntries(FX.map(f => [f.name, f]));
// The order the fields are written in a row of Sounds.json.
const ROW_ORDER = ["takes", "volume", "pitchMin", "pitchMax", "cuts", "reverse",
  ...FX_GROUPS.flatMap(g => g[1]), ...FX.map(f => f.name)];
const MIN_CUT = 0.01; // seconds: the shortest cut the handles allow

const decimals = step => Math.max(0, Math.min(4, Math.ceil(-Math.log10(step) - 1e-9)));
// A value as the slider's number: "0.25 s", "+6 dB", "40%".
function fxText(f, v) {
  if (f.unit === "dB") return (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(f.step < 1 ? 1 : 0).replace(/\.0$/, "") + " dB";
  if (f.unit === "s") return v.toFixed(2) + " s";
  if (f.unit === "%" || (!f.unit && f.min >= 0 && f.max <= 1)) return Math.round(v * 100) + "%";
  return v.toFixed(decimals(f.step)) + (f.unit ? " " + f.unit : "");
}
const fxValue = (layer, f) => typeof layer[f.name] === "number" ? layer[f.name] : f.def;
const fxOn = (layer, f) => typeof layer[f.name] === "number" && layer[f.name] !== f.def;

// Writes the row's fields in one order (Sounds.json stays easy to read), leaving out what's at its default.
function tidyLayer(layer) {
  if (layer.cuts) {
    for (const take of Object.keys(layer.cuts)) if (!layer.takes.includes(take)) delete layer.cuts[take];
    if (!Object.keys(layer.cuts).length) delete layer.cuts;
  }
  if (!layer.reverse) delete layer.reverse;
  for (const f of FX) if (layer[f.name] === f.def) delete layer[f.name];
  const copy = { ...layer };
  for (const k of Object.keys(layer)) delete layer[k];
  for (const k of ROW_ORDER) if (k in copy && !(k in layer)) layer[k] = copy[k];
  for (const k of Object.keys(copy)) if (!(k in layer)) layer[k] = copy[k];
  return layer;
}
function setFx(layer, f, v) {
  const value = +clamp(+v, f.min, f.max).toFixed(decimals(f.step));
  if (value === f.def) delete layer[f.name];
  else layer[f.name] = value;
  tidyLayer(layer);
}
// Puts a layer back to plain: no cut, no effects, no delay (its recordings, volume and pitch stay).
function plainLayer(layer) {
  delete layer.cuts;
  delete layer.reverse;
  for (const f of FX) delete layer[f.name];
}
// Where a take's cut starts and ends, in seconds, the way the algorithm reads it (spec, step 1).
function cutOf(layer, take, length) {
  const c = layer.cuts?.[take];
  if (!Array.isArray(c)) return [0, length];
  const s = clamp(+c[0] || 0, 0, length);
  const e = +c[1] > +c[0] ? Math.min(+c[1], length) : length;
  return [s, Math.max(s, e)];
}
// Stores a cut rounded to the millisecond. An end at the end of the recording is stored rounded up, so
// it still means "to the end"; a cut of the whole recording is no cut at all.
function setCut(layer, take, s, e, length) {
  s = Math.round(clamp(s, 0, length) * 1000) / 1000;
  const toEnd = e >= length - 0.0005;
  e = toEnd ? Math.ceil(length * 1000) / 1000 : Math.round(e * 1000) / 1000;
  if (s <= 0 && toEnd) { if (layer.cuts) delete layer.cuts[take]; }
  else layer.cuts = { ...(layer.cuts || {}), [take]: [s, e] };
  tidyLayer(layer);
}
// What a layer's shaping does, in a few words (the chips on the "Cut and effects" button).
function fxChips(layer) {
  const on = [];
  if (layer.cuts && Object.keys(layer.cuts).length) on.push("Cut");
  if (layer.reverse) on.push("Backwards");
  const any = names => names.some(n => fxByName[n] && fxOn(layer, fxByName[n]));
  if (any(["fadeIn", "fadeOut"])) on.push("Fades");
  if (any(["eqLow", "eqMid", "eqHigh"])) on.push("EQ");
  for (const n of ["drive", "echo", "reverb"]) if (any([n])) on.push(shortLabel(fxByName[n]));
  for (const f of FX) if (!FX_GROUPS.some(g => g[1].includes(f.name)) && fxOn(layer, f)) on.push(shortLabel(f));
  if (fxByName.delay && fxOn(layer, fxByName.delay)) on.push(`${shortLabel(fxByName.delay)} ${fxValue(layer, fxByName.delay).toFixed(2)} s`);
  return on;
}
// "Low (200 Hz)" -> "Low": the name without its note in brackets.
const shortLabel = f => f.label.replace(/\s*\([^)]*\)\s*$/, "");
const isShaped = layer => fxChips(layer).length > 0;

// The page cuts what it plays, and a library sound comes into the game (library.py) without the silence at its
// start and end. Where the page plays the ORIGINAL instead of the game's copy, its seconds aren't the game's: a
// library sound not saved into the game yet, and online one brought in from the library (Store plays it from where
// it came from). Such a take can't be cut here, and its layer can't be reversed or faded (they'd fall on that
// silence), until the page plays the game's copy: after Save, on the PC's page.
const playsOriginal = take => isNew(take) || (!!Store.online && take.startsWith("lib/") && !!state.credits[take]?.from);
const lockedLayer = layer => layer.takes.some(playsOriginal);
const isLocked = (layer, name) => (name === "fadeIn" || name === "fadeOut") && lockedLayer(layer);
const PC_PAGE = "the PC's Sounds page (in Unity: TestDrive > Offline (this PC only) > Open Sounds page)";
const lockNote = take => !isNew(take)
  ? `To cut it, use ${PC_PAGE}: online it plays as it came, with silence at its start and end that the game's copy doesn't have.`
  : Store.online ? `Cut it once your PC has brought it into the game (without the silence at its start and end), on ${PC_PAGE}.`
  : "To cut it, press Save first: the game keeps this sound without the silence at its start and end, and you cut that copy.";
// A cut made on a library sound's original, moved onto the game's copy, which lost 'trimStart' seconds at its start
// (library.py's number, once it reports it). Without that number the cut can't be placed, so it goes. (The page
// itself doesn't cut a sound before it's in the game: this is for a cut made somewhere else.)
function moveCut(c, trimStart) {
  if (!Array.isArray(c) || typeof trimStart !== "number" || !(trimStart >= 0)) return null;
  const ms = v => Math.round(v * 1000) / 1000;
  const s = ms(Math.max(0, +c[0] - trimStart));
  if (!(+c[1] > +c[0])) return s > 0 ? [s, 0] : null; // "to the end" stays to the end
  const e = ms(+c[1] - trimStart);
  return e > s ? [s, e] : null; // a cut inside the silence that went is nothing
}

// ---------- recordings and their families ----------

// "footstep_grass_003" and "cloth2" belong to the families "footstep_grass" and "cloth". Library
// sounds are each their own family.
const familyOf = take => take.startsWith("lib/") || isNew(take) ? take : take.replace(/_?\d+$/, "");
function families() {
  const map = new Map();
  for (const r of state.recordings) {
    const key = familyOf(r);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  }
  return map;
}
function recordingName(key) {
  if (state.meta[key]) return state.meta[key].title;
  if (RECORDINGS[key]) return RECORDINGS[key];
  return key.replace(/^~|^lib\//, "").replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}
// The family a layer uses, or null if it picks only some of a family's takes.
function layerFamily(layer) {
  const key = familyOf(layer.takes[0] || "");
  if (isNew(key)) return null;
  const all = families().get(key) || [];
  const same = all.length === layer.takes.length && all.every(t => layer.takes.includes(t));
  return same ? key : null;
}

// ---------- playing, the way the game does ----------

let audio = null;
const buffers = new Map();
const context = () => audio || (audio = new AudioContext());
// Like the game, each recording is evened out by its loudest moment (Sfx: min(3, 0.9 / peak)).
function loudest(buffer) {
  let peak = 0.05;
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; }
  }
  return peak;
}
const evenOut = buffer => Math.min(3, 0.9 / loudest(buffer));
// Loads a recording once.
function load(take) {
  if (!buffers.has(take)) {
    const p = Store.audioUrl(take)
      .then(url => fetch(url))
      .then(r => { if (!r.ok) throw new Error("missing " + take); return r.arrayBuffer(); })
      .then(data => context().decodeAudioData(data))
      .then(buffer => ({ buffer, gain: evenOut(buffer) }));
    p.catch(() => buffers.delete(take)); // a failed load can be tried again
    buffers.set(take, p);
  }
  return buffers.get(take);
}

// A take as a layer plays it: cut and processed by SoundDsp (once per take and settings, then kept),
// or untouched when the layer doesn't shape it. Like the game (Sfx.cs), the loudness evening-out comes
// from the recording itself, so a cut or an EQ boost really changes how loud the layer is.
const shapedBuffers = new Map(); // take + settings -> Promise<{ buffer, gain }>
const SHAPED_KEEP = 48;          // processed takes kept (the oldest goes first)
function shapeKey(layer, take) {
  const { takes, volume, pitchMin, pitchMax, delay, cuts, ...rest } = layer;
  return JSON.stringify([take, cuts?.[take] || null, Object.keys(rest).sort().map(k => [k, rest[k]])]);
}
function shaped(take, layer) {
  if (!DSP || DSP.isPlain(layer, take)) return load(take);
  const key = shapeKey(layer, take);
  if (!shapedBuffers.has(key)) {
    const settings = JSON.parse(JSON.stringify(layer)); // the layer as it is now, even if it changes meanwhile
    const p = load(take).then(plain => {
      const { buffer, gain } = plain;
      try {
        const input = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) input.push(new Float32Array(buffer.getChannelData(c)));
        const output = DSP.process(input, buffer.sampleRate, settings, take);
        const length = Math.max(1, ...output.map(d => d.length));
        const result = context().createBuffer(output.length, length, buffer.sampleRate);
        output.forEach((d, c) => result.copyToChannel(d, c));
        return { buffer: result, gain };
      } catch (err) { // as in the game: if the edit can't be made, the recording itself plays
        console.warn("Sounds page: couldn't edit " + take, err);
        return plain;
      }
    });
    p.catch(() => shapedBuffers.delete(key));
    shapedBuffers.set(key, p);
    while (shapedBuffers.size > SHAPED_KEEP) shapedBuffers.delete(shapedBuffers.keys().next().value);
  }
  return shapedBuffers.get(key);
}

// Loads recordings in the background, two at a time, so a press plays at once.
const toLoad = [];
let loaders = 0;
function warm(takes) {
  for (const t of takes) if (!buffers.has(t) && !toLoad.includes(t)) toLoad.push(t);
  while (loaders < 2 && toLoad.length) {
    loaders++;
    (async () => { while (toLoad.length) await load(toLoad.shift()).catch(() => {}); loaders--; })();
  }
}
const takesOf = ids => ids.flatMap(id => soundById(id)?.layers.flatMap(l => l.takes) || []);

// A phone shouldn't fetch every recording at the start: load the cards on screen (and the next
// ones down) as they come into view.
const nearby = "IntersectionObserver" in window && new IntersectionObserver(entries => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    nearby.unobserve(e.target);
    warm(takesOf([...e.target.querySelectorAll("[data-sound]")].map(el => el.dataset.sound)));
  }
}, { rootMargin: "400px 0px" });
function watchCards() {
  if (nearby) document.querySelectorAll(".card").forEach(c => nearby.observe(c));
  else warm(state.recordings);
}

// One sound at a time: a new press stops the last one, and a press that's still loading when a
// newer one comes is dropped (on a slow phone, quick presses used to all play together at the end).
const live = new Set();
let presses = 0, lit = null;
function stopSounds() {
  for (const source of live) { try { source.stop(); } catch { /* already over */ } }
  live.clear();
  if (lit) { clearTimeout(lit._stop); lit.classList.remove("playing"); lit = null; }
  for (const a of sweeps) a.cancel();
  sweeps.clear();
}
// Starts a take at 'when' on the audio clock (0 = now); returns how long it sounds from its start.
function startTake({ buffer, gain }, volume, pitch, when = 0) {
  const ctx = context();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = pitch;
  const level = ctx.createGain();
  level.gain.value = Math.min(1, volume * gain * MASTER);
  source.connect(level).connect(ctx.destination);
  source.onended = () => live.delete(source);
  live.add(source);
  source.start(when);
  return buffer.duration / pitch;
}
// Lights up 'el' while a sound lasts.
function glow(el, secs) {
  if (!el) return;
  lit = el;
  el.classList.add("playing");
  el._stop = setTimeout(() => { el.classList.remove("playing"); if (lit === el) lit = null; }, Math.max(250, secs * 1000));
}
// Plays layers together, the way the game does: each one a random take, shaped (cut and effects), at
// a random pitch in its range, starting after its delay. 'el' shows it's loading, then lights up
// while it sounds. 'solo' (one layer's own play button) starts at once, without the layer's delay.
function playLayers(layers, el, { solo = false } = {}) {
  return playPicks(layers.filter(l => l.takes.length).map(l => ({
    layer: l,
    take: l.takes[Math.floor(Math.random() * l.takes.length)],
    pitch: l.pitchMin + Math.random() * Math.max(0, l.pitchMax - l.pitchMin),
    delay: solo || !fxByName.delay ? 0 : clamp(fxValue(l, fxByName.delay), 0, fxByName.delay.max), // as Sfx.cs clamps it
  })), el);
}
// Plays one take of a layer, shaped, at the middle of its pitch range and at once (the play button
// next to each recording in "Cut and effects", to hear just that cut).
function playCut(layer, take, el) {
  return playPicks([{ layer, take, pitch: (layer.pitchMin + layer.pitchMax) / 2, delay: 0 }], el);
}
async function playPicks(picks, el) {
  const press = ++presses;
  pausePreview();
  const resumed = context().resume(); // inside the tap, so phones allow sound
  el?.classList.add("loading");
  const loaded = await Promise.all(picks.map(p => shaped(p.take, p.layer).catch(() => null)));
  await resumed.catch(() => {});
  el?.classList.remove("loading");
  if (press !== presses) return; // a newer press came while this one was loading
  stopSounds();
  const now = context().currentTime + 0.01; // one clock for every layer, so their delays are exact
  glow(el, Math.max(0, ...picks.map((p, i) => {
    if (!loaded[i]) return 0;
    const secs = startTake(loaded[i], p.layer.volume, p.pitch, now + p.delay);
    sweep(p);
    return p.delay + secs;
  })));
}
// A line runs over the waveform of the take that's playing (when its "Cut and effects" is open):
// which take was picked, and where in the cut it is. The browser animates it; nothing runs per frame.
const sweeps = new Set();
function sweep(pick) {
  const sound = soundById(state.selected);
  const n = sound ? sound.layers.indexOf(pick.layer) : -1;
  const ti = n < 0 ? -1 : pick.layer.takes.indexOf(pick.take);
  const wave = ti < 0 ? null : $("mixer").querySelector(`.wave[data-wave="${n}:${ti}"]`);
  const length = waveInfo.get(pick.take)?.seconds;
  const head = wave?.querySelector(".wave-head");
  if (!head || !length || !head.animate) return;
  const [s, e] = cutOf(pick.layer, pick.take, length);
  const [from, to] = pick.layer.reverse ? [e, s] : [s, e];
  const a = head.animate([{ left: from / length * 100 + "%", opacity: 1 }, { left: to / length * 100 + "%", opacity: 1 }],
    { duration: Math.max(1, (e - s) / pick.pitch * 1000), delay: pick.delay * 1000, easing: "linear" });
  sweeps.add(a);
  a.onfinish = a.oncancel = () => sweeps.delete(a);
}

// ---------- the waveforms in "Cut and effects" ----------

const waveInfo = new Map(); // take -> { peaks (lowest and highest sample per column), seconds, loudest }
const WAVE_COLUMNS = 800;
function waveOf(take) {
  if (waveInfo.has(take)) return Promise.resolve(waveInfo.get(take));
  return load(take).then(({ buffer }) => {
    if (!waveInfo.has(take)) {
      const peaks = new Float32Array(WAVE_COLUMNS * 2), n = buffer.length, per = n / WAVE_COLUMNS;
      for (let c = 0; c < buffer.numberOfChannels; c++) {
        const d = buffer.getChannelData(c);
        for (let col = 0; col < WAVE_COLUMNS; col++) {
          let lo = peaks[col * 2], hi = peaks[col * 2 + 1];
          for (let i = Math.floor(col * per), end = Math.min(n, Math.max(i + 1, Math.floor((col + 1) * per))); i < end; i++) {
            if (d[i] < lo) lo = d[i];
            if (d[i] > hi) hi = d[i];
          }
          peaks[col * 2] = lo;
          peaks[col * 2 + 1] = hi;
        }
      }
      waveInfo.set(take, { peaks, seconds: buffer.duration, loudest: loudest(buffer) });
    }
    return waveInfo.get(take);
  });
}
// Draws a take's waveform evened out like the game does it, in the canvas's CSS colour.
function drawWave(canvas, info) {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const g = canvas.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  g.fillStyle = getComputedStyle(canvas).color;
  // A square-root scale, so a quiet tail still shows next to a loud hit (only the picture: the sound isn't changed).
  const mid = h / 2, gain = Math.min(3, 0.95 / info.loudest);
  const y = v => Math.sign(v) * Math.sqrt(Math.min(1, Math.abs(v) * gain)) * (h / 2 - 1);
  for (let x = 0; x < w; x += 1) {
    const a = Math.floor(x / w * WAVE_COLUMNS), b = Math.max(a + 1, Math.floor((x + 1) / w * WAVE_COLUMNS));
    let lo = 0, hi = 0;
    for (let c = a; c < b; c++) { lo = Math.min(lo, info.peaks[c * 2]); hi = Math.max(hi, info.peaks[c * 2 + 1]); }
    const top = mid - y(hi);
    g.fillRect(x, top, 1, Math.max(1, mid - y(lo) - top));
  }
}
// Puts a take's handles, shading, fades line and numbers where its cut is (no redraw of the waveform).
function refreshWave(n, ti) {
  const wave = $("mixer").querySelector(`.wave[data-wave="${n}:${ti}"]`);
  const layer = soundById(state.selected)?.layers[n];
  const take = layer?.takes[ti];
  const info = take != null && waveInfo.get(take);
  if (!wave || !info) return;
  const length = info.seconds;
  const [s, e] = cutOf(layer, take, length);
  const pct = v => (length ? v / length * 100 : 0).toFixed(3) + "%";
  wave.style.setProperty("--s", pct(s));
  wave.style.setProperty("--e", pct(e));
  wave.classList.remove("loading");
  wave.classList.toggle("is-cut", !!layer.cuts?.[take]);
  wave.classList.toggle("reversed", !!layer.reverse);
  // The fades, as a line over the cut: in playing order, so a reversed cut fades in from its right end.
  const span = Math.max(1e-6, e - s);
  const fin = Math.min(1, fxValue(layer, fxByName.fadeIn || { def: 0 }) / span) * 100;
  const fout = Math.min(1, fxValue(layer, fxByName.fadeOut || { def: 0 }) / span) * 100;
  const [left, right] = layer.reverse ? [fout, fin] : [fin, fout];
  wave.querySelector(".wave-env polyline").setAttribute("points",
    left || right ? `0,${left ? 100 : 14} ${left},14 ${100 - right},14 100,${right ? 100 : 14}` : "");
  for (const h of wave.querySelectorAll(".wave-handle")) {
    const v = h.dataset.handle === "start" ? s : e;
    h.setAttribute("aria-valuemin", 0);
    h.setAttribute("aria-valuemax", length.toFixed(3));
    h.setAttribute("aria-valuenow", v.toFixed(3));
    h.setAttribute("aria-valuetext", v.toFixed(3) + " seconds");
  }
  const block = wave.closest(".take");
  for (const input of block.querySelectorAll("input[type=number]")) {
    input.disabled = playsOriginal(take);
    input.max = length.toFixed(3);
    if (document.activeElement !== input) input.value = (input.dataset.field === "cutStart" ? s : e).toFixed(3);
  }
  block.querySelector(".take-len").textContent = layer.cuts?.[take] ? `${(e - s).toFixed(2)} of ${length.toFixed(2)} s` : `${length.toFixed(2)} s`;
}
// Draws the waveforms in the mixer (each recording is fetched once, then kept).
function drawWaves() {
  for (const wave of $("mixer").querySelectorAll(".wave[data-wave]")) {
    const [n, ti] = wave.dataset.wave.split(":").map(Number);
    const take = soundById(state.selected)?.layers[n]?.takes[ti];
    if (take == null) continue;
    waveOf(take).then(info => {
      if (!wave.isConnected) return;
      drawWave(wave.querySelector("canvas"), info);
      refreshWave(n, ti);
    }).catch(() => {
      if (!wave.isConnected) return;
      wave.classList.add("failed");
      wave.querySelector(".wave-note").textContent = "Couldn't load this recording.";
    });
  }
}
let redrawTimer = 0;
window.addEventListener("resize", () => { clearTimeout(redrawTimer); redrawTimer = setTimeout(drawWaves, 150); });
function play(id, el) {
  const sound = soundById(id);
  if (sound) playLayers(sound.layers, el);
}

// ---------- loading and saving ----------

async function getJson(url, options) {
  const r = await fetch(url, options);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `The server answered ${r.status}.`);
  return body;
}

async function refreshRecordings() {
  const sounds = await Store.load("sounds");
  state.recordings = sounds.recordings;
  state.credits = sounds.credits || {};
  for (const [take, c] of Object.entries(state.credits)) state.meta[take] = c;
  return sounds;
}

async function start() {
  try {
    const [sounds, portraits, enemies] = await Promise.all([
      refreshRecordings(),
      getJson("portraits.json"),
      getJson("enemies.json"),
    ]);
    state.plan = sounds.plan;
    state.file = sounds.file;
    state.hasFreesound = sounds.freesound;
    state.portraits = portraits.subjects;
    for (const e of enemies.enemies) state.enemies[e.type] = e;
    state.saved = snapshot();
    state.lib.picks = loadPicks();
    state.lib.source = state.hasFreesound ? "freesound" : "kenney";
    renderBoard();
    renderMixer();
    renderStatus();
    renderLibrary();
    watchCards();
  } catch (err) {
    showProblem(err instanceof TypeError
      ? (Store.online ? "Can't reach GitHub. Check the internet connection and reload."
                      : "Can't reach the pages' server. In Unity, open the TestDrive menu and choose “Open Sounds page”.")
      : err.message);
  }
}

// Saving: first bring any new library sounds into the game, then write Sounds.json. Online, the
// game PC brings them in later (sync.py), so they stay as library references until then.
let forceNextSave = false; // set after a clash with another device, so the next Save overwrites it
async function save() {
  commitPending();
  if (!state.plan || snapshot() === state.saved) return;
  const fresh = [...new Set(state.plan.sounds.flatMap(s => s.layers.flatMap(l => l.takes)).filter(isNew))];
  try {
    const swap = {}; // library ref -> the entry of the recording it became
    for (let i = 0; i < fresh.length && !Store.online; i++) {
      renderStatus(`Bringing new sound ${i + 1} of ${fresh.length} into the game…`);
      const entry = await Store.bringIn(fresh[i]);
      swap[fresh[i]] = entry;
      state.meta[entry.take] = entry;
    }
    if (Object.keys(swap).length) {
      for (const s of state.plan.sounds)
        for (const l of s.layers) {
          l.takes = l.takes.map(t => swap[t]?.take || t);
          if (l.cuts && Object.keys(l.cuts).some(t => swap[t])) { // a cut follows its recording onto the game's copy, or goes (moveCut)
            l.cuts = Object.fromEntries(Object.entries(l.cuts).flatMap(([t, c]) => {
              if (!swap[t]) return [[t, c]];
              const moved = moveCut(c, swap[t].trimStart);
              return moved ? [[swap[t].take, moved]] : [];
            }));
            tidyLayer(l);
          }
        }
      await refreshRecordings();
    }
    const r = await Store.save("sounds", state.plan, { force: forceNextSave });
    forceNextSave = false;
    state.saved = snapshot();
    showProblem(null);
    renderMixer();
    if (state.lib.source === "game") renderLibrary();
    renderStatus(Store.online ? `Saved at ${r.saved}. ${r.note}`
      : fresh.length ? `Saved at ${r.saved}. Click on the Unity window: it brings in the new recordings, then the game plays them.`
      : `Saved at ${r.saved}. ${r.note}`);
  } catch (err) {
    if (err instanceof Store.Conflict) {
      forceNextSave = true;
      showProblem("The sounds were saved from another device since you opened this page. Reload to see that version " +
        "(your unsaved changes here will be lost), or press Save again to replace it with yours.");
      renderStatus();
      return;
    }
    showProblem(err instanceof TypeError
      ? "Saving failed: can't reach " + (Store.online ? "GitHub. Check the internet connection." : "the pages' server. In Unity choose TestDrive > Open Sounds page, then save.")
      : "Saving failed: " + err.message);
    renderStatus();
  }
}

function showProblem(text) {
  $("problem").hidden = !text;
  $("problem").textContent = text || "";
}

// ---------- undo ----------

function change(mutate) {
  commitPending();
  const before = snapshot();
  mutate();
  if (snapshot() !== before) {
    state.undo.push(before);
    state.redo = [];
  }
  renderMixer();
  renderStatus();
}
function commitPending() {
  if (state.pending && state.pending !== snapshot()) {
    state.undo.push(state.pending);
    state.redo = [];
  }
  state.pending = null;
}
function undo() {
  commitPending();
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  state.plan = JSON.parse(state.undo.pop());
  renderMixer(); renderStatus();
}
function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  state.plan = JSON.parse(state.redo.pop());
  renderMixer(); renderStatus();
}
// The sound as it was last saved (for "Back to the saved version").
const savedSound = id => JSON.parse(state.saved).sounds.find(s => s.id === id);

// ---------- drawing the board and the mixer ----------

function renderStatus(message) {
  const dirty = state.plan && snapshot() !== state.saved;
  $("save").disabled = !dirty;
  $("undo").disabled = !state.undo.length && !(state.pending && state.pending !== snapshot());
  $("redo").disabled = !state.redo.length;
  const status = $("save-status");
  status.classList.toggle("unsaved", !!dirty);
  if (message) status.textContent = message;
  else if (dirty) status.textContent = "Unsaved changes";
  else if (!status.textContent || status.textContent === "Unsaved changes") status.textContent = "Everything is saved";
  $("file-path").textContent = state.file;
}

// One play button on a portrait. 'aspect' > 1 = a wide strip showing the middle of a square picture.
function spotHtml(spot, subject, aspect = 1) {
  const anchors = state.portraits[subject]?.anchors || {};
  const [ax, ay] = anchors[spot.at] || [0.5, 0.5];
  const x = ax + (spot.dx || 0);
  const y = ((ay + (spot.dy || 0)) - 0.5) * aspect + 0.5;
  const cls = ["spot", spot.silent ? "silent" : "", spot.left ? "label-left" : "", spot.below ? "label-below" : "",
    spot.sound && spot.sound === state.selected ? "selected" : ""].filter(Boolean).join(" ");
  const style = `left:${(x * 100).toFixed(1)}%;top:${(y * 100).toFixed(1)}%`;
  if (spot.silent)
    return `<span class="${cls}" style="${style}"><span class="spot-button" title="No sound here yet. Ask Claude if you want one."></span><span class="spot-label">${esc(spot.label)}</span></span>`;
  return `<span class="${cls}" style="${style}" data-sound="${spot.sound}" data-drop="sound">
    <button type="button" class="spot-button" data-play="${spot.sound}" aria-label="Play: ${esc(spot.label)}"></button>
    <span class="spot-label">${esc(spot.label)}</span></span>`;
}

function stageHtml(subject, spots, { small = false, aspect = 1, size = 0 } = {}) {
  const img = state.portraits[subject]?.image || "";
  const fit = `style="${aspect > 1 ? `aspect-ratio:${aspect};` : ""}${size ? `width:min(100% - 7rem, ${size}rem);` : ""}"`;
  return `<div class="stage${small ? " small" : ""}${aspect > 1 ? " wide-stage" : ""}" ${fit}>
    <img src="${esc(img)}" alt="" style="${aspect > 1 ? "object-fit:cover" : ""}">
    ${spots.map(s => spotHtml(s, subject, aspect)).join("")}</div>`;
}

function renderBoard() {
  $("board").innerHTML = CARDS.map(card => {
    const color = card.type ? state.enemies[card.type]?.color : card.color;
    const head = `<h2 class="card-title">${esc(card.title)}</h2><p class="card-note">${esc(card.note || "")}</p>`;
    if (card.kind === "portrait") {
      const side = card.sidekick
        ? `<div class="sidekick">${stageHtml(card.sidekick.subject, card.sidekick.spots, { small: !card.sidekick.aspect, aspect: card.sidekick.aspect || 1 })}
             <span class="strip-name">${esc(card.sidekick.name)}</span></div>`
        : "";
      return `<article class="card" style="--piece:${color}">${head}${stageHtml(card.subject, card.spots, { size: card.size })}${side}</article>`;
    }
    if (card.kind === "strip")
      return `<article class="card" style="--piece:${color}">${head}<div class="strip">${card.items.map(item =>
        `<div class="strip-item">${stageHtml(item.subject, item.spots, { small: true, aspect: item.aspect || 2.4 })}<span class="strip-name">${esc(item.name)}</span></div>`).join("")}</div></article>`;
    return `<article class="card" style="--piece:${color}">${head}<div class="signs">${card.signs.map(s =>
      `<div class="sign">${spotHtml({ sound: s.sound, label: nameOf(s.sound) }, "")}
        <span class="sign-text"><span class="sign-big">${esc(s.big)}</span><span class="sign-small">${esc(s.small)}</span></span></div>`).join("")}</div></article>`;
  }).join("");
}

// Where a sound can be heard, for the mixer: "You", "Archer", ...
function placesOf(id) {
  const places = [];
  for (const card of CARDS) {
    const spots = card.kind === "portrait" ? [...card.spots, ...(card.sidekick?.spots || [])]
      : card.kind === "strip" ? card.items.flatMap(i => i.spots) : card.signs;
    if (spots.some(s => s.sound === id)) places.push(card.title);
  }
  return places;
}

function layerTitle(layer) {
  const take = layer.takes[0] || "";
  const fam = layerFamily(layer);
  if (fam) return recordingName(fam);
  const name = recordingName(familyOf(take));
  if (!isNew(take)) return `Some takes of ${name}`;
  return state.saved.includes(JSON.stringify(take)) ? `${name} (new: your PC brings it into the game)` : `${name} (new, not saved yet)`;
}

// Which layers have "Cut and effects" open: sound id -> Set of layer numbers (kept while you edit).
const openFx = new Map();
const isOpen = (id, n) => !!openFx.get(id)?.has(n);
function setOpen(id, n, open) {
  if (!openFx.has(id)) openFx.set(id, new Set());
  openFx.get(id)[open ? "add" : "delete"](n);
}
// Removing or duplicating a layer moves the open ones below it along.
function openAfterRemove(id, n) {
  const s = openFx.get(id);
  if (s) openFx.set(id, new Set([...s].filter(i => i !== n).map(i => i > n ? i - 1 : i)));
}
function openAfterDuplicate(id, n) {
  const s = openFx.get(id);
  if (s) openFx.set(id, new Set([...s].flatMap(i => i < n ? [i] : i === n ? [n, n + 1] : [i + 1])));
}
const takeName = take => RECORDINGS[take] || state.meta[take]?.title ||
  take.replace(/^(kenney:|freesound:)/, "").split("/").pop().replace(/\.(ogg|wav|mp3|flac)$/i, "");

function takeHtml(layer, n, take, ti) {
  // A family's takes ("footstep_grass_000", ...) are named by number: the menu above already says what they are.
  const name = layer.takes.length > 1 && layerFamily(layer) ? `Take ${ti + 1}` : takeName(take);
  const locked = playsOriginal(take); // no handles and no numbers: a note says when it can be cut
  const handle = locked ? `aria-disabled="true"` : `tabindex="0"`;
  return `<div class="take">
    <div class="take-head">
      <button type="button" class="mini-play cut-play" data-cut-play="${n}:${ti}" data-key="cp-${n}-${ti}" aria-label="Play just this cut of ${esc(name)}" title="Play just this cut"></button>
      <span class="take-name" title="${esc(take)}">${esc(name)}</span>
      <span class="take-len"></span>
    </div>
    <div class="wave loading${locked ? " locked" : ""}" data-wave="${n}:${ti}">
      <canvas aria-hidden="true"></canvas>
      <span class="wave-dim wave-before"></span><span class="wave-dim wave-after"></span>
      <svg class="wave-env" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><polyline vector-effect="non-scaling-stroke" points=""/></svg>
      <span class="wave-handle" data-handle="start" role="slider" ${handle} data-key="hs-${n}-${ti}" aria-label="Where ${esc(name)} starts"></span>
      <span class="wave-handle" data-handle="end" role="slider" ${handle} data-key="he-${n}-${ti}" aria-label="Where ${esc(name)} ends"></span>
      <span class="wave-head"></span>
      <span class="wave-tag">◀ plays backwards</span>
      <span class="wave-note">Loading…</span>
    </div>
    ${locked ? `<p class="fx-note cut-lock">${esc(lockNote(take))}</p>` : `<div class="cut-row">
      <label>From <input type="number" class="num" min="0" step="0.001" inputmode="decimal" data-field="cutStart" data-layer="${n}" data-take="${ti}" data-key="cs-${n}-${ti}" disabled> s</label>
      <label>to <input type="number" class="num" min="0" step="0.001" inputmode="decimal" data-field="cutEnd" data-layer="${n}" data-take="${ti}" data-key="ce-${n}-${ti}" disabled> s</label>
    </div>`}
  </div>`;
}
function fxKnobHtml(layer, n, f) {
  const v = fxValue(layer, f);
  const idle = f.name === "echoDelay" && fxByName.echo && !fxOn(layer, fxByName.echo);
  const locked = isLocked(layer, f.name);
  const note = /\(([^)]*)\)\s*$/.exec(f.label)?.[1]; // "Low (200 Hz)": "200 Hz" goes under "Low"
  return `<label class="knob fx-knob${idle ? " idle" : ""}${locked ? " locked" : ""}" title="${esc(f.help)}${f.help ? " " : ""}Double-click the slider to put it back.">
    <span class="fx-label">${esc(shortLabel(f))}${note ? `<small>${esc(note)}</small>` : ""}</span>
    <input type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${v}" data-field="fx" data-name="${esc(f.name)}" data-layer="${n}" data-key="fx-${n}-${esc(f.name)}"${f.unit === "dB" ? ` list="zero-db"` : ""}${locked ? " disabled" : ""}>
    <output data-out="fx-${n}-${esc(f.name)}">${fxText(f, v)}</output></label>`;
}
function fxPanelHtml(layer, n) {
  const groups = FX_GROUPS.map(([title, names]) => [title, names.map(x => fxByName[x]).filter(Boolean)]);
  groups[2][1].push(...FX.filter(f => !FX_GROUPS.some(g => g[1].includes(f.name)))); // anything new: with the effects
  const lock = lockedLayer(layer);
  return `<div class="fx-panel">
    <p class="fx-sub">Where it starts and ends
      <span class="fx-note">Drag the green handles, or type the seconds.${layer.takes.length > 1 ? ` Each of the ${layer.takes.length} takes has its own cut; the game picks one at random each time.` : ""}</span></p>
    ${layer.takes.map((take, ti) => takeHtml(layer, n, take, ti)).join("")}
    ${lock ? `<p class="fx-note cut-lock">Backwards and the fades wait for that too: here they'd fall on silence the game's copy doesn't have.</p>` : ""}
    <label class="switch${lock ? " locked" : ""}"><input type="checkbox" data-reverse="${n}" data-key="rev-${n}" ${layer.reverse ? "checked" : ""}${lock ? " disabled" : ""}>
      <span class="switch-track" aria-hidden="true"></span><span>Backwards <span class="fx-note">(reverse: the cut plays from its end)</span></span></label>
    ${groups.filter(g => g[1].length).map(([title, list]) =>
      `<p class="fx-sub">${title}</p>${list.map(f => fxKnobHtml(layer, n, f)).join("")}`).join("")}
    <div class="fx-foot">
      <button type="button" class="ghost small-ghost" data-fx-reset="${n}" data-key="reset-${n}" ${isShaped(layer) ? "" : "disabled"}>Reset cut and effects</button>
    </div>
  </div>`;
}
// The "Cut and effects" button: its title, then what's on as chips (or "none yet").
function fxToggleHtml(layer) {
  const chips = fxChips(layer);
  return `<span class="fx-title">Cut and effects${chips.length ? "" : ` <span class="fx-none">none yet</span>`}</span>` +
    (chips.length ? `<span class="fx-chips">${chips.map(c => `<span class="fx-chip">${esc(c)}</span>`).join("")}</span>` : "");
}

function renderMixer() {
  // Keep the keyboard where it was when the mixer is drawn again.
  const focused = document.activeElement?.closest?.("#mixer [data-key]")?.dataset.key;
  const id = state.selected;
  const sound = id && soundById(id);
  if (!sound) {
    $("mixer").innerHTML = `<h2>Mixer</h2><p class="empty-mixer">Press any play button: you'll hear it, and see here what it's made of.
      To change it, play a sound from the library and press “Use for…” at the bottom.</p>`;
    return;
  }
  const fams = families();
  const options = [...fams.keys()].sort((a, b) => recordingName(a).localeCompare(recordingName(b)));
  const layers = sound.layers.map((layer, n) => {
    const fam = layerFamily(layer);
    const center = (layer.pitchMin + layer.pitchMax) / 2;
    const opts = (fam ? "" : `<option value="" selected>${esc(layerTitle(layer))}</option>`) +
      options.map(k => `<option value="${esc(k)}" ${k === fam ? "selected" : ""}>${esc(recordingName(k))}</option>`).join("");
    const credit = state.meta[layer.takes[0]];
    const open = isOpen(id, n);
    const fx = !DSP ? `<p class="fx-note">Cut and effects need sound_dsp.js, which didn't load. Reload the page.</p>`
      : `<button type="button" class="fx-toggle" data-fx-open="${n}" data-key="fx-open-${n}" aria-expanded="${open}">${fxToggleHtml(layer)}</button>
        ${open ? fxPanelHtml(layer, n) : ""}`;
    return `<div class="layer${open ? " open" : ""}" data-drop="layer" data-layer="${n}">
      <div class="layer-head">
        <button type="button" class="mini-play" data-layer-play="${n}" data-key="lp-${n}" aria-label="Play only this layer" title="Play only this layer (at once, with its cut and effects)"></button>
        <select class="select" data-field="family" data-layer="${n}" data-key="fam-${n}" aria-label="Recording">${opts}</select>
      </div>
      <label class="knob">Volume <input type="range" min="0" max="100" step="1" value="${Math.round(layer.volume * 100)}" data-field="volume" data-layer="${n}" data-key="vol-${n}">
        <output data-out="volume-${n}">${Math.round(layer.volume * 100)}%</output></label>
      <label class="knob">Pitch <input type="range" min="30" max="250" step="1" value="${Math.round(center * 100)}" data-field="pitch" data-layer="${n}" data-key="pitch-${n}">
        <output data-out="pitch-${n}">×${center.toFixed(2)}</output></label>
      ${fx}
      <div class="layer-foot"><span>${credit ? `${esc(credit.source || "")}${credit.author ? ", by " + esc(credit.author) : ""}` :
        `${layer.takes.length} take${layer.takes.length === 1 ? "" : "s"}, one picked at random`}</span>
        <span class="layer-actions">
          <button type="button" class="remove" data-duplicate="${n}" data-key="dup-${n}" title="Add a copy of this layer below it (with its cut and effects)">Duplicate</button>
          <button type="button" class="remove" data-remove="${n}" data-key="rm-${n}">Remove</button>
        </span></div>
    </div>`;
  }).join("");
  const changed = JSON.stringify(sound) !== JSON.stringify(savedSound(id));
  $("mixer").innerHTML = `
    <h2>${esc(nameOf(id))}</h2>
    <p class="about">${esc(sound.about || "")}</p>
    <p class="where">On this page: ${esc(placesOf(id).join(", ") || "nowhere")}. In the game it's called <code>${esc(id)}</code>.</p>
    <div class="mixer-buttons">
      <button type="button" class="play-big" id="play-big">Play</button>
      ${changed ? `<button type="button" class="ghost" id="revert">Back to the saved version</button>` : ""}
    </div>
    <h3 id="layers-title">${layersTitle(sound)}</h3>
    <datalist id="zero-db"><option value="0"></option></datalist>
    ${layers || `<p class="empty-mixer">Nothing: this sound is silent. Add a recording below.</p>`}
    <div class="drop-add" data-drop="add">
      <label class="add-layer"><span class="field-label">Add a recording to this sound</span>
        <select class="select" id="add-layer"><option value="">Choose one already in the game…</option>
          ${options.map(k => `<option value="${esc(k)}">${esc(recordingName(k))}</option>`).join("")}</select></label>
      <p class="drop-hint">…or drag one here from the library.</p>
    </div>
    <p class="hint">To replace this sound, pick one in the library and press “Use for…” in the player bar, or
      drag it onto a play button (or onto a layer above, to replace just that layer). Changes play here
      right away; press Save to put them in the game.
      <kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes.</p>`;
  if (focused) $("mixer").querySelector(`[data-key="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  drawWaves();
}
function layersTitle(sound) {
  const later = fxByName.delay && sound.layers.some(l => fxOn(l, fxByName.delay));
  return `Made of ${sound.layers.length} layer${sound.layers.length === 1 ? "" : "s"}, played together${later ? " (some start later)" : ""}`;
}
// Redraws only a layer's chips and Reset button (while a slider moves, the mixer isn't drawn again).
function refreshChips(n) {
  const sound = soundById(state.selected);
  const layer = sound?.layers[n];
  const toggle = $("mixer").querySelector(`[data-fx-open="${n}"]`);
  if (!layer || !toggle) return;
  toggle.innerHTML = fxToggleHtml(layer);
  const reset = $("mixer").querySelector(`[data-fx-reset="${n}"]`);
  if (reset) reset.disabled = !isShaped(layer);
  if ($("layers-title")) $("layers-title").textContent = layersTitle(sound);
}

function select(id) {
  commitPending();
  state.selected = id;
  document.querySelectorAll(".spot").forEach(s => s.classList.toggle("selected", s.dataset.sound === id));
  renderMixer();
  renderPlayer();
}

// ---------- the library ----------

function loadPicks() {
  try { return JSON.parse(localStorage.getItem("testdrive.picks") || "[]"); } catch { return []; }
}
function savePicks() {
  try { localStorage.setItem("testdrive.picks", JSON.stringify(state.lib.picks)); } catch { /* private window: picks last until reload */ }
}
const isPicked = ref => state.lib.picks.some(p => p.ref === ref);

// Library entries: { ref, takes[], title, sub (author, pack or where it's used), time, meta, link? }
function gameItems() {
  const used = new Map();
  for (const s of state.plan.sounds)
    for (const l of s.layers)
      for (const t of l.takes) {
        const k = familyOf(t);
        if (!used.has(k)) used.set(k, new Set());
        used.get(k).add(nameOf(s.id));
      }
  const q = state.lib.query.toLowerCase();
  return [...families().entries()]
    .map(([k, takes]) => {
      const meta = (takes.length > 1 ? `${takes.length} takes. ` : "") + (used.has(k) ? "In: " + [...used.get(k)].join(", ") : "Not used yet");
      return { ref: "game:" + k, takes, title: recordingName(k), sub: meta, time: "", meta };
    })
    .filter(i => !q || i.title.toLowerCase().includes(q) || i.ref.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title));
}
function kenneyItems() {
  const k = state.lib.kenney;
  if (!k || k.status !== "ready") return [];
  const words = state.lib.query.toLowerCase().split(/\s+/).filter(Boolean);
  return k.sounds
    .filter(s => !state.lib.pack || s.pack === state.lib.pack)
    .filter(s => words.every(w => (s.name + " " + s.packName).toLowerCase().includes(w)))
    .map(s => ({ ref: s.ref, takes: [s.ref], title: s.name, sub: s.packName, time: seconds(s.seconds), meta: `${seconds(s.seconds)}, ${s.packName}`,
      source: "Kenney: " + s.packName, author: "Kenney", seconds: s.seconds }));
}
function freesoundItems() {
  return state.lib.fs.results.map(s => ({ ref: s.ref, takes: [s.ref], title: s.title, sub: "by " + s.author, time: seconds(s.seconds),
    meta: `${seconds(s.seconds)}, by ${s.author}`,
    link: s.link, source: "Freesound", author: s.author, seconds: s.seconds }));
}

function remember(item) {
  for (const t of item.takes)
    if (isNew(t) && !state.meta[t]) state.meta[t] = { title: item.title, author: item.author, source: item.source, link: item.link };
}

async function loadKenney() {
  try { state.lib.kenney = await Store.kenney(); }
  catch (e) { state.lib.kenney = { status: "error", log: e.message }; }
  if (state.lib.source === "kenney") renderLibrary();
  if (state.lib.kenney.status === "downloading") setTimeout(loadKenney, 2000);
}

let searchTimer = null;
async function searchFreesound(more = false) {
  const fs = state.lib.fs;
  const query = state.lib.query.trim();
  if (!query) { Object.assign(fs, { results: [], page: 0, more: false, count: 0, error: "", query: "" }); renderLibrary(); return; }
  const page = more ? fs.page + 1 : 1;
  fs.busy = true; fs.error = "";
  renderLibrary();
  try {
    const r = await Store.searchFreesound(query, page, state.lib.sort, state.lib.short);
    if (state.lib.query.trim() !== query) return; // a newer search is on its way
    fs.results = more ? fs.results.concat(r.results) : r.results;
    Object.assign(fs, { page, more: r.more, count: r.count, query });
    if (!more) state.lib.sel = -1;
  } catch (e) {
    fs.error = e.message;
  } finally {
    fs.busy = false;
    renderLibrary();
  }
}

function renderLibrary() {
  const lib = state.lib;
  const src = lib.source;
  document.querySelectorAll("[data-source]").forEach(b => b.setAttribute("aria-selected", b.dataset.source === src));
  $("library").title = SOURCES[src].note;
  $("lib-search").value = lib.query;
  $("lib-search").placeholder = src === "freesound" ? "Search Freesound: sword, footstep, explosion…" : "Filter by name…";
  $("lib-filters").innerHTML = src === "freesound"
    ? `<label class="check"><input type="checkbox" id="lib-short" ${lib.short ? "checked" : ""}> Only under 6 s</label>
       <select class="select small-select" id="lib-sort" aria-label="Order">
         ${[["best", "Best match"], ["downloads", "Most downloaded"], ["rating", "Best rated"], ["newest", "Newest"]]
           .map(([v, t]) => `<option value="${v}" ${lib.sort === v ? "selected" : ""}>${t}</option>`).join("")}</select>`
    : src === "kenney" && lib.kenney?.status === "ready"
      ? `<select class="select small-select" id="lib-pack" aria-label="Pack"><option value="">All packs</option>
          ${[...new Map(lib.kenney.sounds.map(s => [s.pack, s.packName])).entries()]
            .map(([p, n]) => `<option value="${p}" ${lib.pack === p ? "selected" : ""}>${esc(n)}</option>`).join("")}</select>`
      : "";
  $("lib-chips").hidden = src === "game" || src === "picks";

  let items = [], message = "", more = "";
  if (src === "freesound") {
    const fs = lib.fs;
    if (!state.hasFreesound) message = "There's no Freesound key on this computer yet (GamePages/private/freesound-key.txt).";
    else if (fs.error) message = fs.error;
    else if (!lib.query.trim()) message = "Type what you're looking for, or press one of the words above.";
    else if (fs.busy && !fs.results.length) message = "Searching Freesound…";
    else {
      items = freesoundItems();
      if (!items.length) message = "Nothing found. Try another word, or untick “Short sounds only”.";
      if (fs.more) more = `<button type="button" class="ghost more" id="lib-more" ${fs.busy ? "disabled" : ""}>${fs.busy ? "Loading…" : "More results"}</button>`;
    }
    $("lib-count").textContent = fs.query ? `${fs.count.toLocaleString("en-US")} free (CC0) sounds for “${fs.query}”` : "Free (CC0) sounds only.";
  } else if (src === "kenney") {
    const k = lib.kenney;
    if (!k) message = "Loading…";
    else if (k.status === "missing" && !Store.online) message = `<button type="button" class="ghost" id="get-kenney">Download Kenney's packs (17 MB, about a minute)</button>`;
    else if (k.status === "downloading") message = "Downloading Kenney's packs…";
    else if (k.status !== "ready") message = "Couldn't read the packs: " + esc(k.log || "");
    else items = kenneyItems();
    $("lib-count").textContent = k?.status === "ready" ? `${items.length} of ${k.sounds.length} sounds, all free (CC0)` : "";
  } else if (src === "game") {
    items = gameItems();
    $("lib-count").textContent = `${items.length} recordings`;
  } else {
    const q = lib.query.toLowerCase();
    items = lib.picks.filter(p => !q || p.title.toLowerCase().includes(q));
    if (!lib.picks.length) message = "Nothing here yet. Press the star next to a sound to keep it here.";
    $("lib-count").textContent = lib.picks.length ? `${items.length} picks` : "";
  }
  lib.items = items;
  if (lib.sel >= items.length) lib.sel = -1;
  $("lib-results").innerHTML = items.map((it, i) => `
    <li class="track${i === lib.sel ? " current" : ""}" draggable="true" data-i="${i}" role="option" aria-selected="${i === lib.sel}">
      <button type="button" class="track-play" data-hit-play="${i}" aria-label="Listen to ${esc(it.title)}"><span class="track-num">${i + 1}</span>${ICONS.play}${ICONS.pause}</button>
      <span class="track-text"><span class="track-title">${esc(it.title)}</span><span class="track-sub">${esc(it.sub ?? it.meta ?? "")}</span></span>
      <span class="track-time">${esc(it.time ?? "")}</span>
      <button type="button" class="like" data-star="${i}" aria-pressed="${isPicked(it.ref)}" aria-label="${isPicked(it.ref) ? "Take out of Picks" : "Keep in Picks"}">${ICONS.star}</button>
    </li>`).join("") + (message ? `<li class="lib-message">${message.startsWith("<") ? message : esc(message)}</li>` : "") +
    (more ? `<li class="lib-message">${more}</li>` : "");
  renderPlaying();
}

// ---------- the library's player (the bar along the bottom) ----------
// One <audio> for every library sound. It streams, so it starts at once even on a phone, and a new
// sound simply takes the last one's place: two can never play together.
const player = new Audio();
player.preload = "auto";
player.volume = MASTER;
let previewItem = null; // the sound in the player bar
let listens = 0;

function pausePreview() { if (!player.paused) player.pause(); }
function togglePreview() {
  if (!previewItem) return;
  if (!player.getAttribute("src")) return listen(state.lib.sel, { again: true });
  if (player.paused) player.play().catch(() => {});
  else player.pause();
}

function renderPlayer() {
  $("player").classList.toggle("idle", !previewItem);
  $("np-toggle").disabled = $("np-seek").disabled = !previewItem;
  if (previewItem) {
    $("np-title").textContent = previewItem.title;
    $("np-sub").innerHTML = esc(previewItem.sub ?? previewItem.meta ?? "") +
      (previewItem.link ? ` <a href="${esc(previewItem.link)}" target="_blank" rel="noopener">(on Freesound)</a>` : "");
  }
  const use = $("lib-use");
  use.disabled = !state.selected || !previewItem;
  use.textContent = state.selected ? `Use for “${nameOf(state.selected)}”` : "Press ▶ on a part first";
  use.title = state.selected ? `Put this sound in place of “${nameOf(state.selected)}” (Enter)` : "First press a play button on a character, to choose which sound to replace.";
}
// Playing or not: the bar's button and the row's pause icon.
let frame = 0, seeking = false;
function renderPlaying() {
  const playing = !!previewItem && !player.paused && !player.ended;
  $("player").classList.toggle("playing", playing);
  $("np-toggle").setAttribute("aria-label", playing ? "Pause" : "Play");
  const here = previewItem && state.lib.items[state.lib.sel]?.ref === previewItem.ref ? state.lib.sel : -1;
  document.querySelectorAll(".track").forEach(li => li.classList.toggle("playing", playing && +li.dataset.i === here));
  cancelAnimationFrame(frame);
  if (playing) frame = requestAnimationFrame(tick);
  renderTime();
}
function tick() { renderTime(); if (!player.paused) frame = requestAnimationFrame(tick); }
function renderTime() {
  const length = Number.isFinite(player.duration) ? player.duration : previewItem?.seconds || 0;
  const now = Math.min(player.currentTime || 0, length || Infinity);
  $("np-now").textContent = seconds(now);
  $("np-length").textContent = seconds(length);
  const seek = $("np-seek");
  if (!seeking) seek.value = length ? Math.round(now / length * 1000) : 0;
  seek.style.setProperty("--done", seek.value / 10 + "%");
}
for (const e of ["play", "playing", "pause", "ended", "emptied", "loadedmetadata"]) player.addEventListener(e, renderPlaying);
player.addEventListener("play", () => { presses++; stopSounds(); }); // no game sound over a library one
player.addEventListener("error", () => {
  if (!player.getAttribute("src") || !previewItem) return;
  showProblem(`Couldn't play “${previewItem.title}”. Check the internet connection, or try another one.`);
  setTimeout(() => showProblem(null), 4000);
});
$("np-seek").addEventListener("input", ev => {
  seeking = true;
  if (Number.isFinite(player.duration)) player.currentTime = ev.target.value / 1000 * player.duration;
  ev.target.style.setProperty("--done", ev.target.value / 10 + "%");
});
$("np-seek").addEventListener("change", () => { seeking = false; });

// Scrolls the list (never the page) so row i is in view.
function showInList(i) {
  const list = $("lib-results");
  const row = list.querySelector(`.track[data-i="${i}"]`);
  if (!row) return;
  const l = list.getBoundingClientRect(), r = row.getBoundingClientRect();
  if (r.top < l.top) list.scrollTop -= l.top - r.top;
  else if (r.bottom > l.bottom) list.scrollTop += r.bottom - l.bottom;
}
// ↓/↑: the next or previous sound in the library, played at once. At the end of the Freesound
// results it fetches more; otherwise it wraps around.
async function step(delta) {
  const lib = state.lib, n = lib.items.length;
  if (!n) return;
  if (lib.sel < 0) return listen(delta > 0 ? 0 : n - 1);
  const next = lib.sel + delta;
  if (next >= n && lib.source === "freesound" && lib.fs.more && !lib.fs.busy) {
    const keep = lib.sel;
    await searchFreesound(true);
    lib.sel = keep;
    return listen(next);
  }
  listen((next + n) % n);
}
// Plays library sound i in the player bar. Pressing the one that's already there pauses or resumes it.
async function listen(i, { again = false } = {}) {
  const item = state.lib.items[i];
  if (!item) return;
  if (!again && previewItem?.ref === item.ref && state.lib.sel === i && player.getAttribute("src")) return togglePreview();
  state.lib.sel = i;
  document.querySelectorAll(".track").forEach(li => { li.classList.toggle("current", +li.dataset.i === i); li.setAttribute("aria-selected", +li.dataset.i === i); });
  showInList(i);
  previewItem = item;
  remember(item);
  renderPlayer();
  const n = ++listens;
  const take = item.takes[Math.floor(Math.random() * item.takes.length)];
  let url = Store.streamUrl(take);
  if (typeof url !== "string") { // a Freesound sound we haven't looked up yet
    player.pause();
    try { url = await url; } catch { url = null; }
    if (n !== listens) return;
    if (!url) {
      showProblem(`Couldn't reach “${item.title}”. Check the internet connection, or try another one.`);
      setTimeout(() => showProblem(null), 4000);
      return;
    }
  }
  player.src = url;
  player.play().catch(() => renderPlaying()); // a newer sound took its place, or the phone wants a tap on ▶
  renderPlaying();
}

// Puts a library sound into a game sound: replacing it all, one layer, or as a new layer.
function useOn(id, item, { layer = null, add = false } = {}) {
  if (!item || !soundById(id)) return;
  remember(item);
  change(() => {
    const s = soundById(id);
    const fresh = { takes: [...item.takes], volume: 0.8, pitchMin: 0.97, pitchMax: 1.03 };
    if (add) s.layers.push({ ...fresh, volume: 0.6 });
    else if (layer != null && s.layers[layer]) {
      s.layers[layer].takes = [...item.takes]; // its effects stay; the old recordings' cuts go
      tidyLayer(s.layers[layer]);
    } else s.layers = [fresh];
  });
  if (state.selected !== id) select(id);
  play(id, document.querySelector(`.spot[data-sound="${id}"] .spot-button`) || $("play-big"));
}

// ---------- reacting ----------

document.addEventListener("click", ev => {
  if (!state.plan) return;
  const t = ev.target;
  const spot = t.closest("[data-play]");
  if (spot) {
    const id = spot.dataset.play;
    select(id);
    play(id, spot.closest(".spot") || spot);
    return;
  }
  if (t.closest("#play-big")) return play(state.selected, $("play-big"));
  if (t.closest("#revert")) return change(() => { Object.assign(soundById(state.selected), savedSound(state.selected)); });
  const layerPlay = t.closest("[data-layer-play]");
  if (layerPlay) {
    const layer = soundById(state.selected).layers[+layerPlay.dataset.layerPlay];
    playLayers([layer], layerPlay, { solo: true });
    return;
  }
  const remove = t.closest("[data-remove]");
  if (remove) {
    const n = +remove.dataset.remove;
    openAfterRemove(state.selected, n);
    return change(() => soundById(state.selected).layers.splice(n, 1));
  }
  // Cut and effects
  const fxOpen = t.closest("[data-fx-open]");
  if (fxOpen) {
    setOpen(state.selected, +fxOpen.dataset.fxOpen, !isOpen(state.selected, +fxOpen.dataset.fxOpen));
    commitPending();
    return renderMixer();
  }
  const cutPlay = t.closest("[data-cut-play]");
  if (cutPlay) {
    const [n, ti] = cutPlay.dataset.cutPlay.split(":").map(Number);
    const layer = soundById(state.selected)?.layers[n];
    if (layer?.takes[ti] != null) playCut(layer, layer.takes[ti], cutPlay);
    return;
  }
  const duplicate = t.closest("[data-duplicate]");
  if (duplicate) {
    const n = +duplicate.dataset.duplicate;
    openAfterDuplicate(state.selected, n);
    return change(() => {
      const layers = soundById(state.selected).layers;
      layers.splice(n + 1, 0, JSON.parse(JSON.stringify(layers[n])));
    });
  }
  const reset = t.closest("[data-fx-reset]");
  if (reset) return change(() => plainLayer(soundById(state.selected).layers[+reset.dataset.fxReset]));

  // library
  const tab = t.closest("[data-source]");
  if (tab) {
    state.lib.source = tab.dataset.source;
    state.lib.sel = -1;
    if (tab.dataset.source === "kenney" && !state.lib.kenney) loadKenney();
    if (tab.dataset.source === "freesound" && state.lib.query.trim() && state.lib.query.trim() !== state.lib.fs.query) searchFreesound();
    renderLibrary();
    return;
  }
  const chip = t.closest("[data-chip]");
  if (chip) {
    state.lib.query = chip.dataset.chip;
    if (state.lib.source === "freesound") searchFreesound();
    else renderLibrary();
    return;
  }
  const star = t.closest("[data-star]");
  if (star) {
    const item = state.lib.items[+star.dataset.star];
    if (isPicked(item.ref)) state.lib.picks = state.lib.picks.filter(p => p.ref !== item.ref);
    else state.lib.picks.push({ ...item });
    savePicks();
    renderLibrary();
    return;
  }
  const hitPlay = t.closest("[data-hit-play]");
  if (hitPlay) return listen(+hitPlay.dataset.hitPlay);
  const hit = t.closest(".track");
  if (hit) return listen(+hit.dataset.i);
  if (t.closest("#np-toggle")) return togglePreview();
  if (t.closest("#lib-more")) return searchFreesound(true);
  if (t.closest("#get-kenney")) {
    Store.downloadKenney().then(k => { state.lib.kenney = k; renderLibrary(); setTimeout(loadKenney, 2000); });
    return;
  }
  if (t.closest("#lib-use") && previewItem && state.selected) useOn(state.selected, previewItem);
  // Phones: the drawer opens from anywhere on its head, and closes with its button.
  if (t.closest("#sheet-toggle") || (t.closest(".library-head") && $("library").classList.contains("collapsed")))
    setSheet(!$("library").classList.contains("collapsed"));
});

// Phones: open and close the library drawer.
function setSheet(closed) {
  $("library").classList.toggle("collapsed", closed);
  $("sheet-toggle").textContent = closed ? "Open" : "Hide";
  $("sheet-toggle").setAttribute("aria-expanded", !closed);
}
if (matchMedia("(max-width: 800px)").matches) setSheet(true);

// Dragging a library sound onto a play button or a mixer layer.
let dragged = null;
document.addEventListener("dragstart", ev => {
  const hit = ev.target.closest?.(".track");
  if (!hit) return;
  dragged = state.lib.items[+hit.dataset.i];
  remember(dragged);
  ev.dataTransfer.setData(DRAG_TYPE, dragged.ref);
  ev.dataTransfer.setData("text/plain", dragged.title);
  ev.dataTransfer.effectAllowed = "copy";
  document.body.classList.add("dragging-sound");
});
document.addEventListener("dragend", () => {
  dragged = null;
  document.body.classList.remove("dragging-sound");
  document.querySelectorAll(".drop-hover").forEach(e => e.classList.remove("drop-hover"));
});
function dropTarget(ev) {
  if (!dragged || !ev.dataTransfer.types.includes(DRAG_TYPE)) return null;
  const target = ev.target.closest?.("[data-drop]");
  if (!target) return null;
  if (target.dataset.drop !== "sound" && !state.selected) return null;
  return target;
}
document.addEventListener("dragover", ev => {
  const target = dropTarget(ev);
  document.querySelectorAll(".drop-hover").forEach(e => { if (e !== target) e.classList.remove("drop-hover"); });
  if (!target) return;
  ev.preventDefault();
  ev.dataTransfer.dropEffect = "copy";
  target.classList.add("drop-hover");
});
document.addEventListener("drop", ev => {
  const target = dropTarget(ev);
  if (!target) return;
  ev.preventDefault();
  const item = dragged;
  document.body.classList.remove("dragging-sound");
  target.classList.remove("drop-hover");
  if (target.dataset.drop === "sound") useOn(target.dataset.sound, item);
  else if (target.dataset.drop === "layer") useOn(state.selected, item, { layer: +target.dataset.layer });
  else useOn(state.selected, item, { add: true });
});

document.addEventListener("focusin", ev => {
  if (ev.target.dataset?.field) { commitPending(); state.pending = snapshot(); }
});

// ---------- cutting: dragging the handles on a waveform ----------
// Pressing on a waveform moves the nearer handle there, and dragging moves it on. On a phone a swipe
// up or down still scrolls the page (and puts the handle back).
function waveTarget(wave) {
  const [n, ti] = wave.dataset.wave.split(":").map(Number);
  const layer = soundById(state.selected)?.layers[n];
  const take = layer?.takes[ti];
  const length = take != null && waveInfo.get(take)?.seconds;
  return length && !playsOriginal(take) ? { n, ti, layer, take, length } : null;
}
document.addEventListener("pointerdown", ev => {
  // A slider pressed on a touch screen may never get the focus: remember the sound before it moves.
  if (ev.target.dataset?.field && ev.target.closest("#mixer")) { commitPending(); state.pending = snapshot(); }
  const wave = ev.target.closest?.(".wave[data-wave]");
  if (!wave || ev.button > 0) return;
  const it = waveTarget(wave);
  if (!it) return;
  ev.preventDefault();
  commitPending();
  state.pending = snapshot();
  const before = it.layer.cuts?.[it.take] ? [...it.layer.cuts[it.take]] : null;
  const rect = wave.getBoundingClientRect();
  const at = x => clamp((x - rect.left) / rect.width, 0, 1) * it.length;
  let [s, e] = cutOf(it.layer, it.take, it.length);
  const t0 = at(ev.clientX);
  const which = ev.target.closest(".wave-handle")?.dataset.handle || (Math.abs(t0 - s) <= Math.abs(t0 - e) ? "start" : "end");
  const move = x => {
    const v = at(x);
    if (which === "start") s = Math.min(v, e - MIN_CUT);
    else e = Math.max(v, s + MIN_CUT);
    setCut(it.layer, it.take, Math.max(0, s), Math.min(it.length, e), it.length);
    refreshWave(it.n, it.ti);
  };
  move(ev.clientX);
  wave.classList.add("dragging");
  wave.querySelector(`.wave-handle[data-handle="${which}"]`)?.focus({ preventScroll: true });
  try { wave.setPointerCapture(ev.pointerId); } catch { /* the pointer is gone already */ }
  const done = cancelled => {
    wave.removeEventListener("pointermove", onMove);
    wave.removeEventListener("pointerup", onUp);
    wave.removeEventListener("pointercancel", onCancel);
    wave.classList.remove("dragging");
    if (cancelled) { // the page scrolled instead: the cut goes back to what it was
      if (before) it.layer.cuts = { ...(it.layer.cuts || {}), [it.take]: before };
      else if (it.layer.cuts) delete it.layer.cuts[it.take];
      tidyLayer(it.layer);
      refreshWave(it.n, it.ti);
    }
    commitPending();
    refreshChips(it.n);
    renderStatus();
  };
  const onMove = e2 => move(e2.clientX);
  const onUp = () => done(false);
  const onCancel = () => done(true);
  wave.addEventListener("pointermove", onMove);
  wave.addEventListener("pointerup", onUp);
  wave.addEventListener("pointercancel", onCancel);
});
// The handles with the keyboard: ← → move by 0.01 s (with Shift 0.1 s), Home and End go to the ends,
// Space or Enter plays the cut.
document.addEventListener("keydown", ev => {
  const handle = ev.target.closest?.(".wave-handle");
  if (!handle || ev.ctrlKey || ev.metaKey || ev.altKey) return;
  const it = waveTarget(handle.closest(".wave"));
  if (!it) return;
  if (ev.key === " " || ev.key === "Enter") {
    ev.preventDefault();
    ev.stopImmediatePropagation(); // not the player bar's Space
    playCut(it.layer, it.take, handle.closest(".take").querySelector(".cut-play"));
    return;
  }
  const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[ev.key];
  if (!step && ev.key !== "Home" && ev.key !== "End") return;
  ev.preventDefault();
  ev.stopImmediatePropagation(); // not the library's ↑/↓
  commitPending();
  state.pending = snapshot();
  let [s, e] = cutOf(it.layer, it.take, it.length);
  const by = step * (ev.shiftKey ? 0.1 : 0.01);
  if (handle.dataset.handle === "start") s = clamp(ev.key === "Home" ? 0 : ev.key === "End" ? e - MIN_CUT : s + by, 0, e - MIN_CUT);
  else e = clamp(ev.key === "Home" ? s + MIN_CUT : ev.key === "End" ? it.length : e + by, s + MIN_CUT, it.length);
  setCut(it.layer, it.take, s, e, it.length);
  refreshWave(it.n, it.ti);
  commitPending();
  refreshChips(it.n);
  renderStatus();
}, true);
// Double-click a slider in "Cut and effects" to put it back to where it starts.
document.addEventListener("dblclick", ev => {
  const el = ev.target.closest?.('[data-field="fx"]');
  const f = el && fxByName[el.dataset.name];
  const layer = f && soundById(state.selected)?.layers[+el.dataset.layer];
  if (layer && fxOn(layer, f) && !isLocked(layer, f.name)) change(() => setFx(layer, f, f.def));
});

function onField(el, commit) {
  const sound = soundById(state.selected);
  const layer = sound?.layers[+el.dataset.layer];
  if (!layer) return;
  const field = el.dataset.field;
  if (field === "volume") {
    layer.volume = Math.round(+el.value) / 100;
    document.querySelector(`[data-out="volume-${el.dataset.layer}"]`).textContent = Math.round(+el.value) + "%";
  } else if (field === "pitch") {
    const spread = Math.max(0, layer.pitchMax - layer.pitchMin) / 2;
    const center = +el.value / 100;
    layer.pitchMin = +Math.max(0.1, center - spread).toFixed(3);
    layer.pitchMax = +(center + spread).toFixed(3);
    document.querySelector(`[data-out="pitch-${el.dataset.layer}"]`).textContent = "×" + center.toFixed(2);
  } else if (field === "family" && commit && el.value) {
    layer.takes = [...families().get(el.value)];
    tidyLayer(layer); // the old recordings' cuts go, its effects stay
  } else if (field === "fx") {
    const f = fxByName[el.dataset.name];
    if (!f) return;
    if (isLocked(layer, f.name)) { el.value = fxValue(layer, f); return; }
    setFx(layer, f, +el.value);
    const n = el.dataset.layer;
    $("mixer").querySelector(`[data-out="fx-${n}-${CSS.escape(f.name)}"]`).textContent = fxText(f, fxValue(layer, f));
    if (f.name === "echo") $("mixer").querySelector(`[data-name="echoDelay"][data-layer="${n}"]`)?.closest(".knob").classList.toggle("idle", !fxOn(layer, f));
    if (f.name === "fadeIn" || f.name === "fadeOut") layer.takes.forEach((_, ti) => refreshWave(+n, ti));
  } else if (field === "cutStart" || field === "cutEnd") {
    if (!commit) return; // typed numbers count when you press Enter or leave the box
    const take = layer.takes[+el.dataset.take];
    const length = waveInfo.get(take)?.seconds;
    if (!length || playsOriginal(take)) return;
    let [s, e] = cutOf(layer, take, length);
    const v = clamp(Number.isFinite(+el.value) && el.value !== "" ? +el.value : field === "cutStart" ? 0 : length, 0, length);
    if (field === "cutStart") s = Math.min(v, e - MIN_CUT);
    else e = Math.max(v, s + MIN_CUT);
    setCut(layer, take, Math.max(0, s), Math.min(length, e), length);
    // The box shows the value the cut really got (refreshWave leaves a focused box alone).
    el.value = cutOf(layer, take, length)[field === "cutStart" ? 0 : 1].toFixed(3);
    refreshWave(+el.dataset.layer, +el.dataset.take);
  }
  if (commit) {
    commitPending();
    state.pending = snapshot();
    if (field === "family") { renderMixer(); playLayers([layer], null, { solo: true }); }
    else if (field === "fx" || field === "cutStart" || field === "cutEnd") refreshChips(+el.dataset.layer);
  }
  renderStatus();
}
document.addEventListener("input", ev => {
  if (ev.target.dataset?.field) return onField(ev.target, false);
  if (ev.target.id === "lib-search") {
    state.lib.query = ev.target.value;
    if (state.lib.source === "freesound") {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => searchFreesound(), 600);
    } else renderLibraryKeepFocus();
  }
});
// Re-draws the list without losing the cursor in the search box.
function renderLibraryKeepFocus() {
  const box = $("lib-search"), at = box.selectionStart;
  renderLibrary();
  box.focus();
  box.setSelectionRange(at, at);
}
document.addEventListener("change", ev => {
  const t = ev.target;
  if (t.dataset?.reverse != null) {
    const layer = soundById(state.selected)?.layers[+t.dataset.reverse];
    if (layer && lockedLayer(layer)) t.checked = !!layer.reverse;
    else if (layer) change(() => { layer.reverse = t.checked; tidyLayer(layer); });
    return;
  }
  if (t.dataset?.field) return onField(t, true);
  if (t.id === "add-layer" && t.value) {
    const takes = [...families().get(t.value)];
    change(() => soundById(state.selected).layers.push({ takes, volume: 0.6, pitchMin: 0.95, pitchMax: 1.05 }));
    play(state.selected, $("play-big"));
  }
  if (t.id === "lib-short") { state.lib.short = t.checked; searchFreesound(); }
  if (t.id === "lib-sort") { state.lib.sort = t.value; searchFreesound(); }
  if (t.id === "lib-pack") { state.lib.pack = t.value; renderLibrary(); }
});

document.addEventListener("keydown", ev => {
  const ctrl = ev.ctrlKey || ev.metaKey;
  const inText = ev.target.matches?.("input[type=search], input[type=text]");
  if (ctrl && ev.key.toLowerCase() === "s") { ev.preventDefault(); save(); return; }
  if (ctrl && !inText && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (ctrl && !inText && ev.key.toLowerCase() === "y") { ev.preventDefault(); redo(); return; }
  // ↓/↑ go through the library's sounds and play each one, instead of scrolling the page.
  // Only a mixer slider, a drop-down or a text box (other than the library search) keeps them.
  const inLibrary = ev.target.closest?.("#library");
  const ownsArrows = ev.target.matches?.("select, textarea, input:not(#lib-search)");
  if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && !ctrl && !ev.altKey && !ownsArrows && state.lib.items.length) {
    ev.preventDefault();
    step(ev.key === "ArrowDown" ? 1 : -1);
    return;
  }
  // Space: play or pause the player bar (a focused button or box keeps its own Space).
  if (ev.key === " " && !ctrl && !ev.target.matches?.("input, select, textarea, button, a") && previewItem) {
    ev.preventDefault();
    togglePreview();
    return;
  }
  if (inLibrary && ev.key === "Enter") {
    if (ev.target.id === "lib-search" && state.lib.source === "freesound") { clearTimeout(searchTimer); searchFreesound(); return; }
    if (previewItem && state.selected && ev.target.id !== "lib-search") useOn(state.selected, previewItem);
  }
});

$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("save").addEventListener("click", save);
// The library and the mixer stick just under the header, whatever its height.
const header = document.querySelector(".top");
new ResizeObserver(() => document.documentElement.style.setProperty("--below-top", header.offsetHeight + 8 + "px")).observe(header);
$("lib-chips").innerHTML = CHIPS.map(c => `<button type="button" class="chip" data-chip="${c}">${c}</button>`).join("");
window.addEventListener("beforeunload", ev => {
  if (state.plan && snapshot() !== state.saved) { ev.preventDefault(); ev.returnValue = ""; }
});

start();
