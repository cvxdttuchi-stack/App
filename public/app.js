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
    micLang: "hi-IN", ttsLang: "auto", rate: 1, theme: "dark", font: "16",
    voiceAutoSend: true, autoLearn: true, search: false, autoSpeak: false, handsFree: false,
  };
  let settings = { ...DEFAULTS, ...store.get("settings", {}) };
  let chats = store.get("chats", []);
  let memory = store.get("memory", []);
  let currentId = store.get("currentId", null);
  let pending = [];
  let streaming = null;
  let docMode = false;
  let serverCfg = { serverKey: false, needsCode: false };

  const saveSettings = () => store.set("settings", settings);
  let saveTimer;
  const saveChats = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => store.set("chats", chats), 250); };
  const saveChatsNow = () => { clearTimeout(saveTimer); store.set("chats", chats); };
  const saveMemory = () => store.set("memory", memory);

  /* files live in IndexedDB (localStorage me badi files nahi aati) */
  const fileCache = new Map();
  const idb = {
    db: null,
    open() {
      return new Promise((res, rej) => {
        if (this.db) return res(this.db);
        const r = indexedDB.open("mera-ai", 1);
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
    banner: $("#banner"), toast: $("#toast"), suggest: $("#suggest"),
    tDoc: $("#tDoc"), tSearch: $("#tSearch"), tLang: $("#tLang"), tSpeak: $("#tSpeak"), tHands: $("#tHands"),
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
    const t = settings.theme === "auto" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : settings.theme;
    document.documentElement.dataset.theme = t;
    document.documentElement.style.setProperty("--fs", settings.font + "px");
    const m = $('meta[name="theme-color"]'); if (m) m.content = t === "light" ? "#f6f7fb" : "#0b0d12";
  }
  const nearBottom = () => el.messages.scrollHeight - el.messages.scrollTop - el.messages.clientHeight < 140;
  const scrollDown = (force) => { if (force || nearBottom()) el.messages.scrollTop = el.messages.scrollHeight; };
  const fmtTime = (t) => new Date(t).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
  const isTouch = matchMedia("(pointer:coarse)").matches;

  /* =====================  CHATS  ===================== */
  const currentChat = () => chats.find((c) => c.id === currentId);
  function newChat() {
    const c = { id: uid(), title: "Nayi chat", messages: [], created: Date.now(), updated: Date.now() };
    chats.unshift(c); currentId = c.id; store.set("currentId", currentId); saveChats();
    return c;
  }
  function openChat(id) {
    if (streaming) stopGen();
    stopSpeak();
    currentId = id; store.set("currentId", id);
    renderAll(); closeSide();
  }
  function deleteChat(id) {
    const c = chats.find((x) => x.id === id); if (!c) return;
    if (!confirm("Ye chat mita den?\n\n" + c.title)) return;
    c.messages.forEach((m) => (m.files || []).forEach((f) => { idb.del(f.id); fileCache.delete(f.id); }));
    chats = chats.filter((x) => x.id !== id);
    if (currentId === id) currentId = chats[0] ? chats[0].id : null;
    store.set("currentId", currentId); saveChatsNow(); renderAll();
  }
  function renderChatList() {
    const q = el.search.value.trim().toLowerCase();
    const list = chats
      .filter((c) => !q || c.title.toLowerCase().includes(q) || c.messages.some((m) => (m.text || "").toLowerCase().includes(q)))
      .sort((a, b) => b.updated - a.updated);
    el.chatList.innerHTML = "";
    if (!list.length) { el.chatList.innerHTML = '<div class="small-note" style="padding:14px">Koi chat nahi mili.</div>'; return; }
    list.forEach((c) => {
      const d = document.createElement("div");
      d.className = "chat-item" + (c.id === currentId ? " active" : "");
      d.innerHTML = '<span class="t"></span><button class="x" title="Mitao">✕</button>';
      $(".t", d).textContent = c.title;
      d.onclick = () => openChat(c.id);
      $(".x", d).onclick = (e) => { e.stopPropagation(); deleteChat(c.id); };
      el.chatList.appendChild(d);
    });
  }

  /* =====================  MESSAGE RENDERING  ===================== */
  const ICON = { image: "🖼️", pdf: "📕", audio: "🎵", video: "🎬", text: "📄" };

  function stripMemory(t) {
    return t.replace(/<memory>[\s\S]*?(<\/memory>|$)/gi, "").replace(/<m(e(m(o(r(y)?)?)?)?)?$/i, "");
  }
  // ```html document ko alag nikalna (preview/PDF ke liye)
  function splitDoc(text, isDocMode) {
    const m = text.match(/```html[ \t]*\n([\s\S]*?)(```|$)/i);
    if (!m) return { display: text, html: null };
    const body = m[1];
    const full = /^\s*<(!doctype|html)/i.test(body);
    if (!full && !(isDocMode && body.trim().length < 15)) return { display: text, html: null };
    const closed = m[2] === "```";
    return {
      display: text.replace(m[0], "\n\n_📄 Document ban raha hai…_\n\n"),
      html: closed && full ? body.trim() : null,
    };
  }
  function chipHtml(f) {
    return '<span class="file-chip">' + (ICON[f.kind] || "📎") + " <span>" + esc(f.name) + "</span></span>";
  }

  function renderContent(msgEl, m, live) {
    const c = $(".content", msgEl);
    let text = stripMemory(m.text || "");
    const sd = splitDoc(text, m.docMode);
    c.innerHTML = renderMarkdown(sd.display);
    c.classList.toggle("cursor", !!live);
    let card = $(".doc-card", msgEl);
    if (sd.html && !live) {
      if (!card) {
        card = document.createElement("div");
        card.className = "doc-card";
        card.innerHTML = '<div class="ic">📄</div><div class="tx"><b>Document taiyar hai</b><small>Preview dekho, PDF ya Word me save karo</small></div><button class="btn primary">Kholo</button>';
        c.after(card);
      }
      $("button", card).onclick = () => openDoc(sd.html, docTitleFrom(sd.html));
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
    const isLast = chat.messages[chat.messages.length - 1] === m;
    let html = '<div class="bubble">';
    if (m.role !== "user") html += '<div class="who"><i>✦</i> Mera AI</div>';
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
    if (m.role === "user") {
      add("✏️", "Badlo aur dobara bhejo", () => editFrom(m.id));
    } else {
      add("🔊", "Suno", (e, b) => toggleSpeak(m, b), "speak");
      add("📄", "PDF / Word / HTML banao", () => {
        const sd = splitDoc(stripMemory(m.text || ""), m.docMode);
        if (sd.html) openDoc(sd.html, docTitleFrom(sd.html));
        else openDoc(mdToDoc(stripMemory(m.text || ""), chat.title), chat.title);
      });
      add("👎", "Galat tha? Batao, AI seekhega", () => feedbackBad(m));
      if (isLast) add("🔄", "Dobara likho", () => regenerate());
    }
    add("🗑️", "Mitao", () => deleteMsg(m.id));
    renderContent(d, m, false);
    return d;
  }

  function renderMessages() {
    const chat = currentChat();
    $$(".msg", el.messages).forEach((n) => n.remove());
    if (!chat || !chat.messages.length) { el.empty.hidden = false; return; }
    el.empty.hidden = true;
    chat.messages.forEach((m) => el.messages.appendChild(buildMsgEl(m, chat)));
    scrollDown(true);
  }
  function renderAll() {
    const chat = currentChat();
    el.title.textContent = chat ? chat.title : "Mera AI";
    const last = chat && [...chat.messages].reverse().find((m) => m.model);
    el.badge.textContent = last ? last.model : "";
    renderChatList(); renderMessages(); renderTools();
  }

  /* =====================  SEND / GENERATE  ===================== */
  function headers() {
    const h = { "Content-Type": "application/json" };
    if (settings.apiKey) h["x-api-key"] = settings.apiKey;
    if (settings.accessCode) h["x-access-code"] = settings.accessCode;
    return h;
  }
  function buildSystem(m) {
    let s =
      "Tum 'Mera AI' ho: tez, saaf, bharosemand aur madadgaar AI assistant. " +
      "User jis bhasha me likhe (Hindi, Hinglish, English) usi me jawab do. Seedha kaam ki baat karo, bekaar bhumika mat bandho. " +
      "Jawab saaf formatting me do (zaroorat par headings, bullets, tables, code blocks). " +
      "Agar koi baat pakki na ho to andaza mat lagao, saaf bolo ki pakka nahi pata. " +
      "Aaj ki tareekh/samay: " + new Date().toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" }) + ". ";
    if (settings.persona.trim()) s += "\n\nUser ke apne niyam (inhe maano):\n" + settings.persona.trim();
    if (settings.autoLearn) {
      s += "\n\nYaad rakhne ka niyam: agar user apne baare me koi lambe samay tak kaam aane wali baat bataye (naam, kaam, pasand, ya kisi galti ko sudharne ka tareeka), to jawab ke bilkul aakhir me ek alag line me <memory>chhoti si baat</memory> likho. Sirf tabhi jab sach me zaroori ho. Normal sawalon me kabhi nahi.";
    }
    if (memory.length) s += "\n\nUser ke baare me jo tumhe pata hai:\n- " + memory.join("\n- ");
    if (m && m.docMode) {
      s += "\n\nUser ko ek PDF/document chahiye. Sirf ek poora self-contained HTML document do: ek hi ```html code block me, <!DOCTYPE html> se shuru. " +
        "A4 print ke liye banao (@page { size: A4; margin: 16mm }), saara CSS <style> ke andar, koi bahari link/image/script nahi. " +
        "User ne jo style bola hai (rang, font, layout, tone) uske hisaab se sundar aur professional design banao. " +
        "Hindi text ke liye font-family: 'Noto Sans Devanagari','Mukta',system-ui,sans-serif rakho. " +
        "Code block ke bahar sirf ek chhoti line likho ki kya banaya.";
    }
    return s;
  }

  async function buildContents(msgs) {
    const usable = msgs.filter((m) => !m.error && (m.text || (m.files && m.files.length))).slice(-24);
    while (usable.length && usable[0].role !== "user") usable.shift();
    const recentFrom = Math.max(0, usable.length - 10);
    const out = [];
    for (let i = 0; i < usable.length; i++) {
      const m = usable[i];
      const parts = [];
      if (m.role === "user" && m.files && m.files.length) {
        for (const f of m.files) {
          if (i < recentFrom) { parts.push({ text: `[Pehle attach ki gayi file: ${f.name}]` }); continue; }
          const rec = await loadFile(f.id);
          if (!rec) { parts.push({ text: `[File "${f.name}" ab available nahi hai]` }); continue; }
          if (rec.kind === "text") parts.push({ text: `File "${rec.name}" ka text:\n\n${(rec.text || "").slice(0, 300000)}` });
          else parts.push({ inlineData: { mimeType: rec.mime, data: rec.data } });
        }
      }
      const t = m.role === "model" ? stripMemory(m.text || "") : m.text || "";
      parts.push({ text: t || "(khali)" });
      out.push({ role: m.role === "user" ? "user" : "model", parts });
    }
    return out;
  }

  function setBusy(b) {
    el.sendBtn.hidden = b; el.stopBtn.hidden = !b;
  }

  async function send(override) {
    if (streaming) return;
    const text = (typeof override === "string" ? override : el.input.value).trim();
    if (!text && !pending.length) return;
    stopSpeak();
    if (!serverCfg.serverKey && !settings.apiKey) { openSettings(); toast("Pehle apni free Gemini API key daalo."); return; }
    const chat = currentChat() || newChat();
    const files = pending.splice(0);
    for (const f of files) { fileCache.set(f.id, f); await idb.put(f); }
    const msg = {
      id: uid(), role: "user", ts: Date.now(),
      text: text || "Is file ko dhyan se padho/dekho aur saaransh (summary) do.",
      files: files.map(({ id, name, mime, kind, size }) => ({ id, name, mime, kind, size })),
    };
    chat.messages.push(msg);
    if (chat.title === "Nayi chat") chat.title = msg.text.replace(/\s+/g, " ").slice(0, 42);
    chat.updated = Date.now();
    el.input.value = ""; autosize(); renderPending();
    el.empty.hidden = true;
    el.messages.appendChild(buildMsgEl(msg, chat));
    el.title.textContent = chat.title;
    scrollDown(true);
    await generate(chat);
  }

  async function generate(chat) {
    const aiMsg = { id: uid(), role: "model", text: "", ts: Date.now(), docMode };
    const contents = await buildContents(chat.messages);
    chat.messages.push(aiMsg);
    // pichle "last" ka regenerate button hatao
    $$(".msg.ai .actions button[title='Dobara likho']", el.messages).forEach((b) => b.remove());
    const node = buildMsgEl(aiMsg, chat);
    el.messages.appendChild(node);
    renderContent(node, aiMsg, true);
    scrollDown(true);

    const controller = new AbortController();
    streaming = { controller };
    setBusy(true);
    let raf = 0;
    const paint = () => { raf = 0; renderContent(node, aiMsg, true); scrollDown(); };
    try {
      const res = await fetch("/api/chat", {
        method: "POST", headers: headers(), signal: controller.signal,
        body: JSON.stringify({
          model: settings.model, contents, system: buildSystem(aiMsg),
          temperature: Number(settings.temperature), search: !!settings.search,
        }),
      });
      if (!res.ok) {
        let e = ""; try { e = (await res.json()).error; } catch {}
        if (res.status === 401) openSettings();
        throw new Error(e || "Error " + res.status);
      }
      aiMsg.model = res.headers.get("X-Model-Used") || "";
      await readStream(res, (d) => { aiMsg.text += d; if (!raf) raf = requestAnimationFrame(paint); }, (meta) => {
        if (meta.sources) aiMsg.sources = meta.sources;
        if (meta.block) aiMsg.error = meta.block;
        if (meta.finish && meta.finish !== "STOP" && meta.finish !== "MAX_TOKENS" && !aiMsg.text) aiMsg.error = "Jawab roka gaya (" + meta.finish + "). Sawal thoda badal ke poochho.";
      });
      if (!aiMsg.text.trim() && !aiMsg.error) aiMsg.error = "Jawab khali aaya. Dobara koshish karo (🔄).";
    } catch (e) {
      if (e.name !== "AbortError") aiMsg.error = e.message || "Kuch gadbad hui";
    } finally {
      if (raf) cancelAnimationFrame(raf);
      streaming = null; setBusy(false);
    }
    // memory tags nikalo
    const found = [];
    aiMsg.text = aiMsg.text.replace(/<memory>([\s\S]*?)<\/memory>/gi, (m, t) => { found.push(t.trim()); return ""; }).replace(/<memory>[\s\S]*$/i, "").trim();
    if (found.length && settings.autoLearn) addMemory(found);
    chat.updated = Date.now();
    saveChatsNow();
    const fresh = buildMsgEl(aiMsg, chat);
    node.replaceWith(fresh);
    el.badge.textContent = aiMsg.model || "";
    renderChatList(); scrollDown();
    if (aiMsg.text && !aiMsg.error && (settings.autoSpeak || settings.handsFree)) speak(aiMsg.text, $(".speak", fresh));
    else if (settings.handsFree && aiMsg.error) { /* error me mic mat kholo */ }
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
    if (m && m.files) m.files.forEach((f) => { idb.del(f.id); fileCache.delete(f.id); });
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
    await generate(chat);
  }

  /* =====================  MEMORY / SEEKHNA  ===================== */
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

  /* =====================  VOICE: MIC + SPEAK  ===================== */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  function startMic() {
    if (!SR) { toast("Is browser me mic support nahi hai. Chrome use karo."); return; }
    if (listening) { try { rec.stop(); } catch {} return; }
    if (streaming) return;
    stopSpeak();
    rec = new SR();
    rec.lang = settings.micLang; rec.interimResults = true; rec.continuous = false;
    const base = el.input.value.trim() ? el.input.value.trim() + " " : "";
    let finalText = "", heard = false;
    rec.onresult = (e) => {
      let interim = ""; finalText = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      heard = true;
      el.input.value = base + finalText + interim; autosize();
    };
    rec.onend = () => {
      listening = false; el.micBtn.classList.remove("on");
      if (heard && (finalText.trim() || el.input.value.trim()) && (settings.voiceAutoSend || settings.handsFree)) send();
    };
    rec.onerror = (e) => {
      listening = false; el.micBtn.classList.remove("on");
      if (e.error === "not-allowed" || e.error === "service-not-allowed") toast("Mic ki permission do (browser settings me).");
      else if (e.error === "network") toast("Mic ke liye internet chahiye.");
      else if (e.error !== "no-speech" && e.error !== "aborted") toast("Mic error: " + e.error);
    };
    try { rec.start(); listening = true; el.micBtn.classList.add("on"); } catch { toast("Mic shuru nahi hua, dobara dabao."); }
  }

  let speaking = false;
  function pickVoice(lang) {
    const vs = speechSynthesis.getVoices();
    return vs.find((v) => v.lang === lang) || vs.find((v) => v.lang.replace("_", "-").startsWith(lang.slice(0, 2))) || null;
  }
  function chunkText(t) {
    const parts = t.match(/[^.!?।\n]+[.!?।]?/g) || [t];
    const out = []; let cur = "";
    for (const p of parts) {
      if ((cur + p).length > 170) { if (cur) out.push(cur); cur = p; } else cur += p;
    }
    if (cur.trim()) out.push(cur);
    return out.map((s) => s.trim()).filter(Boolean);
  }
  function stopSpeak() {
    speaking = false;
    try { speechSynthesis.cancel(); } catch {}
    $$(".speak.on").forEach((b) => { b.classList.remove("on"); b.textContent = "🔊"; });
  }
  function speak(text, btn) {
    if (!("speechSynthesis" in window)) { toast("Is browser me bolne ka support nahi."); return; }
    stopSpeak();
    const plain = mdToPlain(stripMemory(text));
    if (!plain) return;
    const lang = settings.ttsLang === "auto" ? (/[ऀ-ॿ]/.test(plain) ? "hi-IN" : "en-IN") : settings.ttsLang;
    const chunks = chunkText(plain);
    let i = 0; speaking = true;
    if (btn) { btn.classList.add("on"); btn.textContent = "⏹️"; }
    const finish = () => {
      const was = speaking; speaking = false;
      if (btn) { btn.classList.remove("on"); btn.textContent = "🔊"; }
      if (was && settings.handsFree) setTimeout(startMic, 350);
    };
    const next = () => {
      if (!speaking) return;
      if (i >= chunks.length) return finish();
      const u = new SpeechSynthesisUtterance(chunks[i++]);
      u.lang = lang; u.rate = Number(settings.rate) || 1;
      const v = pickVoice(lang); if (v) u.voice = v;
      u.onend = next; u.onerror = () => { if (speaking) next(); };
      speechSynthesis.speak(u);
    };
    setTimeout(next, 80);
  }
  function toggleSpeak(m, btn) {
    if (speaking && btn.classList.contains("on")) { stopSpeak(); return; }
    speak(m.text, btn);
  }

  /* =====================  FILES  ===================== */
  function classify(mime, name) {
    const n = name.toLowerCase();
    if (mime === "application/pdf" || n.endsWith(".pdf")) return "pdf";
    if (mime.startsWith("image/") && !mime.includes("svg")) return "image";
    if (mime.startsWith("audio/")) return "audio";
    if (mime.startsWith("video/")) return "video";
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
    const rec = { id: uid(), name: f.name, mime: mime || "application/octet-stream", kind, size: f.size };
    if (kind === "text") rec.text = await f.text();
    else if (kind === "image") { const r = await downscale(f); rec.data = r.data; rec.mime = r.mime; }
    else { rec.data = await toB64(f); if (kind === "pdf") rec.mime = "application/pdf"; }
    pending.push(rec); renderPending();
  }
  const QUICK = [
    ["✨ Saaransh", "Is file ka saaransh (summary) do: pehle 3-4 line me mukhya baat, phir zaroori points bullets me."],
    ["📝 Notes", "Is file se saaf, padhne layak notes banao: headings, bullets, important terms, aur end me 5 quick revision sawal."],
    ["❓ Sawal-Jawab", "Is file se 10 important sawal-jawab banao (exam/interview style)."],
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
    if (pending.length) QUICK.forEach(([l, p]) => {
      const b = document.createElement("button"); b.textContent = l; b.onclick = () => send(p); el.quick.appendChild(b);
    });
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
      renderMarkdown(text) + "<div class='foot'>Mera AI · " + new Date().toLocaleDateString("en-IN", { dateStyle: "long" }) + "</div></body></html>";
  }
  function docTitleFrom(html) {
    const m = html.match(/<title>([\s\S]*?)<\/title>/i) || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    return m ? m[1].replace(/<[^>]+>/g, "").trim().slice(0, 60) || "Document" : "Document";
  }
  let currentDoc = { html: "", title: "" };
  function openDoc(html, title) {
    currentDoc = { html, title: title || "Document" };
    $("#docTitle").textContent = currentDoc.title;
    $("#docFrame").srcdoc = html;
    $("#docModal").hidden = false;
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

  /* =====================  SETTINGS  ===================== */
  async function openSettings() {
    $("#sKey").value = settings.apiKey; $("#sCode").value = settings.accessCode;
    $("#sTemp").value = settings.temperature; $("#sTempV").textContent = settings.temperature;
    $("#sPersona").value = settings.persona; $("#sMicLang").value = settings.micLang; $("#sTtsLang").value = settings.ttsLang;
    $("#sRate").value = settings.rate; $("#sRateV").textContent = settings.rate;
    $("#sTheme").value = settings.theme; $("#sFont").value = settings.font;
    $("#sVoiceSend").checked = settings.voiceAutoSend; $("#sAutoLearn").checked = settings.autoLearn; $("#sSearch").checked = settings.search;
    $("#sTestOut").textContent = "";
    fillModels(settings.model, []);
    $("#settingsModal").hidden = false;
    loadModels();
  }
  function fillModels(selected, list) {
    const s = $("#sModel");
    s.innerHTML = '<option value="auto">Auto (sabse achha, khud badalta hai)</option>';
    const all = [...new Set(list)];
    if (selected !== "auto" && !all.includes(selected)) all.unshift(selected);
    all.forEach((m) => { const o = document.createElement("option"); o.value = m; o.textContent = m; s.appendChild(o); });
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
    settings.apiKey = $("#sKey").value.trim(); settings.accessCode = $("#sCode").value.trim();
    settings.model = $("#sModel").value; settings.temperature = Number($("#sTemp").value);
    settings.persona = $("#sPersona").value; settings.micLang = $("#sMicLang").value; settings.ttsLang = $("#sTtsLang").value;
    settings.rate = Number($("#sRate").value); settings.theme = $("#sTheme").value; settings.font = $("#sFont").value;
    settings.voiceAutoSend = $("#sVoiceSend").checked; settings.autoLearn = $("#sAutoLearn").checked; settings.search = $("#sSearch").checked;
    saveSettings(); applyTheme(); renderTools(); checkBanner();
  }

  /* =====================  TOOLS ROW  ===================== */
  const LANGS = [["hi-IN", "हि"], ["en-IN", "EN"], ["en-US", "US"]];
  function renderTools() {
    el.tDoc.classList.toggle("on", docMode);
    el.tSearch.classList.toggle("on", !!settings.search);
    el.tSpeak.classList.toggle("on", !!settings.autoSpeak);
    el.tHands.classList.toggle("on", !!settings.handsFree);
    const l = LANGS.find((x) => x[0] === settings.micLang);
    el.tLang.textContent = "🎤 " + (l ? l[1] : settings.micLang.slice(0, 2).toUpperCase());
    el.input.placeholder = docMode ? "Batao kaisa document/PDF chahiye (style, rang, content)…" : "Kuch bhi poochho…";
  }
  function checkBanner() {
    let msg = "";
    if (!serverCfg.serverKey && !settings.apiKey) msg = "⚠️ API key nahi hai. Yahan tap karke apni free Gemini key daalo.";
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
    const s = { ...settings }; delete s.apiKey; delete s.accessCode;
    download("mera-ai-backup-" + new Date().toISOString().slice(0, 10) + ".json", JSON.stringify({ v: 1, chats, memory, settings: s }), "application/json");
    toast("Backup download ho gaya (files/photo shamil nahi).");
  }
  async function restore(file) {
    try {
      const j = JSON.parse(await file.text());
      if (!Array.isArray(j.chats)) throw new Error("bad");
      const ids = new Set(chats.map((c) => c.id));
      j.chats.forEach((c) => { if (!ids.has(c.id)) chats.push(c); });
      (j.memory || []).forEach((t) => { if (!memory.includes(t)) memory.push(t); });
      if (j.settings) settings = { ...settings, ...j.settings, apiKey: settings.apiKey, accessCode: settings.accessCode };
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
    ["📄 Resume PDF", "Mera ek professional resume banao. Style: modern, neela rang, 1 page.", true],
    ["📝 Notes banao", "Photosynthesis par saaf notes banao, end me 5 revision sawal."],
    ["💻 Code likho", "Python me ek simple todo list app likho aur samjhao."],
    ["✍️ Kahani", "Ek chhoti prernadayak kahani Hindi me sunao."],
    ["📅 Din ka plan", "Mere din ka ek productive plan banao: subah 6 se raat 10 tak."],
    ["🌐 Anuvaad", "Is line ko English me badlo: 'Kal hum sab milkar kaam karenge.'"],
  ];
  function renderSuggest() {
    SUGGEST.forEach(([t, p, doc]) => {
      const b = document.createElement("button");
      const [h, ...rest] = t.split(" ");
      b.innerHTML = "<b>" + esc(t) + "</b><span>" + esc(p.slice(0, 60)) + "…</span>";
      b.onclick = () => { if (doc) { docMode = true; renderTools(); } el.input.value = p; autosize(); el.input.focus(); };
      el.suggest.appendChild(b);
    });
  }

  /* =====================  EVENTS  ===================== */
  function bind() {
    $("#newChat").onclick = startNew; $("#newChat2").onclick = startNew;
    $("#menuBtn").onclick = openSide; $("#scrim").onclick = closeSide;
    el.search.oninput = renderChatList;
    el.sendBtn.onclick = () => send(); el.stopBtn.onclick = stopGen; el.micBtn.onclick = startMic;
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

    el.tDoc.onclick = () => { docMode = !docMode; renderTools(); toast(docMode ? "PDF mode chalu: jaisa bologe waisa document banega" : "PDF mode band"); };
    el.tSearch.onclick = () => { settings.search = !settings.search; saveSettings(); renderTools(); toast(settings.search ? "Web search chalu (free plan me na chale to apne aap band)" : "Web search band"); };
    el.tLang.onclick = () => {
      const i = LANGS.findIndex((x) => x[0] === settings.micLang);
      settings.micLang = LANGS[(i + 1) % LANGS.length][0]; saveSettings(); renderTools();
    };
    el.tSpeak.onclick = () => { settings.autoSpeak = !settings.autoSpeak; saveSettings(); renderTools(); if (!settings.autoSpeak) stopSpeak(); };
    el.tHands.onclick = () => {
      settings.handsFree = !settings.handsFree; saveSettings(); renderTools();
      if (settings.handsFree) { toast("Hands-free: mic dabao, bolo, jawab suno, phir bolo"); startMic(); } else { stopSpeak(); if (listening) try { rec.stop(); } catch {} }
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
    $("#openMemory").onclick = () => { closeSide(); renderMemory(); $("#memoryModal").hidden = false; };
    $("#memAdd").onclick = () => { const v = $("#memNew").value.trim(); if (v) { addMemory([v]); $("#memNew").value = ""; renderMemory(); } };
    $("#memNew").addEventListener("keydown", (e) => { if (e.key === "Enter") $("#memAdd").click(); });
    $("#sTemp").oninput = (e) => ($("#sTempV").textContent = e.target.value);
    $("#sRate").oninput = (e) => ($("#sRateV").textContent = e.target.value);
    $("#sSave").onclick = () => { saveFromForm(); $("#settingsModal").hidden = true; toast("Save ho gaya ✅"); };
    $("#sTest").onclick = async () => {
      saveFromForm();
      const out = $("#sTestOut"); out.textContent = "Test ho raha hai…";
      const { ok, j } = await loadModels();
      out.textContent = ok ? "✅ Sab theek hai. " + j.models.length + " models mile." + (j.flash && j.flash[0] ? " Auto model: " + j.flash[0] : "") : "❌ " + (j.error || "Nahi chala");
    };
    $("#sClear").onclick = () => {
      if (!confirm("Saari chats, memory aur settings mit jayengi. Pakka?")) return;
      localStorage.clear();
      try { indexedDB.deleteDatabase("mera-ai"); } catch {}
      location.reload();
    };
    $$("[data-close]").forEach((b) => (b.onclick = () => (b.closest(".modal").hidden = true)));
    $$(".modal").forEach((m) => m.addEventListener("click", (e) => { if (e.target === m) m.hidden = true; }));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") $$(".modal").forEach((m) => (m.hidden = true)); });

    $("#docPdf").onclick = printDoc;
    $("#docHtml").onclick = () => download(safeName(currentDoc.title) + ".html", currentDoc.html, "text/html");
    $("#docDoc").onclick = () => download(safeName(currentDoc.title) + ".doc", currentDoc.html, "application/msword");

    $("#exportChat").onclick = exportChatMd; $("#backup").onclick = backup;
    $("#restore").onclick = () => $("#restoreFile").click();
    $("#restoreFile").onchange = (e) => { if (e.target.files[0]) restore(e.target.files[0]); e.target.value = ""; };
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", applyTheme);
    if ("speechSynthesis" in window) speechSynthesis.onvoiceschanged = () => {};
  }

  /* =====================  START  ===================== */
  async function init() {
    applyTheme(); bind(); renderSuggest();
    if (currentId && !currentChat()) currentId = chats[0] ? chats[0].id : null;
    renderAll(); renderPending();
    try { serverCfg = await (await fetch("/api/config")).json(); } catch {}
    checkBanner();
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  init();
})();
