# ✦ Veda AI v1.1

Premium Hindi-first AI assistant — **By Shailesh Arya**.

Chat (tez streaming), mic + camera + file attach, advanced **PDF Studio**, **ZIP Debugger** (kisi bhi zip ka bug-analysis aur fix), **HTML Runner**, 4 premium animated themes, moods (Funny / Kahani / English Teacher / Deep Study), taaza khabar (RSS), per-chat lock, model selector (Gemini + Llama).

## 🆕 v1.1 — Advanced PDF Creation

PDF **banana** ab aur advance: AI ab VPDF markup me document likhta hai aur app use 5 premium design themes me sajaata hai —
**रॉयल नेवी-गोल्ड** (default, tumhari book wala style) · **महासागर नीला** · **हरित अध्ययन** · **सूर्यास्त** · **सादा**.

- **Cover page** (title + subtitle + "BY SHAILESH ARYA"), **rangin heading bands**, **highlight/note/परिभाषा/सूत्र/चेतावनी boxes**
- **Styled tables** (rangeen header, zebra rows), **MCQ blocks** (a–d options) + ant me **उत्तरमाला** apne aap
- **Vector rekha-chitra**: `[diagram]` se saral line-art (flow / vertical / layers / cycle) — tez, saaf, painting jaisa nahi
- `[c:blue]` rangin text, divider lines, har page par **"By Shailesh Arya"** footer + theme accent line
- Doc preview me **theme picker** (5 rang) — ek tap me poori PDF ka design badlo; user ke shabdon se bhi theme ("neele rang me banao")
- Kharab markup par bhi crash nahi — sadha text ban kar PDF banti hai

**Imaandaar seema:** bahut complex freeform layouts (magazine-style multi-column art) abhi AI par nirbhar hain; scanned/image PDF me text edit nahi (OCR nahi); Llama path untested.

## Deploy (Render, ~10 minute)

1. **API key (free):** https://aistudio.google.com → "Get API key".
   Llama ke liye: llama.com ke developer dashboard se key.
2. **GitHub:** naya repository banao, is zip ki saari files upload karo
   (`server.js`, `providers.js`, `package.json`, `render.yaml`, `public/` folder).
3. **Render.com:** New → Web Service → apna repo chuno.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: Free
   - Environment Variables: **kuch nahi chahiye** (BYOK — key app me daali jaati hai).
     Optional: `ACCESS_CODE` (poore app par password lagana ho to).
4. Deploy dabao. Link kholo → ⚙️ Settings → **apni Gemini key daalo** → Save.
   Key sirf tumhare browser me rehti hai; server par kabhi save nahi hoti.

## Features (sab test kiye gaye)

| Kaam | Kaise |
|---|---|
| Chat (streaming) | Typewriter animation; pehla shimmer turant, tokens 3–5s me |
| Mic 🎤 | Bolo (Hindi/English) → text input me; MediaRecorder fallback me Gemini se transcribe |
| Attach 📎 | Image (AI dekhkar analyze karta hai), PDF (text nikal kar AI edit karta hai), ZIP (debugger), code/txt |
| Camera 📷 | Photo lo → attach |
| Rangin text | AI `[c:blue]...[/c]` likhe to rang me dikhta hai (red/blue/green/gold/purple/orange) |
| 4 Themes | 🌌 Midnight Gold · 🌊 Ocean Glow · 🌇 Sunset Neon · 🤍 Pearl Light — animated transitions |
| Moods | 🙂 Normal · 🤣 Funny · 📖 Kahani · 🔤 English Teacher · 🎓 Deep Study (Bihar Board aware) |
| PDF Studio 🧰 | Merge · Pages (nikalo/hatao) · **Compress** · Rotate · Image→PDF · Enhance (scan saaf) · N-up (2/4) · Watermark · AI se Edit |
| PDF result card | 👁️ Kholo (full-screen in-chat viewer) · 📌 Pin · 📚 Library · 🔗 Share (Drive/WhatsApp) · ⬇️ Download · 💬 AI padhe |
| ZIP Debugger 🤖 | ZIP chuno → tree + files → AI Hindi me bug + root cause → 🔧 Fix karke ZIP download |
| HTML Runner | ```html par ▶ Run — sandboxed live preview chat me |
| Model selector | Gemini 2.5 Flash (tez) / Pro (gehra) / Auto · 🦙 Llama (BYOK, untested) |
| Taaza khabar 📰 | Google News RSS (India/World) → AI Hindi saransh, "RSS headlines" label ke saath |
| Chat lock 🔒 | Har chat par alag passcode (SHA-256); locked chats list me blurred |
| History | Search, pin, archive — sab is device me |

## Key baatein

- **BYOK:** server bina key ke chalta hai. Key Settings me daalo — browser ke localStorage me rehti hai, har request ke header me jaati hai.
- **429/quota par fail-fast:** retry-storm nahi — turant imaandaar Hindi error.
- **Unlimited jaisa output:** maxOutputTokens 65536; lamba jawab hisson me apne aap aage badhta hai.
- Chats/files sirf **is device** me (localStorage + IndexedDB). Browser data mitane par jayenge — Backup lete raho.

## Honest limitations (koi nakli feature nahi)

1. **Llama untested** — Meta Llama API path code me taiyaar hai par is build me live test nahi hua; nateeje Gemini se alag ho sakte hain.
2. **Live news = RSS headlines**, Google-grounded search nahi. Chat me "live search" (google_search tool) Gemini par hai, Llama par nahi.
3. **Mic transcribe** ke liye Gemini key chahiye (Web Speech API keyless hai, par sirf Chrome/Android me achha chalta hai).
4. **ZIP Debugger** 25MB tak, 25 text files tak padhta hai; bahut bade/binary-heavy zips adhure analyze honge.
5. **PDF Compress** object-stream optimization hai — pehle se optimized PDF par farak nahi dikhega (result me imaandari se bataya jaata hai).
6. **PDF text extract** scanned/image-only PDF par kaam nahi karta (OCR nahi hai) — aisi PDF inline bhej di jaati hai, Gemini khud padhta hai.
7. **Awaaz** phone ki (browser) hai — server premium TTS is version me nahi hai.
8. Render **free plan** 15 min idle par so jata hai; pehli request me 30–50s lag sakte hain.
9. **Image generation** is version me nahi hai (spec me nahi tha).

## Tests

`npm test` → 42 checks: server boot (BYOK), chat fail-fast, news RSS live, zip analyze/rebuild (planted-bug fixture), transcribe fail-fast, pdf-lib roundtrips (merge/split/rotate/n-up/compress), pdf.js text extract, lock hash, assets, branding, secrets scan. Sab pass.
