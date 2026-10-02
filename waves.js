"use strict";
// The Waves page. Loads Assets/StreamingAssets/Waves.json through server.py, lets you edit every
// wave, and saves it back. The game reads the file again at the start of every wave.
//
// The plan (what gets saved):
//   waves[]: { wave, seconds, tag ("", "HORDE", "ELITE", "FINAL"), note,
//              enemies[]: { type, count, packSize (1 = one by one), armor (% for helmet and shield) | plates (worms) },
//              elites[]:  { type ("Giant", "Worm", "Archer"), atSecond, reward } }

const TAGS = [["", "None"], ["HORDE", "Horde"], ["ELITE", "Elite"], ["FINAL", "Final"]];
const TAG_WORD = { HORDE: "Horde", ELITE: "Elite", FINAL: "Final" };
const LIMITS = {
  seconds: [5, 600], count: [0, 999], packSize: [2, 30], armor: [0, 100], plates: [0, 10],
  atSecond: [0, 600], reward: [0, 9999],
};
const STEP = { seconds: 5, armor: 5, reward: 10 };
const BAR_PX = 165; // tallest column in the overview

const ICON_ONE = `<svg viewBox="0 0 30 22" aria-hidden="true"><path d="M3 3l4 4M7 3l-4 4M21 2l4 4M25 2l-4 4M12 14l4 4M16 14l-4 4"/></svg>`;
const ICON_PACK = `<svg viewBox="0 0 30 22" aria-hidden="true"><path d="M8 7l4 4M12 7l-4 4M15 5l4 4M19 5l-4 4M13 12l4 4M17 12l-4 4M18 10l4 4M22 10l-4 4"/></svg>`;

const state = {
  plan: null, info: null, file: "",
  selected: 0,
  saved: "",        // the plan as last saved, to know if there are unsaved changes
  undo: [], redo: [],
  pending: null,    // the plan before the field being typed in was touched
  deleteArmed: false,
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));
const money = n => "₪" + n.toLocaleString("en-US");
const snapshot = () => JSON.stringify(state.plan);
const current = () => state.plan.waves[state.selected];

// ---------- what the editor knows about each enemy (enemies.json) ----------

function enemyInfo(type) {
  return state.info.enemies.find(e => e.type === type)
    || { type, name: type, plural: type + "s", reward: 0, lives: 1, color: "#8A7F72", does: "" };
}
const eliteInfo = type => state.info.elites.find(e => e.type === type) || { type, lives: "?", does: "" };
const eliteTypes = () => state.info.elites.map(e => e.type);
const stackOrder = () => state.info.enemies.map(e => e.type); // bottom to top in the overview
const noun = (type, n) => n === 1 ? enemyInfo(type).name : enemyInfo(type).plural;

function countOf(w, type) {
  return w.enemies.filter(e => e.type === type).reduce((s, e) => s + (e.count || 0), 0);
}
const totalEnemies = w => w.enemies.reduce((s, e) => s + (e.count || 0), 0);
function waveMoney(w) {
  return w.enemies.reduce((s, e) => s + (e.count || 0) * enemyInfo(e.type).reward, 0)
    + w.elites.reduce((s, e) => s + (e.reward || 0), 0);
}

// ---------- loading and saving ----------

async function load() {
  try {
    const [body, info] = await Promise.all([
      Store.load("waves"),
      fetch("enemies.json").then(r => r.json()),
    ]);
    state.file = body.file;
    state.info = info;
    state.plan = body.plan;
    tidy();
    state.saved = snapshot();
    state.undo = [];
    state.redo = [];
    showProblem(null);
    render();
  } catch (err) {
    const offline = err instanceof TypeError;
    showProblem(offline
      ? (Store.online ? "Can't reach GitHub. Check the internet connection and reload."
                      : "Can't reach the pages' server. In Unity, open the TestDrive menu and choose “Open Waves page”.")
      : err.message);
  }
}

let forceNextSave = false; // set after a clash with another device, so the next Save overwrites it

async function save() {
  commitPending();
  if (!state.plan || snapshot() === state.saved) return;
  try {
    const r = await Store.save("waves", state.plan, { force: forceNextSave });
    forceNextSave = false;
    state.saved = snapshot();
    showProblem(null);
    renderStatus(`Saved at ${r.saved}. ${r.note}`);
  } catch (err) {
    if (err instanceof Store.Conflict) {
      forceNextSave = true;
      showProblem("These waves were saved from another device since you opened this page. Reload to see that version " +
        "(your unsaved changes here will be lost), or press Save again to replace it with yours.");
      return;
    }
    showProblem(err instanceof TypeError
      ? "Saving failed: can't reach " + (Store.online ? "GitHub. Check the internet connection." : "the pages' server. In Unity choose TestDrive > Open Waves page, then save.")
      : "Saving failed: " + err.message);
  }
}

function showProblem(text) {
  const p = $("problem");
  p.hidden = !text;
  p.textContent = text || "";
}

// Keeps the plan in the shape the game expects: waves numbered in order, worms with plates,
// everyone else with armour.
function tidy() {
  state.plan.waves.forEach((w, i) => {
    w.wave = i + 1;
    w.tag = w.tag || "";
    w.note = w.note || "";
    w.enemies = w.enemies || [];
    w.elites = w.elites || [];
    w.enemies = w.enemies.map(e => {
      const row = { type: e.type, count: e.count || 0, packSize: Math.max(1, e.packSize || 1) };
      if (e.type === "Worm") row.plates = e.plates || 0;
      else row.armor = e.armor || 0;
      return row;
    });
  });
  state.selected = Math.min(state.selected, state.plan.waves.length - 1);
}

// ---------- undo ----------

function pushUndo(before) {
  state.undo.push(before);
  if (state.undo.length > 300) state.undo.shift();
  state.redo = [];
}

// A button press or other one-step change.
function change(mutate) {
  commitPending();
  const before = snapshot();
  mutate();
  tidy();
  if (snapshot() !== before) pushUndo(before);
  render();
}

// Typing in a field changes the plan live; it becomes one undo step when you leave the field.
function commitPending() {
  if (state.pending && state.pending !== snapshot()) pushUndo(state.pending);
  state.pending = null;
}

function undo() {
  commitPending();
  if (!state.undo.length) return;
  state.redo.push(snapshot());
  state.plan = JSON.parse(state.undo.pop());
  tidy();
  render();
}

function redo() {
  if (!state.redo.length) return;
  state.undo.push(snapshot());
  state.plan = JSON.parse(state.redo.pop());
  tidy();
  render();
}

// ---------- drawing ----------

function render() {
  renderSkyline();
  renderWave();
  renderWords();
  renderStatus();
}

// Everything except the wave form itself (so a field you're typing in keeps its focus).
function renderLive() {
  renderSkyline();
  renderWords();
  renderStatus();
}

function renderStatus(message) {
  const dirty = snapshot() !== state.saved;
  $("save").disabled = !dirty;
  $("undo").disabled = !state.undo.length && !(state.pending && state.pending !== snapshot());
  $("redo").disabled = !state.redo.length;
  const status = $("save-status");
  status.classList.toggle("unsaved", dirty);
  if (message) status.textContent = message;
  else if (dirty) status.textContent = "Unsaved changes";
  else if (!status.textContent || status.textContent === "Unsaved changes") status.textContent = "Everything is saved";
  $("file-path").textContent = state.file;
}

function renderSkyline() {
  const waves = state.plan.waves;
  const max = Math.max(1, ...waves.map(totalEnemies));
  const cols = waves.map((w, i) => {
    const segs = stackOrder().map(type => {
      const n = countOf(w, type);
      if (!n) return "";
      const h = Math.max(3, Math.round(n / max * BAR_PX));
      return `<span class="seg" style="height:${h}px;background:${enemyInfo(type).color}"></span>`;
    }).join("");
    const stars = w.elites.length ? `<span class="mark elite" aria-hidden="true">${"★".repeat(w.elites.length)}</span>` : "";
    const tag = w.tag ? `<span class="mark">${TAG_WORD[w.tag] || esc(w.tag)}</span>` : "";
    const selected = i === state.selected;
    return `<button type="button" class="col" role="option" aria-selected="${selected}" data-act="pick" data-wave="${i}" data-k="col-${i}"
        aria-label="Wave ${i + 1}, ${w.seconds} seconds, ${totalEnemies(w)} enemies${w.elites.length ? `, ${w.elites.length} elite` : ""}">
      <span class="bar-area">${tag}${stars}<span class="stack">${segs}</span></span>
      <span class="col-label"><span class="col-num">${i + 1}</span><span class="col-secs">${w.seconds}s</span></span>
    </button>`;
  }).join("");
  const add = `<button type="button" class="col add" data-act="add-wave" data-k="col-add" title="Add a wave at the end">
      <span class="bar-area" aria-hidden="true">+</span>
      <span class="col-label"><span class="col-secs">Add wave</span></span>
    </button>`;
  const focused = document.activeElement?.dataset?.k;
  $("skyline").innerHTML = cols + add;
  if (focused?.startsWith("col-")) document.querySelector(`[data-k="${focused}"]`)?.focus();

  $("legend").innerHTML = [...state.info.enemies].reverse().map(e =>
    `<li><span class="swatch" style="background:${e.color}"></span>${esc(cap(e.plural))}</li>`).join("")
    + `<li><span class="swatch star" aria-hidden="true">★</span>Elite</li>`
    + `<li>Column height = number of enemies</li>`;
}

function renderWave() {
  const w = current();
  const i = state.selected;
  const focused = document.activeElement?.dataset?.k;
  state.deleteArmed = false;

  const rows = w.enemies.map((e, r) => enemyRow(e, r)).join("");
  const missing = stackOrder().filter(t => !w.enemies.some(e => e.type === t));
  const adders = missing.length
    ? `<div class="adders">${[...missing].reverse().map(t =>
        `<button type="button" class="adder" data-act="add-row" data-type="${t}" data-k="add-${t}" style="--piece:${enemyInfo(t).color}">
          ${token(t)}Add ${esc(enemyInfo(t).plural)}</button>`).join("")}</div>`
    : "";

  const elites = w.elites.map((e, n) => eliteRow(e, n)).join("");

  $("wave").innerHTML = `
    <div class="wave-head">
      <h2 class="wave-title">Wave ${i + 1}</h2>
      <div class="nav">
        <button type="button" data-act="prev" data-k="prev" aria-label="Previous wave" ${i === 0 ? "disabled" : ""}>‹</button>
        <button type="button" data-act="next" data-k="next" aria-label="Next wave" ${i === state.plan.waves.length - 1 ? "disabled" : ""}>›</button>
      </div>
    </div>

    <div class="wave-fields">
      <div class="field">
        <span class="field-label" id="len-label">Length</span>
        <span style="display:flex;align-items:center">
          ${stepper({ k: "seconds", field: "seconds", value: w.seconds, label: "Wave length in seconds", step: STEP.seconds })}
          <span class="unit">seconds</span>
        </span>
      </div>
      <label class="field">
        <span class="field-label">Title in the game</span>
        <select class="select" data-field="tag" data-k="tag">
          ${TAGS.map(([v, t]) => `<option value="${v}" ${w.tag === v ? "selected" : ""}>${t}</option>`).join("")}
        </select>
      </label>
      <label class="field">
        <span class="field-label">Note to yourself</span>
        <input class="text-input" type="text" data-field="note" data-k="note" value="${esc(w.note)}" placeholder="What is this wave about?">
      </label>
    </div>

    <h3 class="section-title">Enemies <small>${totalEnemies(w)} in this wave</small></h3>
    <div class="rows">${rows || `<p class="empty">No enemies in this wave yet. Add some below.</p>`}</div>
    ${adders}

    <h3 class="section-title">Elites <small>a tougher, gold version that pays a lot</small></h3>
    <div class="rows">${elites || `<p class="empty">No elites in this wave.</p>`}</div>
    <div class="adders">
      <button type="button" class="adder gold" data-act="add-elite" data-k="add-elite">★ Add an elite</button>
    </div>

    <div class="wave-tools">
      <button type="button" class="ghost" data-act="duplicate" data-k="duplicate">Copy this wave in after it</button>
      <button type="button" class="ghost danger-btn" data-act="delete" data-k="delete" ${state.plan.waves.length <= 1 ? "disabled" : ""}>Delete wave ${i + 1}</button>
    </div>`;

  if (focused) document.querySelector(`#wave [data-k="${focused}"]`)?.focus();
}

function enemyRow(e, r) {
  const info = enemyInfo(e.type);
  const packs = e.packSize > 1;
  const worm = e.type === "Worm";
  const lives = `${info.lives} ${info.lives === 1 ? "life" : "lives"}`;
  return `<article class="row" style="--piece:${info.color}">
    ${token(e.type)}
    <div class="who">
      <h4 class="who-name">${esc(noun(e.type, e.count))}</h4>
      <p class="who-info">${money(info.reward)} each, ${lives}. ${esc(info.does)}</p>
    </div>
    <div class="count">
      ${stepper({ k: `r${r}-count`, field: "count", row: r, value: e.count, label: `How many ${info.plural}` })}
      <button type="button" class="remove" data-act="remove-row" data-row="${r}" data-k="r${r}-remove">Remove</button>
    </div>
    <div class="how">
      <div class="arrive" role="group" aria-label="How they arrive">
        <button type="button" aria-pressed="${!packs}" data-act="one-by-one" data-row="${r}" data-k="r${r}-one">${ICON_ONE}One by one</button>
        <button type="button" aria-pressed="${packs}" data-act="packs" data-row="${r}" data-k="r${r}-packs">${ICON_PACK}In packs</button>
      </div>
      ${packs ? `<span class="packs">of ${stepper({ k: `r${r}-pack`, field: "packSize", row: r, value: e.packSize, label: "Enemies per pack", small: true })}</span>` : ""}
      ${worm
        ? `<span class="armour">Armour plates each ${stepper({ k: `r${r}-plates`, field: "plates", row: r, value: e.plates, label: "Armour plates per worm", small: true })}</span>`
        : `<label class="armour">Armour
             <input type="range" min="0" max="100" step="${STEP.armor}" value="${e.armor}" data-field="armor" data-row="${r}" data-k="r${r}-armor"
               aria-label="Chance of a helmet and of a shield, in percent">
             <output data-out="r${r}-armor">${e.armor}%</output></label>`}
    </div>
  </article>`;
}

function eliteRow(e, n) {
  const info = eliteInfo(e.type);
  return `<article class="row elite" style="--piece:${enemyInfo(e.type).color}">
    ${token(e.type)}
    <div class="who">
      <label class="field">
        <span class="field-label">Elite</span>
        <select class="select" data-field="type" data-elite="${n}" data-k="e${n}-type">
          ${eliteTypes().map(t => `<option value="${t}" ${e.type === t ? "selected" : ""}>Elite ${esc(enemyInfo(t).name)}</option>`).join("")}
        </select>
      </label>
      <p class="who-info">${info.lives} lives. ${esc(info.does)}</p>
    </div>
    <div class="count">
      <button type="button" class="remove" data-act="remove-elite" data-elite="${n}" data-k="e${n}-remove">Remove</button>
    </div>
    <div class="how">
      <span class="packs">Arrives after ${stepper({ k: `e${n}-at`, field: "atSecond", elite: n, value: e.atSecond, label: "Seconds into the wave", small: true })} s</span>
      <span class="packs">Drops ${stepper({ k: `e${n}-reward`, field: "reward", elite: n, value: e.reward, label: "Money it drops", small: true, step: STEP.reward })} ₪</span>
    </div>
  </article>`;
}

function stepper({ k, field, row, elite, value, label, small, step = 1 }) {
  const where = row != null ? `data-row="${row}"` : elite != null ? `data-elite="${elite}"` : "";
  return `<span class="stepper${small ? " small" : ""}">
    <button type="button" data-act="dec" data-field="${field}" data-step="${step}" ${where} data-k="${k}-dec" aria-label="Less" title="Less (Shift: ×10)">−</button>
    <input type="number" inputmode="numeric" data-field="${field}" ${where} data-k="${k}" value="${value}" aria-label="${esc(label)}">
    <button type="button" data-act="inc" data-field="${field}" data-step="${step}" ${where} data-k="${k}-inc" aria-label="More" title="More (Shift: ×10)">+</button>
  </span>`;
}

function token(type) {
  const info = enemyInfo(type);
  return `<span class="token" style="--piece:${info.color}" data-letter="${esc(info.name[0].toUpperCase())}">` +
    `<img src="images/${encodeURIComponent(type)}.png" alt=""></span>`;
}

// No picture yet: show the enemy's first letter in its colour.
document.addEventListener("error", ev => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.parentElement?.classList.contains("token")) return;
  const letter = document.createElement("span");
  letter.className = "token-letter";
  letter.textContent = img.parentElement.dataset.letter || "?";
  img.replaceWith(letter);
}, true);

// ---------- plain words ----------

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

function listWords(items) {
  if (items.length <= 1) return items.join("");
  return items.slice(0, -1).join(", ") + " and " + items[items.length - 1];
}

function describe(w, i) {
  const out = [];
  const rows = w.enemies.filter(e => e.count > 0);
  const singles = rows.filter(e => e.packSize <= 1);
  const packed = rows.filter(e => e.packSize > 1);

  out.push(`Wave ${i + 1} lasts ${w.seconds} seconds${w.tag ? ` and is called ${TAG_WORD[w.tag] || w.tag.toLowerCase()} in the game` : ""}.`);
  if (!rows.length) out.push("No enemies yet.");
  for (const e of packed) out.push(e.packSize >= e.count
    ? `${e.count} ${noun(e.type, e.count)} arrive${e.count === 1 ? "s" : ""} together, in one pack.`
    : `${e.count} ${noun(e.type, e.count)} arrive in packs of ${e.packSize}, each pack at its own random spot.`);
  if (singles.length) {
    const one = singles.length === 1 && singles[0].count === 1;
    out.push(`${cap(listWords(singles.map(e => `${e.count} ${noun(e.type, e.count)}`)))} ${one ? "arrives" : "arrive"} one by one, each at its own random spot.`);
  }

  const armoured = rows.filter(e => e.type !== "Worm" && e.armor > 0);
  const bare = rows.filter(e => e.type !== "Worm" && !(e.armor > 0));
  const values = [...new Set(armoured.map(e => e.armor))];
  if (armoured.length && values.length === 1 && !bare.length)
    out.push(`Armour: ${values[0]}% of them get a helmet and ${values[0]}% get a shield. Each piece is one more life.`);
  else if (armoured.length)
    out.push(`Armour: ${listWords(armoured.map(e => `${enemyInfo(e.type).plural} ${e.armor}%`))} chance of a helmet and of a shield. Each piece is one more life.`);
  for (const e of rows.filter(e => e.type === "Worm" && e.plates > 0))
    out.push(`Worms carry ${e.plates} armour plate${e.plates === 1 ? "" : "s"} each.`);

  for (const e of w.elites) {
    const when = e.atSecond > 0 ? `after ${e.atSecond} s` : "right at the start";
    out.push(`An elite ${enemyInfo(e.type).name} (${eliteInfo(e.type).lives} lives) arrives ${when} and drops ${money(e.reward)}.`);
  }
  return out;
}

function renderWords() {
  const w = current();
  const i = state.selected;
  let upToHere = 0;
  for (let n = 0; n <= i; n++) upToHere += waveMoney(state.plan.waves[n]);
  const perSecond = totalEnemies(w) / w.seconds;

  $("words").innerHTML = `
    <h2>In plain words</h2>
    ${describe(w, i).map(s => `<p>${esc(s)}</p>`).join("")}
    ${w.note ? `<p class="note">“${esc(w.note)}”</p>` : ""}
    <dl class="facts">
      <dt>Enemies</dt><dd>${totalEnemies(w) + w.elites.length}</dd>
      <dt>Enemies per second</dt><dd>${perSecond.toFixed(1)}</dd>
      <dt>Money if you kill them all</dt><dd>${money(waveMoney(w))}</dd>
      <dt>All money up to this wave</dt><dd>${money(upToHere)}</dd>
    </dl>
    <p class="hint">Saved changes reach the game at the start of the next wave, even in the middle of a game.
      <kbd>←</kbd> <kbd>→</kbd> switch waves, <kbd>Ctrl</kbd>+<kbd>S</kbd> saves.</p>`;
}

function planAsText() {
  const lines = [`Wave plan: ${state.plan.waves.length} waves. Change anything in words and give it to Claude.`, ""];
  state.plan.waves.forEach((w, i) => {
    const head = `Wave ${i + 1}, ${w.seconds} s${w.tag ? ", " + w.tag : ""}`;
    const rows = w.enemies.filter(e => e.count > 0);
    const parts = [];
    const packed = rows.filter(e => e.packSize > 1).map(e => `${e.count} ${noun(e.type, e.count)} ${e.packSize >= e.count ? "in one pack" : "in packs of " + e.packSize}`);
    const singles = rows.filter(e => e.packSize <= 1).map(e => `${e.count} ${noun(e.type, e.count)}`);
    if (packed.length) parts.push(packed.join("; "));
    if (singles.length) parts.push(listWords(singles) + " one by one");
    let text = `${head}: ${parts.join("; ") || "no enemies"}.`;
    const armour = [...new Set(rows.filter(e => e.type !== "Worm" && e.armor > 0).map(e => e.armor))];
    if (armour.length === 1) text += ` Armour ${armour[0]}%.`;
    else if (armour.length) text += " Armour " + rows.filter(e => e.type !== "Worm" && e.armor > 0).map(e => `${enemyInfo(e.type).plural} ${e.armor}%`).join(", ") + ".";
    for (const e of rows.filter(e => e.type === "Worm" && e.plates > 0)) text += ` Worms ${e.plates} plate${e.plates === 1 ? "" : "s"}.`;
    for (const e of w.elites) text += ` Elite ${enemyInfo(e.type).name} at ${e.atSecond} s, drops ${money(e.reward)}.`;
    if (w.note) text += ` (${w.note})`;
    lines.push(text);
  });
  return lines.join("\n");
}

// ---------- reacting to clicks and typing ----------

function targetOf(el) {
  const w = current();
  if (el.dataset.row != null) return w.enemies[+el.dataset.row];
  if (el.dataset.elite != null) return w.elites[+el.dataset.elite];
  return w;
}

function select(i) {
  commitPending();
  state.selected = clamp(i, [0, state.plan.waves.length - 1]);
  render();
}

function onAction(btn, ev) {
  const act = btn.dataset.act;
  const w = current();
  switch (act) {
    case "pick": return select(+btn.dataset.wave);
    case "prev": return select(state.selected - 1);
    case "next": return select(state.selected + 1);
    case "inc":
    case "dec": {
      const field = btn.dataset.field;
      const step = (+btn.dataset.step || 1) * (ev.shiftKey ? 10 : 1) * (act === "inc" ? 1 : -1);
      return change(() => {
        const obj = targetOf(btn);
        obj[field] = clamp((obj[field] || 0) + step, LIMITS[field]);
      });
    }
    case "one-by-one": return change(() => { w.enemies[+btn.dataset.row].packSize = 1; });
    case "packs": return change(() => {
      const row = w.enemies[+btn.dataset.row];
      if (row.packSize <= 1) row.packSize = 4;
    });
    case "remove-row": return change(() => { w.enemies.splice(+btn.dataset.row, 1); });
    case "add-row": return change(() => {
      const type = btn.dataset.type;
      const row = { type, count: 1, packSize: 1 };
      if (type === "Worm") row.plates = 0; else row.armor = Math.max(0, ...w.enemies.map(e => e.armor || 0));
      w.enemies.push(row);
    });
    case "add-elite": return change(() => {
      const used = w.elites.map(e => e.type);
      const type = eliteTypes().find(t => !used.includes(t)) || eliteTypes()[0];
      w.elites.push({ type, atSecond: 5, reward: 150 });
    });
    case "remove-elite": return change(() => { w.elites.splice(+btn.dataset.elite, 1); });
    case "add-wave": return change(() => {
      const copy = JSON.parse(JSON.stringify(state.plan.waves[state.plan.waves.length - 1]));
      if (copy.tag === "FINAL") copy.tag = "";
      state.plan.waves.push(copy);
      state.selected = state.plan.waves.length - 1;
    });
    case "duplicate": return change(() => {
      const copy = JSON.parse(JSON.stringify(w));
      if (copy.tag === "FINAL") copy.tag = "";
      state.plan.waves.splice(state.selected + 1, 0, copy);
      state.selected += 1;
    });
    case "delete": {
      if (!state.deleteArmed) {
        state.deleteArmed = true;
        btn.classList.add("armed");
        btn.textContent = `Click again to delete wave ${state.selected + 1}`;
        setTimeout(() => {
          if (!state.deleteArmed) return;
          state.deleteArmed = false;
          btn.classList.remove("armed");
          btn.textContent = `Delete wave ${state.selected + 1}`;
        }, 3500);
        return;
      }
      return change(() => {
        state.plan.waves.splice(state.selected, 1);
        state.selected = Math.max(0, state.selected - 1);
      });
    }
  }
}

function onField(el, commit) {
  const field = el.dataset.field;
  const obj = targetOf(el);
  if (!obj) return;
  if (el.type === "number" || el.type === "range") {
    let v = Math.round(Number(el.value));
    if (el.value === "" || !Number.isFinite(v)) {
      if (!commit) return;
      v = obj[field] || 0;
    }
    v = clamp(v, LIMITS[field]);
    obj[field] = v;
    if (commit) el.value = v;
    const out = document.querySelector(`[data-out="${el.dataset.k}"]`);
    if (out) out.textContent = v + "%";
  } else {
    obj[field] = el.value;
  }
  if (commit) {
    commitPending();
    state.pending = snapshot();
  }
  if (commit && field === "type") {
    tidy();
    renderWave(); // new picture and description for the elite
  }
  // The heading over a count says "basic" or "basics".
  if (field === "count") {
    const name = el.closest(".row")?.querySelector(".who-name");
    if (name) name.textContent = noun(obj.type, obj.count);
  }
  renderLive();
}

document.addEventListener("click", ev => {
  const btn = ev.target.closest("[data-act]");
  if (btn && !btn.disabled && state.plan) onAction(btn, ev);
});

document.addEventListener("focusin", ev => {
  if (!ev.target.dataset?.field || !state.plan) return;
  commitPending();
  state.pending = snapshot();
});
document.addEventListener("input", ev => { if (ev.target.dataset?.field && state.plan) onField(ev.target, false); });
document.addEventListener("change", ev => { if (ev.target.dataset?.field && state.plan) onField(ev.target, true); });

document.addEventListener("keydown", ev => {
  if (!state.plan) return;
  const ctrl = ev.ctrlKey || ev.metaKey;
  const t = ev.target;
  const typing = t.matches?.("input[type=text]");
  const inField = t.matches?.("input, select");
  if (ctrl && ev.key.toLowerCase() === "s") { ev.preventDefault(); save(); return; }
  if (ctrl && !typing && ev.key.toLowerCase() === "z") { ev.preventDefault(); ev.shiftKey ? redo() : undo(); return; }
  if (ctrl && !typing && ev.key.toLowerCase() === "y") { ev.preventDefault(); redo(); return; }
  if (!inField && !ctrl && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
    ev.preventDefault();
    select(state.selected + (ev.key === "ArrowRight" ? 1 : -1));
    const k = `col-${state.selected}`;
    if (document.activeElement?.dataset?.k?.startsWith("col-")) document.querySelector(`[data-k="${k}"]`)?.focus();
  }
  if (t.matches?.("input[type=number]") && ev.key === "Enter") t.blur();
});

// Hovering a column shows what's in that wave.
function showTip(col) {
  const tip = $("tooltip");
  const i = +col.dataset.wave;
  if (!col.dataset.wave) { tip.hidden = true; return; }
  const w = state.plan.waves[i];
  const items = stackOrder().slice().reverse().map(type => {
    const n = countOf(w, type);
    if (!n) return "";
    const packs = w.enemies.filter(e => e.type === type && e.packSize > 1).map(e => e.packSize);
    return `<li><span class="swatch" style="background:${enemyInfo(type).color}"></span>${n} ${esc(noun(type, n))}${packs.length ? `, packs of ${packs.join("/")}` : ""}</li>`;
  }).join("");
  const elites = w.elites.map(e => `<li><span class="swatch star">★</span>Elite ${esc(enemyInfo(e.type).name)} at ${e.atSecond} s</li>`).join("");
  tip.innerHTML = `<strong>Wave ${i + 1}</strong> ${w.seconds} seconds${w.tag ? ", " + TAG_WORD[w.tag] : ""}<ul>${items || "<li>No enemies</li>"}${elites}</ul>`;
  tip.hidden = false;
  const wrap = col.closest(".skyline-wrap").getBoundingClientRect();
  const r = col.getBoundingClientRect();
  const left = Math.min(Math.max(0, r.left - wrap.left + r.width / 2 - tip.offsetWidth / 2), wrap.width - tip.offsetWidth);
  tip.style.left = left + "px";
  tip.style.top = Math.max(0, r.top - wrap.top + 8) + "px";
}

$("skyline").addEventListener("mouseover", ev => { const c = ev.target.closest(".col"); if (c) showTip(c); });
$("skyline").addEventListener("mouseleave", () => { $("tooltip").hidden = true; });
$("skyline").addEventListener("focusin", ev => { const c = ev.target.closest(".col"); if (c) showTip(c); });
$("skyline").addEventListener("focusout", () => { $("tooltip").hidden = true; });

$("undo").addEventListener("click", undo);
$("redo").addEventListener("click", redo);
$("save").addEventListener("click", save);
$("copy-text").addEventListener("click", async () => {
  if (!state.plan) return;
  const btn = $("copy-text");
  try {
    await navigator.clipboard.writeText(planAsText());
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Couldn't copy";
  }
  setTimeout(() => { btn.textContent = "Copy as text"; }, 1800);
});

window.addEventListener("beforeunload", ev => {
  if (state.plan && snapshot() !== state.saved) { ev.preventDefault(); ev.returnValue = ""; }
});

load();
