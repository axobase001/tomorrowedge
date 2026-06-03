import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const outDir = path.resolve("docs/assets/screenshots");
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });

const shots = [
  ["http://localhost:4173/", "tomorrowedge-home.png"],
  ["http://localhost:4173/product/", "tomorrowedge-product.png"],
  ["http://localhost:4173/architecture/", "tomorrowedge-architecture.png"]
];

for (const [url, fileName] of shots) {
  await page.goto(url, { waitUntil: "load" });
  await page.screenshot({ path: path.join(outDir, fileName), fullPage: false });
}

await browser.close();
