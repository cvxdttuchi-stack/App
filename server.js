// Veda AI v1.0 — server
// BYOK: server bina kisi API key ke boot hota hai. User apni Gemini/Llama key
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
  fetchWithRetry, GeminiProvider, LlamaProvider,
  geminiToOpenAI, pipeLlamaAsGemini, getChatProvider, LLAMA_MODEL_DEFAULT,
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
  const { provider, requested } = getChatProvider(req);
  ok(res, {
    app: "Veda AI",
    byok: true, // server par koi key nahi; key Settings se har request me aati hai
    needsCode: !!ACCESS_CODE,
    provider: provider.name,
    providerRequested: requested,
    llamaDefault: LLAMA_MODEL_DEFAULT,
    llamaNote: "Llama BYOK hai aur abhi poori tarah test nahi hua — nateeje alag ho sakte hain.",
    features: { news: true, zipDebugger: true, transcribe: true, pdfStudio: "client-side" },
  });
});

// ---------- Gemini helpers ----------
async function gget(url, key) {
  // v1.3: models list latak jaye to 20s me timeout — pehle bina timeout ke hamesha atak sakta tha
  return fetchWithRetry(url, { headers: { "x-goog-api-key": key } }, { retries: 2, timeoutMs: 20000 });
}
async function errText(r) {
  try {
    const j = await r.json();
    return (j.error && j.error.message) || JSON.stringify(j).slice(0, 300);
  } catch {
    return "HTTP " + r.status;
  }
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
  if (!r.ok) throw new Error("Models list nahi mili (" + r.status + "). API key check karo.");
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

app.get("/api/models", rateLimit, auth, async (req, res) => {
  try {
    const { provider, key: provKey, missingKey } = getChatProvider(req);
    if (provider.name === "llama") {
      const key = provKey || "";
      if (!key || missingKey) return fail(res, 400, "Llama chuna hai par key nahi mili. Settings me apni Llama API key daalo.");
      const models = await provider.listModels(key).catch(() => [LLAMA_MODEL_DEFAULT]);
      return ok(res, { models, provider: "llama", untested: true });
    }
    const key = (req.get("x-api-key") || "").trim();
    if (!key) return fail(res, 400, "API key nahi mili. Settings me apni Gemini key daalo.");
    const list = await listModels(key);
    ok(res, { models: list, ...rank(list), provider: "gemini" });
  } catch (e) {
    fail(res, 502, "Models list nahi mil paayi: " + String((e && e.message) || e).slice(0, 200));
  }
});

// ---------- chat (streaming) ----------
async function callGemini(model, key, body, signal) {
  // skip429: quota poori KEY ki hoti hai — retry bekaar, turant imaandaar error do.
  return fetchWithRetry(`${API}/models/${model}:streamGenerateContent?alt=sse`,
    { method: "POST", signal, headers: { "Content-Type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) },
    { retries: 3, skip429: true });
}
async function callLlama(key, body, signal) {
  const base = process.env.LLAMA_API_BASE || "https://api.llama.com/compat/v1";
  return fetchWithRetry(`${base}/chat/completions`,
    { method: "POST", signal, headers: { "Content-Type": "application/json", Authorization: "Bearer " + key }, body: JSON.stringify(body) },
    { retries: 2 });
}
function sseHeaders(res, modelUsed, providerName) {
  res.status(200);
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "X-Model-Used": modelUsed,
    "X-Provider": providerName,
    "Access-Control-Expose-Headers": "X-Model-Used, X-Provider",
  });
  if (res.flushHeaders) res.flushHeaders();
}

app.post("/api/chat", rateLimit, auth, async (req, res) => {
  try {
    const bodyProv = String((req.body && req.body.provider) || "").toLowerCase();
    if (bodyProv === "llama" || bodyProv === "gemini") req.headers["x-ai-provider"] = bodyProv;
    const { provider, key: provKey, missingKey } = getChatProvider(req);
    if (provider.name === "llama" && missingKey) {
      return fail(res, 400, "Llama chuna hai par key nahi mili. Settings me apni Llama API key daalo.");
    }
    if (!provider.breaker.canRun()) {
      return fail(res, 503, "AI service abhi bahut busy hai. Ek minute baad dobara try karo.", { retryable: true });
    }
    const key = provider.name === "llama" ? provKey : (req.get("x-api-key") || "").trim();
    if (!key) {
      // (fix) key na hona user ki galti hai — circuit breaker (jo sab users ke liye hai) ko mat chhedo
      return fail(res, 400, provider.name === "llama"
        ? "Llama API key nahi mili. Settings me daalo."
        : "Gemini API key nahi mili. Settings me apni free key daalo (Google AI Studio se milti hai).");
    }

    const { model, contents, system, temperature, search } = req.body || {};
    if (!Array.isArray(contents) || !contents.length) return fail(res, 400, "Khali message bheja gaya.");

    const nowIST = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "full", timeStyle: "short" });
    const sys = (system || "") + "\n\n[Server samay: " + nowIST + " IST. Taaza khabar/daam/score/weather/'abhi' wale sawal par Google Search se jaanch kar hi jawab do, tareekh saath likho.]";

    const controller = new AbortController();
    res.on("close", () => controller.abort());

    // ---- Meta Llama path (OpenAI-compatible, BYOK) ----
    if (provider.name === "llama") {
      const useModel = model && model !== "auto" ? model : LLAMA_MODEL_DEFAULT;
      const body = provider.buildBody({ contents, system: sys, temperature, maxTokens: 8192 });
      body.model = useModel;
      let up;
      try {
        up = await callLlama(key, body, controller.signal);
      } catch (e) {
        provider.breaker.fail();
        if (controller.signal.aborted) return;
        return fail(res, 502, "Llama API tak pahunch nahi paaye: " + String(e.message || e).slice(0, 160), { retryable: true });
      }
      if (!up.ok) {
        // (fix) sirf server-side (5xx) dikkat breaker ko gine; galat key / quota / bad request user ki apni baat hai
        if (up.status >= 500) provider.breaker.fail();
        const msg = await errText(up);
        if (up.status === 401 || up.status === 403) return fail(res, up.status, "Llama API key galat ya permission nahi: " + msg);
        if (up.status === 429) return fail(res, 429, "Llama quota/rate limit. Thodi der baad try karo.", { retryable: true });
        if (up.status === 400) return fail(res, 400, msg);
        return fail(res, 502, "Llama API se jawab nahi aaya (" + up.status + "): " + msg, { retryable: true });
      }
      provider.breaker.ok();
      sseHeaders(res, useModel, "llama");
      await pipeLlamaAsGemini(up, res);
      return;
    }

    // ---- Gemini path (default) ----
    let candidates = [];
    try {
      const list = await listModels(key);
      const r = rank(list);
      if (model && model !== "auto") candidates.push(model);
      // (fix) free quota MODEL ke hisab se hoti hai; sabse naye model par quota 0 ho sakta hai, isliye peeche purane stable models bhi rakhe
      candidates.push(...r.flash.slice(0, 6), ...r.lite.slice(0, 3));
    } catch {
      if (model && model !== "auto") candidates.push(model);
    }
    candidates = [...new Set(candidates)];
    if (!candidates.length) candidates = ["gemini-flash-latest", "gemini-flash-lite-latest"];

    const baseBody = {
      contents,
      systemInstruction: { parts: [{ text: sys }] },
      generationConfig: {
        temperature: typeof temperature === "number" ? temperature : 0.7,
        maxOutputTokens: 65536, // unlimited jaisa: model ka max; na chale to neeche hata diya jata hai
      },
    };

    let lastErr = "Koi model jawab nahi de paya.";
    let quotaHit = "";
    // Quota bachao: Google Search grounding sirf tab jab sawal me taaza jaankari chahiye.
    // Har "Hello" par search lagana free quota kha jata hai (v1.2 fix).
    let _uText = "";
    try { for (const c of (contents || [])) for (const p of (c.parts || [])) if (p && p.text) _uText += " " + p.text; } catch {}
    const NEEDS_FRESH = /(taaza|taza|aaj|abhi|abhee|\bkal\b|news|khabar|samachar|score|mausam|weather|daam|price|bhav|election|chunav|launch|releas|\bkab\b|live|headline)/i;
    let useSearch = search !== false && NEEDS_FRESH.test(_uText);

    for (const m of candidates) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const body = { ...baseBody, generationConfig: { ...baseBody.generationConfig } };
        try {
          if (useSearch) body.tools = [{ google_search: {} }];
          const up = await callGemini(m, key, body, controller.signal);
          if (up.ok) {
            provider.breaker.ok();
            sseHeaders(res, m, "gemini");
            // (fix) pipeline: client Stop/tab band karne par upstream abort ka error pehle
            // unhandled rehta tha aur poora server crash ho jata tha.
            pipeline(Readable.fromWeb(up.body), res, () => {});
            return;
          }
          lastErr = `${m}: ${await errText(up)}`;
          if (up.status === 400 && /maxOutput|max_output|token/i.test(lastErr) && body.generationConfig.maxOutputTokens) {
            delete baseBody.generationConfig.maxOutputTokens;
            attempt--;
            continue;
          }
          if (up.status === 400 && useSearch && /tool|search|ground/i.test(lastErr)) {
            useSearch = false;
            attempt--;
            continue;
          }
          if (up.status === 401 || up.status === 403) {
            return fail(res, up.status, "API key galat ya permission nahi: " + lastErr);
          }
          if (up.status === 400) return fail(res, 400, lastErr);
          if (up.status === 404) break; // model nahi hai -> agla
          if (up.status === 429) {
            // (fix) Gemini quota har MODEL ki alag hoti hai. Pehle yahin ruk jate the, isliye naya/zyada naya model
            // (jiska free quota 0 hai) milte hi nayi key par bhi har baar "quota khatm" aata tha. Ab agla model try hota hai.
            quotaHit = quotaHit || `${m}: ${lastErr.replace(m + ": ", "")}`;
            break; // retry nahi (fail-fast), seedha agla model
          }
          if (up.status >= 500) {
            if (attempt === 0) await sleep(1200);
            continue;
          }
          break;
        } catch (e) {
          if (controller.signal.aborted) return;
          lastErr = `${m}: ${String((e && e.message) || e)}`;
          await sleep(500);
        }
      }
    }
    if (quotaHit) {
      // sab models par quota mila -> asli wajah (Google ka message) ke saath batao
      return fail(res, 429, "API quota khatm (free limit). Thodi der baad try karo, ya nayi key banao. (" + String(quotaHit).slice(0, 220) + ")", { retryable: true });
    }
    provider.breaker.fail();
    fail(res, 502, "AI service abhi busy hai. Thodi der baad dobara try karo. (" + String(lastErr).slice(0, 160) + ")", { retryable: true });
  } catch (e) {
    // (fix) stream shuru ho chuki ho (headers ja chuke) to dobara JSON error bhejne par
    // "headers already sent" ka unhandled error aata tha (Llama path me Stop dabane par).
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
    const key = (req.get("x-api-key") || "").trim();
    if (!key) return fail(res, 400, "Transcribe ke liye Settings me Gemini key chahiye.");
    const b = req.body || {};
    const audio = String(b.audio || "");
    if (!audio) return fail(res, 400, "Audio nahi mila.");
    const buf = Buffer.from(audio, "base64");
    if (buf.length > 9 * 1024 * 1024) return fail(res, 413, "Audio bahut bada hai (9MB tak).");
    const mime = String(b.mime || "audio/webm").slice(0, 60);
    const lang = /en/i.test(String(b.lang || "")) ? "English" : "Hindi (Devanagari me likho)";
    let models = [];
    try { models = rank(await listModels(key)).flash.slice(0, 5); } catch {} // (fix) quota model-wise hai, peeche purane models bhi
    if (!models.length) models = ["gemini-flash-latest"];
    let lastErr = "", quotaHit = false;
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
          if (r.status === 429) { quotaHit = true; continue; }
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
    if (quotaHit && !/khali transcript/.test(lastErr)) return fail(res, 429, "API quota khatm. Thodi der baad try karo.", { retryable: true });
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
