// Chhota markdown renderer (koi library nahi chahiye). Browser aur Node dono me chalta hai.
(function (root) {
  function esc(s) {
    // v1.3 fix: quotes bhi escape karo — warna markdown/auto-link ke href="..." me
    // attribute-injection XSS hota tha (reproduce kiya gaya tha).
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  var COLOR_NAMES = { red: 1, blue: 1, green: 1, gold: 1, purple: 1, orange: 1 };
  function inline(raw) {
    // [c:rang]...[/c] — whitelist wale rang; pehle nikalo taaki esc() andar ka text na bigaade
    var colors = [];
    var s0 = String(raw).replace(/\[c:([a-z]+)\]([\s\S]*?)\[\/c\]/g, function (m, c, inner) {
      if (!COLOR_NAMES[c]) return m; // whitelist ke bahar -> jaisa hai waisa dikhao
      colors.push({ c: c, inner: inner });
      return "\u0001" + (colors.length - 1) + "\u0001";
    });
    let s = esc(s0);
    const codes = [];
    s = s.replace(/`([^`\n]+)`/g, (m, c) => {
      codes.push(c);
      return "\u0000" + (codes.length - 1) + "\u0000";
    });
    s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
    s = s.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\n]+)\*(?!\*)/g, "$1<em>$2</em>");
    s = s.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    s = s.replace(/\u0000(\d+)\u0000/g, (m, i) => "<code>" + codes[i] + "</code>");
    // rang wapas lagao — andar ka text dobara inline() se (markdown allowed), poori tarah sanitize
    s = s.replace(/\u0001(\d+)\u0001/g, (m, i) => {
      const o = colors[+i];
      if (!o) return "";
      return '<span class="tc-' + o.c + '">' + inline(o.inner) + "</span>";
    });
    return s;
  }

  function codeBlock(lang, code) {
    const l = esc(lang || "code");
    return (
      '<div class="code"><div class="code-head"><span>' + l +
      '</span><button type="button" class="copy-code">Copy</button></div><pre><code>' +
      esc(code) + "</code></pre></div>"
    );
  }

  const ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

  function startsBlock(l) {
    return (
      /^\s*```/.test(l) || /^#{1,6}\s+/.test(l) || /^\s*([-*_])(\s*\1){2,}\s*$/.test(l) ||
      /^\s*>/.test(l) || ITEM.test(l)
    );
  }

  function cells(l) {
    return l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
  }

  function buildList(items) {
    let pos = 0;
    function build(indent) {
      const ordered = items[pos].ordered;
      let html = ordered ? "<ol>" : "<ul>";
      while (pos < items.length && items[pos].indent >= indent) {
        if (items[pos].indent > indent) {
          html += "<li>" + build(items[pos].indent) + "</li>";
          continue;
        }
        let li = "<li>" + inline(items[pos].text);
        pos++;
        if (pos < items.length && items[pos].indent > indent) li += build(items[pos].indent);
        html += li + "</li>";
      }
      return html + (ordered ? "</ol>" : "</ul>");
    }
    let out = "";
    while (pos < items.length) out += build(items[pos].indent);
    return out;
  }

  function renderMarkdown(src) {
    const lines = String(src || "").replace(/\r/g, "").split("\n");
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      let m = line.match(/^\s*```\s*([\w+#.-]*)\s*$/);
      if (m) {
        const buf = [];
        i++;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) buf.push(lines[i++]);
        i++;
        out.push(codeBlock(m[1], buf.join("\n")));
        continue;
      }
      if (/^\s*$/.test(line)) { i++; continue; }
      m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        const n = m[1].length;
        out.push("<h" + n + ">" + inline(m[2]) + "</h" + n + ">");
        i++;
        continue;
      }
      if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
      if (/^\s*>/.test(line)) {
        const buf = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) buf.push(lines[i++].replace(/^\s*>\s?/, ""));
        out.push("<blockquote>" + renderMarkdown(buf.join("\n")) + "</blockquote>");
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
        const head = cells(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(cells(lines[i++]));
        let t = '<div class="table-wrap"><table><thead><tr>' + head.map((c) => "<th>" + inline(c) + "</th>").join("") + "</tr></thead><tbody>";
        rows.forEach((r) => { t += "<tr>" + r.map((c) => "<td>" + inline(c) + "</td>").join("") + "</tr>"; });
        out.push(t + "</tbody></table></div>");
        continue;
      }
      if (ITEM.test(line)) {
        const items = [];
        while (i < lines.length) {
          const mm = lines[i].match(ITEM);
          if (mm) {
            items.push({ indent: mm[1].replace(/\t/g, "  ").length, ordered: /\d/.test(mm[2]), text: mm[3] });
            i++;
          } else if (/^\s+\S/.test(lines[i]) && items.length && !startsBlock(lines[i])) {
            items[items.length - 1].text += " " + lines[i].trim();
            i++;
          } else break;
        }
        out.push(buildList(items));
        continue;
      }
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !startsBlock(lines[i])) buf.push(lines[i++]);
      out.push("<p>" + buf.map(inline).join("<br>") + "</p>");
    }
    return out.join("\n");
  }

  // Bolne (TTS) ke liye saaf text
  function mdToPlain(t) {
    return String(t || "")
      .replace(/```[\s\S]*?(```|$)/g, " ")
      .replace(/^[\s|:-]*-{2,}[\s|:-]*$/gm, "")
      .replace(/\[c:[a-z]+\]|\[\/c\]/g, "")
      .replace(/`([^`]*)`/g, "$1")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*([-*+]|\d+[.)])\s+/gm, "")
      .replace(/(\*\*|__|~~|\*|_)/g, "")
      .replace(/\|/g, " ")
      .replace(/^[-=]{3,}$/gm, "")
      .replace(/\n{2,}/g, ". ")
      .replace(/\s+/g, " ")
      .trim();
  }

  const api = { renderMarkdown, mdToPlain, esc };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MD = api;
})(typeof window !== "undefined" ? window : globalThis);
