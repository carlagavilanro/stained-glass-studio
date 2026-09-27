import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const distDir = resolve("dist");
const indexPath = resolve(distDir, "index.html");
let html = await readFile(indexPath, "utf8");

html = html.replace(/<link rel="stylesheet" crossorigin href="(\.\/assets\/[^"]+\.css)">/g, (_, href) => {
  const css = readFile(resolve(distDir, href.replace(/^\.\//, "")), "utf8");
  return `__INLINE_CSS__${href}__`;
});

for (const marker of [...html.matchAll(/__INLINE_CSS__(.*?)__/g)]) {
  const href = marker[1];
  const css = await readFile(resolve(distDir, href.replace(/^\.\//, "")), "utf8");
  html = html.replace(marker[0], `<style>\n${css}\n</style>`);
}

html = html.replace(/<script type="module" crossorigin src="(\.\/assets\/[^"]+\.js)"><\/script>/g, (_, href) => {
  return `__INLINE_JS__${href}__`;
});

for (const marker of [...html.matchAll(/__INLINE_JS__(.*?)__/g)]) {
  const href = marker[1];
  const js = await readFile(resolve(distDir, href.replace(/^\.\//, "")), "utf8");
  html = html.replace(marker[0], `<script type="module">\n${js}\n</script>`);
}

html = html.replace("</title>", "</title>\n    <meta name=\"offline-build\" content=\"self-contained; no remote scripts; no cloud AI calls\">");

const outputPath = resolve(distDir, "stained-glass-studio-offline.html");
await writeFile(outputPath, html, "utf8");
console.log(`Wrote ${outputPath.replace(`${dirname(distDir)}/`, "")}`);
