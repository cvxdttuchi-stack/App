const assert = require("assert");
const VPDF = require("../public/vpdf.js");

const cases = [
  "theme: navy-gold\n# Hello\n\nParagraph.",
  "[cover]\n# नमस्ते\nउपशीर्षक\n[/cover]\n## Heading\n- एक\n- दो",
  "## Table\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[mcq]\nQ: 2+2?\n(a) 3 (b) 4 (c) 5 (d) 6\nउत्तर: (b) 4\n[/mcq]",
  "::: note\n**Note**\nSafe content\n:::",
  "[diagram type=flow title=\"Flow\"]\nA -> B -> C\n[/diagram]"
];

for (const src of cases) {
  const r = VPDF.toHtml(src, { themeHint: "navy-gold", customColors: { cover1: "#112233", cover2: "#223344", accent: "#d4af37" } });
  assert.ok(r && typeof r.html === "string" && r.html.length > 100);
  assert.ok(r.html.includes("Noto Sans Devanagari"));
}

const broken = VPDF.toHtml("::: unknown\n<unsafe>\n:::");
assert.ok(broken.html.includes("vpdf"));

console.log("test-vpdf: PASS");
