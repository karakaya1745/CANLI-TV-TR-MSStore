const fs = require("fs");
const path = require("path");

const source = path.join(__dirname, "..", "node_modules", "hls.js", "dist", "hls.min.js");
const targetDir = path.join(__dirname, "..", "src", "renderer", "vendor");
const target = path.join(targetDir, "hls.min.js");

if (!fs.existsSync(source)) {
  console.warn("hls.js not installed yet; run npm install first.");
  process.exit(0);
}

fs.mkdirSync(targetDir, { recursive: true });
fs.copyFileSync(source, target);
console.log("Copied hls.min.js to src/renderer/vendor/");
