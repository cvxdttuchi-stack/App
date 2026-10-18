// Arya Downloader v1 — frontend
"use strict";
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- toasts + notification ---------- */
function toast(t) {
  const d = document.createElement("div");
  d.className = "toast"; d.textContent = t;
  $("#toasts").appendChild(d);
  setTimeout(() => d.remove(), 3200);
}
function notify(title, body) {
  toast(title);
  try {
    if ("Notification" in window && Notification.permission === "granted") new Notification(title, { body });
  } catch {}
}
if ("Notification" in window && Notification.permission === "default") {
  setTimeout(() => Notification.requestPermission().catch(() => {}), 4000);
}

/* ---------- tabs ---------- */
$$(".bottomnav button").forEach((b) => (b.onclick = () => {
  $$(".bottomnav button").forEach((x) => x.classList.toggle("on", x === b));
  $$(".tab").forEach((t) => t.classList.toggle("on", t.id === b.dataset.tab));
}));

/* ---------- platform detect ---------- */
function platformOf(u) {
  const h = (() => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } })();
  if (/youtu/.test(h)) return ["▶️", "YouTube"];
  if (/instagram/.test(h)) return ["📸", "Instagram"];
  if (/pinterest|pin\.it/.test(h)) return ["📌", "Pinterest"];
  if (/facebook|fb\.watch/.test(h)) return ["📘", "Facebook"];
  if (/tiktok/.test(h)) return ["🎵", "TikTok"];
  return ["🎬", "Video"];
}

/* ---------- info fetch ---------- */
let curInfo = null, curUrl = "";
function showErr(t) { const e = $("#err"); e.hidden = !t; e.textContent = t || ""; }
async function fetchInfo(url) {
  url = (url || "").trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  curUrl = url;
  const [emoji, name] = platformOf(url);
  const badge = $("#platBadge");
  badge.hidden = false; badge.textContent = emoji + " " + name + " link pehchana gaya ✅";
  showErr("");
  $("#infoCard").hidden = true; $("#qWrap").hidden = true;
  $("#goBtn").innerHTML = '<span class="spin">⏳</span>';
  try {
    const r = await fetch("/api/info", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Info nahi mili.");
    curInfo = j;
    $("#thumb").src = j.thumbnail || "";
    $("#vTitle").textContent = j.title;
    const dur = j.duration ? Math.floor(j.duration / 60) + ":" + String(j.duration % 60).padStart(2, "0") : "";
    $("#vSub").textContent = [j.platform, j.uploader, dur].filter(Boolean).join(" • ");
    $("#infoCard").hidden = false;
    const ql = $("#qList"); ql.innerHTML = "";
    if (!j.qualities.length && !j.audio) throw new Error("Is video me download layak quality nahi mili.");
    j.qualities.forEach((q, i) => {
      const b = document.createElement("button");
      b.textContent = q.label + (q.size ? " (" + fmtSize(q.size) + ")" : "");
      if (i === 0) b.classList.add("hot");
      b.onclick = () => startDownload(q, false);
      ql.appendChild(b);
    });
    const ab = $("#audioBtn");
    ab.hidden = !j.audio;
    ab.onclick = () => startDownload(j.audio, true);
    $("#qWrap").hidden = false;
  } catch (e) {
    showErr(e.message);
  }
  $("#goBtn").textContent = "🔍";
}
$("#goBtn").onclick = () => fetchInfo($("#url").value);
$("#url").addEventListener("paste", () => setTimeout(() => fetchInfo($("#url").value), 60));
$("#url").addEventListener("keydown", (e) => { if (e.key === "Enter") fetchInfo($("#url").value); });
$("#pasteBtn").onclick = async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t && t.trim()) { $("#url").value = t.trim(); fetchInfo(t.trim()); }
    else toast("Clipboard khali hai. Link copy karke lao. 📋");
  } catch { toast("Clipboard ki permission do, ya link khud paste karo. 📋"); }
};
function fmtSize(b) {
  b = Number(b) || 0;
  if (!b) return "";
  return b > 1048576 ? (b / 1048576).toFixed(1) + "MB" : Math.round(b / 1024) + "KB";
}
function fmtDur(s) {
  s = Math.max(0, Math.round(s || 0));
  return (s / 1048576).toFixed(1) + " MB/s";
}

/* ---------- downloads (progress + speed) ---------- */
const dls = new Map();
function dlId() { return "d" + Date.now().toString(36) + Math.floor(Math.random() * 999); }
function safeName(t, ext) {
  t = String(t || "video").replace(/[\\/:*?"<>|]/g, "").trim().slice(0, 60) || "video";
  return t + "." + (ext || "mp4");
}
function renderDls() {
  const list = $("#dlList");
  const arr = [...dls.values()].reverse();
  $("#dlBadge").hidden = !arr.some((d) => d.state === "run");
  $("#dlBadge").textContent = arr.filter((d) => d.state === "run").length || "";
  if (!arr.length) {
    list.innerHTML = '<div class="empty">Abhi kuch download nahi ho raha.<br>Home se link paste karo. 🚀</div>';
    return;
  }
  list.innerHTML = arr.map((d) => `
    <div class="dl ${d.state === "done" ? "done" : ""}">
      <div class="t">${esc(d.title)}</div>
      <div class="bar"><i style="width:${d.pct}%"></i></div>
      <div class="row">
        <span class="pct">${d.state === "done" ? "✅ Poora hua" : d.state === "err" ? "❌ " + esc(d.err || "Ruk gaya") : d.pct + "%"}</span>
        <span>${d.state === "run" ? fmtDur(d.speed) + (d.total ? " • " + fmtSize(d.got) + " / " + fmtSize(d.total) : " • " + fmtSize(d.got)) : esc(d.label || "")}</span>
      </div>
      ${d.state === "done" ? `<div class="acts"><button class="btn small primary" data-play="${d.id}">▶ Dekho</button><button class="btn small ghost" data-sys="${d.id}">📥 Phone me save karo</button></div>` : ""}
    </div>`).join("");
  $$("[data-play]", list).forEach((b) => (b.onclick = () => playFile(b.dataset.play)));
  $$("[data-sys]", list).forEach((b) => (b.onclick = () => systemSave(b.dataset.sys)));
}
async function startDownload(q, isAudio) {
  if (!curInfo) return;
  const id = dlId();
  const filename = safeName(curInfo.title + (isAudio ? " (audio)" : " " + q.label), q.ext);
  const d = { id, title: curInfo.title, label: q.label, filename, pct: 0, got: 0, total: q.size || 0, speed: 0, state: "run", blob: null, isAudio };
  dls.set(id, d); renderDls();
  toast("⬇️ Download shuru: " + q.label);
  try {
    const r = await fetch("/api/resolve", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: curUrl, format_id: q.id }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || "Link nahi bana.");
    await streamDownload(d, j.url);
  } catch (e) {
    d.state = "err"; d.err = e.message; renderDls();
    toast("❌ " + e.message);
  }
}
async function streamDownload(d, directUrl) {
  // Seedha CDN se download (tez) + live % aur speed
  let r;
  try {
    r = await fetch(directUrl);
    if (!r.ok || !r.body) throw new Error("cdn");
  } catch {
    // CORS ya koi dikkat: seedha link kholo, browser sambhal lega
    d.state = "err"; d.err = "Browser se khol raha hun…";
    renderDls();
    const a = document.createElement("a");
    a.href = directUrl; a.download = d.filename; a.target = "_blank";
    document.body.appendChild(a); a.click(); a.remove();
    d.state = "done"; d.pct = 100; d.label = d.label + " (browser me khula)";
    renderDls();
    notify("⬇️ Download browser me khola gaya", d.filename);
    return;
  }
  const total = Number(r.headers.get("content-length")) || d.total || 0;
  d.total = total;
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  const t0 = Date.now();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value); got += value.length;
    const dt = (Date.now() - t0) / 1000;
    d.got = got; d.speed = got / Math.max(dt, 0.2);
    d.pct = total ? Math.min(99, Math.round((got / total) * 100)) : d.pct;
    renderDls();
  }
  const blob = new Blob(chunks, { type: d.isAudio ? "audio/*" : "video/*" });
  d.blob = blob; d.state = "done"; d.pct = 100; d.got = blob.size;
  renderDls();
  await libAdd({ id: d.id, name: d.filename, size: blob.size, ts: Date.now(), kind: d.isAudio ? "audio" : "video", blob });
  renderLib();
  notify("✅ Download poora hua", d.filename);
}

/* ---------- system save (phone storage) ---------- */
function systemSave(id) {
  const d = dls.get(id);
  if (!d || !d.blob) return toast("File taiyaar nahi.");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(d.blob);
  a.download = d.filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
  toast("📥 Phone me save ho raha hai…");
}

/* ---------- library (IndexedDB) ---------- */
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const q = indexedDB.open("arya-dl", 1);
    q.onupgradeneeded = () => q.result.createObjectStore("files", { keyPath: "id" });
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
  return dbp;
}
async function libAdd(rec) {
  const d = await db();
  await new Promise((res, rej) => {
    const tx = d.transaction("files", "readwrite");
    tx.objectStore("files").put(rec);
    tx.oncomplete = res; tx.onerror = () => rej(tx.error);
  });
}
async function libAll() {
  const d = await db();
  return new Promise((res, rej) => {
    const q = d.transaction("files").objectStore("files").getAll();
    q.onsuccess = () => res(q.result || []);
    q.onerror = () => rej(q.error);
  });
}
async function libDel(id) {
  const d = await db();
  await new Promise((res) => {
    const tx = d.transaction("files", "readwrite");
    tx.objectStore("files").delete(id);
    tx.oncomplete = res; tx.onerror = res;
  });
  renderLib();
}
async function renderLib() {
  const files = (await libAll()).sort((a, b) => b.ts - a.ts);
  const list = $("#libList");
  if (!files.length) {
    list.innerHTML = '<div class="empty">Download ki hui files yahan dikhengi.<br>Video dekho, gaane suno. 🎧</div>';
    return;
  }
  list.innerHTML = files.map((f) => `
    <div class="libitem">
      <div class="ic">${f.kind === "audio" ? "🎵" : "🎬"}</div>
      <div style="flex:1;min-width:0"><div class="nm">${esc(f.name)}</div><div class="sz">${fmtSize(f.size)}</div></div>
      <button data-play="${f.id}">▶</button>
      <button data-del="${f.id}">🗑️</button>
    </div>`).join("");
  $$("[data-play]", list).forEach((b) => (b.onclick = () => playFile(b.dataset.play)));
  $$("[data-del]", list).forEach((b) => (b.onclick = () => { if (confirm("Delete karun?")) libDel(b.dataset.del); }));
}
async function playFile(id) {
  let rec = dls.get(id);
  if (!rec || !rec.blob) {
    const files = await libAll();
    rec = files.find((f) => f.id === id);
    if (!rec || !rec.blob) return toast("File nahi mili.");
  }
  if (rec.kind === "audio" || (rec.blob.type || "").startsWith("audio")) {
    // audio: naya tab me kholo ya system player
    const a = document.createElement("a");
    a.href = URL.createObjectURL(rec.blob); a.target = "_blank";
    document.body.appendChild(a); a.click(); a.remove();
    toast("🎵 Audio khul raha hai…");
    return;
  }
  $("#plTitle").textContent = "▶ " + (rec.name || rec.filename || "Video");
  const v = $("#plVideo");
  v.src = URL.createObjectURL(rec.blob);
  $("#player").hidden = false;
  v.play().catch(() => {});
}
$("#plClose").onclick = () => {
  const v = $("#plVideo");
  v.pause(); v.removeAttribute("src"); v.load();
  $("#player").hidden = true;
};
$("#player").addEventListener("click", (e) => { if (e.target.id === "player") $("#plClose").onclick(); });

/* ---------- boot: clipboard auto-detect ---------- */
renderDls(); renderLib();
setTimeout(async () => {
  try {
    const t = await navigator.clipboard.readText();
    if (t && /^https?:\/\//i.test(t.trim()) && !$("#url").value) {
      $("#url").value = t.trim();
      toast("📋 Link mil gaya — info nikal raha hun…");
      fetchInfo(t.trim());
    }
  } catch {}
}, 1200);
