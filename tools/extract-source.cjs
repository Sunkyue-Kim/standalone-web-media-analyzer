const fs = require("node:fs");
const path = require("node:path");

const rootDirectory = path.resolve(__dirname, "..");
const sourceHtmlPath = path.join(rootDirectory, "mp4-analyzer.html");
const sourceDirectory = path.join(rootDirectory, "src", "extracted-from-html");

const html = fs.readFileSync(sourceHtmlPath, "utf8");
const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/i);
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/i);

if (!styleMatch || !scriptMatch) {
  throw new Error("Expected one inline <style> block and one inline <script> block.");
}

fs.mkdirSync(sourceDirectory, { recursive: true });

const templateHtml =
  html.slice(0, styleMatch.index) +
  '<link rel="stylesheet" href="./styles.css">' +
  html.slice(styleMatch.index + styleMatch[0].length, scriptMatch.index) +
  '<script src="./app.js"></script>' +
  html.slice(scriptMatch.index + scriptMatch[0].length);

fs.writeFileSync(path.join(sourceDirectory, "index.html"), templateHtml, "utf8");
fs.writeFileSync(path.join(sourceDirectory, "styles.css"), styleMatch[1].replace(/^\r?\n/, "").replace(/\s*$/, "\n"), "utf8");
fs.writeFileSync(path.join(sourceDirectory, "app.js"), scriptMatch[1].replace(/^\r?\n/, "").replace(/\s*$/, "\n"), "utf8");

console.log("Extracted inline assets into src/extracted-from-html/.");
