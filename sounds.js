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
// Sounds.json: sounds[]: { id, about, layers[]: { takes[], volume (0-1), pitchMin, pitchMax } }
// A take is a recording in Assets/Resources/Sfx ("cloth1", "lib/fs123-..."), a sound made in code
// ("~whoosh"), or, until it's saved, a library sound ("kenney:pack/file.ogg", "freesound:123").

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
// Loads a recording once; like the game, each one is evened out by its loudest moment.
function load(take) {
  if (!buffers.has(take)) {
    const p = Store.audioUrl(take)
      .then(url => fetch(url))
      .then(r => { if (!r.ok) throw new Error("missing " + take); return r.arrayBuffer(); })
      .then(data => context().decodeAudioData(data))
      .then(buffer => {
        let peak = 0.05;
        for (let c = 0; c < buffer.numberOfChannels; c++) {
          const d = buffer.getChannelData(c);
          for (let i = 0; i < d.length; i++) { const v = d[i] < 0 ? -d[i] : d[i]; if (v > peak) peak = v; }
        }
        return { buffer, gain: Math.min(3, 0.9 / peak) };
      });
    p.catch(() => buffers.delete(take)); // a failed load can be tried again
    buffers.set(take, p);
  }
  return buffers.get(take);
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
}
function startTake({ buffer, gain }, volume, pitch) {
  const ctx = context();
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.playbackRate.value = pitch;
  const level = ctx.createGain();
  level.gain.value = Math.min(1, volume * gain * MASTER);
  source.connect(level).connect(ctx.destination);
  source.onended = () => live.delete(source);
  live.add(source);
  source.start();
  return buffer.duration / pitch;
}
// Lights up 'el' while a sound lasts.
function glow(el, secs) {
  if (!el) return;
  lit = el;
  el.classList.add("playing");
  el._stop = setTimeout(() => { el.classList.remove("playing"); if (lit === el) lit = null; }, Math.max(250, secs * 1000));
}
// Plays layers together, the way the game does: each one a random take, at a random pitch in its
// range. 'el' shows it's loading, then lights up while it sounds.
async function playLayers(layers, el) {
  const press = ++presses;
  pausePreview();
  const resumed = context().resume(); // inside the tap, so phones allow sound
  const picks = layers.filter(l => l.takes.length).map(l => ({
    take: l.takes[Math.floor(Math.random() * l.takes.length)],
    volume: l.volume,
    pitch: l.pitchMin + Math.random() * Math.max(0, l.pitchMax - l.pitchMin),
  }));
  el?.classList.add("loading");
  const loaded = await Promise.all(picks.map(p => load(p.take).catch(() => null)));
  await resumed.catch(() => {});
  el?.classList.remove("loading");
  if (press !== presses) return; // a newer press came while this one was loading
  stopSounds();
  glow(el, Math.max(0, ...picks.map((p, i) => loaded[i] ? startTake(loaded[i], p.volume, p.pitch) : 0)));
}
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
    const swap = {};
    for (let i = 0; i < fresh.length && !Store.online; i++) {
      renderStatus(`Bringing new sound ${i + 1} of ${fresh.length} into the game…`);
      const entry = await Store.bringIn(fresh[i]);
      swap[fresh[i]] = entry.take;
      state.meta[entry.take] = entry;
    }
    if (Object.keys(swap).length) {
      for (const s of state.plan.sounds)
        for (const l of s.layers) l.takes = l.takes.map(t => swap[t] || t);
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

function renderMixer() {
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
    return `<div class="layer" data-drop="layer" data-layer="${n}">
      <div class="layer-head">
        <button type="button" class="mini-play" data-layer-play="${n}" aria-label="Play only this recording"></button>
        <select class="select" data-field="family" data-layer="${n}" aria-label="Recording">${opts}</select>
      </div>
      <label class="knob">Volume <input type="range" min="0" max="100" step="1" value="${Math.round(layer.volume * 100)}" data-field="volume" data-layer="${n}">
        <output data-out="volume-${n}">${Math.round(layer.volume * 100)}%</output></label>
      <label class="knob">Pitch <input type="range" min="30" max="250" step="1" value="${Math.round(center * 100)}" data-field="pitch" data-layer="${n}">
        <output data-out="pitch-${n}">×${center.toFixed(2)}</output></label>
      <div class="layer-foot"><span>${credit ? `${esc(credit.source || "")}${credit.author ? ", by " + esc(credit.author) : ""}` :
        `${layer.takes.length} take${layer.takes.length === 1 ? "" : "s"}, one picked at random`}</span>
        <button type="button" class="remove" data-remove="${n}">Remove</button></div>
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
    <h3>Made of ${sound.layers.length} layer${sound.layers.length === 1 ? "" : "s"}, played together</h3>
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
    else if (layer != null && s.layers[layer]) s.layers[layer].takes = [...item.takes];
    else s.layers = [fresh];
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
    playLayers([layer], layerPlay);
    return;
  }
  const remove = t.closest("[data-remove]");
  if (remove) return change(() => soundById(state.selected).layers.splice(+remove.dataset.remove, 1));

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
  }
  if (commit) {
    commitPending();
    state.pending = snapshot();
    if (field === "family") { renderMixer(); playLayers([layer]); }
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
