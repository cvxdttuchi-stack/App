(() => {
  "use strict";
  const { renderMarkdown, mdToPlain, esc } = window.MD;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

  /* =====================  STORAGE  ===================== */
  const store = {
    get(k, d) {
      try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); }
      catch { toast("Storage bhar gaya. Purani chats delete karo ya Backup lo."); }
    },
  };
  const DEFAULTS = {
    apiKey: "", accessCode: "", model: "auto", temperature: 0.7, persona: "",
    micLang: "hi-IN", ttsLang: "auto", rate: 1, theme: "midnight", font: "16",
    voiceAutoSend: false, autoLearn: true, search: true, autoSpeak: false, handsFree: false,
    voice: "browser", textStyle: "normal", emojiMode: false, sounds: false, provider: "gemini", llamaKey: "", mood: "normal", pdfTheme: "navy-gold", v: 4,
  };
  let settings = { ...DEFAULTS, ...store.get("settings", {}) };
  if (!settings.v || settings.v < 4) {
    // Veda v1: 4 naye themes (midnight/ocean/sunset/pearl)
    if (settings.theme === "dark" || settings.theme === "hacker") settings.theme = "midnight";
    if (settings.theme === "light" || settings.theme === "auto") settings.theme = "pearl";
    if (!settings.mood) settings.mood = "normal";
    settings.voice = "browser"; // Veda v1: server TTS nahi — phone ki awaaz
    settings.voiceAutoSend = false;
    settings.v = 4; store.set("settings", settings);
  }
  let chats = store.get("chats", []);
  let memory = store.get("memory", []);
  let currentId = store.get("currentId", null);
  let pending = [];
  let streaming = null;
  let docMode = false;
  let serverCfg = { serverKey: false, needsCode: false, ownerEnabled: false, envKey: false };

  const saveSettings = () => store.set("settings", settings);
  let saveTimer;
  const saveChats = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set("chats", chats), 250); };
  const saveChatsNow = () => { clearTimeout(saveTimer); store.set("chats", chats); Cloud.pushSoon(); };
  const saveMemory = () => store.set("memory", memory);

  /* ============  CLOUD (Veda v1: koi login/server-sync nahi)  ============ */
  // Saare chats sirf is device me rehte hain (localStorage + IndexedDB).
  // Cloud sirf khaali stub hai taaki purane calls na tootein.
  const Cloud = {
    pushSoon() {},
    markFile() {},
    async me() { return null; },
  };

  /* files live in IndexedDB (localStorage me badi files nahi aati) */
  const fileCache = new Map();
  const idb = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        if (this.db) return res(this.db);
        const r = indexedDB.open("veda-ai", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("files", { keyPath: "id" });
        r.onsuccess = () => { this.db = r.result; res(this.db); };
        r.onerror = () => rej(r.error);
      });
    },
    async put(o) {
      try {
        const db = await this.open();
        await new Promise((res, rej) => { const t = db.transaction("files", "readwrite"); t.objectStore("files").put(o); t.oncomplete = res; t.onerror = () => rej(t.error); });
      } catch {}
    },
    async get(id) {
      try {
        const db = await this.open();
        return await new Promise((res, rej) => { const q = db.transaction("files").objectStore("files").get(id); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
      } catch { return null; }
    },
    async del(id) {
      try {
        const db = await this.open();
        await new Promise((res) => { const t = db.transaction("files", "readwrite"); t.objectStore("files").delete(id); t.oncomplete = res; t.onerror = res; });
      } catch {}
    },
    async all() {
      try {
        const db = await this.open();
        return await new Promise((res, rej) => { const q = db.transaction("files").objectStore("files").getAll(); q.onsuccess = () => res(q.result || []); q.onerror = () => rej(q.error); });
      } catch { return []; }
    },
  };
  async function loadFile(id) {
    if (fileCache.has(id)) return fileCache.get(id);
    const r = await idb.get(id);
    if (r) fileCache.set(id, r);
    return r;
  }

  /* =====================  UI HELPERS  ===================== */
  const el = {
    sidebar: $("#sidebar"), chatList: $("#chatList"), search: $("#search"), messages: $("#messages"), empty: $("#empty"),
    input: $("#input"), sendBtn: $("#sendBtn"), stopBtn: $("#stopBtn"), micBtn: $("#micBtn"), attachBtn: $("#attachBtn"),
    fileInput: $("#fileInput"), pending: $("#pending"), quick: $("#quick"), title: $("#chatTitle"), badge: $("#modelBadge"),
    banner: $("#banner"), toast: $("#toast"), suggest: $("#suggest"), newsBtn: $("#newsBtn"),
    tDoc: $("#tDoc"), listenBar: $("#listenBar"), listenTxt: $("#listenTxt"), tNews: $("#tNews"), tLang: $("#tLang"), tSpeak: $("#tSpeak"), tHands: $("#tHands"),
  };

  let toastTimer;
  function toast(msg, ms = 3200) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => (el.toast.hidden = true), ms);
  }
  function download(name, data, type) {
    const blob = new Blob([data], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function applyTheme() {
    const t = settings.theme || "midnight";
    document.documentElement.dataset.theme = t;
    document.documentElement.style.setProperty("--fs", settings.font + "px");
    const m = $('meta[name="theme-color"]');
    if (m) m.content = { midnight: "#0b0d12", ocean: "#062a33", sunset: "#1a0f1e", pearl: "#f7f5ef" }[t] || "#0b0d12";
  }
  const nearBottom = () => el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 140;
  const scrollDown = (force) => { if (force || nearBottom()) el.messages.scrollTop = el.messages.scrollHeight; };
  const fmtTime = (t) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const isTouch = matchMedia("(pointer:coarse)").matches;

  /* =====================  CHATS  ===================== */
  const currentChat = () => chats.find((c) => c.id === currentId);
  function newChat() {
    const c = { id: uid(), title: "Nayi chat", messages: [], pins: [], archived: false, lock: null, created: Date.now(), updated: Date.now() };
    chats.unshift(c); currentId = c.id; store.set("currentId", currentId); saveChats();
    return c;
  }
  // purani chats me naye fields jodo (backward compatible)
  chats.forEach((c) => { if (!Array.isArray(c.pins)) c.pins = []; if (typeof c.archived !== "boolean") c.archived = false; if (!("lock" in c)) c.lock = null; });
  let sideTab = "chats";
  /* =====================  CHAT LOCK (passcode -> SHA-256)  ===================== */
  const unlockedChats = new Set(); // is session me khuli hui locked chats
  async function sha256hex(str) {
    const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  const isLocked = (c) => !!(c && c.lock && c.lock.hash);
  const isOpen = (c) => !isLocked(c) || unlockedChats.has(c.id);
  let lockCb = null;
  function openLockModal(title, cb) {
    lockCb = cb;
    $("#lockTitle").textContent = title;
    $("#lockCode").value = ""; $("#lockErr").textContent = "";
    $("#lockModal").hidden = false;
    setTimeout(() => $("#lockCode").focus(), 60);
  }
  function lockChat(id) {
    const c = chats.find((x) => x.id === id); if (!c || isLocked(c)) return;
    openLockModal("🔒 Lock lagao", async (code) => {
      if (!code || code.length < 4) { toast("Passcode kam se kam 4 akshar ka rakho."); return; }
      c.lock = { hash: await sha256hex("veda-lock:" + code) };
      unlockedChats.delete(id);
      saveChatsNow(); renderAll();
      toast("🔒 Chat lock ho gayi.");
    });
  }
  async function tryUnlock(id, code) {
    const c = chats.find((x) => x.id === id); if (!c || !isLocked(c)) return false;
    if ((await sha256hex("veda-lock:" + code)) === c.lock.hash) { unlockedChats.add(id); return true; }
    return false;
  }
  function removeLock(id) {
    const c = chats.find((x) => x.id === id); if (!c) return;
    if (!confirm("Is chat ka lock hata dun?")) return;
    c.lock = null; unlockedChats.delete(id); saveChatsNow(); renderAll();
    toast("🔓 Lock hata diya.");
  }
  function openChat(id) {
    const c = chats.find((x) => x.id === id);
    if (c && isLocked(c) && !unlockedChats.has(id)) {
      if (streaming) stopGen();
      stopSpeak();
      openLockModal("🔒 " + c.title, async (code) => {
        if (!code) return;
        if (await tryUnlock(id, code)) {
          currentId = id; store.set("currentId", id);
          renderAll(); closeSide();
          toast("🔓 Chat khul gayi.");
        } else toast("❌ Passcode galat hai.");
      });
      return;
    }
    if (streaming) stopGen();
    stopSpeak();
    currentId = id; store.set("currentId", id);
    renderAll(); closeSide();
  }
  function deleteChat(id) {
    const c = chats.find((x) => x.id === id); if (!c) return;
    if (!confirm("Ye chat mita den?\n\n" + c.title)) return;
    c.messages.forEach((m) => [...(m.files || []), ...(m.images || [])].forEach((f) => { idb.del(f.id); fileCache.delete(f.id); }));
    chats = chats.filter((x) => x.id !== id);
    if (currentId === id) currentId = chats[0] ? chats[0].id : null;
    store.set("currentId", currentId); saveChatsNow(); renderAll();
  }
  function renderChatList() {
    const q = el.search.value.trim().toLowerCase();
    const list = chats
      .filter((c) => (sideTab === "arch" ? !!c.archived : !c.archived))
      .filter((c) => !q || c.title.toLowerCase().includes(q) || (isOpen(c) && c.messages.some((m) => (m.text || "").toLowerCase().includes(q))))
      .sort((a, b) => b.updated - a.updated);
    el.chatList.innerHTML = "";
    if (!list.length) { el.chatList.innerHTML = '<div class="small-note" style="padding:14px">' + (sideTab === "arch" ? "Archive khali hai." : "Koi chat nahi mili.") + "</div>"; return; }
    list.forEach((c) => {
      const d = document.createElement("div");
      const locked = isLocked(c) && !unlockedChats.has(c.id);
      d.className = "chat-item" + (c.id === currentId ? " active" : "") + (locked ? " locked" : "");
      d.innerHTML = '<span class="t"></span><button class="l" title="' + (isLocked(c) ? "Lock kholo/hatao" : "Lock lagao") + '">' + (isLocked(c) ? "🔒" : "🔓") + '</button><button class="a" title="' + (c.archived ? "Wapas lao" : "Archive karo") + '">' + (c.archived ? "📤" : "🗄️") + '</button><button class="x" title="Mitao">✕</button>';
      $(".t", d).textContent = locked ? "🔒 Locked chat" : c.title;
      d.onclick = () => openChat(c.id);
      $(".l", d).onclick = (e) => { e.stopPropagation(); isLocked(c) ? removeLock(c.id) : lockChat(c.id); };
      $(".a", d).onclick = (e) => { e.stopPropagation(); archiveChat(c.id, !c.archived); };
      $(".x", d).onclick = (e) => { e.stopPropagation(); deleteChat(c.id); };
      el.chatList.appendChild(d);
    });
  }

  /* =====================  MESSAGE RENDERING  ===================== */
  const ICON = { image: "🖼️", pdf: "📕", audio: "🎵", video: "🎬", text: "📄", zip: "🗜️" };

  function stripMemory(t) {
    return t.replace(/<memory>[\s\S]*?(<\/memory>|$)/gi, "").replace(/<m(e(m(o(r(y)?)?)?)?)?$/i, "");
  }
  // ```html document ko alag nikalna (preview/PDF ke liye)
  /* ---- PDF theme: user ke shabdon se (backup; AI khud theme: directive likhta hai) ---- */
  function themeFromWords(s) {
    s = (s || "").toLowerCase();
    if (/navy|gold|sona|royal|शाही/.test(s)) return "navy-gold";
    if (/ocean|samudra|समुद्र|aqua/.test(s)) return "ocean";
    if (/emerald|hara(?![a-z])|हरा|green/.test(s)) return "emerald";
    if (/sunset|narangi|नारंगी|orange|garam|गर्म/.test(s)) return "sunset";
    if (/minimal|simple|sada|सादा|saada|plain/.test(s)) return "minimal";
    return null;
  }
  function vdocBuild(src, userText) {
    try {
      if (!window.VPDF) return null;
      return VPDF.toHtml(src, { themeHint: themeFromWords(userText) || settings.pdfTheme || "navy-gold" });
    } catch (e) { return null; }
  }
  function splitDoc(text, isDocMode, userText) {
    const m = text.match(/```(html|vpdf)[ \t]*\n([\s\S]*?)(```|$)/i);
    if (!m) return { display: text, html: null };
    const lang = m[1].toLowerCase(), body = m[2], closed = m[3] === "```";
    const disp = text.replace(m[0], "\n\n_📄 Document ban raha hai…_\n\n");
    if (lang === "vpdf") {
      if (!closed) return { display: disp, html: null };
      const vd = vdocBuild(body, userText);
      if (!vd) return { display: text, html: null };
      return { display: disp, html: vd.html, src: body.trim(), theme: vd.theme, title: vd.title, markup: true };
    }
    const full = /^\s*<(!doctype|html)/i.test(body);
    if (!full && !(isDocMode && body.trim().length < 15)) return { display: text, html: null };
    return {
      display: disp,
      html: closed && full ? body.trim() : null,
      src: null, theme: settings.pdfTheme || "navy-gold", markup: false,
    };
  }
  function chipHtml(f) {
    if (f.kind === "image") return '<img class="thumb" data-img="' + esc(f.id) + '" alt="' + esc(f.name) + '">';
    return '<span class="file-chip">' + (ICON[f.kind] || "📎") + " <span>" + esc(f.name) + "</span></span>";
  }


  /* =====================  IMAGES (dikhana, download, copy)  ===================== */
  const blobUrls = new Map();
  function recUrl(rec) {
    if (blobUrls.has(rec.id)) return blobUrls.get(rec.id);
    const bin = atob(rec.data), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([u8], { type: rec.mime || "image/png" }));
    blobUrls.set(rec.id, url);
    return url;
  }
  const extOf = (mime) => ((mime || "").split("/")[1] || "png").replace("jpeg", "jpg").replace(/[^a-z0-9]/gi, "") || "png";
  function hydrateImages(root) {
    $$("img[data-img]", root).forEach(async (img) => {
      const rec = await loadFile(img.dataset.img);
      if (!rec || !rec.data) {
        const s = document.createElement("span"); s.className = "file-chip"; s.textContent = "🖼️ image ab available nahi (backup me files nahi hoti)";
        img.replaceWith(s); return;
      }
      img.src = recUrl(rec);
      img.onclick = () => openImage(rec.id);
    });
  }
  async function downloadImage(id) {
    const rec = await loadFile(id); if (!rec) return toast("Image nahi mili.");
    const a = document.createElement("a");
    a.href = recUrl(rec); a.download = (rec.name && /\.\w{3,4}$/.test(rec.name) ? rec.name : "veda-ai-image." + extOf(rec.mime));
    document.body.appendChild(a); a.click(); a.remove();
  }
  async function copyImage(id) {
    try {
      const rec = await loadFile(id);
      let blob = await (await fetch(recUrl(rec))).blob();
      if (blob.type !== "image/png") {
        const bmp = await createImageBitmap(blob);
        const cv = document.createElement("canvas"); cv.width = bmp.width; cv.height = bmp.height;
        cv.getContext("2d").drawImage(bmp, 0, 0);
        blob = await new Promise((r) => cv.toBlob(r, "image/png"));
      }
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("Image copy ho gayi");
    } catch { toast("Is browser me image copy nahi hui. Download use karo."); }
  }
  let viewerId = null;
  async function openImage(id) {
    const rec = await loadFile(id); if (!rec || !rec.data) return toast("Image nahi mili.");
    viewerId = id;
    $("#imgBig").src = recUrl(rec);
    $("#imgTitle").textContent = rec.name || "Image";
    $("#imgModal").hidden = false;
  }
  function renderContent(msgEl, m, live) {
    const c = $(".content", msgEl);
    let text = stripMemory(m.text || "");
    const sd = splitDoc(text, m.docMode);
    c.innerHTML = renderMarkdown(sd.display);
    c.classList.toggle("cursor", !!live);
    // har ```html block par "▶ Run" button (sandboxed live preview)
    if (!live) $$(".code", c).forEach((codeEl) => {
      const lang = (($(".code-head span", codeEl) || {}).textContent || "").trim().toLowerCase();
      if ((lang === "html" || lang === "svg") && !$(".run-html", codeEl)) {
        const b = document.createElement("button");
        b.type = "button"; b.className = "run-html"; b.textContent = "▶ Run";
        b.title = "Sandboxed preview me chalao";
        b.onclick = () => openRunner($("code", codeEl).textContent, "HTML Preview");
        $(".code-head", codeEl).appendChild(b);
      }
    });
    // lamba message: collapse (performance + padhne me aasan)
    const LONG = 4000;
    if (!live && !c.dataset.clps && text.length > LONG) {
      c.dataset.clps = "1";
      c.classList.add("collapsed");
      const t = document.createElement("button");
      t.type = "button"; t.className = "expand-btn";
      t.textContent = "📖 Poora dikhao (" + Math.round(text.length / 1000) + "k akshar)";
      t.onclick = () => { c.classList.remove("collapsed"); t.remove(); };
      c.after(t);
    }
    let card = $(".doc-card", msgEl);
    if (sd.html && !live) {
      if (!card) {
        card = document.createElement("div");
        card.className = "doc-card";
        card.innerHTML = '<div class="ic">📄</div><div class="tx"><b>Document taiyar hai</b><small>Preview dekho, PDF ya Word me save karo</small></div><div class="doc-btns"><button class="btn primary act-open">Kholo</button><button class="btn ghost act-run">▶ Run</button></div>';
        c.after(card);
      }
      $(".act-open", card).onclick = () => openSdDoc(sd, m);
      $(".act-run", card).onclick = () => openRunner(sd.html, docTitleFrom(sd.html));
    } else if (card) card.remove();
    let ex = $(".err", msgEl); if (ex) ex.remove();
    if (m.error) {
      const e = document.createElement("div"); e.className = "err"; e.textContent = "⚠️ " + m.error;
      msgEl.querySelector(".bubble").appendChild(e);
    }
    let src = $(".sources", msgEl);
    if (m.sources && m.sources.length) {
      if (!src) { src = document.createElement("div"); src.className = "sources"; msgEl.querySelector(".bubble").appendChild(src); }
      src.innerHTML = m.sources.slice(0, 8).map((s) => '<a href="' + esc(s.uri) + '" target="_blank" rel="noopener">🔗 ' + esc(s.title || s.uri) + "</a>").join("");
    }
  }

  function buildMsgEl(m, chat) {
    const d = document.createElement("div");
    d.className = "msg " + (m.role === "user" ? "user" : "ai");
    d.dataset.id = m.id;
    // dynamic text style (AI jawabon par): settings ya is message ki maang
    const ts = m.role === "user" ? "normal" : (m.style || settings.textStyle || "normal");
    if (ts !== "normal") d.classList.add("ts-" + ts);
    const isLast = chat.messages[chat.messages.length - 1] === m;
    let html = '<div class="bubble">';
    if (m.role !== "user") html += '<div class="who"><i>✦</i> Veda AI</div>';
    if (m.files && m.files.length) html += '<div class="files">' + m.files.map(chipHtml).join("") + "</div>";
    html += '<div class="content md"></div>';
    html += '<div class="meta"></div></div><div class="actions"></div>';
    d.innerHTML = html;
    const meta = $(".meta", d);
    meta.textContent = fmtTime(m.ts) + (m.model ? " · " + m.model : "");
    const act = $(".actions", d);
    const add = (label, title, fn, cls) => {
      const b = document.createElement("button"); b.textContent = label; b.title = title; if (cls) b.className = cls;
      b.onclick = (e) => fn(e, b); act.appendChild(b); return b;
    };
    add("📋", "Copy", () => { navigator.clipboard.writeText(stripMemory(m.text || "")).then(() => toast("Copy ho gaya")); });
    if (m.role !== "user" && /```zipfix/.test(m.text || "")) add("🔧", "Fix karke ZIP download karo", () => zipBuildFix(m.text));
    const pinned = isPinned(chat, m.id);
    add(pinned ? "📌" : "📍", pinned ? "Unpin karo" : "Pin karo", () => togglePin(chat.id, m.id), pinned ? "pinned" : "");
    if (m.role === "user") {
      add("✏️", "Badlo aur dobara bhejo", () => editFrom(m.id));
    } else {
      if (!m.imgGen) {
        add("🔊", "Suno", (e, b) => toggleSpeak(m, b), "speak");
        add("📄", "PDF / Word / HTML banao", () => {
          const sd = splitDoc(stripMemory(m.text || ""), m.docMode);
          if (sd.html) openSdDoc(sd, m);
          else openDoc(mdToDoc(stripMemory(m.text || ""), chat.title), chat.title);
        });
      }
      add("👎", "Galat tha? Batao, AI seekhega", () => feedbackBad(m));
      if (isLast) add("🔄", "Dobara likho", () => regenerate());
      if (m.error) add("🔁", "Dobara try karo", () => { if (!streaming) { const u = [...chat.messages].reverse().find((x) => x.role === "user" && !x.error); if (u) { el.input.value = u.text || ""; send(); } } });
    }
    add("🗑️", "Mitao", () => deleteMsg(m.id));
    renderContent(d, m, false);
    hydrateImages(d);
    return d;
  }

  function renderMessages() {
    const chat = currentChat();
    $$(".msg", el.messages).forEach((n) => n.remove());
    if (chat && isLocked(chat) && !unlockedChats.has(chat.id)) {
      el.empty.hidden = true;
      el.messages.innerHTML = '<div class="lock-screen"><div class="lock-ic">🔒</div><p>Ye chat lock hai.</p><button class="btn primary" id="unlockNow">Passcode se kholo</button></div>';
      $("#unlockNow").onclick = () => openChat(chat.id);
      return;
    }
    if (!chat || !chat.messages.length) { el.empty.hidden = false; return; }
    el.empty.hidden = true;
    chat.messages.forEach((m) => el.messages.appendChild(buildMsgEl(m, chat)));
    scrollDown(true);
  }
  function renderAll() {
    const chat = currentChat();
    el.title.textContent = chat ? chat.title : "Veda AI";
    const last = chat && [...chat.messages].reverse().find((m) => m.model);
    el.badge.textContent = last ? last.model : "";
    renderChatList(); renderMessages(); renderTools();
  }

  /* =====================  SEND / GENERATE  ===================== */
  function headers() {
    // BYOK: key hamesha user ke Settings se, har request ke header me. Server par koi key nahi rehti.
    const h = { "Content-Type": "application/json" };
    if (settings.apiKey) h["x-api-key"] = settings.apiKey;
    if (settings.accessCode) h["x-access-code"] = settings.accessCode;
    h["x-ai-provider"] = settings.provider === "llama" ? "llama" : "gemini";
    if (settings.provider === "llama" && settings.llamaKey) h["x-llama-key"] = settings.llamaKey;
    return h;
  }
  const DOC_RULES = "\n\nUser ko ek PDF/document chahiye. Document ```vpdf code block me VPDF markup me do (HTML mat likho). Markup:\n" +
    "theme: navy-gold|ocean|emerald|sunset|minimal — user ne rang bola to wahi (jaise 'neele rang me' = ocean), nahi to navy-gold.\n" +
    "[cover]\n# बड़ा शीर्षक\nउपशीर्षक line\n[/cover] — lamba document ho to shuru me cover do.\n" +
    "## heading, ### chhoti heading; khaali line = naya paragraph; - bullet; 1. numbered list; **bold**; *italic*; `code`; [c:blue]rangin text[/c] (red/blue/green/gold/purple/orange).\n" +
    "::: highlight|note|warn|def|formula\n**box ka title**\ncontent lines\n::: — mukhya bindu/sutra/paribhasha ke liye box.\n" +
    "| head1 | head2 |\n|---|---|\n| a | b | — aisi tables (pehli line header apne aap rangeen).\n" +
    "[mcq]\nQ: sawal?\n(a) .. (b) .. (c) .. (d) ..\nउत्तर: (b) ..\n[/mcq] — ant me उत्तरमाला apne aap banegi.\n" +
    "[diagram type=flow|vflow|layers|cycle title=\"शीर्षक\"]\nA -> B -> C\n[/diagram] — saral rekha-chitra (label wale box + teer), painting jaisa kuch nahi.\n" +
    "--- = divider line.\n" +
    "Content POORA likho: koi placeholder, '...', 'baaki isi tarah' ya adhura hissa nahi. Jitne sawal/points/pages bole utne hi, ginti karke. " +
    "Hindi apne aap sundar Devanagari font me aayegi. Code block ke bahar sirf ek chhoti line likho ki kya banaya.";
  /* =====================  MOODS  ===================== */
  const MOODS = [
    ["normal", "🙂 Normal"],
    ["funny", "🤣 Funny"],
    ["story", "📖 Kahani"],
    ["teacher", "🔤 English Teacher"],
    ["deep", "🎓 Deep Study"],
  ];
  const MOOD_NOTE = {
    funny: "\n\nMOOD — Funny: halka masti-bhara khush-mizaaj tone rakho; sahi jagah par chutkule aur (user poochhe to) crazy emojis istemal karo; jaankari bilkul sahi rakho.",
    story: "\n\nMOOD — Kahani (Storyteller): jawab ek kahani/kisse ki tarah sunao — dilchasp shuruaat, beech me jeevant varnan, yaadgar ant; Hindi me.",
    teacher: "\n\nMOOD — English Teacher: English sikhao. Har naya/kathin English shabd: Hindi arth + Hindi me uchcharan + ek aasaan udaaharan vaakya. Hindi aur English dono me samjhao, dheere-dheere level badhao, ant me ek chhota practice sawal do.",
    deep: "\n\nMOOD — Deep Study: Bihar Board syllabus ke hisaab se bahut gehra, research-backed, vistaar se samjhao. Har kathin shabd define karo, har concept example se kholo, koi hissa mat chhodo. Lambai ki koi seema nahi — jitna zaroori ho utna POORA likho.",
  };
  /* =====================  MOODS UI  ===================== */
  function renderMoods() {
    const bar = $("#moodBar");
    if (!bar) return;
    bar.innerHTML = "";
    MOODS.forEach(([k, label]) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "mood-chip" + (settings.mood === k ? " on" : "");
      b.textContent = label;
      b.onclick = () => { settings.mood = k; saveSettings(); renderMoods(); toast("Mood: " + label); };
      bar.appendChild(b);
    });
  }
  function buildSystem(m) {
    let s =
      "Tum 'Veda AI' ho: tez, saaf, bharosemand aur madadgaar AI assistant. " +
      "User jis bhasha me likhe (Hindi, Hinglish, English) usi me jawab do. Seedha kaam ki baat karo, bekaar bhumika mat bandho. " +
      "JO BOLA GAYA WAHI KARO: jitna aur jaisa user bole utna hi, na kam na zyada; uske diye mode/style/format/ginti ko pakka maano. " +
      "Jawab saaf formatting me do (zaroorat par headings, bullets, tables, code blocks). " +
      "Agar koi baat pakki na ho to andaza mat lagao, saaf bolo ki pakka nahi pata. " +
      "Taaza khabar, aaj ki news, daam, score, weather, naye events: Google Search se jaanch kar batao aur tareekh saath likho. " +
      "KITAB / PDF / CHAPTER ke kaam: file ko shuru se aakhir tak dhyan se padho aur sirf usi ke content se kaam karo. " +
      "Agar user N sawal maange to bilkul N sawal do (ginti karke), answer ke saath, kitab ke alag-alag hisson se. " +
      "Agar 'line by line explain / poori kitab samjhao' bole to har hissa kram se, Hindi me line-by-line samjhao, koi hissa chhodo mat, beech me ruko mat; lamba ho to likhte jao, system khud aage badhayega. " +
      "Rasta/direction mange par Google Maps ka seedha link do: https://www.google.com/maps/dir/?api=1&destination=<jagah>. " +
      "'Copy format me do' bole to jawab code block me do taaki copy ho sake. " +
      "Kisi bhi tathyaatmak daave se pehle khud verify karo; galat jaankari mat do. " +
      "Aaj ki tareekh/samay: " + new Date().toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" }) + ". ";
    if (settings.emojiMode) s += "\n\nUser ne masti wala mood chuna hai: jawab me sahi jagah par emojis istemal karo, halka khush-mizaaj tone rakho, par jaankari sahi rakho.";
    s += MOOD_NOTE[settings.mood] || "";
    s += "\n\nRANGIN TEXT: agar jawab me kisi khaas baat par rang chahiye to [c:blue]ye wala text[/c] likho. Rang SIRF inme se: red, blue, green, gold, purple, orange. Zaroorat se zyada rang mat lagao.";
    if (settings.persona.trim()) s += "\n\nUser ke apne niyam (inhe maano):\n" + settings.persona.trim();
    if (settings.autoLearn) {
      s += "\n\nYaad rakhne ka niyam: agar user apne baare me koi lambe samay tak kaam aane wali baat bataye (naam, kaam, pasand, ya kisi galti ko sudharne ka tareeka), to jawab ke bilkul aakhir me ek alag line me <memory>chhoti si baat</memory> likho. Sirf tabhi jab sach me zaroori ho. Normal sawalon me kabhi nahi.";
    }
    if (memory.length) s += "\n\nUser ke baare me jo tumhe pata hai (galtiyan dobara mat dohrana):\n- " + memory.join("\n- ");
    if (m && m.docMode) s += DOC_RULES;
    return s;
  }

  /* ============  PDF TEXT (client-side pdf.js) — AI PDF ko padh/edit kar sake  ============ */
  const pdfTextCache = new Map();
  function pdfjsReady() {
    try {
      if (window.pdfjsLib) {
        const w = window.pdfjsLib.GlobalWorkerOptions;
        if (w && !w.workerSrc) w.workerSrc = "pdf.worker.min.js";
        return true;
      }
    } catch {}
    return false;
  }
  async function ensurePdfJs() {
    if (pdfjsReady()) return true;
    try {
      await new Promise((res, rej) => {
        const sc = document.createElement("script"); sc.src = "pdf.min.js";
        sc.onload = res; sc.onerror = () => rej(new Error("PDF engine load nahi hua"));
        document.head.appendChild(sc);
      });
    } catch { return false; }
    return pdfjsReady();
  }
  async function pdfTextOf(rec) {
    if (pdfTextCache.has(rec.id)) return pdfTextCache.get(rec.id);
    let out = "";
    try {
      if (!(await ensurePdfJs())) return "";
      const raw = Uint8Array.from(atob(rec.data), (c) => c.charCodeAt(0));
      const pdf = await window.pdfjsLib.getDocument({ data: raw }).promise;
      const n = Math.min(pdf.numPages, 80);
      const pages = [];
      for (let i = 1; i <= n; i++) {
        const page = await pdf.getPage(i);
        const tc = await page.getTextContent();
        pages.push("--- Page " + i + " ---\n" + tc.items.map((it) => it.str).join(" "));
        if (page.cleanup) page.cleanup();
      }
      if (pdf.numPages > n) pages.push("…[kul " + pdf.numPages + " pages; pehle " + n + " ka text]");
      out = pages.join("\n\n").slice(0, 150000);
    } catch (e) { out = ""; }
    pdfTextCache.set(rec.id, out);
    return out;
  }

  const TEXT_INLINE_MAX = 800000; // ek baar me ~200k tokens; isse badi file hisson me
  const TEXT_CHUNK_MAX = 11; // kul ~9.6M akshar (~1 crore) tak sequential processing
  async function buildContents(msgs) {
    const usable = msgs.filter((m) => !m.error && (m.text || (m.files && m.files.length))).slice(-24);
    while (usable.length && usable[0].role !== "user") usable.shift();
    const recentFrom = Math.max(0, usable.length - 10);
    const out = [];
    const extraChunks = []; // badi text files ke agle hisse (book pipeline)
    for (let i = 0; i < usable.length; i++) {
      const m = usable[i];
      const parts = [];
      if (m.role === "user" && m.files && m.files.length) {
        for (const f of m.files) {
          if (i < recentFrom) { parts.push({ text: `[Pehle attach ki gayi file: ${f.name}]` }); continue; }
          const rec = await loadFile(f.id);
          if (!rec) { parts.push({ text: `[File "${f.name}" ab available nahi hai]` }); continue; }
          if (rec.kind === "text") {
            const t = rec.text || "";
            if (t.length > TEXT_INLINE_MAX + 5000) {
              const total = Math.ceil(t.length / TEXT_INLINE_MAX);
              parts.push({ text: `File "${f.name}" bahut badi hai (kul ${total} hisse). Ye hissa 1/${total} hai; baaki hisse agle messages me kram se bhejunga. Har hisse par kaam jaari rakho, beech me ruko mat:\n\n${t.slice(0, TEXT_INLINE_MAX)}` });
              for (let s = TEXT_INLINE_MAX; s < t.length && extraChunks.length < TEXT_CHUNK_MAX; s += TEXT_INLINE_MAX) {
                extraChunks.push({ name: f.name, idx: extraChunks.length + 2, total, text: t.slice(Math.max(0, s - 5000), s + TEXT_INLINE_MAX) });
              }
            } else parts.push({ text: `File "${rec.name}" ka text:\n\n${t.slice(0, TEXT_INLINE_MAX)}` });
          }
          else if (rec.kind === "image" || rec.kind === "audio" || rec.kind === "video") {
            parts.push({ inlineData: { mimeType: rec.mime, data: rec.data } });
          }
          else if (rec.kind === "pdf") {
            // PDF ka text nikalo taaki AI use padh, edit aur replace kar sake
            const t = await pdfTextOf(rec);
            if (t) parts.push({ text: `File "${rec.name}" ka poora text (PDF se nikala gaya — isi ko padhkar edit/replace/sawal-jawab karo):\n\n${t}` });
            else parts.push({ inlineData: { mimeType: "application/pdf", data: rec.data } });
          }
          else if (rec.kind === "zip") {
            parts.push({ text: `[ZIP file "${rec.name}" attach hai. User "🤖 ZIP Debugger" button se iska bug-analysis karwa sakta hai.]` });
          }
          else parts.push({ inlineData: { mimeType: rec.mime, data: rec.data } });
        }
      }
      const t = m.role === "model" ? stripMemory(m.text || "") : m.text || "";
      parts.push({ text: t || "(khali)" });
      out.push({ role: m.role === "user" ? "user" : "model", parts });
    }
    return { contents: out, extraChunks };
  }

  function setBusy(b) {
    el.sendBtn.hidden = b; el.stopBtn.hidden = !b;
  }

  async function send(override, opts = {}) {
    if (streaming) return;
    const fromInput = typeof override !== "string";
    const inputSnapshot = fromInput ? el.input.value : null; // clear se pehle ka snapshot
    let text = (fromInput ? el.input.value : override).trim();
    if (!text && !pending.length) return;
    stopSpeak(); sndSend();
    { const needKey = settings.provider === "llama" ? !settings.llamaKey : !settings.apiKey; if (needKey) { openSettings(); toast(settings.provider === "llama" ? "Pehle Settings me apni Llama key daalo." : "Pehle Settings me apni free Gemini key daalo."); return; } } // fail: text surakshit rakho
    const chat = currentChat() || newChat();
    const files = pending.splice(0);
    for (const f of files) { fileCache.set(f.id, f); await idb.put(f); Cloud.markFile(f.id); }
    const msg = {
      id: uid(), role: "user", ts: Date.now(),
      text: text || "Is file ko dhyan se padho/dekho aur saaransh (summary) do.",
      files: files.map(({ id, name, mime, kind, size }) => ({ id, name, mime, kind, size })),
    };
    chat.messages.push(msg);
    if (chat.title === "Nayi chat") chat.title = msg.text.replace(/\s+/g, " ").slice(0, 42);
    chat.updated = Date.now();
    // style request? ("peele rang me bolo" / "hamesha bold me")
    const sr = detectStyleReq(text);
    if (sr) {
      msg.reqStyle = sr.style;
      if (sr.persist) { settings.textStyle = sr.style; saveSettings(); toast("🎨 Style save ho gaya: " + sr.style); }
    }
    // INPUT CLEAR (race-safe): message pakka bhej diya gaya -> input tabhi clear karo
    // jab usme abhi bhi wahi text ho jo bheja gaya (beech me user/mic ne kuch naya likha ho to chhedo mat)
    if (fromInput && el.input.value === inputSnapshot) { el.input.value = ""; autosize(); }
    renderPending();
    el.empty.hidden = true;
    el.messages.appendChild(buildMsgEl(msg, chat));
    el.title.textContent = chat.title;
    scrollDown(true);
    await generate(chat, wantsDoc(text));
  }
  // "pdf bana do / resume banao" jaisa bolne par PDF mode apne aap
  function wantsDoc(text) {
    if (docMode) return true;
    const t = text.toLowerCase();
    const noun = /(\bpdf\b|\bresume\b|\bcv\b|bio-?data|\binvoice\b|certificate|brochure|worksheet|question paper|prashn patra|\bnotes?\b|\breport\b|\bletter\b|application|\bdocument\b|पीडीएफ|\bpdf\b)/;
    const verb = /(bana|banao|banado|bana do|banaiye|banana|create|make|generate|design|tayar|taiyar|तैयार|बना)/;
    const ask = /(summary|saaransh|samjhao|explain|translate|anuvaad|extract|nikalo|padho|kya hai|question answer|sawal jawab)/;
    if (/pdf/.test(t) && /(bana|create|make|generate|tayar|taiyar|बना|तैयार)/.test(t) && !/(summary|saaransh)/.test(t)) return true;
    return noun.test(t) && verb.test(t) && !ask.test(t);
  }

  const CONTINUE = "Bilkul wahin se aage likho jahan ruke the. Jo likh chuke ho use dohrao mat, naya shuru mat karo. Poora kaam khatam hone tak likho.";
  /* =====================  TASK ENGINE (client)  ===================== */
  // Lambe kaam (badi kitab) server par task ke roop me track hote hain:
  // checkpoint me prompt + file IDs + hissa-ginti, taaki rukne par dobara shuru ho sake.
  /* ============  TASKS (Veda v1: server task engine nahi — local stub)  ============ */
  const Tasks = {
    async create() { return null; },
    patch() {},
    async active() { return []; },
    async resume() { toast("Resume ab available nahi hai."); },
    async checkInterrupted() {},
  };

  async function generate(chat, asDoc) {
    const lastUser = [...chat.messages].reverse().find((m) => m.role === "user");
    const aiMsg = { id: uid(), role: "model", text: "", ts: Date.now(), docMode: !!asDoc, style: (lastUser && lastUser.reqStyle) || settings.textStyle || "normal" };
    const { contents, extraChunks } = await buildContents(chat.messages);
    chat.messages.push(aiMsg);
    // Lamba kaam (badi kitab): server task banao taaki progress track ho aur rukne par resume mile
    let bookTask = null, bookTotal = 0;
    if (extraChunks.length) {
      bookTotal = extraChunks.length + 1;
      bookTask = await Tasks.create("book", chat.title);
      if (bookTask) Tasks.patch(bookTask.id, {
        checkpoint: { userText: lastUser.text, fileIds: (lastUser.files || []).map((f) => f.id), total: bookTotal, done: 0 },
      });
    }
    // pichle "last" ka regenerate button hatao
    $$(".msg.ai .actions button[title='Dobara likho']", el.messages).forEach((b) => b.remove());
    const node = buildMsgEl(aiMsg, chat);
    node.classList.add("typing"); // likhte hue cursor + animation
    el.messages.appendChild(node);
    renderContent(node, aiMsg, true);
    scrollDown(true);
    // live activity status (sirf asli kaam par dikhega)
    const stDiv = document.createElement("div");
    stDiv.className = "gen-status";
    node.querySelector(".bubble").appendChild(stDiv);
    const setStatus = (t) => { stDiv.textContent = t || ""; stDiv.hidden = !t; };
    let gotFirst = false;
    const thinkTimer = setTimeout(() => { if (!gotFirst) setStatus("✦ AI soch raha hai…"); }, 700);

    const controller = new AbortController();
    streaming = { controller };
    setBusy(true);
    // ⏱️ processing indicator + second-wise timer (input ke paas)
    const procBar = $("#procBar"), procTxt = $("#procTxt"), genTimer = $("#genTimer");
    const t0 = Date.now();
    procBar.hidden = false;
    procTxt.textContent = asDoc ? "📄 Document ban raha hai…" : "✦ AI kaam kar raha hai…";
    genTimer.textContent = "0.0s";
    const tickTimer = setInterval(() => { genTimer.textContent = ((Date.now() - t0) / 1000).toFixed(1) + "s"; }, 100);
    const stopProc = () => { clearInterval(tickTimer); procBar.hidden = true; };
    let raf = 0;
    const paint = () => { raf = 0; renderContent(node, aiMsg, true); scrollDown(); };
    const system = buildSystem(aiMsg) + styleSystemNote(aiMsg.style);
    try {
      let round = 0, finish = "", chunkMsg = null, retriedOnce = false;
      for (;;) {
        const send = chunkMsg || (round === 0 ? contents : [...contents,
          { role: "model", parts: [{ text: aiMsg.text.slice(-60000) || "(shuru)" }] },
          { role: "user", parts: [{ text: CONTINUE }] }]);
        chunkMsg = null;
        const res = await fetch("/api/chat", {
          method: "POST", headers: headers(), signal: controller.signal,
          body: JSON.stringify({ model: settings.model, provider: settings.provider, contents: send, system, temperature: Number(settings.temperature), search: asDoc ? false : settings.search !== false }),
        });
        if (!res.ok) {
          let e = "", retryable = false;
          try { const j = await res.json(); e = j.error; retryable = j.retryable !== false; } catch {}
          if (res.status === 401) openSettings();
          if (round > 0 && aiMsg.text) break; // aadha jawab mil chuka, wahi rakho
          // transient failure (429/502/503) par EK baar ASLI retry — imaandaar status ke saath, nakli progress nahi
          if (!retriedOnce && retryable && (res.status === 429 || res.status === 502 || res.status === 503) && !controller.signal.aborted) {
            retriedOnce = true;
            setStatus("⏳ AI service busy hai, dobara try kar raha hun…");
            await new Promise((r) => setTimeout(r, 2600));
            if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
            setStatus("");
            continue; // isi request ko dobara bhejo
          }
          throw new Error(e || "Error " + res.status);
        }
        aiMsg.model = res.headers.get("X-Model-Used") || aiMsg.model || "";
        finish = "";
        const before = aiMsg.text.length;
        await readStream(res, (d) => {
          if (!gotFirst) { gotFirst = true; setStatus(""); }
          aiMsg.text += d; if (!raf) raf = requestAnimationFrame(paint);
        }, (meta) => {
          if (meta.sources) aiMsg.sources = meta.sources;
          if (meta.block) aiMsg.error = meta.block;
          if (meta.finish) finish = meta.finish;
          if (meta.finish && meta.finish !== "STOP" && meta.finish !== "MAX_TOKENS" && !aiMsg.text) aiMsg.error = "Jawab roka gaya (" + meta.finish + "). Sawal thoda badal ke poochho.";
        });
        round++;
        // badi kitab: agla hissa khilao (persistent state: aiMsg.text me sab jama)
        if (extraChunks.length && round < 14 && !controller.signal.aborted) {
          const ch = extraChunks.shift();
          if (bookTask) Tasks.patch(bookTask.id, {
            progress: Math.round(((bookTotal - extraChunks.length) / bookTotal) * 100),
            checkpoint: { userText: lastUser.text, fileIds: (lastUser.files || []).map((f) => f.id), total: bookTotal, done: bookTotal - extraChunks.length },
          });
          setStatus("📚 Kitab ka hissa " + ch.idx + "/" + ch.total + " padha ja raha hai… (" + aiMsg.text.length.toLocaleString("en-IN") + " akshar likhe)");
          chunkMsg = [...contents,
            { role: "model", parts: [{ text: aiMsg.text.slice(-60000) || "(shuru)" }] },
            { role: "user", parts: [{ text: `File "${ch.name}" ka agla hissa (hissa ${ch.idx}/${ch.total}). Ab tak jo samjhaya/likha hai uska sandarbh banaye rakho, koi hissa chhode bina kaam JAARI rakho, beech me ruko mat:\n\n${ch.text}` }] }];
          continue;
        }
        // lamba jawab beech me kata to apne aap aage badhao (poori kitab / lamba PDF)
        if (finish === "MAX_TOKENS" && round < 12 && aiMsg.text.length > before && !controller.signal.aborted) {
          if (!aiMsg.note) aiMsg.note = "lamba hone se kai hisson me likha gaya";
          setStatus("📖 Lamba jawab: hissa " + (round + 1) + " likha ja raha hai…");
          continue;
        }
        break;
      }
      if (!aiMsg.text.trim() && !aiMsg.error) aiMsg.error = "Jawab khali aaya. Dobara koshish karo (🔄).";
    } catch (e) {
      if (e.name !== "AbortError") aiMsg.error = e.message || "Kuch gadbad hui";
    } finally {
      if (raf) cancelAnimationFrame(raf);
      clearTimeout(thinkTimer);
      streaming = null; setBusy(false); stopProc();
      sndRecv();
      // task ka antim status
      if (bookTask) {
        if (controller.signal.aborted) Tasks.patch(bookTask.id, { status: "cancelled" });
        else if (aiMsg.error) Tasks.patch(bookTask.id, { status: "failed", error: String(aiMsg.error).slice(0, 200) });
        else Tasks.patch(bookTask.id, { status: "completed", progress: 100 });
      }
    }
    // memory tags nikalo
    const found = [];
    aiMsg.text = aiMsg.text.replace(/<memory>([\s\S]*?)<\/memory>/gi, (m, t) => { found.push(t.trim()); return ""; }).replace(/<memory>[\s\S]*$/i, "").trim();
    if (found.length && settings.autoLearn) addMemory(found);
    chat.updated = Date.now();
    saveChatsNow();
    const fresh = buildMsgEl(aiMsg, chat);
    node.replaceWith(fresh);
    el.badge.textContent = (aiMsg.model || "") + (settings.provider === "llama" ? " 🦙" : "");
    renderChatList(); scrollDown();
    // PDF/document taiyar -> turant preview kholo, wahin se sudhaar kar sakte ho
    const lastU = [...chat.messages].reverse().find((x) => x.role === "user" && !x.error);
    const sd = aiMsg.docMode && !aiMsg.error ? splitDoc(stripMemory(aiMsg.text), true, lastU && lastU.text) : null;
    if (sd && sd.html) { openSdDoc(sd, aiMsg); return; }
    if (aiMsg.text && !aiMsg.error && (settings.autoSpeak || settings.handsFree)) speak(aiMsg.text, $(".speak", fresh));
  }

  async function readStream(res, onText, onMeta) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    const handle = (j) => {
      if (j.promptFeedback && j.promptFeedback.blockReason) onMeta({ block: "Sawal block hua: " + j.promptFeedback.blockReason });
      const c = j.candidates && j.candidates[0];
      if (!c) return;
      for (const p of (c.content && c.content.parts) || []) if (p.text && !p.thought) onText(p.text);
      if (c.finishReason) onMeta({ finish: c.finishReason });
      const gm = c.groundingMetadata;
      if (gm && gm.groundingChunks) {
        const s = gm.groundingChunks.filter((x) => x.web).map((x) => ({ title: x.web.title, uri: x.web.uri }));
        if (s.length) onMeta({ sources: s });
      }
    };
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const d = line.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        try { handle(JSON.parse(d)); } catch {}
      }
    }
  }

  function stopGen() { if (streaming) streaming.controller.abort(); }
  function deleteMsg(id) {
    const chat = currentChat(); if (!chat) return;
    const m = chat.messages.find((x) => x.id === id);
    if (m) [...(m.files || []), ...(m.images || [])].forEach((f) => { idb.del(f.id); fileCache.delete(f.id); });
    chat.messages = chat.messages.filter((x) => x.id !== id);
    saveChatsNow(); renderMessages();
  }
  function editFrom(id) {
    if (streaming) return;
    const chat = currentChat(); if (!chat) return;
    const i = chat.messages.findIndex((x) => x.id === id); if (i < 0) return;
    const m = chat.messages[i];
    chat.messages = chat.messages.slice(0, i);
    el.input.value = m.text; autosize(); el.input.focus();
    saveChatsNow(); renderMessages();
  }
  async function regenerate() {
    if (streaming) return;
    const chat = currentChat(); if (!chat) return;
    while (chat.messages.length && chat.messages[chat.messages.length - 1].role === "model") chat.messages.pop();
    if (!chat.messages.length) return;
    renderMessages();
    const lastUser = chat.messages[chat.messages.length - 1];
    await generate(chat, wantsDoc((lastUser && lastUser.text) || ""));
  }

  /* =====================  DYNAMIC TEXT STYLE  ===================== */
  function detectStyleReq(t) {
    const s = (t || "").toLowerCase();
    let style = null;
    if (/(peel[aeiou]|yellow)/.test(s)) style = "yellow";
    else if (/(neel[aeiou]|blue)/.test(s)) style = "blue";
    else if (/bold/.test(s)) style = "bold";
    else if (/(bad[ae] (akshar|text|font)|large)/.test(s)) style = "large";
    else if (/(hacker|matrix|green terminal)/.test(s)) style = "hacker";
    else if (/(plain( text)? me|bina formatting|saada)/.test(s)) style = "plain";
    else if (/normal (me|karo|style)/.test(s)) style = "normal";
    if (!style) return null;
    const persist = /(hamesha|always|yaad rakho|set kar do|default)/.test(s);
    return { style, persist };
  }
  function styleSystemNote(style) {
    if (style === "plain") return " Jawab PLAIN TEXT me do: koi bold/italic/heading/table formatting nahi, sirf saaf lines.";
    if (style === "yellow") return " (UI tumhara jawab peele rang me dikhayega.)";
    if (style === "blue") return " (UI tumhara jawab neele rang me dikhayega.)";
    if (style === "bold") return " (UI tumhara jawab bold me dikhayega.)";
    if (style === "large") return " (UI tumhara jawab bade akshar me dikhayega.)";
    if (style === "hacker") return " (UI tumhara jawab hacker-terminal style me dikhayega.)";
    return "";
  }
  function addMemory(items) {
    let changed = false;
    items.forEach((t) => {
      t = t.replace(/\s+/g, " ").trim().slice(0, 240);
      if (t.length < 3) return;
      if (memory.some((x) => x.toLowerCase() === t.toLowerCase())) return;
      memory.push(t); changed = true;
    });
    if (memory.length > 100) memory = memory.slice(-100);
    if (changed) { saveMemory(); toast("🧠 Memory me jud gaya"); }
  }
  function feedbackBad(m) {
    const why = prompt("AI se kya galti hui? Ek line me batao (ye AI hamesha yaad rakhega):", "");
    if (!why || !why.trim()) return;
    addMemory(["Dhyan rakho (user ne sudhaara): " + why.trim()]);
  }
  function renderMemory() {
    const box = $("#memList"); box.innerHTML = "";
    if (!memory.length) box.innerHTML = '<div class="small-note">Abhi kuch yaad nahi. AI jaise-jaise tumhe jaanega yahan judta jayega.</div>';
    memory.forEach((t, i) => {
      const d = document.createElement("div"); d.className = "mem-item";
      d.innerHTML = "<span></span><button title='Mitao'>✕</button>";
      $("span", d).textContent = t;
      $("button", d).onclick = () => { memory.splice(i, 1); saveMemory(); renderMemory(); };
      box.appendChild(d);
    });
  }

  /* =====================  VOICE: MIC (state machine)  =====================
     States: idle -> listening -> processing -> idle | error
     - duplicate sessions kabhi nahi (ek hi active recognizer)
     - har state me saaf visual feedback
     - stop par transcript input me, user edit kar sakta hai
     - send safal hote hi input pakka clear (send-token), fail/busy par text surakshit + toast */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const Mic = {
    state: "idle", // idle | listening | processing | transcribed | error
    rec: null,
    target: null,
    btn: null,
    main: true,
    base: "",
    finalText: "",
    heard: false,
    set(s, msg) {
      this.state = s;
      const b = this.btn || el.micBtn;
      if (b) { b.classList.toggle("on", s === "listening"); b.classList.toggle("err", s === "error"); b.classList.toggle("done", s === "transcribed"); b.dataset.mic = s; }
      if (this.main) {
        el.listenBar.hidden = !(s === "listening" || s === "processing" || s === "transcribed");
        el.listenBar.classList.toggle("heard", s === "processing" || s === "transcribed");
        if (s === "listening") el.listenTxt.textContent = msg || "Boliye, main sun raha hun…";
        else if (s === "processing") el.listenTxt.textContent = msg || "Samajh raha hun…";
        else if (s === "transcribed") el.listenTxt.textContent = msg || "Likh diya ✓ — edit karke Send dabao";
      }
    },
  };
  function startMic(target = el.input, btn = el.micBtn) {
    // BUG FIX: onclick handler seedha startMic ko saumpne par browser MouseEvent bhejta hai,
    // jo target ban jaata tha -> target.value undefined -> TypeError -> chat mic kabhi chalta hi nahi tha.
    // (PDF wala button arrow-function wrapper use karta tha, isliye wahan kaam karta tha.)
    if (!target || typeof target.value !== "string" || typeof target.focus !== "function") target = el.input;
    if (!btn || typeof btn.classList === "undefined") btn = el.micBtn;
    const main = target === el.input;
    if (!SR) { fallbackVoice(target, btn, main); return; }
    if (Mic.state === "listening" || Mic.state === "processing") { stopMic(); return; } // dobara dabao = roko
    if (streaming && main) { toast("Pehle AI ka jawab aane do, phir bolo."); return; }
    stopSpeak();
    let rec;
    try { rec = new SR(); } catch { toast("Mic shuru nahi hua, dobara dabao."); return; }
    Mic.rec = rec; Mic.target = target; Mic.btn = btn || el.micBtn; Mic.main = main;
    Mic.base = target.value.trim() ? target.value.trim() + " " : "";
    Mic.finalText = ""; Mic.heard = false;
    rec.lang = settings.micLang; rec.interimResults = true; rec.continuous = false; rec.maxAlternatives = 1;
    const fit = () => {
      if (main) autosize();
      else { target.style.height = "auto"; target.style.height = Math.min(target.scrollHeight, 120) + "px"; }
    };
    rec.onresult = (e) => {
      if (Mic.rec !== rec) return; // purana session, ignore
      let interim = ""; Mic.finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) Mic.finalText += r[0].transcript; else interim += r[0].transcript;
      }
      Mic.heard = true;
      target.value = Mic.base + Mic.finalText + interim; fit();
      if (main) { el.listenTxt.textContent = Mic.finalText + interim; el.listenBar.classList.add("heard"); }
    };
    rec.onerror = (e) => {
      if (Mic.rec !== rec) return;
      Mic.set("error");
      const err = (e && e.error) || "unknown";
      if (err === "not-allowed" || err === "service-not-allowed") toast("Mic ki permission do (browser ke address bar me mic icon dabao).");
      else if (err === "network") toast("Mic ke liye internet chahiye.");
      else if (err === "no-speech") toast("Kuch sunai nahi diya, phir se bolo.");
      else if (err !== "aborted") toast("Mic error: " + err);
      cleanupMic(rec);
      setTimeout(() => { if (Mic.state === "error") Mic.set("idle"); }, 1800);
    };
    rec.onend = () => {
      if (Mic.rec !== rec) return;
      Mic.set("processing", "Samajh raha hun…");
      cleanupMic(rec);
      // chhota delay taaki aakhri transcript pakka aa jaye, phir faisla
      setTimeout(() => {
        const txt = (Mic.finalText.trim() || target.value.trim());
        if (main && Mic.heard && txt && (settings.voiceAutoSend || settings.handsFree)) {
          Mic.set("idle");
          el.input.value = target.value; // transcript pakka input me
          send();
        } else if (main && Mic.heard && txt) {
          // auto-send band hai -> "transcribed" state: user edit karke khud bhejega
          Mic.set("transcribed");
          setTimeout(() => { if (Mic.state === "transcribed") Mic.set("idle"); }, 2600);
        } else {
          Mic.set("idle");
        }
      }, 250);
    };
    try {
      rec.start();
      Mic.set("listening");
    } catch {
      cleanupMic(rec);
      Mic.set("idle");
      toast("Mic shuru nahi hua, dobara dabao.");
    }
  }
  function cleanupMic(rec) {
    try {
      if (rec) { rec.onresult = rec.onerror = rec.onend = null; }
    } catch {}
    if (Mic.rec === rec) Mic.rec = null;
  }
  function stopMic(autoSend = true) {
    const r = Mic.rec;
    const wasMain = Mic.main, target = Mic.target;
    Mic.rec = null;
    try { if (r) r.stop(); } catch {}
    if (Mic.state === "listening" || Mic.state === "processing") Mic.set("idle");
    // user ne khud rok kar (dobara dabakar) band kiya + auto-send on -> transcript bhej do
    if (autoSend && wasMain && target && target.value.trim() && (settings.voiceAutoSend || settings.handsFree) && !streaming) {
      send();
    }
  }

  // Fallback: browser me SpeechRecognition nahi hai to audio record karke
  // server transcription par bhejo. Server par koi transcription provider
  // configure nahi hai to imaandaar "not configured" jawab aayega (koi nakli text nahi).
  let fbRec = null, fbStream = null, fbChunks = [];
  async function fallbackVoice(target, btn, main) {
    if (fbRec) { // dobara dabao = recording roko aur bhejo
      try { fbRec.stop(); } catch {}
      return;
    }
    if (!navigator.mediaDevices || !window.MediaRecorder) { toast("Is browser me mic support nahi hai. Chrome use karo."); return; }
    if (streaming && main) { toast("Pehle AI ka jawab aane do, phir bolo."); return; }
    try { fbStream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
    catch { toast("Mic ki permission do (browser ke address bar me mic icon dabao)."); return; }
    fbChunks = [];
    Mic.target = target; Mic.btn = btn; Mic.main = main;
    try { fbRec = new MediaRecorder(fbStream); }
    catch { toast("Recording shuru nahi hui."); fbStream.getTracks().forEach((t) => t.stop()); fbRec = null; return; }
    fbRec.ondataavailable = (e) => { if (e.data && e.data.size) fbChunks.push(e.data); };
    fbRec.onstop = async () => {
      const r = fbRec; fbRec = null;
      if (fbStream) { fbStream.getTracks().forEach((t) => t.stop()); fbStream = null; }
      Mic.set("processing", "Bhej raha hun…");
      try {
        const blob = new Blob(fbChunks, { type: (r && r.mimeType) || "audio/webm" });
        // (fix) server /api/transcribe JSON {audio(base64), mime, lang} leta hai; pehle FormData bheja ja raha tha
        // (server use padh hi nahi paata tha) aur mila hua text input me kabhi daala hi nahi jata tha.
        const hh = { "Content-Type": "application/json" };
        if (!serverCfg.serverKey && !serverCfg.ownerEnabled && settings.apiKey) hh["x-api-key"] = settings.apiKey;
        if (settings.accessCode) hh["x-access-code"] = settings.accessCode;
        const res = await fetch("/api/transcribe", {
          method: "POST", headers: hh,
          body: JSON.stringify({ audio: await toB64(blob), mime: String(blob.type || "audio/webm").split(";")[0], lang: settings.micLang || "hi-IN" }),
        });
        const j = await res.json().catch(() => ({}));
        if (res.ok && j.text) {
          target.value = (target.value.trim() ? target.value.trim() + " " : "") + j.text;
          if (main) autosize(); else { target.style.height = "auto"; target.style.height = Math.min(target.scrollHeight, 120) + "px"; }
          if (main && (settings.voiceAutoSend || settings.handsFree)) { Mic.set("idle"); send(); }
          else { Mic.set("transcribed"); setTimeout(() => { if (Mic.state === "transcribed") Mic.set("idle"); }, 2600); }
        } else {
          Mic.set("idle");
          toast(j.error || "Transcription nahi ho paayi.", 3200);
        }
      } catch {
        Mic.set("idle");
        toast("Transcription nahi ho paayi.", 2200);
      }
    };
    fbRec.start();
    Mic.set("listening", main ? "Boliye, record ho raha hai… (rokne ke liye dobara dabao)" : "Recording…");
    setTimeout(() => { if (fbRec) { try { fbRec.stop(); } catch {} } }, 30000); // 30s cap
  }

  let speaking = false, ttsAbort = null, audioEl = null, ttsWarned = false;
  const MALE_RE = /(hemant|madhur|prabhat|ravi|rishi|kabir|aarav|arjun|\bmale\b|\bman\b|-x-(hid|hie|ene|end|ens|enb)\b|google uk english male|david|mark|guy)/i;
  const FEMALE_RE = /(female|kalpana|swara|heera|neerja|priya|\bwoman\b|-x-(hia|hic|eng|enc|ena)\b)/i;
  function pickVoice(lang) {
    const vs = speechSynthesis.getVoices();
    const want = lang.slice(0, 2).toLowerCase();
    const same = vs.filter((v) => v.lang.replace("_", "-").toLowerCase().startsWith(want));
    const exact = same.filter((v) => v.lang.replace("_", "-") === lang);
    const pool = exact.length ? exact : same;
    const male = pool.find((v) => MALE_RE.test(v.name + " " + v.voiceURI)) || same.find((v) => MALE_RE.test(v.name + " " + v.voiceURI)) || vs.find((v) => /en/i.test(v.lang) && /google uk english male/i.test(v.name));
    if (settings.voice !== "Kore" && settings.voice !== "Zephyr") {
      if (male) return { v: male, deep: false };
      const nf = pool.find((v) => !FEMALE_RE.test(v.name + " " + v.voiceURI));
      return { v: nf || pool[0] || null, deep: true }; // mard awaaz na mile to pitch gehra
    }
    return { v: pool.find((v) => FEMALE_RE.test(v.name + " " + v.voiceURI)) || pool[0] || null, deep: false };
  }
  function chunkText(t, max = 170) {
    const parts = t.match(/[^.!?।\n]+[.!?।]?/g) || [t];
    const out = []; let cur = "";
    for (const p of parts) {
      if ((cur + p).length > max) { if (cur) out.push(cur); cur = p; } else cur += p;
    }
    if (cur.trim()) out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
  }
  function stopSpeak() {
    speaking = false;
    if (ttsAbort) { try { ttsAbort.abort(); } catch {} ttsAbort = null; }
    if (audioEl) { try { audioEl.pause(); audioEl.removeAttribute("src"); audioEl.load(); } catch {} audioEl = null; }
    try { speechSynthesis.cancel(); } catch {}
    $$(".speak.on").forEach((b) => { b.classList.remove("on"); b.textContent = "🔊"; });
  }
  function speakBrowser(plain, lang, onDone) {
    if (!("speechSynthesis" in window)) { toast("Is browser me bolne ka support nahi."); return onDone(); }
    const chunks = chunkText(plain); let i = 0;
    const next = () => {
      if (!speaking) return;
      if (i >= chunks.length) return onDone();
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = lang; u.rate = Number(settings.rate) || 1;
      const p = pickVoice(lang); if (p.v) u.voice = p.v; if (p.deep) u.pitch = 0.78;
      u.onend = next; u.onerror = () => { if (speaking) next(); };
      speechSynthesis.speak(u);
    };
    setTimeout(next, 80);
  }
  function speak(text, btn) {
    stopSpeak();
    const plain = mdToPlain(stripMemory(text));
    if (!plain) return;
    const lang = settings.ttsLang === "auto" ? (/[ऀ-ॿ]/.test(plain) ? "hi-IN" : "en-IN") : settings.ttsLang;
    speaking = true;
    if (btn) { btn.classList.add("on"); btn.textContent = "⏹️"; }
    const finish = () => {
      const was = speaking; speaking = false;
      if (btn) { btn.classList.remove("on"); btn.textContent = "🔊"; }
      if (was && settings.handsFree) setTimeout(startMic, 350);
    };
    // Veda v1: server TTS nahi — hamesha phone ki awaaz (free, offline-safe).
    speakBrowser(plain, lang, finish);
  }
  function toggleSpeak(m, btn) {
    if (speaking && btn.classList.contains("on")) { stopSpeak(); return; }
    speak(m.text, btn);
  }

  /* =====================  LIVE NEWS (Google News RSS, keyless)  ===================== */
  async function newsFlow(feed) {
    if (streaming) { toast("Pehle chalta jawab rok do."); return; }
    const needKey = settings.provider === "llama" ? !settings.llamaKey : !settings.apiKey;
    if (needKey) { openSettings(); toast("Pehle Settings me API key daalo."); return; }
    const menu = $("#newsMenu"); if (menu) menu.hidden = true;
    toast("📰 Taaza khabar la raha hun…");
    let j;
    try {
      const r = await fetch("/api/news?feed=" + feed, { headers: headers() });
      j = await r.json();
      if (!r.ok) throw new Error(j.error || "News nahi mili.");
    } catch (e) { toast("⚠️ " + e.message); return; }
    const lines = j.headlines.map((h, i) => (i + 1) + ". " + h.title + (h.source ? " (" + h.source + ")" : ""));
    send("Neeche Google News RSS ki taaza headlines hain (li gayin: " + j.fetchedAtIST + " IST, feed: " + (feed === "world" ? "World" : "India") + "). " +
      "Inhe Hindi me saransh me samjhao — sabse zaroori khabar pehle, har khabar 1-2 line me. " +
      "Ant me ye line zaroor likho: «Ye Google News RSS headlines ka saransh hai.»\n\n" + lines.join("\n"));
  }

  /* =====================  FILES  ===================== */
  function classify(mime, name) {
    const n = name.toLowerCase();
    if (mime === "application/pdf" || n.endsWith(".pdf")) return "pdf";
    if (mime.startsWith("image/") && !mime.includes("svg")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
    if (mime === "application/zip" || mime === "application/x-zip-compressed" || n.endsWith(".zip")) return "zip";
    if (mime.startsWith("text/") || mime.includes("json") || mime.includes("xml") || mime.includes("svg") ||
      /\.(txt|md|csv|json|xml|html|js|ts|py|java|c|cpp|css|yaml|yml|log|sql|sh|svg)$/.test(n)) return "text";
    return null;
  }
  const toB64 = (blob) => new Promise((res, rej) => {
    const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = rej; r.readAsDataURL(blob);
  });
  async function downscale(file) {
    try {
      const bmp = await createImageBitmap(file);
      const max = 1600, sc = Math.min(1, max / Math.max(bmp.width, bmp.height));
      if (sc === 1 && file.size < 1.5e6) return { data: await toB64(file), mime: file.type };
      const cv = document.createElement("canvas");
      cv.width = Math.round(bmp.width * sc); cv.height = Math.round(bmp.height * sc);
      cv.getContext("2d").drawImage(bmp, 0, 0, cv.width, cv.height);
      return { data: cv.toDataURL("image/jpeg", 0.85).split(",")[1], mime: "image/jpeg" };
    } catch { return { data: await toB64(file), mime: file.type || "image/jpeg" }; }
  }
  async function addFile(f) {
    const mime = f.type || "";
    const kind = classify(mime, f.name);
    if (!kind) { toast("Ye file type nahi padh sakta. Word/Excel ko PDF ya CSV bana ke daalo."); return; }
    if (f.size > 18 * 1024 * 1024) { toast("File 18MB se badi hai."); return; }
    const rec = { id: uid(), name: f.name, mime: mime || "application/octet-stream", kind, size: f.size, ts: Date.now() };
    if (kind === "text") rec.text = await f.text();
    else if (kind === "image") { const r = await downscale(f); rec.data = r.data; rec.mime = r.mime; }
    else { rec.data = await toB64(f); if (kind === "pdf") rec.mime = "application/pdf"; }
    pending.push(rec); renderPending();
  }
  const QUICK = [
    ["✨ Saaransh", "Is file ka saaransh (summary) do: pehle 3-4 line me mukhya baat, phir zaroori points bullets me."],
    ["📝 Notes", "Is file se saaf, padhne layak notes banao: headings, bullets, important terms, aur end me 5 quick revision sawal."],
    ["❓ 20 Sawal-Jawab", "Is file ko shuru se aakhir tak padhkar usme se bilkul 20 important sawal-jawab banao (exam style), alag-alag hisson se."],
    ["📖 Line-by-line Hindi", "Is poori file ko Hindi me line by line samjhao, shuru se aakhir tak, koi hissa chhode bina."],
    ["📄 PDF notes", "Is file ke professional, saaf PDF notes banao (headings, tables, important terms, end me revision sawal)."],
    ["🌐 Anuvaad", "Is file ka text Hindi me anuvaad karo (agar pehle se Hindi hai to English me)."],
  ];
  function renderPending() {
    el.pending.innerHTML = ""; el.quick.innerHTML = "";
    el.pending.hidden = el.quick.hidden = !pending.length;
    pending.forEach((f, i) => {
      const s = document.createElement("span"); s.className = "file-chip";
      s.innerHTML = (ICON[f.kind] || "📎") + " <span></span><button class='x' title='Hatao'>✕</button>";
      $("span", s).textContent = f.name;
      $(".x", s).onclick = () => { pending.splice(i, 1); renderPending(); };
      el.pending.appendChild(s);
    });
    if (pending.some((f) => f.kind === "zip")) {
      const zb = document.createElement("button"); zb.textContent = "🤖 ZIP Debug karo";
      zb.onclick = () => openZipModal(pending.find((f) => f.kind === "zip"));
      el.quick.appendChild(zb);
    }
    if (pending.length) QUICK.forEach(([l, p]) => {
      const b = document.createElement("button"); b.textContent = l; b.onclick = () => send(p); el.quick.appendChild(b);
    });
  }

  /* =====================  ZIP DEBUGGER  ===================== */
  let zipRec = null, zipAnalysis = null;
  const zkb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  async function openZipModal(prefill) {
    $$(".modal").forEach((m) => (m.hidden = true));
    $("#zipModal").hidden = false;
    $("#zipOut").innerHTML = '<div class="small-note">ZIP chuno — poora tree aur text files nikal kar AI jaanch karega.</div>';
    zipRec = null; zipAnalysis = null;
    if (prefill) await zipAnalyzeFile(prefill);
  }
  async function zipAnalyzeFile(file) {
    $("#zipOut").innerHTML = '<div class="small-note">⏳ ZIP padh raha hun…</div>';
    try {
      const r = await fetch("/api/zip/analyze", { method: "POST", headers: headers(), body: JSON.stringify({ zip: file.data }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Analyze nahi hua.");
      zipAnalysis = j; zipRec = file;
      const rows = j.tree.slice(0, 120).map((t) => '<div class="zip-row">' + (t.dir ? "📁" : "📄") + " <span></span><small>" + (t.dir ? "" : zkb(t.size)) + "</small></div>").join("");
      $("#zipOut").innerHTML = '<div class="small-note">📦 <b></b> · ' + j.totalEntries + " entries · " + Object.keys(j.files).length + " text files</div>" +
        '<div class="zip-tree">' + rows + (j.tree.length > 120 ? '<div class="small-note">…aur ' + (j.tree.length - 120) + " entries</div>" : "") + "</div>" +
        '<button class="btn primary wide" id="zipAi" style="text-align:center">🤖 AI se bug dhoondhwao</button>';
      $("#zipOut b").textContent = file.name;
      [...$("#zipOut").querySelectorAll(".zip-row span")].forEach((sp, i) => { sp.textContent = j.tree[i].path; });
      $("#zipAi").onclick = zipSendToAi;
    } catch (e) { $("#zipOut").innerHTML = '<div class="err">⚠️ ' + esc(e.message) + "</div>"; }
  }
  function zipSendToAi() {
    if (!zipAnalysis) return;
    const j = zipAnalysis;
    const tree = j.tree.slice(0, 200).map((t) => (t.dir ? "DIR " : "    ") + t.path + (t.dir ? "" : " (" + t.size + "b)")).join("\n");
    const files = Object.entries(j.files).slice(0, 10).map(([p, t]) => "===== FILE: " + p + " =====\n" + String(t).slice(0, 15000)).join("\n\n");
    const pkg = j.packageJson ? "\npackage.json: " + JSON.stringify(j.packageJson) + "\n" : "";
    $("#zipModal").hidden = true;
    send("🤖 ZIP DEBUGGER: \"" + zipRec.name + "\" ko poori tarah check karo aur bug dhoondho.\n\nFILE TREE:\n" + tree + "\n" + pkg + "\n" + files +
      "\n\nKAAM (Hindi me): 1) Har bug ke liye: file ka naam, line/samasya, ROOT CAUSE samjhao. 2) Kul kitne bugs, severity ke saath. " +
      "3) Ant me FIX: sirf badli hui files ko POORI-POORI is format me likho:\n```zipfix\nPATH: <zip ke andar ka path, jaise server.js>\n<poori sudhari hui file>\n```\n" +
      "Ek file = ek zipfix block. Koi adhuri file mat dena. Fix taiyar ho to usi jawab me '🔧 Fix karke ZIP download karo' button dikhega.");
  }
  function parseZipFix(text) {
    const out = {};
    const re = /```zipfix\s*\nPATH:\s*([^\n]+)\n([\s\S]*?)```/g;
    let m;
    while ((m = re.exec(text))) {
      const p = m[1].trim().replace(/\\/g, "/").replace(/^\/+/, "");
      if (p && !p.includes("..")) out[p] = m[2].replace(/\n$/, "");
    }
    return out;
  }
  async function zipBuildFix(aiText) {
    const files = parseZipFix(aiText);
    const n = Object.keys(files).length;
    if (!n) { toast("AI ne fix sahi format me nahi diya. 'zipfix format me do' bolo."); return; }
    if (!zipRec) { toast("Original ZIP nahi mili. Dobara analyze karwao."); return; }
    toast("🔧 " + n + " file fix karke nayi ZIP bana raha hun…");
    try {
      const r = await fetch("/api/zip/rebuild", { method: "POST", headers: headers(), body: JSON.stringify({ zip: zipRec.data, files }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Rebuild nahi hua.");
      const bytes = Uint8Array.from(atob(j.zip), (c) => c.charCodeAt(0));
      download(zipRec.name.replace(/\.zip$/i, "") + "-fixed.zip", bytes, "application/zip");
      toast("✅ Fixed ZIP download ho gayi (" + n + " files).");
    } catch (e) { toast("⚠️ " + e.message); }
  }

  /* =====================  DOCUMENT / PDF  ===================== */
  const DOC_CSS =
    "@page{size:A4;margin:16mm}*{box-sizing:border-box}body{font-family:'Noto Sans Devanagari','Mukta',system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1b1f2a;line-height:1.65;font-size:12.5pt;margin:0;padding:8px}" +
    "h1{font-size:24pt;margin:0 0 6pt;color:#3b2fd0}h2{font-size:16pt;margin:18pt 0 6pt;color:#3b2fd0;border-bottom:2px solid #e4e6f5;padding-bottom:3pt}h3{font-size:13pt;margin:12pt 0 4pt}" +
    "p{margin:6pt 0}ul,ol{padding-left:18pt}li{margin:3pt 0}a{color:#3b2fd0}blockquote{border-left:4px solid #7c6cff;margin:8pt 0;padding:2pt 12pt;color:#555;background:#f5f4ff}" +
    "code{background:#f0f1f8;padding:1px 5px;border-radius:4px;font-size:.9em}pre{background:#f0f1f8;padding:10pt;border-radius:8px;white-space:pre-wrap;word-break:break-word}pre code{background:none;padding:0}" +
    "table{border-collapse:collapse;width:100%;margin:8pt 0}th,td{border:1px solid #d6d9ea;padding:5pt 8pt;text-align:left}th{background:#eceafe}" +
    ".code-head{display:none}.code{margin:8pt 0}.foot{margin-top:24pt;font-size:9pt;color:#8a8fa5;border-top:1px solid #e4e6f5;padding-top:6pt}";
  function mdToDoc(text, title) {
    return "<!DOCTYPE html><html lang='hi'><head><meta charset='utf-8'><title>" + esc(title || "Document") + "</title><style>" + DOC_CSS + "</style></head><body>" +
      renderMarkdown(text) + "<div class='foot'>Veda AI · By Shailesh Arya Developer · " + new Date().toLocaleDateString("en-IN", { dateStyle: "long" }) + "</div></body></html>";
  }
  function docTitleFrom(html) {
    const m = html.match(/<title>([\s\S]*?)<\/title>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    return m ? m[1].replace(/<[^>]+>/g, "").trim().slice(0, 60) || "Document" : "Document";
  }
  let currentDoc = { html: "", title: "" };
  let currentDocTheme = "navy-gold";
  function openDoc(html, title, msg, meta) {
    meta = meta || {};
    currentDoc = {
      html, title: title || "Document", msg: msg || null, undo: [],
      src: meta.src || null, theme: meta.theme || settings.pdfTheme || "navy-gold", markup: !!meta.markup,
    };
    currentDocTheme = currentDoc.theme;
    $("#docUndo").hidden = true; $("#docStatus").hidden = true; $("#docInstr").value = "";
    $("#docTitle").textContent = currentDoc.title;
    $("#docFrame").srcdoc = html;
    pdfCache = { html: "", file: null };
    renderDocThemes();
    $("#docModal").hidden = false;
  }
  /* ---- splitDoc result ko doc modal me kholo (theme/src sahit) ---- */
  function openSdDoc(sd, msg) {
    openDoc(sd.html, sd.title || docTitleFrom(sd.html), msg, { src: sd.src, theme: sd.theme, markup: sd.markup });
  }
  function renderDocThemes() {
    const el = $("#docThemes");
    if (!el || !window.VPDF) return;
    el.innerHTML = "";
    Object.keys(VPDF.THEMES).forEach((k) => {
      const b = document.createElement("button");
      b.type = "button"; b.title = VPDF.THEMES[k].label;
      b.style.background = VPDF.THEMES[k].swatch;
      if ((settings.pdfTheme || "navy-gold") === k) b.className = "on";
      b.onclick = () => setPdfTheme(k);
      el.appendChild(b);
    });
  }
  function setPdfTheme(k) {
    if (!window.VPDF || !VPDF.THEMES[k]) return;
    settings.pdfTheme = k; store.set("settings", settings); renderDocThemes();
    if (currentDoc.markup && currentDoc.src) {
      try {
        const r = VPDF.toHtml(currentDoc.src, { forceTheme: k });
        currentDoc.html = r.html; currentDoc.theme = r.theme; currentDocTheme = r.theme;
        $("#docFrame").srcdoc = currentDoc.html;
        pdfCache = { html: "", file: null };
        toast("🎨 Design: " + VPDF.THEMES[k].label);
      } catch (e) { toast("Theme lagane me dikkat aayi"); }
    } else {
      toast("🎨 Agli PDF isi design me banegi: " + VPDF.THEMES[k].label);
    }
  }

  let docBusy = false;
  async function editDoc(instr) {
    if (docBusy) return;
    instr = (instr || "").trim();
    if (!instr) return toast("Pehle batao kya badalna hai.");
    if (settings.provider === "llama" ? !settings.llamaKey : !settings.apiKey) { toast("Pehle Settings me API key daalo."); return; } // (fix) Llama user ki key bhi maani jaye
    const st = $("#docStatus"), go = $("#docGo");
    const rules = memory.filter((x) => /^Dhyan rakho|^PDF sudhaar/i.test(x)).slice(-12);
    docBusy = true; go.disabled = true; st.hidden = false; st.textContent = "✍️ Badlav ho raha hai…";
    const t0 = Date.now();
    const tm = setInterval(() => { st.textContent = "✍️ Badlav ho raha hai… " + Math.floor((Date.now() - t0) / 1000) + "s · " + got.length + " akshar likhe"; }, 400);
    let got = "";
    try {
      const isMk = !!(currentDoc.markup && currentDoc.src);
      const fmtName = isMk ? "VPDF markup" : "HTML";
      const fmtBlock = isMk ? "vpdf" : "html";
      const sys = "Tum ek document editor ho. User ka diya document (" + fmtName + " me hai) uske badlav ke hisaab se edit karo. Sirf wahi badlo jo user ne bola, baaki design, content aur structure bilkul same rakho. " +
        "Poora updated document ek hi ```" + fmtBlock + " code block me do" + (isMk ? " (VPDF markup format me hi, theme: line sahit; HTML mat likho)" : " (<!DOCTYPE html> se shuru, saara CSS <style> ke andar)") + ". Code block ke bahar kuch mat likho. " +
        "Content adhura ya chhota mat karo, pura document wapas do." + (rules.length ? " User ke purane sudhaar (dobara mat bigaadna): " + rules.join("; ") : "");
      const res = await fetch("/api/chat", {
        method: "POST", headers: headers(),
        body: JSON.stringify({
          model: settings.model, provider: settings.provider, system: sys, temperature: 0.3, search: false,
          contents: [{ role: "user", parts: [{ text: "Mera document (" + fmtName + "):\n```" + fmtBlock + "\n" + (isMk ? currentDoc.src : currentDoc.html) + "\n```\n\nBadlav: " + instr }] }],
        }),
      });
      if (!res.ok) { let e = ""; try { e = (await res.json()).error; } catch {} throw new Error(e || "Error " + res.status); }
      await readStream(res, (d) => { got += d; }, () => {});
      const m = got.match(/```(html|vpdf)[ \t]*\n([\s\S]*?)```/i);
      if (!m) throw new Error("Poora document nahi aaya. Purana document surakshit hai, dobara koshish karo.");
      let newHtml, newSrc = null, newTheme = currentDoc.theme;
      if (m[1].toLowerCase() === "vpdf") {
        newSrc = m[2].trim();
        if (!window.VPDF) throw new Error("Design engine load nahi hua.");
        const vd = VPDF.toHtml(newSrc, { forceTheme: currentDoc.theme });
        newHtml = vd.html; newTheme = vd.theme;
      } else {
        if (!/<\/html>|<\/body>/i.test(m[2])) throw new Error("Poora document nahi aaya. Purana document surakshit hai, dobara koshish karo.");
        newHtml = m[2].trim();
      }
      if (newHtml.length < currentDoc.html.length * 0.4 && !/(chhota|short|kam|hata|delete|remove|ek page|1 page)/i.test(instr)) throw new Error("Document bahut chhota ho gaya, isliye badlav nahi lagaya. Purana surakshit hai. Dobara batao.");
      currentDoc.undo.push({ html: currentDoc.html, src: currentDoc.src, theme: currentDoc.theme, markup: currentDoc.markup });
      currentDoc.html = newHtml; currentDoc.src = newSrc; currentDoc.theme = newTheme; currentDoc.markup = !!newSrc; currentDocTheme = newTheme;
      $("#docFrame").srcdoc = currentDoc.html;
      $("#docUndo").hidden = false; $("#docInstr").value = "";
      if (currentDoc.msg) {
        currentDoc.msg.text = "```" + (newSrc ? "vpdf" : "html") + "\n" + (newSrc || currentDoc.html) + "\n```"; currentDoc.msg.docMode = true;
        saveChatsNow(); const c = currentChat(); if (c) renderMessages();
      }
      if (instr.length < 200) addMemory(["PDF sudhaar (hamesha dhyan rakho): " + instr]);
      st.textContent = "✅ Badlav ho gaya (" + Math.floor((Date.now() - t0) / 1000) + "s). Aur badlav likho ya PDF save karo.";
    } catch (e) {
      st.textContent = "⚠️ " + (e.message || "Kuch gadbad hui");
    } finally { clearInterval(tm); docBusy = false; go.disabled = false; }
  }
  function undoDoc() {
    if (!currentDoc.undo || !currentDoc.undo.length) return;
    const s = currentDoc.undo.pop();
    if (typeof s === "string") { currentDoc.html = s; }
    else {
      currentDoc.html = s.html; currentDoc.src = s.src || null;
      currentDoc.theme = s.theme || currentDoc.theme; currentDoc.markup = !!s.markup;
      currentDocTheme = currentDoc.theme;
    }
    $("#docFrame").srcdoc = currentDoc.html;
    renderDocThemes();
    if (currentDoc.msg) {
      const usrc = (currentDoc.markup && currentDoc.src) ? currentDoc.src : currentDoc.html;
      currentDoc.msg.text = "```" + ((currentDoc.markup && currentDoc.src) ? "vpdf" : "html") + "\n" + usrc + "\n```";
      saveChatsNow(); renderMessages();
    }
    $("#docUndo").hidden = !currentDoc.undo.length;
    toast("Pichhla badlav wapas aa gaya");
  }
  /* ---- asli PDF file (bahari library ke bina): HTML -> A4 pages -> PDF ---- */
  const A4W = 794, PT = 595.28 / 794, MARG = 36, PAGE_PX = Math.floor((841.89 - 2 * MARG) / PT);
  async function pdfLib() {
    if (window.PDFLib) return window.PDFLib;
    await new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "pdf-lib.min.js"; sc.onload = res; sc.onerror = () => rej(new Error("PDF engine load nahi hua")); document.head.appendChild(sc); });
    return window.PDFLib;
  }
  /* ---- Hindi font (Noto Sans Devanagari) PDF render ke liye, lazy base64 embed ---- */
  let notoB64 = null;
  async function notoFontCss() {
    if (notoB64 === "na") return "";
    if (!notoB64) {
      try {
        const buf = await (await fetch("fonts/noto-dev-2.woff2")).arrayBuffer();
        const bytes = new Uint8Array(buf);
        let s = ""; const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        notoB64 = btoa(s);
      } catch { notoB64 = "na"; return ""; }
    }
    return "@font-face{font-family:'Noto Sans Devanagari';font-weight:400;src:url(data:font/woff2;base64," + notoB64 + ") format('woff2');font-display:swap;}";
  }
  /* ---- PDF bookmarks (outlines): pdf-lib low-level, fail-safe ---- */
  function addOutlines(L, doc, entries) {
    try {
      if (!entries.length) return;
      const { PDFDict, PDFName, PDFArray, PDFNumber, PDFHexString } = L;
      void PDFDict; void PDFArray;
      const outlines = doc.context.obj({ Type: PDFName.of("Outlines") });
      const outlinesRef = doc.context.register(outlines);
      let prevRef = null, firstRef = null;
      entries.forEach((en) => {
        const page = doc.getPage(en.page);
        const dest = doc.context.obj([page.ref, PDFName.of("Fit")]);
        const item = doc.context.obj({ Title: PDFHexString.fromText(String(en.title).slice(0, 120)), Parent: outlinesRef, Dest: dest });
        const ref = doc.context.register(item);
        if (prevRef) {
          doc.context.lookup(prevRef).set(PDFName.of("Next"), ref);
          item.set(PDFName.of("Prev"), prevRef);
        } else firstRef = ref;
        prevRef = ref;
      });
      outlines.set(PDFName.of("First"), firstRef);
      outlines.set(PDFName.of("Last"), prevRef);
      outlines.set(PDFName.of("Count"), PDFNumber.of(entries.length));
      doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
      doc.catalog.set(PDFName.of("PageMode"), PDFName.of("UseOutlines"));
    } catch (e) { /* bookmark fail -> PDF to banti hi hai */ }
  }
  async function docToPdfBytes(html, title, onProgress) {
    const L = await pdfLib();
    const fr = document.createElement("iframe");
    fr.style.cssText = "position:fixed;left:-12000px;top:0;width:" + A4W + "px;height:1200px;border:0;visibility:hidden";
    fr.setAttribute("sandbox", "allow-same-origin");
    const hasHindi = /[\u0900-\u097F]/.test(html);
    const fontCss = hasHindi ? await notoFontCss() : "";
    const extra = "<style>" + fontCss + "html{background:#fff}body{box-sizing:border-box;width:" + A4W + "px!important;max-width:none!important;margin:0!important;padding:8px 52px!important}" +
      (fontCss ? "body{font-family:'Noto Sans Devanagari','Mukta',system-ui,sans-serif!important}" : "") +
      ".pdf-toc{page-break-after:always;margin-bottom:24px}.pdf-toc h2{border:none!important;margin-top:0!important}.pdf-toc a{color:#1b1f2a;text-decoration:none}.pdf-toc .toc-row{display:flex;justify-content:space-between;padding:5px 2px;border-bottom:1px dotted #c9cede;font-size:11pt}.pdf-toc .toc-l2{padding-left:22px}.pdf-toc .toc-l3{padding-left:44px;font-size:10pt;color:#444}</style>";
    fr.srcdoc = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, extra + "</head>") : extra + html;
    document.body.appendChild(fr);
    try {
      await new Promise((res) => { fr.onload = res; setTimeout(res, 4000); });
      const d = fr.contentDocument; try { await d.fonts.ready; } catch {}
      await new Promise((r) => setTimeout(r, 150));
      // ---- auto TOC: headings dhoondho, shuru me contents page lagao ----
      const heads = [];
      d.body.querySelectorAll("h1,h2,h3").forEach((h) => {
        if (h.closest(".pdf-toc")) return;
        const t = h.textContent.trim().slice(0, 90);
        if (t) heads.push({ el: h, level: +h.tagName[1], title: t });
      });
      let tocEl = null;
      if (heads.length >= 2) {
        tocEl = d.createElement("div");
        tocEl.className = "pdf-toc";
        tocEl.innerHTML = "<h2>विषय-सूची · Contents</h2>" + heads.map((h, i) =>
          '<div class="toc-row toc-l' + h.level + '"><span>' + h.title.replace(/&/g, "&amp;").replace(/</g, "&lt;") + '</span><span data-tocpg="' + i + '">…</span></div>').join("");
        d.body.insertBefore(tocEl, d.body.firstChild);
        await new Promise((r) => setTimeout(r, 80));
      }
      const root = d.documentElement;
      const total = Math.max(root.scrollHeight, d.body.scrollHeight);
      // kahan se page kaatna surakshit hai (kisi line/box ke beech nahi)
      const base = d.documentElement.getBoundingClientRect().top;
      const blocks = [];
      d.body.querySelectorAll("p,li,tr,h1,h2,h3,h4,h5,h6,pre,blockquote,img,svg,figure,.card,.box,.section,.item,.entry,hr,div,td,th,section,article,header,footer").forEach((e) => {
        if (e.children.length && !/^(P|LI|TR|H\d|PRE|BLOCKQUOTE|FIGURE|IMG|SVG)$/.test(e.tagName)) {
          const r0 = e.getBoundingClientRect(); if (r0.height > PAGE_PX * 0.5) return;
        }
        const r = e.getBoundingClientRect(); const top = r.top - base, bot = r.bottom - base;
        if (bot - top > 2) blocks.push({ top, bot, head: /^H\d$/.test(e.tagName) });
      });
      const cuts = [0]; let y = 0;
      const MINFILL = PAGE_PX * 0.35;
      while (total - y > PAGE_PX) {
        const lim = y + PAGE_PX;
        let cutAt = lim;
        const crossing = blocks.filter((b) => b.top < lim - 1 && b.bot > lim + 1 && b.bot - b.top <= PAGE_PX * 0.5 && b.top > y + MINFILL).sort((a, b2) => a.top - b2.top)[0];
        if (crossing) cutAt = crossing.top;
        else {
          let best = 0;
          for (const b of blocks) if (b.bot <= lim + 0.5 && b.bot > y + MINFILL) best = Math.max(best, b.bot);
          if (best) cutAt = best;
        }
        // heading page ke aakhir me akeli na rahe (widow/orphan control)
        const lastHead = blocks.filter((b) => b.head && b.bot <= cutAt + 1 && b.bot > cutAt - 90 && b.top > y + 40).sort((a, b2) => b2.top - a.top)[0];
        if (lastHead) cutAt = lastHead.top;
        if (cutAt <= y + 40) cutAt = lim;
        y = Math.floor(cutAt); cuts.push(y);
      }
      cuts.push(total);
      const n = cuts.length - 1;
      // TOC me page number bharo (layout par asar nahi, sirf ank)
      if (tocEl) {
        const nums = tocEl.querySelectorAll("[data-tocpg]");
        heads.forEach((h, i) => {
          const top = h.el.getBoundingClientRect().top - base;
          let pg = 1;
          for (let k = 0; k < cuts.length - 1; k++) if (top >= cuts[k] - 1) pg = k + 1;
          if (nums[i]) nums[i].textContent = pg;
          h.page = pg - 1; // pdf-lib page index
        });
      } else heads.forEach((h) => {
        const top = h.el.getBoundingClientRect().top - base;
        let pg = 1;
        for (let k = 0; k < cuts.length - 1; k++) if (top >= cuts[k] - 1) pg = k + 1;
        h.page = pg - 1;
      });
      const doc = await L.PDFDocument.create();
      try { doc.setTitle(title || "Document"); doc.setCreator("Veda AI"); doc.setProducer("Veda AI"); doc.setAuthor("By Shailesh Arya Developer"); } catch {}
      const font = await doc.embedFont(L.StandardFonts.Helvetica);
      const fontB = await doc.embedFont(L.StandardFonts.HelveticaBold);
      const xml = new XMLSerializer().serializeToString(root);
      const SC = n > 40 ? 1.25 : 1.6;
      const latinTitle = /^[\x00-\x7F]*$/.test(title || "");
      for (let i = 0; i < n; i++) {
        onProgress && onProgress(i + 1, n);
        const h = Math.max(1, cuts[i + 1] - cuts[i]);
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + A4W + '" height="' + h + '"><foreignObject x="0" y="' + (-cuts[i]) + '" width="' + A4W + '" height="' + total + '">' + xml + "</foreignObject></svg>";
        const img = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Page " + (i + 1) + " banane me dikkat")); im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
        const cv = document.createElement("canvas"); cv.width = Math.round(A4W * SC); cv.height = Math.round(h * SC);
        const cx = cv.getContext("2d"); cx.fillStyle = "#fff"; cx.fillRect(0, 0, cv.width, cv.height); cx.drawImage(img, 0, 0, cv.width, cv.height);
        const jpg = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.88));
        const emb = await doc.embedJpg(await jpg.arrayBuffer());
        const pg = doc.addPage([595.28, 841.89]);
        pg.drawImage(emb, { x: 0, y: 841.89 - MARG - h * PT, width: A4W * PT, height: h * PT });
        // header (sirf Latin title; Devanagari Helvetica me box banega isliye skip)
        if (latinTitle && (title || "").trim()) {
          const ht = (title || "").slice(0, 70);
          pg.drawText(ht, { x: MARG, y: 841.89 - 24, size: 8.5, font: fontB, color: L.rgb(0.35, 0.37, 0.45) });
          pg.drawLine({ start: { x: MARG, y: 841.89 - 30 }, end: { x: 595.28 - MARG, y: 841.89 - 30 }, thickness: 0.6, color: L.rgb(0.85, 0.86, 0.92) });
        }
        // footer: theme accent line + brand (Latin-safe Helvetica)
        try {
          if (window.VPDF) {
            const th = VPDF.THEMES[currentDocTheme] || VPDF.THEMES[VPDF.DEFAULT_THEME];
            const fc = VPDF.hexRgb(th.footLine);
            pg.drawLine({ start: { x: MARG, y: 27 }, end: { x: 595.28 - MARG, y: 27 }, thickness: 1.1, color: L.rgb(fc[0], fc[1], fc[2]) });
          }
        } catch (e) {}
        pg.drawText("By Shailesh Arya", { x: MARG, y: 16, size: 8, font, color: L.rgb(0.45, 0.47, 0.55) });
        const t = (i + 1) + " / " + n; pg.drawText(t, { x: 595.28 / 2 - font.widthOfTextAtSize(t, 9) / 2, y: 16, size: 9, font, color: L.rgb(0.5, 0.52, 0.58) });
      }
      // bookmarks: TOC entries -> clickable outline
      addOutlines(L, doc, heads.filter((h) => h.level <= 2).map((h) => ({ title: h.title, page: Math.max(0, Math.min(n - 1, h.page || 0)) })));
      return await doc.save();
    } finally { fr.remove(); }
  }
    let pdfCache = { html: "", file: null };
  async function currentPdfFile() {
    if (pdfCache.html === currentDoc.html && pdfCache.file) return pdfCache.file;
    const st = $("#docStatus"); st.hidden = false;
    const bytes = await docToPdfBytes(currentDoc.html, currentDoc.title, (i, n) => { st.textContent = "📄 PDF ban rahi hai… page " + i + "/" + n; });
    const file = new File([bytes], safeName(currentDoc.title) + ".pdf", { type: "application/pdf" });
    pdfCache = { html: currentDoc.html, file };
    st.textContent = "✅ PDF taiyar (" + Math.max(1, Math.round(file.size / 1024)) + " KB)";
    return file;
  }
  async function sharePdf() {
    const b = $("#docShare"); if (b.disabled) return; b.disabled = true;
    try {
      const f = await currentPdfFile();
      if (navigator.canShare && navigator.canShare({ files: [f] })) {
        try { await navigator.share({ files: [f], title: currentDoc.title }); return; }
        catch (e) { if (e && e.name === "AbortError") return; }
      }
      download(f.name, f, "application/pdf"); toast("Is browser me share nahi hota, PDF download ho gayi. Files/Drive se kholo.", 4500);
    } catch (e) { $("#docStatus").hidden = false; $("#docStatus").textContent = "⚠️ " + (e.message || "PDF nahi bani") + " — 'Print / PDF' wala button try karo."; }
    finally { b.disabled = false; }
  }
  async function downloadPdf() {
    const b = $("#docDl"); if (b.disabled) return; b.disabled = true;
    try {
      const f = await currentPdfFile();
      openPdfViewer(f, currentDoc.title); // turant in-app preview (requirement)
      download(f.name, f, "application/pdf");
      toast("PDF download ho gayi + preview khul gaya");
    }
    catch (e) { $("#docStatus").hidden = false; $("#docStatus").textContent = "⚠️ " + (e.message || "PDF nahi bani") + " — 'Print / PDF' wala button try karo."; }
    finally { b.disabled = false; }
  }
  async function previewPdf() {
    const st = $("#docStatus");
    try { st.hidden = false; st.textContent = "📄 Preview taiyar ho raha hai…"; const f = await currentPdfFile(); openPdfViewer(f, currentDoc.title); }
    catch (e) { st.hidden = false; st.textContent = "⚠️ " + (e.message || "PDF nahi bani"); }
  }
  /* =====================  PDF VIEWER (pdf.js, in-app professional viewer)  ===================== */
  let pdfjsLibP = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (pdfjsLibP) return pdfjsLibP;
    pdfjsLibP = new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "pdf.min.js";
      s.onload = () => {
        try { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js"; res(window.pdfjsLib); }
        catch (e) { pdfjsLibP = null; rej(e); }
      };
      s.onerror = () => { pdfjsLibP = null; rej(new Error("PDF viewer load nahi hua. Internet check karo.")); };
      document.head.appendChild(s);
    });
    return pdfjsLibP;
  }
  const PV = { pdf: null, count: 0, mode: "width", zoom: 1, rotation: 0, file: null, title: "", io: null, searchQ: "" };
  const pvBody = () => $("#pvBody"), pvPages = () => $("#pvPages");
  function pvStatus(t, bad) {
    const s = $("#pvStatus"); s.hidden = !t;
    if (t) { s.textContent = t; s.classList.toggle("err", !!bad); }
  }
  async function openPdfViewer(file, title) {
    if (!file) return toast("PDF file nahi mili.");
    Object.assign(PV, { pdf: null, count: 0, mode: "width", zoom: 1, rotation: 0, file, title: title || file.name || "PDF", searchQ: "" });
    if (PV.io) { try { PV.io.disconnect(); } catch {} PV.io = null; }
    $("#pdfTitle").textContent = PV.title;
    pvPages().innerHTML = ""; $("#pvSearchRes").hidden = true; $("#pvSearch").value = "";
    $("#pdfModal").hidden = false;
    pvStatus("📄 PDF khul rahi hai…");
    try {
      const lib = await loadPdfJs();
      const buf = await file.arrayBuffer();
      PV.pdf = await lib.getDocument({ data: buf }).promise;
      PV.count = PV.pdf.numPages;
      $("#pvCount").textContent = PV.count; $("#pvNum").max = PV.count; $("#pvNum").value = 1;
      pvStatus("");
      pvBuildPages();
      pvApplyMode();
      toast("PDF khul gayi — zoom, search, fullscreen sab upar hai.", 2500);
    } catch (e) {
      pvStatus("⚠️ " + (e.message || "PDF nahi khul payi"), true);
    }
  }
  function pvBuildPages() {
    const wrap = pvPages(); wrap.innerHTML = "";
    for (let i = 1; i <= PV.count; i++) {
      const d = document.createElement("div");
      d.className = "pv-page"; d.dataset.p = i;
      d.innerHTML = '<div class="pv-pnum">' + i + '</div><canvas></canvas><div class="pv-loading">…</div>';
      wrap.appendChild(d);
    }
    // lazy render: jo page dikhe wahi bane (performance)
    if ("IntersectionObserver" in window) {
      PV.io = new IntersectionObserver((es) => {
        es.forEach((en) => { if (en.isIntersecting) { const p = +en.target.dataset.p; PV.io.unobserve(en.target); pvRenderPage(p); } });
      }, { root: pvBody(), rootMargin: "600px" });
      $$(".pv-page", wrap).forEach((d) => PV.io.observe(d));
    } else {
      for (let i = 1; i <= PV.count; i++) pvRenderPage(i);
    }
    pvBody().onscroll = () => {
      // current page indicator: sabse upar dikh raha page
      const pages = $$(".pv-page", wrap);
      let cur = 1;
      for (const p of pages) { if (p.offsetTop - pvBody().scrollTop < 120) cur = +p.dataset.p; else break; }
      if (document.activeElement !== $("#pvNum")) $("#pvNum").value = cur;
    };
  }
  function pvScaleFor(pageW, pageH) {
    const W = pvBody().clientWidth - 32, H = pvBody().clientHeight - 32;
    if (PV.mode === "width") return W / pageW;
    if (PV.mode === "page") return Math.min(W / pageW, H / pageH);
    return PV.zoom; // custom
  }
  async function pvRenderPage(n) {
    if (!PV.pdf) return;
    const holder = $('.pv-page[data-p="' + n + '"]', pvPages());
    if (!holder || holder.dataset.done === PV.rotation + ":" + PV.mode + ":" + PV.zoom) return;
    try {
      const page = await PV.pdf.getPage(n);
      const v1 = page.getViewport({ scale: 1, rotation: PV.rotation });
      const scale = pvScaleFor(v1.width, v1.height) * (window.devicePixelRatio > 1 ? 1.5 : 1);
      const vp = page.getViewport({ scale, rotation: PV.rotation });
      PV.lastScale = scale / (window.devicePixelRatio > 1 ? 1.5 : 1); // CSS scale (zoom base)
      const cv = $("canvas", holder);
      cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
      cv.style.width = Math.floor(vp.width / (window.devicePixelRatio > 1 ? 1.5 : 1)) + "px";
      cv.style.height = Math.floor(vp.height / (window.devicePixelRatio > 1 ? 1.5 : 1)) + "px";
      const ctx = cv.getContext("2d");
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      const ld = $(".pv-loading", holder); if (ld) ld.remove();
      holder.dataset.done = PV.rotation + ":" + PV.mode + ":" + PV.zoom;
      if (page.cleanup) page.cleanup();
    } catch (e) {
      const ld = $(".pv-loading", holder); if (ld) ld.textContent = "⚠️ page nahi bana";
    }
  }
  function pvRerender() {
    $$(".pv-page", pvPages()).forEach((d) => { delete d.dataset.done; });
    if (PV.io) { try { PV.io.disconnect(); } catch {} PV.io = null; }
    pvBuildPagesKeep();
  }
  function pvBuildPagesKeep() {
    // scroll position bachate hue dobara render
    const st = pvBody().scrollTop;
    if ("IntersectionObserver" in window) {
      PV.io = new IntersectionObserver((es) => {
        es.forEach((en) => { if (en.isIntersecting) { PV.io.unobserve(en.target); pvRenderPage(+en.target.dataset.p); } });
      }, { root: pvBody(), rootMargin: "600px" });
      $$(".pv-page", pvPages()).forEach((d) => { const ld = $(".pv-loading", d); if (!ld) { const s = document.createElement("div"); s.className = "pv-loading"; s.textContent = "…"; d.appendChild(s); } PV.io.observe(d); });
    } else for (let i = 1; i <= PV.count; i++) pvRenderPage(i);
    pvBody().scrollTop = st;
  }
  function pvApplyMode() {
    $("#pvZoom").textContent = PV.mode === "width" ? "↔ Width" : PV.mode === "page" ? "⤢ Page" : Math.round(PV.zoom * 100) + "%";
    pvRerender();
  }
  function pvGoto(n) {
    n = Math.max(1, Math.min(PV.count, n | 0 || 1));
    const d = $('.pv-page[data-p="' + n + '"]', pvPages());
    if (d) { pvRenderPage(n); d.scrollIntoView({ block: "start" }); }
    $("#pvNum").value = n;
  }
  async function pvSearch() {
    const q = $("#pvSearch").value.trim().toLowerCase();
    const box = $("#pvSearchRes");
    if (!q || !PV.pdf) { box.hidden = true; return; }
    box.hidden = false; box.innerHTML = "🔎 Khoj raha hun…";
    const hits = [];
    try {
      for (let i = 1; i <= PV.count; i++) {
        const page = await PV.pdf.getPage(i);
        const tc = await page.getTextContent();
        const txt = tc.items.map((it) => it.str).join(" ").toLowerCase();
        let c = 0, p = txt.indexOf(q);
        while (p >= 0) { c++; p = txt.indexOf(q, p + q.length); }
        if (c) hits.push({ p: i, c });
        if (page.cleanup) page.cleanup();
      }
    } catch (e) { box.innerHTML = "⚠️ Search nahi ho paya."; return; }
    if (!hits.length) { box.innerHTML = "❌ &quot;" + esc($("#pvSearch").value.trim().slice(0, 60)) + "&quot; nahi mila."; return; }
    box.innerHTML = "✅ " + hits.reduce((a, h) => a + h.c, 0) + " baar, " + hits.length + " pages me: " +
      hits.slice(0, 20).map((h) => '<button class="pv-hit" data-p="' + h.p + '">p.' + h.p + " (" + h.c + ")</button>").join("") +
      (hits.length > 20 ? " …" : "");
    $$(".pv-hit", box).forEach((b) => (b.onclick = () => pvGoto(+b.dataset.p)));
  }
  function pvPrint() {
    if (!PV.file) return;
    const url = URL.createObjectURL(PV.file);
    const w = window.open(url, "_blank");
    if (!w) { toast("Popup block hua — popup allow karo, phir print dabao."); }
    else toast("Naye tab me PDF khuli — wahan Ctrl+P / Print dabao.", 4000);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  function bindViewer() {
    $("#pvPrev").onclick = () => pvGoto(($("#pvNum").value | 0) - 1);
    $("#pvNext").onclick = () => pvGoto(($("#pvNum").value | 0) + 1);
    $("#pvNum").onchange = (e) => pvGoto(+e.target.value);
    $("#pvZoomIn").onclick = () => { const b = PV.mode === "custom" ? PV.zoom : (PV.lastScale || 1); PV.mode = "custom"; PV.zoom = Math.min(4, b * 1.25); pvApplyMode(); };
    $("#pvZoomOut").onclick = () => { const b = PV.mode === "custom" ? PV.zoom : (PV.lastScale || 1); PV.mode = "custom"; PV.zoom = Math.max(0.2, b / 1.25); pvApplyMode(); };
    $("#pvFitPage").onclick = () => { PV.mode = "page"; pvApplyMode(); };
    $("#pvFitW").onclick = () => { PV.mode = "width"; pvApplyMode(); };
    $("#pvRot").onclick = () => { PV.rotation = (PV.rotation + 90) % 360; pvApplyMode(); };
    $("#pvSearchGo").onclick = pvSearch;
    $("#pvSearch").addEventListener("keydown", (e) => { if (e.key === "Enter") pvSearch(); });
    $("#pvDl").onclick = () => { if (PV.file) download(PV.file.name || "document.pdf", PV.file, "application/pdf"); };
    $("#pvPrint").onclick = pvPrint;
    $("#pdfFs").onclick = () => {
      const sh = $("#pdfModal .sheet");
      if (document.fullscreenElement) document.exitFullscreen();
      else if (sh.requestFullscreen) sh.requestFullscreen().then(() => setTimeout(pvApplyMode, 300)).catch(() => toast("Fullscreen nahi khul paya."));
    };
    document.addEventListener("fullscreenchange", () => { if (!$("#pdfModal").hidden) setTimeout(pvApplyMode, 300); });
  }
  const safeName = (s) => (s || "document").replace(/[^\wऀ-ॿ -]+/g, "").trim().replace(/\s+/g, "_").slice(0, 50) || "document";
  function printDoc() {
    const script = "<script>addEventListener('load',function(){setTimeout(function(){print()},600)})<\/script>";
    const h = /<\/body>/i.test(currentDoc.html) ? currentDoc.html.replace(/<\/body>/i, script + "</body>") : currentDoc.html + script;
    const url = URL.createObjectURL(new Blob([h], { type: "text/html;charset=utf-8" }));
    const w = window.open(url, "_blank");
    if (!w) { toast("Popup block hua. Browser me popup allow karo, ya HTML download karo."); return; }
    toast("Khulne par 'Save as PDF' chuno.", 4500);
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }

  /* =====================  HTML RUNNER (sandboxed live preview)  =====================
     Security: iframe me SIRF sandbox="allow-scripts" (allow-same-origin NAHI).
     Isse preview ka origin opaque hota hai: parent DOM, localStorage, cookies tak
     koi pahunch nahi. Console sirf postMessage se aata hai, source verify hota hai. */
  const rnFrame = () => $("#rnFrame");
  const CONSOLE_BRIDGE = '<script>(function(){try{var q=[];var send=function(t,a){try{parent.postMessage({__rn:1,type:t,args:[].slice.call(a).map(function(x){try{return typeof x==="object"?JSON.stringify(x):String(x)}catch(e){return String(x)}})},"*")}catch(e){}};["log","info","warn","error","debug"].forEach(function(k){var o=console[k];console[k]=function(){send(k==="info"?"log":k,arguments);try{return o.apply(console,arguments)}catch(e){}}});addEventListener("error",function(e){send("error",[String(e.message||e.error||"Error")+" (line "+(e.lineno||"?")+")"])});addEventListener("unhandledrejection",function(e){var r=e.reason;send("error",["Unhandled: "+(r&&r.message||r)])});send("log",["▶ Preview chal raha hai"]);}catch(e){}})();<\/script>';
  let runHtml = "", runTitle = "";
  function bridgeInject(html) {
    if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, CONSOLE_BRIDGE + "</body>");
    if (/<\/html>/i.test(html)) return html.replace(/<\/html>/i, CONSOLE_BRIDGE + "</html>");
    return html + CONSOLE_BRIDGE;
  }
  function wrapSnippet(code) {
    const t = code.trim();
    if (/^\s*<(!doctype|html)/i.test(t)) return t; // poora document
    // tukda (snippet): body me lapeto taaki turant render ho
    return '<!DOCTYPE html><html lang="hi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Preview</title></head><body>' + t + "</body></html>";
  }
  function openRunner(code, title) {
    runHtml = wrapSnippet(code); runTitle = title || "HTML Preview";
    $("#runTitle").textContent = "▶ " + runTitle;
    $("#rnCode").textContent = code.trim().slice(0, 60000);
    $("#rnLog").innerHTML = '<span class="small-note">Run dabao — console output yahan dikhega.</span>';
    $("#runModal").hidden = false;
    runNow();
  }
  function runNow() {
    if (!runHtml) return;
    $("#rnLog").innerHTML = "";
    rnLog("info", "▶ Run ho raha hai…");
    try { rnFrame().srcdoc = bridgeInject(runHtml); }
    catch (e) { rnLog("error", "Preview nahi khul paya: " + e.message); }
  }
  function stopRun() {
    try { rnFrame().removeAttribute("srcdoc"); rnFrame().src = "about:blank"; } catch {}
    rnLog("warn", "■ Rok diya gaya.");
  }
  function rnLog(type, text) {
    const box = $("#rnLog");
    const ph = box.querySelector(".small-note"); if (ph) ph.remove();
    const d = document.createElement("div");
    d.className = "rn-line rn-" + type;
    d.textContent = (type === "error" ? "❌ " : type === "warn" ? "⚠️ " : "") + text;
    box.appendChild(d);
    box.scrollTop = box.scrollHeight;
    while (box.children.length > 200) box.firstChild.remove();
  }
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || d.__rn !== 1) return;
    try { if (e.source !== rnFrame().contentWindow) return; } catch { return; }
    (d.args || []).forEach((a) => rnLog(d.type || "log", String(a).slice(0, 2000)));
  });

  /* =====================  SETTINGS  ===================== */
  function keyUi() {
    // Veda v1 BYOK: key sirf is browser me rehti hai, har request ke header me jaati hai.
    const st = $("#keyState");
    const pv = settings.provider === "llama" ? "Meta Llama API (\u26A0\uFE0F untested)" : "Google Gemini";
    st.textContent = "\u{1F511} BYOK mode: key sirf is browser me save hoti hai. Server par koi key save nahi hoti. | Provider: " + pv + ".";
  }
  async function refreshCfg() { try { serverCfg = await (await fetch("/api/config")).json(); } catch {} keyUi(); checkBanner(); }
  function updateProvNote() {
    const llama = $("#sProvider").value === "llama";
    $("#provNote").textContent = llama
      ? "🦙 Llama (BYOK, \u26A0\uFE0F untested): chat Meta ke models se chalega. Awaazein phone wali hongi, live search nahi hoga. Key neeche daalo."
      : "🤖 Gemini (tested): tez, live khabar, photo/PDF samajhna, mic transcribe.";
    $("#llamaKeyRow").hidden = !llama;
  }
  async function openSettings() {
    $("#sKey").value = settings.apiKey; $("#sCode").value = settings.accessCode;
    $("#sTemp").value = settings.temperature; $("#sTempV").textContent = settings.temperature;
    $("#sPersona").value = settings.persona; $("#sMicLang").value = settings.micLang; $("#sTtsLang").value = settings.ttsLang;
    $("#sEmoji").checked = !!settings.emojiMode; $("#sSounds").checked = !!settings.sounds;
    $("#sProvider").value = settings.provider === "llama" ? "llama" : "gemini";
    $("#sLlamaKey").value = settings.llamaKey || "";
    updateProvNote();
    $("#sRate").value = settings.rate; $("#sRateV").textContent = settings.rate;
    $("#sTheme").value = settings.theme; $("#sFont").value = settings.font;
    $("#sTextStyle").value = settings.textStyle || "normal";
    $("#sVoiceSend").checked = settings.voiceAutoSend; $("#sAutoLearn").checked = settings.autoLearn; $("#sSearch").checked = settings.search;
    $("#sTestOut").textContent = "";
    fillModels(settings.model, []);
    keyUi();
    $("#settingsModal").hidden = false;
    loadModels();
  }
  function fillModels(selected, list) {
    // Veda v1: saaf labels; Llama models par "untested" tag (imaandaar).
    const s = $("#sModel");
    const isLlama = settings.provider === "llama";
    s.innerHTML = "";
    const add = (v, t, dis) => { const o = document.createElement("option"); o.value = v; o.textContent = t; if (dis) o.disabled = true; s.appendChild(o); };
    add("auto", isLlama ? "Auto (Llama)" : "Auto (sabse achha, khud badalta hai)");
    const all = [...new Set(list)];
    if (selected !== "auto" && !all.includes(selected)) all.unshift(selected);
    if (!isLlama) {
      const flash = all.filter((m) => /flash/i.test(m) && !/lite/i.test(m));
      const pro = all.filter((m) => /pro/i.test(m));
      if (flash[0]) add(flash[0], "\u26A1 " + flash[0] + "  (tez)");
      if (pro[0]) add(pro[0], "\u{1F9E0} " + pro[0] + "  (gehra)");
      if (flash[0] || pro[0]) add("sep", "\u2500\u2500\u2500\u2500\u2500\u2500", true);
    }
    all.forEach((m) => add(m, m + (isLlama ? "  \u26A0\uFE0F untested" : "")));
    s.value = selected;
  }
  async function loadModels() {
    try {
      const r = await fetch("/api/models", { headers: headers() });
      const j = await r.json();
      if (r.ok) fillModels($("#sModel").value, j.models);
      return { ok: r.ok, j };
    } catch (e) { return { ok: false, j: { error: e.message } }; }
  }
  function saveFromForm() {
    settings.apiKey = $("#sKey").value.trim();
    settings.accessCode = $("#sCode").value.trim();
    settings.model = $("#sModel").value; settings.temperature = Number($("#sTemp").value);
    settings.persona = $("#sPersona").value; settings.micLang = $("#sMicLang").value; settings.ttsLang = $("#sTtsLang").value;
    settings.rate = Number($("#sRate").value); settings.theme = $("#sTheme").value; settings.font = $("#sFont").value;
    settings.textStyle = $("#sTextStyle").value || "normal";
    settings.voiceAutoSend = $("#sVoiceSend").checked; settings.autoLearn = $("#sAutoLearn").checked; settings.search = $("#sSearch").checked;
    settings.emojiMode = $("#sEmoji").checked; settings.sounds = $("#sSounds").checked;
    settings.provider = $("#sProvider").value === "llama" ? "llama" : "gemini";
    settings.llamaKey = $("#sLlamaKey").value.trim();
    saveSettings(); applyTheme(); renderTools(); checkBanner();
  }

  /* =====================  TOOLS ROW  ===================== */
  const LANGS = [["hi-IN", "हि"], ["en-IN", "EN"], ["en-US", "US"]];
  function renderTools() {
    el.tDoc.classList.toggle("on", docMode);

    el.tSpeak.classList.toggle("on", !!settings.autoSpeak);
    el.tHands.classList.toggle("on", !!settings.handsFree);
    const l = LANGS.find((x) => x[0] === settings.micLang);
    el.tLang.textContent = "🎤 " + (l ? l[1] : settings.micLang.slice(0, 2).toUpperCase());
    el.input.placeholder = docMode ? "Batao kaisa document/PDF chahiye (style, rang, content)…" : "Kuch bhi poochho…";
  }
  function checkBanner() {
    let msg = "";
    const needKey = settings.provider === "llama" ? !settings.llamaKey : !settings.apiKey;
    if (needKey) msg = "⚠️ API key nahi hai. Yahan tap karke Settings me apni key daalo (Gemini free milti hai).";
    else if (serverCfg.needsCode && !settings.accessCode) msg = "🔒 Is app par access code laga hai. Yahan tap karke daalo.";
    el.banner.hidden = !msg; el.banner.textContent = msg;
  }

  /* =====================  BACKUP / EXPORT  ===================== */
  function exportChatMd() {
    const c = currentChat(); if (!c || !c.messages.length) { toast("Koi chat khuli nahi."); return; }
    const md = "# " + c.title + "\n\n" + c.messages.map((m) => (m.role === "user" ? "**Tum:** " : "**AI:** ") + stripMemory(m.text || "") + (m.files && m.files.length ? "\n\n(Files: " + m.files.map((f) => f.name).join(", ") + ")" : "")).join("\n\n---\n\n");
    download(safeName(c.title) + ".md", md, "text/markdown");
  }
  function backup() {
    const s = { ...settings }; delete s.apiKey; delete s.accessCode; delete s.llamaKey; // (fix) Llama key bhi backup file me nahi jani chahiye
    download("veda-ai-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify({ v: 1, chats, memory, settings: s }), "application/json");
    toast("Backup download ho gaya (files/photo shamil nahi).");
  }
  async function restore(file) {
    try {
      const j = JSON.parse(await file.text());
      if (!Array.isArray(j.chats)) throw new Error("bad");
      const ids = new Set(chats.map((c) => c.id));
      j.chats.forEach((c) => { if (!ids.has(c.id)) chats.push(c); });
      (j.memory || []).forEach((t) => { if (!memory.includes(t)) memory.push(t); });
      if (j.settings) settings = { ...settings, ...j.settings, apiKey: settings.apiKey, accessCode: settings.accessCode, llamaKey: settings.llamaKey };
      saveSettings(); saveMemory(); saveChatsNow();
      if (!currentId && chats[0]) currentId = chats[0].id;
      applyTheme(); renderAll(); toast("Restore ho gaya ✅");
    } catch { toast("Ye backup file sahi nahi lagti."); }
  }

  /* =====================  SIDEBAR / MISC  ===================== */
  const openSide = () => document.body.classList.add("side-open");
  const closeSide = () => document.body.classList.remove("side-open");
  function autosize() {
    el.input.style.height = "auto";
    el.input.style.height = Math.min(el.input.scrollHeight, 160) + "px";
  }
  function startNew() {
    if (streaming) stopGen();
    stopSpeak();
    const c = currentChat();
    if (c && !c.messages.length) { closeSide(); el.input.focus(); return; }
    newChat(); renderAll(); closeSide(); el.input.focus();
  }

  const SUGGEST = [
    ["📰 Aaj ki khabar", "Aaj ki sabse badi 5 khabrein batao (India aur duniya), source ke saath."],
    ["📄 Resume PDF", "Mera ek professional resume banao. Style: modern, neela rang, 1 page.", "doc"],
    ["📚 Kitab se sawal", "Is kitab/chapter se bilkul 20 important sawal-jawab banao (PDF attach karke bhejo)."],
    ["📖 Line by line", "Is poore chapter ko Hindi me line by line samjhao (PDF attach karke bhejo)."],
    ["📝 Notes PDF", "Photosynthesis par saaf notes banao, end me 5 revision sawal, PDF me.", "doc"],
    ["🎓 NCERT sawal", "Class 8 Science ke 'Cell' chapter se 10 MCQ (4 options, answer key ke saath) aur 5 short-answer sawal banao. Mushkil shabdon ke English naam bracket me do."],
    ["🎨 Image banao", "OPEN_IMAGE_MODAL"],
    ["🗺️ Rasta batao", "Connaught Place se India Gate ka rasta batao (Google Maps link ke saath)."],
    ["💻 Code likho", "Python me ek simple todo list app likho aur samjhao."],
    ["🌐 Anuvaad", "Is line ko English me badlo: 'Kal hum sab milkar kaam karenge.'"],
  ];
  function renderSuggest() {
    SUGGEST.forEach(([t, p, doc]) => {
      const b = document.createElement("button");
      const [h, ...rest] = t.split(" ");
      b.innerHTML = "<b>" + esc(t) + "</b><span>" + esc(p.slice(0, 60)) + "…</span>";
      b.onclick = () => { if (p === "OPEN_IMAGE_MODAL") return toast("Image generation Veda v1 me nahi hai."); if (doc) { docMode = true; renderTools(); } el.input.value = p; autosize(); el.input.focus(); };
      el.suggest.appendChild(b);
    });
  }

  /* =====================  LIBRARY (files: preview/rename/delete)  ===================== */
  function fmtSize(n) {
    n = Number(n) || 0;
    return n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB";
  }
  async function openLibrary() {
    $$(".modal").forEach((m) => (m.hidden = true));
    let modal = $("#libModal");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "libModal"; modal.className = "modal"; modal.hidden = true;
      modal.innerHTML = `
      <div class="sheet tall"><div class="sheet-head"><h2>🗂️ Library</h2><button class="icon-btn close" id="libClose">✕</button></div>
      <div class="sheet-body"><div class="small-note" id="libCount"></div><div id="libList" class="lib-list"></div></div>
      <div class="sheet-foot"><div class="small-note">Ye files sirf is browser me saved hain. Preview / rename / delete yahin se karo.</div></div></div>`;
      document.body.appendChild(modal);
      $("#libClose", modal).onclick = () => { modal.hidden = true; };
      modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
    }
    const list = $("#libList", modal);
    list.innerHTML = '<div class="small-note">Load ho raha hai…</div>';
    modal.hidden = false;
    // (fix) 📌 Pin ki hui files "sabse upar" milengi (toast me yahi likha tha, par sort me pinned dekha hi nahi jata tha)
    const files = (await idb.all()).sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || (b.ts || 0) - (a.ts || 0));
    $("#libCount", modal).textContent = files.length ? files.length + " file" : "Koi file save nahi hai. Chat me file attach karo, wo yahan dikhegi.";
    list.innerHTML = "";
    for (const f of files) {
      const row = document.createElement("div");
      row.className = "lib-row";
      row.innerHTML = `<span class="lib-ic">${ICON[f.kind] || "📎"}</span>
        <span class="lib-meta"><b></b><small></small></span>
        <span class="lib-btns">
          <button class="icon-btn" data-a="view" title="Preview">👁️</button>
          <button class="icon-btn" data-a="dl" title="Download">⬇️</button>
          <button class="icon-btn" data-a="ren" title="Rename">✏️</button>
          <button class="icon-btn" data-a="del" title="Delete">🗑️</button>
        </span>`;
      $("b", row).textContent = f.name || "file";
      $("small", row).textContent = fmtSize(f.size) + (f.ts ? " · " + new Date(f.ts).toLocaleDateString("en-IN") : "");
      row.onclick = async (e) => {
        const a = e.target.closest("button"); if (!a) return;
        const act = a.dataset.a;
        if (act === "view") {
          if (f.kind === "image") openImage(f.id);
          else if (f.kind === "pdf") { const rec = await loadFile(f.id); if (rec) openPdfViewer(rec, f.name); }
          else if (f.kind === "text") { const rec = await loadFile(f.id); if (rec) toast((rec.text || "").slice(0, 300) || "Khali file", 3000); }
          else toast("Is file ka preview nahi hai, download kar lo.");
        } else if (act === "dl") {
          const rec = await loadFile(f.id); if (!rec) return;
          const x = document.createElement("a");
          x.href = rec.data ? recUrl(rec) : URL.createObjectURL(new Blob([rec.text || ""], { type: "text/plain" }));
          x.download = f.name || "file"; x.click();
        } else if (act === "ren") {
          const nn = prompt("Naya naam:", f.name); if (!nn || !nn.trim()) return;
          const rec = await loadFile(f.id); if (!rec) return;
          rec.name = nn.trim().slice(0, 120); await idb.put(rec); fileCache.set(rec.id, rec);
          $("b", row).textContent = rec.name; toast("Rename ho gaya");
        } else if (act === "del") {
          if (!confirm(`"${f.name}" delete kar dun? (Purane chats me ye file nahi khulegi.)`)) return;
          await idb.del(f.id); fileCache.delete(f.id); row.remove();
          $("#libCount", modal).textContent = $("#libList", modal).children.length + " file";
          toast("Delete ho gaya");
        }
      };
      list.appendChild(row);
    }
  }

  /* ============  CAMERA CAPTURE  ============ */
  let camStream = null;
  async function openCam() {
    $$(".modal").forEach((m) => (m.hidden = true));
    $("#camModal").hidden = false; $("#camErr").textContent = "";
    // Pehle pichla camera maango; na khule to koi bhi camera chalega (kuch phone
    // facingMode constraint par mana kar dete hain).
    try {
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      } catch {
        camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      $("#camVideo").srcObject = camStream;
      await $("#camVideo").play();
    } catch (e) {
      camStream = null;
      $("#camErr").textContent = "Camera nahi khula. Ye karo: Chrome me address bar ke 🔒 icon par tap → Permissions → Camera → Allow, phir page reload karke dobara try karo. (Agar ye page kisi aur app ke andar khula hai to Chrome me kholo — wahan camera block hota hai.)";
    }
  }
  function closeCam() { if (camStream) { camStream.getTracks().forEach((t) => t.stop()); camStream = null; } }
  async function snapPhoto() {
    const v = $("#camVideo");
    if (!v.videoWidth) { toast("Camera taiyaar nahi."); return; }
    const c = document.createElement("canvas");
    c.width = v.videoWidth; c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.9));
    const b64 = await toB64(blob);
    const rec = {
      id: "cam" + Date.now().toString(36), name: "camera-photo.jpg", mime: "image/jpeg", kind: "image",
      // (fix) data sirf base64 hota hai (prefix ke saath atob() toot jata tha: thumbnail nahi dikhta, AI ko galat data jata tha)
      size: blob.size, ts: Date.now(), data: b64,
    };
    fileCache.set(rec.id, rec); await idb.put(rec); Cloud.markFile(rec.id);
    pending.push(rec); renderPending();
    closeCam(); $("#camModal").hidden = true;
    toast("📷 Photo attach ho gayi — ab bhejo ya sawal likho.");
  }

  /* =====================  UI SOUNDS (halki)  ===================== */
  let audioCtx = null;
  function blip(freq, dur) {
    if (!settings.sounds) return;
    try {
      audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.frequency.value = freq; o.type = "sine";
      g.gain.setValueAtTime(0.08, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + dur);
    } catch {}
  }
  const sndSend = () => blip(660, 0.12);
  const sndRecv = () => blip(440, 0.18);

  /* =====================  EVENTS  ===================== */
  function bind() {
    $("#newChat").onclick = startNew; $("#newChat2").onclick = startNew;
    $("#menuBtn").onclick = openSide; $("#scrim").onclick = closeSide;
    el.search.oninput = renderChatList;
    el.sendBtn.onclick = () => send(); el.stopBtn.onclick = stopGen; el.micBtn.onclick = () => startMic(); // arrow: event object target me na ghuse (Bug B root cause)
    el.attachBtn.onclick = () => el.fileInput.click();
    el.fileInput.onchange = async () => { for (const f of el.fileInput.files) await addFile(f); el.fileInput.value = ""; };
    el.input.addEventListener("input", autosize);
    el.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey && !isTouch) { e.preventDefault(); send(); }
    });
    el.input.addEventListener("paste", async (e) => {
      const fs = [...(e.clipboardData ? e.clipboardData.files : [])];
      if (fs.length) { e.preventDefault(); for (const f of fs) await addFile(f); }
    });
    ["dragover", "drop"].forEach((ev) => document.addEventListener(ev, async (e) => {
      e.preventDefault();
      if (ev === "drop" && e.dataTransfer) for (const f of e.dataTransfer.files) await addFile(f);
    }));

    $("#imgDl").onclick = () => viewerId && downloadImage(viewerId);
    $("#imgCopy").onclick = () => viewerId && copyImage(viewerId);
    $("#docMic").onclick = () => startMic($("#docInstr"), $("#docMic"));
    $("#docGo").onclick = () => editDoc($("#docInstr").value);
    $("#docUndo").onclick = undoDoc;
    el.tDoc.onclick = () => { docMode = !docMode; renderTools(); toast(docMode ? "PDF mode chalu: jaisa bologe waisa document banega" : "PDF mode band"); };
    $("#tLib").onclick = openLibrary;
    el.tNews.onclick = (e) => { e.stopPropagation(); const m = $("#newsMenu"); if (m) m.hidden = !m.hidden; };
    el.tLang.onclick = () => {
      const i = LANGS.findIndex((x) => x[0] === settings.micLang);
      settings.micLang = LANGS[(i + 1) % LANGS.length][0]; saveSettings(); renderTools();
    };
    el.tSpeak.onclick = () => { settings.autoSpeak = !settings.autoSpeak; saveSettings(); renderTools(); if (!settings.autoSpeak) stopSpeak(); };
    el.tHands.onclick = () => {
      settings.handsFree = !settings.handsFree; saveSettings(); renderTools();
      if (settings.handsFree) { toast("Hands-free: mic dabao, bolo, jawab suno, phir bolo"); startMic(); } else { stopSpeak(); stopMic(false); }
    };

    el.title.onclick = () => {
      const c = currentChat(); if (!c) return;
      const t = prompt("Chat ka naam:", c.title);
      if (t && t.trim()) { c.title = t.trim().slice(0, 80); el.title.textContent = c.title; saveChatsNow(); renderChatList(); }
    };
    el.messages.addEventListener("click", (e) => {
      const b = e.target.closest(".copy-code"); if (!b) return;
      const code = b.closest(".code").querySelector("code").textContent;
      navigator.clipboard.writeText(code).then(() => { b.textContent = "Copied ✓"; setTimeout(() => (b.textContent = "Copy"), 1400); });
    });
    el.banner.onclick = openSettings;

    $("#openSettings").onclick = () => { closeSide(); openSettings(); };
    // ---- Veda AI v1: auth / image / camera ----
    $("#camBtn").onclick = openCam;
    $("#camSnap").onclick = snapPhoto;
    // ---- Veda v1: news / zip / lock ----
    el.newsBtn.onclick = (e) => { e.stopPropagation(); const m = $("#newsMenu"); if (m) m.hidden = !m.hidden; };
    $("#newsIndia").onclick = () => newsFlow("india");
    $("#newsWorld").onclick = () => newsFlow("world");
    document.addEventListener("click", (e) => { const m = $("#newsMenu"); if (m && !m.hidden && !e.target.closest("#newsMenu") && !e.target.closest("#newsBtn")) m.hidden = true; });
    $("#tZip").onclick = () => openZipModal(null);
    $("#zipPick").onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (!f) return; zipAnalyzeFile({ name: f.name, data: await toB64(f) }); };
    $("#zipCloseBtn").onclick = () => { $("#zipModal").hidden = true; };
    $("#lockGo").onclick = async () => { const cb = lockCb; lockCb = null; const code = $("#lockCode").value; $("#lockModal").hidden = true; if (cb) await cb(code); };
    $("#lockCode").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#lockGo").click(); });
    // camera modal band ho to stream roko
    new MutationObserver(() => { if ($("#camModal").hidden) closeCam(); }).observe($("#camModal"), { attributes: true, attributeFilter: ["hidden"] });
    $("#openMemory").onclick = () => { closeSide(); renderMemory(); $("#memoryModal").hidden = false; };
    $("#memAdd").onclick = () => { const v = $("#memNew").value.trim(); if (v) { addMemory([v]); $("#memNew").value = ""; renderMemory(); } };
    $("#memNew").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#memAdd").click(); });
    $("#sTemp").oninput = (e) => ($("#sTempV").textContent = e.target.value);
    $("#sRate").oninput = (e) => ($("#sRateV").textContent = e.target.value);
    $("#sSave").onclick = () => { saveFromForm(); $("#settingsModal").hidden = true; toast("Save ho gaya ✅"); };
    $("#sProvider").onchange = updateProvNote;
    $("#sTest").onclick = async () => {
      saveFromForm();
      const out = $("#sTestOut"); out.textContent = "Test ho raha hai…";
      const { ok, j } = await loadModels();
      out.textContent = ok ? "✅ Sab theek hai. " + j.models.length + " models mile." + (j.flash && j.flash[0] ? " Auto model: " + j.flash[0] : "") : "❌ " + (j.error || "Nahi chala");
    };
    $("#sVoiceTest").onclick = () => {
      settings.rate = Number($("#sRate").value);
      speak("Namaste! Main Veda AI hun. Bataiye, main aapki kya madad kar sakta hun?", null);
    };
    $("#sClear").onclick = () => {
      if (!confirm("Saari chats, memory aur settings mit jayengi. Pakka?")) return;
      localStorage.clear();
      try { indexedDB.deleteDatabase("veda-ai"); } catch {}
      location.reload();
    };
    $$("[data-close]").forEach((b) => (b.onclick = () => (b.closest(".modal").hidden = true)));
    $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".modal").forEach((m) => (m.hidden = true)); });

    $("#docPdf").onclick = printDoc;
    $("#docShare").onclick = sharePdf; $("#docDl").onclick = downloadPdf; $("#docPreview").onclick = previewPdf;
    $("#docHtml").onclick = () => download(safeName(currentDoc.title) + ".html", currentDoc.html, "text/html");
    $("#docDoc").onclick = () => download(safeName(currentDoc.title) + ".doc",
      '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>' + currentDoc.html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "") + "</body></html>",
      "application/msword");
    $("#docDoc").onclick = () => download(safeName(currentDoc.title) + ".doc", currentDoc.html, "application/msword");
    // (fix) index.html me do button ki id "docDoc" thi -> "Word" button par kuchh hota hi nahi tha. Ab alag id (docWord) + handler.
    const wordBtn = $("#docWord");
    if (wordBtn) wordBtn.onclick = () => {
      const h = currentDoc.html || "";
      const ns = ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"';
      const w = /<html[\s>]/i.test(h) ? h.replace(/<html/i, "<html" + ns) : "<html" + ns + '><head><meta charset="utf-8"></head><body>' + h + "</body></html>";
      download(safeName(currentDoc.title) + ".doc", w, "application/msword");
    };

    /* runner */
    $("#rnRun").onclick = runNow;
    $("#rnStop").onclick = stopRun;
    $("#rnRefresh").onclick = runNow;
    $("#rnSplit").onclick = () => $("#rnWrap").classList.toggle("split");
    $("#rnFs").onclick = () => { const m = $("#runModal .sheet"); if (document.fullscreenElement) document.exitFullscreen(); else if (m.requestFullscreen) m.requestFullscreen(); };

    $("#exportChat").onclick = exportChatMd; $("#backup").onclick = backup;
    $("#restore").onclick = () => $("#restoreFile").click();
    $("#restoreFile").onchange = (e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; };
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
    if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};
    bindViewer(); bindPins(); bindArchiveShare();
  }

  /* =====================  PIN / ARCHIVE / SHARE  ===================== */
  function togglePin(chatId, msgId) {
    const chat = chats.find((c) => c.id === chatId); if (!chat) return;
    if (!Array.isArray(chat.pins)) chat.pins = [];
    const i = chat.pins.findIndex((p) => p.msgId === msgId);
    if (i >= 0) { chat.pins.splice(i, 1); toast("📌 Pin hataya"); }
    else {
      const m = chat.messages.find((x) => x.id === msgId); if (!m) return;
      chat.pins.push({ id: uid(), msgId, role: m.role, text: stripMemory(m.text || "").slice(0, 300), ts: m.ts, pinnedAt: Date.now(), title: chat.title });
      toast("📌 Pin ho gaya");
    }
    chat.updated = Date.now(); saveChatsNow();
    renderMessages();
  }
  function isPinned(chat, msgId) { return Array.isArray(chat.pins) && chat.pins.some((p) => p.msgId === msgId); }
  function allPins() {
    const out = [];
    chats.forEach((c) => (c.pins || []).forEach((p) => out.push({ ...p, chatId: c.id, chatTitle: c.title })));
    return out.sort((a, b) => b.pinnedAt - a.pinnedAt);
  }
  function renderPinList() {
    const q = ($("#pinSearch").value || "").trim().toLowerCase();
    const box = $("#pinList"); box.innerHTML = "";
    const pins = allPins().filter((p) => !q || p.text.toLowerCase().includes(q) || (p.chatTitle || "").toLowerCase().includes(q));
    if (!pins.length) { box.innerHTML = '<div class="small-note">Koi pinned message nahi.</div>'; return; }
    pins.forEach((p) => {
      const d = document.createElement("div"); d.className = "pin-item";
      d.innerHTML = '<div class="pin-meta"></div><div class="pin-text"></div><div class="pin-btns"><button class="btn ghost small go">➡️ Kholo</button><button class="btn ghost small un">📌 Hatayo</button></div>';
      $(".pin-meta", d).textContent = (p.role === "user" ? "Tum" : "AI") + " · " + (p.chatTitle || "") + " · " + fmtTime(p.pinnedAt);
      $(".pin-text", d).textContent = p.text;
      $(".go", d).onclick = () => { $("#pinModal").hidden = true; jumpToMsg(p.chatId, p.msgId); };
      $(".un", d).onclick = () => { togglePin(p.chatId, p.msgId); renderPinList(); };
      box.appendChild(d);
    });
  }
  function jumpToMsg(chatId, msgId) {
    const show = () => {
      const node = $('.msg[data-id="' + msgId + '"]', el.messages);
      if (!node) { toast("Message ab is chat me nahi hai."); return; }
      node.scrollIntoView({ block: "center", behavior: "smooth" });
      node.classList.add("flash");
      setTimeout(() => node.classList.remove("flash"), 2200);
    };
    if (chatId !== currentId) { openChat(chatId); setTimeout(show, 120); }
    else show();
  }
  function archiveChat(id, on) {
    const c = chats.find((x) => x.id === id); if (!c) return;
    c.archived = !!on; c.updated = Date.now(); saveChatsNow(); renderChatList();
    toast(on ? "🗄️ Archive ho gayi" : "📤 Archive se wapas");
  }
  function setSideTab(t) {
    sideTab = t;
    $("#tabChats").classList.toggle("on", t === "chats");
    $("#tabArch").classList.toggle("on", t === "arch");
    $("#tabPins").classList.toggle("on", t === "pins");
    renderChatList();
  }
  // --- share (client-side: system share sheet / clipboard; koi server link nahi) ---
  function chatToText(c) {
    return (c.messages || []).map((m) => (m.role === "user" ? "Tum" : "Veda AI") + ":\n" + stripMemory(m.text || "")).join("\n\n");
  }
  async function shareCurrentChat() {
    const c = currentChat();
    if (!c || !c.messages.length) { toast("Pehle koi chat kholo."); return; }
    const text = "\u{1F4AC} " + c.title + " (Veda AI)\n\n" + chatToText(c).slice(0, 60000);
    try {
      if (navigator.share) await navigator.share({ title: c.title, text });
      else { await navigator.clipboard.writeText(text); toast("\u{1F4CB} Chat copy ho gayi."); }
    } catch (e) { if (!e || e.name !== "AbortError") toast("Share nahi ho paya."); }
  }

  function bindPins() {
    $("#pinSearch").oninput = renderPinList;
  }
  function bindArchiveShare() {
    $("#tabChats").onclick = () => setSideTab("chats");
    $("#tabArch").onclick = () => setSideTab("arch");
    $("#tabPins").onclick = () => { setSideTab("pins"); $("#pinModal").hidden = false; $("#pinSearch").value = ""; renderPinList(); };
    $("#shareChat").onclick = () => { closeSide(); shareCurrentChat(); };
  }

  /* =====================  BRIDGE (tools.js ke liye)  ===================== */
  window.VedaApp = {
    uid, toast, loadFile, recUrl, extOf, openImage,
    saveLib: (rec) => idb.put(rec),
    attach(rec) { fileCache.set(rec.id, rec); pending.push(rec); renderPending(); },
    send: (t, o) => send(t, o),
    closeAll() { $$(".modal").forEach((m) => (m.hidden = true)); closeSide(); },
    busy: () => !!streaming,
    mic: (target, btn) => startMic(target, btn),
    openPdf: (file, title) => openPdfViewer(file, title),
    currentViewerId: () => viewerId,
  };

  /* =====================  START  ===================== */
  async function init() {
    applyTheme(); bind(); renderSuggest();
    if (currentId && !currentChat()) currentId = chats[0] ? chats[0].id : null;
    renderAll(); renderPending();
    try { serverCfg = await (await fetch("/api/config")).json(); } catch {}
    checkBanner(); keyUi(); renderMoods();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  init();
})();
