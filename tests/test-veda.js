const assert = require("assert");
const fs = require("fs");
const path = require("path");
const cp = require("child_process");

const root = path.resolve(__dirname, "..");
const required = [
  "server.js",
  "providers.js",
  "public/index.html",
  "public/app.js",
  "public/tools.js",
  "public/pdfedit.js",
  "public/vpdf.js",
  "public/pdf.min.js",
  "public/pdf.worker.min.js",
  "public/pdf-lib.min.js",
  "public/fonts/noto-dev-2.woff2"
];

for (const file of required) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing: ${file}`);
}

for (const file of ["server.js", "providers.js", "public/app.js", "public/tools.js", "public/pdfedit.js", "public/vpdf.js"]) {
  cp.execFileSync(process.execPath, ["--check", path.join(root, file)], { stdio: "pipe" });
}

const html = fs.readFileSync(path.join(root, "public/index.html"), "utf8");
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
const seen = new Set();
for (const id of ids) {
  assert.ok(!seen.has(id), `duplicate HTML id: ${id}`);
  seen.add(id);
}
assert.ok(html.includes('id="tTTS"'), "Text→Voice control missing");
assert.ok(html.includes('id="fileInput"'), "file input missing");
assert.ok(html.includes('id="camBtn"'), "camera control missing");

console.log("test-veda: PASS");
