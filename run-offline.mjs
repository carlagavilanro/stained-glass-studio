import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

const root = new URL("./dist/", import.meta.url);
const host = "127.0.0.1";
const port = Number(process.env.PORT ?? 5173);

const mime = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".wasm", "application/wasm"]
]);

function safeFileUrl(pathname) {
  const decoded = decodeURIComponent(pathname === "/" ? "/index.html" : pathname);
  const fileUrl = new URL(`.${decoded}`, root);
  if (!fileUrl.href.startsWith(root.href)) return null;
  return fileUrl;
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${host}:${port}`);
    let fileUrl = safeFileUrl(requestUrl.pathname);
    if (!fileUrl) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    const fileStat = await stat(fileUrl).catch(() => null);
    if (fileStat?.isDirectory()) fileUrl = new URL("index.html", fileUrl);

    const data = await readFile(fileUrl);
    response.writeHead(200, {
      "Content-Type": mime.get(extname(fileUrl.pathname)) ?? "application/octet-stream",
      "Cache-Control": "no-store"
    });
    response.end(data);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(port, host, () => {
  console.log(`Stained Glass Shape Studio is running offline at http://${host}:${port}`);
  console.log("No internet connection is required. Press Ctrl+C to stop.");
});
