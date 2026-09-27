import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

const roots = ["dist", "src", "index.html", "package.json", "vite.config.ts"];
const allowedUrls = new Set([
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1999/xhtml",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  // Non-runtime reference comment preserved inside the bundled three.js math code.
  "https://jcgt.org/published/0007/04/01/"
]);
const forbiddenProviderWords = [
  "api.openai.com",
  "openai.com/v1",
  "chatgpt",
  "anthropic.com",
  "generativelanguage.googleapis.com",
  "gemini.google.com",
  "api.mistral.ai",
  "api.cohere.ai",
  "replicate.com"
];

async function walk(path) {
  const fileStat = await stat(path).catch(() => null);
  if (!fileStat) return [];
  if (fileStat.isFile()) return [path];
  const entries = await readdir(path);
  const nested = await Promise.all(entries.map((entry) => walk(join(path, entry))));
  return nested.flat();
}

const files = (await Promise.all(roots.map((root) => walk(root)))).flat()
  .filter((file) => /\.(html|js|css|ts|tsx|json|md|mjs)$/.test(file));

const failures = [];
const remoteUrlPattern = /https?:\/\/[^\s"'<>`\\)]+/gi;
const externalTagPattern = /<(script|link|img|iframe|source)\b[^>]*(https?:)?\/\//gi;

for (const file of files) {
  const text = await readFile(file, "utf8");
  for (const match of text.matchAll(remoteUrlPattern)) {
    const url = match[0].replace(/[),.;]+$/, "");
    if (!allowedUrls.has(url)) failures.push(`${file}: remote URL ${url}`);
  }
  if (externalTagPattern.test(text)) failures.push(`${file}: contains an external resource tag`);
  const lower = text.toLowerCase();
  for (const word of forbiddenProviderWords) {
    if (lower.includes(word)) failures.push(`${file}: contains forbidden cloud/AI provider reference ${word}`);
  }
}

if (failures.length) {
  console.error("Offline verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Offline verification passed: no remote runtime URLs or cloud AI provider endpoints found.");
