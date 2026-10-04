"use strict";
// The Decisions page (החלטות), in Hebrew, right to left: every choice about the game that waits for Tomer, or that he
// made, one card each: the question, why it matters, then two to five options side by side, each with pictures from
// the real game (or a line saying what makes them), a "בחירה" button, and a note box per card.
// The cards are docs/decisions/decisions.json (online: decisions.json in the private repo testdrive-data; sync.py keeps
// the two in step). Claude writes the cards; this page writes only Tomer's fields (a card's chosen, chosenAt, chosenBy
// and notes; an approval row's status, note and at: docs/decisions/README.md), always through Store.update, which
// reads the newest copy and applies the change again when another device saved in between.
// Pictures and clips come from the media site (Store.media), or from this site itself when one says site: "pages".
// The approval card of the characters links each row to the Art page (art.html#<item>) and shows the Art page's own
// Approve / Change for it, read from feedback.json (one place to answer).
// decisions.html#<card id> opens and highlights that card (chat messages and the Art page link to cards that way).
// Tested by docs/claude-tools/pages_decisions_test.js (cdp.mjs, desktop and phone).

const GROUPS = { r16: "דמויות ופגיעות", scenery: "תפאורה", tech: "טכני", upcoming: "בהמשך", closed: "הוחלט" }; // in this order
const STAGES = [ // where a card stands (stageOf), the filters' order; "all" shows every card
  ["waiting", "מחכות לך"], ["chosen", "בחרת"], ["applied", "הוחלו במשחק"], ["upcoming", "בהמשך"], ["closed", "נסגרו"], ["all", "הכול"],
];
const LOOKS = { foundry: "בית יציקה", coldrain: "גשם קר", scrapyard: "מגרש גרוטאות", military: "צבאי", hazard: "מכונות כבדות",
  bunker: "אזעקה אדומה", gothic: "ברזל גותי", toxic: "רעיל", spotlight: "מופע גלדיאטורים", diesel: "דיזלפאנק" }; // as on the Art page
const PICTURES = ["image", "chart", "diagram"]; // media shown as a picture, which opens full size
const ART_ITEM = /^art\.html#(.+)$/;            // an approval row answered on the Art page: its item there
const ZOOM_AT_LEAST = 3;  // the full-size view zooms to at least 3 times the picture's fitted size,
const PIXELS_AT_MOST = 2; // and further when that isn't 2 screen pixels to a picture's pixel (a big picture on a phone)
const ZOOM_STEP = 1.5;    // one press of + or −
const COMPARE_KEY_STEP = 0.05; // the compare line moves 5% of the picture's width per arrow key

const state = {
  data: null,       // decisions.json
  file: "",         // where it was read from
  feedback: null,   // feedback.json's items (the Art page's Approve / Change), or null when it couldn't be read
  stage: "waiting", // the filters
  group: "all",
  keep: new Set(),  // cards changed since the filter was set: they stay in sight even when they no longer match it
  highlight: null,  // the card the address names
  ui: {},           // per card: the look shown, the compare view (open, sides, way, line), the row whose note box is open
  drafts: {},       // the note boxes' words not saved yet: per card (its id), per row (card id + "\n" + row id)
  busy: {},         // per card: a save on its way
  said: {},         // per card: what its last save said { text } or { html, error }
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ltr = text => `<bdi dir="ltr">${esc(text)}</bdi>`;   // a name or a code inside Hebrew text
const cmd = text => `<code dir="ltr">${esc(text)}</code>`; // a menu path or a file, kept on one line
const same = (a, b) => a != null && b != null && String(a) === String(b);
function fromHash() {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return location.hash.slice(1); }
}
const calm = matchMedia("(prefers-reduced-motion: reduce)");
const header = document.querySelector(".top");

// "2026-10-05T14:20:31+03:00" -> "5.10.2026 בשעה 14:20" (the time as written, which is Israel's); "2026-10-02" -> "2.10.2026"
function when(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)(?:T(\d\d):(\d\d))?/.exec(iso || "");
  return !m ? "" : `${+m[3]}.${+m[2]}.${m[1]}` + (m[4] ? ` בשעה ${m[4]}:${m[5]}` : "");
}
const day = iso => { const m = /^\d{4}-(\d\d)-(\d\d)/.exec(iso || ""); return m ? `${+m[2]}.${+m[1]}` : ""; }; // "5.10"
// Now, as this device's local time with its offset ("2026-10-05T14:20:31+03:00"), like the times Claude writes.
function isoNow() {
  const d = new Date(), off = -d.getTimezoneOffset(), two = n => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:` +
    `${two(d.getSeconds())}${off < 0 ? "-" : "+"}${two(off / 60)}:${two(off % 60)}`;
}

// ---------- the cards ----------
const allCards = () => state.data ? state.data.decisions.filter(c => c && typeof c.id === "string") : [];
const findCard = id => allCards().find(c => c.id === id);
const optionsOf = c => Array.isArray(c.options) ? c.options.filter(o => o && o.id != null) : [];
const optionById = (c, id) => optionsOf(c).find(o => same(o.id, id));
const mediaOf = o => Array.isArray(o && o.media) ? o.media.filter(m => m && m.src) : [];
const isPicture = m => PICTURES.includes(m.type || "image");
const rowsOf = c => c.kind === "approval" && Array.isArray(c.items) && c.items.length ? c.items.filter(r => r && r.id != null) : null;
const groupName = g => GROUPS[g] || (/^r(\d+)$/.test(g || "") ? `סבב ${g.slice(1)}` : g ? String(g) : "כללי");
const optionName = o => `${ltr(o.id)} · ${esc(o.label || "")}`;
const uiOf = id => state.ui[id] || (state.ui[id] = { look: null, compare: false, a: null, b: null, flip: false, showB: false, at: 0.5, rowNote: null });

// The Art page's newest Approve / Change for one of its items (feedback.json), or null.
function feedbackFor(subject) {
  let newest = null;
  for (const f of state.feedback || []) if (f && f.subject === subject && (!newest || String(f.at) >= String(newest.at))) newest = f;
  return newest;
}
const artItem = r => (ART_ITEM.exec(r.link || "") || [])[1] || null;
// Whether Tomer has answered a row: on the Art page for a linked row (a change Claude has since made asks again), else here.
function answered(r) {
  const item = artItem(r);
  if (!item) return r.status === "approved" || r.status === "change";
  const f = feedbackFor(item);
  return !!f && (f.verdict === "approve" || (f.verdict === "change" && f.status !== "done"));
}

// Where a card stands: waiting for him, chosen (not in the game yet), applied, upcoming, or closed.
function stageOf(c) {
  if (c.status === "closed" || c.status === "superseded") return "closed";
  if (c.status === "upcoming") return "upcoming";
  if (c.chosen != null) return same(c.applied, c.chosen) ? "applied" : "chosen";
  const rows = rowsOf(c); // an approval card: answered row by row (or with one answer for the whole card, above)
  if (rows) return c.status === "applied" ? "applied" : rows.every(answered) ? "chosen" : "waiting";
  return c.status === "applied" ? "applied" : "waiting";
}
const STAGE_ORDER = Object.fromEntries(STAGES.map(([k], i) => [k, i]));
const priority = c => Number.isFinite(+c.priority) && c.priority !== null ? +c.priority : 9;
// The cards the filters let through (and the ones just changed), the most important first, then in the file's order.
function shownCards() {
  const all = allCards(), place = new Map(all.map((c, i) => [c, i]));
  return all.filter(c => state.keep.has(c.id) || ((state.stage === "all" || stageOf(c) === state.stage) && (state.group === "all" || c.group === state.group)))
    .sort((a, b) => (state.stage === "all" ? STAGE_ORDER[stageOf(a)] - STAGE_ORDER[stageOf(b)] : 0) || priority(a) - priority(b) || place.get(a) - place.get(b));
}

// The live option: what the game has now (applied), or the default taken for now.
const liveOption = c => c.applied != null ? c.applied : c.status === "taken-for-now" ? c.default : null;

function stageWords(c, stage) {
  const rows = rowsOf(c);
  if (stage === "waiting") return c.status === "pending" ? "מחכה לך: העבודה מחכה לבחירה" : "מחכה לך";
  if (stage === "chosen") return rows && c.chosen == null ? "ענית על הכול" : "בחרת · עוד לא במשחק";
  if (stage === "applied") return "הוחל במשחק";
  if (stage === "upcoming") return "בהמשך";
  return c.status === "superseded" ? "הוחלף בהחלטה אחרת" : "הוחלט";
}

// ---------- loading ----------
// What went wrong reading decisions.json, and what to do about it.
function loadProblem(e) {
  if (e instanceof TypeError) return Store.online
    ? `אין חיבור ל-${ltr("GitHub")}. בדוק את החיבור לאינטרנט ורענן את הדף.`
    : `השרת של הדפים במחשב לא עונה. ביוניטי: בתפריט ${ltr("TestDrive > Offline (this PC only) > Open Decisions page")}.`;
  if (/^There's no/.test(e.message || "")) return `באינטרנט עוד אין קובץ החלטות (${cmd("decisions.json")} במאגר ${ltr("testdrive-data")}). ` +
    "הוא נוצר כשהמחשב מסנכרן (כשיוניטי פתוח), ואז רענן את הדף. אם זה נמשך, אולי המפתח של המכשיר הזה לא רואה את המאגר.";
  if (/^GitHub didn't accept/.test(e.message || "")) return `${ltr("GitHub")} לא קיבל את המפתח של המכשיר הזה. רענן את הדף והדבק אותו שוב.`;
  return `אי אפשר לקרוא את קובץ ההחלטות: ${ltr(e.message || String(e))}. רענן את הדף; אם זה חוזר, ספר ל-${ltr("Claude")}.`;
}

async function load() {
  showProblem(null);
  $("file-path").textContent = "טוען…";
  let body;
  try {
    body = await Store.load("decisions");
  } catch (e) {
    return failed(loadProblem(e));
  }
  const plan = body && body.plan;
  if (!plan || typeof plan !== "object" || !Array.isArray(plan.decisions))
    return failed(`קובץ ההחלטות פגום ואי אפשר לקרוא אותו. ספר ל-${ltr("Claude")}, שיתקן אותו (${cmd("docs/decisions/decisions.json")}).`);
  if (plan.format !== 1) return failed(`קובץ ההחלטות כתוב בגרסה ${ltr(String(plan.format))}, שהדף הזה לא מכיר. רענן את הדף: אולי יש לו גרסה חדשה.`);
  state.data = plan;
  state.file = body.file || "";
  try {
    const fb = await Store.load("feedback", { askForKey: false });
    state.feedback = fb && fb.plan && Array.isArray(fb.plan.items) ? fb.plan.items : null;
  } catch {
    state.feedback = null; // the rows linked to the Art page then show no answer, only the link
  }
  $("file-path").innerHTML = (Store.online ? `ההחלטות מהאינטרנט (${ltr("GitHub: testdrive-data")})`
    : `ההחלטות מהמחשב הזה (${ltr(shortPath(state.file))})`) + (plan.updated ? `, עודכנו ב-${when(plan.updated)}` : "");
  $("summary").hidden = false;
  $("copy-text").disabled = false;
  renderAll();
  goToHash(true);
}
const shortPath = file => String(file).replace(/\\/g, "/").replace(/^.*?(?=docs\/decisions\/)/, "");

function failed(html) {
  state.data = null;
  $("summary").hidden = true;
  $("cards").innerHTML = "";
  $("empty").hidden = true;
  $("copy-text").disabled = true;
  $("file-path").textContent = "אין החלטות";
  showProblem(html);
}

function showProblem(html) {
  const p = $("problem");
  p.hidden = !html;
  p.innerHTML = html || "";
}

// ---------- the header line and the filters ----------
function renderAll() {
  renderSummary();
  renderCards();
}

function renderSummary() {
  const all = allCards(), count = {};
  for (const c of all) count[stageOf(c)] = (count[stageOf(c)] || 0) + 1;
  count.all = all.length;
  const waiting = all.filter(c => stageOf(c) === "waiting"), urgent = waiting.filter(c => priority(c) === 1).length;
  $("headline").innerHTML = !waiting.length ? "אין החלטות שמחכות לך"
    : (waiting.length === 1 ? "החלטה אחת מחכה לך" : `${waiting.length} החלטות מחכות לך`) +
      (urgent ? ` <small>${urgent === waiting.length ? (urgent === 1 ? "והיא חשובה" : "וכולן חשובות") : urgent === 1 ? "אחת מהן חשובה" : `${urgent} מהן חשובות`}</small>` : "");
  $("by-stage").innerHTML = `<span class="filter-label" aria-hidden="true">מצב</span>` + STAGES.map(([k, words]) =>
    `<button type="button" class="pill" data-stage="${k}" aria-pressed="${state.stage === k}">${words} <span class="n">${count[k] || 0}</span></button>`).join("");
  const inStage = all.filter(c => state.stage === "all" || stageOf(c) === state.stage);
  const groups = [...new Set([...Object.keys(GROUPS), ...all.map(c => c.group)])] // those with cards here (and the one chosen)
    .filter(g => g === state.group || inStage.some(c => c.group === g));
  $("by-group").innerHTML = `<span class="filter-label" aria-hidden="true">נושא</span>` +
    `<button type="button" class="pill" data-group="all" aria-pressed="${state.group === "all"}">כל הנושאים <span class="n">${inStage.length}</span></button>` +
    groups.map(g => `<button type="button" class="pill" data-group="${esc(g)}" aria-pressed="${state.group === g}">${esc(groupName(g))}` +
      ` <span class="n">${inStage.filter(c => c.group === g).length}</span></button>`).join("");
}

function setFilter(stage, group) {
  state.stage = stage;
  state.group = group;
  state.keep.clear();
  renderAll();
}

function renderCards() {
  const list = shownCards();
  $("cards").innerHTML = list.map(cardHtml).join("");
  const e = $("empty");
  e.hidden = list.length > 0;
  if (!list.length) e.innerHTML = state.stage === "waiting" && state.group === "all"
    ? `אין כרגע החלטות שמחכות לך. כשיהיו חדשות, ${ltr("Claude")} יכתוב לך בצ'אט כמה יש. <button type="button" class="link" data-stage="all">להצגת כל ההחלטות</button>`
    : `אין כאן החלטות. <button type="button" class="link" data-stage="all" data-group="all">להצגת כל ההחלטות</button>`;
}

const cardEl = id => document.querySelector(`.card[data-card="${CSS.escape(id)}"]`);

// Draws one card again in place (after a save, a look, the compare view), keeping the keyboard where it was.
function renderCard(id) {
  const el = cardEl(id), c = findCard(id);
  if (!el) return;
  if (!c) { el.remove(); return; }
  const active = el.contains(document.activeElement) ? document.activeElement : null;
  const key = active && [...active.attributes].filter(a => a.name.startsWith("data-")).map(a => `[${a.name}="${CSS.escape(a.value)}"]`).join("");
  const caret = active && "selectionStart" in active ? [active.selectionStart, active.selectionEnd] : null;
  el.outerHTML = cardHtml(c);
  const again = key && cardEl(id)?.querySelector(key);
  if (again) {
    again.focus({ preventScroll: true });
    if (caret && "setSelectionRange" in again) try { again.setSelectionRange(...caret); } catch { /* not a text field */ }
  }
}

// ---------- one card ----------
function cardHtml(c) {
  const stage = stageOf(c), ui = uiOf(c.id), rows = rowsOf(c), n = allCards().indexOf(c), busy = state.busy[c.id] ? " disabled" : "";
  const kind = c.kind === "approval" ? "אישור" : c.kind === "technical" ? `ההצעה של ${ltr("Claude")}, לידיעה` : "";
  const chips = [ // (no topic chip for the topics "upcoming" and "closed": the stage chip says it)
    priority(c) === 1 && stage === "waiting" ? `<span class="chip chip-urgent">חשוב</span>` : "",
    `<span class="chip chip-stage stage-${stage}">${esc(stageWords(c, stage))}</span>`,
    c.group === "upcoming" || c.group === "closed" ? "" : `<span class="chip">${esc(groupName(c.group))}</span>`,
    kind ? `<span class="chip">${kind}</span>` : "",
  ].join("");
  const looks = looksOf(c), look = looks.includes(ui.look) ? ui.look : looks[0] || null, cmp = compareOf(c, look);
  const tools = [
    looks.length ? `<div class="looks" role="group" aria-label="מראה">
        <span class="tools-label" aria-hidden="true">מראה</span>
        ${looks.map(l => `<button type="button" class="pill" data-look="${esc(l)}" aria-pressed="${l === look}">${esc(LOOKS[l] || l)}</button>`).join("")}
      </div>` : "",
    cmp ? `<button type="button" class="pill compare-toggle" data-compare-toggle aria-expanded="${ui.compare}">
        <span aria-hidden="true">⇆</span> ${ui.compare ? "סגירת ההשוואה" : "השוואה: לפני ואחרי"}</button>` : "",
  ].join("");
  const opts = optionsOf(c), choosing = stage !== "closed", pictured = opts.some(o => mediaOf(o).length);
  const said = state.said[c.id];
  return `<article class="card${state.highlight === c.id ? " highlight" : ""}" data-card="${esc(c.id)}" id="card-${esc(c.id)}" aria-labelledby="title-${n}">
    <header class="card-head">
      <div class="chips">${chips}</div>
      <h2 class="card-title" id="title-${n}">${esc(c.title || c.question || c.id)}</h2>
      ${c.title && c.question ? `<p class="question">${esc(c.question)}</p>` : ""}
      ${c.why ? `<p class="why">${esc(c.why)}</p>` : ""}
    </header>
    ${verdictHtml(c, stage, busy)}
    ${tools ? `<div class="card-tools">${tools}</div>` : ""}
    ${cmp && ui.compare ? compareHtml(c, cmp) : ""}
    ${rows ? rowsHtml(c, rows, busy) : ""}
    ${!opts.length ? `<p class="no-options">${stage === "closed" ? "אין אפשרויות לכרטיס הזה." : `עוד אין אפשרויות לבחור: ${ltr("Claude")} יוסיף אותן, עם תמונות, כשהעיצוב יהיה מוכן. אפשר כבר לכתוב הערה.`}</p>`
      : rows ? wholeHtml(c, opts, choosing, busy)
      : `<div class="options" style="--n: ${opts.length}">${opts.map(o => optionHtml(c, o, look, choosing, pictured, busy)).join("")}</div>`}
    ${noteHtml(c, n, busy)}
    ${relatedHtml(c)}
    <p class="card-said${said && said.error ? " error" : ""}" role="status">${said ? said.html || esc(said.text) : ""}</p>
  </article>`;
}

// "בחרת: B · Label" with when, and whether it's in the game yet; on a closed card, what was decided.
function verdictHtml(c, stage, busy) {
  if (c.chosen == null) return "";
  const o = optionById(c, c.chosen), name = o ? optionName(o) : ltr(c.chosen);
  if (stage === "closed") return `<p class="verdict decided">הוחלט: <b>${name}</b>${c.chosenAt ? ` <span class="when">· ${when(c.chosenAt)}</span>` : ""}` +
    `${c.doNotAskAgain ? ` <span class="when">· לא נשאל שוב</span>` : ""}</p>`;
  return `<div class="verdict">
      <p>בחרת: <b>${name}</b>${c.chosenAt ? ` <span class="when">· ${when(c.chosenAt)}</span>` : ""}
        ${same(c.applied, c.chosen) ? `<span class="in-game">· הוחל במשחק</span>` : `<span class="when">· עוד לא הוחל במשחק: ${ltr("Claude")} יכניס אותו בסשן הבא</span>`}</p>
      <button type="button" class="ghost" data-unchoose${busy}>בטל בחירה</button>
    </div>`;
}

// The looks the card's pictures come in, when an option has pictures of two or more: then one look at a time, chosen
// with buttons above the options, so every option shows the same look side by side.
function looksOf(c) {
  const per = optionsOf(c).map(o => [...new Set(mediaOf(o).filter(m => m.look).map(m => m.look))]);
  return per.some(l => l.length > 1) ? [...new Set(per.flat())] : [];
}
// The media of an option to show: those of the look chosen (and those of no look); all of them when none is of that look.
function shownMedia(o, look) {
  const all = mediaOf(o);
  if (!look) return all;
  const these = all.filter(m => !m.look || m.look === look);
  return these.length ? these : all;
}

// pictured: whether any option of the card has a picture (if none has, an option without one says nothing about it).
function optionHtml(c, o, look, choosing, pictured, busy) {
  const chosen = same(c.chosen, o.id), live = same(liveOption(c), o.id), closed = stageOf(c) === "closed";
  const badges = [
    chosen ? `<span class="badge badge-chosen">${closed ? "ההחלטה" : "בחרת"}</span>` : "",
    live && !closed ? `<span class="badge badge-live">${same(c.applied, o.id) && chosen ? "במשחק" : "נבחר לעכשיו"}</span>` : "",
    o.changesGameplay ? `<span class="badge badge-gameplay" title="האפשרות הזו משנה איך המשחק משחק, לא רק איך הוא נראה">משנה את המשחק</span>` : "",
    same(c.recommended, o.id) ? `<span class="badge badge-tip">ההמלצה של ${ltr("Claude")}</span>` : "",
  ].join("");
  const media = shownMedia(o, look);
  const pictures = media.length ? `<div class="option-media${media.length > 1 ? " several" : ""}">${media.map(m => mediaHtml(c, `${o.id} · ${o.label || ""}`, m)).join("")}</div>`
    : o.needs ? `<p class="soon">תמונה בקרוב: ${esc(o.needs)}</p>` : pictured ? `<p class="soon">אין תמונה לאפשרות הזו.</p>` : `<div class="soon"></div>`;
  // Always six parts, empty or not: side by side, the options share their rows (decisions.css: subgrid), so their
  // pictures and buttons line up even when one option's words are longer.
  return `<section class="option${chosen ? " is-chosen" : ""}${live ? " is-live" : ""}" data-option="${esc(o.id)}" aria-label="אפשרות ${esc(o.id)}: ${esc(o.label || "")}">
      <div class="option-head">
        <span class="letter" dir="ltr">${esc(o.id)}</span>
        <h3 class="option-label">${esc(o.label || "")}</h3>
      </div>
      <div class="badges">${badges}</div>
      ${o.description ? `<p class="option-text">${esc(o.description)}</p>` : `<div class="option-text"></div>`}
      ${pictures}
      ${media.length && o.needs ? `<p class="needs">עוד לא בנוי: ${esc(o.needs)}</p>` : `<div class="needs"></div>`}
      ${choosing ? `<button type="button" class="choose${chosen ? " chosen" : ""}" data-choose="${esc(o.id)}" aria-pressed="${chosen}"${busy}>` +
        `${chosen ? "✓ בחרת" : "בחירה"}</button>` : `<div class="choose-none"></div>`}
    </section>`;
}

// Where a picture or clip of a card is: on the media site (Store.media), or on this site (site: "pages").
const mediaUrl = (m, key = "src") => !m[key] ? "" : m.site === "pages"
  ? m[key] + (m.v ? "?v=" + encodeURIComponent(m.v) : "") : Store.media(m[key], m.v);

// One picture (opens full size), clip, sound or page link; whose: the option or row it shows, for the full-size title.
function mediaHtml(c, whose, m) {
  const src = mediaUrl(m), cap = m.caption || "", type = m.type || "image";
  const concept = m.concept ? `<span class="tag tag-concept" title="ציור שמראה את הרעיון, לא תמונה מהמשחק">קונספט</span>` : "";
  const ratio = m.w && m.h ? ` style="--ratio: ${+m.w} / ${+m.h}"` : "";
  const caption = cap ? `<figcaption>${esc(cap)}</figcaption>` : "";
  if (type === "page-link") return `<a class="page-link" href="${esc(m.src)}">${esc(cap || "פתיחה")} <span aria-hidden="true">←</span></a>`;
  if (type === "video") return `<figure class="pic"><div class="pic-frame"${ratio}>
      <video controls playsinline preload="none" src="${esc(src)}"${m.poster ? ` poster="${esc(mediaUrl(m, "poster"))}"` : ""}></video>${concept}</div>${caption}</figure>`;
  if (type === "audio") return `<figure class="pic sound"><audio controls preload="none" src="${esc(src)}"></audio>${caption}</figure>`;
  const title = [c.title, whose, cap].filter(Boolean).join(" · ");
  return `<figure class="pic"><button type="button" class="pic-frame" data-zoom="${esc(src)}" data-title="${esc(title)}"
        aria-label="פתיחה בגודל מלא${cap ? ": " + esc(cap) : ""}"${ratio}>
        <img src="${esc(src)}" alt="${esc(cap)}" loading="lazy"${m.w && m.h ? ` width="${+m.w}" height="${+m.h}"` : ""}>${concept}
        <span class="enlarge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 4h6v2H7.4l3.3 3.3-1.4 1.4L6 7.4V10H4zm16 0v6h-2V7.4l-3.3 3.3-1.4-1.4L16.6 6H14V4zM4 20v-6h2v2.6l3.3-3.3 1.4 1.4L7.4 18H10v2zm16 0h-6v-2h2.6l-3.3-3.3 1.4-1.4 3.3 3.3V14h2z"/></svg></span>
      </button>${caption}</figure>`;
}

// ---------- the compare view: two options' pictures of the same look and camera, one over the other ----------
// The options that have a picture of the look shown (with no look buttons: of the first option's first picture's look)
// and of the same camera; null when fewer than two have one.
function compareOf(c, look) {
  const pics = optionsOf(c).map(o => [o, mediaOf(o).filter(isPicture)]);
  const first = pics.map(([, ms]) => look ? ms.find(m => m.look === look) : ms[0]).find(Boolean);
  if (!first) return null;
  const sides = pics.map(([o, ms]) => [o, ms.find(m => m.look === first.look && m.camera === first.camera)]).filter(([, m]) => m);
  return sides.length >= 2 ? sides : null;
}

function compareHtml(c, sides) {
  const ui = uiOf(c.id), ids = sides.map(([o]) => String(o.id));
  if (!ids.includes(String(ui.a))) ui.a = ids[0];
  if (!ids.includes(String(ui.b)) || same(ui.b, ui.a)) ui.b = ids.find(i => i !== String(ui.a));
  const [oa, ma] = sides.find(([o]) => same(o.id, ui.a)), [ob, mb] = sides.find(([o]) => same(o.id, ui.b));
  const pick = (which, chosen) => `<select class="select compare-pick" data-compare-side="${which}" aria-label="${which === "a" ? "האפשרות מימין" : "האפשרות משמאל"}">
      ${sides.map(([o]) => `<option value="${esc(o.id)}"${same(o.id, chosen) ? " selected" : ""}>${esc(o.id)} · ${esc(o.label || "")}</option>`).join("")}</select>`;
  const at = Math.round(ui.at * 1000) / 10;
  return `<div class="compare">
      <div class="compare-bar">
        <div class="compare-sides">${sides.length > 2
          ? `<label>מימין ${pick("a", ui.a)}</label><label>משמאל ${pick("b", ui.b)}</label>`
          : `<span>מימין: <b>${optionName(oa)}</b></span><span>משמאל: <b>${optionName(ob)}</b></span>`}</div>
        <div class="compare-ways" role="group" aria-label="איך להשוות">
          <button type="button" class="pill" data-compare-way="slide" aria-pressed="${!ui.flip}">קו הזזה</button>
          <button type="button" class="pill" data-compare-way="flip" aria-pressed="${ui.flip}">החלפה בהקשה</button>
        </div>
      </div>
      <div class="compare-stage${ui.flip ? " flip" : ""}${ui.flip && ui.showB ? " show-b" : ""}" data-compare-stage
        style="--at: ${at}%; --w: ${+ma.w || 16}; --h: ${+ma.h || 9}"
        ${ui.flip ? `role="button" tabindex="0" aria-label="החלפה בין ${esc(oa.id)} ל-${esc(ob.id)}"` : ""}>
        <img class="compare-a" src="${esc(mediaUrl(ma))}" alt="${esc(`${oa.id} · ${oa.label || ""}`)}" draggable="false">
        <img class="compare-b" src="${esc(mediaUrl(mb))}" alt="${esc(`${ob.id} · ${ob.label || ""}`)}" draggable="false">
        ${ui.flip ? "" : `<span class="compare-line" role="slider" tabindex="0" aria-label="הקו בין התמונות" aria-valuemin="0" aria-valuemax="100"
          aria-valuenow="${Math.round(at)}"><span class="knob" aria-hidden="true">⇆</span></span>`}
        <span class="compare-tag tag-a"><bdi dir="ltr">${esc(oa.id)}</bdi> · ${esc(oa.label || "")}</span>
        <span class="compare-tag tag-b"><bdi dir="ltr">${esc(ob.id)}</bdi> · ${esc(ob.label || "")}</span>
      </div>
      <p class="compare-hint">${ui.flip ? "הקשה על התמונה מחליפה בין שתי האפשרויות, באותו מקום בדיוק."
        : `גרור את הקו: מימין לקו ${optionName(oa)}, משמאל לו ${optionName(ob)}.`}${ma.caption ? ` <span class="when">${esc(ma.caption)}</span>` : ""}</p>
    </div>`;
}

// ---------- approval cards: a row per item ----------
// A row linked to the Art page is answered there: here a small picture, its answer, and the link. Any other row is
// answered here: its words, all its pictures, "מאשר" or "לשנות…" with a note.
function rowsHtml(c, rows, busy) {
  const done = rows.filter(answered).length, linked = rows.filter(artItem), own = rows.filter(r => !artItem(r));
  return `<div class="rows">
      <p class="rows-head">ענית על <b>${done}</b> מתוך ${rows.length}${linked.length
        ? `. את ${own.length ? "הפריטים עם החץ" : "הפריטים כאן"} מאשרים או מבקשים לשנות <a href="art.html">בגלריה</a>: לחיצה על פריט פותחת אותו שם.` : "."}${
        linked.length && state.feedback == null ? " (אי אפשר היה לקרוא את התשובות מהגלריה, אז הן לא מוצגות כאן.)" : ""}</p>
      ${linked.length ? `<ul class="row-list compact">${linked.map(linkedRowHtml).join("")}</ul>` : ""}
      ${own.length ? `<ul class="row-list full">${own.map(r => rowHtml(c, r, busy)).join("")}</ul>` : ""}
    </div>`;
}

function linkedRowHtml(r) {
  const item = artItem(r), pic = mediaOf(r).find(isPicture), f = feedbackFor(item);
  const words = state.feedback == null ? "" : !f ? "עוד לא סימנת"
    : f.verdict === "approve" ? `אישרת${f.at ? ` · ${day(f.at)}` : ""}`
    : f.status === "done" ? "שונה: לאשר שוב"
    : f.status === "declined" ? `ביקשת שינוי, ו-${ltr("Claude")} ענה${f.answer ? `: ${esc(f.answer)}` : ""}`
    : f.status === "doing" ? `ביקשת שינוי: ${ltr("Claude")} עובד על זה`
    : `ביקשת שינוי${f.note ? `: <q dir="auto">${esc(f.note)}</q>` : ""}`;
  const tone = !f ? "" : f.verdict === "approve" ? " ok" : f.status === "done" ? "" : " change";
  return `<li class="row${answered(r) ? " answered" : ""}" data-row="${esc(r.id)}">
      <a class="row-main" href="${esc(r.link)}">
        <span class="row-thumb">${pic ? `<img src="${esc(mediaUrl(pic))}" alt="" loading="lazy">` : ""}</span>
        <span class="row-label">${esc(r.label || r.id)}</span>
        <span class="row-state${tone}">${words}</span><span class="row-go" aria-hidden="true">←</span>
      </a>
    </li>`;
}

function rowHtml(c, r, busy) {
  const ui = uiOf(c.id), key = c.id + "\n" + r.id, open = same(ui.rowNote, r.id), draft = state.drafts[key], media = mediaOf(r);
  const words = r.status === "approved" ? `אישרת${r.at ? ` · ${day(r.at)}` : ""}`
    : r.status === "change" ? `ביקשת שינוי${r.at ? ` · ${day(r.at)}` : ""}` : "עוד לא סימנת";
  return `<li class="row full${answered(r) ? " answered" : ""}" data-row="${esc(r.id)}">
      <p class="row-text">${esc(r.label || r.id)}</p>
      ${media.length ? `<div class="row-media">${media.map(m => mediaHtml(c, r.label || r.id, m)).join("")}</div>` : ""}
      ${r.note && !open ? `<p class="row-note"><span class="when">ההערה שלך:</span> <span dir="auto">${esc(r.note)}</span></p>` : ""}
      <div class="row-foot">
        <span class="row-state${r.status === "approved" ? " ok" : r.status === "change" ? " change" : ""}">${words}</span>
        <div class="row-actions">
          <button type="button" class="pill" data-verdict="approved" aria-pressed="${r.status === "approved"}"${busy}>מאשר</button>
          <button type="button" class="pill" data-verdict="change" aria-pressed="${r.status === "change"}" aria-expanded="${open}"${busy}>לשנות…</button>
          ${r.status ? `<button type="button" class="link" data-verdict="clear"${busy}>ביטול הסימון</button>` : ""}
        </div>
      </div>
      ${open ? `<div class="row-box">
          <textarea class="text-input note-input" dir="auto" rows="2" data-row-note aria-label="מה לשנות"
            placeholder="מה לשנות? אפשר בעברית או באנגלית.">${esc(draft !== undefined ? draft : r.note || "")}</textarea>
          <div class="row-box-buttons"><button type="button" class="save small" data-row-save${busy}>שמירה</button>
            <button type="button" class="link" data-row-cancel>ביטול</button></div>
        </div>` : ""}
    </li>`;
}

// An approval card's own options: what each answer means, and one answer for the whole card at once (instead of row by row).
function wholeHtml(c, opts, choosing, busy) {
  return `<div class="whole">
      <dl class="answers">${opts.map(o => `<div><dt><bdi dir="ltr">${esc(o.id)}</bdi> · ${esc(o.label || "")}</dt><dd>${esc(o.description || "")}${
        o.changesGameplay ? ` <span class="badge badge-gameplay">משנה את המשחק</span>` : ""}${o.needs ? ` <span class="when">(עוד לא בנוי: ${esc(o.needs)})</span>` : ""}</dd></div>`).join("")}</dl>
      ${choosing ? `<div class="whole-pick" role="group" aria-label="תשובה אחת לכל הכרטיס">
          <span class="tools-label">תשובה אחת לכל הכרטיס:</span>
          ${opts.map(o => `<button type="button" class="pill${same(c.chosen, o.id) ? " chosen" : ""}" data-choose="${esc(o.id)}" aria-pressed="${same(c.chosen, o.id)}"${busy}>` +
            `${same(c.chosen, o.id) ? "✓ " : ""}${esc(o.label || o.id)}</button>`).join("")}
        </div>` : ""}
    </div>`;
}

function noteHtml(c, n, busy) {
  const saved = typeof c.notes === "string" ? c.notes : "", draft = state.drafts[c.id], text = draft !== undefined ? draft : saved;
  return `<div class="note">
      <label class="note-label" for="note-${n}">הערה</label>
      <textarea class="text-input note-input" id="note-${n}" dir="auto" rows="2" data-note
        placeholder="מה דעתך? אפשר לכתוב בעברית או באנגלית.">${esc(text)}</textarea>
      <button type="button" class="ghost note-save" data-save-note${busy || text === saved ? " disabled" : ""}>שמירת ההערה</button>
    </div>`;
}

function relatedHtml(c) {
  const list = (Array.isArray(c.related) ? c.related : []).map(findCard).filter(Boolean);
  return list.length ? `<p class="related">קשור ל: ${list.map(r => `<a href="#${esc(r.id)}">${esc(r.title || r.id)}</a>`).join(" · ")}</p>` : "";
}

// ---------- saving Tomer's fields ----------
// What went wrong saving, in Hebrew, with what to do; a button reads the file again when that's the way out.
function saveProblem(e) {
  const reload = ` <button type="button" class="link" data-reload>לקרוא מחדש</button>`;
  if (e instanceof Store.Conflict) return "מישהו אחר שמר בדיוק באותו רגע (מכשיר אחר או המחשב), והשמירה לא הצליחה גם אחרי כמה ניסיונות. " +
    "רענן את הדף ונסה שוב." + reload;
  if (e instanceof TypeError) return Store.online ? "אין חיבור לאינטרנט, אז זה לא נשמר. בדוק את החיבור ונסה שוב."
    : `השרת של הדפים במחשב לא עונה, אז זה לא נשמר. ביוניטי: ${ltr("TestDrive > Offline (this PC only) > Open Decisions page")}, ונסה שוב.`;
  if (/^GitHub didn't accept/.test(e.message || "")) return `${ltr("GitHub")} לא קיבל את המפתח של המכשיר הזה, אז זה לא נשמר. רענן את הדף והדבק אותו שוב.`;
  return `זה לא נשמר: ${ltr(e.message || String(e))}. נסה שוב; אם זה חוזר, ספר ל-${ltr("Claude")}.`;
}

// Changes one card's Tomer fields in the file: change(card) sets them from its own inputs (Store.update may run it twice)
// and returns false when what it changes is gone. Then draws the card again, with "נשמר" or what went wrong.
async function save(id, change, message, done) {
  if (state.busy[id]) return false;
  state.busy[id] = true;
  state.said[id] = { text: "שומר…" };
  state.keep.add(id);
  renderCard(id);
  const before = state.data;
  let gone = null, ok = false;
  try {
    const { data } = await Store.update("decisions", d => {
      const c = Array.isArray(d.decisions) ? d.decisions.find(x => x && x.id === id) : null;
      gone = !c ? "card" : change(c) === false ? "part" : null;
      if (gone) return false;
    }, { message: `Decisions page: ${id}: ${message}` });
    if (data && Array.isArray(data.decisions)) state.data = data; // the newest copy, with this change in it
    ok = !gone;
    state.said[id] = gone === "card" ? { error: true, html: `ההחלטה הזו כבר לא בקובץ (${ltr("Claude")} הסיר אותה), אז זה לא נשמר. רענן את הדף.` }
      : gone ? { error: true, text: "הפריט הזה כבר לא בקובץ, אז זה לא נשמר. רענן את הדף." }
      : { text: `${done}. נשמר ב-${new Date().toLocaleTimeString("en-GB").slice(0, 5)}.` };
  } catch (e) {
    state.said[id] = { error: true, html: saveProblem(e) };
  }
  state.busy[id] = false;
  refresh(before, id);
  return ok;
}

// After a save brought in the newest file: the header line, then every card that changed (another device's choices too).
function refresh(before, id) {
  renderSummary();
  const old = new Map((before && Array.isArray(before.decisions) ? before.decisions : []).map(c => [c && c.id, JSON.stringify(c)]));
  const ids = allCards().map(c => c.id), shown = [...document.querySelectorAll(".card[data-card]")].map(el => el.dataset.card);
  const listed = new Set(shownCards().map(c => c.id));
  if (ids.length !== old.size || shown.some(s => !listed.has(s)) || [...listed].some(s => !shown.includes(s))) return renderCards();
  for (const c of allCards()) if (c.id === id || old.get(c.id) !== JSON.stringify(c)) renderCard(c.id);
}

function choose(id, optionId) {
  const c = findCard(id), o = c && optionById(c, optionId);
  if (!o || same(c.chosen, o.id)) return Promise.resolve(false);
  const value = o.id, at = isoNow();
  return save(id, card => {
    card.chosen = value;
    card.chosenAt = at;
    card.chosenBy = "Tomer";
  }, `chose ${value}`, `בחרת: ${o.label || value}`);
}

function unchoose(id) {
  return save(id, card => {
    card.chosen = null;
    card.chosenAt = null;
    card.chosenBy = null;
  }, "took the choice back", "הבחירה בוטלה");
}

function saveNote(id) {
  const c = findCard(id), text = state.drafts[id];
  if (!c || text === undefined) return Promise.resolve(false);
  return save(id, card => { card.notes = text; }, "note", text ? "ההערה נשמרה" : "ההערה נמחקה").then(ok => {
    if (ok && state.drafts[id] === text) { delete state.drafts[id]; renderCard(id); }
    return ok;
  });
}

// An approval row: approved, change (with his note), or neither again (his note stays).
function answerRow(id, rowId, status, note) {
  const at = status ? isoNow() : null;
  return save(id, card => {
    const r = Array.isArray(card.items) ? card.items.find(x => x && same(x.id, rowId)) : null;
    if (!r) return false;
    r.status = status;
    if (note !== undefined) r.note = note;
    r.at = at;
  }, `item ${rowId}: ${status || "unmarked"}`, status === "approved" ? "סימנת: מאשר" : status === "change" ? "סימנת: לשנות" : "הסימון בוטל").then(ok => {
    const key = id + "\n" + rowId;
    if (ok && status === "change") {
      delete state.drafts[key];
      uiOf(id).rowNote = null;
      renderCard(id);
    }
    return ok;
  });
}

// ---------- the address: decisions.html#<card id> ----------
function goToHash(first = false) {
  const id = fromHash();
  if (!id || !state.data) return;
  const c = findCard(id);
  if (!c) {
    showProblem(`אין החלטה בשם ${ltr(id)}: אולי היא הוסרה. כל השאר כאן.`);
    return;
  }
  showProblem(null);
  const old = state.highlight;
  state.highlight = id;
  if (!cardEl(id)) setFilter(stageOf(c), "all");
  else {
    if (old && old !== id) renderCard(old);
    renderCard(id);
  }
  const reveal = () => cardEl(id)?.scrollIntoView({ block: "start", behavior: first || calm.matches ? "auto" : "smooth" });
  reveal();
  if (first) document.fonts.ready.then(() => setTimeout(reveal, 60)); // once the fonts have set every card's height
}

// ---------- copy as text ----------
// Every card that waits for him, in plain words, to paste to Claude in a chat (like the Waves page's).
function asText() {
  const list = allCards().filter(c => stageOf(c) === "waiting").sort((a, b) => priority(a) - priority(b) || allCards().indexOf(a) - allCards().indexOf(b));
  const lines = [`החלטות שמחכות לי: ${list.length} (מדף ההחלטות). מה שבחרתי כתוב ליד כל אחת.`, ""];
  list.forEach((c, i) => {
    lines.push(`${i + 1}. ${c.title || c.id} [${c.id}]${priority(c) === 1 ? " (חשוב)" : ""}`);
    if (c.question) lines.push(c.question);
    const rows = rowsOf(c);
    if (rows) for (const r of rows) {
      const item = artItem(r), f = item && feedbackFor(item);
      const now = item ? (!f ? "עוד לא סימנתי" : f.verdict === "approve" ? "אישרתי" : `ביקשתי שינוי${f.note ? ": " + f.note : ""}`)
        : r.status === "approved" ? "אישרתי" : r.status === "change" ? `ביקשתי שינוי${r.note ? ": " + r.note : ""}` : "עוד לא סימנתי";
      lines.push(`  - ${r.label || r.id}: ${now}`);
    }
    else for (const o of optionsOf(c)) {
      const marks = [same(liveOption(c), o.id) ? "נבחר לעכשיו" : "", o.changesGameplay ? "משנה את המשחק" : "", o.needs ? `עוד לא בנוי: ${o.needs}` : ""].filter(Boolean);
      lines.push(`  ${o.id}. ${o.label || ""}${o.description ? ": " + o.description : ""}${marks.length ? ` (${marks.join("; ")})` : ""}`);
    }
    if (c.notes) lines.push(`  ההערה שלי: ${c.notes}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd() + "\n";
}

async function copyText() {
  const b = $("copy-text"), text = asText();
  try {
    await navigator.clipboard.writeText(text);
    b.textContent = "הועתק";
  } catch {
    const t = document.createElement("textarea"); // an older phone browser: the old way
    t.value = text;
    t.style.cssText = "position:fixed;opacity:0";
    document.body.append(t);
    t.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch { /* no way to copy here */ }
    t.remove();
    b.textContent = ok ? "הועתק" : "לא הצלחתי להעתיק";
  }
  setTimeout(() => { b.textContent = "העתקה כטקסט"; }, 1800);
}

// ---------- the compare view's line (drag it) and flip (tap) ----------
let dragging = null; // { stage, pointer, x, moved }: a finger or the mouse on the compare picture
function compareAt(stageEl, x) {
  const r = stageEl.getBoundingClientRect(), at = Math.min(1, Math.max(0, (x - r.left) / r.width));
  setCompareAt(stageEl, at);
}
function setCompareAt(stageEl, at) {
  const id = stageEl.closest(".card").dataset.card;
  uiOf(id).at = at;
  stageEl.style.setProperty("--at", (Math.round(at * 1000) / 10) + "%");
  stageEl.querySelector(".compare-line")?.setAttribute("aria-valuenow", String(Math.round(at * 100)));
}
function flipCompare(stageEl) {
  const ui = uiOf(stageEl.closest(".card").dataset.card);
  ui.showB = !ui.showB;
  stageEl.classList.toggle("show-b", ui.showB);
}

// ---------- the full-size view: zoom (wheel, + and −, pinch, double tap) and drag, as on the Art page ----------
const zoom = {
  w: 0, h: 0,      // the picture's own size
  fit: 1,          // screen pixels to a picture pixel when it just fits
  most: 1,         // the furthest zoom, in multiples of fit
  scale: 1, x: 0, y: 0, // screen pixels to a picture pixel now, and where its top left corner is in the view
  pointers: new Map(), gesture: null, tap: null, lastTap: null,
  opener: null,    // what opened it: the keyboard goes back there
};
const view = () => $("zoom-view").getBoundingClientRect();

function openZoom(src, title, opener) {
  const img = $("zoom-img");
  zoom.w = 0;
  zoom.lastTap = null;
  zoom.opener = opener || null;
  img.onload = () => { if (!zoom.w) layoutZoom(); }; // (a cached picture is laid out below at once: its late load event
  img.src = src;                                      // mustn't undo a zoom made since)
  $("zoom-title").textContent = title || "";
  $("zoom").showModal();
  document.documentElement.classList.add("zooming");
  if (img.complete && img.naturalWidth) layoutZoom();
}

function closeZoom() {
  if ($("zoom").open) $("zoom").close();
}

// Fits the picture in the view (keep: at the same zoom as before, after the window changed size).
function layoutZoom(keep = false) {
  const img = $("zoom-img"), v = view();
  if (!img.naturalWidth || !v.width) return;
  const z = keep && zoom.w ? zoom.scale / zoom.fit : 1;
  zoom.w = img.naturalWidth;
  zoom.h = img.naturalHeight;
  zoom.fit = Math.min(v.width / zoom.w, v.height / zoom.h);
  zoom.most = Math.max(ZOOM_AT_LEAST, PIXELS_AT_MOST / zoom.fit);
  zoom.scale = zoom.fit * z;
  applyZoom();
}

// Zooms to `scale`, keeping the picture's point at (px, py) in the view where it is.
function zoomAt(scale, px, py) {
  if (!zoom.w) return;
  const s = Math.min(Math.max(scale, zoom.fit), zoom.fit * zoom.most);
  zoom.x = px - (px - zoom.x) * s / zoom.scale;
  zoom.y = py - (py - zoom.y) * s / zoom.scale;
  zoom.scale = s;
  applyZoom();
}
const zoomBy = k => { const v = view(); zoomAt(zoom.scale * k, v.width / 2, v.height / 2); };

// Draws the picture where zoom says, kept in the view: centred while it's smaller than it, else no gap at its edges.
function applyZoom() {
  const v = view(), w = zoom.w * zoom.scale, h = zoom.h * zoom.scale, pic = $("zoom-pic");
  zoom.x = w <= v.width ? (v.width - w) / 2 : Math.min(0, Math.max(v.width - w, zoom.x));
  zoom.y = h <= v.height ? (v.height - h) / 2 : Math.min(0, Math.max(v.height - h, zoom.y));
  pic.style.width = w + "px"; // sized, not scaled, so the browser draws it sharp at every zoom
  pic.style.height = h + "px";
  pic.style.transform = `translate(${zoom.x}px, ${zoom.y}px)`;
  const z = zoom.scale / zoom.fit;
  $("zoom-level").textContent = "×" + (z < 9.95 ? String(Math.round(z * 10) / 10) : String(Math.round(z)));
  $("zoom-in").setAttribute("aria-disabled", String(z >= zoom.most - 1e-6));
  $("zoom-out").setAttribute("aria-disabled", String(z <= 1 + 1e-6));
  $("zoom-view").classList.toggle("can-drag", w > v.width + 0.5 || h > v.height + 0.5);
}

const at = e => { const v = view(); return { x: e.clientX - v.left, y: e.clientY - v.top }; };
const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
// A drag or a pinch starts again from where the fingers (or the mouse) are now.
function startGesture() {
  const [a, b] = [...zoom.pointers.values()];
  zoom.gesture = a && { x: zoom.x, y: zoom.y, scale: zoom.scale, mid: b ? middle(a, b) : a, spread: b ? Math.hypot(a.x - b.x, a.y - b.y) : 0 };
  $("zoom-view").classList.toggle("dragging", !!a);
}

function pointerDown(e) {
  if (e.pointerType === "mouse" && e.button !== 0) return; // only the left button drags
  try { $("zoom-view").setPointerCapture(e.pointerId); } catch { /* a pointer the browser isn't tracking */ }
  zoom.pointers.set(e.pointerId, at(e));
  zoom.tap = zoom.pointers.size === 1 ? { ...at(e), time: e.timeStamp, id: e.pointerId } : null;
  startGesture();
}

function pointerMove(e) {
  if (!zoom.pointers.has(e.pointerId) || !zoom.w) return;
  zoom.pointers.set(e.pointerId, at(e));
  const g = zoom.gesture, [a, b] = [...zoom.pointers.values()];
  if (zoom.tap && Math.hypot(a.x - zoom.tap.x, a.y - zoom.tap.y) > 8) zoom.tap = null; // a drag, not a tap
  if (b && g.spread) { // a pinch: bigger by how much the fingers spread, the point between them staying between them
    const mid = middle(a, b);
    const s = Math.min(Math.max(g.scale * Math.hypot(a.x - b.x, a.y - b.y) / g.spread, zoom.fit), zoom.fit * zoom.most);
    zoom.x = mid.x - (g.mid.x - g.x) * s / g.scale;
    zoom.y = mid.y - (g.mid.y - g.y) * s / g.scale;
    zoom.scale = s;
  } else {
    zoom.x = g.x + a.x - g.mid.x;
    zoom.y = g.y + a.y - g.mid.y;
  }
  applyZoom();
}

function pointerUp(e) {
  if (!zoom.pointers.delete(e.pointerId)) return;
  const t = zoom.tap;
  if (e.type === "pointerup" && t && t.id === e.pointerId && e.timeStamp - t.time < 300) {
    const last = zoom.lastTap; // a double tap (or click): zoom in on that point, or back out
    if (last && t.time - last.time < 450 && Math.hypot(t.x - last.x, t.y - last.y) < 40) {
      if (zoom.scale > zoom.fit * 1.05) layoutZoom();
      else zoomAt(zoom.fit * Math.min(2.5, zoom.most), t.x, t.y);
      zoom.lastTap = null;
    } else zoom.lastTap = t;
  }
  zoom.tap = null;
  startGesture();
}

function wheel(e) {
  e.preventDefault();
  const p = at(e), dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
  zoomAt(zoom.scale * Math.exp(-dy * 0.002), p.x, p.y);
}

// ---------- wiring ----------
const cardOf = el => el.closest(".card")?.dataset.card;

document.addEventListener("click", e => {
  const f = e.target.closest("[data-stage], [data-group]");
  if (f && (f.closest(".filters") || f.closest("#empty"))) {
    setFilter(f.dataset.stage || state.stage, f.dataset.group || (f.dataset.stage ? state.group : "all"));
    return;
  }
  if (e.target.closest("[data-reload]")) { load(); return; }
});

$("cards").addEventListener("click", e => {
  const b = e.target.closest("button, [data-compare-stage]");
  const id = b && cardOf(b);
  if (!b || !id) return;
  const ui = uiOf(id);
  if (b.dataset.choose !== undefined) choose(id, b.dataset.choose);
  else if (b.hasAttribute("data-unchoose")) unchoose(id);
  else if (b.hasAttribute("data-save-note")) saveNote(id);
  else if (b.dataset.zoom) openZoom(b.dataset.zoom, b.dataset.title, b);
  else if (b.dataset.look) { ui.look = b.dataset.look; renderCard(id); }
  else if (b.hasAttribute("data-compare-toggle")) { ui.compare = !ui.compare; renderCard(id); }
  else if (b.dataset.compareWay) { ui.flip = b.dataset.compareWay === "flip"; ui.showB = false; renderCard(id); }
  else if (b.hasAttribute("data-compare-stage")) { if (ui.flip) flipCompare(b); }
  else if (b.dataset.verdict) {
    const rowId = b.closest("[data-row]").dataset.row, row = (rowsOf(findCard(id)) || []).find(r => same(r.id, rowId));
    if (!row) return;
    if (b.dataset.verdict === "change") { ui.rowNote = same(ui.rowNote, rowId) ? null : rowId; renderCard(id); }
    else answerRow(id, row.id, b.dataset.verdict === "clear" ? null : "approved");
  } else if (b.hasAttribute("data-row-save")) {
    const rowId = b.closest("[data-row]").dataset.row, row = (rowsOf(findCard(id)) || []).find(r => same(r.id, rowId));
    const key = id + "\n" + rowId, note = state.drafts[key] !== undefined ? state.drafts[key] : row && row.note || "";
    if (row) answerRow(id, row.id, "change", note);
  } else if (b.hasAttribute("data-row-cancel")) {
    delete state.drafts[id + "\n" + b.closest("[data-row]").dataset.row];
    ui.rowNote = null;
    renderCard(id);
  }
});

$("cards").addEventListener("input", e => {
  const t = e.target, id = cardOf(t);
  if (!id) return;
  if (t.hasAttribute("data-note")) {
    state.drafts[id] = t.value;
    const saved = typeof findCard(id)?.notes === "string" ? findCard(id).notes : "";
    t.closest(".note").querySelector("[data-save-note]").disabled = !!state.busy[id] || t.value === saved;
  } else if (t.hasAttribute("data-row-note")) state.drafts[id + "\n" + t.closest("[data-row]").dataset.row] = t.value;
});

$("cards").addEventListener("change", e => {
  const s = e.target.closest("[data-compare-side]"), id = s && cardOf(s);
  if (!id) return;
  const ui = uiOf(id), other = s.dataset.compareSide === "a" ? "b" : "a";
  if (same(ui[other], s.value)) ui[other] = ui[s.dataset.compareSide]; // picking the other side's option swaps the two
  ui[s.dataset.compareSide] = s.value;
  renderCard(id);
});

$("cards").addEventListener("keydown", e => {
  const line = e.target.closest(".compare-line"), stageEl = e.target.closest("[data-compare-stage]");
  if (line) {
    const ui = uiOf(cardOf(line)), keys = { ArrowLeft: -COMPARE_KEY_STEP, ArrowRight: COMPARE_KEY_STEP, Home: -1, End: 1 };
    if (!(e.key in keys)) return;
    e.preventDefault();
    setCompareAt(line.closest("[data-compare-stage]"), Math.min(1, Math.max(0, ui.at + keys[e.key])));
  } else if (stageEl && uiOf(cardOf(stageEl)).flip && (e.key === "Enter" || e.key === " ")) {
    e.preventDefault();
    flipCompare(stageEl);
  } else if (e.target.matches("[data-note]") && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    saveNote(cardOf(e.target));
  }
});

// The compare line follows a drag sideways (a mouse, a finger, a pen), and jumps to a tap. A finger that scrolls the page
// up or down instead leaves it where it is (the browser takes that finger: pointercancel; decisions.css: pan-y).
$("cards").addEventListener("pointerdown", e => {
  const stageEl = e.target.closest("[data-compare-stage]");
  if (!stageEl || stageEl.classList.contains("flip") || (e.pointerType === "mouse" && e.button !== 0)) return;
  if (e.pointerType === "mouse") e.preventDefault(); // no text selection or picture drag
  dragging = { stage: stageEl, pointer: e.pointerId, x: e.clientX, moved: false };
  try { stageEl.setPointerCapture(e.pointerId); } catch { /* a pointer the browser isn't tracking */ }
});
$("cards").addEventListener("pointermove", e => {
  if (!dragging || e.pointerId !== dragging.pointer) return;
  if (!dragging.moved && Math.abs(e.clientX - dragging.x) < 4) return;
  dragging.moved = true;
  dragging.stage.classList.add("dragging");
  compareAt(dragging.stage, e.clientX);
});
const endDrag = e => {
  if (!dragging || e.pointerId !== dragging.pointer) return;
  if (e.type === "pointerup") compareAt(dragging.stage, e.clientX);
  dragging.stage.classList.remove("dragging");
  dragging = null;
};
$("cards").addEventListener("pointerup", endDrag);
$("cards").addEventListener("pointercancel", endDrag);

// The compare view takes the shape of its pictures once the first has loaded (a card needn't give their size).
$("cards").addEventListener("load", e => {
  const img = e.target;
  if (!img.matches || !img.matches(".compare-a") || !img.naturalWidth) return;
  const stageEl = img.closest("[data-compare-stage]");
  stageEl.style.setProperty("--w", img.naturalWidth);
  stageEl.style.setProperty("--h", img.naturalHeight);
}, true);

$("copy-text").addEventListener("click", copyText);
window.addEventListener("hashchange", () => goToHash());
window.addEventListener("beforeunload", e => {
  const unsaved = Object.entries(state.drafts).some(([key, text]) => {
    const [id, rowId] = key.split("\n"), c = findCard(id);
    if (!c) return false;
    if (rowId === undefined) return text !== (typeof c.notes === "string" ? c.notes : "");
    const r = (rowsOf(c) || []).find(x => same(x.id, rowId));
    return !!r && text !== (r.note || "");
  });
  if (unsaved) { e.preventDefault(); e.returnValue = ""; }
});

$("zoom-in").addEventListener("click", () => zoomBy(ZOOM_STEP));
$("zoom-out").addEventListener("click", () => zoomBy(1 / ZOOM_STEP));
$("zoom-fit").addEventListener("click", () => layoutZoom());
$("zoom-close").addEventListener("click", closeZoom);
$("zoom").addEventListener("keydown", e => {
  const keys = { "+": () => zoomBy(ZOOM_STEP), "=": () => zoomBy(ZOOM_STEP), "-": () => zoomBy(1 / ZOOM_STEP),
    "−": () => zoomBy(1 / ZOOM_STEP), "0": () => layoutZoom(), Escape: closeZoom };
  if (!keys[e.key] || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  keys[e.key]();
});
$("zoom").addEventListener("close", () => {
  document.documentElement.classList.remove("zooming");
  zoom.pointers.clear();
  if (zoom.opener && zoom.opener.isConnected) zoom.opener.focus({ preventScroll: true });
});
const zoomView = $("zoom-view");
zoomView.addEventListener("pointerdown", pointerDown);
zoomView.addEventListener("pointermove", pointerMove);
zoomView.addEventListener("pointerup", pointerUp);
zoomView.addEventListener("pointercancel", pointerUp);
zoomView.addEventListener("wheel", wheel, { passive: false });
window.addEventListener("resize", () => { if ($("zoom").open) layoutZoom(true); });

// A card the address opens stays clear of the header, however tall the header is.
new ResizeObserver(() => document.documentElement.style.setProperty("--below-top", header.offsetHeight + 12 + "px")).observe(header);

load();
