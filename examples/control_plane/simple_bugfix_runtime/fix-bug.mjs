import { readFile, writeFile } from "node:fs/promises";

const source = await readFile("index.js", "utf8");
if (!source.includes("return a - b;")) {
  console.log("index.js already appears fixed");
  process.exit(0);
}

await writeFile("index.js", source.replace("return a - b;", "return a + b;"), "utf8");
console.log("patched index.js: return a - b -> return a + b");
