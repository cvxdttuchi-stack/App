// Veda AI v2.0 — server
// BYOK: server bina kisi API key ke boot hota hai. User kisi bhi AI (Gemini/DeepSeek/Qwen/GLM/OpenAI/Claude/Groq/...) ki key
// app ki Settings me daalta hai; har request me x-api-key / x-llama-key header aati hai.
// Endpoints: chat (SSE streaming), models, news (Google News RSS, keyless),
// zip debugger (analyze/rebuild), audio transcribe (user ki key se Gemini).
// By Shailesh Arya.

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Readable, pipeline } = require("stream");
const AdmZip = require("adm-zip");
const {
  fetchWithRetry, REGISTRY, safeBase, getEntries, classify, KIND_HI, errText,
  verifyKey, detectProvider, resolveAuto, listModelIds, openaiChat, pipeOpenAIAsGemini,
} = require("./providers");

const app = express();
const PORT = process.env.PORT || 3000;
const API = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const ACCESS_CODE = process.env.ACCESS_CODE || "";

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use((req, res, next) => {
  res.set({
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "SAMEORIGIN",
    "Permissions-Policy": "microphone=(self), camera=(self), geolocation=()",
  });
  next();
});
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "5m" }));

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ok = (res, obj) => res.json({ ok: true, ...obj });
const fail = (res, code, hindi, extra = {}) =>
  res.status(code).json({ error: hindi, ...extra });

// ---------- rate limit (har IP par 1 minute me 90 request) ----------
const hits = new Map();
function limiter(max) {
  return (req, res, next) => {
    const ip = (req.ip || "x") + "|" + req.path.split("/")[2];
    const now = Date.now();
    const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
    if (arr.length >= max) return fail(res, 429, "Bahut zyada request bhej di. Ek minute ruk kar dobara try karo.", { retryable: true });
    arr.push(now);
    hits.set(ip, arr);
    next();
  };
}
const rateLimit = limiter(90);
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) if (!arr.some((t) => now - t < 60000)) hits.delete(ip);
}, 120000).unref();

// ---------- access code (optional; public link ki suraksha ke liye) ----------
function auth(req, res, next) {
  if (ACCESS_CODE && req.get("x-access-code") !== ACCESS_CODE) {
    return fail(res, 401, "Access code galat hai ya nahi diya. Settings me daalo.");
  }
  next();
}

// ---------- config ----------
app.get("/api/config", (req, res) => {
  ok(res, {
    app: "Veda AI",
    byok: true, // server par koi key nahi; keys Settings se har request me aati hain
    needsCode: !!ACCESS_CODE,
    providers: Object.entries(REGISTRY).map(([id, r]) => ({ id, name: r.name, emoji: r.emoji, model: r.model || "" })),
    features: { news: true, zipDebugger: true, transcribe: true, pdfStudio: "client-side", pdfEditor: "client-side", multiKey: true },
  });
});

// ---------- Gemini helpers ----------
async function gget(url, key) {
  return fetchWithRetry(url, { headers: { "x-goog-api-key": key } }, { retries: 2, timeoutMs: 20000 });
}
const hash = (k) => crypto.createHash("sha1").update(k).digest("hex").slice(0, 12);
const modelCache = new Map();
const allCache = new Map();
function versionOf(name) {
  const m = String(name).match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}
async function listAll(key) {
  const h = hash(key);
  const c = allCache.get(h);
  if (c && Date.now() - c.t < 10 * 60 * 1000) return c.list;
  const r = await gget(`${API}/models?pageSize=200`, key);
  if (!r.ok) {
    const msg = await errText(r);
    const err = new Error(msg); err.status = r.status; throw err;
  }
  const j = await r.json();
  const list = (j.models || []).map((m) => ({ name: m.name.replace(/^models\//, ""), methods: m.supportedGenerationMethods || [] }));
  allCache.set(h, { t: Date.now(), list });
  return list;
}
async function listModels(key) {
  const h = hash(key);
  const c = modelCache.get(h);
  if (c && Date.now() - c.t < 10 * 60 * 1000) return c.list;
  const all = await listAll(key);
  const list = all
    .filter((m) => m.methods.includes("generateContent"))
    .map((m) => m.name)
    .filter((n) => /^gemini-/.test(n) && !/(image|tts|live|audio|embedding|robotics|computer-use|native|banana)/.test(n));
  modelCache.set(h, { t: Date.now(), list });
  return list;
}
function rank(list) {
  const flash = list.filter((n) => /flash/.test(n) && !/lite/.test(n));
  const lite = list.filter((n) => /lite/.test(n));
  const pro = list.filter((n) => /pro/.test(n));
  const sortFn = (a, b) => {
    const pa = /preview|exp/.test(a) ? 0 : 1;
    const pb = /preview|exp/.test(b) ? 0 : 1;
    if (pa !== pb) return pb - pa;
    return versionOf(b) - versionOf(a);
  };
  return { flash: flash.sort(sortFn), lite: lite.sort(sortFn), pro: pro.sort(sortFn) };
}

// ---------- key pehchano + jaancho (Settings me "Jodo" dabane par) ----------
app.post("/api/detect", rateLimit, auth, async (req, res) => {
  try {
    const b = req.body || {};
    const key = String(b.key || "").trim();
    if (!key || key.length < 8 || key.length > 400 || /\s/.test(key)) return fail(res, 400, "Key sahi nahi lag rahi (khali/space wali). Dobara copy-paste karo.");
    const hint = String(b.provider || "auto").toLowerCase();
    const base = b.base ? String(b.base) : "";
    const m = String(b.model || "").slice(0, 120);
    if (hint === "custom") {
      if (!safeBase(base)) return fail(res, 400, "Custom AI ke liye sahi https Base URL chahiye (jaise https://api.example.com/v1).");
    }
    const det = await detectProvider(key, hint);
    const tried = [];
    const mk = (p) => ({ p, k: key, b: p === "custom" ? base : "", m });
    const okRes = (p, v) => ok(res, {
      provider: p, name: REGISTRY[p].name, emoji: REGISTRY[p].emoji,
      base: v.base && p !== "gemini" && v.base !== REGISTRY[p].base ? v.base : "",
      models: (v.models || []).slice(0, 150), verified: !v.unverified,
      note: v.note || (v.unverified ? "Key save ho gayi (is AI me jaanch ka rasta nahi, chat se pata chalega)." : ""),
    });
    if (det.probeAll) {
      // Koi niyam nahi mila: sab par ek saath sakht jaanch, jo pehle (list ke kram me) sahi nikle wahi.
      const results = await Promise.all(det.candidates.map((p) => verifyKey(mk(p), { strict: true }).then((v) => ({ p, v }))));
      const hit = results.find((x) => x.v.ok);
      if (hit) return okRes(hit.p, hit.v);
      results.forEach((x) => tried.push({ p: x.p, ok: false, status: x.v.status, kind: x.v.kind }));
    } else {
      for (const p of det.candidates) {
        const v = await verifyKey(mk(p));
        tried.push({ p, ok: v.ok, status: v.status, kind: v.kind });
        if (v.ok) return okRes(p, v);
        if (v.kind === "net" && det.candidates.length === 1) {
          return ok(res, { provider: p, name: REGISTRY[p].name, emoji: REGISTRY[p].emoji, base: "", models: [], verified: false, note: "Abhi internet se jaanch nahi ho payi, key save kar li." });
        }
      }
    }
    if (hint === "auto") {
      // Pehchan na ho paye tab bhi rok-tok nahi: key save ho jaye, chat ke samay khud koshish karegi.
      return ok(res, { provider: "auto", name: "Auto (pehchan khud)", emoji: "✨", base: "", models: [], verified: false,
        note: "⚠️ Abhi kisi AI ne ye key nahi pehchani — phir bhi save ki. Chat ke samay khud koshish karegi; na chale to Connection test dekho." });
    }
    return fail(res, 401, "Ye key chuni hui AI me kaam nahi kar rahi (galat/expire, ya Base URL galat). Dobara copy karo.");
  } catch (e) {
    fail(res, 500, "Key jaanchne me dikkat: " + String((e && e.message) || e).slice(0, 140));
  }
});

app.get("/api/models", rateLimit, auth, async (req, res) => {
  try {
    const entries = getEntries(req);
    const e = entries[0];
    if (!e) return fail(res, 400, "Koi API key nahi mili. Settings me apni key paste karo.");
    if (e.p === "gemini") {
      const list = await listModels(e.k);
      return ok(res, { models: list, ...rank(list), provider: "gemini" });
    }
    const ids = await listModelIds(e);
    const def = REGISTRY[e.p].model;
    const models = ids.length ? ids : def ? [def] : [];
    ok(res, { models, provider: e.p });
  } catch (e) {
    const st = e && e.status;
    fail(res, st === 401 || st === 403 || st === 400 ? 401 : 502, st === 400 || st === 401 || st === 403 ? "Key galat/expire lag rahi hai." : "Models list nahi mil paayi: " + String((e && e.message) || e).slice(0, 200));
  }
});

// ---------- chat (streaming) ----------
function sseHeaders(res, modelUsed, providerName, fallbackNote) {
  res.status(200);
  const h = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Model-Used": String(modelUsed).replace(/[^\x20-\x7e]/g, "").slice(0, 100),
    "X-Provider": providerName,
    "Access-Control-Expose-Headers": "X-Model-Used, X-Provider, X-Fallback",
  };
  if (fallbackNote) h["X-Fallback"] = fallbackNote.replace(/[^\x20-\x7e]/g, "").slice(0, 300);
  res.set(h);
  if (res.flushHeaders) res.flushHeaders();
}

const NEEDS_FRESH = /(taaza|taza|aaj|abhi|abhee|\bkal\b|news|khabar|samachar|score|mausam|weather|daam|price|bhav|election|chunav|launch|releas|\bkab\b|live|headline)/i;

// Gemini: ek key par kai models try karo. Free tier me quota PER-MODEL hoti hai,
// isliye ek model ka 429 aane par agla model (flash -> lite -> pro) turant try hota hai.
async function tryGemini(e, { contents, sys, temperature, search, reqModel, signal }) {
  let candidates = [];
  try {
    const list = await listModels(e.k);
    const r = rank(list);
    const pick = e.m && e.m !== "auto" ? e.m : (reqModel && /^gemini/.test(reqModel) ? reqModel : "");
    if (pick) candidates.push(pick);
    candidates.push(...r.flash.slice(0, 3), ...r.lite.slice(0, 2), ...r.pro.slice(0, 1));
  } catch (err) {
    const k = classify(err.status || 0, err.message);
    if (k === "auth") return { ok: false, kind: "auth", msg: err.message };
    if (e.m && e.m !== "auto") candidates.push(e.m);
  }
  candidates = [...new Set(candidates)];
  if (!candidates.length) candidates = ["gemini-flash-latest", "gemini-flash-lite-latest"];

  const baseBody = {
    contents,
    systemInstruction: { parts: [{ text: sys }] },
    generationConfig: { temperature: typeof temperature === "number" ? temperature : 0.7, maxOutputTokens: 65536 },
  };
  let _u = "";
  try { for (const c of contents) for (const p of c.parts || []) if (p && p.text) _u += " " + p.text; } catch {}
  let useSearch = search !== false && NEEDS_FRESH.test(_u);

  let last = { kind: "server", msg: "Koi model jawab nahi de paya." };
  let sawQuota = false;
  for (const m of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const body = { ...baseBody, generationConfig: { ...baseBody.generationConfig } };
      if (useSearch) body.tools = [{ google_search: {} }];
      let up;
      try {
        up = await fetchWithRetry(`${API}/models/${m}:streamGenerateContent?alt=sse`,
          { method: "POST", signal, headers: { "Content-Type": "application/json", "x-goog-api-key": e.k }, body: JSON.stringify(body) },
          { retries: 1, skip429: true, timeoutMs: 45000 });
      } catch (err) {
        if (signal.aborted) throw err;
        last = { kind: "net", msg: `${m}: ${String((err && err.message) || err).slice(0, 100)}` };
        break;
      }
      if (up.ok) return { ok: true, up, model: m };
      const msg = await errText(up);
      const kind = classify(up.status, msg);
      last = { kind, msg: `${m}: ${msg}` };
      if (up.status === 400 && kind !== "auth" && /maxOutput|max_output|token/i.test(msg) && baseBody.generationConfig.maxOutputTokens) {
        delete baseBody.generationConfig.maxOutputTokens; attempt--; continue;
      }
      if (up.status === 400 && useSearch && /tool|search|ground/i.test(msg)) { useSearch = false; attempt--; continue; }
      if (kind === "auth") return { ok: false, kind: "auth", msg };
      if (kind === "quota") { sawQuota = true; break; } // agla model
      if (kind === "model") break;
      if (kind === "server") { if (attempt === 0) { await sleep(900); continue; } break; }
      if (kind === "bad") return { ok: false, kind: "bad", msg };
      break;
    }
  }
  if (sawQuota) return { ok: false, kind: "quota", msg: "Is key ke saare Gemini models ki free limit khatm. " + last.msg.slice(0, 120) };
  return { ok: false, kind: last.kind, msg: last.msg };
}

app.post("/api/chat", rateLimit, auth, async (req, res) => {
  try {
    const entries = getEntries(req);
    if (!entries.length) {
      return fail(res, 400, "Koi API key nahi mili. ☰ Settings me kisi bhi AI ki key paste karo (Gemini, DeepSeek, Qwen, GLM, OpenAI, Claude, Groq …).");
    }
    const { model, contents, system, temperature, search } = req.body || {};
    if (!Array.isArray(contents) || !contents.length) return fail(res, 400, "Khali message bheja gaya.");

    const nowIST = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" });
    const sys = (system || "") + "\n\n[Server samay: " + nowIST + " IST. Taaza khabar/daam/score/weather/'abhi' wale sawal par jaanch kar hi jawab do, tareekh saath likho.]";

    const controller = new AbortController();
    res.on("close", () => controller.abort());

    const failures = []; // {p, kind, msg}
    for (let i = 0; i < entries.length; i++) {
      let e = entries[i];
      if (controller.signal.aborted) return;
      if (e.p === "auto") {
        const rr = await resolveAuto(e.k).catch(() => null);
        if (!rr) { failures.push({ p: "auto", kind: "auth", msg: "Ye key kisi bhi supported AI me nahi chali" }); continue; }
        e = { ...e, p: rr.p, b: rr.b || e.b };
      }
      let r;
      try {
        r = e.p === "gemini"
          ? await tryGemini(e, { contents, sys, temperature, search, reqModel: i === 0 ? model : "", signal: controller.signal })
          : await openaiChat(e, { contents, system: sys, temperature, signal: controller.signal });
      } catch (err) {
        if (controller.signal.aborted) return;
        r = { ok: false, kind: "net", msg: String((err && err.message) || err).slice(0, 140) };
      }
      if (r.ok) {
        const note = failures.map((f) => f.p + ":" + f.kind).join(",");
        sseHeaders(res, r.model, e.p, note);
        if (e.p === "gemini") {
          pipeline(Readable.fromWeb(r.up.body), res, () => {});
        } else {
          try { await pipeOpenAIAsGemini(r.up, res); } catch { try { res.end(); } catch {} }
        }
        return;
      }
      failures.push({ p: e.p, kind: r.kind, msg: r.msg });
    }

    // Sab keys fail: har ek ka saaf kaaran batao
    const lines = failures.map((f) => `${REGISTRY[f.p].emoji} ${REGISTRY[f.p].name}: ${KIND_HI[f.kind] || f.kind}`);
    const anyQuota = failures.some((f) => f.kind === "quota");
    const allAuth = failures.every((f) => f.kind === "auth");
    let tip;
    if (allAuth) tip = "Key galat ya expire hai — ☰ Settings me dobara paste karo.";
    else if (anyQuota) tip = "Free limit khatm. Thodi der baad try karo, ya ☰ Settings me doosre AI (DeepSeek / Qwen / GLM / Groq …) ki ek aur key jodo — wo apne aap chalegi.";
    else tip = "AI service abhi busy hai. Thodi der baad dobara try karo.";
    const detail = failures.map((f) => String(f.msg || "").slice(0, 140)).filter(Boolean).join(" | ");
    fail(res, allAuth ? 401 : anyQuota ? 429 : 502, lines.join(" · ") + "\n" + tip + (detail ? "\n(" + detail.slice(0, 260) + ")" : ""), { retryable: !allAuth, failures: failures.map((f) => ({ p: f.p, kind: f.kind })) });
  } catch (e) {
    if (res.headersSent) { try { res.end(); } catch {} return; }
    fail(res, 500, "Server me gadbad hui: " + String((e && e.message) || e).slice(0, 160));
  }
});

// ---------- live news: Google News RSS (keyless) ----------
// Imaandaar label: ye RSS headlines hain, Google-grounded search nahi.
const newsCache = new Map(); // feed -> {t, data}
const NEWS_FEEDS = {
  india: "https://news.google.com/rss?hl=hi&gl=IN&ceid=IN:hi",
  world: "https://news.google.com/rss?hl=en-IN&gl=IN&ceid=IN:en",
};
const unesc = (s) => String(s || "")
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
  .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
function parseRss(xml, limit) {
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const b = m[1];
    const pick = (tag) => { const x = b.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">")); return x ? unesc(x[1]) : ""; };
    const src = b.match(/<source[^>]*>([\s\S]*?)<\/source>/);
    const title = pick("title");
    if (!title) continue;
    items.push({ title, link: pick("link"), pubDate: pick("pubDate"), source: src ? unesc(src[1]) : "" });
  }
  return items;
}
app.get("/api/news", rateLimit, auth, async (req, res) => {
  try {
    const feed = NEWS_FEEDS[req.query.feed] ? req.query.feed : "india";
    const c = newsCache.get(feed);
    if (c && Date.now() - c.t < 10 * 60 * 1000) return ok(res, { ...c.data, cached: true });
    const ctrl = new AbortController();
    const to = setTimeout(() => ctrl.abort(), 15000);
    let xml;
    try {
      const r = await fetch(NEWS_FEEDS[feed], { signal: ctrl.signal, headers: { "User-Agent": "VedaAI/1.0" } });
      clearTimeout(to);
      if (!r.ok) return fail(res, 502, "News feed abhi nahi mil paayi (" + r.status + "). Thodi der baad try karo.", { retryable: true });
      xml = await r.text();
    } catch (e) {
      clearTimeout(to);
      return fail(res, 502, "News feed tak pahunch nahi paaye. Internet check karo.", { retryable: true });
    }
    const headlines = parseRss(xml, 20);
    if (!headlines.length) return fail(res, 502, "News feed khali mili. Thodi der baad try karo.", { retryable: true });
    const data = {
      feed,
      label: "Google News RSS headlines",
      fetchedAt: new Date().toISOString(),
      fetchedAtIST: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" }),
      headlines,
    };
    newsCache.set(feed, { t: Date.now(), data });
    ok(res, { ...data, cached: false });
  } catch (e) {
    fail(res, 500, "News lane me dikkat aayi: " + String((e && e.message) || e).slice(0, 140));
  }
});

// ---------- ZIP DEBUGGER ----------
// analyze: zip ka poora tree + text files ka content (AI jaanch ke liye)
// rebuild: AI ke diye fixed files ko wapas zip me daal kar nayi zip do
const TEXT_EXT = new Set(["js", "jsx", "ts", "tsx", "mjs", "cjs", "json", "html", "htm", "css", "md", "txt", "py", "java", "c", "h", "cpp", "cc", "xml", "yml", "yaml", "toml", "ini", "cfg", "vue", "php", "rb", "go", "rs", "sh", "sql", "tsv", "csv", "gitignore"]);
const MAX_ZIP_BYTES = 25 * 1024 * 1024;
function zipFromBody(b) {
  const s = String((b && b.zip) || "");
  if (!s) throw new Error("ZIP data nahi mila.");
  const buf = Buffer.from(s, "base64");
  if (!buf.length || buf.length > MAX_ZIP_BYTES) throw new Error("ZIP 25MB se badi hai ya khali hai.");
  if (buf[0] !== 0x50 || buf[1] !== 0x4b) throw new Error("Ye sahi ZIP file nahi lag rahi.");
  return new AdmZip(buf);
}
function isTextEntry(e) {
  if (e.isDirectory || e.header.size > 400 * 1024) return false;
  const name = e.entryName;
  if (/(^|\/)\./.test(name)) return false; // hidden files chhodo
  const ext = name.split(".").pop().toLowerCase();
  if (TEXT_EXT.has(ext) || !name.includes(".")) {
    const head = e.getData().slice(0, 1024);
    if (head.includes(0)) return false; // binary
    return true;
  }
  return false;
}
app.post("/api/zip/analyze", rateLimit, auth, (req, res) => {
  try {
    const zip = zipFromBody(req.body);
    const entries = zip.getEntries();
    const tree = entries.slice(0, 2000).map((e) => ({ path: e.entryName, dir: e.isDirectory, size: e.header.size }));
    const files = {};
    const skipped = [];
    let pkg = null;
    for (const e of entries) {
      if (e.isDirectory) continue;
      if (/package\.json$/i.test(e.entryName) && e.header.size < 200 * 1024 && !pkg) {
        try {
          const j = JSON.parse(e.getData().toString("utf8"));
          pkg = { path: e.entryName, name: j.name, version: j.version, scripts: j.scripts, dependencies: j.dependencies };
        } catch {}
      }
      if (Object.keys(files).length >= 25) { skipped.push(e.entryName); continue; }
      if (isTextEntry(e)) {
        const text = e.getData().toString("utf8");
        files[e.entryName] = text.length > 120 * 1024 ? text.slice(0, 120 * 1024) + "\n…[aage kaat diya gaya]" : text;
      }
    }
    ok(res, {
      totalEntries: entries.length,
      tree,
      files,
      skippedText: skipped.slice(0, 20),
      packageJson: pkg,
      note: "25 tak text files bheji gayin. AI inhe padh kar bug dhoondhega.",
    });
  } catch (e) {
    fail(res, 400, "ZIP analyze nahi ho paayi: " + String((e && e.message) || e).slice(0, 200));
  }
});
app.post("/api/zip/rebuild", rateLimit, auth, (req, res) => {
  try {
    const zip = zipFromBody(req.body);
    const files = (req.body && req.body.files) || {};
    const remove = (req.body && req.body.remove) || [];
    const paths = Object.keys(files).slice(0, 60);
    if (!paths.length && !remove.length) return fail(res, 400, "Fix ki hui koi file nahi mili.");
    for (const p of paths) {
      const sp = String(p).replace(/\\/g, "/").replace(/^\/+/, "").slice(0, 300);
      if (!sp || sp.includes("..")) continue;
      // (fix) updateFile sirf maujooda entry badalta hai; AI ne zip me nayi file di to wo judti hi nahi thi -> addFile
      const buf = Buffer.from(String(files[p]), "utf8");
      if (zip.getEntry(sp)) zip.updateFile(sp, buf); else zip.addFile(sp, buf);
    }
    for (const p of [].concat(remove).slice(0, 60)) {
      const sp = String(p).replace(/\\/g, "/").replace(/^\/+/, "");
      if (sp) zip.deleteFile(sp);
    }
    const buf = zip.toBuffer();
    ok(res, { zip: buf.toString("base64"), bytes: buf.length, updated: paths.length });
  } catch (e) {
    fail(res, 400, "Nayi ZIP nahi ban paayi: " + String((e && e.message) || e).slice(0, 200));
  }
});

// ---------- voice transcribe (user ki Gemini key se; MediaRecorder fallback ke liye) ----------
app.post("/api/transcribe", rateLimit, auth, async (req, res) => {
  try {
    const ge = getEntries(req).find((x) => x.p === "gemini");
    const key = ge ? ge.k : "";
    if (!key) return fail(res, 400, "Awaaz→text ke liye Settings me Gemini key chahiye (ya phone ka mic use karo).");
    const b = req.body || {};
    const audio = String(b.audio || "");
    if (!audio) return fail(res, 400, "Audio nahi mila.");
    const buf = Buffer.from(audio, "base64");
    if (buf.length > 9 * 1024 * 1024) return fail(res, 413, "Audio bahut bada hai (9MB tak).");
    const mime = String(b.mime || "audio/webm").slice(0, 60);
    const lang = /en/i.test(String(b.lang || "")) ? "English" : "Hindi (Devanagari me likho)";
    let models = [];
    try { models = rank(await listModels(key)).flash.slice(0, 2); } catch {}
    if (!models.length) models = ["gemini-flash-latest"];
    let lastErr = "";
    for (const m of models) {
      try {
        const r = await fetchWithRetry(`${API}/models/${m}:generateContent`,
          { method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
            body: JSON.stringify({
              contents: [{ parts: [
                { text: `Is audio ko ${lang} me bilkul sahi transcribe karo. Sirf bola gaya text likho, koi commentary ya explanation mat jodo.` },
                { inlineData: { mimeType: mime, data: audio } },
              ] }],
            }) },
          { retries: 1, skip429: true, timeoutMs: 45000 });
        if (!r.ok) {
          lastErr = `${m}: ${await errText(r)}`;
          if (r.status === 429) return fail(res, 429, "API quota khatm. Thodi der baad try karo.", { retryable: true });
          if (r.status === 401 || r.status === 403) return fail(res, r.status, "API key galat ya permission nahi.");
          continue;
        }
        const j = await r.json();
        const parts = (((j.candidates || [])[0] || {}).content || {}).parts || [];
        const out = parts.map((p) => p.text || "").join("").trim();
        if (!out) { lastErr = m + ": khali transcript"; continue; }
        return ok(res, { text: out, model: m });
      } catch (e) {
        lastErr = `${m}: ${String((e && e.message) || e).slice(0, 120)}`;
      }
    }
    fail(res, 502, "Audio samajh nahi paaya (" + String(lastErr).slice(0, 160) + "). Dobara saaf bolo.", { retryable: true });
  } catch (e) {
    fail(res, 500, "Transcribe me dikkat: " + String((e && e.message) || e).slice(0, 140));
  }
});

app.get("/healthz", (req, res) => res.send("ok"));

// ---------- errors ----------
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const tooBig = err && err.type === "entity.too.large";
  fail(res, tooBig ? 413 : 400, tooBig ? "Data bahut bada hai (40MB se kam rakho)." : "Request sahi nahi thi.");
});

app.listen(PORT, () => console.log("Veda AI chal raha hai: port " + PORT + " (BYOK mode — server par koi key nahi)"));
