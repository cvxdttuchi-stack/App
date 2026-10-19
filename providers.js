// providers.js — AI provider abstraction (SERVER-SIDE ONLY)
// Koi bhi API key kabhi frontend tak nahi jaati. Har provider:
//   chatStream({model, key, contents, system, temperature, signal}) -> { res: Response(pipe karne layak), modelUsed }
// Client hamesha Gemini-jaisa SSE samajhta hai, isliye Llama (OpenAI-compatible)
// stream ko server par Gemini shape me translate kiya jaata hai.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Exponential backoff + jitter: 800ms, 1600ms, 3200ms ... + 0-400ms random
function backoffMs(attempt, base = 800, cap = 8000) {
  return Math.min(cap, base * 2 ** attempt) + Math.random() * 400;
}
function retryableStatus(s) {
  return s === 408 || s === 425 || s === 429 || s >= 500;
}

// Transient failure (429/5xx/network) par dobara koshish. Abort ka samman hota hai.
// Safal ya fatal (4xx) response turant lautata hai; aakhri response/error throw hota hai.
// skip429: quota error (429) par retry bekaar hai — poori key ki limit hoti hai,
// doosre model par bhi wahi aayega. Turant wapas lao taaki user ko 71s wait na karna pade.
// timeoutMs (v1.3): upstream latak jaye to hamesha latakne ke bajaye timeout karke
// dobara try karo / imaandaar error do — bina iske user shimmer me hamesha atka rehta.
async function fetchWithRetry(url, opts = {}, { retries = 3, baseMs = 800, skip429 = false, timeoutMs = 0 } = {}) {
  const signal = opts.signal;
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    if (signal && signal.aborted) throw new DOMException("aborted", "AbortError");
    // per-attempt timeout: client ke abort signal ko bhi aage badhao
    let to = null, useSignal = signal;
    if (timeoutMs > 0) {
      const ctrl = new AbortController();
      to = setTimeout(() => { try { ctrl.abort(new DOMException("timeout", "TimeoutError")); } catch {} }, timeoutMs);
      if (signal) {
        if (signal.aborted) { clearTimeout(to); throw new DOMException("aborted", "AbortError"); }
        useSignal = ctrl.signal;
        signal.addEventListener("abort", () => { try { ctrl.abort(signal.reason); } catch {} }, { once: true });
      } else {
        useSignal = ctrl.signal;
      }
    }
    try {
      const r = await fetch(url, useSignal ? { ...opts, signal: useSignal } : opts);
      if (to) clearTimeout(to);
      if (r.status === 429 && skip429) return r; // quota: retry mat karo, turant batao
      if (retryableStatus(r.status) && i < retries) {
        try { await r.arrayBuffer(); } catch {} // connection free karo
        await sleep(backoffMs(i, baseMs));
        continue;
      }
      return r;
    } catch (e) {
      if (to) clearTimeout(to);
      lastErr = e;
      if (signal && signal.aborted) throw e;
      if (e && (e.name === "TimeoutError" || e.name === "AbortError") && i < retries) {
        await sleep(backoffMs(i, baseMs));
        continue; // timeout bhi transient hai — ek-do baar aur try karo
      }
      if (i < retries && !(e && e.name === "AbortError")) { await sleep(backoffMs(i, baseMs)); continue; }
      throw e;
    }
  }
  throw lastErr || new Error("request failed");
}

// Circuit breaker: lagatar failures par provider ko cooldown tak roko,
// taaki busy provider par requeston ki baadh na aaye.
class Breaker {
  constructor(name, { threshold = 5, cooldownMs = 60000 } = {}) {
    this.name = name;
    this.threshold = threshold;
    this.cooldownMs = cooldownMs;
    this.failures = 0;
    this.openedAt = 0;
  }
  canRun() {
    if (!this.openedAt) return true;
    if (Date.now() - this.openedAt > this.cooldownMs) { this.openedAt = 0; this.failures = 0; return true; }
    return false;
  }
  ok() { this.failures = 0; this.openedAt = 0; }
  fail() { if (++this.failures >= this.threshold) this.openedAt = Date.now(); }
}

// =====================================================================
//  MULTI-PROVIDER REGISTRY (v2)
//  Koi bhi AI ki key daalo -> app khud pehchanta hai (ya tum chun sakte ho).
//  Gemini ko chhodkar baaki sab "OpenAI-compatible" chat/completions hain.
//  Ek key fail ho (quota / galat key / server down) to agli key par apne aap chala jata hai.
// =====================================================================
const GEMINI_API = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";

const REGISTRY = {
  gemini:     { name: "Google Gemini",        emoji: "🤖", kind: "gemini", base: GEMINI_API },
  openai:     { name: "OpenAI (ChatGPT)",     emoji: "🟢", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  deepseek:   { name: "DeepSeek",             emoji: "🐋", base: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  qwen:       { name: "Qwen (Alibaba)",       emoji: "🟣", base: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", alt: ["https://dashscope.aliyuncs.com/compatible-mode/v1"], model: "qwen-plus" },
  glm:        { name: "GLM (Zhipu / Z.ai)",   emoji: "🔷", base: "https://open.bigmodel.cn/api/paas/v4", alt: ["https://api.z.ai/api/paas/v4"], model: "glm-4-flash", maxTokens: 4095 },
  anthropic:  { name: "Claude (Anthropic)",   emoji: "🟠", base: "https://api.anthropic.com/v1", model: "" },
  groq:       { name: "Groq",                 emoji: "⚡", base: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" },
  openrouter: { name: "OpenRouter",           emoji: "🌐", base: "https://openrouter.ai/api/v1", model: "openrouter/auto" },
  mistral:    { name: "Mistral",              emoji: "🌬️", base: "https://api.mistral.ai/v1", model: "mistral-small-latest" },
  xai:        { name: "xAI Grok",             emoji: "✖️", base: "https://api.x.ai/v1", model: "" },
  moonshot:   { name: "Kimi (Moonshot)",      emoji: "🌙", base: "https://api.moonshot.ai/v1", model: "" },
  together:   { name: "Together AI",          emoji: "🤝", base: "https://api.together.xyz/v1", model: "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
  perplexity: { name: "Perplexity",           emoji: "🔎", base: "https://api.perplexity.ai", model: "sonar", noModels: true },
  llama:      { name: "Meta Llama",           emoji: "🦙", base: process.env.LLAMA_API_BASE || "https://api.llama.com/compat/v1", model: process.env.LLAMA_MODEL || "Llama-4-Maverick-17B-128E-Instruct-FP8" },
  custom:     { name: "Custom (koi bhi AI)",  emoji: "🧩", base: "", model: "" },
};

const MAX_TOKENS_DEFAULT = 8192;

// SSRF suraksha: custom base URL sirf public https host ho sakta hai
function safeBase(u) {
  try {
    const x = new URL(String(u).trim());
    if (x.protocol !== "https:" || x.username || x.password) return "";
    const h = x.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".")) return "";
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(h) || h.includes(":")) return ""; // IP literals
    return x.origin + x.pathname.replace(/\/+$/, "");
  } catch { return ""; }
}

function baseFor(e) {
  const r = REGISTRY[e.p];
  if (!r) return "";
  const known = [r.base, ...(r.alt || [])];
  if (e.p === "custom") return safeBase(e.b || "");
  if (e.b && known.includes(String(e.b).replace(/\/+$/, ""))) return String(e.b).replace(/\/+$/, "");
  return r.base;
}

// Client "x-ai-keys" header: base64(JSON [{p,k,b?,m?}]) — pehli entry = primary.
// Purane headers (x-api-key = Gemini, x-llama-key) bhi chalte hain.
function getEntries(req) {
  const out = [];
  try {
    const raw = req.get("x-ai-keys");
    if (raw) {
      const arr = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
      for (const x of Array.isArray(arr) ? arr.slice(0, 8) : []) {
        if (!x || !REGISTRY[x.p] || typeof x.k !== "string" || !x.k.trim()) continue;
        if (x.p === "custom" && !safeBase(x.b || "")) continue;
        out.push({ p: x.p, k: x.k.trim(), b: x.b ? String(x.b) : "", m: x.m ? String(x.m).slice(0, 120) : "" });
      }
    }
  } catch {}
  if (!out.length) {
    const g = String(req.get("x-api-key") || "").trim();
    const l = String(req.get("x-llama-key") || process.env.LLAMA_API_KEY || "").trim();
    if (g) out.push({ p: "gemini", k: g, b: "", m: "" });
    if (l) out.push({ p: "llama", k: l, b: "", m: "" });
  }
  return out;
}

// Error ko saaf category me badlo: auth | quota | model | bad | server | net
function classify(status, msg) {
  const t = String(msg || "");
  if (status === 401 || status === 403 || /api key not valid|api_key_invalid|invalid api key|incorrect api key|invalid_api_key|authentication|unauthorized|permission denied/i.test(t)) return "auth";
  if (status === 429 || status === 402 || /quota|rate.?limit|insufficient|balance|exceeded|resource_exhausted|billing/i.test(t)) return "quota";
  if (status === 404 || /model.*(not found|does not exist|not supported)|no such model/i.test(t)) return "model";
  if (status >= 500 || status === 408 || status === 425) return "server";
  return "bad";
}
const KIND_HI = {
  auth: "key galat / permission nahi",
  quota: "current AI route abhi available nahi",
  model: "model nahi mila",
  server: "server busy",
  net: "internet/server tak pahunch nahi paaye",
  bad: "request reject hui",
};

async function errText(r) {
  try {
    const raw = await r.text();
    try {
      const j = JSON.parse(raw);
      const m = (j.error && (j.error.message || (typeof j.error === "string" ? j.error : ""))) || j.message || j.msg || (j.detail && JSON.stringify(j.detail));
      return String(m || raw).slice(0, 300);
    } catch { return raw.slice(0, 300) || "HTTP " + r.status; }
  } catch { return "HTTP " + r.status; }
}

const authHeaders = (e) => (e.p === "gemini" ? { "x-goog-api-key": e.k } : { Authorization: "Bearer " + e.k });

// ---------- Key ko jaanchna (GET /models) ----------
async function verifyKey(e) {
  const r0 = REGISTRY[e.p];
  const bases = e.p === "custom" ? [baseFor(e)] : [baseFor(e), ...(r0.alt || []).filter((b) => b !== baseFor(e))];
  let last = { ok: false, status: 0, kind: "net", msg: "" };
  for (const base of bases) {
    if (!base) continue;
    try {
      const url = e.p === "gemini" ? `${base}/models?pageSize=200` : `${base}/models`;
      const r = await fetchWithRetry(url, { headers: authHeaders(e) }, { retries: 0, timeoutMs: 9000, skip429: true });
      if (r.ok) {
        let ids = [];
        try {
          const j = await r.json();
          ids = e.p === "gemini"
            ? (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes("generateContent")).map((m) => m.name.replace(/^models\//, ""))
            : (j.data || j.models || []).map((m) => m.id || m.name).filter(Boolean);
        } catch {}
        return { ok: true, status: 200, base, models: ids };
      }
      const msg = await errText(r);
      const kind = classify(r.status, msg);
      // quota (429) ka matlab: key pehchani gayi, bas limit hai -> maan lo
      if (kind === "quota") return { ok: true, status: r.status, base, models: [], note: "key sahi hai par abhi quota/limit khatm hai" };
      // /models endpoint hi na ho (404/405) -> key ko sahi maano (verify nahi ho paya)
      if (r.status === 404 || r.status === 405) return { ok: true, status: r.status, base, models: [], unverified: true };
      last = { ok: false, status: r.status, kind, msg };
    } catch (err) {
      last = { ok: false, status: 0, kind: "net", msg: String((err && err.message) || err) };
    }
  }
  return last;
}

// Key ka naam dekhkar AI pehchano. Ambiguous ("sk-...") ho to ek-ek karke jaanch (sirf unhi 3-4 par jinki key aisi ho sakti hai).
async function detectProvider(key, hint) {
  const k = String(key || "").trim();
  if (!k) return { ok: false, error: "Key khali hai." };
  if (hint && REGISTRY[hint] && hint !== "auto") return { candidates: [hint] };
  if (/^AIza/.test(k)) return { candidates: ["gemini"] };
  if (/^sk-ant-/.test(k)) return { candidates: ["anthropic"] };
  if (/^sk-or-/.test(k)) return { candidates: ["openrouter"] };
  if (/^gsk_/.test(k)) return { candidates: ["groq"] };
  if (/^xai-/.test(k)) return { candidates: ["xai"] };
  if (/^pplx-/.test(k)) return { candidates: ["perplexity"] };
  if (/^LLM\|/.test(k)) return { candidates: ["llama"] };
  if (/^tgp_v1_/.test(k)) return { candidates: ["together"] };
  if (/^sk-(proj|svcacct|admin)-/.test(k)) return { candidates: ["openai"] };
  if (/^[0-9a-f]{32}\.[A-Za-z0-9]{6,}$/.test(k)) return { candidates: ["glm"] };
  if (/^sk-/.test(k)) return { candidates: ["deepseek", "qwen", "openai", "moonshot"] };
  if (/^[A-Za-z0-9]{32}$/.test(k)) return { candidates: ["mistral", "together"] };
  return { candidates: [] };
}

// ---------- OpenAI-compatible chat ----------
// Gemini-style contents -> OpenAI-style messages
function geminiToOpenAI(contents, system) {
  const msgs = [];
  if (system) msgs.push({ role: "system", content: system });
  for (const c of contents || []) {
    const role = c.role === "model" ? "assistant" : "user";
    const parts = [];
    for (const p of c.parts || []) {
      if (typeof p.text === "string") parts.push({ type: "text", text: p.text });
      else if (p.inlineData || p.inline_data) {
        const d = p.inlineData || p.inline_data;
        const mime = d.mimeType || d.mime_type || "image/jpeg";
        if (/^image\//.test(mime)) parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${d.data}` } });
        else parts.push({ type: "text", text: `[${mime} file attach hai, par ye AI use seedha nahi padh sakta — Gemini key jodo ya text copy karke bhejo.]` });
      }
    }
    if (!parts.length) continue;
    // assistant/vision-less providers ke liye: sirf text ho to plain string
    if (parts.every((x) => x.type === "text")) msgs.push({ role, content: parts.map((x) => x.text).join("\n\n") });
    else msgs.push({ role, content: parts });
  }
  return msgs;
}

// OpenAI SSE -> Gemini SSE shape (client bina badle samajh lega)
async function pipeOpenAIAsGemini(upstreamRes, clientRes) {
  const reader = upstreamRes.body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  const send = (obj) => clientRes.write(enc.encode("data: " + JSON.stringify(obj) + "\n\n"));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try {
          const j = JSON.parse(d);
          const ch = (j.choices || [])[0] || {};
          const text = (ch.delta && ch.delta.content) || (ch.message && ch.message.content) || "";
          if (text) send({ candidates: [{ content: { parts: [{ text }], role: "model" } }] });
          if (ch.finish_reason) {
            const fr = ch.finish_reason === "length" ? "MAX_TOKENS" : "STOP";
            send({ candidates: [{ finishReason: fr }] });
          }
        } catch {}
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
    clientRes.end();
  }
}

const modelListCache = new Map(); // "p|keytail|base" -> {t, ids}
async function listModelIds(e) {
  const ck = e.p + "|" + e.k.slice(-8) + "|" + (e.b || "");
  const c = modelListCache.get(ck);
  if (c && Date.now() - c.t < 10 * 60 * 1000) return c.ids;
  const v = await verifyKey(e);
  const ids = v.ok ? v.models || [] : [];
  if (v.ok) modelListCache.set(ck, { t: Date.now(), ids });
  return ids;
}
// Chat layak model chuno (embedding/image/audio chhodkar)
function pickChatModel(ids) {
  const ok = ids.filter((n) => !/(embed|whisper|tts|dall-e|image|moderation|rerank|audio|realtime|transcribe|vision-preview|guard)/i.test(n));
  return ok[0] || ids[0] || "";
}

// ek OpenAI-compatible provider ko chat request. Lautata hai {ok, up, model} ya {ok:false, kind, msg}.
async function openaiChat(e, { contents, system, temperature, signal }) {
  const r0 = REGISTRY[e.p];
  const base = baseFor(e);
  if (!base) return { ok: false, kind: "bad", msg: "Base URL nahi hai." };
  let model = e.m && e.m !== "auto" ? e.m : r0.model;
  const messages = geminiToOpenAI(contents, system);
  const build = (mdl, withMax) => JSON.stringify({
    model: mdl, messages, stream: true,
    temperature: typeof temperature === "number" ? Math.min(temperature, e.p === "anthropic" ? 1 : 1.5) : 0.7,
    ...(withMax ? { max_tokens: r0.maxTokens || MAX_TOKENS_DEFAULT } : {}),
  });
  let withMax = true, triedList = false;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (!model) {
      const ids = await listModelIds(e).catch(() => []);
      model = pickChatModel(ids);
      triedList = true;
      if (!model) return { ok: false, kind: "model", msg: "Is key ke liye koi chat model nahi mila. ☰ Settings me model ka naam daalo." };
    }
    let up;
    try {
      up = await fetchWithRetry(`${base}/chat/completions`,
        { method: "POST", signal, headers: { "Content-Type": "application/json", ...authHeaders(e) }, body: build(model, withMax) },
        { retries: 1, skip429: true, timeoutMs: 45000 });
    } catch (err) {
      if (signal && signal.aborted) throw err;
      return { ok: false, kind: "net", msg: String((err && err.message) || err).slice(0, 140) };
    }
    if (up.ok) return { ok: true, up, model };
    const msg = await errText(up);
    const kind = classify(up.status, msg);
    if (up.status === 400 && withMax && /max_tokens|max_completion_tokens|maximum/i.test(msg)) { withMax = false; continue; }
    if (kind === "model" && !triedList) {
      const ids = await listModelIds(e).catch(() => []);
      const alt = pickChatModel(ids);
      triedList = true;
      if (alt && alt !== model) { model = alt; continue; }
    }
    return { ok: false, kind, msg, status: up.status };
  }
  return { ok: false, kind: "bad", msg: "Request baar-baar reject hui." };
}

// ---------- Image provider abstraction ----------
const ImageProvider = {
  name: "none",
  configured: false,
  async generate() { throw new Error("Image generation ke liye koi provider configure nahi hai."); },
  async edit() { throw new Error("Image editing ke liye koi provider configure nahi hai."); },
  status() { return { configured: false, provider: "none", note: "IMAGE_PROVIDER_API_KEY set nahi hai" }; },
};

module.exports = {
  fetchWithRetry, backoffMs, retryableStatus, Breaker,
  REGISTRY, GEMINI_API, safeBase, baseFor, getEntries, classify, KIND_HI, errText, authHeaders,
  verifyKey, detectProvider, listModelIds, pickChatModel,
  geminiToOpenAI, pipeOpenAIAsGemini, openaiChat, ImageProvider,
};
