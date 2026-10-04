"use strict";
// The Art page (גלריה), in Hebrew, right to left: every character, weapon, projectile and piece of scenery of the
// game, with its pictures. They and their list come from the media index art/index.json (written by
// GamePages/cut_existing.py, later also by build_media.py; the format is GamePages/media_index.py's): online from the
// testdrive-media site, on this PC from GamePages/media/ (Store.media). Looking needs no GitHub key, so this page
// never asks for one.
// Version 0 shows stills. Each kind of file (its "role") is shown by its entry in VIEWERS: turntables and clips join
// there in the next versions, then Approve / Change... notes for each item.
// art.html#<id> opens that item (the decisions page will link to items that way), and the address follows the choice.
// Tested by docs/claude-tools/pages_art_test.js (cdp.mjs, desktop and phone).

const INDEX = "art/index.json";                   // the list of pictures, on the media site
const FACETS = ["look", "view", "hitbox", "cell"]; // what tells an item's pictures apart (keys of its files)
const KEEP = ["view", "hitbox", "look", "cell"];   // what the next item keeps from the picture before, most important first
const ZOOM_AT_LEAST = 3;  // the full-size view zooms to at least 3 times the picture's fitted size,
const PIXELS_AT_MOST = 2; // and further when that isn't 2 screen pixels to a picture's pixel (a big picture on a phone)
const ZOOM_STEP = 1.5;    // one press of + or −
const LABELS = { look: "מראה", view: "מבט" };

const state = {
  index: null,   // art/index.json
  subject: null, // the item shown
  file: null,    // the picture of it shown
  pick: {},      // the look, view, hitbox and cell of the last picture shown: the next item opens the same way
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ltr = text => `<bdi dir="ltr">${esc(text)}</bdi>`;     // a name inside Hebrew text
const cmd = text => `<code dir="ltr">${esc(text)}</code>`;   // a command or a file, kept on one line
const nameOf = (table, code) => ((state.index.names || {})[table] || {})[code] || String(code); // the Hebrew name of a code
const url = f => Store.media(f.src, f.v);
function fromHash() {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return location.hash.slice(1); }
}
const phone = matchMedia("(max-width: 700px)"); // art.css folds the list up at this width
const calm = matchMedia("(prefers-reduced-motion: reduce)"); // then the page jumps where it would glide
const header = document.querySelector(".top"); // the page's header, which stays at the top (common.css)
// "2026-10-04T16:26:00+03:00" -> "4.10.2026 בשעה 16:26" (the time as written, which is Israel's)
function when(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(iso || "");
  return m ? `${+m[3]}.${+m[2]}.${m[1]} בשעה ${m[4]}:${m[5]}` : "";
}

// ---------- how each kind of file is shown ----------
// stage(file) resolves to the element shown big, once it can be shown; zooms: it opens in the full-size view.
// Turntables (drag to turn) and clips (play, slow motion, frame step) come in the next versions, with their own stage.
const VIEWERS = {
  still: { stage: stillStage, zooms: true },
};
const shown = s => s.files.filter(f => VIEWERS[f.role]); // the files of an item that this version can show

// A still, as big as the stage allows (a small one enlarged at most 3 times: --cap in art.css). A picture from the
// game camera shows many items: a ring marks this one at its focus point. Waits until the picture loaded (or failed).
async function stillStage(f) {
  const img = new Image();
  img.alt = "";
  img.src = url(f);
  await img.decode().catch(() => {}); // a picture that fails still gets its place, saying so
  const pic = document.createElement("span");
  const w = f.w || img.naturalWidth || 16, h = f.h || img.naturalHeight || 9;
  pic.className = "shot" + (f.alpha ? " alpha" : "") + (img.naturalWidth ? "" : " broken");
  pic.style.cssText = `--w: ${w}; --h: ${h}`;
  pic.append(img);
  if (f.focus) pic.insertAdjacentHTML("beforeend", ring(f));
  if (f.badge) pic.insertAdjacentHTML("beforeend", `<span class="badge">${esc(nameOf("badges", f.badge))}</span>`);
  if (!img.naturalWidth) pic.insertAdjacentHTML("beforeend", `<span class="broken-note">התמונה לא נטענה</span>`);
  return pic;
}
const ring = f => `<span class="ring" style="--fx: ${+f.focus[0]}; --fy: ${+f.focus[1]}"></span>`;

// ---------- loading ----------
// What went wrong loading the list of pictures, and what to do about it.
const PROBLEMS = {
  offline: () => Store.online
    ? "אין חיבור לאתר התמונות. בדוק את החיבור לאינטרנט ורענן את הדף."
    : `השרת של הדפים במחשב לא עונה. ביוניטי: בתפריט ${ltr("TestDrive > Offline (this PC only) > Open Art page")}.`,
  missing: () => Store.online
    ? `באתר התמונות עוד אין רשימת תמונות (${cmd(INDEX)}). צריך לחתוך ולפרסם אותן, ואפשר לבקש את זה מ-${ltr("Claude")}: ` +
      `${cmd("python GamePages/cut_existing.py")} ואחר כך ${cmd("python GamePages/publish_media.py")}.`
    : `במחשב עוד אין רשימת תמונות (${cmd("GamePages/media/" + INDEX)}). צריך לחתוך אותן, ואפשר לבקש את זה מ-${ltr("Claude")}: ` +
      `${cmd("python GamePages/cut_existing.py")}.`,
  status: n => `${Store.online ? "אתר התמונות" : "השרת של הדפים"} ענה ${n} במקום רשימת התמונות. נסה לרענן את הדף בעוד דקה.`,
  broken: () => `רשימת התמונות (${cmd(INDEX)}) פגומה ואי אפשר לקרוא אותה. צריך ליצור אותה מחדש, ואפשר לבקש את זה ` +
    `מ-${ltr("Claude")}: ${cmd("python GamePages/cut_existing.py")}.`,
  format: v => `רשימת התמונות כתובה בגרסה ${ltr(String(v))}, שהדף הזה לא מכיר. רענן את הדף: אולי יש לו גרסה חדשה.`,
  empty: () => "ברשימת התמונות עוד אין אף תמונה.",
};

async function load() {
  showProblem(null);
  $("file-path").textContent = "טוען…";
  let index;
  try {
    const r = await fetch(Store.media(INDEX), { cache: "no-store" });
    if (!r.ok) return failed(r.status === 404 ? PROBLEMS.missing() : PROBLEMS.status(r.status));
    index = await r.json();
  } catch (e) {
    return failed(e instanceof SyntaxError ? PROBLEMS.broken() : PROBLEMS.offline());
  }
  if (!index || typeof index !== "object" || !("format" in index)) return failed(PROBLEMS.broken());
  if (index.format !== 1 || !Array.isArray(index.subjects)) return failed(PROBLEMS.format(index.format));
  for (const s of index.subjects) if (!Array.isArray(s.files)) s.files = [];
  if (!index.subjects.some(s => shown(s).length)) return failed(PROBLEMS.empty());
  state.index = index;
  $("file-path").innerHTML = (Store.online ? `התמונות מהאתר ${ltr("testdrive-media")}` : `התמונות מהמחשב הזה (${ltr("GamePages/media")})`) +
    (index.madeAt ? `, עודכנו ב-${when(index.madeAt)}` : "");
  renderList();
  $("subjects").hidden = $("viewer").hidden = false;
  select(fromHash());
}

function failed(html) {
  state.index = state.subject = state.file = null;
  $("subjects").hidden = $("viewer").hidden = true;
  $("file-path").textContent = "אין תמונות";
  showProblem(html);
}

function showProblem(html) {
  const p = $("problem");
  p.hidden = !html;
  p.innerHTML = html || "";
}

// ---------- the list, by group (in the index's order) ----------
function renderList() {
  const groups = [];
  for (const s of state.index.subjects) {
    let g = groups.find(x => x.code === s.group);
    if (!g) groups.push(g = { code: s.group, items: [] });
    g.items.push(s);
  }
  $("subject-groups").innerHTML = groups.map(g => `
    <div class="group">
      <h2 class="group-title"><span dir="auto">${esc(nameOf("groups", g.code))}</span><span class="count">${g.items.length}</span></h2>
      <ul class="group-list">${g.items.map(s => `
        <li><button type="button" class="item" data-subject="${esc(s.id)}" aria-current="false">
          ${thumb(shown(s)[0], "thumb")}
          <span class="item-names"><span class="item-he" dir="auto">${esc(s.label)}</span><span class="item-en" dir="auto">${esc(s.name || "")}</span></span>
        </button></li>`).join("")}
      </ul>
    </div>`).join("");
  $("subjects-toggle").innerHTML = `<span>כל הפריטים <span class="count">${state.index.subjects.length}</span></span><span class="chevron" aria-hidden="true">▾</span>`;
}

// A small picture: cropped to fill its box when it's about as wide as tall or a screen shape, whole otherwise (a
// sword, a portrait); a game-camera picture shows the part round its item. Loaded lazily, but with no
// decoding="async": with it, Chrome often left loaded pictures unpainted (black squares) in the headless screenshots.
function thumb(f, cls) {
  if (!f) return `<span class="${cls}"></span>`;
  const ratio = (f.w || 1) / (f.h || 1), fill = f.focus || (!f.alpha && ratio > 0.7 && ratio < 1.9);
  const at = f.focus ? ` style="object-position: ${+f.focus[0] * 100}% ${+f.focus[1] * 100}%"` : "";
  return `<span class="${cls}${f.alpha ? " alpha" : ""}"><img src="${esc(url(f))}" alt="" loading="lazy"` +
    ` width="${f.w || ""}" height="${f.h || ""}"${fill ? ' class="fill"' : ""}${at}></span>`;
}

function markList() {
  for (const b of $("subject-groups").querySelectorAll("[data-subject]"))
    b.setAttribute("aria-current", String(b.dataset.subject === state.subject.id));
}

// Scrolls the list (not the page) so the item shown is in sight.
function revealInList() {
  const box = $("subject-groups"), b = box.querySelector('[aria-current="true"]');
  if (!b || box.scrollHeight <= box.clientHeight) return;
  const r = b.getBoundingClientRect(), view = box.getBoundingClientRect();
  if (r.top < view.top + 40 || r.bottom > view.bottom) box.scrollTop += r.top - view.top - view.height / 3;
}

// Phones: the list folds up into one button at the top.
function fold(closed) {
  $("subjects").classList.toggle("open", !closed);
  $("subjects-toggle").setAttribute("aria-expanded", String(!closed));
  if (!closed) revealInList();
}

// ---------- the item chosen, and which of its pictures ----------
function select(id) {
  const all = state.index.subjects;
  let s = all.find(x => x.id === id);
  if (s) showProblem(null);
  else {
    if (id) showProblem(`בגלריה אין פריט בשם ${ltr(id)}, אז מוצג הראשון ברשימה.`);
    s = all[0];
  }
  state.subject = s;
  if (fromHash() !== s.id) history.replaceState(null, "", "#" + s.id);
  document.title = `${s.label} · גלריה`;
  const files = shown(s), values = facets(files), i = all.indexOf(s), n = files.length;
  const others = s.files.length - n;
  $("subject-title").innerHTML = `<span dir="auto">${esc(s.label)}</span> <small class="subject-en" dir="auto">${esc(s.name || "")}</small>`;
  $("subject-meta").innerHTML = [esc(nameOf("groups", s.group)),
    n === 1 ? `תמונה אחת${s.madeAt ? ", צולמה ב-" + when(s.madeAt) : ""}` : `${n} תמונות${s.madeAt ? ", צולמו ב-" + when(s.madeAt) : ""}`,
    others ? `ועוד ${others} קבצים שהגרסה הזו עוד לא מציגה` : ""].filter(Boolean).join(" · ");
  $("subject-note").textContent = s.note || "";
  $("prev").disabled = i === 0;
  $("next").disabled = i === all.length - 1;
  renderControls(values);
  renderStrip(files, values);
  markList();
  revealInList();
  if (n) choose(bestFile(files, state.pick, KEEP));
  else {
    state.file = null;
    asked++; // a picture of the item before, still loading, isn't shown
    $("stage").querySelector(".shot")?.remove();
    $("caption").textContent = "אין עדיין תמונות לפריט הזה.";
  }
}

// The values each facet takes among some pictures, in their order: a facet with two or more gets buttons.
function facets(files) {
  const values = {};
  for (const k of FACETS) values[k] = [...new Set(files.filter(f => k in f).map(f => f[k]))];
  return values;
}

// The picture closest to what's wanted: matching the facets in `order`, the first counting most (ties: the first).
function bestFile(files, want, order) {
  let best = files[0], bestScore = -1;
  for (const f of files) {
    const score = order.reduce((sum, k, i) => sum + (want[k] !== undefined && f[k] === want[k] ? 2 ** (order.length - i) : 0), 0);
    if (score > bestScore) [best, bestScore] = [f, score];
  }
  return best;
}

function pickFacet(k, value) {
  choose(bestFile(shown(state.subject), { ...state.pick, [k]: value }, [k, ...KEEP.filter(x => x !== k)]));
}

function choose(f) {
  state.file = f;
  for (const k of FACETS) if (k in f) state.pick[k] = f[k];
  markControls();
  markStrip();
  show(f);
}

// A tap below the big picture (a picture in the strip, a look or view button, the hitbox switch) changes it. When it
// isn't wholly in sight under the header (the page was scrolled down to the strip), the page glides up to it, or the
// tap would seem to do nothing. art.css keeps it clear of the header (scroll-margin-top).
function revealStage() {
  const stage = $("stage"), r = stage.getBoundingClientRect();
  if (r.top < header.getBoundingClientRect().bottom - 1 || r.bottom > innerHeight + 1)
    stage.scrollIntoView({ block: "nearest", behavior: calm.matches ? "auto" : "smooth" });
}

// A picture in words, saying only what differs between the item's pictures: "מגרש גרוטאות · מלפנים · עם קווי פגיעה",
// or a scenery picture's caption.
function describe(f) {
  const values = facets(shown(state.subject)), varies = k => values[k].length > 1;
  return [varies("look") && f.look && nameOf("looks", f.look), varies("view") && f.view && nameOf("views", f.view),
    f.hitbox ? "עם קווי פגיעה" : "", f.caption].filter(Boolean).join(" · ");
}

let asked = 0; // pictures asked for: one that loads after a newer one was asked for is dropped
async function show(f) {
  const n = ++asked, stage = $("stage");
  stage.classList.add("loading");
  const el = await VIEWERS[f.role].stage(f);
  if (n !== asked) return;
  stage.querySelector(".shot")?.remove();
  stage.prepend(el);
  stage.classList.remove("loading");
  const words = describe(f);
  stage.setAttribute("aria-label", `פתיחה בגודל מלא: ${state.subject.label}${words ? ", " + words : ""}`);
  $("caption").innerHTML = (words ? `<span dir="auto">${esc(words)}</span>` : "") +
    (f.focus ? `<span class="caption-more">${words ? " · " : ""}הפריט מסומן בעיגול לבן</span>` : "");
}

// The look and view buttons and the hitbox switch: only for what differs between the item's pictures.
function renderControls(values) {
  const group = k => values[k].length < 2 ? "" : `
    <div class="control" role="group" aria-label="${LABELS[k]}" data-control="${k}">
      <span class="control-label" aria-hidden="true">${LABELS[k]}</span>
      ${values[k].map(v => `<button type="button" class="pill" data-facet="${k}" data-value="${esc(v)}" aria-pressed="false"` +
        ` dir="auto">${esc(nameOf(k === "look" ? "looks" : "views", v))}</button>`).join("")}
    </div>`;
  const hitbox = values.hitbox.includes(true) && values.hitbox.includes(false)
    ? `<button type="button" class="pill hitbox" id="hitbox" aria-pressed="false"
        title="קווי הפגיעה: הצורות שהמשחק בודק כשמשהו פוגע">קווי פגיעה</button>` : "";
  $("controls").innerHTML = group("look") + group("view") + hitbox;
}

function markControls() {
  const f = state.file;
  for (const b of $("controls").querySelectorAll("[data-facet]")) b.setAttribute("aria-pressed", String(f[b.dataset.facet] === b.dataset.value));
  for (const g of $("controls").querySelectorAll("[data-control]")) g.classList.toggle("unused", !(g.dataset.control in f));
  $("hitbox")?.setAttribute("aria-pressed", String(f.hitbox === true));
}

// All the item's pictures, small: a row per look when there are several of each, else one row.
function renderStrip(files, values) {
  if (files.length < 2) {
    $("strip").innerHTML = "";
    return;
  }
  const byLook = values.look.length > 1 && files.length > values.look.length;
  const rows = byLook ? values.look.map(look => [nameOf("looks", look), files.filter(f => f.look === look)]) : [["", files]];
  if (byLook && files.some(f => !("look" in f))) rows.push(["", files.filter(f => !("look" in f))]);
  const ratio = files[0].w / files[0].h, same = files.every(f => Math.abs(f.w / f.h - ratio) < 0.05 * ratio);
  const label = f => [!byLook && values.look.length > 1 && f.look && nameOf("looks", f.look),
    values.view.length > 1 && f.view && nameOf("views", f.view), f.caption].filter(Boolean).join(" · ");
  $("strip").innerHTML = rows.map(([title, list]) => `
    <div class="strip-row">
      ${title ? `<h2 class="strip-title" dir="auto">${esc(title)}</h2>` : ""}
      <div class="strip-grid${same && ratio > 1.3 ? " wide" : ""}" style="--ratio: ${same ? `${files[0].w} / ${files[0].h}` : "1"}">
        ${list.map(f => `<button type="button" class="pic" data-file="${files.indexOf(f)}" aria-pressed="false" title="${esc(label(f) || state.subject.label)}">
          ${thumb(f, "pic-frame")}
          ${f.hitbox ? `<span class="tag hitbox-tag">קווי פגיעה</span>` : ""}
          ${f.badge ? `<span class="tag badge-tag">${esc(nameOf("badges", f.badge))}</span>` : ""}
          ${label(f) ? `<span class="pic-label" dir="auto">${esc(label(f))}</span>` : ""}
        </button>`).join("")}
      </div>
    </div>`).join("");
}

function markStrip() {
  const files = shown(state.subject);
  for (const b of $("strip").querySelectorAll("[data-file]")) b.setAttribute("aria-pressed", String(files[+b.dataset.file] === state.file));
}

function step(d) {
  const all = state.index.subjects, s = all[all.indexOf(state.subject) + d];
  if (s) select(s.id);
}

// ---------- the full-size view: zoom (wheel, + and −, pinch, double tap) and drag ----------
const zoom = {
  w: 0, h: 0,      // the picture's own size
  fit: 1,          // screen pixels to a picture pixel when it just fits
  most: 1,         // the furthest zoom, in multiples of fit
  scale: 1, x: 0, y: 0, // screen pixels to a picture pixel now, and where its top left corner is in the view
  pointers: new Map(), gesture: null, tap: null, lastTap: null,
};
const view = () => $("zoom-view").getBoundingClientRect();

function openZoom() {
  const f = state.file;
  if (!f || !VIEWERS[f.role].zooms || $("stage").querySelector(".shot.broken")) return;
  const img = $("zoom-img"), pic = $("zoom-pic"), words = describe(f);
  zoom.w = 0;
  zoom.lastTap = null;
  img.onload = () => layoutZoom();
  img.src = url(f);
  pic.className = "zoom-pic" + (f.alpha ? " alpha" : "");
  pic.querySelector(".ring")?.remove();
  if (f.focus) pic.insertAdjacentHTML("beforeend", ring(f));
  $("zoom-title").innerHTML = `<span dir="auto">${esc(state.subject.label)}</span>${words ? ` · <span dir="auto">${esc(words)}</span>` : ""}`;
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
$("subject-groups").addEventListener("click", e => {
  const b = e.target.closest("[data-subject]");
  if (!b) return;
  select(b.dataset.subject);
  if (phone.matches) {
    fold(true);
    $("viewer").scrollIntoView({ block: "start" });
  }
});
$("subjects-toggle").addEventListener("click", () => fold($("subjects").classList.contains("open")));
$("controls").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (b && b.id === "hitbox") pickFacet("hitbox", state.file.hitbox !== true);
  else if (b && b.dataset.facet) pickFacet(b.dataset.facet, b.dataset.value);
  else return;
  revealStage();
});
$("strip").addEventListener("click", e => {
  const b = e.target.closest("[data-file]");
  if (!b) return;
  choose(shown(state.subject)[+b.dataset.file]);
  revealStage();
});
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("stage").addEventListener("click", openZoom);
window.addEventListener("hashchange", () => {
  if (state.index && fromHash() !== state.subject.id) select(fromHash());
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
  $("stage").focus({ preventScroll: true });
});
const zoomView = $("zoom-view");
zoomView.addEventListener("pointerdown", pointerDown);
zoomView.addEventListener("pointermove", pointerMove);
zoomView.addEventListener("pointerup", pointerUp);
zoomView.addEventListener("pointercancel", pointerUp);
zoomView.addEventListener("wheel", wheel, { passive: false });
window.addEventListener("resize", () => { if ($("zoom").open) layoutZoom(true); });

// The list stays in sight under the header, however tall the header is.
new ResizeObserver(() => document.documentElement.style.setProperty("--below-top", header.offsetHeight + 12 + "px")).observe(header);

load();
