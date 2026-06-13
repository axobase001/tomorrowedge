#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const payload = process.argv[2];
if (!payload) {
  console.error("bounded-file-verifier: missing payload");
  process.exit(2);
}

let files;
try {
  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  files = Array.isArray(parsed.files) ? parsed.files : [];
} catch (error) {
  console.error(`bounded-file-verifier: invalid payload: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

if (!files.length) {
  console.error("bounded-file-verifier: no files to verify");
  process.exit(2);
}

for (const file of files) {
  if (typeof file !== "string" || !isSafeRelativePath(file)) {
    console.error(`bounded-file-verifier: unsafe path ${String(file)}`);
    process.exit(2);
  }
  if (!fs.existsSync(file)) {
    console.error(`bounded-file-verifier: missing ${file}`);
    process.exit(1);
  }
  const text = fs.readFileSync(file, "utf8");
  if (/\.html?$/i.test(file) && !/<html|<!doctype html/i.test(text)) {
    console.error(`bounded-file-verifier: html not readable ${file}`);
    process.exit(1);
  }
  if (/\.svg$/i.test(file) && !/<svg[\s>]/i.test(text)) {
    console.error(`bounded-file-verifier: svg not readable ${file}`);
    process.exit(1);
  }
}

console.log(`bounded file verification ok: ${files.join(", ")}`);

function isSafeRelativePath(file) {
  const normalized = file.replace(/\\/g, "/");
  if (!normalized || normalized.includes("..")) return false;
  if (path.isAbsolute(normalized) || /^[A-Za-z]:/.test(normalized)) return false;
  if (/^(?:node_modules|\.git|\.tomorrowedge|dist|coverage)\//.test(normalized)) return false;
  if (/(^|\/)\.env(?:\.|$)/.test(normalized)) return false;
  return true;
}
