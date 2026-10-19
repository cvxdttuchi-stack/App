# ✦ Mera AI

Ek hi app me: **chat, mic (bolkar likhwana), jawab bolkar sunana, PDF/photo/file samajhna, summary, notes, sawal-jawab, jaisa bologe waisa PDF/document, chat history, memory, settings.**
Free Gemini API + GitHub + Render.com. Phone se hi ho jata hai.

## Kya-kya hai
| Kaam | Kaise |
|---|---|
| Chat (streaming, tez) | Message likho, jawab turant likhta hua dikhta hai |
| Mic | 🎤 dabao, bolo (Hindi/English). Bolne ke baad apne aap bhej sakta hai |
| Jawab sunna | Har jawab par 🔊. Ya "Auto-bolo" chalu karo |
| Hands-free | 🎧: bolo → AI jawab bolega → phir mic khulega |
| File attach | 📎 PDF, photo, audio, video, txt/csv/code. Copy-paste photo bhi chalegi |
| Summary / Notes / Q&A | File lagate hi ek-tap buttons aate hain |
| PDF banwana | "📄 PDF mode" chalu karo aur bolo: *"neele rang ka modern resume banao"*. Preview → **PDF save** / HTML / Word |
| Kisi bhi jawab ka PDF | Jawab ke neeche 📄 dabao |
| Chat history | Sidebar me sab chats, search, rename, delete, edit-and-resend |
| Memory / seekhna | AI tumhari zaroori baatein yaad rakhta hai. 👎 dabake galti batao, wo hamesha yaad rakhega |
| Khud ko theek karna | Model band/slow ho to AI khud doosre model par chala jata hai |
| Settings | API key, model, temperature, apna prompt, bhasha, raftaar, theme, akshar size |
| Backup | Sidebar me Backup / Restore / Chat .md |
| Phone app jaisa | Browser menu → "Add to Home screen" |

## Deploy (10 minute)
1. **API key:** https://aistudio.google.com → "Get API key" (free).
2. **GitHub:** naya repository banao. Is zip ki saari files (`server.js`, `package.json`, `public/` folder, `render.yaml`, `.gitignore`) upload karo.
   Phone me browser ko "Desktop site" par karke "Add file → Upload files" use karo.
3. **Render.com:** GitHub se login → **New → Web Service** → apna repo chuno.
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Plan: **Free**
4. **Environment Variables** (Render me):
   - `GEMINI_API_KEY` = tumhari key
   - `ACCESS_CODE` = koi bhi secret code (isse tumhara public link koi aur use nahi kar payega. Zaroor lagao)
5. **Deploy** dabao. Link milega (jaise `https://mera-ai.onrender.com`).
6. App kholo → ⚙️ Settings → Access code daalo → Save. Ho gaya.

Key kabhi GitHub me mat likhna. Sirf Render ke Environment Variables me.

## Dhyan rakhne wali baatein
- Render free plan 15 min bekaar rehne par so jata hai. Pehli baar khulne me 30-50 sec lag sakte hain.
- Gemini free tier ki limits hain (roz ki request limit, models badalte rehte hain). Free tier me Google tumhara data model sudharne me use kar sakta hai. Private/zaroori data mat bhejo.
- "Search" (internet) free tier me aksar band hota hai. Na chale to app apne aap bina search ke jawab deta hai.
- Chat history tumhare phone me save hoti hai (server par nahi). Browser data mitane se chali jayegi, isliye kabhi-kabhi Backup lo. Backup me attach ki hui files shamil nahi hoti.
- Word/Excel file seedha nahi padhi jati. Pehle PDF ya CSV bana ke attach karo.
- Mic aur bolna browser ki feature hai. Android Chrome me sabse achha chalta hai.
- Photo/image banana (image generation) is app me nahi hai.

## Computer par test (optional)
```
npm install
GEMINI_API_KEY=apni_key npm start
```
Phir http://localhost:3000 kholo.
