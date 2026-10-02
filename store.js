"use strict";
// Where the game pages read and save their data. Two ways, same functions:
//  - On this PC (http://localhost:8765, started from Unity's TestDrive menu > Offline): through
//    server.py, straight to the Unity project's files.
//  - Online (https://torahworldwide.github.io/testdrive-pages/, from any device, PC on or off):
//    through GitHub, in the private repo TorahWorldWide/testdrive-data. This device needs the
//    owner's GitHub key once (kept only in this browser). On the game PC, GamePages/sync.py copies
//    changes between that repo and the Unity project.

const Store = (() => {
  const REPO = "TorahWorldWide/testdrive-data";
  const FILES = { waves: "Waves.json", sounds: "Sounds.json" };
  const TOKEN_KEY = "testdrive.githubToken";
  const online = !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const shas = {};       // file -> the version last read, so a save can't silently undo another device's
  let token = null, freesoundKey = null, credits = {};

  class Conflict extends Error {}

  const clock = () => new Date().toLocaleTimeString("en-GB");

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
  async function readFile(name) {
    const f = await github(name);
    shas[name] = f.sha;
    return fromBase64(f.content);
  }
  async function writeFile(name, text, message, force) {
    if (force) shas[name] = (await github(name)).sha;
    const body = { message, content: toBase64(text), sha: shas[name] };
    const r = await github(name, { method: "PUT", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
    shas[name] = r.content.sha;
  }

  function forget() {
    token = null;
    try { localStorage.removeItem(TOKEN_KEY); } catch { /* nothing kept */ }
  }

  // The one-time setup on a new device: paste the GitHub key.
  function askForKey(message) {
    return new Promise(resolve => {
      const box = document.createElement("div");
      box.className = "setup";
      box.innerHTML = `<form class="setup-card">
        <h2>Connect this device</h2>
        <p>The pages save to your private GitHub repo <b>testdrive-data</b>. Paste the GitHub key
          (it starts with <code>github_pat_</code>) once on this device; it stays only in this browser.</p>
        <input class="text-input" type="password" autocomplete="off" placeholder="github_pat_…" aria-label="GitHub key" required>
        <p class="setup-error" role="alert">${message || ""}</p>
        <button type="submit" class="save">Connect</button>
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
          box.querySelector(".setup-error").textContent = e.message.startsWith("GitHub didn't")
            ? "That key didn't work. Check you copied all of it, and that it can read and write testdrive-data." : e.message;
        }
      });
    });
  }

  async function ready() {
    if (!online) return;
    try { token = localStorage.getItem(TOKEN_KEY); } catch { token = null; }
    if (!token) await askForKey();
  }

  // ---------- reading and saving the plans ----------
  async function load(kind) {
    await ready();
    if (!online) {
      const r = await fetch(`api/${kind}`, { cache: "no-store" });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || `The server couldn't read ${FILES[kind]}.`);
      if (body.credits) credits = body.credits;
      return body;
    }
    const plan = JSON.parse(await readFile(FILES[kind]));
    const body = { plan, file: `Online: GitHub ${REPO} / ${FILES[kind]}` };
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
      const r = await fetch(`api/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(plan) });
      const body = await r.json();
      if (!r.ok) throw new Error(body.error || "Saving failed.");
      return { saved: body.saved, note: kind === "waves" ? "The game uses it from the next wave." : "The game uses it within a second." };
    }
    await writeFile(FILES[kind], formatPlan(kind, plan), `${kind === "waves" ? "Waves" : "Sounds"} page: saved from ${navigator.userAgent.includes("Mobile") ? "a phone" : "a browser"}`, force);
    return { saved: clock(), note: "Saved online. Your PC brings it into the game the next time Unity is open." };
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

  return { online, Conflict, load, save, audioUrl, streamUrl, kenney, downloadKenney, searchFreesound, bringIn, formatPlan, credits: () => credits };
})();
