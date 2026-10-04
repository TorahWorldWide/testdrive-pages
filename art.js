"use strict";
// The Art page (גלריה), in Hebrew, right to left: every character, weapon, projectile and piece of scenery of the
// game, as the game itself draws them. They and their list come from the media index art/index.json (written by
// GamePages/cut_existing.py and build_media.py; the format is GamePages/media_index.py's): online from the
// testdrive-media site, on this PC from GamePages/media/ (Store.media). Looking needs no GitHub key.
// Each item shows, on one stage, whichever of these it has (the buttons above the stage switch between them):
//  - turning ("turntable" files): one frame of a sheet of 36 frames, one every 10 degrees round the item, at three
//    camera heights, plain or with the hitbox lines. A sideways drag (or swipe) turns it, a fling keeps turning a
//    little; the side buttons turn it to its front, back, left or right, or look from above. Zooming in (double tap,
//    pinch, + or Ctrl and the wheel) swaps in the sharp picture ("still" with an azimuth, 1600 px) of the nearest side;
//    zooming back out turns again.
//  - clips ("clip" files, e.g. a death): one mosaic video of 4 x 2 tiles, one per camera round the item, cut to one
//    tile, so switching the camera (the dial, or a sideways drag) is instant and never seeks; play, pause, slow motion,
//    a frame back or forward, loop, a time bar. Zoom or full screen loads that camera's own 1280 x 720 video at the
//    same moment. The poster shows first: nothing big loads before play.
//  - pictures ("still" files without an azimuth: the lineup's looks and views, the scenery's cells), as in version 0:
//    a tap opens one full size with zoom.
// "מאשר" and "לשנות..." save one item to feedback.json (Store.update; only Tomer's fields; the key is asked for only
// on the first save on a device). With a key on this device the page reads feedback.json to show his newest verdict
// per item ("שונה: לאשר שוב" once Claude marked it done).
// art.html#<id> opens that item (the decisions page links items that way), and the address follows the choice.
// Tested by docs/claude-tools/pages_art_test.js (cdp.mjs, desktop and phone).

const INDEX = "art/index.json";                   // the list of pictures, on the media site
const FACETS = ["look", "view", "hitbox", "cell"]; // what tells an item's pictures apart (keys of its files)
const KEEP = ["view", "hitbox", "look", "cell"];   // what the next item keeps from the picture before, most important first
const ZOOM_AT_LEAST = 3;  // the full-size view zooms to at least 3 times the picture's fitted size,
const PIXELS_AT_MOST = 2; // and further when that isn't 2 screen pixels to a picture's pixel (a big picture on a phone)
const ZOOM_STEP = 1.5;    // one press of + or −
const LABELS = { look: "מראה", view: "מבט" };
// Turning and zooming on the stage
const TURNS_PER_STAGE_WIDTH = 1; // a drag across the whole stage turns the item once round
const FLING_FADE_MS = 150;       // after a fling the turning slows down with this time constant (about 0.15 s)
const FLING_AT_LEAST = 0.08;     // degrees a millisecond: a drag let go slower than this just stops
const FLING_AT_MOST = 0.5;       // degrees a millisecond: a fling starts no faster (so it turns at most about 75° more)
const GLIDE_MS = 420;            // a side button turns the item there in about this time
const STAGE_ZOOM_MOST = 3;       // the stage zooms in up to 3 times
const STAGE_ZOOM_STEP = 1.5;     // one press of + or −
const TAP_PX = 8, TAP_MS = 300, DOUBLE_TAP_MS = 450; // a tap moves less and is shorter; a double tap's two are this close
const ANGLE_DRAG_PX = 44;        // a clip: a sideways drag of this much goes to the next camera
const TOP_FROM_DEGREES = 60;     // a camera height from this up is the view "from above"
const GAME_HEIGHT = 35;          // the game camera's height: an item opens at it
// Hebrew words for the codes of the turntables and clips
const HEIGHT_NAMES = { 8: "גובה העיניים", 35: "מצלמת המשחק", 80: "מלמעלה" };
const SIDES = [{ az: 0, name: "מלפנים" }, { az: 180, name: "מאחור" }, { az: 270, name: "משמאל" }, { az: 90, name: "מימין" }];
const ANGLE_NAMES = { 0: "מלפנים", 45: "מלפנים מימין", 90: "מימין", 135: "מאחור מימין", 180: "מאחור", 225: "מאחור משמאל",
  270: "משמאל", 315: "מלפנים משמאל" }; // azimuth 90 = the camera on the item's right side (the index's convention)
const GROUP_NAMES = { hero: "הגיבור", enemies: "אויבים", weapons: "נשקים", projectiles: "קליעים", scenery: "תפאורה",
  props: "אביזרים ואפקטים", effects: "אפקטים", markers: "סימונים" }; // when the index has no name for a group
const CLIP_WORDS = [[/aftermath/i, "מה נשאר על הרצפה"], [/death|die|kill/i, "מוות"]]; // a clip with no Hebrew name
const DEFAULT_SPEEDS = [0.25, 0.5, 1];

const state = {
  index: null,    // art/index.json
  subject: null,  // the item shown
  mode: null,     // what the stage shows: "turn", "picture" or "clip:<clip id>"
  file: null,     // the picture shown (mode "picture")
  pick: { mode: "turn" }, // how the last item was shown (look, view, hitbox, cell, height, az, mode, clip): the next opens so
  feedback: null, // feedback.json's items, or null when they couldn't be read (or this device has no key yet)
  saving: false,
  drafts: {},     // the note being written, per item
};

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ltr = text => `<bdi dir="ltr">${esc(text)}</bdi>`;     // a name inside Hebrew text
const cmd = text => `<code dir="ltr">${esc(text)}</code>`;   // a command or a file, kept on one line
const nameOf = (table, code) => ((state.index.names || {})[table] || {})[code] ||
  (table === "groups" && GROUP_NAMES[code]) || String(code); // the Hebrew name of a code
const url = f => Store.media(f.src, f.v);
function fromHash() {
  try { return decodeURIComponent(location.hash.slice(1)); } catch { return location.hash.slice(1); }
}
const phone = matchMedia("(max-width: 700px)"); // art.css folds the list up at this width
const calm = matchMedia("(prefers-reduced-motion: reduce)"); // then the page jumps where it would glide
const header = document.querySelector(".top"); // the page's header, which stays at the top (common.css)
const num = (x, otherwise = null) => typeof x === "number" && isFinite(x) ? x : otherwise;
const round = (x, places = 0) => Math.round(x * 10 ** places) / 10 ** places;
const norm = a => ((a % 360) + 360) % 360;                                  // an angle in 0..360
const gap = (a, b) => Math.abs(((a - b) % 360 + 540) % 360 - 180);           // degrees between two angles
const toward = (a, b) => ((b - a) % 360 + 540) % 360 - 180;                  // the shortest turn from a to b
const middle = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const degrees = h => `${round(h)}°`;
const seconds = t => `${String(round(t, 1)).replace(/\.0$/, "")} שנ׳`;
// "2026-10-04T16:26:00+03:00" -> "4.10.2026 בשעה 16:26" (the time as written, which is Israel's)
function when(iso) {
  const m = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(iso || "");
  return m ? `${+m[3]}.${+m[2]}.${m[1]} בשעה ${m[4]}:${m[5]}` : "";
}
// Now, as this device's local time with its offset ("2026-10-05T14:20:31+03:00"), like the times Claude writes.
function isoNow(d = new Date()) {
  const off = -d.getTimezoneOffset(), two = n => String(Math.floor(Math.abs(n))).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}:` +
    `${two(d.getSeconds())}${off < 0 ? "-" : "+"}${two(off / 60)}:${two(off % 60)}`;
}

// ---------- what each item has: its pictures, its turntables and its clips ----------
// A sharp picture of one side, for zooming into a turntable: a still with an azimuth (build_media.py marks it "zoom").
const isSideStill = f => f.role === "still" && (f.zoom === true || (num(f.azimuth) !== null && num(f.height) !== null));
const partsCache = new WeakMap();
function partsOf(s) {
  let p = partsCache.get(s);
  if (p) return p;
  const files = (Array.isArray(s.files) ? s.files : []).filter(f => f && typeof f.src === "string" && f.src);
  p = {
    pictures: files.filter(f => f.role === "still" && !isSideStill(f)),
    turn: turntablesOf(files.filter(f => f.role === "turntable"), files.filter(isSideStill)),
    clips: clipsOf(files.filter(f => f.role === "clip"), files.filter(f => f.role === "poster")),
  };
  partsCache.set(s, p);
  return p;
}
const hasAnything = s => { const p = partsOf(s); return !!(p.pictures.length || p.turn || p.clips.length); };

// The turntables: a set of sheets per camera height and plain/hitbox. A sheet holds frameCount frames from firstFrame on
// (frame k shows azimuth k x azimuthStepDegrees), cols x rows of fw x fh pixels, row by row (build_media.py). A sheet
// without firstFrame or frameCount continues where the one before it (by its "sheet" number) ended.
function turntablesOf(sheets, stills) {
  const sets = new Map();
  for (const f of sheets) {
    if (!(f.fw > 0 && f.fh > 0 && f.cols > 0 && f.rows > 0)) continue;
    const height = num(f.height, 0), hitbox = f.hitbox === true, key = `${round(height, 2)}|${hitbox}`;
    if (!sets.has(key)) sets.set(key, { key, height, hitbox, files: [] });
    sets.get(key).files.push(f);
  }
  if (!sets.size) return null;
  for (const set of sets.values()) {
    const first = set.files[0], step = num(first.azimuthStepDegrees, 0);
    set.fw = first.fw;
    set.fh = first.fh;
    set.total = num(first.frames, 0) > 0 ? Math.round(first.frames) : step > 0 ? Math.round(360 / step)
      : set.files.reduce((n, f) => n + f.cols * f.rows, 0);
    set.step = step > 0 ? step : 360 / set.total;
    const by = k => set.files.every(f => num(f[k]) !== null);
    if (by("firstFrame")) set.files.sort((a, b) => a.firstFrame - b.firstFrame);
    else if (by("sheet")) set.files.sort((a, b) => a.sheet - b.sheet);
    let next = 0;
    set.parts = set.files.map(f => {
      const start = num(f.firstFrame, next), count = num(f.frameCount, Math.min(f.cols * f.rows, set.total - start));
      next = start + count;
      return { f, start, count };
    });
  }
  const all = [...sets.values()];
  const heights = [...new Set(all.map(s => s.height))].sort((a, b) => a - b);
  const top = heights.length > 1 && heights[heights.length - 1] >= TOP_FROM_DEGREES ? heights[heights.length - 1] : null;
  return {
    sets, heights, top,
    plain: all.some(s => !s.hitbox), lines: all.some(s => s.hitbox),
    stills: stills.map(f => ({ f, height: num(f.height, 0), az: norm(num(f.azimuth, 0)), hitbox: f.hitbox === true })),
  };
}
const nearest = (list, x) => list.reduce((a, b) => Math.abs(b - x) < Math.abs(a - x) ? b : a);
const setOf = (t, height, hitbox) => t.sets.get(`${round(height, 2)}|${hitbox}`) ||
  [...t.sets.values()].find(s => s.height === height) || t.sets.values().next().value;
const frameAt = (set, az) => ((Math.round(norm(az) / set.step) % set.total) + set.total) % set.total;
const partAt = (set, k) => set.parts.find(p => k >= p.start && k < p.start + p.count) || null;
// The sharp picture nearest to a side (the same height, plain or hitbox as asked when there is one).
function stillNear(t, height, hitbox, az) {
  const same = t.stills.filter(s => Math.abs(s.height - height) < 0.5);
  const list = same.filter(s => s.hitbox === hitbox).length ? same.filter(s => s.hitbox === hitbox) : same;
  return list.reduce((a, b) => !a || gap(b.az, az) < gap(a.az, az) ? b : a, null);
}

// The clips: a mosaic video (layout "4x2", tiles of tile[0] x tile[1] pixels, one per camera, in the order of
// "angles" unless an angle names its "tile"), each camera's own video (angles[i].src), fps, durationSeconds, speeds;
// the poster: the clip's "poster" (a src), or the poster file naming the clip ("clip"), or one in the clip's folder.
function clipsOf(clips, posters) {
  const ids = new Set();
  return clips.map((f, n) => {
    let id = String(f.id || f.clip || f.name || stemOf(f.src));
    if (ids.has(id)) id += "-" + (n + 1);
    ids.add(id);
    const layout = /^(\d+)\s*x\s*(\d+)$/i.exec(String(f.layout || "")) || [0, 1, 1];
    const tile = Array.isArray(f.tile) && f.tile.length === 2 && f.tile.every(x => x > 0) ? f.tile.map(Number) : [16, 9];
    const angles = (Array.isArray(f.angles) && f.angles.length ? f.angles : [{ azimuth: 0 }]).map((a, k) => ({
      azimuth: norm(num(a && a.azimuth, 0)), src: a && typeof a.src === "string" && a.src ? a.src : null, v: a && a.v,
      w: num(a && a.w, 1280), h: num(a && a.h, 720), tile: Number.isInteger(a && a.tile) ? a.tile : k,
    }));
    const speeds = (Array.isArray(f.speeds) ? f.speeds.filter(x => num(x, 0) > 0) : []).sort((a, b) => a - b);
    return {
      f, id, name: clipName(f, id), cols: +layout[1] || 1, rows: +layout[2] || 1, tileW: tile[0], tileH: tile[1],
      fps: num(f.fps, 0) > 0 ? f.fps : 30, duration: num(f.durationSeconds, 0), height: num(f.height),
      speeds: speeds.length ? (speeds.includes(1) ? speeds : [...speeds, 1]) : DEFAULT_SPEEDS,
      angles, order: angles.map((a, i) => i).sort((i, j) => angles[i].azimuth - angles[j].azimuth),
      poster: posterOf(f, id, posters, clips.length),
    };
  });
}
function stemOf(src) {
  const parts = src.split("/"), base = parts.pop().replace(/\.[^.]+$/, "");
  return /^(mosaic|clip|video)$/i.test(base) && parts.length ? parts.pop() : base;
}
function posterOf(f, id, posters, clipCount) {
  const asFile = p => typeof p === "string" ? posters.find(x => x.src === p) || { src: p } : p && typeof p.src === "string" ? p : null;
  const dir = s => s.slice(0, s.lastIndexOf("/") + 1);
  const stem = s => s.slice(s.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "").replace(/[-_]?(mosaic|poster)$/i, "");
  return asFile(f.poster) || posters.find(p => p.clip === id || p.clip === f.src) ||
    posters.find(p => dir(p.src) === dir(f.src) && stem(p.src) === stem(f.src)) ||
    (clipCount === 1 && posters.length === 1 ? posters[0] : null);
}
function clipName(f, id) {
  if (typeof f.label === "string" && /[֐-׿]/.test(f.label)) return f.label;
  const named = ((state.index.names || {}).clips || {})[id];
  if (named) return named;
  const words = CLIP_WORDS.find(([re]) => re.test(id + " " + f.src));
  return words ? words[1] : "קליפ";
}

const heightName = h => `${HEIGHT_NAMES[round(h)] || "גובה"} ${degrees(h)}`;
const sideName = az => ANGLE_NAMES[round(norm(az))] || degrees(norm(az));

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
  index.subjects = index.subjects.filter(s => s && typeof s === "object" && typeof s.id === "string");
  for (const s of index.subjects) if (!Array.isArray(s.files)) s.files = [];
  state.index = index;
  if (!index.subjects.some(hasAnything)) return failed(PROBLEMS.empty());
  $("file-path").innerHTML = (Store.online ? `התמונות מהאתר ${ltr("testdrive-media")}` : `התמונות מהמחשב הזה (${ltr("GamePages/media")})`) +
    (index.madeAt ? `, עודכנו ב-${when(index.madeAt)}` : "");
  renderList();
  $("subjects").hidden = $("viewer").hidden = false;
  select(fromHash(), true);
  loadFeedback();
}

function failed(html) {
  stopStage();
  exitFull();
  state.index = state.subject = state.file = state.mode = null;
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
          ${listThumb(s)}
          <span class="item-names"><span class="item-he" dir="auto">${esc(s.label)}</span><span class="item-en" dir="auto">${esc(s.name || "")}</span></span>
          <span class="mark" data-mark=""></span>
        </button></li>`).join("")}
      </ul>
    </div>`).join("");
  $("subjects-toggle").innerHTML = `<span>כל הפריטים <span class="count">${state.index.subjects.length}</span></span><span class="chevron" aria-hidden="true">▾</span>`;
  markVerdicts();
}

// An item's small picture in the list: its first picture, else its front at the game camera's height, else its first
// clip's first camera.
function listThumb(s) {
  const p = partsOf(s);
  if (p.pictures.length) return thumb(p.pictures[0], "thumb");
  const side = p.turn && stillNear(p.turn, nearest(p.turn.heights, GAME_HEIGHT), false, 0);
  if (side) return thumb(side.f, "thumb");
  const c = p.clips.find(x => x.poster);
  return c ? tileThumb(c, "thumb") : `<span class="thumb"></span>`;
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
// A clip's poster, cut to its first camera's tile.
function tileThumb(c, cls) {
  const a = c.angles[c.order[0]], col = a.tile % c.cols, row = Math.floor(a.tile / c.cols);
  return `<span class="${cls} tile-thumb"><img src="${esc(url(c.poster))}" alt="" loading="lazy" style="width: ${c.cols * 100}%;` +
    ` height: ${c.rows * 100}%; left: ${-col * 100}%; top: ${-row * 100}%"></span>`;
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

// ---------- the item chosen ----------
function select(id, first = false) {
  const all = state.index.subjects;
  let s = all.find(x => x.id === id);
  if (s) showProblem(null);
  else {
    if (id) showProblem(`בגלריה אין פריט בשם ${ltr(id)}, אז מוצג הראשון ברשימה.`);
    s = all[0];
  }
  if (!first && s === state.subject) return;
  state.subject = s;
  if (fromHash() !== s.id) history.replaceState(null, "", "#" + s.id);
  document.title = `${s.label} · גלריה`;
  const p = partsOf(s), i = all.indexOf(s), n = p.pictures.length;
  $("subject-title").innerHTML = `<span dir="auto">${esc(s.label)}</span> <small class="subject-en" dir="auto">${esc(s.name || "")}</small>`;
  $("subject-meta").innerHTML = [esc(nameOf("groups", s.group)),
    p.turn ? (p.turn.heights.length > 1 ? `סיבוב מכל הצדדים, ב-${p.turn.heights.length} גבהים` : "סיבוב מכל הצדדים") : "",
    p.clips.length === 1 ? `קליפ: ${esc(p.clips[0].name)}` : p.clips.length ? `${p.clips.length} קליפים` : "",
    n === 1 ? "תמונה אחת" : n ? `${n} תמונות` : "",
    s.madeAt ? `צולם ב-${when(s.madeAt)}` : ""].filter(Boolean).join(" · ");
  $("subject-note").textContent = s.note || "";
  $("prev").disabled = i === 0;
  $("next").disabled = i === all.length - 1;
  renderModes(p);
  renderStrip(p.pictures, facets(p.pictures));
  markList();
  revealInList();
  closeNote();
  $("verdict-said").textContent = "";
  showVerdict();
  setMode(firstMode(p));
}

// How an item opens: as he chose to show the items before (turning, its pictures or a clip of the same name), else
// turning, else its pictures, else its first clip.
function firstMode(p) {
  const want = state.pick.mode, clip = p.clips.find(c => c.name === state.pick.clip) || p.clips[0];
  if (want === "clip" && clip) return "clip:" + clip.id;
  if (want === "picture" && p.pictures.length) return "picture";
  if (p.turn) return "turn";
  if (p.pictures.length) return "picture";
  return clip ? "clip:" + clip.id : null;
}

// The buttons above the stage: turning, each clip, the pictures (only when the item has two or more of these).
function renderModes(p) {
  const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const modes = [];
  if (p.turn) modes.push(["turn", icon("M12 5V2L8 6l4 4V7a5 5 0 1 1-5 5H5a7 7 0 1 0 7-7z") + "סיבוב מכל הצדדים"]);
  for (const c of p.clips) modes.push(["clip:" + c.id, icon("M8 5v14l11-7z") + `<span dir="auto">${esc(c.name)}</span>` +
    (c.duration ? ` <span class="mode-more">${seconds(c.duration)}</span>` : "")]);
  if (p.pictures.length) modes.push(["picture", icon("M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z") +
    (p.pictures.length === 1 ? "תמונה" : `תמונות <span class="mode-more">${p.pictures.length}</span>`)]);
  $("modes").hidden = modes.length < 2;
  $("modes").innerHTML = modes.map(([m, html]) => `<button type="button" class="mode" data-mode="${esc(m)}" aria-pressed="false">${html}</button>`).join("");
}

// Shows the item turning, one of its pictures (f, or the one most like the last picture shown) or one of its clips.
function setMode(mode, f = null) {
  stopStage();
  const p = partsOf(state.subject), clip = mode && mode.startsWith("clip:") ? p.clips.find(c => "clip:" + c.id === mode) : null;
  if (mode && mode.startsWith("clip:") && !clip) mode = firstMode(p);
  state.mode = mode;
  const kind = !mode ? "" : mode.startsWith("clip:") ? "clip" : mode;
  for (const b of $("modes").querySelectorAll("[data-mode]")) b.setAttribute("aria-pressed", String(b.dataset.mode === mode));
  $("stage").dataset.mode = kind;
  $("pic-view").hidden = kind !== "picture";
  $("turn").hidden = kind !== "turn";
  $("clip").hidden = kind !== "clip";
  $("stage-tools").hidden = kind !== "turn" && kind !== "clip";
  if (kind !== "picture") state.file = null;
  if (kind === "picture" || !kind) exitFull();
  if (!kind) {
    $("pic-view").querySelector(".shot")?.remove();
    $("caption").textContent = "אין עדיין תמונות לפריט הזה.";
    $("controls").innerHTML = "";
    return;
  }
  markStrip();
  if (kind === "picture") {
    renderPictureControls(facets(p.pictures));
    choose(f || bestFile(p.pictures, state.pick, KEEP));
  } else if (kind === "turn") openTurn(p.turn);
  else openClip(clip);
}

// Stops what the stage was doing: the turning, the zoom, the videos.
function stopStage() {
  stopTurning();
  turn.drag = null;
  turnZoom.reset(true);
  hideStill();
  closeClip();
  busy(false);
}

function busy(on) {
  $("stage-busy").hidden = !on;
  $("stage").classList.toggle("loading", on);
}

// A tap below the stage (a picture in the strip, a button) changes it. When it isn't wholly in sight under the header
// (the page was scrolled down), the page glides up to it, or the tap would seem to do nothing. art.css keeps it clear
// of the header (scroll-margin-top).
function revealStage() {
  if (isFull()) return;
  const stage = $("stage"), r = stage.getBoundingClientRect();
  if (r.top < header.getBoundingClientRect().bottom - 1 || r.bottom > innerHeight + 1)
    stage.scrollIntoView({ block: "nearest", behavior: calm.matches ? "auto" : "smooth" });
}

function step(d) {
  const all = state.index.subjects, s = all[all.indexOf(state.subject) + d];
  if (s) select(s.id);
}

// ---------- pictures (version 0's stills) ----------
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
  choose(bestFile(partsOf(state.subject).pictures, { ...state.pick, [k]: value }, [k, ...KEEP.filter(x => x !== k)]));
}

// Shows a picture of the item (switching the stage to its pictures first).
function showPicture(f) {
  if (state.mode !== "picture") setMode("picture", f);
  else choose(f);
}

function choose(f) {
  state.file = f;
  for (const k of FACETS) if (k in f) state.pick[k] = f[k];
  markPictureControls();
  markStrip();
  show(f);
}

// A picture in words, saying only what differs between the item's pictures: "מגרש גרוטאות · מלפנים · עם קווי פגיעה",
// or a scenery picture's caption.
function describe(f) {
  const values = facets(partsOf(state.subject).pictures), varies = k => values[k].length > 1;
  return [varies("look") && f.look && nameOf("looks", f.look), varies("view") && f.view && nameOf("views", f.view),
    f.hitbox ? "עם קווי פגיעה" : "", f.caption].filter(Boolean).join(" · ");
}

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

let asked = 0; // pictures asked for: one that loads after a newer one was asked for is dropped
async function show(f) {
  const n = ++asked, view = $("pic-view");
  $("stage").classList.add("loading");
  const el = await stillStage(f);
  if (n !== asked || state.file !== f) return;
  view.querySelector(".shot")?.remove();
  view.prepend(el);
  $("stage").classList.remove("loading");
  const words = describe(f);
  view.setAttribute("aria-label", `פתיחה בגודל מלא: ${state.subject.label}${words ? ", " + words : ""}`);
  $("caption").innerHTML = (words ? `<span dir="auto">${esc(words)}</span>` : "") +
    (f.focus ? `<span class="caption-more">${words ? " · " : ""}הפריט מסומן בעיגול לבן</span>` : "");
}

// The look and view buttons and the hitbox switch: only for what differs between the item's pictures.
function renderPictureControls(values) {
  const group = k => values[k].length < 2 ? "" : `
    <div class="control" role="group" aria-label="${LABELS[k]}" data-control="${k}">
      <span class="control-label" aria-hidden="true">${LABELS[k]}</span>
      ${values[k].map(v => `<button type="button" class="pill" data-facet="${k}" data-value="${esc(v)}" aria-pressed="false"` +
        ` dir="auto">${esc(nameOf(k === "look" ? "looks" : "views", v))}</button>`).join("")}
    </div>`;
  const hitbox = values.hitbox.includes(true) && values.hitbox.includes(false) ? hitboxSwitch() : "";
  $("controls").innerHTML = group("look") + group("view") + hitbox;
}
const hitboxSwitch = () => `<button type="button" class="pill hitbox" id="hitbox" aria-pressed="false"
  title="קווי הפגיעה: הצורות שהמשחק בודק כשמשהו פוגע">קווי פגיעה</button>`;

function markPictureControls() {
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
  const files = partsOf(state.subject).pictures;
  for (const b of $("strip").querySelectorAll("[data-file]"))
    b.setAttribute("aria-pressed", String(state.mode === "picture" && files[+b.dataset.file] === state.file));
}

// ---------- zooming and dragging on the stage (shared by turning and clips) ----------
// A layer (the picture or video) inside a view: fitted to the view at scale 1, up to `most` times bigger, kept with no
// gap at its edges once bigger than the view. changed(before, after) hears every change of scale.
class Zoomer {
  constructor(view, layer, changed) {
    Object.assign(this, { view, layer, changed, scale: 1, x: 0, y: 0, w: 0, h: 0, aspect: 1, most: STAGE_ZOOM_MOST });
  }
  room() { return { w: this.view.clientWidth, h: this.view.clientHeight }; }
  // Fits a layer of this width-to-height ratio; keep: the same zoom, round the middle (after the view changed size).
  fit(aspect = this.aspect, keep = false) {
    const r = this.room(), pad = r.w > 600 ? 12 : 6, w = Math.max(1, r.w - 2 * pad), h = Math.max(1, r.h - 2 * pad);
    const before = this.scale;
    this.aspect = aspect;
    [this.w, this.h] = w / h > aspect ? [h * aspect, h] : [w, w / aspect];
    this.scale = 1;
    this.apply();
    if (keep && before > 1) this.zoomAt(before, r.w / 2, r.h / 2, true);
    else if (before !== 1 && this.changed) this.changed(before, 1);
  }
  reset(quiet = false) {
    const before = this.scale;
    this.scale = 1;
    if (this.w) this.apply();
    if (!quiet && before !== 1 && this.changed) this.changed(before, 1);
    if (quiet) this.view.classList.remove("zoomed");
  }
  // Zooms to `scale` (times the fitted size), keeping the layer's point under (px, py) in the view where it is.
  zoomAt(scale, px, py, quiet = false) {
    if (!this.w) return;
    const s = Math.min(Math.max(scale, 1), this.most), before = this.scale;
    this.x = px - (px - this.x) * s / before;
    this.y = py - (py - this.y) * s / before;
    this.scale = s;
    this.apply();
    if (!quiet && this.changed && Math.abs(s - before) > 1e-9) this.changed(before, s);
  }
  zoomBy(k) { const r = this.room(); this.zoomAt(this.scale * k, r.w / 2, r.h / 2); }
  panTo(x, y) { this.x = x; this.y = y; this.apply(); }
  apply() {
    const r = this.room(), w = this.w * this.scale, h = this.h * this.scale;
    this.x = w <= r.w ? (r.w - w) / 2 : Math.min(0, Math.max(r.w - w, this.x));
    this.y = h <= r.h ? (r.h - h) / 2 : Math.min(0, Math.max(r.h - h, this.y));
    Object.assign(this.layer.style, { left: this.x + "px", top: this.y + "px", width: w + "px", height: h + "px" });
    this.view.classList.toggle("zoomed", this.scale > 1.001);
  }
}

// The fingers (or the mouse) on a view: a sideways drag (h.dragStart, dragMove, dragEnd) while it isn't zoomed in, a
// drag that moves it once it is, a pinch, a double tap (zoom in on that point, or back out), a tap (h.tap), and Ctrl
// with the wheel (or a touchpad pinch); the plain wheel zooms only while zoomed in, so the page still scrolls.
// h.beforeZoom() runs before zooming in from scale 1.
function gestures(view, z, h) {
  const g = { pointers: new Map(), start: null, tap: null, lastTap: null, mode: null };
  const at = e => { const r = view.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const zoomTo = (scale, p) => {
    if (scale > z.scale && z.scale <= 1.001 && h.beforeZoom && h.beforeZoom() === false) return;
    z.zoomAt(scale, p.x, p.y);
  };
  function begin() {
    const [a, b] = [...g.pointers.values()];
    if (b) {
      if (g.mode === "drag") h.dragEnd?.(true);
      if (g.mode !== "pinch" && z.scale <= 1.001 && h.beforeZoom && h.beforeZoom() === false) { g.mode = "none"; return; }
      g.mode = "pinch";
      g.start = { x: z.x, y: z.y, scale: z.scale, mid: middle(a, b), spread: Math.hypot(a.x - b.x, a.y - b.y) || 1 };
    } else if (a) {
      g.mode = z.scale > 1.001 ? "pan" : "drag";
      g.start = { x: z.x, y: z.y, p: a };
      if (g.mode === "drag") h.dragStart?.(a.x, performance.now());
    }
  }
  view.addEventListener("pointerdown", e => {
    if ((e.pointerType === "mouse" && e.button !== 0) || e.target.closest("button, input, a")) return;
    try { view.setPointerCapture(e.pointerId); } catch { /* a pointer the browser isn't tracking */ }
    g.pointers.set(e.pointerId, at(e));
    g.tap = g.pointers.size === 1 ? { ...at(e), time: e.timeStamp, id: e.pointerId } : null;
    if (g.pointers.size <= 2) begin();
    view.classList.add("dragging");
  });
  view.addEventListener("pointermove", e => {
    if (!g.pointers.has(e.pointerId)) return;
    g.pointers.set(e.pointerId, at(e));
    const [a, b] = [...g.pointers.values()], s = g.start;
    if (g.tap && Math.hypot(a.x - g.tap.x, a.y - g.tap.y) > TAP_PX) g.tap = null; // a drag, not a tap
    if (g.mode === "pinch" && b) {
      const mid = middle(a, b), sc = Math.min(Math.max(s.scale * Math.hypot(a.x - b.x, a.y - b.y) / s.spread, 1), z.most);
      const before = z.scale;
      z.x = mid.x - (s.mid.x - s.x) * sc / s.scale;
      z.y = mid.y - (s.mid.y - s.y) * sc / s.scale;
      z.scale = sc;
      z.apply();
      if (z.changed && sc !== before) z.changed(before, sc);
    } else if (g.mode === "pan") z.panTo(s.x + a.x - s.p.x, s.y + a.y - s.p.y);
    else if (g.mode === "drag") h.dragMove?.(a.x, performance.now());
  });
  const up = e => {
    if (!g.pointers.delete(e.pointerId)) return;
    const t = g.tap, left = g.pointers.size;
    if (g.mode === "drag" && !left) h.dragEnd?.(e.type === "pointercancel");
    if (g.mode === "pinch" && left < 2) {
      g.mode = null;
      h.pinchEnd?.();
    }
    if (e.type === "pointerup" && t && t.id === e.pointerId && e.timeStamp - t.time < TAP_MS && !left) {
      const last = g.lastTap;
      h.tap?.(t.x, t.y);
      if (last && t.time - last.time < DOUBLE_TAP_MS && Math.hypot(t.x - last.x, t.y - last.y) < 40) {
        g.lastTap = null;
        if (z.scale > 1.05) z.zoomAt(1, t.x, t.y);
        else zoomTo(2, t);
      } else g.lastTap = t;
    }
    g.tap = null;
    if (left === 1) { // the other finger of a pinch stays: it moves the picture (when zoomed in), it doesn't turn it
      const [a] = [...g.pointers.values()];
      g.mode = z.scale > 1.001 ? "pan" : "none";
      g.start = { x: z.x, y: z.y, p: a };
    } else if (!left) {
      g.mode = null;
      view.classList.remove("dragging");
    }
  };
  view.addEventListener("pointerup", up);
  view.addEventListener("pointercancel", up);
  view.addEventListener("wheel", e => {
    if (!e.ctrlKey && z.scale <= 1.001) return; // the page scrolls
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * 800 : e.deltaY;
    zoomTo(z.scale * Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)), at(e));
  }, { passive: false });
  return { zoomTo: k => zoomTo(z.scale * k, { x: z.room().w / 2, y: z.room().h / 2 }), pinching: () => g.mode === "pinch" };
}

// ---------- turning ----------
const turn = {
  t: null,          // the item's turntables (partsOf(s).turn)
  height: GAME_HEIGHT, hitbox: false,
  az: 0,            // degrees round the item; while dragging it isn't a whole frame yet
  low: GAME_HEIGHT, // the height before "מלמעלה", for the side buttons to come back to
  drawn: "",        // what the canvas shows: "<sheet src>#<frame>"
  cache: new Map(), // the item's sheets: src -> { img, state: loading|loaded|decoding|ready|failed, wanted }
  anim: 0, drag: null, still: null, preloading: null, dragged: false,
};
const canvas = $("turn-canvas"), sideStill = $("turn-still");
const turnZoom = new Zoomer($("turn"), $("turn-layer"), turnZoomed);
const turnGestures = gestures($("turn"), turnZoom, {
  dragStart(x, time) {
    stopTurning();
    turn.drag = { x0: x, az0: turn.az, samples: [{ x, time }] };
  },
  dragMove(x, time) {
    const d = turn.drag;
    if (!d) return;
    turn.az = d.az0 + (x - d.x0) * 360 / (TURNS_PER_STAGE_WIDTH * Math.max(280, $("turn").clientWidth));
    d.samples.push({ x, time });
    while (d.samples.length > 2 && time - d.samples[0].time > 100) d.samples.shift();
    if (!turn.dragged && Math.abs(x - d.x0) > TAP_PX) $("turn-hint").classList.add("gone");
    turn.dragged ||= Math.abs(x - d.x0) > TAP_PX;
    drawTurn();
  },
  dragEnd(cancelled) {
    const d = turn.drag;
    turn.drag = null;
    if (!d) return;
    // The speed over the last tenth of a second (none when the finger had stopped before letting go).
    const a = d.samples[0], b = d.samples[d.samples.length - 1], dt = b.time - a.time;
    const v = dt >= 12 && performance.now() - b.time < 80 ? (b.x - a.x) / dt * 360 / (TURNS_PER_STAGE_WIDTH * Math.max(280, $("turn").clientWidth)) : 0;
    if (!cancelled && !calm.matches && Math.abs(v) > FLING_AT_LEAST) fling(Math.sign(v) * Math.min(Math.abs(v), FLING_AT_MOST));
    else settleTurn();
  },
  beforeZoom: () => { stopTurning(); settleTurn(); },
});

function openTurn(t) {
  if (turn.t !== t) {
    dropSheets();
    turn.t = t;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  }
  const low = t.heights.filter(h => h !== t.top);
  turn.height = nearest(t.heights, num(state.pick.height, GAME_HEIGHT));
  turn.low = low.length ? nearest(low, turn.height === t.top ? turn.low : turn.height) : turn.height;
  turn.hitbox = t.lines && (state.pick.hitbox === true || !t.plain);
  turn.az = norm(Math.round(num(state.pick.az, 0) / setOf(t, turn.height, turn.hitbox).step) * setOf(t, turn.height, turn.hitbox).step);
  turn.drawn = "";
  $("turn").setAttribute("role", "slider");
  $("turn").setAttribute("aria-valuemin", "0");
  $("turn").setAttribute("aria-valuemax", "359");
  renderTurnControls();
  layoutTurn();
}

// Forgets the last item's sheets (stopping those still loading).
function dropSheets() {
  for (const e of turn.cache.values()) if (e.state === "loading") e.img.src = "";
  turn.cache = new Map();
  turn.preloading = null;
}

// A sheet of the item: loading it (preloading), and decoding it when it's needed now (wanted).
function sheet(f, wanted) {
  let e = turn.cache.get(f.src);
  if (!e) {
    const img = new Image();
    e = { img, state: "loading", wanted: false };
    e.loaded = new Promise(resolve => {
      img.onload = () => { e.state = "loaded"; if (e.wanted) decodeSheet(e); resolve(true); };
      img.onerror = () => { e.state = "failed"; if (e.wanted) drawTurn(); resolve(false); };
    });
    img.src = url(f);
    turn.cache.set(f.src, e);
  }
  if (wanted && !e.wanted) {
    e.wanted = true;
    if (e.state === "loaded") decodeSheet(e);
  }
  return e;
}
function decodeSheet(e) {
  e.state = "decoding";
  e.img.decode().catch(() => {}).then(() => {
    e.state = "ready";
    if ([...turn.cache.values()].includes(e)) drawTurn();
  });
}

const currentSet = () => turn.t && setOf(turn.t, turn.height, turn.hitbox);
// The side shown (degrees): the sharp still's while zoomed into one (they are every 45 degrees), else the frame's.
const shownSide = () => turn.still && !turn.still.none ? turn.still.az : norm(round(frameAt(currentSet(), turn.az) * currentSet().step, 3));

// Fits the frame in the stage and sizes the canvas (never more pixels than the frame has), then draws.
function layoutTurn() {
  const set = currentSet();
  if (!set || state.mode !== "turn") return;
  turnZoom.fit(set.fw / set.fh, true);
  const dpr = devicePixelRatio || 1, w = Math.max(1, Math.round(Math.min(turnZoom.w * dpr, set.fw))), h = Math.max(1, Math.round(w * set.fh / set.fw));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    turn.drawn = "";
  }
  drawTurn();
}

// Draws the frame for turn.az from its sheet (the frame before stays until the sheet is ready).
function drawTurn() {
  const set = currentSet();
  if (!set || state.mode !== "turn") return;
  const k = frameAt(set, turn.az), part = partAt(set, k);
  const e = part && sheet(part.f, true);
  if (!e || e.state === "failed") {
    busy(false);
    $("caption").textContent = "התמונות של הסיבוב לא נטענו. נסה לרענן את הדף.";
    return;
  }
  if (e.state !== "ready") return busy(true);
  busy(false);
  const key = part.f.src + "#" + k;
  if (turn.drawn !== key) {
    const local = k - part.start, cols = part.f.cols;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(e.img, (local % cols) * set.fw, Math.floor(local / cols) * set.fh, set.fw, set.fh, 0, 0, canvas.width, canvas.height);
    turn.drawn = key;
    Object.assign(canvas.dataset, { frame: k, azimuth: round(k * set.step, 3), height: set.height, hitbox: set.hitbox, sheet: part.f.src });
    turnWords();
  }
  if (!turn.preloading) turn.preloading = preloadTurn(turn.t);
}

// After the first frame shows: the rest of its sheets (decoded: turning needs them), then the other sheets of the item
// (loaded only: decoded when chosen), its other pass first, then the nearest heights.
async function preloadTurn(t) {
  const cur = currentSet();
  for (const p of cur.parts) sheet(p.f, true);
  const rest = [...t.sets.values()].filter(s => s !== cur)
    .sort((a, b) => Math.abs(a.height - cur.height) - Math.abs(b.height - cur.height));
  for (const s of rest) for (const p of s.parts) {
    if (turn.t !== t) return;
    await sheet(p.f, false).loaded;
  }
}

// A fling: the item keeps turning, slower and slower, then stops on a whole frame.
function fling(v) {
  let last = performance.now();
  const go = now => {
    const dt = Math.min(50, now - last);
    last = now;
    turn.az += v * dt;
    v *= Math.exp(-dt / FLING_FADE_MS);
    drawTurn();
    if (Math.abs(v) > 0.01) turn.anim = requestAnimationFrame(go);
    else {
      turn.anim = 0;
      settleTurn();
    }
  };
  turn.anim = requestAnimationFrame(go);
}

function stopTurning() {
  cancelAnimationFrame(turn.anim);
  turn.anim = 0;
}

// Stops on the nearest whole frame.
function settleTurn() {
  const set = currentSet();
  if (!set) return;
  turn.az = norm(Math.round(turn.az / set.step) * set.step);
  state.pick.az = turn.az;
  drawTurn();
  turnWords();
}

// Turns the item to azimuth `to` along the shortest way, frame by frame (or at once, for less motion).
function glideTo(to) {
  stopTurning();
  const from = turn.az, delta = toward(from, to), t0 = performance.now(), ms = GLIDE_MS * (0.4 + Math.abs(delta) / 300);
  if (calm.matches || Math.abs(delta) < 0.5) {
    turn.az = to;
    return settleTurn();
  }
  const go = now => {
    const k = Math.min(1, (now - t0) / ms);
    turn.az = from + delta * (1 - (1 - k) ** 3);
    drawTurn();
    if (k < 1) turn.anim = requestAnimationFrame(go);
    else {
      turn.anim = 0;
      turn.az = to;
      settleTurn();
    }
  };
  turn.anim = requestAnimationFrame(go);
}

function stepTurn(d) {
  const set = currentSet();
  if (!set) return;
  turnZoom.reset();
  stopTurning();
  turn.az = norm(Math.round(turn.az / set.step + d) * set.step);
  settleTurn();
}

// The side buttons: front, back, left or right (from "מלמעלה" they come back down to the height before).
function sideTo(az) {
  turnZoom.reset();
  if (turn.height === turn.t.top) setHeight(turn.low);
  glideTo(az);
}
function topView() {
  setHeight(turn.t.top);
}
function setHeight(h) {
  turnZoom.reset();
  turn.height = h;
  if (h !== turn.t.top) turn.low = h;
  state.pick.height = h;
  turn.drawn = "";
  turn.preloading = null;
  markTurnControls();
  layoutTurn(); // (each height has its own framing, so maybe another shape)
}
// The hitbox switch swaps the sheets in place: the same side, the same height (and the same zoom).
function toggleTurnLines() {
  turn.hitbox = !turn.hitbox;
  state.pick.hitbox = turn.hitbox;
  turn.drawn = "";
  turn.preloading = null;
  if (turn.still) { hideStill(); showStill(); }
  drawTurn();
  markTurnControls();
  turnWords();
}

// Zooming in shows the sharp picture of the nearest side (turning there first); back at scale 1 the turntable again.
function turnZoomed(before, after) {
  if (after > 1.001 && !turn.still) showStill();
  else if (after <= 1.001 && turn.still) {
    hideStill();
    settleTurn(); // (a still's side may lie between two frames: the nearest frame)
  }
  $("stage-zoom-level").textContent = zoomWords(after);
  turnWords();
}
function showStill() {
  const st = stillNear(turn.t, turn.height, turn.hitbox, turn.az);
  turn.still = st || { none: true }; // none: the turntable's own frame, enlarged
  if (!st) return;
  if (gap(st.az, turn.az) > 0.01) {
    stopTurning();
    turn.az = st.az;
    state.pick.az = st.az;
    drawTurn();
  }
  const want = url(st.f);
  if (sideStill.dataset.src !== want) {
    sideStill.hidden = true;
    sideStill.dataset.src = want;
    sideStill.src = want;
  }
  sideStill.decode().then(() => { if (turn.still === st) sideStill.hidden = false; }, () => {});
}
function hideStill() {
  turn.still = null;
  sideStill.hidden = true;
}

const zoomWords = s => "×" + String(round(s, 1));

// The turning's words: the caption, the slider's value, which buttons are pressed.
function turnWords() {
  if (state.mode !== "turn" || !turn.t) return;
  const set = currentSet(), az = shownSide(), lines = turn.hitbox ? " · עם קווי פגיעה" : "";
  const zoomed = turnZoom.scale > 1.001 ? ` · מוגדל ${zoomWords(turnZoom.scale)}${turn.still && !turn.still.none ? " (התמונה החדה של הצד הזה)" : ""}` : "";
  const words = `${heightName(set.height)} · ${ANGLE_NAMES[round(az)] ? `${ANGLE_NAMES[round(az)]} (${degrees(az)})` : degrees(az)}${lines}${zoomed}`;
  $("caption").innerHTML = `<span dir="auto">${esc(words)}</span>`;
  const t = $("turn");
  t.setAttribute("aria-valuenow", String(round(az)));
  t.setAttribute("aria-valuetext", words);
  t.setAttribute("aria-label", `סיבוב: ${state.subject.label}. גרירה הצידה או החצים במקלדת מסובבים.`);
  $("stage-zoom-level").textContent = zoomWords(turnZoom.scale);
  markTurnControls();
}

function renderTurnControls() {
  const t = turn.t, pill = (attr, words, title = "") => `<button type="button" class="pill" ${attr} aria-pressed="false"${title ? ` title="${title}"` : ""}>${words}</button>`;
  $("controls").innerHTML = `
    <div class="control" role="group" aria-label="צד" data-control="side">
      <span class="control-label" aria-hidden="true">צד</span>
      ${SIDES.map(s => pill(`data-side="${s.az}"`, s.name, `המצלמה ${s.name}`)).join("")}
      ${t.top !== null ? pill("data-top", "מלמעלה", `המצלמה מלמעלה (${degrees(t.top)})`) : ""}
    </div>
    ${t.heights.length > 1 ? `<div class="control" role="group" aria-label="גובה המצלמה" data-control="height">
      <span class="control-label" aria-hidden="true">גובה המצלמה</span>
      ${t.heights.map(h => pill(`data-height="${h}"`, esc(heightName(h)))).join("")}
    </div>` : ""}
    ${t.plain && t.lines ? hitboxSwitch() : ""}
    <p class="how"><span class="for-mouse">גרירה הצידה: סיבוב · לחיצה כפולה, <kbd>+</kbd> או <kbd>Ctrl</kbd> וגלגלת: הגדלה ·
      החצים במקלדת: צעד</span><span class="for-touch">החלקה הצידה: סיבוב · צביטה או הקשה כפולה: הגדלה</span></p>`;
  markTurnControls();
}
function markTurnControls() {
  if (state.mode !== "turn" || !turn.t) return;
  const az = shownSide(), top = turn.height === turn.t.top;
  for (const b of $("controls").querySelectorAll("[data-side]")) b.setAttribute("aria-pressed", String(!top && gap(+b.dataset.side, az) < 0.01));
  $("controls").querySelector("[data-top]")?.setAttribute("aria-pressed", String(top));
  for (const b of $("controls").querySelectorAll("[data-height]")) b.setAttribute("aria-pressed", String(+b.dataset.height === turn.height));
  $("hitbox")?.setAttribute("aria-pressed", String(turn.hitbox));
}

// ---------- clips ----------
const mosaic = $("clip-mosaic"), cameraVideo = $("clip-angle"), poster = $("clip-poster");
const prefs = { rate: 1, loop: true }; // the speed and loop stay from clip to clip
const clip = {
  c: null,          // the clip shown (clipsOf)
  angle: 0,         // its camera: an index into c.angles
  wide: false,      // showing the camera's own video (zoomed in, or full screen) instead of the mosaic's tile
  ready: false,     // ...and that video is at the right moment
  ask: 0,           // the camera video asked for last (one that answers late is dropped)
  wideTime: 0, wantPlay: false, drag: null, raf: 0,
  started: false,   // played, stepped or scrubbed once (then the big play button no longer covers the picture)
  words: ["", ""],  // the caption's words that don't change as it plays
};
const clipZoom = new Zoomer($("clip"), $("clip-wide"), clipZoomed);
const clipGestures = gestures($("clip"), clipZoom, {
  dragStart(x) { clip.drag = { x0: x, at: clip.c.order.indexOf(clip.angle) }; },
  dragMove(x) {
    const d = clip.drag;
    if (!d) return;
    const n = clip.c.order.length, steps = Math.trunc((x - d.x0) / ANGLE_DRAG_PX);
    setAngle(clip.c.order[(((d.at + steps) % n) + n) % n]);
  },
  dragEnd() { clip.drag = null; },
  tap: () => togglePlay(),
  beforeZoom: () => enterWide(),
  pinchEnd: () => { if (clipZoom.scale <= 1.001 && !isFull()) leaveWide(); },
});
const act = () => clip.wide ? cameraVideo : mosaic; // the video that plays now

function openClip(c) {
  clip.c = c;
  const want = num(state.pick.clipAz, 0);
  clip.angle = c.angles.reduce((best, a, i) => gap(a.azimuth, want) < gap(c.angles[best].azimuth, want) ? i : best, c.order[0]);
  state.pick.clip = c.name;
  clip.wideTime = 0;
  clip.wantPlay = clip.started = false;
  mosaic.defaultPlaybackRate = mosaic.playbackRate = prefs.rate;
  mosaic.loop = prefs.loop;
  mosaic.preload = "none";
  if (c.poster) {
    poster.hidden = false;
    poster.src = url(c.poster);
  } else {
    poster.hidden = true;
    poster.removeAttribute("src");
  }
  $("clip").setAttribute("role", "group");
  $("clip").setAttribute("aria-label", `${c.name}: ${state.subject.label}`);
  renderClipControls();
  layoutClip();
  placeTile();
  clipWords();
}

// Puts the stage's videos away (they stop loading).
function closeClip() {
  cancelAnimationFrame(clip.raf);
  clip.ask++;
  clip.wide = clip.ready = false;
  clip.drag = null;
  for (const v of [mosaic, cameraVideo]) {
    v.pause();
    if (v.hasAttribute("src")) { v.removeAttribute("src"); v.load(); }
  }
  $("clip-wide").hidden = true;
  $("clip-wide").classList.remove("loading");
  $("clip").classList.remove("camera-on");
  clipZoom.reset(true);
}

// The mosaic, loaded the first time it is played, stepped or scrubbed (until then only the poster).
function ensureMosaic() {
  clip.started = true;
  if (mosaic.hasAttribute("src")) return;
  mosaic.preload = "auto";
  mosaic.defaultPlaybackRate = prefs.rate;
  mosaic.loop = prefs.loop;
  mosaic.src = url(clip.c.f);
  mosaic.playbackRate = prefs.rate;
}

// The stage's box for the tile (fitted, its shape) and for the camera's own video (the zoomer's).
function layoutClip() {
  const c = clip.c;
  if (!c || state.mode !== "clip:" + c.id) return;
  const view = $("clip"), r = { w: view.clientWidth, h: view.clientHeight }, pad = r.w > 600 ? 12 : 6;
  const aspect = c.tileW / c.tileH, w = Math.max(1, r.w - 2 * pad), h = Math.max(1, r.h - 2 * pad);
  const [bw, bh] = w / h > aspect ? [h * aspect, h] : [w, w / aspect];
  Object.assign($("clip-tile").style, { left: (r.w - bw) / 2 + "px", top: (r.h - bh) / 2 + "px", width: bw + "px", height: bh + "px" });
  const a = c.angles[clip.angle];
  clipZoom.fit(a.w / a.h, true);
}

// The mosaic (and its poster) moved so the chosen camera's tile fills the box: instant, no seeking.
function placeTile() {
  const c = clip.c, a = c.angles[clip.angle], col = a.tile % c.cols, row = Math.floor(a.tile / c.cols);
  for (const el of [mosaic, poster])
    Object.assign(el.style, { width: c.cols * 100 + "%", height: c.rows * 100 + "%", left: -col * 100 + "%", top: -row * 100 + "%" });
  $("clip-tile").dataset.tile = a.tile;
}

function setAngle(i) {
  const c = clip.c;
  if (!c || i === clip.angle || !c.angles[i]) return;
  clip.angle = i;
  state.pick.clipAz = c.angles[i].azimuth;
  placeTile();
  if (clip.wide) loadCamera(clipTime(), clip.ready ? !cameraVideo.paused : clip.wantPlay);
  clipWords();
}
function stepAngle(d) {
  const o = clip.c.order, n = o.length;
  setAngle(o[(((o.indexOf(clip.angle) + d) % n) + n) % n]);
}

// The clip's time now (seconds): the playing video's, or where the camera's own video is going.
function clipTime() {
  if (clip.wide) return clip.ready ? cameraVideo.currentTime : clip.wideTime;
  return mosaic.hasAttribute("src") ? mosaic.currentTime : 0;
}
const clipDuration = () => clip.c.duration || act().duration || 0;
const playing = () => clip.wide && !clip.ready ? clip.wantPlay : !act().paused && !act().ended;

// Zoom or full screen: the camera's own video (1280 x 720), at the same moment as the mosaic. False when there is none.
function enterWide() {
  if (clip.wide) return true;
  const c = clip.c, a = c && c.angles[clip.angle];
  if (!a || !c.angles.some(x => x.src)) return false;
  const t = clipTime(), was = playing();
  clip.started = true;
  mosaic.pause();
  clip.wide = true;
  $("clip-wide").hidden = false;
  clipZoom.fit(a.w / a.h);
  loadCamera(t, was);
  clipWords();
  return true;
}
// Loads the chosen camera's video at time t (playing if it should), the mosaic's tile showing until it's ready.
function loadCamera(t, play) {
  const c = clip.c, a = c.angles[clip.angle], v = cameraVideo, n = ++clip.ask;
  clip.ready = false;
  clip.wideTime = t;
  clip.wantPlay = play;
  v.pause();
  $("clip-wide").classList.add("loading");
  $("clip").classList.remove("camera-on");
  if (!a.src) { // no video for this camera: its tile, enlarged
    v.removeAttribute("src");
    v.load();
    return;
  }
  const src = Store.media(a.src, a.v);
  if (v.getAttribute("src") !== src) {
    v.defaultPlaybackRate = prefs.rate;
    v.loop = prefs.loop;
    v.src = src;
  }
  v.playbackRate = prefs.rate;
  const check = () => {
    if (n !== clip.ask) return stop();
    const at = isFinite(v.duration) ? Math.min(t, Math.max(0, v.duration - 0.5 / c.fps)) : t; // (a camera's video may be a frame shorter)
    if (v.readyState >= 1 && !v.seeking && Math.abs(v.currentTime - at) > 0.4 / c.fps) v.currentTime = at;
    else if (v.readyState >= 2 && !v.seeking) {
      stop();
      clip.ready = true;
      $("clip-wide").classList.remove("loading");
      $("clip").classList.add("camera-on");
      v.playbackRate = prefs.rate;
      if (clip.wantPlay) v.play().catch(() => {});
      clipWords();
    }
  };
  const events = ["loadedmetadata", "loadeddata", "seeked", "canplay"];
  const stop = () => events.forEach(e => v.removeEventListener(e, check));
  events.forEach(e => v.addEventListener(e, check));
  check();
}
// Back to the mosaic's tile, at the camera video's moment.
function leaveWide() {
  if (!clip.wide) return;
  const t = clipTime(), was = playing();
  clip.ask++;
  clip.wide = clip.ready = false;
  cameraVideo.pause();
  cameraVideo.removeAttribute("src");
  cameraVideo.load();
  $("clip-wide").hidden = true;
  $("clip-wide").classList.remove("loading");
  $("clip").classList.remove("camera-on");
  clipZoom.reset(true);
  if (t > 0 || was) {
    ensureMosaic();
    setTime(mosaic, t);
    if (was) mosaic.play().catch(() => {});
  }
  clipWords();
}
function clipZoomed(before, after) {
  if (after <= 1.001 && before > 1.001 && !isFull() && !clipGestures.pinching()) leaveWide();
  clipWords();
}
function clipZoomBy(k) {
  if (k > 1 && !clip.wide && !enterWide()) return;
  if (k < 1 && clipZoom.scale <= 1.001) { if (!isFull()) leaveWide(); return; }
  clipZoom.zoomBy(k);
}

function togglePlay() {
  if (!clip.c) return;
  if (clip.wide && !clip.ready) {
    clip.wantPlay = !clip.wantPlay;
    return clipWords();
  }
  if (!clip.wide) ensureMosaic();
  const v = act();
  if (v.paused || v.ended) {
    if (v.ended || (!v.loop && clipDuration() && v.currentTime >= clipDuration() - 0.5 / clip.c.fps)) v.currentTime = 0;
    v.play().catch(() => {});
  } else v.pause();
  clipWords();
}

// One frame back or forward (paused). A frame n is shown from n/fps on: the page seeks to its middle, (n + 0.5)/fps.
function stepFrame(d) {
  const c = clip.c;
  if (!clip.wide) ensureMosaic();
  else if (!clip.ready) clip.wantPlay = false;
  const v = act();
  v.pause();
  const last = Math.max(0, Math.round(clipDuration() * c.fps) - 1);
  const n = Math.min(last, Math.max(0, Math.floor(clipTime() * c.fps + 1e-6) + d));
  seek((n + 0.5) / c.fps);
}
function seek(t) {
  if (clip.wide && !clip.ready) return loadCamera(t, clip.wantPlay);
  if (!clip.wide) ensureMosaic();
  setTime(act(), t);
  clipWords();
}
// Moves a video to time t, once it knows its length (Safari ignores a time set before that).
function setTime(v, t) {
  if (v.readyState >= 1) v.currentTime = t;
  else v.addEventListener("loadedmetadata", () => { v.currentTime = t; clipWords(); }, { once: true });
}
function setRate(r) {
  prefs.rate = r;
  for (const v of [mosaic, cameraVideo]) { v.defaultPlaybackRate = r; v.playbackRate = r; }
  clipWords();
}
function toggleLoop() {
  prefs.loop = !prefs.loop;
  mosaic.loop = cameraVideo.loop = prefs.loop;
  clipWords();
}

function renderClipControls() {
  const c = clip.c, icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const pos = a => { const r = a.azimuth * Math.PI / 180; return `--x: ${round(-Math.sin(r), 3)}; --y: ${round(Math.cos(r), 3)}`; };
  $("controls").innerHTML = `
    <div class="transport" dir="ltr">
      <button type="button" class="tool" data-act="back" aria-label="פריים אחורה" title="פריים אחורה (,)">${icon("M6 6h2v12H6zm3.5 6 8.5 6V6z")}</button>
      <button type="button" class="tool play" data-act="play" id="play" aria-label="הפעלה" title="הפעלה (רווח)">${icon("M8 5v14l11-7z")}</button>
      <button type="button" class="tool" data-act="forward" aria-label="פריים קדימה" title="פריים קדימה (.)">${icon("M16 6h2v12h-2zM6 18l8.5-6L6 6z")}</button>
      <input type="range" class="timebar" id="timebar" min="0" max="${clipDurationOf(c)}" step="${round(1 / c.fps, 6)}" value="0" aria-label="הזמן בקליפ">
      <output class="clock" id="clock"></output>
    </div>
    <div class="control" role="group" aria-label="מהירות" data-control="speed">
      <span class="control-label" aria-hidden="true">מהירות</span>
      ${c.speeds.map(s => `<button type="button" class="pill" data-speed="${s}" aria-pressed="false" title="${s === 1 ? "מהירות רגילה" : `הילוך איטי: פי ${1 / s} לאט`}">×${s}</button>`).join("")}
    </div>
    <button type="button" class="pill loop" id="loop" aria-pressed="false" title="בסוף הקליפ מתחילים מההתחלה">${icon("M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z")}לולאה</button>
    ${c.angles.length > 1 ? `<div class="control camera" role="group" aria-label="מצלמה" data-control="camera">
      <span class="control-label" aria-hidden="true">מצלמה</span>
      <div class="compass">
        <span class="compass-body" aria-hidden="true"></span>
        ${c.angles.map((a, i) => `<button type="button" class="compass-dot" data-angle="${i}" style="${pos(a)}" aria-pressed="false"` +
          ` aria-label="${esc(sideName(a.azimuth))}" title="${esc(sideName(a.azimuth))}"></button>`).join("")}
      </div>
      <span class="camera-name" id="camera-name"></span>
    </div>` : ""}
    <p class="how"><span class="for-mouse">לחיצה על הסרטון או רווח: הפעלה ועצירה · <kbd>,</kbd> <kbd>.</kbd>: פריים · גרירה הצידה: מצלמה
      אחרת · לחיצה כפולה או <kbd>+</kbd>: הגדלה</span><span class="for-touch">הקשה: הפעלה ועצירה · החלקה הצידה: מצלמה אחרת ·
      צביטה או הקשה כפולה: הגדלה</span></p>`;
}
const clipDurationOf = c => round(c.duration || 0, 6) || 1;

// The clip's words and buttons: which buttons are pressed, the play button, then clipTick's words.
function clipWords() {
  const c = clip.c;
  if (!c || state.mode !== "clip:" + c.id) return;
  const on = playing(), play = $("play");
  if (play) {
    play.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${on ? "M6 5h4v14H6zm8 0h4v14h-4z" : "M8 5v14l11-7z"}"/></svg>`;
    play.setAttribute("aria-label", on ? "השהיה" : "הפעלה");
    play.title = on ? "השהיה (רווח)" : "הפעלה (רווח)";
  }
  for (const b of $("controls").querySelectorAll("[data-speed]")) b.setAttribute("aria-pressed", String(+b.dataset.speed === prefs.rate));
  $("loop")?.setAttribute("aria-pressed", String(prefs.loop));
  for (const b of $("controls").querySelectorAll("[data-angle]")) b.setAttribute("aria-pressed", String(+b.dataset.angle === clip.angle));
  const camera = sideName(c.angles[clip.angle].azimuth);
  if ($("camera-name")) $("camera-name").textContent = camera;
  $("big-play").hidden = on || clip.started;
  const zoomed = clip.wide ? ` · ${clip.ready ? "הווידאו של המצלמה הזו" : "טוען את הווידאו של המצלמה הזו…"}` +
    (clipZoom.scale > 1.001 ? ` ${zoomWords(clipZoom.scale)}` : "") : "";
  clip.words = [`${c.name} · מצלמה ${camera} · ${prefs.rate === 1 ? "מהירות רגילה" : `הילוך איטי ×${prefs.rate}`}`, zoomed];
  $("stage-zoom-level").textContent = zoomWords(clip.wide ? clipZoom.scale : 1);
  clipTick();
}
// What changes as it plays (every frame of the screen while it does): the time bar, the clock, the frame number.
function clipTick() {
  cancelAnimationFrame(clip.raf);
  const c = clip.c;
  if (!c || state.mode !== "clip:" + c.id) return;
  const t = clipTime(), d = clipDuration(), on = playing(), frame = Math.floor(t * c.fps + 1e-6);
  const bar = $("timebar");
  if (bar) {
    if (d && +bar.max !== round(d, 6)) bar.max = round(d, 6);
    if (document.activeElement !== bar || on) bar.value = String(t);
  }
  const clock = $("clock");
  if (clock) clock.textContent = `${t.toFixed(2)} / ${d.toFixed(2)}`;
  $("caption").textContent = `${clip.words[0]} · פריים ${frame + 1} מתוך ${Math.max(1, Math.round(d * c.fps))}${clip.words[1]}`;
  if (on) clip.raf = requestAnimationFrame(clipTick);
}

for (const v of [mosaic, cameraVideo])
  for (const type of ["play", "pause", "ended", "seeked", "ratechange", "loadedmetadata"])
    v.addEventListener(type, () => { if (v === act()) clipWords(); });
mosaic.addEventListener("loadeddata", () => { poster.hidden = true; });
mosaic.addEventListener("error", () => {
  if (clip.c && mosaic.hasAttribute("src")) $("caption").textContent = "הקליפ לא נטען. נסה לרענן את הדף.";
});

// ---------- full screen: the stage, its words and its buttons fill the screen ----------
const isFull = () => $("theatre").classList.contains("full");
function enterFull() {
  if (isFull() || !state.mode || state.mode === "picture") return;
  $("theatre").classList.add("full");
  document.documentElement.classList.add("theatre-open");
  $("theatre-close").hidden = false;
  $("stage-full").setAttribute("aria-label", "יציאה ממסך מלא");
  $("stage-full").title = "יציאה ממסך מלא";
  try { $("theatre").requestFullscreen?.().catch(() => {}); } catch { /* the window is enough */ }
  if (state.mode.startsWith("clip:")) enterWide();
  relayout();
}
function exitFull() {
  if (!isFull()) return;
  $("theatre").classList.remove("full");
  document.documentElement.classList.remove("theatre-open");
  $("theatre-close").hidden = true;
  $("stage-full").setAttribute("aria-label", "מסך מלא");
  $("stage-full").title = "מסך מלא";
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  if (state.mode && state.mode.startsWith("clip:") && clipZoom.scale <= 1.001) leaveWide();
  relayout();
}
document.addEventListener("fullscreenchange", () => { if (!document.fullscreenElement && isFull()) exitFull(); });

function relayout() {
  if (state.mode === "turn") layoutTurn();
  else if (state.mode && state.mode.startsWith("clip:")) layoutClip();
}

// ---------- Approve or Change... ----------
// His newest Approve / Change for an item (feedback.json), or null.
function newestFeedback(id) {
  let newest = null;
  for (const f of state.feedback || []) if (f && f.subject === id && (!newest || String(f.at) >= String(newest.at))) newest = f;
  return newest;
}
const day = iso => { const m = /^\d{4}-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(iso || ""); return m ? `${+m[2]}.${+m[1]} בשעה ${m[3]}:${m[4]}` : ""; };
function verdictOf(f) {
  if (!f) return { tone: "", words: "עוד לא סימנת. מה דעתך?" };
  if (f.status === "done") return { tone: "again", words: `שונה: לאשר שוב${f.answer ? ` (${esc(f.answer)})` : ""}` };
  if (f.verdict === "approve") return { tone: "ok", words: `אישרת${f.at ? ` · ${day(f.at)}` : ""}${f.note ? `: <q dir="auto">${esc(f.note)}</q>` : ""}` };
  const note = f.note ? `: <q dir="auto">${esc(f.note)}</q>` : "";
  if (f.status === "doing") return { tone: "change", words: `ביקשת שינוי, ו-${ltr("Claude")} עובד על זה${note}` };
  if (f.status === "declined") return { tone: "change", words: `ביקשת שינוי${note}. ${ltr("Claude")} ענה: ${esc(f.answer || "")}` };
  return { tone: "change", words: `ביקשת שינוי${f.at ? ` · ${day(f.at)}` : ""}${note}` };
}
function showVerdict() {
  const s = state.subject;
  if (!s) return;
  const v = state.feedback == null ? { tone: "", words: "מה דעתך על הפריט הזה?" } : verdictOf(newestFeedback(s.id));
  const p = $("verdict-state");
  p.className = "verdict-state" + (v.tone ? " " + v.tone : "");
  p.innerHTML = v.words;
  $("approve").disabled = $("note-save").disabled = state.saving;
  if (!state.saving) $("note-save").disabled = !$("note-input").value.trim();
}
// The marks in the list: approved, change asked for, changed (approve again).
function markVerdicts() {
  const words = { ok: "אישרת", change: "ביקשת שינוי", again: "שונה: לאשר שוב" };
  for (const b of $("subject-groups").querySelectorAll("[data-subject]")) {
    const mark = b.querySelector(".mark"), tone = state.feedback == null ? "" : verdictOf(newestFeedback(b.dataset.subject)).tone;
    mark.dataset.mark = tone;
    if (tone) mark.title = words[tone];
    else mark.removeAttribute("title");
  }
}

async function loadFeedback() {
  if (!Store.hasKey()) return; // online without a key: viewing never asks for one
  try {
    const body = await Store.load("feedback", { askForKey: false });
    state.feedback = body && body.plan && Array.isArray(body.plan.items) ? body.plan.items : null;
  } catch {
    state.feedback = null; // (then no verdicts are shown)
  }
  showVerdict();
  markVerdicts();
}

// What is shown now, saved with his verdict: the camera height and side (degrees), the clip and its moment.
function context() {
  const m = state.mode || "";
  if (m === "turn" && turn.t) {
    return { height: round(currentSet().height, 2), angle: round(shownSide(), 2), clip: null, t: null };
  }
  if (m.startsWith("clip:") && clip.c)
    return { height: clip.c.height, angle: clip.c.angles[clip.angle].azimuth, clip: clip.c.id, t: round(clipTime(), 3) };
  return { height: null, angle: null, clip: null, t: null };
}
function contextWords() {
  const c = context(), m = state.mode || "";
  if (m === "turn") return `נשמר יחד עם מה שמוצג עכשיו: ${heightName(c.height)}, ${sideName(c.angle)}${turn.hitbox ? ", עם קווי פגיעה" : ""}.`;
  if (c.clip) return `נשמר יחד עם מה שמוצג עכשיו: ${clip.c.name}, מצלמה ${sideName(c.angle)}, ברגע ${c.t.toFixed(2)} שנ׳.`;
  return state.file ? `נשמר יחד עם התמונה: ${describe(state.file) || state.subject.label}.` : "";
}

// One feedback item (C1): only Tomer's fields, and the status a new item starts with.
function newItem(verdict, note) {
  const s = state.subject, c = context(), d = new Date(), two = n => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
  const random = [...crypto.getRandomValues(new Uint8Array(4))].map(b => (b % 36).toString(36)).join("");
  return { id: `${s.id}-${stamp}-${random}`, subject: s.id, height: c.height, angle: c.angle, clip: c.clip, t: c.t,
    verdict, note, at: isoNow(d), by: "Tomer", status: "new" };
}

async function saveVerdict(verdict, note) {
  if (state.saving || !state.subject) return;
  const s = state.subject, item = newItem(verdict, note);
  state.saving = true;
  said("שומר…");
  showVerdict();
  try {
    const r = await Store.update("feedback", data => {
      if (!data || typeof data !== "object" || Array.isArray(data)) return false;
      if (!Array.isArray(data.items)) data.items = [];
      if (data.format == null) data.format = 1;
      if (!data.items.some(x => x && x.id === item.id)) data.items.push({ ...item });
    }, { message: `Art page: ${verdict === "approve" ? "approved" : "asked to change"} ${s.id}` });
    if (!r || r.saved == null) throw new Error("feedback.json isn't a list of notes");
    state.feedback = r.data && Array.isArray(r.data.items) ? r.data.items : [item];
    if (verdict === "change") {
      delete state.drafts[s.id];
      $("note-input").value = "";
      closeNote();
    }
    said(`${verdict === "approve" ? "האישור נשמר" : "הבקשה לשנות נשמרה"}${r.saved ? ` בשעה ${esc(r.saved)}` : ""}.`, "", s);
  } catch (e) {
    said(e instanceof Store.Conflict ? "לא נשמר: מכשיר אחר שמר בדיוק באותו זמן. נסה שוב בעוד רגע."
      : e instanceof TypeError ? "לא נשמר: אין חיבור. בדוק את החיבור לאינטרנט ונסה שוב."
        : `לא נשמר: ${ltr(e.message || String(e))}`, "bad", s);
  } finally {
    state.saving = false;
    showVerdict();
    markVerdicts();
  }
}
function said(html, tone = "", s = state.subject) {
  if (s !== state.subject) return;
  $("verdict-said").className = "verdict-said" + (tone ? " " + tone : "");
  $("verdict-said").innerHTML = html;
}

function openNote() {
  const box = $("note-box");
  box.hidden = false;
  $("change").setAttribute("aria-expanded", "true");
  $("note-where").textContent = contextWords();
  $("note-input").value = state.drafts[state.subject.id] || "";
  showVerdict();
  $("note-input").focus({ preventScroll: true });
  if (box.getBoundingClientRect().bottom > innerHeight) box.scrollIntoView({ block: "nearest", behavior: calm.matches ? "auto" : "smooth" });
}
function closeNote() {
  $("note-box").hidden = true;
  $("change").setAttribute("aria-expanded", "false");
}

// ---------- the full-size view of a picture: zoom (wheel, + and −, pinch, double tap) and drag ----------
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
  if (!f || $("pic-view").querySelector(".shot.broken")) return;
  const img = $("zoom-img"), pic = $("zoom-pic"), words = describe(f);
  zoom.w = 0;
  zoom.lastTap = null;
  img.onload = () => { if (!zoom.w) layoutZoom(); }; // (a cached picture is laid out below at once: its late load event
  img.src = url(f);                                   // mustn't undo a zoom made since)
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
$("modes").addEventListener("click", e => {
  const b = e.target.closest("[data-mode]");
  if (!b || b.dataset.mode === state.mode) return;
  state.pick.mode = b.dataset.mode.split(":")[0]; // chosen: the next items open the same way
  setMode(b.dataset.mode);
  revealStage();
});
$("controls").addEventListener("click", e => {
  const b = e.target.closest("button");
  if (!b) return;
  const d = b.dataset, picture = state.mode === "picture";
  if (b.id === "hitbox") picture ? pickFacet("hitbox", state.file.hitbox !== true) : toggleTurnLines();
  else if (d.facet) pickFacet(d.facet, d.value);
  else if (d.side !== undefined) sideTo(+d.side);
  else if (d.top !== undefined) topView();
  else if (d.height !== undefined) setHeight(+d.height);
  else if (d.act === "play") togglePlay();
  else if (d.act === "back" || d.act === "forward") stepFrame(d.act === "back" ? -1 : 1);
  else if (d.speed) setRate(+d.speed);
  else if (d.angle) setAngle(+d.angle);
  else if (b.id === "loop") toggleLoop();
  else return;
  if (picture || state.mode === "turn") revealStage();
});
$("controls").addEventListener("input", e => {
  if (e.target.id !== "timebar" || !clip.c) return;
  if (!clip.wide && !mosaic.paused) mosaic.pause();
  seek(+e.target.value);
});
$("strip").addEventListener("click", e => {
  const b = e.target.closest("[data-file]");
  if (!b) return;
  state.pick.mode = "picture";
  showPicture(partsOf(state.subject).pictures[+b.dataset.file]);
  revealStage();
});
$("prev").addEventListener("click", () => step(-1));
$("next").addEventListener("click", () => step(1));
$("pic-view").addEventListener("click", openZoom);
$("big-play").addEventListener("click", togglePlay);
$("stage-zoom-in").addEventListener("click", () => state.mode === "turn" ? turnGestures.zoomTo(STAGE_ZOOM_STEP) : clipZoomBy(STAGE_ZOOM_STEP));
$("stage-zoom-out").addEventListener("click", () => state.mode === "turn" ? turnZoom.zoomBy(1 / STAGE_ZOOM_STEP) : clipZoomBy(1 / STAGE_ZOOM_STEP));
$("stage-full").addEventListener("click", () => isFull() ? exitFull() : enterFull());
$("theatre-close").addEventListener("click", exitFull);
$("turn").addEventListener("keydown", e => {
  const keys = { ArrowRight: () => stepTurn(1), ArrowLeft: () => stepTurn(-1), Home: () => sideTo(0),
    "+": () => turnGestures.zoomTo(STAGE_ZOOM_STEP), "=": () => turnGestures.zoomTo(STAGE_ZOOM_STEP),
    "-": () => turnZoom.zoomBy(1 / STAGE_ZOOM_STEP), "0": () => turnZoom.reset() };
  if (!keys[e.key] || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  keys[e.key]();
});
$("clip").addEventListener("keydown", e => {
  const keys = { " ": togglePlay, k: togglePlay, ",": () => stepFrame(-1), ".": () => stepFrame(1),
    ArrowRight: () => stepAngle(1), ArrowLeft: () => stepAngle(-1), "+": () => clipZoomBy(STAGE_ZOOM_STEP),
    "=": () => clipZoomBy(STAGE_ZOOM_STEP), "-": () => clipZoomBy(1 / STAGE_ZOOM_STEP) };
  if (!keys[e.key] || e.ctrlKey || e.metaKey || e.altKey) return;
  e.preventDefault();
  keys[e.key]();
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && isFull() && !$("zoom").open) exitFull(); });
$("approve").addEventListener("click", () => saveVerdict("approve", ""));
$("change").addEventListener("click", () => $("note-box").hidden ? openNote() : closeNote());
$("note-cancel").addEventListener("click", closeNote);
$("note-input").addEventListener("input", () => {
  state.drafts[state.subject.id] = $("note-input").value;
  showVerdict();
});
$("note-box").addEventListener("submit", e => {
  e.preventDefault();
  const note = $("note-input").value.trim();
  if (note) saveVerdict("change", note);
});
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
  $("pic-view").focus({ preventScroll: true });
});
const zoomView = $("zoom-view");
zoomView.addEventListener("pointerdown", pointerDown);
zoomView.addEventListener("pointermove", pointerMove);
zoomView.addEventListener("pointerup", pointerUp);
zoomView.addEventListener("pointercancel", pointerUp);
zoomView.addEventListener("wheel", wheel, { passive: false });
window.addEventListener("resize", () => { if ($("zoom").open) layoutZoom(true); });

// The list stays in sight under the header, however tall the header is; the stage refits when its size changes.
new ResizeObserver(() => document.documentElement.style.setProperty("--below-top", header.offsetHeight + 12 + "px")).observe(header);
new ResizeObserver(() => relayout()).observe($("stage"));

load();
