// Arya Downloader v1 — server (Express + yt-dlp)
// Koi API key NAHI chahiye: yt-dlp link se seedha video info nikalta hai.
// Security: sirf allowlist wale domains (SSRF protection), format_id strict,
// har yt-dlp call par timeout, simple rate limit.

"use strict";
const express = require("express");
const { spawn } = require("child_process");
const path = require("path");

const PORT = process.env.PORT || 10000;
const app = express();
app.use(express.json({ limit: "64kb" }));

// ---------- rate limit (simple, in-memory) ----------
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || "?";
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (arr.length > 40) return res.status(429).json({ error: "Bahut tez requests. 1 minute ruk kar try karo." });
  next();
}

// ---------- URL allowlist (SSRF se bachav) ----------
const ALLOWED = [
  /(^|\.)youtube\.com$/, /(^|\.)youtu\.be$/, /(^|\.)music\.youtube\.com$/,
  /(^|\.)instagram\.com$/, /(^|\.)facebook\.com$/, /(^|\.)fb\.watch$/,
  /(^|\.)pinterest\.com$/, /(^|\.)pin\.it$/, /(^|\.)tiktok\.com$/,
  /(^|\.)vm\.tiktok\.com$/, /(^|\.)vt\.tiktok\.com$/,
];
function cleanUrl(u) {
  u = String(u || "").trim();
  if (!/^https?:\/\//i.test(u) || u.length > 2000) return null;
  let host;
  try { host = new URL(u).hostname.toLowerCase(); } catch { return null; }
  if (!ALLOWED.some((re) => re.test(host))) return null;
  return u;
}
function platformOf(u) {
  const h = (() => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } })();
  if (/youtu/.test(h)) return "YouTube";
  if (/instagram/.test(h)) return "Instagram";
  if (/facebook|fb\.watch/.test(h)) return "Facebook";
  if (/pinterest|pin\.it/.test(h)) return "Pinterest";
  if (/tiktok/.test(h)) return "TikTok";
  return "Video";
}
const FORMAT_RE = /^[A-Za-z0-9][A-Za-z0-9_\-+]*$/;

function shortErr(m) {
  m = String(m || "");
  if (/private|login|cookies/i.test(m)) return "Ye private/login wala content hai — public link try karo.";
  if (/unsupported url|no video|not available/i.test(m)) return "Is link se video nahi mili. Link sahi hai?";
  if (/timed out|timeout/i.test(m)) return "Site se jawab nahi aaya. Dobara try karo.";
  if (/429|too many requests/i.test(m)) return "Site ne thodi der ke liye roka hai. 2-3 minute baad try karo.";
  return m.slice(0, 140) || "Pata nahi chala.";
}

function ytdlp(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const p = spawn("yt-dlp", args, { timeout: timeoutMs || 60000 });
    let out = "", err = "";
    p.stdout.on("data", (d) => { out += d; });
    p.stderr.on("data", (d) => { err += d; });
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(err.slice(-600) || ("yt-dlp exit " + code)));
    });
  });
}

// yt-dlp formats -> saaf quality list (single file: audio+video dono wale)
function pickQualities(formats) {
  const seen = new Map();
  for (const f of formats || []) {
    if (!f || !f.url) continue;
    if (!f.vcodec || f.vcodec === "none" || !f.acodec || f.acodec === "none") continue;
    const h = Number(f.height) || 0;
    if (!h) continue;
    const score = (f.ext === "mp4" ? 2 : 1) + (Number(f.tbr) || 0) / 100000;
    const cur = seen.get(h);
    if (!cur || score > cur._s) seen.set(h, { ...f, _s: score });
  }
  return [...seen.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([h, f]) => ({
      id: String(f.format_id),
      label: h >= 2160 ? "4K" : h + "p",
      ext: f.ext || "mp4",
      size: f.filesize || f.filesize_approx || 0,
    }));
}
function pickAudio(formats) {
  const auds = (formats || [])
    .filter((f) => f && f.url && (!f.vcodec || f.vcodec === "none") && f.acodec && f.acodec !== "none")
    .sort((a, b) => (Number(b.abr) || 0) - (Number(a.abr) || 0));
  const a = auds[0];
  if (!a) return null;
  return {
    id: String(a.format_id),
    label: "Audio" + (a.abr ? " (" + Math.round(Number(a.abr)) + "kbps)" : ""),
    ext: a.ext || "m4a",
    size: a.filesize || a.filesize_approx || 0,
  };
}

// ---------- API ----------
app.get("/healthz", (req, res) => res.json({ ok: true, app: "arya-downloader", v: 1 }));

app.get("/api/version", rateLimit, async (req, res) => {
  try {
    const v = await ytdlp(["--version"], 15000);
    res.json({ ytdlp: v.trim() });
  } catch (e) {
    res.status(500).json({ error: "yt-dlp nahi chal raha: " + shortErr(e.message) });
  }
});

// Link se info: title, thumbnail, qualities
app.post("/api/info", rateLimit, async (req, res) => {
  const url = cleanUrl(req.body && req.body.url);
  if (!url) {
    return res.status(400).json({ error: "Ye link support nahi hota. YouTube / Instagram / Pinterest / Facebook / TikTok ka link do." });
  }
  try {
    const raw = await ytdlp(["--dump-json", "--no-playlist", "--no-warnings", "--socket-timeout", "20", url], 90000);
    const j = JSON.parse(raw);
    res.json({
      title: j.title || "Video",
      thumbnail: j.thumbnail || null,
      duration: Math.round(Number(j.duration) || 0),
      uploader: j.uploader || j.channel || "",
      platform: platformOf(url),
      qualities: pickQualities(j.formats),
      audio: pickAudio(j.formats),
    });
  } catch (e) {
    res.status(502).json({ error: "Link se info nahi nikli: " + shortErr(e.message) });
  }
});

// Quality -> seedha download link (phone seedha CDN se download karega = tez)
app.post("/api/resolve", rateLimit, async (req, res) => {
  const url = cleanUrl(req.body && req.body.url);
  const fid = String((req.body && req.body.format_id) || "");
  if (!url) return res.status(400).json({ error: "Link support nahi hota." });
  if (!FORMAT_RE.test(fid) || fid.length > 40) return res.status(400).json({ error: "Galat format." });
  try {
    const raw = await ytdlp(["-g", "-f", fid, "--no-playlist", "--no-warnings", "--socket-timeout", "20", url], 90000);
    const direct = raw.split("\n").map((s) => s.trim()).filter(Boolean)[0];
    if (!direct || !/^https?:\/\//.test(direct)) throw new Error("Direct link nahi mila.");
    res.json({ url: direct });
  } catch (e) {
    res.status(502).json({ error: "Download link nahi bana: " + shortErr(e.message) });
  }
});

app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

if (require.main === module) {
  app.listen(PORT, () => console.log("Arya Downloader v1 live on :" + PORT));
}
module.exports = { app, cleanUrl, platformOf, pickQualities, pickAudio, shortErr };
