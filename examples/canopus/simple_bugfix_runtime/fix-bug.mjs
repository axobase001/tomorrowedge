import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const filePath = path.resolve(process.cwd(), "index.js");
const source = await readFile(filePath, "utf8");
const updated = source.replace("return a - b;", "return a + b;");
if (updated === source) {
  throw new Error("Expected failing implementation was not found.");
}
await writeFile(filePath, updated, "utf8");
console.log("patched index.js");
