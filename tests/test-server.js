// Arya Downloader — tests (fixture based, no network)
"use strict";
const { spawn } = require("child_process");
const path = require("path");

const PORT = 3220;
const BASE = `http://127.0.0.1:${PORT}`;
let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${extra ? " — " + extra : ""}`); }
};

const fixtureFormats = [
  { format_id: "22", url: "http://x/22", ext: "mp4", vcodec: "avc1", acodec: "mp4a", height: 720, tbr: 2000, filesize: 5000000 },
  { format_id: "18", url: "http://x/18", ext: "mp4", vcodec: "avc1", acodec: "mp4a", height: 360, tbr: 500, filesize: 2000000 },
  { format_id: "43", url: "http://x/43", ext: "webm", vcodec: "vp8", acodec: "vorbis", height: 360, tbr: 600 },
  { format_id: "136", url: "http://x/136", ext: "mp4", vcodec: "avc1", acodec: "none", height: 720 },
  { format_id: "140", url: "http://x/140", ext: "m4a", vcodec: "none", acodec: "mp4a", abr: 128 },
  { format_id: "251", url: "http://x/251", ext: "webm", vcodec: "none", acodec: "opus", abr: 160 },
  { format_id: "999", url: null, ext: "mp4", vcodec: "avc1", acodec: "mp4a", height: 1080 },
];

(async () => {
  console.log("Arya Downloader tests");
  const { cleanUrl, platformOf, pickQualities, pickAudio } = require("../server.js");

  console.log("\n[1] URL allowlist");
  ok("youtube ok", cleanUrl("https://www.youtube.com/watch?v=abc") !== null);
  ok("youtu.be ok", cleanUrl("https://youtu.be/abc") !== null);
  ok("instagram ok", cleanUrl("https://www.instagram.com/reel/xyz/") !== null);
  ok("pinterest ok", cleanUrl("https://pin.it/abc") !== null);
  ok("evil blocked", cleanUrl("https://evil.com/watch?v=abc") === null);
  ok("non-http blocked", cleanUrl("ftp://x.com/a") === null);
  ok("file blocked", cleanUrl("file:///etc/passwd") === null);
  ok("subdomain trick blocked", cleanUrl("https://youtube.com.evil.com/a") === null);

  console.log("\n[2] platform detect");
  ok("yt", platformOf("https://youtu.be/a") === "YouTube");
  ok("ig", platformOf("https://instagram.com/p/a") === "Instagram");

  console.log("\n[3] quality picking (fixture)");
  const qs = pickQualities(fixtureFormats);
  ok("2 qualities", qs.length === 2, JSON.stringify(qs.map((q) => q.label)));
  ok("720p first", qs[0].label === "720p");
  ok("mp4 preferred over webm at 360p", qs[1].id === "18");
  ok("video-only excluded", !qs.some((q) => q.id === "136"));
  ok("url-less excluded", !qs.some((q) => q.id === "999"));
  const au = pickAudio(fixtureFormats);
  ok("best audio picked", au && au.id === "251", au && au.id);

  console.log("\n[4] server boot + endpoints");
  const srv = spawn("node", ["server.js"], {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, PORT: String(PORT) },
    stdio: "pipe",
  });
  srv.stderr.on("data", (d) => process.stderr.write("[srv-err] " + d));
  let up = false;
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + "/healthz"); if (r.ok) { up = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  ok("server boots", up);
  if (up) {
    const jpost = async (p, body) => {
      const r = await fetch(BASE + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      let j = null; try { j = await r.json(); } catch {}
      return { r, j };
    };
    const bad = await jpost("/api/info", { url: "https://evil.com/x" });
    ok("info rejects evil domain (400)", bad.r.status === 400);
    const bad2 = await jpost("/api/resolve", { url: "https://www.youtube.com/watch?v=a", format_id: "../x" });
    ok("resolve rejects bad format_id", bad2.r.status === 400);
    const bad3 = await jpost("/api/resolve", { url: "https://www.youtube.com/watch?v=a", format_id: "" });
    ok("resolve rejects empty format_id", bad3.r.status === 400);
    const idx = await fetch(BASE + "/");
    ok("index served", idx.ok && (await idx.text()).includes("Arya Downloader"));
  }
  srv.kill();

  console.log(`\n==== ${pass} pass, ${fail} fail ====`);
  process.exit(fail ? 1 : 0);
})();
