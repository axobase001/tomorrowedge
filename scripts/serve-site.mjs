import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = resolve(process.cwd(), "docs");
const port = Number(process.env.PORT ?? 4173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function resolveRequest(url) {
  const pathname = decodeURIComponent(new URL(url, "http://localhost").pathname);
  const clean = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, "");
  let target = resolve(root, clean.slice(1));

  if (!target.startsWith(root)) {
    return null;
  }

  if (!existsSync(target)) {
    return null;
  }

  if (statSync(target).isDirectory()) {
    target = join(target, "index.html");
  }

  return existsSync(target) ? target : null;
}

const server = createServer((req, res) => {
  const file = resolveRequest(req.url ?? "/");

  if (!file) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});

server.listen(port, () => {
  console.log(`TomorrowEdge site preview: http://localhost:${port}/`);
});
