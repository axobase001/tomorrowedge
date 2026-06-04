import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const publicDir = path.join(root, "public");
const distDir = path.join(root, "dist");

const html = await readFile(path.join(publicDir, "index.html"), "utf8");
const app = await readFile(path.join(publicDir, "app.js"), "utf8");
const source = `${html}\n${app}`;
for (const required of ["#prompt", "#temperature", "#maxTokens", "#generate", "/generate", "/model-info"]) {
  if (!source.includes(required)) throw new Error(`frontend is missing ${required}`);
}

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });
for (const file of ["index.html", "app.js", "styles.css"]) {
  await writeFile(path.join(distDir, file), await readFile(path.join(publicDir, file), "utf8"), "utf8");
}

process.stdout.write(`frontend build ok: ${distDir}\n`);
