// Veda AI - Image Studio + PDF Studio
// Ye sab tools phone/browser me hi chalte hain (internet/API ke bina), sirf "AI" wale buttons Gemini use karte hain.
(() => {
  "use strict";
  const A = window.VedaApp;
  if (!A) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(2) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  /* ---------------- DOM ---------------- */
  const modal = document.createElement("div");
  modal.id = "toolsModal"; modal.className = "modal"; modal.hidden = true;
  modal.innerHTML = `
  <div class="sheet tall">
    <div class="sheet-head"><h2>🧰 Image &amp; PDF Tools</h2><button class="icon-btn close" id="tlClose">✕</button></div>
    <div class="tabs"><button data-tab="img" class="on">🖼️ Image Studio</button><button data-tab="pdf">📄 PDF Studio</button></div>

    <div class="sheet-body tl-body" id="paneImg">
      <div class="tl-drop"><label class="btn primary" for="imFile">📂 Image chuno</label>
        <input type="file" id="imFile" accept="image/*" hidden>
        <small id="imInfo" class="small-note">Koi image nahi chuni. Chat ki image par 🧰 Studio dabake bhi aa sakte ho.</small></div>
      <div id="imWork" hidden>
        <div class="cv-wrap"><canvas id="imCv"></canvas></div>
        <div class="row-btns">
          <button class="btn ghost small" id="imUndo">↩️ Undo</button>
          <button class="btn ghost small" id="imRotL">⟲ 90°</button>
          <button class="btn ghost small" id="imRotR">⟳ 90°</button>
          <button class="btn ghost small" id="imFlipH">↔ Flip</button>
          <button class="btn ghost small" id="imFlipV">↕ Flip</button>
        </div>

        <details class="tl-sec"><summary>📝 Image se prompt</summary>
          <button class="btn ghost small wide" id="imToPrompt" style="text-align:center">Is image ko dekhkar uska prompt/vivaran likho</button>
        </details>

        <details class="tl-sec"><summary>🎚️ Rang / Roshni</summary>
          <div class="sliders" id="imAdj"></div>
          <div class="row-btns"><button class="btn ghost small" id="imAdjReset">Reset</button><button class="btn primary small" id="imAdjApply">Lagao</button></div>
        </details>

        <details class="tl-sec"><summary>✂️ Crop / Resize</summary>
          <div class="chips" id="imCrop"></div>
          <div class="grid2" style="margin-top:8px">
            <label class="field"><span>Chaudai (px)</span><input type="number" id="imW" min="16" max="8000"></label>
            <label class="field"><span>&nbsp;</span><button class="btn ghost small" id="imResize" style="text-align:center">Resize karo</button></label>
          </div>
          <div class="chips" id="imSizes"></div>
        </details>

        <details class="tl-sec"><summary>🔤 Text / Watermark lagao</summary>
          <label class="field"><input type="text" id="imTxt" placeholder="Jo likhna hai (Hindi bhi chalega)"></label>
          <div class="grid2">
            <label class="field"><span>Rang</span><input type="color" id="imTxtC" value="#ffffff" style="height:42px;padding:2px"></label>
            <label class="field"><span>Size (%)</span><input type="range" id="imTxtS" min="3" max="25" value="9"></label>
          </div>
          <div class="grid2">
            <label class="field"><span>Jagah</span><select id="imTxtP"><option value="b">Neeche</option><option value="m">Beech me</option><option value="t">Upar</option></select></label>
            <label class="field"><span>&nbsp;</span><button class="btn primary small" id="imTxtGo" style="text-align:center">Text lagao</button></label>
          </div>
        </details>

        <details class="tl-sec" open><summary>💾 Save / Bhejo</summary>
          <div class="grid2">
            <label class="field"><span>Format</span><select id="imFmt"><option value="image/png">PNG</option><option value="image/jpeg">JPG</option><option value="image/webp">WebP</option></select></label>
            <label class="field"><span>Quality: <b id="imQv">90</b></span><input type="range" id="imQ" min="30" max="100" value="90"></label>
          </div>
          <div id="imSize" class="small-note"></div>
          <div class="row-btns">
            <button class="btn primary small" id="imDl">⬇️ Download</button>
            <button class="btn ghost small" id="imChat">💬 Chat me bhejo</button>
            <button class="btn ghost small" id="imPdf">📄 PDF banao</button>
          </div>
        </details>
      </div>
    </div>

    <div class="sheet-body tl-body" id="panePdf" hidden>
      <div class="chips" id="pdTools"></div>
      <div id="pdPane"></div>
      <div id="pdOut" class="pd-out"></div>
    </div>
  </div>`;
  document.body.appendChild(modal);

  const open = (tab) => { A.closeAll(); modal.hidden = false; setTab(tab || "img"); };
  function setTab(t) {
    $$(".tabs button", modal).forEach((b) => b.classList.toggle("on", b.dataset.tab === t));
    $("#paneImg", modal).hidden = t !== "img"; $("#panePdf", modal).hidden = t !== "pdf";
    if (t === "pdf" && !$("#pdPane").children.length) pdfTool("merge");
  }
  $$(".tabs button", modal).forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $("#tlClose").onclick = () => (modal.hidden = true);
  modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
  const bindOpen = (sel, tab) => { const b = $(sel); if (b) b.onclick = () => open(tab); };
  bindOpen("#openTools"); bindOpen("#tTools");
  const stu = $("#imgStudio");
  if (stu) stu.onclick = async () => { const id = A.currentViewerId(); if (!id) return; $("#imgModal").hidden = true; open("img"); await loadFromRec(await A.loadFile(id)); };

  /* =====================  IMAGE STUDIO  ===================== */
  const cv = $("#imCv"); const ctx = cv.getContext("2d");
  let undo = [], baseName = "image", curAdj = null;
  const snap = () => { const c = document.createElement("canvas"); c.width = cv.width; c.height = cv.height; c.getContext("2d").drawImage(cv, 0, 0); return c; };
  function pushUndo() { undo.push(snap()); if (undo.length > 12) undo.shift(); }
  function setCanvas(c, keepUndo) {
    if (!keepUndo) pushUndo();
    cv.width = c.width; cv.height = c.height; ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(c, 0, 0);
    cv.style.filter = ""; $("#imW").value = cv.width; updInfo(); updSize();
  }
  function updInfo() { $("#imInfo").textContent = baseName + " · " + cv.width + "×" + cv.height + " px"; }
  function loadImg(url) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); }
  async function loadFromUrl(url, name) {
    try {
      const img = await loadImg(url);
      const sc = Math.min(1, 4096 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas"); c.width = Math.round(img.naturalWidth * sc); c.height = Math.round(img.naturalHeight * sc);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      undo = []; baseName = (name || "image").replace(/\.\w+$/, ""); setCanvas(c, true);
      $("#imWork").hidden = false; resetAdj();
    } catch { A.toast("Ye image khul nahi payi."); }
  }
  async function loadFromRec(rec) { if (!rec || !rec.data) return A.toast("Image nahi mili."); await loadFromUrl(A.recUrl(rec), rec.name); }
  $("#imFile").onchange = (e) => { const f = e.target.files[0]; if (f) loadFromUrl(URL.createObjectURL(f), f.name); e.target.value = ""; };

  /* adjust */
  const ADJ = [["brightness", "Roshni", 50, 160, 100], ["contrast", "Contrast", 50, 160, 100], ["saturate", "Rang gahra", 0, 220, 100], ["blur", "Blur", 0, 12, 0], ["grayscale", "Kala-safed", 0, 100, 0], ["sepia", "Sepia", 0, 100, 0]];
  $("#imAdj").innerHTML = ADJ.map(([k, l, mn, mx, d]) => `<label class="field"><span>${l}: <b id="v_${k}">${d}</b></span><input type="range" data-adj="${k}" min="${mn}" max="${mx}" value="${d}"></label>`).join("");
  function adjFilter() {
    return ADJ.map(([k]) => { const v = Number($(`[data-adj=${k}]`).value); return k === "blur" ? `blur(${v}px)` : `${k}(${v}%)`; }).join(" ");
  }
  function resetAdj() { ADJ.forEach(([k, , , , d]) => { $(`[data-adj=${k}]`).value = d; $("#v_" + k).textContent = d; }); cv.style.filter = ""; }
  $$("[data-adj]").forEach((i) => (i.oninput = () => { $("#v_" + i.dataset.adj).textContent = i.value; cv.style.filter = adjFilter(); }));
  $("#imAdjReset").onclick = resetAdj;
  $("#imAdjApply").onclick = () => {
    const c = snap(); const out = document.createElement("canvas"); out.width = c.width; out.height = c.height;
    const o = out.getContext("2d");
    if ("filter" in o) { o.filter = adjFilter(); o.drawImage(c, 0, 0); }
    else { // purane browser: simple pixel version (blur nahi)
      o.drawImage(c, 0, 0); const d = o.getImageData(0, 0, out.width, out.height), p = d.data;
      const g = (k) => Number($(`[data-adj=${k}]`).value) / 100;
      const br = g("brightness"), ct = g("contrast"), sa = g("saturate"), gr = g("grayscale") * 1, se = g("sepia");
      for (let i = 0; i < p.length; i += 4) {
        let r = p[i], gg = p[i + 1], b = p[i + 2];
        r *= br; gg *= br; b *= br;
        r = (r - 128) * ct + 128; gg = (gg - 128) * ct + 128; b = (b - 128) * ct + 128;
        const l = 0.3 * r + 0.59 * gg + 0.11 * b;
        r = l + (r - l) * sa; gg = l + (gg - l) * sa; b = l + (b - l) * sa;
        r = r + (l - r) * gr; gg = gg + (l - gg) * gr; b = b + (l - b) * gr;
        if (se) { const tr = 0.393 * r + 0.769 * gg + 0.189 * b, tg = 0.349 * r + 0.686 * gg + 0.168 * b, tb = 0.272 * r + 0.534 * gg + 0.131 * b; r += (tr - r) * se; gg += (tg - gg) * se; b += (tb - b) * se; }
        p[i] = r; p[i + 1] = gg; p[i + 2] = b;
      }
      o.putImageData(d, 0, 0);
    }
    setCanvas(out); resetAdj(); A.toast("Lag gaya");
  };

  /* transform */
  function transform(fn, w, h) {
    const src = snap(); const out = document.createElement("canvas"); out.width = w || src.width; out.height = h || src.height;
    fn(out.getContext("2d"), src, out); setCanvas(out);
  }
  $("#imRotR").onclick = () => transform((o, s, c) => { o.translate(c.width, 0); o.rotate(Math.PI / 2); o.drawImage(s, 0, 0); }, cv.height, cv.width);
  $("#imRotL").onclick = () => transform((o, s, c) => { o.translate(0, c.height); o.rotate(-Math.PI / 2); o.drawImage(s, 0, 0); }, cv.height, cv.width);
  $("#imFlipH").onclick = () => transform((o, s, c) => { o.translate(c.width, 0); o.scale(-1, 1); o.drawImage(s, 0, 0); });
  $("#imFlipV").onclick = () => transform((o, s, c) => { o.translate(0, c.height); o.scale(1, -1); o.drawImage(s, 0, 0); });
  $("#imUndo").onclick = () => { const c = undo.pop(); if (!c) return A.toast("Aur peeche nahi ja sakte"); setCanvas(c, true); };

  /* crop (center) */
  const CROPS = [["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["16:9", 16 / 9], ["9:16", 9 / 16], ["4:5", 4 / 5], ["3:2", 3 / 2]];
  $("#imCrop").innerHTML = CROPS.map(([l], i) => `<button class="chip" data-crop="${i}">${l}</button>`).join("");
  $$("[data-crop]").forEach((b) => (b.onclick = () => {
    const r = CROPS[b.dataset.crop][1]; let w = cv.width, h = cv.height;
    if (w / h > r) w = Math.round(h * r); else h = Math.round(w / r);
    const x = Math.round((cv.width - w) / 2), y = Math.round((cv.height - h) / 2);
    transform((o, s) => o.drawImage(s, x, y, w, h, 0, 0, w, h), w, h);
  }));
  const doResize = (w) => {
    w = Math.round(Number(w)); if (!w || w < 16 || w > 8000) return A.toast("Chaudai 16 se 8000 ke beech rakho.");
    const h = Math.round(cv.height * w / cv.width);
    transform((o, s) => { o.imageSmoothingQuality = "high"; o.drawImage(s, 0, 0, w, h); }, w, h);
  };
  $("#imResize").onclick = () => doResize($("#imW").value);
  $("#imSizes").innerHTML = [480, 720, 1080, 1920].map((w) => `<button class="chip" data-w="${w}">${w}px</button>`).join("");
  $$("[data-w]").forEach((b) => (b.onclick = () => doResize(b.dataset.w)));

  /* text */
  $("#imTxtGo").onclick = () => {
    const t = $("#imTxt").value.trim(); if (!t) return A.toast("Pehle text likho.");
    const sz = Math.round(cv.width * Number($("#imTxtS").value) / 100);
    transform((o, s, c) => {
      o.drawImage(s, 0, 0);
      o.font = `bold ${sz}px 'Noto Sans Devanagari','Mukta',system-ui,sans-serif`;
      o.textAlign = "center"; o.textBaseline = "middle";
      const pos = $("#imTxtP").value; const y = pos === "t" ? sz * 1.1 : pos === "m" ? c.height / 2 : c.height - sz * 1.1;
      o.lineWidth = Math.max(2, sz / 8); o.strokeStyle = "rgba(0,0,0,.65)"; o.lineJoin = "round";
      o.strokeText(t, c.width / 2, y, c.width * 0.94); o.fillStyle = $("#imTxtC").value; o.fillText(t, c.width / 2, y, c.width * 0.94);
    });
    $("#imTxt").value = "";
  };

  /* export */
  let sizeTimer;
  function updSize() {
    clearTimeout(sizeTimer);
    sizeTimer = setTimeout(() => {
      if (!cv.width) return;
      cv.toBlob((b) => { if (b) $("#imSize").textContent = "File size: lagbhag " + kb(b.size) + " (" + cv.width + "×" + cv.height + ")"; }, $("#imFmt").value, Number($("#imQ").value) / 100);
    }, 250);
  }
  $("#imQ").oninput = () => { $("#imQv").textContent = $("#imQ").value; updSize(); };
  $("#imFmt").onchange = updSize;
  const blobOf = () => new Promise((r) => {
    const fmt = $("#imFmt").value; let src = cv;
    if (fmt === "image/jpeg") { src = document.createElement("canvas"); src.width = cv.width; src.height = cv.height; const o = src.getContext("2d"); o.fillStyle = "#fff"; o.fillRect(0, 0, src.width, src.height); o.drawImage(cv, 0, 0); }
    src.toBlob(r, fmt, Number($("#imQ").value) / 100);
  });
  const extFor = (m) => (m === "image/jpeg" ? "jpg" : m.split("/")[1]);
  const b64 = (bytes) => { let s = ""; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); };
  const saveBlob = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  $("#imDl").onclick = async () => { const b = await blobOf(); saveBlob(b, baseName + "-edited." + extFor(b.type)); };
  async function recForAi(maxSide = 2048) {
    let src = cv; const sc = Math.min(1, maxSide / Math.max(cv.width, cv.height));
    if (sc < 1) { src = document.createElement("canvas"); src.width = Math.round(cv.width * sc); src.height = Math.round(cv.height * sc); src.getContext("2d").drawImage(cv, 0, 0, src.width, src.height); }
    const data = src.toDataURL("image/jpeg", 0.92).split(",")[1];
    return { id: A.uid(), name: baseName + ".jpg", mime: "image/jpeg", kind: "image", data, size: Math.round(data.length * 0.75) };
  }
  $("#imChat").onclick = async () => { A.attach(await recForAi()); modal.hidden = true; A.toast("Image chat me jud gayi. Ab kuch likho ya bhejo."); };
  $("#imPdf").onclick = async () => {
    const b = await blobOf(); const f = new File([b], baseName + "." + extFor(b.type), { type: b.type });
    setTab("pdf"); pdfTool("img2pdf"); addImgFiles([f]);
  };

  /* image -> prompt (sirf text jawab) */
  async function aiRun(prompt, opts) {
    if (A.busy()) return A.toast("Pehla kaam chal raha hai, thoda ruko.");
    A.attach(await recForAi()); modal.hidden = true; await A.send(prompt, opts);
  }
  $("#imToPrompt").onclick = () => aiRun(
    "Is image ko dhyan se dekho aur ek bahut achha, detailed ENGLISH prompt likho jisse koi AI image generator bilkul aisi hi image bana sake (subject, style, lighting, colors, camera/lens, composition, mood, background). " +
    "Pehle final prompt ek code block me do. Uske baad ek negative prompt code block me do. Phir Hindi me 2 line me batao ki kya dikh raha hai.", { forceText: true });

  /* =====================  PDF STUDIO  ===================== */
  let libP = null;
  function loadLib() {
    if (window.PDFLib) return Promise.resolve(window.PDFLib);
    if (libP) return libP;
    libP = new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = "pdf-lib.min.js";
      s.onload = () => res(window.PDFLib); s.onerror = () => { libP = null; rej(new Error("PDF engine load nahi hua. Internet check karo.")); };
      document.head.appendChild(s);
    });
    return libP;
  }
  const TOOLS = [["merge", "🔗 Jodo (Merge)"], ["pages", "📑 Pages (nikalo/hatao/ghumao)"], ["compress", "🗜️ Compress (halka karo)"], ["img2pdf", "🖼️ Image → PDF"], ["enhance", "✨ Enhance (scan saaf karo)"], ["nup", "🗐 N-up (ek sheet par 2/4 pages)"], ["mark", "💧 Watermark + Page no."], ["meta", "🏷️ Title / Author"], ["aiedit", "🤖 AI se Edit"]];
  $("#pdTools").innerHTML = TOOLS.map(([k, l]) => `<button class="chip" data-t="${k}">${l}</button>`).join("");
  $$("[data-t]").forEach((b) => (b.onclick = () => pdfTool(b.dataset.t)));
  const readBuf = (f) => f.arrayBuffer();
  function status(msg, bad) { const o = $("#pdOut"); o.innerHTML = msg ? `<div class="${bad ? "err" : "small-note"}">${esc(msg)}</div>` : ""; }
  function result(bytes, name, note) {
    const blob = new Blob([bytes], { type: "application/pdf" });
    const file = new File([bytes], name, { type: "application/pdf" });
    const o = $("#pdOut"); o.innerHTML = `<div class="pd-done"><b>✅ ${esc(name)}</b><small>${kb(bytes.length)}${note ? " · " + esc(note) : ""}</small><div class="row-btns"><button class="btn primary small" id="pdView">👁️ Kholo</button><button class="btn ghost small" id="pdPin">📌 Pin</button><button class="btn ghost small" id="pdLib">📚 Library</button><button class="btn ghost small" id="pdShare">🔗 Share</button><button class="btn ghost small" id="pdDl">⬇️ Download</button><button class="btn ghost small" id="pdChat">💬 AI padhe</button></div></div>`;
    $("#pdView").onclick = () => { modal.hidden = true; A.openPdf(file, name); };
    const libRec = () => ({ id: "pdf" + A.uid(), name, mime: "application/pdf", kind: "pdf", size: bytes.length, ts: Date.now(), data: b64(bytes) });
    $("#pdPin").onclick = async () => { try { const r = libRec(); r.pinned = true; await A.saveLib(r); A.toast("📌 Pin ho gaya — Library me sabse upar milega."); } catch (e) { A.toast("⚠️ Pin nahi ho paya."); } };
    $("#pdLib").onclick = async () => { try { await A.saveLib(libRec()); A.toast("📚 Library me save ho gaya (🧰 Tools ke paas Library button se kholo)."); } catch (e) { A.toast("⚠️ Save nahi ho paya."); } };
    $("#pdShare").onclick = async () => {
      try {
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
        if (navigator.share) { await navigator.share({ title: name, text: name }); return; }
      } catch (e) { if (e && e.name === "AbortError") return; }
      A.toast("Share nahi hua — Download karke Drive/WhatsApp me bhejo.");
    };
    $("#pdDl").onclick = () => saveBlob(blob, name);
    $("#pdChat").onclick = () => {
      if (bytes.length > 18 * 1048576) return A.toast("File 18MB se badi hai, chat me nahi ja sakti.");
      A.attach({ id: A.uid(), name, mime: "application/pdf", kind: "pdf", data: b64(bytes), size: bytes.length }); modal.hidden = true; A.toast("PDF chat me jud gayi.");
    };
  }
  async function run(label, fn) {
    status("⏳ " + label + "…");
    try { const L = await loadLib(); const r = await fn(L); if (r) result(r.bytes, r.name, r.note); }
    catch (e) { status("⚠️ " + (e.message || e), true); }
  }
  function parseRange(str, n) {
    const out = new Set(); const t = (str || "").replace(/\s+/g, "");
    if (!t) return [];
    for (const part of t.split(",")) {
      if (!part) continue;
      const m = part.match(/^(\d*)-(\d*)$/);
      if (m) { const a = m[1] ? +m[1] : 1, b = m[2] ? +m[2] : n; if (a < 1 || b > n || a > b) throw new Error(`Range "${part}" galat hai (PDF me ${n} page hain).`); for (let i = a; i <= b; i++) out.add(i - 1); }
      else if (/^\d+$/.test(part)) { const p = +part; if (p < 1 || p > n) throw new Error(`Page ${p} nahi hai (PDF me ${n} page hain).`); out.add(p - 1); }
      else throw new Error(`"${part}" samajh nahi aaya. Aise likho: 1-3,5,8-`);
    }
    return [...out].sort((a, b) => a - b);
  }
  const base = (n) => (n || "file").replace(/\.pdf$/i, "");
  let files = []; // current tool ka file list
  function listHtml(withOrder) {
    return files.map((f, i) => `<div class="pd-file"><span>${esc(f.name)} <small>${kb(f.size)}</small></span>${withOrder ? `<button data-up="${i}">↑</button><button data-dn="${i}">↓</button>` : ""}<button data-rm="${i}">✕</button></div>`).join("") || '<div class="small-note">Abhi koi file nahi.</div>';
  }
  function bindList(redraw) {
    $$("[data-up]").forEach((b) => (b.onclick = () => { const i = +b.dataset.up; if (i > 0) { [files[i - 1], files[i]] = [files[i], files[i - 1]]; redraw(); } }));
    $$("[data-dn]").forEach((b) => (b.onclick = () => { const i = +b.dataset.dn; if (i < files.length - 1) { [files[i + 1], files[i]] = [files[i], files[i + 1]]; redraw(); } }));
    $$("[data-rm]").forEach((b) => (b.onclick = () => { files.splice(+b.dataset.rm, 1); redraw(); }));
  }
  const picker = (id, accept, multi, label) => `<label class="btn primary" for="${id}">📂 ${label}</label><input type="file" id="${id}" accept="${accept}" ${multi ? "multiple" : ""} hidden>`;

  /* ---------- AI EDIT: natural-language PDF editing ----------
     Pipeline: PDF -> text nikalo (pdf.js) -> AI ko instruction + text -> AI poora
     naya HTML document banata hai -> doc modal me khulta hai -> PDF export.
     Scanned/image PDF ho to pages photos bana kar vision se karwate hain. */
  async function loadPdfJsT() {
    if (window.pdfjsLib) return window.pdfjsLib;
    await new Promise((res, rej) => {
      const s = document.createElement("script"); s.src = "pdf.min.js";
      s.onload = res; s.onerror = () => rej(new Error("PDF engine load nahi hua. Internet check karo."));
      document.head.appendChild(s);
    });
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "pdf.worker.min.js";
    return window.pdfjsLib;
  }
  async function extractPdfText(file) {
    const lib = await loadPdfJsT();
    const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const tc = await page.getTextContent();
      pages.push({ p: i, text: tc.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim() });
      if (page.cleanup) page.cleanup();
    }
    return pages;
  }
  const AIEDIT_PROMPT = (instr) =>
    `Is PDF me ye badlav karo: "${instr}". Poora naya DOCUMENT bana kar do — ek hi \`\`\`html code block me, <!DOCTYPE html> se shuru, A4 print ke liye, saara CSS <style> ke andar, koi bahari link/image/script nahi. ` +
    `Sirf wahi badlo jo bola gaya hai; baaki content, order aur design bilkul same rakho. Content poora likho, koi placeholder/'...' nahi. ` +
    `Code block ke bahar sirf ek chhoti line likho ki kya badla.`;
  async function aiEditGo(file, instr) {
    status("⏳ PDF padhi ja rahi hai…");
    const pages = await extractPdfText(file);
    const full = pages.map((pg) => `--- Page ${pg.p} ---\n${pg.text}`).join("\n\n");
    const textLen = full.replace(/--- Page \d+ ---/g, "").trim().length;
    if (textLen > 80) {
      const rec = {
        id: A.uid(), name: (file.name || "pdf").replace(/\.pdf$/i, "") + "-text.txt",
        mime: "text/plain", kind: "text", size: full.length,
        text: `PDF "${file.name}" ka nikala hua text (page-wise, isi order me):\n\n${full.slice(0, 400000)}`,
      };
      A.attach(rec); modal.hidden = true;
      await A.send(AIEDIT_PROMPT(instr));
    } else {
      // scanned/image PDF: pages ko photo bana kar vision se
      status("⏳ Scanned PDF hai — pages photos me badal raha hun…");
      const lib = await loadPdfJsT();
      const pdf = await lib.getDocument({ data: await file.arrayBuffer() }).promise;
      const n = Math.min(pdf.numPages, 12);
      for (let i = 1; i <= n; i++) {
        status(`⏳ Page ${i}/${n} photo ban rahi hai…`);
        const page = await pdf.getPage(i);
        const vp = page.getViewport({ scale: 1.6 });
        const cv = document.createElement("canvas"); cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
        await page.render({ canvasContext: cv.getContext("2d"), viewport: vp }).promise;
        const data = cv.toDataURL("image/jpeg", 0.85).split(",")[1];
        A.attach({ id: A.uid(), name: `page-${i}.jpg`, mime: "image/jpeg", kind: "image", data, size: Math.round(data.length * 0.75) });
        if (page.cleanup) page.cleanup();
      }
      modal.hidden = true;
      await A.send(`Ye ek PDF ("${file.name}") ke ${n} pages ki photos hain, kram se page 1 se ${n} tak. ` + AIEDIT_PROMPT(instr));
    }
  }

  let addImgFiles = () => {};
  function pdfTool(t) {
    files = []; status("");
    $$("[data-t]").forEach((b) => b.classList.toggle("on", b.dataset.t === t));
    const P = $("#pdPane");
    if (t === "merge") {
      P.innerHTML = `<p class="small-note">Kai PDF chuno, ↑↓ se order badlo, phir Jodo dabao.</p>${picker("pdF", "application/pdf,.pdf", true, "PDF chuno")}<div id="pdList" class="pd-list"></div><button class="btn primary wide" id="pdGo" style="margin-top:8px;text-align:center">🔗 Jodo</button>`;
      const redraw = () => { $("#pdList").innerHTML = listHtml(true); bindList(redraw); };
      $("#pdF").onchange = (e) => { files.push(...e.target.files); e.target.value = ""; redraw(); };
      redraw();
      $("#pdGo").onclick = () => {
        if (files.length < 2) return status("Kam se kam 2 PDF chuno.", true);
        run("PDF jud rahi hain", async (L) => {
          const out = await L.PDFDocument.create();
          for (const f of files) { const d = await L.PDFDocument.load(await readBuf(f), { ignoreEncryption: true }); (await out.copyPages(d, d.getPageIndices())).forEach((p) => out.addPage(p)); }
          return { bytes: await out.save(), name: "merged.pdf" };
        });
      };
    } else if (t === "pages") {
      P.innerHTML = `<p class="small-note">Ek PDF chuno. Pages aise likho: <b>1-3,5,8-</b> (khali chhodoge to saare pages).</p>${picker("pdF", "application/pdf,.pdf", false, "PDF chuno")}<div id="pdList" class="pd-list"></div>
        <label class="field"><span>Pages</span><input type="text" id="pdRange" placeholder="jaise 1-3,5"></label>
        <div class="row-btns"><button class="btn primary small" id="pdExtract">Sirf ye pages rakho</button><button class="btn ghost small" id="pdDelete">Ye pages hatao</button></div>
        <div class="row-btns" style="margin-top:6px"><button class="btn ghost small" data-rot="90">⟳ 90°</button><button class="btn ghost small" data-rot="180">⟳ 180°</button><button class="btn ghost small" data-rot="270">⟲ 90°</button><button class="btn ghost small" id="pdRev">⇅ Ulta order</button><button class="btn ghost small" id="pdDup">⧉ Duplicate</button></div>`;
      const redraw = () => { $("#pdList").innerHTML = listHtml(false); bindList(redraw); };
      $("#pdF").onchange = async (e) => { files = [e.target.files[0]].filter(Boolean); e.target.value = ""; redraw(); if (files[0]) { try { const L = await loadLib(); const d = await L.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true }); status("📄 " + d.getPageCount() + " page hain."); } catch (er) { status("⚠️ " + er.message, true); } } };
      redraw();
      const need = () => { if (!files[0]) { status("Pehle PDF chuno.", true); return false; } return true; };
      const edit = (label, fn, suffix) => { if (!need()) return; run(label, async (L) => { const src = await L.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true }); const out = await fn(L, src); return { bytes: await out.save(), name: base(files[0].name) + suffix + ".pdf" }; }); };
      $("#pdExtract").onclick = () => edit("Pages nikal raha hun", async (L, src) => { const idx = parseRange($("#pdRange").value, src.getPageCount()); if (!idx.length) throw new Error("Pages likho, jaise 1-3,5"); const o = await L.PDFDocument.create(); (await o.copyPages(src, idx)).forEach((p) => o.addPage(p)); return o; }, "-selected");
      $("#pdDelete").onclick = () => edit("Pages hata raha hun", async (L, src) => { const n = src.getPageCount(); const idx = parseRange($("#pdRange").value, n); if (!idx.length) throw new Error("Hatane wale pages likho, jaise 2,4-5"); if (idx.length >= n) throw new Error("Saare pages nahi hata sakte."); [...idx].reverse().forEach((i) => src.removePage(i)); return src; }, "-trimmed");
      $$("[data-rot]").forEach((b) => (b.onclick = () => edit("Pages ghuma raha hun", async (L, src) => { const n = src.getPageCount(); let idx = parseRange($("#pdRange").value, n); if (!idx.length) idx = src.getPageIndices(); idx.forEach((i) => { const p = src.getPage(i); p.setRotation(L.degrees((p.getRotation().angle + Number(b.dataset.rot)) % 360)); }); return src; }, "-rotated")));
      $("#pdRev").onclick = () => edit("Order ulta kar raha hun", async (L, src) => { const o = await L.PDFDocument.create(); (await o.copyPages(src, src.getPageIndices().reverse())).forEach((p) => o.addPage(p)); return o; }, "-reversed");
      $("#pdDup").onclick = () => edit("Pages duplicate kar raha hun", async (L, src) => {
        const n = src.getPageCount(); let idx = parseRange($("#pdRange").value, n); if (!idx.length) idx = src.getPageIndices();
        const o = await L.PDFDocument.create();
        (await o.copyPages(src, src.getPageIndices())).forEach((p) => o.addPage(p));
        (await o.copyPages(src, idx)).forEach((p) => o.addPage(p));
        return o;
      }, "-dup");
    } else if (t === "compress") {
      /* ---------- COMPRESS: PDF halka karo (object streams + safai) ---------- */
      P.innerHTML = `<p class="small-note">PDF ko halka karo. Kitna chhota hoga ye PDF par nirbhar hai — result me pehle/baad ka size imaandari se dikhega.</p>${picker("pdF", "application/pdf,.pdf", false, "PDF chuno")}<div id="pdList" class="pd-list"></div>
        <button class="btn primary wide" id="pdGo" style="margin-top:8px;text-align:center">🗜️ Compress karo</button>`;
      const redrawC = () => { $("#pdList").innerHTML = listHtml(false); bindList(redrawC); };
      $("#pdF").onchange = (e) => { files = [e.target.files[0]].filter(Boolean); e.target.value = ""; redrawC(); };
      redrawC();
      $("#pdGo").onclick = () => {
        if (!files[0]) return status("Pehle PDF chuno.", true);
        run("Compress ho raha hai", async (L) => {
          const srcBytes = new Uint8Array(await readBuf(files[0]));
          const src = await L.PDFDocument.load(srcBytes, { ignoreEncryption: true });
          const bytes = await src.save({ useObjectStreams: true });
          const before = srcBytes.length, after = bytes.length;
          const saved = Math.round((1 - after / before) * 100);
          const note = after < before ? kb(before) + " → " + kb(after) + " (" + saved + "% chhota)" : "pehle se optimized (" + kb(before) + ")";
          return { bytes, name: base(files[0].name) + "-compressed.pdf", note };
        });
      };
    } else if (t === "img2pdf") {
      P.innerHTML = `<p class="small-note">Photos chuno (ek ya zyada), order set karo, PDF banao. Scan/notes ke liye bhi kaam aata hai.</p>${picker("pdF", "image/*", true, "Photos chuno")}<div id="pdList" class="pd-list"></div>
        <div class="grid2"><label class="field"><span>Page size</span><select id="pdSize"><option value="a4">A4 (seedha)</option><option value="fit">Photo jitna bada</option></select></label>
        <label class="field"><span>Margin</span><select id="pdMargin"><option value="0">Koi nahi</option><option value="18" selected>Chhota</option><option value="36">Bada</option></select></label></div>
        <button class="btn primary wide" id="pdGo" style="text-align:center">📄 PDF banao</button>`;
      const redraw = () => { $("#pdList").innerHTML = listHtml(true); bindList(redraw); };
      addImgFiles = (fs) => { files.push(...fs); redraw(); };
      $("#pdF").onchange = (e) => { addImgFiles([...e.target.files]); e.target.value = ""; };
      redraw();
      $("#pdGo").onclick = () => {
        if (!files.length) return status("Pehle photos chuno.", true);
        run("PDF ban rahi hai", async (L) => {
          const out = await L.PDFDocument.create(); const mg = Number($("#pdMargin").value), fit = $("#pdSize").value === "fit";
          for (const f of files) {
            let bytes, kind;
            if (f.type === "image/png") { bytes = new Uint8Array(await readBuf(f)); kind = "png"; }
            else if (f.type === "image/jpeg") { bytes = new Uint8Array(await readBuf(f)); kind = "jpg"; }
            else { // webp/heic etc -> jpeg
              const img = await loadImg(URL.createObjectURL(f)); const c = document.createElement("canvas"); c.width = img.naturalWidth; c.height = img.naturalHeight;
              const o = c.getContext("2d"); o.fillStyle = "#fff"; o.fillRect(0, 0, c.width, c.height); o.drawImage(img, 0, 0);
              bytes = new Uint8Array(await (await new Promise((r) => c.toBlob(r, "image/jpeg", 0.92))).arrayBuffer()); kind = "jpg";
            }
            const im = kind === "png" ? await out.embedPng(bytes) : await out.embedJpg(bytes);
            if (fit) { const pg = out.addPage([im.width + mg * 2, im.height + mg * 2]); pg.drawImage(im, { x: mg, y: mg, width: im.width, height: im.height }); }
            else {
              const W = 595.28, H = 841.89, land = im.width > im.height * 1.15; const pw = land ? H : W, ph = land ? W : H;
              const pg = out.addPage([pw, ph]); const s = Math.min((pw - mg * 2) / im.width, (ph - mg * 2) / im.height);
              const w = im.width * s, h = im.height * s; pg.drawImage(im, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
            }
          }
          return { bytes: await out.save(), name: "images.pdf" };
        });
      };
    } else if (t === "enhance") {
      /* ---------- ENHANCE: scanned/photo PDF saaf karo ----------
         Har page ko photo bana kar pixel-level safai: background safed
         (whiten/threshold), contrast tez, black & white. Yehi asli
         "background remove" takneek hai scan wale pages ke liye. */
      P.innerHTML = `<p class="small-note">Scanned ya photo wali PDF ke pages saaf karo — background safed, akshar gehre. (40 pages tak)</p>${picker("pdF", "application/pdf,.pdf", false, "PDF chuno")}<div id="pdList" class="pd-list"></div>
        <div class="grid2">
          <label class="field"><span>Background safed: <b id="ehWv">82</b>%</span><input type="range" id="ehW" min="40" max="100" value="82"></label>
          <label class="field"><span>Contrast tez: <b id="ehCv">50</b>%</span><input type="range" id="ehC" min="0" max="100" value="50"></label>
        </div>
        <label class="check"><input type="checkbox" id="ehG" checked> Black &amp; white karo</label>
        <button class="btn primary wide" id="pdGo" style="margin-top:8px;text-align:center">✨ Enhance karo</button>`;
      const redrawEh = () => { $("#pdList").innerHTML = listHtml(false); bindList(redrawEh); };
      $("#pdF").onchange = (e) => { files = [e.target.files[0]].filter(Boolean); e.target.value = ""; redrawEh(); };
      $("#ehW").oninput = () => ($("#ehWv").textContent = $("#ehW").value);
      $("#ehC").oninput = () => ($("#ehCv").textContent = $("#ehC").value);
      redrawEh();
      $("#pdGo").onclick = () => {
        if (!files[0]) return status("Pehle PDF chuno.", true);
        const white = Number($("#ehW").value), contrast = Number($("#ehC").value), bw = $("#ehG").checked;
        run("Enhance ho raha hai", async (L) => {
          const lib = await loadPdfJsT();
          const pdf = await lib.getDocument({ data: await readBuf(files[0]) }).promise;
          const n = pdf.numPages;
          if (n > 40) throw new Error("40 se zyada pages hain — pehle Pages tool se hissa nikalo.");
          const out = await L.PDFDocument.create();
          const thr = 255 * (white / 100), cf = 1 + (contrast / 100) * 1.6;
          for (let i = 1; i <= n; i++) {
            status(`✨ Page ${i}/${n} saaf ho raha hai…`);
            const page = await pdf.getPage(i);
            const vp = page.getViewport({ scale: 2 });
            const cv = document.createElement("canvas");
            cv.width = Math.floor(vp.width); cv.height = Math.floor(vp.height);
            const ctx = cv.getContext("2d");
            ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, cv.width, cv.height);
            await page.render({ canvasContext: ctx, viewport: vp }).promise;
            const img = ctx.getImageData(0, 0, cv.width, cv.height), d = img.data;
            for (let p = 0; p < d.length; p += 4) {
              if (bw) {
                let g = 0.299 * d[p] + 0.587 * d[p + 1] + 0.114 * d[p + 2];
                g = 128 + (g - 128) * cf;
                if (g > thr) g = 255; else if (g < 0) g = 0; else if (g > 255) g = 255;
                d[p] = d[p + 1] = d[p + 2] = g;
              } else {
                const m = (d[p] + d[p + 1] + d[p + 2]) / 3;
                if (m > thr) d[p] = d[p + 1] = d[p + 2] = 255;
              }
            }
            ctx.putImageData(img, 0, 0);
            if (page.cleanup) page.cleanup();
            const jpg = await new Promise((r) => cv.toBlob(r, "image/jpeg", 0.88));
            const im = await out.embedJpg(new Uint8Array(await jpg.arrayBuffer()));
            const pg = out.addPage([im.width, im.height]);
            pg.drawImage(im, { x: 0, y: 0, width: im.width, height: im.height });
          }
          return { bytes: await out.save(), name: base(files[0].name) + "-enhanced.pdf" };
        });
      };
    } else if (t === "nup") {
      /* ---------- N-UP: ek sheet par 2 ya 4 pages ---------- */
      P.innerHTML = `<p class="small-note">Ek PDF chuno — uske pages ek hi sheet par chhote-chhote lag jayenge (print me kagaz bachta hai).</p>${picker("pdF", "application/pdf,.pdf", false, "PDF chuno")}<div id="pdList" class="pd-list"></div>
        <label class="field"><span>Ek sheet par kitne pages</span><select id="nupN"><option value="2">2 pages (aamne-saamne)</option><option value="4" selected>4 pages (2 × 2)</option></select></label>
        <button class="btn primary wide" id="pdGo" style="margin-top:8px;text-align:center">🗐 N-up PDF banao</button>`;
      const redrawNu = () => { $("#pdList").innerHTML = listHtml(false); bindList(redrawNu); };
      $("#pdF").onchange = (e) => { files = [e.target.files[0]].filter(Boolean); e.target.value = ""; redrawNu(); };
      redrawNu();
      $("#pdGo").onclick = () => {
        if (!files[0]) return status("Pehle PDF chuno.", true);
        const per = Number($("#nupN").value);
        run("N-up ban raha hai", async (L) => {
          const src = await L.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true });
          const out = await L.PDFDocument.create();
          const n = src.getPageCount();
          const W = 595.28, H = 841.89, cols = 2, rows = per === 2 ? 1 : 2;
          const cw = W / cols, ch = H / rows;
          for (let i = 0; i < n; i += per) {
            const pg = out.addPage([W, H]);
            for (let k = 0; k < per && i + k < n; k++) {
              const ep = await out.embedPage(src.getPage(i + k));
              const s = Math.min(cw / ep.width, ch / ep.height);
              const w = ep.width * s, h = ep.height * s;
              const col = k % cols, row = Math.floor(k / cols);
              const x = col * cw + (cw - w) / 2, y = H - (row + 1) * ch + (ch - h) / 2;
              pg.drawRectangle({ x: col * cw + 3, y: H - (row + 1) * ch + 3, width: cw - 6, height: ch - 6, borderWidth: 1, borderColor: L.rgb(0.72, 0.72, 0.72) });
              pg.drawPage(ep, { x, y, width: w, height: h });
            }
          }
          return { bytes: await out.save(), name: base(files[0].name) + "-nup.pdf" };
        });
      };
    } else if (t === "mark") {
      P.innerHTML = `<p class="small-note">Har page par watermark (Hindi/English koi bhi text) aur/ya page number lagao.</p>${picker("pdF", "application/pdf,.pdf", false, "PDF chuno")}<div id="pdList" class="pd-list"></div>
        <label class="field"><span>Watermark text (khali = nahi)</span><input type="text" id="wmT" placeholder="जैसे: शैलेश सर  /  CONFIDENTIAL"></label>
        <div class="grid2"><label class="field"><span>Halkapan (opacity): <b id="wmOv">20</b>%</span><input type="range" id="wmO" min="5" max="80" value="20"></label>
        <label class="field"><span>Tirchhapan</span><select id="wmA"><option value="45">45°</option><option value="0">Seedha</option><option value="90">90°</option></select></label></div>
        <label class="check"><input type="checkbox" id="pnOn"> Page number lagao (Page 1 / 5)</label>
        <button class="btn primary wide" id="pdGo" style="margin-top:8px;text-align:center">💧 Lagao</button>`;
      const redraw = () => { $("#pdList").innerHTML = listHtml(false); bindList(redraw); };
      $("#pdF").onchange = (e) => { files = [e.target.files[0]].filter(Boolean); e.target.value = ""; redraw(); };
      $("#wmO").oninput = () => ($("#wmOv").textContent = $("#wmO").value);
      redraw();
      $("#pdGo").onclick = () => {
        if (!files[0]) return status("Pehle PDF chuno.", true);
        const txt = $("#wmT").value.trim(), num = $("#pnOn").checked;
        if (!txt && !num) return status("Watermark text likho ya page number chuno.", true);
        run("Lagaya ja raha hai", async (L) => {
          const doc = await L.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true });
          const font = await doc.embedFont(L.StandardFonts.Helvetica); const pages = doc.getPages(); let wm = null;
          if (txt) { // text ko image bana ke lagate hain, isse Hindi bhi chalti hai
            const c = document.createElement("canvas"); c.width = 1400; c.height = 360; const o = c.getContext("2d");
            o.font = "bold 150px 'Noto Sans Devanagari','Mukta',system-ui,sans-serif"; o.textAlign = "center"; o.textBaseline = "middle"; o.fillStyle = "#6b6b6b";
            let px = 150; while (o.measureText(txt).width > 1300 && px > 30) { px -= 10; o.font = `bold ${px}px 'Noto Sans Devanagari','Mukta',system-ui,sans-serif`; }
            o.fillText(txt, 700, 180);
            wm = await doc.embedPng(await (await new Promise((r) => c.toBlob(r, "image/png"))).arrayBuffer());
          }
          const ang = Number($("#wmA").value), op = Number($("#wmO").value) / 100;
          pages.forEach((p, i) => {
            const { width: w, height: h } = p.getSize();
            if (wm) {
              const dw = Math.min(w, h) * 0.8, dh = dw * (wm.height / wm.width), rad = ang * Math.PI / 180;
              // center par rotate: corner ko offset karo
              const x = w / 2 - (dw / 2) * Math.cos(rad) + (dh / 2) * Math.sin(rad), y = h / 2 - (dw / 2) * Math.sin(rad) - (dh / 2) * Math.cos(rad);
              p.drawImage(wm, { x, y, width: dw, height: dh, rotate: L.degrees(ang), opacity: op });
            }
            if (num) { const s = `Page ${i + 1} / ${pages.length}`; const sz = 10; p.drawText(s, { x: w / 2 - font.widthOfTextAtSize(s, sz) / 2, y: 18, size: sz, font, color: L.rgb(0.35, 0.35, 0.35) }); }
          });
          return { bytes: await doc.save(), name: base(files[0].name) + "-marked.pdf" };
        });
      };
    } else if (t === "meta") {
      P.innerHTML = `<p class="small-note">PDF ka Title / Author badlo (file ke andar ka naam jo viewers dikhate hain).</p>${picker("pdF", "application/pdf,.pdf", false, "PDF chuno")}<div id="pdList" class="pd-list"></div>
        <label class="field"><span>Title</span><input type="text" id="mdT"></label><label class="field"><span>Author</span><input type="text" id="mdA"></label>
        <button class="btn primary wide" id="pdGo" style="margin-top:8px;text-align:center">🏷️ Save</button>`;
      const redraw = () => { $("#pdList").innerHTML = listHtml(false); bindList(redraw); };
      $("#pdF").onchange = async (e) => {
        files = [e.target.files[0]].filter(Boolean); e.target.value = ""; redraw();
        if (files[0]) { try { const L = await loadLib(); const d = await L.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true, updateMetadata: false }); $("#mdT").value = d.getTitle() || ""; $("#mdA").value = d.getAuthor() || ""; } catch (er) { status("⚠️ " + er.message, true); } }
      };
      redraw();
      $("#pdGo").onclick = () => {
        if (!files[0]) return status("Pehle PDF chuno.", true);
        run("Save ho raha hai", async (L) => { const d = await L.PDFDocument.load(await readBuf(files[0]), { ignoreEncryption: true }); d.setTitle($("#mdT").value); d.setAuthor($("#mdA").value); return { bytes: await d.save(), name: base(files[0].name) + "-info.pdf" }; });
      };
    } else if (t === "aiedit") {
      P.innerHTML = `<p class="small-note">PDF chuno, phir aam bhasha me batao kya badalna hai.<br>Jaise: <i>"heading neeli kar do"</i> · <i>"page 2 ka paragraph hatao"</i> · <i>"har page par footer lagao"</i> · <i>"professional book format banao"</i></p>` +
        picker("pdF", "application/pdf,.pdf", false, "PDF chuno") + '<div id="pdList" class="pd-list"></div>' +
        '<label class="field"><span>Instruction (likho ya bolo)</span><div class="input-row"><input type="text" id="nlInstr" placeholder="jaise: heading neeli kar do" style="flex:1"><button id="nlMic" class="round mic" title="Bolkar batao">🎤</button></div></label>' +
        '<button class="btn primary wide" id="pdGo" style="text-align:center">✨ AI se Edit karwao</button>' +
        '<p class="small-note">AI poora naya document banayega jo preview me khulega — wahan se PDF save karo.</p>';
      const redraw = () => { $("#pdList").innerHTML = listHtml(false); bindList(redraw); };
      $("#pdF").onchange = (e) => { files = [e.target.files[0]].filter(Boolean); e.target.value = ""; redraw(); };
      $("#nlMic").onclick = () => A.mic($("#nlInstr"), $("#nlMic"));
      redraw();
      $("#pdGo").onclick = async () => {
        if (!files[0]) return status("Pehle PDF chuno.", true);
        const instr = $("#nlInstr").value.trim();
        if (!instr) return status("Instruction likho ya mic dabakar bolo.", true);
        if (A.busy()) return status("Pehla kaam chal raha hai, thoda ruko.", true);
        try { await aiEditGo(files[0], instr); }
        catch (e) { status("⚠️ " + (e.message || e), true); }
      };
    }
  }
})();
