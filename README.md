# ⬇️ Arya Downloader v1

YouTube / Instagram / Pinterest / Facebook / TikTok se video download karo.
**Koi API key NAHI chahiye** — server par `yt-dlp` link se seedha video nikalta hai.

By Shailesh Arya

## Features (v1)
- 🔗 Link paste → auto-detect platform → title/thumbnail/duration
- 🎞️ Quality select (144p–1080p, jitni single-file mile) + 🎵 Audio
- ⬇️ Downloads tab: live % + speed (MB/s)
- 🔔 Download poora hone par notification
- 📚 Library: downloaded videos/gaane, in-app player
- 📋 Clipboard se ek tap me link
- 📱 PWA — phone me install karke app jaisa chalao

## Deploy (Render, free)
1. Is folder ko GitHub repo me upload karo (Add file → Upload files)
2. Render → New → Web Service → repo chuno
3. **Runtime: Docker** chuno (Dockerfile pehle se hai)
4. Koi env var nahi chahiye → Deploy dabao (pehli baar 4-6 min lagega)
5. URL kholo, test karo

## Imaandaar limitations (v1)
- **4K**: YouTube 4K single-file nahi deta (server-merge chahiye jo free server par
  possible nahi) — isliye max single-file quality (aam taur par 720p/1080p) + audio.
- **YouTube kabhi-kabhi rokta hai** (datacenter IP throttling) — "2-3 minute baad try
  karo" wala error aaye to wahi karo; yt-dlp update ke liye redeploy karna pad sakta hai.
- **Private/login wale** Instagram/Facebook posts nahi khulenge (public content only).
- Download speed tumhare phone + video CDN par depend karti hai; server sirf link
  nikalta hai, file beech me nahi aati (isliye tez hai).

## Local test
```
npm install
npm test
npm start   # http://localhost:10000
```
(Docker ke bina local me `yt-dlp` install hona chahiye: `pip install yt-dlp`)
