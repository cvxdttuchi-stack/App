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
async function fetchWithRetry(url, opts = {}, { retries = 3, baseMs = 800, skip429 = false } = {}) {
  const signal = opts.signal;
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    if (signal && signal.aborted) throw new DOMException("aborted", "AbortError");
    try {
      const r = await fetch(url, opts);
      if (r.status === 429 && skip429) return r; // quota: retry mat karo, turant batao
      if (retryableStatus(r.status) && i < retries) {
        try { await r.arrayBuffer(); } catch {} // connection free karo
        await sleep(backoffMs(i, baseMs));
        continue;
      }
      return r;
    } catch (e) {
      lastErr = e;
      if (signal && signal.aborted) throw e;
      if (i < retries) { await sleep(backoffMs(i, baseMs)); continue; }
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

// ---------- Gemini (default provider) ----------
const GEMINI_API = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const geminiBreaker = new Breaker("gemini");

const GeminiProvider = {
  name: "gemini",
  breaker: geminiBreaker,
  keyHeader: (key) => ({ "x-goog-api-key": key }),
  streamUrl: (model) => `${GEMINI_API}/models/${model}:streamGenerateContent?alt=sse`,
  // Gemini stream pehle se client ke samajh wale shape me hai -> seedha pipe
  translateStream: null,
};

// ---------- Meta Llama API (OpenAI-compatible) ----------
// Official docs ke mutabik: https://api.llama.com/compat/v1/ , Bearer LLAMA_API_KEY.
// Chat: POST /compat/v1/chat/completions {model, messages, temperature, stream:true}
// SSE: data: {"choices":[{"delta":{"content":"..."},"finish_reason":null}]} ... data: [DONE]
const LLAMA_BASE = process.env.LLAMA_API_BASE || "https://api.llama.com/compat/v1";
const LLAMA_MODEL_DEFAULT = process.env.LLAMA_MODEL || "Llama-4-Maverick-17B-128E-Instruct-FP8";
const llamaBreaker = new Breaker("llama");

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
        parts.push({ type: "image_url", image_url: { url: `data:${mime};base64,${d.data}` } });
      }
      // fileData (PDF) Llama compat par supported nahi -> chhodo (client pehle hi batata hai)
    }
    if (parts.length === 1 && parts[0].type === "text") msgs.push({ role, content: parts[0].text });
    else if (parts.length) msgs.push({ role, content: parts });
  }
  return msgs;
}

// OpenAI SSE -> Gemini SSE shape (client bina badle samajh lega)
async function pipeLlamaAsGemini(upstreamRes, clientRes) {
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

const LlamaProvider = {
  name: "llama",
  breaker: llamaBreaker,
  defaultModel: LLAMA_MODEL_DEFAULT,
  keyHeader: (key) => ({ Authorization: "Bearer " + key }),
  streamUrl: () => `${LLAMA_BASE}/chat/completions`,
  buildBody: ({ contents, system, temperature, maxTokens }) => ({
    model: LLAMA_MODEL_DEFAULT,
    messages: geminiToOpenAI(contents, system),
    temperature: typeof temperature === "number" ? temperature : 0.7,
    ...(maxTokens ? { max_tokens: maxTokens } : {}),
    stream: true,
  }),
  translateStream: pipeLlamaAsGemini,
  async listModels(key) {
    const r = await fetchWithRetry(`${LLAMA_BASE}/models`, { headers: { Authorization: "Bearer " + key } }, { retries: 1 });
    if (!r.ok) throw new Error("Llama models list nahi mili (" + r.status + ")");
    const j = await r.json();
    const ids = (j.data || []).map((m) => m.id).filter(Boolean);
    return ids.length ? ids : [LLAMA_MODEL_DEFAULT];
  },
};

// ---------- Image provider abstraction ----------
// Abhi koi image provider configure nahi hai -> saare calls imaandari se mana karte hain.
// (Koi nakli generation nahi.) Bhavishya me provider judne par yahin implement hoga.
const ImageProvider = {
  name: "none",
  configured: false,
  async generate() { throw new Error("Image generation ke liye koi provider configure nahi hai."); },
  async edit() { throw new Error("Image editing ke liye koi provider configure nahi hai."); },
  status() { return { configured: false, provider: "none", note: "IMAGE_PROVIDER_API_KEY set nahi hai" }; },
};

function getChatProvider(req) {
  // Per-request choice: client "x-ai-provider" header bhejta hai (Settings me chuna hua).
  // Llama key: "x-llama-key" header (user ki apni key) ya LLAMA_API_KEY env (server key).
  const want = String((req && req.get("x-ai-provider")) || process.env.AI_PROVIDER || "gemini").toLowerCase();
  const llamaKey = String((req && req.get("x-llama-key")) || process.env.LLAMA_API_KEY || "").trim();
  if (want === "llama") {
    if (llamaKey) return { provider: LlamaProvider, key: llamaKey, requested: "llama" };
    return { provider: LlamaProvider, key: "", requested: "llama", missingKey: true };
  }
  return { provider: GeminiProvider, key: null, requested: want }; // key: Gemini ka keyFrom() se aata hai
}

module.exports = {
  fetchWithRetry, backoffMs, retryableStatus, Breaker,
  GeminiProvider, LlamaProvider, ImageProvider,
  geminiToOpenAI, pipeLlamaAsGemini,
  getChatProvider,
  LLAMA_BASE, LLAMA_MODEL_DEFAULT,
};
