// Veda AI — PDF Editor v2 (alag, advanced). Sab kuch phone/browser me hi chalta hai, internet/API ke bina.
// Text badlo/likho (Hindi bhi) · draw/sign · highlight (apna rang) · shapes · mitao · image · PDF ki image hatao · crop
// Header/Footer · Page number · Watermark (text/image) lagao-hatao · PDF/photo jodo (merge) · page ghumao/hatao/order
// Ek sheet par 1/2/3/4/5/6/8/9/10/12/16 pages (vector quality, koi blur nahi) · paper size · undo/redo · save.
(() => {
  "use strict";
  const A = window.VedaApp;
  if (!A) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");
  const FONT = "'Noto Sans Devanagari','Mukta',system-ui,sans-serif";
  const PAPER = { a4: [595.28, 841.89], a3: [841.89, 1190.55], letter: [612, 792], legal: [612, 1008] };
  const MAX_PAGES = 400;

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
      <label class="pe-lab" title="Rang">🎨 <input type="color" id="peColor" value="#111111"></label>
      <span id="peHlBox" class="pe-grp" hidden><span class="small-note">Highlight:</span>
        <button class="pe-sw" data-hl="#ffe600" style="background:#ffe600"></button><button class="pe-sw" data-hl="#7CFC00" style="background:#7CFC00"></button><button class="pe-sw" data-hl="#ff8ad8" style="background:#ff8ad8"></button><button class="pe-sw" data-hl="#4fc3ff" style="background:#4fc3ff"></button><button class="pe-sw" data-hl="#ffa94d" style="background:#ffa94d"></button>
        <input type="color" id="peHlColor" value="#ffe600" title="Apna highlight rang"></span>
      <span id="peShapeBox" class="pe-grp" hidden><select id="peShape"><option value="rect">▭ Dabba</option><option value="ell">⬭ Gola</option><option value="line">╱ Line</option><option value="arrow">➜ Teer</option></select>
        <label class="small-note"><input type="checkbox" id="peFill"> Bhara hua</label></span>
      <span id="peCoverBox" class="pe-grp" hidden><label class="small-note"><input type="checkbox" id="peAuto" checked> Rang apne aap (aas-paas ka)</label></span>
      <span id="peCropBox" class="pe-grp" hidden><label class="small-note"><input type="checkbox" id="peCropAll" checked> Sab pages par</label><button class="chip" id="peCropClr">Crop hatao</button></span>
      <label class="small-note" id="peFsBox">Akshar <input type="range" id="peFs" min="6" max="96" value="16"><b id="peFsV">16</b></label>
      <label class="small-note" id="peLwBox">Moti <input type="range" id="peLw" min="1" max="20" value="3"><b id="peLwV">3</b></label>
      <span class="sep"></span>
      <button class="chip" id="peDelAnn" hidden>🗑 Ye hatao</button>
      <button class="chip" id="peAllAnn" hidden>⎘ Sab pages par</button>
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
      <label class="btn ghost" for="peAdd" title="Dusri PDF ya photos is page ke baad jodo (merge)">＋ PDF/Photo jodo</label><input type="file" id="peAdd" accept="application/pdf,.pdf,image/*" multiple hidden>
      <button class="btn ghost" id="peDeco" title="Header, footer, page number, watermark">🏷️ Header / Watermark</button>
      <span class="sep"></span>
      <button class="btn ghost" id="peZo" title="Zoom out">−</button>
      <span class="small-note" id="peZoom">100%</span>
      <button class="btn ghost" id="peZi" title="Zoom in">＋</button>
    </div>
    <div class="pe-stage" id="peStage"><div class="small-note" style="max-width:440px;text-align:center;line-height:1.7;margin:auto">📂 <b>PDF kholo</b> dabao, phir tool chuno:<br>✎ Text badlo · 🅣 Text likho · 🖊️ Draw/Sign · 🖍️ Highlight (apna rang)<br>⬜ Mitao · ▭ Shapes · 🖼️ Image · 🧹 PDF ki image hatao · ✂️ Crop<br>＋ PDF/Photo jodo (merge) · 🏷️ Header/Footer/Watermark<br>💾 Save me: ek sheet par 2/3/4/5/6/8/9/10 pages bhi.</div></div>
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

    <div class="pe-ask" id="peDecoDlg" hidden>
      <div class="pe-ask-box pe-scroll">
        <h3 style="margin:0 0 8px;font-size:1em">🏷️ Header · Footer · Page number · Watermark</h3>
        <div class="pe-grid">
          <label class="field"><span>Header (baayen)</span><input id="dcHL" type="text"></label>
          <label class="field"><span>Header (beech)</span><input id="dcHC" type="text"></label>
          <label class="field"><span>Header (daayen)</span><input id="dcHR" type="text"></label>
          <label class="field"><span>Footer (baayen)</span><input id="dcFL" type="text"></label>
          <label class="field"><span>Footer (beech)</span><input id="dcFC" type="text"></label>
          <label class="field"><span>Footer (daayen)</span><input id="dcFR" type="text"></label>
        </div>
        <div class="pe-grid">
          <label class="field"><span>Akshar size</span><input id="dcSize" type="number" min="6" max="40" value="10"></label>
          <label class="field"><span>Rang</span><input id="dcColor" type="color" value="#333333"></label>
          <label class="field"><span>Page number</span><select id="dcPn"><option value="">Nahi</option><option value="b-c">Neeche beech</option><option value="b-r">Neeche daayen</option><option value="b-l">Neeche baayen</option><option value="t-c">Upar beech</option><option value="t-r">Upar daayen</option><option value="t-l">Upar baayen</option></select></label>
          <label class="field"><span>Page no. ka format</span><input id="dcPnFmt" type="text" value="Page {n} / {N}"></label>
        </div>
        <div class="small-note">Text me {n} = page number, {N} = kul pages likh sakte ho. Hindi bhi chalegi.</div>
        <hr style="border:0;border-top:1px solid var(--line);margin:10px 0">
        <div class="pe-grid">
          <label class="field"><span>Watermark text</span><input id="dcWmT" type="text" placeholder="जैसे: CONFIDENTIAL / शैलेश सर"></label>
          <label class="field"><span>Rang</span><input id="dcWmC" type="color" value="#888888"></label>
          <label class="field"><span>Halkapan: <b id="dcWmOv">25</b>%</span><input id="dcWmO" type="range" min="5" max="100" value="25"></label>
          <label class="field"><span>Size: <b id="dcWmSv">40</b>%</span><input id="dcWmS" type="range" min="8" max="100" value="40"></label>
          <label class="field"><span>Tirchhapan</span><select id="dcWmA"><option value="-45">45° (ulta)</option><option value="45">45°</option><option value="0">Seedha</option><option value="90">90°</option></select></label>
          <label class="field check" style="align-self:end"><input type="checkbox" id="dcWmTile"> <span>Poore page par dohrao</span></label>
        </div>
        <div class="row-btns" style="margin-top:6px"><button class="btn ghost small" id="dcWmImg" type="button">🖼️ Watermark image chuno</button><span class="small-note" id="dcWmImgN"></span><button class="btn ghost small" id="dcWmImgX" type="button" hidden>image hatao</button></div>
        <div class="row-btns" style="margin-top:12px"><button class="btn primary" id="dcOk">✅ Lagao</button><button class="btn danger" id="dcClear">🧹 Sab hatao</button><button class="btn ghost" id="dcNo">Band</button></div>
        <div class="small-note" style="margin-top:6px">Ye sab pages par lagta hai aur yahin se hata bhi sakte ho. PDF me pehle se bane watermark ke liye ⬜ Mitao / 🧹 image hatao tool + "⎘ Sab pages par" use karo.</div>
      </div>
    </div>

    <div class="pe-ask" id="peSaveDlg" hidden>
      <div class="pe-ask-box pe-scroll">
        <h3 style="margin:0 0 8px;font-size:1em">💾 PDF save karo</h3>
        <div class="pe-grid">
          <label class="field"><span>Ek sheet par kitne pages</span><select id="svN"><option value="1">1 (normal)</option><option value="2">2</option><option value="3">3</option><option value="4">4</option><option value="5">5</option><option value="6">6</option><option value="8">8</option><option value="9">9</option><option value="10">10</option><option value="12">12</option><option value="16">16</option></select></label>
          <label class="field"><span>Kagaz</span><select id="svPaper"><option value="orig">Jaisa hai (sirf 1 par)</option><option value="a4" selected>A4</option><option value="a3">A3</option><option value="letter">Letter</option><option value="legal">Legal</option></select></label>
          <label class="field"><span>Disha</span><select id="svOri"><option value="auto">Auto (best)</option><option value="p">Khada (portrait)</option><option value="l">Leta (landscape)</option></select></label>
          <label class="field"><span>Kinara (margin)</span><select id="svMg"><option value="0">Nahi</option><option value="12" selected>Chhota</option><option value="28">Bada</option></select></label>
          <label class="field"><span>Pages ke beech jagah</span><select id="svGap"><option value="0">Nahi</option><option value="6" selected>Chhoti</option><option value="14">Badi</option></select></label>
          <label class="field check" style="align-self:end"><input type="checkbox" id="svBorder" checked> <span>Har page par line (border)</span></label>
        </div>
        <label class="field" style="margin-top:6px"><span>File ka naam</span><input id="svName" type="text"></label>
        <div class="small-note" style="margin-top:6px">✅ Quality: pages vector rehte hain (photo nahi banti), isliye text saaf aur chhota-bada karne par bhi sharp rehta hai. Rang jaisa hai waisa rahta hai.</div>
        <div class="row-btns" style="margin-top:12px"><button class="btn primary" id="svGo">💾 Banao</button><button class="btn ghost" id="svNo">Raddh</button></div>
      </div>
    </div>
  </div>`;
  document.body.appendChild(modal);

  /* ---------------- state ---------------- */
  const S = {
    docs: [], // {name, bytes, proxies[], meta[]}
    name: "", pages: [], zoom: 1, tool: "move", cur: 0, sel: null, selPage: null, undo: [], redo: [],
    imgs: new Map(), pendingImg: null, sizes: { fs: 16, lw: 3 },
    deco: { hf: { l: "", c: "", r: "", fl: "", fc: "", fr: "", size: 10, color: "#333333" }, pn: { pos: "", fmt: "Page {n} / {N}" }, wm: null },
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
  const metaOf = (p) => S.docs[p.d].meta[p.src];
  const dims = (p) => (p.src >= 0 ? metaOf(p) : { W: p.W, H: p.H, base: 0, vp0: null });
  const viewDims = (p) => { const d = dims(p); return p.rot % 180 ? { w: d.H, h: d.W } : { w: d.W, h: d.H }; };
  function rotMatrix(rot, W, H, sc) {
    if (rot === 90) return [0, sc, -sc, 0, H * sc, 0];
    if (rot === 180) return [-sc, 0, 0, -sc, W * sc, H * sc];
    if (rot === 270) return [0, -sc, sc, 0, 0, W * sc];
    return [sc, 0, 0, sc, 0, 0];
  }
  function fromView(p, X, Y) { const d = dims(p); if (p.rot === 90) return [Y, d.H - X]; if (p.rot === 180) return [d.W - X, d.H - Y]; if (p.rot === 270) return [d.W - Y, X]; return [X, Y]; }
  function toView(p, x, y) { const d = dims(p); if (p.rot === 90) return [d.H - y, x]; if (p.rot === 180) return [d.W - x, d.H - y]; if (p.rot === 270) return [y, d.W - x]; return [x, y]; }
  const toPdf = (p, x, y) => { const d = dims(p); return d.vp0 ? d.vp0.convertToPdfPoint(x, y) : [x, d.H - y]; };

  /* ---------------- drawing ---------------- */
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
    if (a.t === "shape") {
      const pad = (a.lw || 2) / 2 + 2;
      return { x: Math.min(a.x, a.x + a.w) - pad, y: Math.min(a.y, a.y + a.h) - pad, w: Math.abs(a.w) + pad * 2, h: Math.abs(a.h) + pad * 2 };
    }
    return { x: a.x, y: a.y, w: a.w, h: a.h };
  }
  const tok = (s, n, N) => String(s || "").replace(/\{n\}/g, n).replace(/\{N\}/g, N).replace(/\{name\}/g, S.name);
  function drawDeco(ctx, idx, N, W, H) {
    const D = S.deco;
    if (D.wm && (D.wm.text || D.wm.imgId)) {
      const w = D.wm; ctx.save(); ctx.globalAlpha = w.op;
      const one = (cx, cy) => {
        ctx.save(); ctx.translate(cx, cy); ctx.rotate((w.ang * Math.PI) / 180);
        if (w.text) {
          const px = Math.max(8, (Math.min(W, H) * w.size) / 100 * (w.tile ? 0.35 : 0.6)); ctx.font = `bold ${px}px ${FONT}`; ctx.fillStyle = w.c; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          let sz = px; while (ctx.measureText(w.text).width > Math.max(W, H) * 0.95 && sz > 8 && !w.tile) { sz -= 2; ctx.font = `bold ${sz}px ${FONT}`; }
          ctx.fillText(w.text, 0, 0);
        } else {
          const im = S.imgs.get(w.imgId); if (im && im.el) { const iw = Math.min(W, H) * (w.size / 100) * (w.tile ? 0.5 : 1); const ih = iw * (im.h / im.w); ctx.drawImage(im.el, -iw / 2, -ih / 2, iw, ih); }
        }
        ctx.restore();
      };
      if (w.tile) { const stepX = Math.max(W, H) / 2.4, stepY = Math.max(W, H) / 3.2; for (let y = -H * 0.2; y < H * 1.3; y += stepY) for (let x = -W * 0.2; x < W * 1.3; x += stepX) one(x + ((Math.round(y / stepY) % 2) * stepX) / 2, y); }
      else one(W / 2, H / 2);
      ctx.restore();
    }
    const h = D.hf, mx = 36, my = 20; const sz = h.size || 10;
    ctx.save(); ctx.font = `${sz}px ${FONT}`; ctx.fillStyle = h.color || "#333"; ctx.textBaseline = "top";
    const put = (txt, al, y) => { if (!txt) return; ctx.textAlign = al; ctx.fillText(tok(txt, idx + 1, N), al === "left" ? mx : al === "center" ? W / 2 : W - mx, y); };
    put(h.l, "left", my); put(h.c, "center", my); put(h.r, "right", my);
    put(h.fl, "left", H - my - sz); put(h.fc, "center", H - my - sz); put(h.fr, "right", H - my - sz);
    if (D.pn && D.pn.pos) { const [v, hz] = D.pn.pos.split("-"); put(D.pn.fmt || "{n}", hz === "c" ? "center" : hz === "r" ? "right" : "left", v === "t" ? my + (h.l || h.c || h.r ? sz * 1.6 : 0) : H - my - sz - (h.fl || h.fc || h.fr ? sz * 1.6 : 0)); }
    ctx.restore();
  }
  function drawAnnots(ctx, p, idx, N, sc, rot, sel, ui) {
    const d = dims(p), W = d.W, H = d.H;
    ctx.save();
    ctx.setTransform(...rotMatrix(rot, W, H, sc));
    drawDeco(ctx, idx, N, W, H);
    for (const a of p.annots) {
      if (a.t === "rect") {
        ctx.globalAlpha = a.kind === "hl" ? 0.4 : 1;
        ctx.fillStyle = a.c; ctx.fillRect(a.x, a.y, a.w, a.h); ctx.globalAlpha = 1;
      } else if (a.t === "pen") {
        ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = a.c; ctx.lineWidth = a.w; ctx.fillStyle = a.c;
        if (a.pts.length === 1) { ctx.beginPath(); ctx.arc(a.pts[0][0], a.pts[0][1], a.w / 2, 0, 7); ctx.fill(); }
        else { ctx.beginPath(); a.pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke(); }
      } else if (a.t === "shape") {
        ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = a.c; ctx.fillStyle = a.c; ctx.lineWidth = a.lw;
        ctx.beginPath();
        if (a.k === "rect") ctx.rect(a.x, a.y, a.w, a.h);
        else if (a.k === "ell") ctx.ellipse(a.x + a.w / 2, a.y + a.h / 2, Math.abs(a.w / 2), Math.abs(a.h / 2), 0, 0, 7);
        else { ctx.moveTo(a.x, a.y); ctx.lineTo(a.x + a.w, a.y + a.h); }
        if (a.fill && (a.k === "rect" || a.k === "ell")) ctx.fill();
        ctx.stroke();
        if (a.k === "arrow") {
          const ang = Math.atan2(a.h, a.w), hl = Math.max(8, a.lw * 4), x2 = a.x + a.w, y2 = a.y + a.h;
          ctx.beginPath(); ctx.moveTo(x2, y2); ctx.lineTo(x2 - hl * Math.cos(ang - 0.45), y2 - hl * Math.sin(ang - 0.45)); ctx.lineTo(x2 - hl * Math.cos(ang + 0.45), y2 - hl * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
        }
      } else if (a.t === "text") {
        ctx.font = `${a.size}px ${FONT}`; ctx.fillStyle = a.c; ctx.textBaseline = "top"; ctx.textAlign = "left";
        String(a.txt).split("\n").forEach((l, i) => ctx.fillText(l, a.x, a.y + i * a.size * 1.25 + a.size * 0.08));
      } else if (a.t === "img") {
        const im = S.imgs.get(a.id); if (im && im.el) ctx.drawImage(im.el, a.x, a.y, a.w, a.h);
      }
    }
    if (ui && p.crop) { // crop ke bahar ka hissa dhundhla (sirf screen par)
      const c = p.crop; ctx.fillStyle = "rgba(0,0,0,.5)";
      ctx.fillRect(0, 0, W, c.y); ctx.fillRect(0, c.y + c.h, W, H - c.y - c.h); ctx.fillRect(0, c.y, c.x, c.h); ctx.fillRect(c.x + c.w, c.y, W - c.x - c.w, c.h);
      ctx.setLineDash([6 / sc * 1.5, 4 / sc * 1.5]); ctx.lineWidth = 1.5 / sc * 1.5; ctx.strokeStyle = "#ffcc00"; ctx.strokeRect(c.x, c.y, c.w, c.h);
    }
    if (sel) {
      const b = bbox(sel);
      ctx.setLineDash([5 / sc * 1.5, 4 / sc * 1.5]); ctx.lineWidth = 1.5 / sc * 1.5; ctx.strokeStyle = "#2f7bff";
      ctx.strokeRect(b.x - 2, b.y - 2, b.w + 4, b.h + 4);
    }
    ctx.restore();
  }

  /* ---------------- undo / redo ---------------- */
  const snapNow = () => JSON.stringify({ pages: S.pages, deco: S.deco });
  function snap() { S.undo.push(snapNow()); if (S.undo.length > 40) S.undo.shift(); S.redo = []; refreshBtns(); }
  function restore(js) { const o = JSON.parse(js); S.pages = o.pages; S.deco = o.deco; S.sel = null; if (S.cur >= S.pages.length) S.cur = Math.max(0, S.pages.length - 1); layout(); }
  function undo() { if (!S.undo.length) return; S.redo.push(snapNow()); restore(S.undo.pop()); refreshBtns(); }
  function redo() { if (!S.redo.length) return; S.undo.push(snapNow()); restore(S.redo.pop()); refreshBtns(); }
  function refreshBtns() { $("#peUndo").disabled = !S.undo.length; $("#peRedo").disabled = !S.redo.length; $("#peDelAnn").hidden = !S.sel; $("#peAllAnn").hidden = !S.sel; }

  /* ---------------- tools UI ---------------- */
  const TOOLS = [
    ["move", "✋ Chuno / Hilao"], ["edit", "✎ Text badlo"], ["text", "🅣 Text likho"], ["pen", "🖊️ Draw / Sign"], ["hl", "🖍️ Highlight"],
    ["shape", "▭ Shapes"], ["white", "⬜ Mitao"], ["rmimg", "🧹 PDF ki image hatao"], ["img", "🖼️ Image lagao"], ["crop", "✂️ Crop"],
  ];
  $("#peTools").innerHTML = TOOLS.map(([k, l]) => `<button class="chip" data-pt="${k}">${l}</button>`).join("");
  const TIPS = {
    move: "Kisi cheez par tap karke chuno, phir ghasito. 🗑 se hatao, ⎘ se sab pages par copy karo (logo/watermark ke liye).",
    edit: "PDF ke kisi shabd/line par tap karo — text badlo ya khali karke hata do.",
    text: "Jahan likhna hai wahan tap karo (Hindi bhi, 🎤 se bol bhi sakte ho). Rang aur size upar se badlo.",
    pen: "Ungli/mouse se draw ya sign karo. Scroll ke liye ◀ ▶ ya zoom − use karo.",
    hl: "Uspar ghasito jo highlight karna hai. Upar se apna rang chuno.",
    shape: "Upar se shape chuno (dabba/gola/line/teer), phir ghasito.",
    white: "Jo hissa mitana hai uspar ghasito. Rang apne aap aas-paas ka lega (ya khud chuno).",
    rmimg: "PDF me jo photo/logo/image hatani hai uspar tap karo (watermark image bhi). Phir ⎘ Sab pages par se sab jagah.",
    img: "Pehle image chuno, phir page par jahan lagani hai wahan tap karo.",
    crop: "Jo hissa rakhna hai use ghasito — baaki kat jayega. 'Sab pages par' se sabhi pages.",
  };
  const DRAG_TOOLS = ["pen", "hl", "white", "shape", "crop"];
  function setTool(t) {
    S.tool = t; S.sel = null;
    $$("[data-pt]").forEach((b) => b.classList.toggle("on", b.dataset.pt === t));
    const touch = DRAG_TOOLS.includes(t) ? "none" : "pan-y pinch-zoom";
    $$(".pe-page").forEach((b) => (b.style.touchAction = touch));
    $("#peHlBox").hidden = t !== "hl"; $("#peShapeBox").hidden = t !== "shape"; $("#peCoverBox").hidden = !(t === "white" || t === "rmimg" || t === "edit"); $("#peCropBox").hidden = t !== "crop";
    $("#peFsBox").hidden = !(t === "text" || t === "edit" || t === "move"); $("#peLwBox").hidden = !(t === "pen" || t === "shape" || t === "move");
    status(TIPS[t] || "");
    if (t === "img") pickImage();
    redrawAll(); refreshBtns();
  }
  $$("[data-pt]").forEach((b) => (b.onclick = () => setTool(b.dataset.pt)));
  $$("[data-hl]").forEach((b) => (b.onclick = () => { $("#peHlColor").value = b.dataset.hl; }));
  $("#peColor").oninput = () => { if (S.sel && ["text", "pen", "shape"].includes(S.sel.t)) { snap(); S.sel.c = $("#peColor").value; redrawAll(); } };
  $("#peFs").oninput = () => { S.sizes.fs = +$("#peFs").value; $("#peFsV").textContent = S.sizes.fs; if (S.sel && S.sel.t === "text") { S.sel.size = S.sizes.fs; measureText(S.sel); redrawAll(); } };
  $("#peLw").oninput = () => { S.sizes.lw = +$("#peLw").value; $("#peLwV").textContent = S.sizes.lw; if (S.sel && (S.sel.t === "pen")) { S.sel.w = S.sizes.lw; redrawAll(); } if (S.sel && S.sel.t === "shape") { S.sel.lw = S.sizes.lw; redrawAll(); } };
  $("#peCropClr").onclick = () => { if (!S.pages.length) return; snap(); if ($("#peCropAll").checked) S.pages.forEach((p) => (p.crop = null)); else S.pages[S.cur].crop = null; redrawAll(); };

  /* ---------------- ask dialog ---------------- */
  let askRes = null;
  function askText(title, init) {
    return new Promise((res) => { askRes = res; $("#peAskT").textContent = title; const t = $("#peAskIn"); t.value = init || ""; $("#peAsk").hidden = false; setTimeout(() => { t.focus(); t.select(); }, 50); });
  }
  const closeAsk = (v) => { $("#peAsk").hidden = true; const r = askRes; askRes = null; if (r) r(v); };
  $("#peAskOk").onclick = () => closeAsk($("#peAskIn").value);
  $("#peAskNo").onclick = () => closeAsk(null);
  $("#peAskMic").onclick = () => { try { A.mic($("#peAskIn"), $("#peAskMic")); } catch { A.toast("Mic abhi nahi chal raha."); } };

  /* ---------------- open / add PDFs + photos ---------------- */
  async function readPdf(file, lib) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    let doc;
    try { doc = await lib.getDocument({ data: bytes.slice() }).promise; }
    catch (e) { if (e && e.name === "PasswordException") throw new Error(`"${file.name}" password se locked hai. Pehle password hatao.`); throw e; }
    const proxies = [], meta = [];
    for (let i = 1; i <= doc.numPages; i++) {
      status(`⏳ ${file.name}: page ${i}/${doc.numPages}…`);
      const pg = await doc.getPage(i); const vp0 = pg.getViewport({ scale: 1 });
      proxies.push(pg); meta.push({ W: vp0.width, H: vp0.height, base: pg.rotate || 0, vp0, items: null, imgs: null });
    }
    return { name: (file.name || "document.pdf").replace(/\.pdf$/i, ""), bytes, proxies, meta };
  }
  async function imageToPage(file) {
    const url = URL.createObjectURL(file);
    try {
      const el = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
      const sc = Math.min(1, 2400 / Math.max(el.naturalWidth, el.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(el.naturalWidth * sc); c.height = Math.round(el.naturalHeight * sc);
      const x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); x.drawImage(el, 0, 0, c.width, c.height);
      const id = "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
      S.imgs.set(id, { el: c, w: c.width, h: c.height });
      const land = c.width > c.height * 1.15; const [pw, ph] = land ? [PAPER.a4[1], PAPER.a4[0]] : PAPER.a4; const mg = 18;
      const s = Math.min((pw - mg * 2) / c.width, (ph - mg * 2) / c.height); const w = c.width * s, h = c.height * s;
      return { d: -1, src: -1, rot: 0, W: pw, H: ph, crop: null, annots: [{ t: "img", id, x: (pw - w) / 2, y: (ph - h) / 2, w, h }] };
    } finally { URL.revokeObjectURL(url); }
  }
  async function addFiles(files, replace) {
    try {
      const lib = await loadPdfJs();
      const newPages = []; let total = replace ? 0 : S.pages.length;
      if (replace) { S.docs = []; }
      for (const f of files) {
        if (/pdf/i.test(f.type) || /\.pdf$/i.test(f.name)) {
          const dd = await readPdf(f, lib); S.docs.push(dd); const di = S.docs.length - 1;
          for (let i = 0; i < dd.meta.length; i++) newPages.push({ d: di, src: i, rot: 0, annots: [], crop: null });
        } else if (/^image\//.test(f.type)) newPages.push(await imageToPage(f));
        else throw new Error(`"${f.name}" ka format samajh nahi aaya (PDF ya photo chuno).`);
        if (total + newPages.length > MAX_PAGES) throw new Error(`Editor ${MAX_PAGES} pages tak chalta hai.`);
      }
      if (!newPages.length) return;
      if (replace) {
        S.pages = newPages; S.undo = []; S.redo = []; S.sel = null; S.cur = 0; S.name = (files[0].name || "document").replace(/\.\w+$/, "");
        S.deco = { hf: { l: "", c: "", r: "", fl: "", fc: "", fr: "", size: 10, color: "#333333" }, pn: { pos: "", fmt: "Page {n} / {N}" }, wm: null };
        $("#peOut").innerHTML = "";
      } else { snap(); S.pages.splice(S.cur + 1, 0, ...newPages); }
      $("#peName").textContent = S.name + " · " + S.pages.length + " page";
      layout(); if (replace) setTool("edit"); else goPage(S.cur + 1); refreshBtns();
      status("✅ " + newPages.length + " page " + (replace ? "khul gaye." : "jud gaye (is page ke baad)."));
    } catch (e) { status("⚠️ " + (e.message || e), true); }
  }
  $("#peFile").onchange = async (e) => { const f = [...e.target.files]; e.target.value = ""; if (f.length) { status("⏳ PDF khul rahi hai…"); await addFiles(f, true); } };
  $("#peAdd").onchange = async (e) => { const f = [...e.target.files]; e.target.value = ""; if (!f.length) return; if (!S.pages.length) { await addFiles(f, true); return; } status("⏳ Jod raha hun…"); await addFiles(f, false); };

  /* ---------------- layout + lazy render ---------------- */
  let io = null, layoutGen = 0, scrollingTo = false;
  function layout() {
    const stage = $("#peStage"); const keepTop = stage.scrollTop;
    layoutGen++;
    if (io) io.disconnect();
    stage.innerHTML = "";
    if (!S.pages.length) { stage.innerHTML = '<div class="small-note" style="margin:auto">Koi page nahi bacha.</div>'; $("#peCur").textContent = "–"; return; }
    const avail = Math.max(220, stage.clientWidth - 28);
    io = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) renderPage(+en.target.dataset.i, layoutGen); });
      const vis = ents.filter((x) => x.isIntersecting).map((x) => +x.target.dataset.i).sort((a, b) => a - b);
      if (vis.length && !scrollingTo) { S.cur = vis[0]; updCur(); }
    }, { root: stage, rootMargin: "500px 0px 500px 0px", threshold: [0, 0.05] });
    S.pages.forEach((p, i) => {
      const v = viewDims(p); p.s = (avail / v.w) * S.zoom;
      const box = document.createElement("div"); box.className = "pe-page"; box.dataset.i = i;
      box.style.width = v.w * p.s + "px"; box.style.height = v.h * p.s + "px";
      box.style.touchAction = DRAG_TOOLS.includes(S.tool) ? "none" : "pan-y pinch-zoom";
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
    if (p.src >= 0) {
      try {
        const px = S.docs[p.d].proxies[p.src];
        await px.render({ canvasContext: bctx, viewport: px.getViewport({ scale: p.s * k, rotation: (d.base + p.rot) % 360 }) }).promise;
      } catch (e) { /* layout badal gaya */ }
    }
    if (gen !== layoutGen) return;
    redrawOverlay(i);
  }
  function redrawOverlay(i) {
    const p = S.pages[i]; const box = $(`.pe-page[data-i="${i}"]`); if (!p || !box) return;
    const ov = box.querySelector("canvas.ov"); if (!ov) return;
    const k = dpr(); const c = ov.getContext("2d");
    c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, ov.width, ov.height);
    drawAnnots(c, p, i, S.pages.length, p.s * k, p.rot, S.sel && S.selPage === i ? S.sel : null, true);
  }
  const redrawAll = () => S.pages.forEach((_, i) => redrawOverlay(i));

  /* ---------------- PDF ke text / images (tap-edit, image hatao) ---------------- */
  async function getItems(p) {
    const m = metaOf(p); if (m.items) return m.items;
    const lib = window.pdfjsLib; const pg = S.docs[p.d].proxies[p.src];
    const tc = await pg.getTextContent(); const out = [];
    for (const it of tc.items) {
      if (!it.str || !it.str.trim()) continue;
      const tr = lib.Util.transform(m.vp0.transform, it.transform);
      const fs = Math.hypot(tr[2], tr[3]) || Math.abs(it.height) || 10;
      if (Math.abs(tr[1]) + Math.abs(tr[2]) > fs * 0.6) continue;
      out.push({ str: it.str, x: tr[4], base: tr[5], fs, w: it.width || fs * it.str.length * 0.5 });
    }
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
  async function getImages(p) {
    const m = metaOf(p); if (m.imgs) return m.imgs;
    const lib = window.pdfjsLib, O = lib.OPS; const pg = S.docs[p.d].proxies[p.src];
    const ops = await pg.getOperatorList(); const res = []; let ctm = [1, 0, 0, 1, 0, 0]; const st = [];
    const IMG = new Set([O.paintImageXObject, O.paintInlineImageXObject, O.paintImageMaskXObject, O.paintImageXObjectRepeat, O.paintImageMaskXObjectRepeat, O.paintJpegXObject].filter((x) => x !== undefined));
    for (let i = 0; i < ops.fnArray.length; i++) {
      const fn = ops.fnArray[i], ar = ops.argsArray[i];
      if (fn === O.save) st.push(ctm.slice());
      else if (fn === O.restore) { if (st.length) ctm = st.pop(); }
      else if (fn === O.transform) ctm = lib.Util.transform(ctm, ar);
      else if (fn === O.paintFormXObjectBegin) { st.push(ctm.slice()); if (ar && ar[0]) ctm = lib.Util.transform(ctm, ar[0]); }
      else if (fn === O.paintFormXObjectEnd) { if (st.length) ctm = st.pop(); }
      else if (IMG.has(fn)) {
        const T = lib.Util.transform(m.vp0.transform, ctm);
        const pts = [[0, 0], [1, 0], [0, 1], [1, 1]].map(([u, v]) => [T[0] * u + T[2] * v + T[4], T[1] * u + T[3] * v + T[5]]);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        const x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
        if (w > 2 && h > 2) res.push({ x, y, w, h });
      }
    }
    m.imgs = res; return res;
  }
  function coverColor(p, x, y, w, h) {
    if (!$("#peAuto").checked) return $("#peColor").value;
    try {
      const idx = S.pages.indexOf(p); const box = $(`.pe-page[data-i="${idx}"]`); const cv = box && box.querySelector("canvas"); if (!cv) return "#ffffff";
      const k = dpr() * p.s, ctx = cv.getContext("2d");
      const pts = [[x - 1.5, y - 1.5], [x + w + 1.5, y - 1.5], [x - 1.5, y + h + 1.5], [x + w + 1.5, y + h + 1.5], [x + w / 2, y - 1.5], [x + w / 2, y + h + 1.5]];
      let r = 0, g = 0, b = 0, n = 0;
      for (const [px, py] of pts) {
        const [vx, vy] = toView(p, px, py); const X = Math.round(vx * k), Y = Math.round(vy * k);
        if (X < 0 || Y < 0 || X >= cv.width || Y >= cv.height) continue;
        const dta = ctx.getImageData(X, Y, 1, 1).data; r += dta[0]; g += dta[1]; b += dta[2]; n++;
      }
      if (!n) return "#ffffff";
      r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
      if (r >= 232 && g >= 232 && b >= 232) return "#ffffff";
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
        snap(); const a = { t: "rect", kind: t === "hl" ? "hl" : "white", x, y, w: 0, h: 0, c: t === "hl" ? $("#peHlColor").value : "#ffffff" }; p.annots.push(a); drag.a = a; drag.ox = x; drag.oy = y;
        box.setPointerCapture(e.pointerId); e.preventDefault();
      } else if (t === "shape") {
        snap(); const a = { t: "shape", k: $("#peShape").value, x, y, w: 0, h: 0, c: $("#peColor").value, lw: S.sizes.lw, fill: $("#peFill").checked }; p.annots.push(a); drag.a = a; drag.ox = x; drag.oy = y;
        box.setPointerCapture(e.pointerId); e.preventDefault();
      } else if (t === "crop") {
        snap(); p.crop = { x, y, w: 0, h: 0 }; drag.a = p.crop; drag.ox = x; drag.oy = y; box.setPointerCapture(e.pointerId); e.preventDefault();
      } else if (t === "move") {
        let hit = null;
        for (let k = p.annots.length - 1; k >= 0; k--) { const b = bbox(p.annots[k]); if (x >= b.x - 4 && x <= b.x + b.w + 4 && y >= b.y - 4 && y <= b.y + b.h + 4) { hit = p.annots[k]; break; } }
        S.sel = hit; S.selPage = hit ? i : null;
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
      if (S.tool === "move") {
        if (!drag.snapped && drag.moved) { drag.snapped = true; snap(); }
        if (drag.moved) {
          const dx = x - drag.x0, dy = y - drag.y0; drag.x0 = x; drag.y0 = y;
          if (a.t === "pen") a.pts = a.pts.map(([px, py]) => [px + dx, py + dy]); else { a.x += dx; a.y += dy; }
          redrawOverlay(i);
        }
      } else if (a.t === "pen") { a.pts.push([x, y]); redrawOverlay(i); }
      else if (a.t === "shape" && (a.k === "line" || a.k === "arrow")) { a.w = x - drag.ox; a.h = y - drag.oy; redrawOverlay(i); }
      else if (drag.ox !== undefined) { a.x = Math.min(drag.ox, x); a.y = Math.min(drag.oy, y); a.w = Math.abs(x - drag.ox); a.h = Math.abs(y - drag.oy); redrawOverlay(i); }
    });
    const end = async (e) => {
      if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.id)) return;
      const d = drag; drag = null; const p = S.pages[i]; if (!p) return;
      try { box.releasePointerCapture(e.pointerId); } catch {}
      const t = S.tool, a = d.a;
      if (e.type === "pointercancel") {
        if (a && DRAG_TOOLS.includes(t)) { if (t === "crop") p.crop = null; else p.annots.pop(); S.undo.pop(); refreshBtns(); redrawOverlay(i); }
        return;
      }
      if (t === "hl" || t === "white") {
        if (a.w < 3 || a.h < 3) { p.annots.pop(); S.undo.pop(); refreshBtns(); }
        else if (t === "white") a.c = coverColor(p, a.x, a.y, a.w, a.h);
        redrawOverlay(i);
      } else if (t === "shape") {
        if (Math.abs(a.w) < 3 && Math.abs(a.h) < 3) { p.annots.pop(); S.undo.pop(); refreshBtns(); }
        redrawOverlay(i);
      } else if (t === "crop") {
        if (a.w < 20 || a.h < 20) { p.crop = null; S.undo.pop(); refreshBtns(); }
        else if ($("#peCropAll").checked) { S.pages.forEach((q, qi) => { if (qi !== i) { const dd = dims(q); q.crop = { x: Math.max(0, Math.min(a.x, dd.W - 20)), y: Math.max(0, Math.min(a.y, dd.H - 20)), w: Math.min(a.w, dd.W - a.x), h: Math.min(a.h, dd.H - a.y) }; } }); }
        redrawAll();
      } else if (t === "pen") { redrawOverlay(i); }
      else if (t === "text" && !d.moved) {
        const v = await askText("Naya text likho", "");
        if (v && v.trim()) { snap(); const n = { t: "text", x: d.x0, y: d.y0, txt: v, size: S.sizes.fs, c: $("#peColor").value, w: 0, h: 0 }; measureText(n); p.annots.push(n); S.sel = n; S.selPage = i; redrawAll(); refreshBtns(); }
      } else if (t === "edit" && !d.moved) {
        if (p.src < 0) { status("Ye khali/photo page hai — 🅣 Text likho use karo.", true); return; }
        const items = await getItems(p);
        const hit = items.find((it) => d.x0 >= it.x - 2 && d.x0 <= it.x + it.w + 2 && d.y0 >= it.y - 2 && d.y0 <= it.y + it.h + 2);
        if (!hit) { status("Yahan PDF ka text nahi mila (scan/photo ho sakta hai). 🅣 Text likho + ⬜ Mitao use karo.", true); return; }
        const v = await askText("Text badlo (khali chhodo = hata do)", hit.str);
        if (v === null || v === hit.str) return;
        snap(); const pad = 1.2;
        p.annots.push({ t: "rect", kind: "white", x: hit.x - pad, y: hit.y - pad, w: hit.w + pad * 2, h: hit.h + pad * 2, c: coverColor(p, hit.x - pad, hit.y - pad, hit.w + pad * 2, hit.h + pad * 2) });
        if (v.trim()) { const n = { t: "text", x: hit.x, y: hit.y, txt: v, size: Math.max(6, hit.fs), c: $("#peColor").value, w: 0, h: 0 }; measureText(n); p.annots.push(n); }
        redrawOverlay(i); status("✅ Badal diya. Aur badlav ke liye dusre shabd par tap karo; ho jaye to 💾 Save.");
      } else if (t === "rmimg" && !d.moved) {
        if (p.src < 0) { status("Is page me PDF ki image nahi hai.", true); return; }
        const imgs = (await getImages(p)).filter((it) => d.x0 >= it.x && d.x0 <= it.x + it.w && d.y0 >= it.y && d.y0 <= it.y + it.h).sort((a1, b1) => a1.w * a1.h - b1.w * b1.h);
        if (!imgs.length) { status("Yahan koi image nahi mili. (Watermark text ho to ⬜ Mitao se mitao.)", true); return; }
        const it = imgs[0]; snap(); const pd = 1.5;
        p.annots.push({ t: "rect", kind: "white", x: it.x - pd, y: it.y - pd, w: it.w + pd * 2, h: it.h + pd * 2, c: coverColor(p, it.x - pd, it.y - pd, it.w + pd * 2, it.h + pd * 2) });
        S.sel = p.annots[p.annots.length - 1]; S.selPage = i; redrawAll(); refreshBtns();
        status("✅ Image dhak di. Sab pages par chahiye to ⎘ Sab pages par dabao.");
      } else if (t === "img" && !d.moved) {
        if (!S.pendingImg) { pickImage(); return; }
        const im = S.pendingImg; const d0 = dims(p);
        const w = Math.min(180, d0.W * 0.4), h = w * (im.h / im.w);
        snap(); const n = { t: "img", id: im.id, x: d.x0 - w / 2, y: d.y0 - h / 2, w, h }; p.annots.push(n); S.sel = n; S.selPage = i; redrawAll(); refreshBtns();
      } else if (t === "move") { refreshBtns(); }
    };
    box.addEventListener("pointerup", end);
    box.addEventListener("pointercancel", end);
  }

  /* ---------------- image pick ---------------- */
  function pickImageFile(cb) {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
    inp.onchange = async () => {
      const f = inp.files[0]; if (!f) return;
      try {
        const url = URL.createObjectURL(f);
        const el = await new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; });
        const sc = Math.min(1, 1600 / Math.max(el.naturalWidth, el.naturalHeight));
        const c = document.createElement("canvas"); c.width = Math.round(el.naturalWidth * sc); c.height = Math.round(el.naturalHeight * sc);
        c.getContext("2d").drawImage(el, 0, 0, c.width, c.height);
        const id = "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        S.imgs.set(id, { el: c, w: c.width, h: c.height }); URL.revokeObjectURL(url);
        cb({ id, w: c.width, h: c.height, name: f.name });
      } catch { status("⚠️ Ye image khul nahi payi.", true); }
    };
    inp.click();
  }
  function pickImage() { pickImageFile((im) => { S.pendingImg = im; status("✅ Image taiyar. Ab page par jahan lagani hai wahan tap karo."); }); }

  /* ---------------- selected annotation actions ---------------- */
  function delSel() { if (!S.sel) return; const p = S.pages[S.selPage]; if (!p) return; snap(); p.annots = p.annots.filter((a) => a !== S.sel); S.sel = null; redrawAll(); refreshBtns(); }
  function copyAll() {
    if (!S.sel) return; const src = S.pages[S.selPage]; if (!src) return; snap();
    S.pages.forEach((p, i) => { if (i !== S.selPage) { const c = JSON.parse(JSON.stringify(S.sel)); p.annots.push(c); } });
    redrawAll(); status("✅ Sab " + S.pages.length + " pages par lag gaya.");
  }
  $("#peDelAnn").onclick = delSel; $("#peAllAnn").onclick = copyAll;
  document.addEventListener("keydown", (e) => {
    if (modal.hidden || !$("#peAsk").hidden) return;
    if ((e.key === "Delete" || e.key === "Backspace") && S.sel && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) { e.preventDefault(); delSel(); }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  });

  /* ---------------- page operations ---------------- */
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
  const movePage = (dir) => { if (!needDoc()) return; const j = S.cur + dir; if (j < 0 || j >= S.pages.length) return; snap(); [S.pages[S.cur], S.pages[j]] = [S.pages[j], S.pages[S.cur]]; S.cur = j; S.sel = null; layout(); goPage(j); };
  $("#peUp").onclick = () => movePage(-1); $("#peDn").onclick = () => movePage(1);
  $("#peBlank").onclick = () => { if (!needDoc()) return; const ref = dims(S.pages[S.cur]); snap(); S.pages.splice(S.cur + 1, 0, { d: -1, src: -1, rot: 0, annots: [], crop: null, W: ref.W, H: ref.H }); layout(); goPage(S.cur + 1); };
  const zoom = (f) => { if (!needDoc()) return; S.zoom = Math.max(0.4, Math.min(3, S.zoom * f)); layout(); };
  $("#peZo").onclick = () => zoom(1 / 1.25); $("#peZi").onclick = () => zoom(1.25);
  $("#peUndo").onclick = undo; $("#peRedo").onclick = redo;

  /* ---------------- Header / Watermark dialog ---------------- */
  const dcRange = () => { $("#dcWmOv").textContent = $("#dcWmO").value; $("#dcWmSv").textContent = $("#dcWmS").value; };
  $("#dcWmO").oninput = dcRange; $("#dcWmS").oninput = dcRange;
  let dcImg = null;
  $("#dcWmImg").onclick = () => pickImageFile((im) => { dcImg = im; $("#dcWmImgN").textContent = "✅ " + im.name; $("#dcWmImgX").hidden = false; });
  $("#dcWmImgX").onclick = () => { dcImg = null; $("#dcWmImgN").textContent = ""; $("#dcWmImgX").hidden = true; };
  function fillDeco() {
    const D = S.deco, h = D.hf;
    $("#dcHL").value = h.l; $("#dcHC").value = h.c; $("#dcHR").value = h.r; $("#dcFL").value = h.fl; $("#dcFC").value = h.fc; $("#dcFR").value = h.fr;
    $("#dcSize").value = h.size; $("#dcColor").value = h.color; $("#dcPn").value = D.pn.pos; $("#dcPnFmt").value = D.pn.fmt;
    const w = D.wm || {}; $("#dcWmT").value = w.text || ""; $("#dcWmC").value = w.c || "#888888"; $("#dcWmO").value = Math.round((w.op || 0.25) * 100); $("#dcWmS").value = w.size || 40; $("#dcWmA").value = String(w.ang === undefined ? -45 : w.ang); $("#dcWmTile").checked = !!w.tile;
    dcImg = w.imgId ? { id: w.imgId, w: (S.imgs.get(w.imgId) || {}).w, h: (S.imgs.get(w.imgId) || {}).h, name: "image" } : null; $("#dcWmImgN").textContent = dcImg ? "✅ image lagi hai" : ""; $("#dcWmImgX").hidden = !dcImg; dcRange();
  }
  $("#peDeco").onclick = () => { if (!needDoc()) return; fillDeco(); $("#peDecoDlg").hidden = false; };
  $("#dcNo").onclick = () => ($("#peDecoDlg").hidden = true);
  $("#dcOk").onclick = async () => {
    snap();
    try { await document.fonts.load("20px 'Noto Sans Devanagari'", "अआक"); } catch {}
    S.deco.hf = { l: $("#dcHL").value, c: $("#dcHC").value, r: $("#dcHR").value, fl: $("#dcFL").value, fc: $("#dcFC").value, fr: $("#dcFR").value, size: Math.max(6, +$("#dcSize").value || 10), color: $("#dcColor").value };
    S.deco.pn = { pos: $("#dcPn").value, fmt: $("#dcPnFmt").value || "{n}" };
    const wt = $("#dcWmT").value.trim();
    S.deco.wm = wt || dcImg ? { text: wt, imgId: wt ? "" : dcImg ? dcImg.id : "", c: $("#dcWmC").value, op: +$("#dcWmO").value / 100, size: +$("#dcWmS").value, ang: +$("#dcWmA").value, tile: $("#dcWmTile").checked } : null;
    $("#peDecoDlg").hidden = true; redrawAll(); status("✅ Lag gaya. Hatana ho to 🏷️ Header / Watermark → 🧹 Sab hatao.");
  };
  $("#dcClear").onclick = () => { snap(); S.deco = { hf: { l: "", c: "", r: "", fl: "", fc: "", fr: "", size: 10, color: "#333333" }, pn: { pos: "", fmt: "Page {n} / {N}" }, wm: null }; $("#peDecoDlg").hidden = true; redrawAll(); status("✅ Header/footer/watermark hata diye."); };

  /* ---------------- save / export ---------------- */
  const b64 = (bytes) => { let s = ""; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const saveBlob = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const decoActive = () => { const D = S.deco, h = D.hf; return !!(D.wm || (D.pn && D.pn.pos) || h.l || h.c || h.r || h.fl || h.fc || h.fr); };

  // (cols, rows) har N ke liye: [khada, leta]
  const GRID = { 1: [[1, 1], [1, 1]], 2: [[1, 2], [2, 1]], 3: [[1, 3], [3, 1]], 4: [[2, 2], [2, 2]], 5: [[2, 3], [3, 2]], 6: [[2, 3], [3, 2]], 8: [[2, 4], [4, 2]], 9: [[3, 3], [3, 3]], 10: [[2, 5], [5, 2]], 12: [[3, 4], [4, 3]], 16: [[4, 4], [4, 4]] };

  async function buildEdited(L) {
    const cache = new Map(); const out = await L.PDFDocument.create(); const N = S.pages.length;
    for (let i = 0; i < N; i++) {
      status(`⏳ Page ${i + 1}/${N} likha ja raha hai…`);
      const p = S.pages[i], d = dims(p); let page;
      if (p.src >= 0) {
        let sd = cache.get(p.d); if (!sd) { sd = await L.PDFDocument.load(S.docs[p.d].bytes, { ignoreEncryption: true }); cache.set(p.d, sd); }
        const [cp] = await out.copyPages(sd, [p.src]); page = out.addPage(cp);
      } else page = out.addPage([p.W, p.H]);
      if (p.annots.length || decoActive()) {
        const E = Math.min(3, 3000 / Math.max(d.W, d.H));
        const cv = document.createElement("canvas"); cv.width = Math.ceil(d.W * E); cv.height = Math.ceil(d.H * E);
        drawAnnots(cv.getContext("2d"), p, i, N, E, 0, null, false);
        const png = await new Promise((r) => cv.toBlob(r, "image/png"));
        const im = await out.embedPng(new Uint8Array(await png.arrayBuffer()));
        const [ax, ay] = toPdf(p, 0, d.H);
        page.drawImage(im, { x: ax, y: ay, width: d.W, height: d.H, rotate: L.degrees(d.base || 0) });
      }
      if (p.crop && p.crop.w > 5 && p.crop.h > 5) {
        const a1 = toPdf(p, p.crop.x, p.crop.y), a2 = toPdf(p, p.crop.x + p.crop.w, p.crop.y + p.crop.h);
        const l = Math.min(a1[0], a2[0]), b = Math.min(a1[1], a2[1]), w = Math.abs(a1[0] - a2[0]), h = Math.abs(a1[1] - a2[1]);
        page.setCropBox(l, b, w, h);
      }
      if (p.rot) page.setRotation(L.degrees(((page.getRotation().angle || 0) + p.rot) % 360));
    }
    out.setProducer("Veda AI PDF Editor");
    return out;
  }

  // pages ko sheet par ek saath lagao (vector — quality jas ki tas)
  async function buildSheets(L, bytes, o) {
    const src = await L.PDFDocument.load(bytes); const out = await L.PDFDocument.create(); const pages = src.getPages(); const n = o.n;
    const eff = (pg) => { const cb = pg.getCropBox ? pg.getCropBox() : pg.getMediaBox(); const R = ((pg.getRotation().angle || 0) % 360 + 360) % 360; return { cb, R, dw: R % 180 ? cb.height : cb.width, dh: R % 180 ? cb.width : cb.height }; };
    const base = PAPER[o.paper] || PAPER.a4;
    const trial = (land) => { const [pw, ph] = land ? [base[1], base[0]] : base; const [c, r] = GRID[n][land ? 1 : 0]; const cw = (pw - o.mg * 2 - o.gap * (c - 1)) / c, ch = (ph - o.mg * 2 - o.gap * (r - 1)) / r; const e = eff(pages[0]); return { land, pw, ph, c, r, cw, ch, sc: Math.min(cw / e.dw, ch / e.dh) }; };
    const a = trial(false), b = trial(true);
    const T = o.ori === "p" ? a : o.ori === "l" ? b : a.sc >= b.sc ? a : b;
    for (let s = 0; s < pages.length; s += n) {
      status(`⏳ Sheet ${Math.floor(s / n) + 1}/${Math.ceil(pages.length / n)}…`);
      const sh = out.addPage([T.pw, T.ph]);
      for (let k = 0; k < n && s + k < pages.length; k++) {
        const pg = pages[s + k], e = eff(pg);
        const ep = await out.embedPage(pg, { left: e.cb.x, bottom: e.cb.y, right: e.cb.x + e.cb.width, top: e.cb.y + e.cb.height });
        const col = k % T.c, row = Math.floor(k / T.c);
        const cx0 = o.mg + col * (T.cw + o.gap), cyTop = T.ph - o.mg - row * (T.ch + o.gap), cy0 = cyTop - T.ch;
        const sc = Math.min(T.cw / e.dw, T.ch / e.dh); const dw = e.dw * sc, dh = e.dh * sc, ew = e.cb.width * sc, eh = e.cb.height * sc;
        const left = cx0 + (T.cw - dw) / 2, bottom = cy0 + (T.ch - dh) / 2;
        let ax = left, ay = bottom;
        if (e.R === 90) { ay = bottom + ew; } else if (e.R === 180) { ax = left + ew; ay = bottom + eh; } else if (e.R === 270) { ax = left + eh; }
        sh.drawPage(ep, { x: ax, y: ay, width: ew, height: eh, rotate: L.degrees(-e.R) });
        if (o.border) sh.drawRectangle({ x: left, y: bottom, width: dw, height: dh, borderWidth: 0.6, borderColor: L.rgb(0.6, 0.6, 0.6) });
      }
    }
    out.setProducer("Veda AI PDF Editor");
    return out;
  }

  $("#svN").onchange = () => { const one = $("#svN").value === "1"; if (!one && $("#svPaper").value === "orig") $("#svPaper").value = "a4"; };
  $("#peSave").onclick = () => { if (!needDoc()) return; $("#svName").value = S.name + "-edited"; $("#peSaveDlg").hidden = false; };
  $("#svNo").onclick = () => ($("#peSaveDlg").hidden = true);
  let saving = false;
  $("#svGo").onclick = async () => {
    if (saving) return;
    const o = { n: +$("#svN").value, paper: $("#svPaper").value, ori: $("#svOri").value, mg: +$("#svMg").value, gap: +$("#svGap").value, border: $("#svBorder").checked };
    const fname = ($("#svName").value.trim() || S.name + "-edited").replace(/[\\/:*?"<>|]+/g, "_").replace(/\.pdf$/i, "") + ".pdf";
    $("#peSaveDlg").hidden = true; saving = true; $("#peSave").disabled = true;
    try {
      try { await document.fonts.load("20px 'Noto Sans Devanagari'", "अआक"); } catch {}
      const L = await loadPdfLib();
      let doc = await buildEdited(L);
      let bytes = await doc.save();
      if (o.n > 1 || o.paper !== "orig") { if (o.paper === "orig" && o.n === 1) {} else { doc = await buildSheets(L, bytes, o.n === 1 ? { ...o, n: 1 } : o); bytes = await doc.save(); } }
      showResult(bytes, fname);
      status("✅ Taiyar!");
    } catch (e) { status("⚠️ Save nahi hua: " + (e.message || e), true); }
    finally { saving = false; $("#peSave").disabled = false; }
  };
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

  /* ---------------- open / close ---------------- */
  const open = () => { A.closeAll(); modal.hidden = false; if (!S.pages.length) status("PDF kholo aur edit shuru karo."); else layout(); };
  $("#peClose").onclick = () => { if (askRes) closeAsk(null); $("#peDecoDlg").hidden = true; $("#peSaveDlg").hidden = true; modal.hidden = true; };
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  const ob = $("#openPdfEditor"); if (ob) ob.onclick = open;
  window.VedaPdfEditor = { open, openFile: async (f) => { open(); await addFiles([f], true); } };
  setTool("move"); refreshBtns();
})();
