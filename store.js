"use strict";
// Where the game pages read and save their data. Two ways, same functions:
//  - On this PC (http://localhost:8765, started from Unity's TestDrive menu > Offline): through
//    server.py, straight to the Unity project's files.
//  - Online (https://torahworldwide.github.io/testdrive-pages/, from any device, PC on or off):
//    through GitHub, in the private repo TorahWorldWide/testdrive-data. This device needs the
//    owner's GitHub key once (kept only in this browser). On the game PC, GamePages/sync.py copies
//    changes between that repo and the Unity project.
// The files: the game's Waves.json and Sounds.json, and Tomer's decisions.json and feedback.json
// (docs/decisions/ on the PC: his choices and notes, saved with Store.update). Pictures and clips
// come from the media site (Store.media). Tested by docs/claude-tools/store_test.mjs (node).

const Store = (() => {
  const REPO = "TorahWorldWide/testdrive-data";
  const FILES = { waves: "Waves.json", sounds: "Sounds.json", decisions: "decisions.json", feedback: "feedback.json" };
  const PAGES = { waves: "Waves page", sounds: "Sounds page", decisions: "Decisions page", feedback: "Art page" }; // who saves each, for commit messages
  const MEDIA = "https://torahworldwide.github.io/testdrive-media/"; // the public site of the pictures and clips
  const TOKEN_KEY = "testdrive.githubToken";
  const TRIES = 4;       // Store.update's tries before it gives up with Store.Conflict
  const PAUSE_MS = 150;  // before try n (n > 1) Store.update waits n x this, plus up to JITTER_MS more at
  const JITTER_MS = 250; //   random, so two devices whose saves met don't try again at the same moment
  const online = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const shas = {};       // file -> the version last read, so a save can't silently undo another device's
  let token = null, freesoundKey = null, credits = {};

  class Conflict extends Error {}

  const clock = () => new Date().toLocaleTimeString("en-GB");
  const inGame = kind => kind === "waves" || kind === "sounds"; // the game's own files
  const commitMessage = kind => `${PAGES[kind]}: saved from ${navigator.userAgent.includes("Mobile") ? "a phone" : "a browser"}`;

  // ---------- the one-row-per-line JSON both sides write ----------
  function formatPlan(kind, plan) {
    const kv = o => Object.entries(o).map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ");
    const rows = (items, indent) => {
      if (!items || !items.length) return "[]";
      const pad = " ".repeat(indent);
      return "[\n" + items.map(i => pad + "  { " + kv(i) + " }").join(",\n") + "\n" + pad + "]";
    };
    const lists = kind === "waves" ? ["enemies", "elites"] : ["layers"];
    const items = plan[kind] || [];
    const out = ["{", `  "${kind}": [`];
    items.forEach((item, n) => {
      const head = Object.fromEntries(Object.entries(item).filter(([k]) => !lists.includes(k)));
      out.push("    {", "      " + kv(head) + ",");
      lists.forEach((name, i) => out.push(`      "${name}": ` + rows(item[name], 6) + (i < lists.length - 1 ? "," : "")));
      out.push("    }" + (n < items.length - 1 ? "," : ""));
    });
    out.push("  ]", "}");
    return out.join("\n") + "\n";
  }

  // A file's text: the game's files one row per line; decisions.json and feedback.json as plain
  // 2-space JSON, the same bytes Python's json.dumps(data, indent=2, ensure_ascii=False) + "\n" writes.
  const formatData = (kind, data) => inGame(kind) ? formatPlan(kind, data) : JSON.stringify(data, null, 2) + "\n";

  // A picture or clip of the media site (GamePages/media/ on this PC). path is relative to its root
  // (e.g. "art/index.json"); v, the file's content hash, makes a browser fetch a changed file at once.
  const media = (path, v) => (online ? MEDIA : "media/") + path + (v == null || v === "" ? "" : "?v=" + v);

  // ---------- GitHub ----------
  const toBase64 = text => {
    const bytes = new TextEncoder().encode(text);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  };
  const fromBase64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

  async function github(path, options = {}) {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
      ...options,
      cache: "no-store",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...(options.headers || {}) },
    });
    if (r.status === 401) { forget(); throw new Error("GitHub didn't accept this device's key. Reload the page and enter it again."); }
    if (r.status === 409 || r.status === 422) throw new Conflict("conflict");
    if (r.status === 404) throw new Error(`There's no ${path} in ${REPO}, or the key can't see that repo.`);
    if (!r.ok) throw new Error(`GitHub answered ${r.status}.`);
    return r.json();
  }
  async function getFile(name) { // { text, sha }
    const f = await github(name);
    return { text: fromBase64(f.content), sha: f.sha };
  }
  async function readFile(name) {
    const f = await getFile(name);
    shas[name] = f.sha;
    return f.text;
  }
  // Saves over the version sha (GitHub refuses with a conflict when it isn't the newest); returns the new sha.
  async function putFile(name, text, message, sha) {
    const body = { message, content: toBase64(text), sha };
    const r = await github(name, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    return r.content.sha;
  }
  async function writeFile(name, text, message, force) {
    if (force) shas[name] = (await github(name)).sha;
    shas[name] = await putFile(name, text, message, shas[name]);
  }

  function forget() {
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing kept */ }
  }

  // The key dialog's words: Hebrew on the Hebrew pages (<html lang="he">), English on the others.
  const KEY_TEXT = {
    en: {
      title: "Connect this device", button: "Connect", label: "GitHub key",
      about: "The pages save to your private GitHub repo <b>testdrive-data</b>. Paste the GitHub key (it starts with " +
        "<code>github_pat_</code>) once on this device; it stays only in this browser.",
      problem: e => e.message.startsWith("GitHub didn't")
        ? "That key didn't work. Check you copied all of it, and that it can read and write testdrive-data." : e.message,
    },
    he: {
      title: "חיבור המכשיר", button: "חיבור", label: "מפתח GitHub",
      about: "הדבק פעם אחת את מפתח GitHub (מתחיל ב־<code dir=\"ltr\">github_pat_</code>) כדי לשמור במאגר הפרטי שלך " +
        "<b>testdrive-data</b>; הוא נשמר רק בדפדפן הזה.",
      problem: e => e instanceof TypeError ? "אין חיבור ל־GitHub. בדוק את החיבור לאינטרנט ונסה שוב."
        : /^(GitHub didn't|There's no)/.test(e.message)
          ? "המפתח לא עבד. בדוק שהעתקת את כולו, ושיש לו הרשאה לקרוא ולכתוב ב־testdrive-data." : e.message,
    },
  };

  // The one-time setup on a new device: paste the GitHub key.
  function askForKey(message) {
    const t = KEY_TEXT[(document.documentElement.lang || "").toLowerCase().startsWith("he") ? "he" : "en"];
    return new Promise(resolve => {
      const box = document.createElement("div");
      box.className = "setup";
      box.innerHTML = `<form class="setup-card">
        <h2>${t.title}</h2>
        <p>${t.about}</p>
        <input class="text-input" type="password" autocomplete="off" placeholder="github_pat_…" aria-label="${t.label}" dir="ltr" required>
        <p class="setup-error" role="alert">${message || ""}</p>
        <button type="submit" class="save">${t.button}</button>
      </form>`;
      document.body.appendChild(box);
      const input = box.querySelector("input");
      input.focus();
      box.querySelector("form").addEventListener("submit", async ev => {
        ev.preventDefault();
        token = input.value.trim();
        try {
          await github("README.md");
          try { localStorage.setItem(TOKEN_KEY, token); } catch { /* this visit only */ }
          box.remove();
          resolve();
        } catch (e) {
          token = null; // not a working key (yet)
          box.querySelector(".setup-error").textContent = t.problem(e);
        }
      });
    });
  }

  // Online, this device's key: kept in this browser (or for this visit), else asked for, in one
  // dialog however many calls wait for it. False when there is none and ask is false.
  let asking = null;
  async function ready(ask = true) {
    if (!online) return true;
    try { token = localStorage.getItem(TOKEN_KEY) || token; } catch { /* keep this visit's key, if any */ }
    if (token) return true;
    if (!ask) return false;
    if (!asking) asking = askForKey().finally(() => { asking = null; });
    await asking;
    return true;
  }

  // Whether this device can read and save without the key dialog (offline: always; online: when this
  // browser keeps the key), so a page can load only then: load(kind, { askForKey: false }).
  function hasKey() {
    if (!online) return true;
    try { return !!(localStorage.getItem(TOKEN_KEY) || token); } catch { return !!token; }
  }

  // ---------- reading and saving the plans ----------
  // On this PC, through server.py: its { plan, file, version }, and saving (only over that version
  // when one is given: If-Match, which server.py refuses with a 409 when the file changed since).
  async function readLocal(kind) {
    const r = await fetch(`api/${kind}`, { cache: "no-store" });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || `The server couldn't read ${FILES[kind]}.`);
    return body;
  }
  async function writeLocal(kind, plan, version) {
    const headers = { "Content-Type": "application/json" };
    if (version) headers["If-Match"] = version;
    const r = await fetch(`api/${kind}`, { method: "POST", headers, body: JSON.stringify(plan) });
    if (r.status === 409) throw new Conflict("conflict");
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || "Saving failed.");
    return body.saved;
  }

  // Returns { plan, file, version } (and the recordings for the Sounds page), or null online when this
  // device has no key yet and askForKey is false (then nothing is asked).
  async function load(kind, { askForKey: ask = true } = {}) {
    if (!(await ready(ask))) return null;
    if (!online) {
      const body = await readLocal(kind);
      if (body.credits) credits = body.credits;
      return body;
    }
    const f = await getFile(FILES[kind]);
    shas[FILES[kind]] = f.sha;
    const body = { plan: JSON.parse(f.text), file: `Online: GitHub ${REPO} / ${FILES[kind]}`, version: f.sha };
    if (kind === "sounds") {
      const [list, creditList, key] = await Promise.all([
        fetch("recordings.json", { cache: "no-store" }).then(r => r.json()),
        readFile("credits.json").then(JSON.parse).catch(() => []),
        readFile("freesound-key.txt").then(t => t.trim()).catch(() => null),
      ]);
      credits = Object.fromEntries(creditList.map(c => [c.take, c]));
      freesoundKey = key;
      body.recordings = [...list, ...Object.keys(credits)];
      body.credits = credits;
      body.freesound = !!key;
    }
    return body;
  }

  // Returns { saved, note }. Throws Store.Conflict when another device saved since this page read it.
  async function save(kind, plan, { force = false } = {}) {
    if (!online) {
      const note = kind === "waves" ? "The game uses it from the next wave." : kind === "sounds" ? "The game uses it within a second." : "Saved on this PC.";
      return { saved: await writeLocal(kind, plan), note };
    }
    await writeFile(FILES[kind], formatData(kind, plan), commitMessage(kind), force);
    return { saved: clock(), note: inGame(kind) ? "Saved online. Your PC brings it into the game the next time Unity is open." : "Saved online." };
  }

  // The newest copy of a file and its version, read past every cache (online: GitHub's sha). It never
  // moves the version save() checks against: that stays the one the page loaded.
  async function latest(kind) {
    if (!online) {
      const body = await readLocal(kind);
      return { data: body.plan, version: body.version };
    }
    const f = await getFile(FILES[kind]);
    return { data: JSON.parse(f.text), version: f.sha };
  }

  // Saves data over exactly that version. Throws Store.Conflict when someone saved in between.
  // Returns the time it was saved.
  async function saveOver(kind, data, version, message) {
    if (!online) return writeLocal(kind, data, version);
    await putFile(FILES[kind], formatData(kind, data), message || commitMessage(kind), version);
    return clock();
  }

  // Changes a file that other devices (and the PC's sync) may change too, without undoing theirs: reads
  // the newest copy, lets mutate(data) change it in place, and saves it over the version it read. When
  // someone saved in between, it waits a moment, reads again and runs mutate again (up to 4 tries, then
  // Store.Conflict). So mutate may run more than once: it must only SET Tomer's fields from its own inputs
  // (his choice, his note, the time), never toggle or count from the old value. If it returns false,
  // nothing is saved. One page's updates of a file run one after another, in the order they were called,
  // so quick taps never collide with each other (each starts once the one before has finished, saved or
  // not); updates of different files don't wait for each other. Online it asks for the key first if this
  // device has none. Returns { saved, data } (saved: the time, or null when mutate cancelled).
  const queues = {}; // kind -> this page's last update of that file
  function update(kind, mutate, options) {
    const run = (queues[kind] || Promise.resolve()).catch(() => {}).then(() => updateNow(kind, mutate, options));
    return (queues[kind] = run);
  }
  async function updateNow(kind, mutate, { message } = {}) {
    await ready();
    for (let attempt = 1; ; attempt++) {
      if (attempt > 1) await new Promise(resolve => setTimeout(resolve, PAUSE_MS * attempt + Math.random() * JITTER_MS));
      const { data, version } = await latest(kind);
      if ((await mutate(data)) === false) return { saved: null, data };
      try {
        return { saved: await saveOver(kind, data, version, message), data };
      } catch (e) {
        if (!(e instanceof Conflict) || attempt >= TRIES) throw e;
      }
    }
  }

  // ---------- the Sounds page's recordings and library ----------
  const previews = {};
  const known = {}; // Freesound sounds whose preview links are already here (from a search)
  async function freesoundInfo(id) {
    if (!previews[id]) {
      previews[id] = fetch(`https://freesound.org/apiv2/sounds/${id}/?fields=id,name,username,url,license,previews&token=${freesoundKey}`)
        .then(r => { if (!r.ok) throw new Error("Freesound answered " + r.status); return r.json(); })
        .then(s => (known[id] = s));
      previews[id].catch(() => delete previews[id]);
    }
    return previews[id];
  }
  // Where a take's audio can be fetched. Online, sounds brought in from the library are played from
  // where they came from (Kenney's files here, or Freesound).
  function fileUrl(take) { // every take except Freesound's online, which need a lookup
    const path = s => s.split("/").map(encodeURIComponent).join("/");
    if (take.startsWith("~")) return `made-sounds/${take.slice(1)}.wav`;
    if (take.startsWith("kenney:")) return "library/kenney/" + path(take.slice(7));
    if (take.startsWith("freesound:")) return `api/library/freesound/preview/${take.slice(10)}`;
    return online ? `sfx/${path(take)}.ogg` : "sfx/" + path(take);
  }
  const from = take => online && take.startsWith("lib/") && credits[take]?.from ? from(credits[take].from) : take;
  async function audioUrl(take) {
    take = from(take);
    if (online && take.startsWith("freesound:")) return (await freesoundInfo(take.slice(10))).previews["preview-hq-mp3"]; // mp3: every phone decodes it
    return fileUrl(take);
  }
  // A link for listening in an <audio> player, which streams it (it starts before it has all of it).
  // Online, Freesound sounds use their mp3 preview, which every phone plays. The link comes back
  // straight away when it's known, so a phone still counts the play as the user's own tap.
  function streamUrl(take) {
    take = from(take);
    if (!online || !take.startsWith("freesound:")) return fileUrl(take);
    const id = take.slice(10);
    if (known[id]) return known[id].previews["preview-hq-mp3"];
    return freesoundInfo(id).then(s => s.previews["preview-hq-mp3"]);
  }

  async function kenney() {
    if (!online) {
      const r = await fetch("api/library/kenney", { cache: "no-store" });
      return r.json();
    }
    const index = await fetch("library/kenney/index.json").then(r => r.json());
    for (const s of index.sounds) s.ref = `kenney:${s.pack}/${s.file}`;
    return { status: "ready", ...index };
  }
  async function downloadKenney() {
    const r = await fetch("api/library/kenney/download", { method: "POST" });
    return r.json();
  }

  const SORTS = { best: "score", downloads: "downloads_desc", rating: "rating_desc", newest: "created_desc" };
  const title = name => name.trim().replace(/\.(wav|mp3|ogg|flac|aiff?|m4a)$/i, "");
  async function searchFreesound(query, page, sort, short) {
    if (!online) {
      const params = new URLSearchParams({ q: query, page, sort, short: short ? "1" : "0" });
      const r = await fetch("api/library/freesound?" + params);
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Freesound didn't answer.");
      return body;
    }
    if (!freesoundKey) throw new Error("There's no Freesound key in testdrive-data (freesound-key.txt).");
    const params = new URLSearchParams({
      query, page, page_size: 30, sort: SORTS[sort] || "score", token: freesoundKey,
      filter: 'license:"Creative Commons 0"' + (short ? " duration:[0 TO 6]" : ""),
      fields: "id,name,duration,license,username,previews,url,tags",
    });
    const r = await fetch("https://freesound.org/apiv2/search/text/?" + params);
    if (r.status === 404) return { count: 0, page, more: false, results: [] };
    if (r.status === 429) throw new Error("Freesound says: too many searches for now. Wait a minute and try again.");
    if (!r.ok) throw new Error("Freesound answered " + r.status + ".");
    const data = await r.json();
    const results = data.results.filter(s => s.license.includes("publicdomain/zero")).map(s => {
      previews[s.id] = Promise.resolve(s);
      known[s.id] = s;
      return { ref: `freesound:${s.id}`, title: title(s.name), author: s.username, seconds: Math.round((s.duration || 0) * 100) / 100,
        license: "CC0", link: s.url, tags: (s.tags || []).slice(0, 6) };
    });
    return { count: data.count, page: +page, more: !!data.next, results };
  }

  // Brings a library sound into the game. On this PC it happens right away; online the game PC
  // does it later (sync.py), so the sound stays a "kenney:"/"freesound:" reference until then.
  async function bringIn(ref) {
    if (online) return null;
    const r = await fetch("api/library/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ref }) });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error || "Couldn't bring that sound in.");
    return body;
  }

  return { online, Conflict, load, save, update, hasKey, media, formatData, audioUrl, streamUrl, kenney, downloadKenney,
    searchFreesound, bringIn, formatPlan, credits: () => credits };
})();
