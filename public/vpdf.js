/* =========================================================================
 * Veda AI — VPDF design system (v1.1)
 * Tiny markup -> themed, print-ready HTML for the client PDF pipeline.
 *
 * Pure string building, NO DOM: runs in the browser AND in Node tests.
 * Unknown / malformed markup degrades to plain paragraphs — never crashes,
 * never a blank page.
 *
 * Markup quick reference (taught to the AI in DOC_RULES):
 *   theme: navy-gold            (navy-gold | ocean | emerald | sunset | minimal)
 *   [cover]  # शीर्षक  उपशीर्षक  [/cover]
 *   ## heading   ### chhoti heading
 *   - bullet    1. numbered    **bold**  *italic*  `code`
 *   [c:blue]rang[/c]            (red/blue/green/gold/purple/orange)
 *   ::: highlight|note|warn|def|formula  ...  :::
 *   | a | b |  tables (pehli line = header)
 *   [mcq] Q:.. (a).. (b).. (c).. (d).. उत्तर: (b) .. [/mcq]
 *   [diagram type=flow|vflow|layers|cycle title=".."] A -> B -> C [/diagram]
 *   ---  (divider)
 * ========================================================================= */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.VPDF = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var DEFAULT_THEME = "navy-gold";

  /* ------------------------------ themes ------------------------------ */
  var THEMES = {
    "navy-gold": {
      label: "रॉयल नेवी-गोल्ड", swatch: "#16264a",
      cover1: "#1b2c56", cover2: "#0a142e", coverText: "#ffffff", coverAccent: "#e8c34a",
      hBand: "#16264a", hBandText: "#ffffff", h3c: "#16264a", accent: "#b8912a",
      thBg: "#16264a", thText: "#ffffff", zebra: "#f6f3e9",
      hl:      { b: "#b8912a", f: "#fdf8e6", t: "#7a5f14" },
      note:    { b: "#2f6fed", f: "#eaf1fe", t: "#1a46b8" },
      warn:    { b: "#c0392b", f: "#fdecea", t: "#96281b" },
      def:     { b: "#1f7a5c", f: "#e7f5ef", t: "#145a43" },
      formula: { b: "#6c3483", f: "#f3eaf9", t: "#4a235a" },
      divider: "#d4af37", footLine: "#b8912a", optLetter: "#16264a"
    },
    "ocean": {
      label: "महासागर नीला", swatch: "#0b5394",
      cover1: "#0e5da6", cover2: "#073a6b", coverText: "#ffffff", coverAccent: "#7fd4ff",
      hBand: "#0b5394", hBandText: "#ffffff", h3c: "#0b5394", accent: "#0288d1",
      thBg: "#0b5394", thText: "#ffffff", zebra: "#e9f5fd",
      hl:      { b: "#0288d1", f: "#e9f7ff", t: "#01579b" },
      note:    { b: "#2f6fed", f: "#eaf1fe", t: "#1a46b8" },
      warn:    { b: "#c0392b", f: "#fdecea", t: "#96281b" },
      def:     { b: "#1f7a5c", f: "#e7f5ef", t: "#145a43" },
      formula: { b: "#6c3483", f: "#f3eaf9", t: "#4a235a" },
      divider: "#29b6f6", footLine: "#0288d1", optLetter: "#0b5394"
    },
    "emerald": {
      label: "हरित अध्ययन", swatch: "#0d6e4f",
      cover1: "#10805d", cover2: "#084d37", coverText: "#ffffff", coverAccent: "#a7e3c5",
      hBand: "#0d6e4f", hBandText: "#ffffff", h3c: "#0d6e4f", accent: "#0a8f63",
      thBg: "#0d6e4f", thText: "#ffffff", zebra: "#e9f7f1",
      hl:      { b: "#c9a227", f: "#fdf8e6", t: "#7a5f14" },
      note:    { b: "#2f6fed", f: "#eaf1fe", t: "#1a46b8" },
      warn:    { b: "#c0392b", f: "#fdecea", t: "#96281b" },
      def:     { b: "#1f7a5c", f: "#e7f5ef", t: "#145a43" },
      formula: { b: "#6c3483", f: "#f3eaf9", t: "#4a235a" },
      divider: "#35b57e", footLine: "#0a8f63", optLetter: "#0d6e4f"
    },
    "sunset": {
      label: "सूर्यास्त", swatch: "#b34700",
      cover1: "#c65a12", cover2: "#7a2f00", coverText: "#ffffff", coverAccent: "#ffd9a0",
      hBand: "#b34700", hBandText: "#ffffff", h3c: "#b34700", accent: "#d35400",
      thBg: "#b34700", thText: "#ffffff", zebra: "#fdf0e3",
      hl:      { b: "#d35400", f: "#fef3e6", t: "#8f3a07" },
      note:    { b: "#2f6fed", f: "#eaf1fe", t: "#1a46b8" },
      warn:    { b: "#c0392b", f: "#fdecea", t: "#96281b" },
      def:     { b: "#1f7a5c", f: "#e7f5ef", t: "#145a43" },
      formula: { b: "#6c3483", f: "#f3eaf9", t: "#4a235a" },
      divider: "#e8762b", footLine: "#d35400", optLetter: "#b34700"
    },
    "minimal": {
      label: "सादा", swatch: "#2b2f36",
      cover1: "#33373f", cover2: "#14161b", coverText: "#ffffff", coverAccent: "#9aa0aa",
      hBand: "#2b2f36", hBandText: "#ffffff", h3c: "#2b2f36", accent: "#6b7280",
      thBg: "#2b2f36", thText: "#ffffff", zebra: "#f4f5f7",
      hl:      { b: "#6b7280", f: "#f4f5f7", t: "#374151" },
      note:    { b: "#4b5563", f: "#f3f4f6", t: "#1f2937" },
      warn:    { b: "#9ca3af", f: "#f9fafb", t: "#4b5563" },
      def:     { b: "#6b7280", f: "#f4f5f7", t: "#374151" },
      formula: { b: "#4b5563", f: "#f3f4f6", t: "#1f2937" },
      divider: "#c9cede", footLine: "#6b7280", optLetter: "#2b2f36"
    }
  };

  var BOX_TITLES = {
    highlight: "⭐ मुख्य बिंदु", note: "📝 नोट", warn: "⚠️ ध्यान दें",
    def: "📖 परिभाषा", formula: "∑ सूत्र"
  };
  var INLINE_COLORS = { red: 1, blue: 1, green: 1, gold: 1, purple: 1, orange: 1 };

  /* ------------------------------ helpers ------------------------------ */
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;")
      .replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, "&#39;"); }
  function stripTags(s) { return String(s || "").replace(/<[^>]+>/g, ""); }
  function hexRgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16) || 0;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  function themeOf(key) { return THEMES[key] || THEMES[DEFAULT_THEME]; }

  function inlineFmt(s) {
    var h = escapeHtml(s);
    h = h.replace(/\[c:([a-z]+)\]([\s\S]*?)\[\/c\]/gi, function (m, c, x) {
      c = String(c).toLowerCase();
      return INLINE_COLORS[c] ? '<span class="tx-' + c + '">' + x + "</span>" : x;
    });
    h = h.replace(/\*\*([^*][\s\S]*?)\*\*/g, "<b>$1</b>");
    h = h.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    h = h.replace(/`([^`\n]+)`/g, '<code class="vpdf-code">$1</code>');
    return h;
  }

  /* ------------------------------ theme CSS ------------------------------ */
  function themeCss(key) {
    var T = themeOf(key);
    var css =
      ".vpdf{font-family:'Noto Sans Devanagari','Mukta',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#1b1f2a;line-height:1.65;font-size:12.5pt;}" +
      ".vpdf p{margin:8px 0;}" +
      ".vpdf-cover{height:1010px;min-height:1010px;background:linear-gradient(135deg," + T.cover1 + " 0%," + T.cover2 + " 100%);color:" + T.coverText + ";border-radius:12px;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:60px 48px;page-break-after:always;box-sizing:border-box;}" +
      ".vpdf-cover h1{font-size:32pt;line-height:1.35;margin:0 0 16px;color:" + T.coverText + ";}" +
      ".vpdf-cover .vrule{width:120px;height:4px;background:" + T.coverAccent + ";border-radius:2px;margin:0 auto 22px;}" +
      ".vpdf-cover .vsub{font-size:14pt;opacity:.93;margin:5px 0;line-height:1.6;}" +
      ".vpdf-cover .vby{margin-top:46px;font-size:10.5pt;letter-spacing:3px;opacity:.85;}" +
      "h1.vpdf-h1{background:" + T.hBand + ";color:" + T.hBandText + ";padding:12px 18px;border-radius:8px;border-top:5px solid " + T.accent + ";font-size:19pt;margin:26px 0 14px;page-break-after:avoid;}" +
      "h2.vpdf-h2{background:" + T.hBand + ";color:" + T.hBandText + ";padding:10px 16px;border-radius:7px;border-bottom:4px solid " + T.accent + ";font-size:16pt;margin:24px 0 12px;page-break-after:avoid;}" +
      "h3.vpdf-h3{color:" + T.h3c + ";border-bottom:2.5px solid " + T.accent + ";padding-bottom:5px;font-size:13.5pt;margin:18px 0 10px;page-break-after:avoid;}" +
      ".vpdf-box{border-radius:9px;padding:12px 15px;margin:13px 0;page-break-inside:avoid;border:1.5px solid;}" +
      ".vpdf-table{width:100%;border-collapse:collapse;margin:13px 0;font-size:11.5pt;}" +
      ".vpdf-table th{background:" + T.thBg + ";color:" + T.thText + ";padding:8px 11px;text-align:left;}" +
      ".vpdf-table td{padding:7px 11px;border:1px solid #d8dce6;vertical-align:top;}" +
      ".vpdf-table tr:nth-child(even) td{background:" + T.zebra + ";}" +
      ".vpdf-table tr{page-break-inside:avoid;}" +
      ".vpdf-mcq{border:1.5px solid #d8dce6;border-left:5px solid " + T.accent + ";border-radius:9px;padding:11px 15px;margin:12px 0;page-break-inside:avoid;background:#ffffff;}" +
      ".vpdf-mcq .vq{font-weight:700;margin-bottom:8px;}" +
      ".vpdf-mcq .vqn{display:inline-block;background:" + T.hBand + ";color:" + T.hBandText + ";border-radius:5px;padding:1px 10px;margin-right:8px;font-size:10.5pt;}" +
      ".vpdf-opts{display:grid;grid-template-columns:1fr 1fr;gap:5px 16px;margin-top:6px;}" +
      ".vpdf-opt b{color:" + T.optLetter + ";margin-right:6px;}" +
      ".vpdf-hr{border:0;border-top:3px solid " + T.divider + ";width:34%;margin:22px auto;}" +
      "ul.vpdf-ul,ol.vpdf-ol{margin:9px 0;padding-left:26px;}" +
      "ul.vpdf-ul li,ol.vpdf-ol li{margin:5px 0;}" +
      "ul.vpdf-ul ul.vpdf-ul{margin:4px 0;}" +
      ".vpdf-diagram{margin:15px 0;page-break-inside:avoid;text-align:center;}" +
      ".vpdf-diagram svg{max-width:100%;height:auto;}" +
      ".vdiag-t{font-weight:700;margin-bottom:8px;color:" + T.hBand + ";font-size:12.5pt;}" +
      ".tx-red{color:#c0392b;}.tx-blue{color:#1565c0;}.tx-green{color:#1e7d46;}.tx-gold{color:#9a7b1e;}.tx-purple{color:#6c3483;}.tx-orange{color:#cf5b16;}" +
      "code.vpdf-code{font-family:ui-monospace,Consolas,monospace;background:#eef1f6;padding:1px 7px;border-radius:5px;font-size:10.5pt;}";
    ["hl", "note", "warn", "def", "formula"].forEach(function (k) {
      var b = T[k];
      css += ".vpdf-b-" + k + "{border-color:" + b.b + ";background:" + b.f + ";}" +
        ".vpdf-b-" + k + " .vbox-t{color:" + b.t + ";font-weight:700;margin-bottom:6px;font-size:12.5pt;}";
    });
    return css;
  }

  /* ------------------------------ diagrams (inline SVG, vector-sharp) ------------------------------ */
  var __uid = 0;
  function diagramSvg(type, title, items, themeKey) {
    var T = themeOf(themeKey);
    type = /^(flow|vflow|layers|cycle)$/.test(type) ? type : "flow";
    items = (items || []).map(function (s) { return String(s).trim(); }).filter(Boolean).slice(0, 8);
    if (!items.length) items = ["—"];
    __uid++;
    var uid = __uid;
    var accent = T.accent, band = T.hBand;
    var W = 680, out = "";
    function ex(s) {
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }
    function wrap2(s, maxCh) {
      s = String(s);
      if (s.length <= maxCh) return [s];
      var words = s.split(/\s+/), l1 = "", l2 = "";
      for (var k = 0; k < words.length; k++) {
        if ((l1 + " " + words[k]).trim().length <= maxCh) l1 = (l1 + " " + words[k]).trim();
        else l2 = (l2 + " " + words[k]).trim();
      }
      if (!l1) { l1 = s.slice(0, maxCh); l2 = s.slice(maxCh); }
      if (l2.length > maxCh + 12) l2 = l2.slice(0, maxCh + 10) + "…";
      return [l1, l2];
    }
    function box(x, y, w, h, label) {
      var ls = wrap2(label, Math.max(6, Math.floor((w - 22) / 8.4)));
      var s = '<rect x="' + Math.round(x) + '" y="' + Math.round(y) + '" width="' + Math.round(w) + '" height="' + Math.round(h) +
        '" rx="10" fill="#ffffff" stroke="' + band + '" stroke-width="2.2"/>';
      var ty = y + h / 2 - (ls.length > 1 ? 9 : 0);
      for (var k = 0; k < ls.length; k++)
        s += '<text x="' + Math.round(x + w / 2) + '" y="' + Math.round(ty + 5 + k * 18) + '" text-anchor="middle" font-size="13.5" fill="#1b1f2a" font-family="\'Noto Sans Devanagari\',sans-serif">' + ex(ls[k]) + "</text>";
      return s;
    }
    function arrow(x1, y1, x2, y2) {
      return '<line x1="' + Math.round(x1) + '" y1="' + Math.round(y1) + '" x2="' + Math.round(x2) + '" y2="' + Math.round(y2) +
        '" stroke="' + accent + '" stroke-width="2.6" marker-end="url(#vam' + uid + ')"/>';
    }
    var defs = '<defs><marker id="vam' + uid + '" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto"><polygon points="0,0 8,4.5 0,9" fill="' + accent + '"/></marker></defs>';
    var H, k, x, y, w;
    if (type === "flow") {
      H = 122; var bh = 58, gap = 36, bws = [];
      items.forEach(function (s) { bws.push(Math.min(205, Math.max(98, Math.ceil(s.length * 8.4) + 30))); });
      var total = bws.reduce(function (a, b) { return a + b; }, 0) + gap * (items.length - 1);
      var sc = total > W ? W / total : 1;
      x = (W - total * sc) / 2; y = (H - bh) / 2;
      for (k = 0; k < items.length; k++) {
        w = bws[k] * sc;
        out += box(x, y, w, bh, items[k]);
        if (k < items.length - 1) out += arrow(x + w + 4, y + bh / 2, x + w + gap * sc - 4, y + bh / 2);
        x += w + gap * sc;
      }
    } else if (type === "vflow") {
      var bw2 = 380, bh2 = 56, gap2 = 34;
      H = items.length * (bh2 + gap2) + 10;
      x = (W - bw2) / 2; y = 8;
      for (k = 0; k < items.length; k++) {
        out += box(x, y, bw2, bh2, items[k]);
        if (k < items.length - 1) out += arrow(x + bw2 / 2, y + bh2 + 4, x + bw2 / 2, y + bh2 + gap2 - 4);
        y += bh2 + gap2;
      }
    } else if (type === "layers") {
      var lh = 58, lgap = 10;
      H = items.length * (lh + lgap) + 12;
      y = 8;
      for (k = 0; k < items.length; k++) {
        w = W * 0.94 - (items.length > 1 ? k * (W * 0.44 / (items.length - 1)) : 0);
        x = (W - w) / 2;
        out += box(x, y, w, lh, items[k]);
        y += lh + lgap;
      }
    } else { /* cycle */
      var n = items.length, R = 118, cx = W / 2, cy = 150;
      H = 300; var cw = 128, chh = 52, pts = [];
      for (k = 0; k < n; k++) {
        var a = -Math.PI / 2 + k * 2 * Math.PI / n;
        pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
      }
      for (k = 0; k < n; k++) {
        var p1 = pts[k], p2 = pts[(k + 1) % n];
        var dx = p2[0] - p1[0], dy = p2[1] - p1[1], d = Math.sqrt(dx * dx + dy * dy) || 1;
        var shrink = Math.min(cw, chh) / 2 + 8;
        out += arrow(p1[0] + dx / d * shrink, p1[1] + dy / d * shrink, p2[0] - dx / d * (shrink + 6), p2[1] - dy / d * (shrink + 6));
      }
      for (k = 0; k < n; k++) out += box(pts[k][0] - cw / 2, pts[k][1] - chh / 2, cw, chh, items[k]);
    }
    var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + " " + Math.round(H) + '" width="' + Math.min(W, 680) + '" role="img">' + defs + out + "</svg>";
    var t = title ? '<div class="vdiag-t">' + inlineFmt(title) + "</div>" : "";
    return '<div class="vpdf-diagram">' + t + svg + "</div>";
  }

  /* ------------------------------ block parsers ------------------------------ */
  function splitRow(line) {
    return line.trim().replace(/^\||\|$/g, "").split("|").map(function (s) { return s.trim(); });
  }
  function parseTable(lines, i) {
    var head = splitRow(lines[i]), rows = [], j = i + 2, n = head.length;
    while (j < lines.length && /^\|.*\|\s*$/.test(lines[j].trim())) { rows.push(splitRow(lines[j])); j++; }
    var h = '<table class="vpdf-table"><thead><tr>' +
      head.map(function (c) { return "<th>" + inlineFmt(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
    rows.forEach(function (r) {
      while (r.length < n) r.push("");
      h += "<tr>" + r.slice(0, n).map(function (c) { return "<td>" + inlineFmt(c) + "</td>"; }).join("") + "</tr>";
    });
    return { html: h + "</tbody></table>", next: j };
  }
  function parseList(lines, i) {
    var items = [], j = i, kind = null;
    while (j < lines.length) {
      var ln = lines[j], m;
      if ((m = ln.match(/^(\s*)[-*]\s+(.*)$/))) {
        if (!kind) kind = "ul";
        if (kind !== "ul") break;
        items.push({ ind: m[1].length, t: m[2] });
      } else if ((m = ln.match(/^(\s*)\d+[.)]\s+(.*)$/))) {
        if (!kind) kind = "ol";
        if (kind !== "ol") break;
        items.push({ ind: m[1].length, t: m[2] });
      } else break;
      j++;
    }
    var h = "", open = false, subOpen = false;
    items.forEach(function (it) {
      var sub = it.ind >= 2;
      if (sub && !subOpen) { h += "<ul class=\"vpdf-ul\">"; subOpen = true; }
      if (!sub && subOpen) { h += "</ul>"; subOpen = false; }
      if (!open) { h += (kind === "ol" ? '<ol class="vpdf-ol">' : '<ul class="vpdf-ul">'); open = true; }
      h += "<li>" + inlineFmt(it.t) + "</li>";
    });
    if (subOpen) h += "</ul>";
    if (open) h += kind === "ol" ? "</ol>" : "</ul>";
    return { html: h, next: j };
  }
  function parseBox(lines, i, type) {
    type = BOX_TITLES[type] ? type : "highlight";
    var j = i, body = [];
    while (j < lines.length && !/^:::\s*$/.test(lines[j].trim())) { body.push(lines[j]); j++; }
    var title = BOX_TITLES[type], start = 0;
    if (body.length) {
      var mt = body[0].trim().match(/^\*\*(.+)\*\*\s*$/);
      if (mt) { title = inlineFmt(mt[1]); start = 1; }
    }
    var inner = "";
    for (var k = start; k < body.length; k++) {
      var t = body[k].trim();
      if (!t) continue;
      var lm = body[k].match(/^(\s*)[-*]\s+(.*)$/);
      if (lm) inner += '<ul class="vpdf-ul"><li>' + inlineFmt(lm[2]) + "</li></ul>";
      else inner += "<p>" + inlineFmt(t) + "</p>";
    }
    if (!inner) inner = "<p>" + inlineFmt("") + "</p>";
    return {
      html: '<div class="vpdf-box vpdf-b-' + type + '"><div class="vbox-t">' + title + "</div>" + inner + "</div>",
      next: Math.min(j + 1, lines.length)
    };
  }
  function parseMcq(lines, i) {
    var j = i, q = "", optLines = [], ans = null, ansText = "";
    while (j < lines.length && !/^\[\/mcq\]$/i.test(lines[j].trim())) {
      var t = lines[j].trim(), am;
      if ((am = t.match(/^(?:उत्तर|उतर|answer|ans)\s*[:\-–—]\s*\(([a-dA-D])\)\s*(.*)$/))) {
        ans = am[1].toLowerCase(); ansText = am[2].trim();
      } else if (/^(?:q|प्रश्न)\s*[:\-–—]/i.test(t)) {
        q = t.replace(/^(?:q|प्रश्न)\s*[:\-–—]\s*/i, "");
      } else if (t) {
        if (!q) q = t; else optLines.push(t);
      }
      j++;
    }
    var opts = [], om = optLines.join(" ").match(/\(([a-dA-D])\)\s*([^()]*)/g) || [];
    om.forEach(function (g) {
      var mm = g.match(/\(([a-dA-D])\)\s*([^()]*)/);
      if (mm && mm[2].trim()) opts.push({ k: mm[1].toLowerCase(), v: mm[2].trim() });
    });
    if (!opts.length) {
      "abcd".split("").forEach(function (k2, ix) {
        if (optLines[ix] && optLines[ix].trim()) opts.push({ k: k2, v: optLines[ix].trim() });
      });
    }
    var h = '<div class="vpdf-mcq"><div class="vq"><span class="vqn">%%N%%</span>' + inlineFmt(q || "प्रश्न") + '</div><div class="vpdf-opts">' +
      opts.map(function (o) { return '<div class="vpdf-opt"><b>(' + o.k + ")</b>" + inlineFmt(o.v) + "</div>"; }).join("") +
      "</div></div>";
    return { html: h, next: Math.min(j + 1, lines.length), ans: ans ? { letter: ans, text: ansText } : null };
  }
  function parseDiagram(lines, i, attrStr, themeKey) {
    attrStr = attrStr || "";
    var type = "flow", title = "", m;
    if ((m = attrStr.match(/type\s*=\s*([a-zA-Z]+)/))) type = m[1].toLowerCase();
    if ((m = attrStr.match(/title\s*=\s*"([^"]*)"/) || attrStr.match(/title\s*=\s*'([^']*)'/) || attrStr.match(/title\s*=\s*([^\s]+)/))) title = m[1];
    var j = i, raw = [];
    while (j < lines.length && !/^\[\/diagram\]$/i.test(lines[j].trim())) { raw.push(lines[j]); j++; }
    var txt = raw.join("\n").trim();
    var items = txt.split(/\s*(?:->|→)\s*/).map(function (s) { return s.trim(); }).filter(Boolean);
    if (items.length < 2) items = txt.split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    return { html: diagramSvg(type, title, items, themeKey), next: Math.min(j + 1, lines.length) };
  }
  function parseCover(lines, i) {
    var j = i, title = "Document", subs = [];
    while (j < lines.length && !/^\[\/cover\]$/i.test(lines[j].trim())) {
      var t = lines[j].trim(), m;
      if ((m = t.match(/^#\s+(.*)$/))) title = stripTags(inlineFmt(m[1]));
      else if (t) subs.push(t);
      j++;
    }
    var h = '<div class="vpdf-cover"><div><h1>' + inlineFmt(title === "Document" ? "" : title) + '</h1><div class="vrule"></div>' +
      subs.map(function (s) { return '<div class="vsub">' + inlineFmt(s) + "</div>"; }).join("") +
      '<div class="vby">BY SHAILESH ARYA</div></div></div>';
    return { html: h, next: Math.min(j + 1, lines.length), title: stripTags(title).slice(0, 80) || "Document" };
  }

  /* ------------------------------ main converter ------------------------------ */
  function isMarkup(src) {
    if (!src) return false;
    return /^\s*theme\s*[:=]/im.test(src) ||
      /\[(cover|mcq|diagram)[^\]]*\]/i.test(src) ||
      /^:::\s*(highlight|note|warn|def|formula)?\s*$/im.test(src);
  }

  function toHtml(src, opts) {
    opts = opts || {};
    try {
      return toHtmlInner(src, opts);
    } catch (e) {
      var css = themeCss(DEFAULT_THEME);
      return {
        html: "<style>" + css + "</style>" + '<div class="vpdf"><p>' + escapeHtml(String(src || "")) + "</p></div>",
        theme: DEFAULT_THEME, title: "Document", degraded: true
      };
    }
  }

  function toHtmlInner(src, opts) {
    var lines = String(src || "").replace(/\r\n?/g, "\n").split("\n");
    var theme = DEFAULT_THEME;
    for (var di = 0; di < lines.length; di++) {
      var dm = lines[di].trim().match(/^theme\s*[:=]\s*([a-z-]+)/i);
      if (dm) { theme = dm[1].toLowerCase(); break; }
    }
    if (opts.forceTheme && THEMES[opts.forceTheme]) theme = opts.forceTheme;
    else if (!THEMES[theme]) theme = (opts.themeHint && THEMES[opts.themeHint]) ? opts.themeHint : DEFAULT_THEME;
    if (!THEMES[theme]) theme = DEFAULT_THEME;

    var out = [], answers = [], qn = 0, title = "Document", titleLocked = false;
    var para = [], i = 0;
    function flushPara() {
      if (para.length) { out.push("<p>" + inlineFmt(para.join(" ")) + "</p>"); para = []; }
    }
    while (i < lines.length) {
      var line = lines[i], t = line.trim(), m;
      if (/^theme\s*[:=]/i.test(t)) { i++; continue; }
      if (!t) { flushPara(); i++; continue; }
      if (t === "---") { flushPara(); out.push('<hr class="vpdf-hr">'); i++; continue; }
      if (/^\[cover\]$/i.test(t)) {
        flushPara();
        var cv = parseCover(lines, i + 1);
        if (!titleLocked) { title = cv.title; titleLocked = true; }
        out.push(cv.html); i = cv.next; continue;
      }
      if ((m = t.match(/^:::\s*(highlight|note|warn|def|formula)?\s*$/i))) {
        flushPara();
        var bx = parseBox(lines, i + 1, (m[1] || "highlight").toLowerCase());
        out.push(bx.html); i = bx.next; continue;
      }
      if (/^\[mcq\]$/i.test(t)) {
        flushPara(); qn++;
        var mq = parseMcq(lines, i + 1);
        if (mq.ans) answers.push({ n: qn, letter: mq.ans.letter, text: mq.ans.text });
        out.push(mq.html.replace("%%N%%", "प्रश्न " + qn)); i = mq.next; continue;
      }
      if ((m = t.match(/^\[diagram([^\]]*)\]$/i))) {
        flushPara();
        var dg = parseDiagram(lines, i + 1, m[1], theme);
        out.push(dg.html); i = dg.next; continue;
      }
      if (/^\|.*\|\s*$/.test(t) && i + 1 < lines.length && /^\|[\s:\-|]+\|\s*$/.test(lines[i + 1].trim())) {
        flushPara();
        var tb = parseTable(lines, i);
        out.push(tb.html); i = tb.next; continue;
      }
      if ((m = t.match(/^(#{1,3})\s+(.*)$/))) {
        flushPara();
        var lvl = m[1].length, htxt = inlineFmt(m[2]);
        if (!titleLocked && lvl <= 2) { title = stripTags(htxt).slice(0, 80) || title; titleLocked = true; }
        out.push("<h" + lvl + ' class="vpdf-h' + lvl + '">' + htxt + "</h" + lvl + ">");
        i++; continue;
      }
      if (/^(\s*)[-*]\s+/.test(line) || /^(\s*)\d+[.)]\s+/.test(line)) {
        flushPara();
        var ls = parseList(lines, i);
        out.push(ls.html); i = ls.next; continue;
      }
      para.push(t); i++;
    }
    flushPara();
    if (answers.length) {
      out.push('<div class="vpdf-box vpdf-b-def"><div class="vbox-t">✅ उत्तरमाला (Answer Key)</div><div class="vpdf-opts">' +
        answers.map(function (a) {
          return '<div class="vpdf-opt"><b>' + a.n + ".</b> (" + a.letter + ")" + (a.text ? " " + inlineFmt(a.text) : "") + "</div>";
        }).join("") + "</div></div>");
    }
    if (!out.length) out.push("<p>" + escapeHtml(String(src || "").trim().slice(0, 2000)) + "</p>");
    var html = "<style>" + themeCss(theme) + "</style>" +
      '<div class="vpdf vpdf-theme-' + theme + '">' + out.join("\n") + "</div>";
    return { html: html, theme: theme, title: title };
  }

  return {
    THEMES: THEMES,
    DEFAULT_THEME: DEFAULT_THEME,
    themeCss: themeCss,
    toHtml: toHtml,
    isMarkup: isMarkup,
    diagramSvg: diagramSvg,
    esc: escapeHtml,
    hexRgb: hexRgb
  };
});
