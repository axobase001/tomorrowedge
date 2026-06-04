import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTinyCharModel } from "./model.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const publicDir = path.join(root, "public");

export function createTinyLmServer(options = {}) {
  const model = options.model ?? createTinyCharModel();

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, { ok: true, service: "tiny-local-lm" });
      }
      if (request.method === "GET" && url.pathname === "/model-info") {
        return json(response, 200, model.info());
      }
      if (request.method === "POST" && url.pathname === "/generate") {
        const body = await readJson(request);
        const result = model.generate(body.prompt ?? "", {
          temperature: body.temperature,
          maxTokens: body.maxTokens,
          seed: body.seed
        });
        return json(response, 200, result);
      }
      if (request.method === "GET") {
        return serveStatic(url.pathname, response);
      }
      return json(response, 405, { error: "method not allowed" });
    } catch (error) {
      return json(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(pathname, response) {
  const target = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.normalize(path.join(publicDir, target));
  if (!filePath.startsWith(publicDir)) return json(response, 403, { error: "forbidden" });
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return json(response, 404, { error: "not found" });
    response.writeHead(200, { "Content-Type": contentType(filePath) });
    createReadStream(filePath).pipe(response);
  } catch {
    const fallback = await readFile(path.join(publicDir, "index.html"), "utf8");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(fallback);
  }
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function contentType(filePath) {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}
