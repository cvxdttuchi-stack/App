// Veda AI — PDF Editor (alag, advanced). Sab kuch phone/browser me hi chalta hai, internet/API ke bina.
// Kya kar sakte ho: PDF ka maujooda text badlo/hatao, naya text likho (Hindi bhi), pen se draw/sign,
// highlight, safed patti (mitao), image/signature lagao, page ghumao/hatao/order badlo/khali page jodo, undo/redo, save.
(() => {
  "use strict";
  const A = window.VedaApp;
  if (!A) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const FONT = "'Noto Sans Devanagari','Mukta',system-ui,sans-serif";
  const A4 = [595.28, 841.89];

  /* ---------------- DOM ---------------- */
  const modal = document.createElement("div");
  modal.id = "pdfEditModal"; modal.className = "modal"; modal.hidden = true;
  modal.innerHTML = `
  <div class="sheet tall" style="position:relative">
    <div class="sheet-head"><h2>✏️ PDF Editor</h2><div class="pdf-tools-top"><button class="icon-btn close" id="peClose" aria-label="Band karo">✕</button></div></div>
    <div class="pe-bar">
      <label class="btn primary" for="peFile">📂 PDF kholo</label><input type="file" id="peFile" accept="application/pdf,.pdf" hidden>
      <span class="small-note" id="peName" style="flex:1;min-width:80px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Koi PDF nahi kholi.</span>
      <button class="btn ghost" id="peUndo" title="Undo">↩️</button>
      <button class="btn ghost" id="peRedo" title="Redo">↪️</button>
      <button class="btn primary" id="peSave">💾 Save</button>
    </div>
    <div class="pe-bar" id="peTools"></div>
    <div class="pe-bar" id="peOpts">
      <input type="color" id="peColor" value="#111111" title="Rang">
      <label class="small-note">Akshar <input type="range" id="peFs" min="8" max="72" value="16"><b id="peFsV">16</b></label>
      <label class="small-note">Pen <input type="range" id="peLw" min="1" max="14" value="3"><b id="peLwV">3</b></label>
      <span class="sep"></span>
      <button class="chip" id="peDelAnn" hidden>🗑 Ye hatao</button>
    </div>
    <div class="pe-bar" id="pePages">
      <button class="btn ghost" id="pePrev" title="Pichhla page">◀</button>
      <span class="small-note" id="peCur">–</span>
      <button class="btn ghost" id="peNext" title="Agla page">▶</button>
      <span class="sep"></span>
      <button class="btn ghost" id="peRot" title="Is page ko ghumao">⟳ Ghumao</button>
      <button class="btn ghost" id="peDelPg" title="Is page ko hatao">🗑 Page</button>
      <button class="btn ghost" id="peUp" title="Page upar">↑</button>
      <button class="btn ghost" id="peDn" title="Page neeche">↓</button>
      <button class="btn ghost" id="peBlank" title="Iske baad khali page jodo">＋ Khali</button>
      <span class="sep"></span>
      <button class="btn ghost" id="peZo" title="Zoom out">−</button>
      <span class="small-note" id="peZoom">100%</span>
      <button class="btn ghost" id="peZi" title="Zoom in">＋</button>
    </div>
    <div class="pe-stage" id="peStage"><div class="small-note" style="max-width:420px;text-align:center;line-height:1.6;margin:auto">📂 <b>PDF kholo</b> dabao.<br>Phir upar se tool chuno:<br>✎ <b>Text badlo</b> — PDF ke kisi bhi likhe hue shabd par tap karo aur badal do.<br>🅣 <b>Text likho</b> — kahin bhi naya text (Hindi bhi).<br>🖊️ draw/sign · 🖍️ highlight · ⬜ mitao · 🖼️ image.</div></div>
    <div class="pe-status" id="peStatus"></div>
    <div id="peOut" style="padding:0 12px 10px"></div>
    <div class="pe-ask" id="peAsk" hidden>
      <div class="pe-ask-box">
        <h3 id="peAskT" style="margin:0 0 8px;font-size:1em"></h3>
        <div class="input-row"><textarea id="peAskIn" rows="3" placeholder="Yahan likho…" style="flex:1"></textarea>
          <button id="peAskMic" class="round mic" title="Bolkar likho" type="button"><svg class="gm"><use href="#gmic"/></svg></button></div>
        <div class="row-btns" style="margin-top:10px"><button class="btn primary" id="peAskOk">OK</button><button class="btn ghost" id="peAskNo">Raddh</button></div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);

  /* ---------------- state ---------------- */
  const S = {
    name: "", bytes: null, pdfjs: null, proxies: [], meta: [], // meta[src] = {W,H,base,vp0,items|null}
    pages: [], zoom: 1, tool: "move", cur: 0, sel: null, undo: [], redo: [],
    imgs: new Map(), pendingImg: null, sizes: { fs: 16, lw: 3 },
  };
  const status = (t, bad) => { const e = $("#peStatus"); e.textContent = t || ""; e.style.color = bad ? "#ff7b8a" : ""; };

  /* ---------------- libs ---------------- */
  const loadScript = (src) => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("PDF engine load nahi hua. Internet check karo.")); document.head.appendChild(s); });
  async function loadPdfJs() {
    if (!window.pdfjsLib) await loadScript("pdf.min.js");
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
    return window.pdfjsLib;
  }
  async function loadPdfLib() { if (!window.PDFLib) await loadScript("pdf-lib.min.js"); return window.PDFLib; }

  /* ---------------- geometry ---------------- */
  const dims = (p) => (p.src >= 0 ? S.meta[p.src] : { W: p.W, H: p.H, base: 0, vp0: null });
  const viewDims = (p) => { const d = dims(p); return p.rot % 180 ? { w: d.H, h: d.W } : { w: d.W, h: d.H }; };
  function rotMatrix(rot, W, H, sc) {
    if (rot === 90) return [0, sc, -sc, 0, H * sc, 0];
    if (rot === 180) return [-sc, 0, 0, -sc, W * sc, H * sc];
    if (rot === 270) return [0, -sc, sc, 0, 0, W * sc];
    return [sc, 0, 0, sc, 0, 0];
  }
  function fromView(p, X, Y) { // view-pt -> page-pt (page ka seedha roop)
    const d = dims(p);
    if (p.rot === 90) return [Y, d.H - X];
    if (p.rot === 180) return [d.W - X, d.H - Y];
    if (p.rot === 270) return [d.W - Y, X];
    return [X, Y];
  }
  function toView(p, x, y) {
    const d = dims(p);
    if (p.rot === 90) return [d.H - y, x];
    if (p.rot === 180) return [d.W - x, d.H - y];
    if (p.rot === 270) return [y, d.W - x];
    return [x, y];
  }

  /* ---------------- annotations ---------------- */
  const mctx = document.createElement("canvas").getContext("2d");
  function measureText(a) {
    mctx.font = `${a.size}px ${FONT}`;
    const lines = String(a.txt).split("\n");
    a.w = Math.max(4, ...lines.map((l) => mctx.measureText(l).width));
    a.h = lines.length * a.size * 1.25;
  }
  function bbox(a) {
    if (a.t === "pen") {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const [x, y] of a.pts) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      const pad = a.w / 2 + 2; return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
    }
    return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
  function drawAnnots(ctx, annots, sc, rot, W, H, sel) {
    ctx.save();
    ctx.setTransform(...rotMatrix(rot, W, H, sc));
    for (const a of annots) {
      if (a.t === "rect") {
        ctx.globalAlpha = a.kind === "hl" ? 0.4 : 1;
        ctx.fillStyle = a.c; ctx.fillRect(a.x, a.y, a.w, a.h); ctx.globalAlpha = 1;
      } else if (a.t === "pen") {
        ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = a.c; ctx.lineWidth = a.w; ctx.fillStyle = a.c;
        if (a.pts.length === 1) { ctx.beginPath(); ctx.arc(a.pts[0][0], a.pts[0][1], a.w / 2, 0, 7); ctx.fill(); }
        else { ctx.beginPath(); a.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
      } else if (a.t === "text") {
        ctx.font = `${a.size}px ${FONT}`; ctx.fillStyle = a.c; ctx.textBaseline = "top";
        String(a.txt).split("\n").forEach((l, i) => ctx.fillText(l, a.x, a.y + i * a.size * 1.25 + a.size * 0.08));
      } else if (a.t === "img") {
        const im = S.imgs.get(a.id); if (im && im.el) ctx.drawImage(im.el, a.x, a.y, a.w, a.h);
      }
    }
    if (sel) {
      const b = bbox(sel);
      ctx.setLineDash([5 / sc * 1.5, 4 / sc * 1.5]); ctx.lineWidth = 1.5 / sc * 1.5; ctx.strokeStyle = "#2f7bff";
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    }
    ctx.restore();
  }

  /* ---------------- undo / redo ---------------- */
  const snapNow = () => JSON.stringify(S.pages);
  function snap() { S.undo.push(snapNow()); if (S.undo.length > 40) S.undo.shift(); S.redo = []; refreshBtns(); }
  function restore(js) { S.pages = JSON.parse(js); S.sel = null; if (S.cur >= S.pages.length) S.cur = Math.max(0, S.pages.length - 1); layout(); }
  function undo() { if (!S.undo.length) return; S.redo.push(snapNow()); restore(S.undo.pop()); refreshBtns(); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapNow()); restore(S.redo.pop()); refreshBtns(); }
  function refreshBtns() {
    $("#peUndo").disabled = !S.undo.length; $("#peRedo").disabled = !S.redo.length;
    $("#peDelAnn").hidden = !S.sel;
  }

  /* ---------------- tools UI ---------------- */
  const TOOLS = [
    ["move", "✋ Chuno / Hilao"], ["edit", "✎ Text badlo"], ["text", "🅣 Text likho"], ["pen", "🖊️ Draw / Sign"],
    ["hl", "🖍️ Highlight"], ["white", "⬜ Mitao"], ["img", "🖼️ Image"],
  ];
  $("#peTools").innerHTML = TOOLS.map(([k, l]) => `<button class="chip" data-pt="${k}">${l}</button>`).join("");
  const TIPS = {
    move: "Kisi likhe/draw ko tap karke chuno, phir ghasito (ya 🗑 se hatao). Scroll normal chalta hai.",
    edit: "PDF ke kisi shabd/line par tap karo — text badal sakte ho ya khali karke hata sakte ho.",
    text: "Jahan likhna hai wahan tap karo, text likho (Hindi bhi, 🎤 se bol bhi sakte ho).",
    pen: "Ungli/mouse se draw ya sign karo. Scroll ke liye ◀ ▶ ya zoom − use karo.",
    hl: "Jis hisse ko highlight karna hai uspar ghasito.",
    white: "Jo hissa mitana hai uspar ghasito — aas-paas ke rang se dhak dega.",
    img: "Pehle image chuno, phir page par jahan lagani hai wahan tap karo.",
  };
  function setTool(t) {
    S.tool = t; S.sel = null;
    $$("[data-pt]").forEach((b) => b.classList.toggle("on", b.dataset.pt === t));
    const touch = t === "pen" || t === "hl" || t === "white" ? "none" : "pan-y pinch-zoom";
    $$(".pe-page").forEach((b) => (b.style.touchAction = touch));
    status(TIPS[t] || "");
    if (t === "img") pickImage();
    redrawAll(); refreshBtns();
  }
  $$("[data-pt]").forEach((b) => (b.onclick = () => setTool(b.dataset.pt)));
  $("#peColor").oninput = () => { if (S.sel && (S.sel.t === "text" || S.sel.t === "pen")) { snap(); S.sel.c = $("#peColor").value; redrawAll(); } };
  $("#peFs").oninput = () => { S.sizes.fs = +$("#peFs").value; $("#peFsV").textContent = S.sizes.fs; if (S.sel && S.sel.t === "text") { S.sel.size = S.sizes.fs; measureText(S.sel); redrawAll(); } };
  $("#peLw").oninput = () => { S.sizes.lw = +$("#peLw").value; $("#peLwV").textContent = S.sizes.lw; };

  /* ---------------- ask dialog ---------------- */
  let askRes = null;
  function askText(title, init) {
    return new Promise((res) => {
      askRes = res;
      $("#peAskT").textContent = title; const t = $("#peAskIn"); t.value = init || "";
      $("#peAsk").hidden = false; setTimeout(() => { t.focus(); t.select(); }, 50);
    });
  }
  const closeAsk = (v) => { $("#peAsk").hidden = true; const r = askRes; askRes = null; if (r) r(v); };
  $("#peAskOk").onclick = () => closeAsk($("#peAskIn").value);
  $("#peAskNo").onclick = () => closeAsk(null);
  $("#peAskMic").onclick = () => { try { A.mic($("#peAskIn"), $("#peAskMic")); } catch { A.toast("Mic abhi nahi chal raha."); } };

  /* ---------------- open PDF ---------------- */
  $("#peFile").onchange = async (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) await openFile(f); };
  async function openFile(file) {
    try {
      status("⏳ PDF khul rahi hai…");
      const lib = await loadPdfJs();
      const bytes = new Uint8Array(await file.arrayBuffer());
      let doc;
      try { doc = await lib.getDocument({ data: bytes.slice() }).promise; }
      catch (e) { if (e && e.name === "PasswordException") throw new Error("Ye PDF password se locked hai. Pehle password hatao, phir kholo."); throw e; }
      if (doc.numPages > 300) throw new Error("PDF me " + doc.numPages + " page hain — editor 300 pages tak chalta hai. Pehle Tools me 'Pages' se hissa nikalo.");
      S.proxies = []; S.meta = [];
      for (let i = 1; i <= doc.numPages; i++) {
        status("⏳ Page " + i + "/" + doc.numPages + " taiyar ho raha hai…");
        const pg = await doc.getPage(i); const vp0 = pg.getViewport({ scale: 1 });
        S.proxies.push(pg); S.meta.push({ W: vp0.width, H: vp0.height, base: pg.rotate || 0, vp0, items: null });
      }
      S.pdfjs = doc; S.bytes = bytes; S.name = (file.name || "document.pdf").replace(/\.pdf$/i, "");
      S.pages = S.meta.map((_, i) => ({ src: i, rot: 0, annots: [] }));
      S.undo = []; S.redo = []; S.sel = null; S.cur = 0;
      $("#peName").textContent = file.name + " · " + doc.numPages + " page · " + kb(bytes.length);
      $("#peOut").innerHTML = "";
      layout(); setTool("edit"); refreshBtns();
    } catch (e) { status("⚠️ " + (e.message || e), true); }
  }

  /* ---------------- layout + lazy render ---------------- */
  let io = null, layoutGen = 0;
  function layout() {
    const stage = $("#peStage"); const keepTop = stage.scrollTop;
    layoutGen++;
    if (io) io.disconnect();
    stage.innerHTML = "";
    if (!S.pages.length) { stage.innerHTML = '<div class="small-note" style="margin:auto">Koi page nahi bacha.</div>'; $("#peCur").textContent = "–"; return; }
    const avail = Math.max(220, stage.clientWidth - 28);
    io = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) { const i = +en.target.dataset.i; renderPage(i, layoutGen); } });
      // sabse upar dikhne wala page = "current"
      const vis = ents.filter((x) => x.isIntersecting).map((x) => +x.target.dataset.i).sort((a, b) => a - b);
      if (vis.length && !scrollingTo) { S.cur = vis[0]; updCur(); }
    }, { root: stage, rootMargin: "500px 0px 500px 0px", threshold: [0, 0.05] });
    S.pages.forEach((p, i) => {
      const v = viewDims(p); p.s = (avail / v.w) * S.zoom;
      const box = document.createElement("div"); box.className = "pe-page"; box.dataset.i = i;
      box.style.width = v.w * p.s + "px"; box.style.height = v.h * p.s + "px";
      box.style.touchAction = S.tool === "pen" || S.tool === "hl" || S.tool === "white" ? "none" : "pan-y pinch-zoom";
      const tag = document.createElement("div"); tag.className = "pe-tag"; tag.textContent = i + 1; box.appendChild(tag);
      stage.appendChild(box); io.observe(box); bindPage(box, i);
    });
    stage.scrollTop = keepTop;
    $("#peZoom").textContent = Math.round(S.zoom * 100) + "%";
    updCur();
  }
  const updCur = () => { $("#peCur").textContent = S.pages.length ? "Page " + (S.cur + 1) + " / " + S.pages.length : "–"; };
  const dpr = () => Math.min(2, window.devicePixelRatio || 1);
  async function renderPage(i, gen) {
    const p = S.pages[i]; const box = $(`.pe-page[data-i="${i}"]`); if (!p || !box || box.dataset.r === "1") return;
    box.dataset.r = "1";
    const v = viewDims(p), d = dims(p), k = dpr();
    const base = document.createElement("canvas"); base.width = Math.ceil(v.w * p.s * k); base.height = Math.ceil(v.h * p.s * k);
    base.style.width = "100%"; base.style.height = "100%";
    const bctx = base.getContext("2d"); bctx.fillStyle = "#fff"; bctx.fillRect(0, 0, base.width, base.height);
    const ov = document.createElement("canvas"); ov.className = "ov"; ov.width = base.width; ov.height = base.height; ov.style.width = "100%"; ov.style.height = "100%";
    box.prepend(base); box.insertBefore(ov, box.querySelector(".pe-tag"));
    box.dataset.r = "1";
    if (p.src >= 0) {
      try {
        const vp = S.proxies[p.src].getViewport({ scale: p.s * k, rotation: (d.base + p.rot) % 360 });
        await S.proxies[p.src].render({ canvasContext: bctx, viewport: vp }).promise;
      } catch (e) { /* purana layout ho gaya */ }
    }
    if (gen !== layoutGen) return;
    redrawOverlay(i);
  }
  function redrawOverlay(i) {
    const p = S.pages[i]; const box = $(`.pe-page[data-i="${i}"]`); if (!p || !box) return;
    const ov = box.querySelector("canvas.ov"); if (!ov) return;
    const d = dims(p), k = dpr(); const c = ov.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ov.width, ov.height);
    drawAnnots(c, p.annots, p.s * k, p.rot, d.W, d.H, S.sel && S.selPage === i ? S.sel : null);
  }
  const redrawAll = () => S.pages.forEach((_, i) => redrawOverlay(i));

  /* ---------------- text items (existing text par tap-edit) ---------------- */
  async function getItems(srcIdx) {
    const m = S.meta[srcIdx]; if (m.items) return m.items;
    const lib = window.pdfjsLib; const pg = S.proxies[srcIdx];
    const tc = await pg.getTextContent(); const out = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) { if (it.str && out.length) out[out.length - 1].gap = true; continue; }
      const tr = lib.Util.transform(m.vp0.transform, it.transform);
      const fs = Math.hypot(tr[2], tr[3]) || Math.abs(it.height) || 10;
      if (Math.abs(tr[1]) + Math.abs(tr[2]) > fs * 0.6) continue; // tirchha/khada text chhodo
      out.push({ str: it.str, x: tr[4], base: tr[5], fs, w: it.width || fs * it.str.length * 0.5 });
    }
    // paas-paas ke tukde ek line me jodo
    const lines = [];
    for (const it of out) {
      const l = lines[lines.length - 1];
      if (l && Math.abs(l.base - it.base) < it.fs * 0.3 && it.x - (l.x + l.w) > -it.fs * 0.4 && it.x - (l.x + l.w) < it.fs * 0.9 && Math.abs(l.fs - it.fs) < it.fs * 0.35) {
        const gap = it.x - (l.x + l.w);
        l.str += (gap > it.fs * 0.18 && !/^\s/.test(it.str) && !/\s$/.test(l.str) ? " " : "") + it.str;
        l.w = it.x + it.w - l.x;
      } else lines.push({ ...it });
    }
    m.items = lines.map((l) => ({ str: l.str, x: l.x, y: l.base - l.fs * 0.95, w: l.w, h: l.fs * 1.25, fs: l.fs }));
    return m.items;
  }
  function coverColor(p, x, y, w, h) {
    try {
      const box = $(`.pe-page[data-i="${S.pages.indexOf(p)}"]`); const cv = box && box.querySelector("canvas"); if (!cv) return "#ffffff";
      const k = dpr() * p.s, ctx = cv.getContext("2d");
      const pts = [[x - 1.5, y - 1.5], [x + w + 1.5, y - 1.5], [x - 1.5, y + h + 1.5], [x + w + 1.5, y + h + 1.5]];
      let r = 0, g = 0, b = 0, n = 0;
      for (const [px, py] of pts) {
        const [vx, vy] = toView(p, px, py); const X = Math.round(vx * k), Y = Math.round(vy * k);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) continue;
        const dta = ctx.getImageData(X, Y, 1, 1).data; r += dta[0]; g += dta[1]; b += dta[2]; n++;
      }
      if (!n) return "#ffffff";
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      if (r >= 232 && g >= 232 && b >= 232) return "#ffffff"; // lagbhag safed background -> poora safed (kinare na dikhen)
      return "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    } catch { return "#ffffff"; }
  }

  /* ---------------- pointer handling ---------------- */
  function bindPage(box, i) {
    let drag = null;
    const pos = (e) => {
      const p = S.pages[i]; const r = box.getBoundingClientRect(); const v = viewDims(p);
      return fromView(p, ((e.clientX - r.left) / r.width) * v.w, ((e.clientY - r.top) / r.height) * v.h);
    };
    box.addEventListener("pointerdown", (e) => {
      if (!S.pages[i] || e.button > 0) return;
      const p = S.pages[i]; const [x, y] = pos(e); S.cur = i; updCur();
      const t = S.tool;
      drag = { x0: x, y0: y, cx: e.clientX, cy: e.clientY, moved: false, id: e.pointerId, a: null };
      if (t === "pen") {
        snap(); const a = { t: "pen", pts: [[x, y]], c: $("#peColor").value, w: S.sizes.lw }; p.annots.push(a); drag.a = a;
        box.setPointerCapture(e.pointerId); redrawOverlay(i); e.preventDefault();
      } else if (t === "hl" || t === "white") {
        snap(); const a = { t: "rect", kind: t === "hl" ? "hl" : "white", x, y, w: 0, h: 0, c: t === "hl" ? "#ffe600" : "#ffffff" }; p.annots.push(a); drag.a = a; drag.ox = x; drag.oy = y;
        box.setPointerCapture(e.pointerId); e.preventDefault();
      } else if (t === "move") {
        let hit = null;
        for (let k = p.annots.length - 1; k >= 0; k--) { const b = bbox(p.annots[k]); if (x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) { hit = p.annots[k]; break; } }
        const prev = S.sel; S.sel = hit; S.selPage = hit ? i : null;
        if (hit) {
          drag.a = hit; drag.snapped = false; box.style.touchAction = "none";
          if (hit.t === "text") { $("#peColor").value = hit.c; $("#peFs").value = hit.size; $("#peFsV").textContent = hit.size; }
          box.setPointerCapture(e.pointerId); e.preventDefault();
        } else box.style.touchAction = "pan-y pinch-zoom";
        redrawAll(); refreshBtns();
      }
    });
    box.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const p = S.pages[i]; if (!p) return;
      if (Math.abs(e.clientX - drag.cx) + Math.abs(e.clientY - drag.cy) > 8) drag.moved = true;
      const [x, y] = pos(e); const a = drag.a;
      if (!a) return;
      if (S.tool !== "move" && a.t === "pen") { a.pts.push([x, y]); redrawOverlay(i); }
      else if (S.tool !== "move" && a.t === "rect" && drag.ox !== undefined) { a.x = Math.min(drag.ox, x); a.y = Math.min(drag.oy, y); a.w = Math.abs(x - drag.ox); a.h = Math.abs(y - drag.oy); redrawOverlay(i); }
      else if (S.tool === "move") {
        if (!drag.snapped && drag.moved) { drag.snapped = true; snap(); } // hilne se pehle ki halat undo me
        if (drag.moved) {
          const dx = x - drag.x0, dy = y - drag.y0; drag.x0 = x; drag.y0 = y;
          if (a.t === "pen") a.pts = a.pts.map(([px, py]) => [px + dx, py + dy]); else { a.x += dx; a.y += dy; }
          redrawOverlay(i);
        }
      }
    });
    const end = async (e) => {
      if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
      const d = drag; drag = null; const p = S.pages[i]; if (!p) return;
      try { box.releasePointerCapture(e.pointerId); } catch {}
      const t = S.tool, a = d.a;
      if (e.type === "pointercancel") { // scroll shuru ho gaya: adhoori cheez hatao
        if (a && (t === "pen" || t === "hl" || t === "white")) { p.annots.pop(); S.undo.pop(); refreshBtns(); redrawOverlay(i); }
        return;
      }
      if (t === "hl" || t === "white") {
        if (a.w < 3 || a.h < 3) { p.annots.pop(); S.undo.pop(); refreshBtns(); }
        else if (t === "white") a.c = coverColor(p, a.x, a.y, a.w, a.h);
        redrawOverlay(i);
      } else if (t === "pen") { redrawOverlay(i); }
      else if (t === "text" && !d.moved) {
        const v = await askText("Naya text likho", "");
        if (v && v.trim()) { snap(); const n = { t: "text", x: d.x0, y: d.y0, txt: v, size: S.sizes.fs, c: $("#peColor").value, w: 0, h: 0 }; measureText(n); p.annots.push(n); S.sel = n; S.selPage = i; redrawAll(); refreshBtns(); }
      } else if (t === "edit" && !d.moved) {
        if (p.src < 0) { status("Ye khali page hai — 🅣 Text likho use karo.", true); return; }
        const items = await getItems(p.src);
        const hit = items.find((it) => d.x0 >= it.x - 2 && d.x0 <= it.x + it.w + 2 && d.y0 >= it.y - 2 && d.y0 <= it.y + it.h + 2);
        if (!hit) { status("Yahan PDF ka text nahi mila (scan/photo ho sakta hai). 🅣 Text likho + ⬜ Mitao use karo.", true); return; }
        const v = await askText("Text badlo (khali chhodo = hata do)", hit.str);
        if (v === null || v === hit.str) return;
        snap();
        const pad = 1.2;
        p.annots.push({ t: "rect", kind: "white", x: hit.x - pad, y: hit.y - pad, w: hit.w + pad * 2, h: hit.h + pad * 2, c: coverColor(p, hit.x - pad, hit.y - pad, hit.w + pad * 2, hit.h + pad * 2) });
        if (v.trim()) { const n = { t: "text", x: hit.x, y: hit.y + hit.h * 0.0, txt: v, size: Math.max(6, hit.fs), c: $("#peColor").value, w: 0, h: 0 }; measureText(n); p.annots.push(n); }
        redrawOverlay(i); status("✅ Badal diya. Aur badlav ke liye dusre shabd par tap karo; ho jaye to 💾 Save.");
      } else if (t === "img" && !d.moved) {
        if (!S.pendingImg) { pickImage(); return; }
        const im = S.pendingImg; const d0 = dims(p);
        let w = Math.min(180, d0.W * 0.4), h = w * (im.h / im.w);
        snap(); const n = { t: "img", id: im.id, x: d.x0 - w / 2, y: d.y0 - h / 2, w, h }; p.annots.push(n); S.sel = n; S.selPage = i; redrawAll(); refreshBtns();
      } else if (t === "move") { refreshBtns(); }
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
  }
  /* ---------------- image pick ---------------- */
  function pickImage() {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const url = URL.createObjectURL(f);
        const el = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
        // bahut badi photo ko chhota karo (memory + PDF size)
        const sc = Math.min(1, 1600 / Math.max(el.naturalWidth, el.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.round(el.naturalWidth * sc); c.height = Math.round(el.naturalHeight * sc);
        c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
        const id = "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        S.imgs.set(id, { el: c, w: c.width, h: c.height }); S.pendingImg = { id, w: c.width, h: c.height };
        URL.revokeObjectURL(url);
        status("✅ Image taiyar. Ab page par jahan lagani hai wahan tap karo.");
      } catch { status("⚠️ Ye image khul nahi payi.", true); }
    };
    inp.click();
  }

  /* ---------------- delete selected annotation ---------------- */
  function delSel() {
    if (!S.sel) return; const p = S.pages[S.selPage]; if (!p) return;
    snap(); p.annots = p.annots.filter((a) => a !== S.sel); S.sel = null; redrawAll(); refreshBtns();
  }
  $("#peDelAnn").onclick = delSel;
  document.addEventListener("keydown", (e) => {
    if (modal.hidden || !$("#peAsk").hidden) return;
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel && !/INPUT|TEXTAREA/.test((document.activeElement || {}).tagName || "")) { e.preventDefault(); delSel(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  });

  /* ---------------- page operations ---------------- */
  let scrollingTo = false;
  function goPage(i) {
    if (!S.pages.length) return; S.cur = Math.max(0, Math.min(S.pages.length - 1, i)); updCur();
    const b = $(`.pe-page[data-i="${S.cur}"]`); if (b) { scrollingTo = true; b.scrollIntoView({ behavior: "smooth", block: "start" }); setTimeout(() => (scrollingTo = false), 600); }
  }
  const needDoc = () => { if (!S.pages.length) { status("Pehle PDF kholo.", true); return false; } return true; };
  $("#pePrev").onclick = () => goPage(S.cur - 1);
  $("#peNext").onclick = () => goPage(S.cur + 1);
  $("#peRot").onclick = () => { if (!needDoc()) return; snap(); const p = S.pages[S.cur]; p.rot = (p.rot + 90) % 360; layout(); goPage(S.cur); };
  $("#peDelPg").onclick = () => {
    if (!needDoc()) return; if (S.pages.length < 2) return status("Aakhri page nahi hata sakte.", true);
    if (!confirm("Page " + (S.cur + 1) + " hata dein?")) return;
    snap(); S.pages.splice(S.cur, 1); S.sel = null; if (S.cur >= S.pages.length) S.cur = S.pages.length - 1; layout(); goPage(S.cur);
  };
  const movePage = (dir) => {
    if (!needDoc()) return; const j = S.cur + dir; if (j < 0 || j >= S.pages.length) return;
    snap(); [S.pages[S.cur], S.pages[j]] = [S.pages[j], S.pages[S.cur]]; S.cur = j; S.sel = null; layout(); goPage(j);
  };
  $("#peUp").onclick = () => movePage(-1); $("#peDn").onclick = () => movePage(1);
  $("#peBlank").onclick = () => {
    if (!needDoc()) return; const ref = dims(S.pages[S.cur]);
    snap(); S.pages.splice(S.cur + 1, 0, { src: -1, rot: 0, annots: [], W: ref.W, H: ref.H }); layout(); goPage(S.cur + 1);
  };
  const zoom = (f) => { if (!needDoc()) return; S.zoom = Math.max(0.4, Math.min(3, S.zoom * f)); layout(); };
  $("#peZo").onclick = () => zoom(1 / 1.25); $("#peZi").onclick = () => zoom(1.25);
  $("#peUndo").onclick = undo; $("#peRedo").onclick = redo;

  /* ---------------- save / export ---------------- */
  const b64 = (bytes) => { let s = ""; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const saveBlob = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  let saving = false;
  async function exportPdf() {
    if (!needDoc() || saving) return; saving = true; $("#peSave").disabled = true;
    try {
      status("⏳ PDF ban rahi hai…");
      try { await document.fonts.load("20px 'Noto Sans Devanagari'", "अआक"); } catch {}
      const L = await loadPdfLib();
      const src = await L.PDFDocument.load(S.bytes, { ignoreEncryption: true });
      const out = await L.PDFDocument.create();
      for (let i = 0; i < S.pages.length; i++) {
        status(`⏳ Page ${i + 1}/${S.pages.length} likha ja raha hai…`);
        const p = S.pages[i], d = dims(p); let page;
        if (p.src >= 0) { const [cp] = await out.copyPages(src, [p.src]); page = out.addPage(cp); }
        else page = out.addPage([p.W, p.H]);
        if (p.annots.length) {
          const E = Math.min(3, 3000 / Math.max(d.W, d.H));
          const cv = document.createElement("canvas"); cv.width = Math.ceil(d.W * E); cv.height = Math.ceil(d.H * E);
          drawAnnots(cv.getContext("2d"), p.annots, E, 0, d.W, d.H, null);
          const png = await new Promise((r) => cv.toBlob(r, "image/png"));
          const im = await out.embedPng(new Uint8Array(await png.arrayBuffer()));
          const [ax, ay] = d.vp0 ? d.vp0.convertToPdfPoint(0, d.H) : [0, 0];
          page.drawImage(im, { x: ax, y: ay, width: d.W, height: d.H, rotate: L.degrees(d.base || 0) });
        }
        if (p.rot) page.setRotation(L.degrees(((page.getRotation().angle || 0) + p.rot) % 360));
      }
      out.setProducer("Veda AI PDF Editor");
      const bytes = await out.save();
      const name = S.name + "-edited.pdf";
      showResult(bytes, name);
      status("✅ Taiyar!");
    } catch (e) { status("⚠️ Save nahi hua: " + (e.message || e), true); }
    finally { saving = false; $("#peSave").disabled = false; }
  }
  function showResult(bytes, name) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const file = new File([bytes], name, { type: "application/pdf" });
    const o = $("#peOut");
    o.innerHTML = `<div class="pd-done"><b>✅ ${esc(name)}</b><small>${kb(bytes.length)}</small><div class="row-btns"><button class="btn primary small" id="peView">👁️ Kholo</button><button class="btn ghost small" id="peDl">⬇️ Download</button><button class="btn ghost small" id="peShare">🔗 Share</button><button class="btn ghost small" id="peLib">📚 Library</button><button class="btn ghost small" id="peChat">💬 AI padhe</button></div></div>`;
    $("#peView").onclick = () => { modal.hidden = true; A.openPdf(file, name); };
    $("#peDl").onclick = () => saveBlob(blob, name);
    $("#peShare").onclick = async () => {
      try { if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; } } catch (e) { if (e && e.name === "AbortError") return; }
      A.toast("Share nahi hua — Download karke bhejo.");
    };
    $("#peLib").onclick = async () => { try { await A.saveLib({ id: "pdf" + A.uid(), name, mime: "application/pdf", kind: "pdf", size: bytes.length, ts: Date.now(), data: b64(bytes) }); A.toast("📚 Library me save ho gaya."); } catch { A.toast("⚠️ Save nahi ho paya."); } };
    $("#peChat").onclick = () => {
      if (bytes.length > 18 * 1048576) return A.toast("File 18MB se badi hai, chat me nahi ja sakti.");
      A.attach({ id: A.uid(), name, mime: "application/pdf", kind: "pdf", data: b64(bytes), size: bytes.length }); modal.hidden = true; A.toast("PDF chat me jud gayi.");
    };
  }
  $("#peSave").onclick = exportPdf;

  /* ---------------- open / close ---------------- */
  const open = () => { A.closeAll(); modal.hidden = false; if (!S.pages.length) status("PDF kholo aur edit shuru karo."); else layout(); };
  $("#peClose").onclick = () => { if (askRes) closeAsk(null); modal.hidden = true; };
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  const ob = $("#openPdfEditor"); if (ob) ob.onclick = open;
  window.VedaPdfEditor = { open, openFile: async (f) => { open(); await openFile(f); } };
  setTool("move"); refreshBtns();
})();
