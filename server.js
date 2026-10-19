// Mera AI - server
// Kaam: API key ko chhupa ke rakhna, Gemini se streaming jawab laana,
// aur model band/slow ho to khud doosre model par chale jaana (self-repair).

const express = require("express");
const path = require("path");
const { Readable } = require("stream");

const app = express();
const PORT = process.env.PORT || 3000;
const API = "https://generativelanguage.googleapis.com/v1beta";
const SERVER_KEY = process.env.GEMINI_API_KEY || "";
const ACCESS_CODE = process.env.ACCESS_CODE || "";

app.set("trust proxy", 1);
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.join(__dirname, "public"), { maxAge: "1h" }));

// ---------- chhota rate limit (har IP par 1 minute me 60 request) ----------
const hits = new Map();
function rateLimit(req, res, next) {
  const ip = req.ip || "x";
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  if (arr.length >= 60) return res.status(429).json({ error: "Bahut zyada request. Ek minute ruko." });
  arr.push(now);
  hits.set(ip, arr);
  next();
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, arr] of hits) if (!arr.some((t) => now - t < 60000)) hits.delete(ip);
}, 120000).unref();

// ---------- access code (public link ko dusron se bachane ke liye) ----------
function auth(req, res, next) {
  if (ACCESS_CODE && req.get("x-access-code") !== ACCESS_CODE) {
    return res.status(401).json({ error: "Access code galat hai ya nahi diya. Settings me daalo." });
  }
  next();
}

function keyFrom(req) {
  return req.get("x-api-key") || SERVER_KEY;
}

// ---------- models list + automatic best-model selection ----------
const modelCache = new Map(); // key -> {t, list}
function versionOf(name) {
  const m = name.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 0;
}
async function listModels(key) {
  const c = modelCache.get(key);
  if (c && Date.now() - c.t < 10 * 60 * 1000) return c.list;
  const r = await fetch(`${API}/models?pageSize=200&key=${encodeURIComponent(key)}`);
  if (!r.ok) throw new Error("Models list nahi mili (" + r.status + "). API key check karo.");
  const j = await r.json();
  const list = (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /^gemini-/.test(n) && !/(image|tts|live|audio|embedding|robotics|computer-use|native)/.test(n));
  modelCache.set(key, { t: Date.now(), list });
  return list;
}
function rank(list) {
  const flash = list.filter((n) => /flash/.test(n) && !/lite/.test(n));
  const lite = list.filter((n) => /lite/.test(n));
  const pro = list.filter((n) => /pro/.test(n));
  const sortFn = (a, b) => {
    // stable (no "preview") ko thoda aage rakho, phir bada version
    const pa = /preview|exp/.test(a) ? 0 : 1;
    const pb = /preview|exp/.test(b) ? 0 : 1;
    if (pa !== pb) return pb - pa;
    return versionOf(b) - versionOf(a);
  };
  return { flash: flash.sort(sortFn), lite: lite.sort(sortFn), pro: pro.sort(sortFn) };
}

app.get("/api/config", (req, res) => {
  res.json({ serverKey: !!SERVER_KEY, needsCode: !!ACCESS_CODE });
});

app.get("/api/models", rateLimit, auth, async (req, res) => {
  try {
    const key = keyFrom(req);
    if (!key) return res.status(400).json({ error: "API key nahi hai." });
    const list = await listModels(key);
    res.json({ models: list, ...rank(list) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- chat (streaming) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function callGemini(model, key, body, signal) {
  return fetch(`${API}/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(key)}`, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errText(r) {
  try {
    const j = await r.json();
    return (j.error && j.error.message) || JSON.stringify(j);
  } catch {
    return "HTTP " + r.status;
  }
}

app.post("/api/chat", rateLimit, auth, async (req, res) => {
  const key = keyFrom(req);
  if (!key) return res.status(400).json({ error: "API key nahi mili. Settings me apni free Gemini key daalo." });

  const { model, contents, system, temperature, search } = req.body || {};
  if (!Array.isArray(contents) || !contents.length) return res.status(400).json({ error: "Khali message." });

  // candidate models: chuna hua -> auto best flash -> lite (fallback chain)
  let candidates = [];
  try {
    const list = await listModels(key);
    const r = rank(list);
    if (model && model !== "auto") candidates.push(model);
    candidates.push(...r.flash.slice(0, 2), ...r.lite.slice(0, 1));
  } catch {
    if (model && model !== "auto") candidates.push(model);
  }
  candidates = [...new Set(candidates)];
  if (!candidates.length) candidates = ["gemini-flash-latest", "gemini-flash-lite-latest"];

  const baseBody = {
    contents,
    generationConfig: { temperature: typeof temperature === "number" ? temperature : 0.7 },
  };
  if (system) baseBody.systemInstruction = { parts: [{ text: system }] };

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  let lastErr = "Koi model jawab nahi de paya.";
  let useSearch = !!search;

  for (const m of candidates) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = { ...baseBody };
        if (useSearch) body.tools = [{ google_search: {} }];
        const up = await callGemini(m, key, body, controller.signal);
        if (up.ok) {
          res.status(200);
          res.set({
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Model-Used": m,
            "Access-Control-Expose-Headers": "X-Model-Used",
          });
          res.flushHeaders && res.flushHeaders();
          Readable.fromWeb(up.body).pipe(res);
          return;
        }
        lastErr = `${m}: ${await errText(up)}`;
        // search free plan me na chale to bina search ke dobara
        if (up.status === 400 && useSearch && /tool|search|ground/i.test(lastErr)) {
          useSearch = false;
          attempt--;
          continue;
        }
        if (up.status === 401 || up.status === 403) {
          return res.status(up.status).json({ error: "API key galat ya permission nahi: " + lastErr });
        }
        if (up.status === 400) {
          return res.status(400).json({ error: lastErr });
        }
        if (up.status === 429 || up.status >= 500) {
          if (attempt === 0) await sleep(1200); // ek baar ruk ke dobara
          continue;
        }
        break; // 404 etc -> agla model
      } catch (e) {
        if (controller.signal.aborted) return;
        lastErr = `${m}: ${e.message}`;
        await sleep(500);
      }
    }
  }
  res.status(502).json({ error: "Sab models try kar liye, fir bhi nahi chala. " + lastErr });
});

app.get("/healthz", (req, res) => res.send("ok"));

app.listen(PORT, () => console.log("Mera AI chal raha hai: port " + PORT));
