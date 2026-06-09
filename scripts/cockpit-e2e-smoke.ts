import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";

type BrowserFailure = {
  kind: string;
  detail: string;
};

const repoRoot = process.cwd();
const artifactDir = path.join(repoRoot, ".tomorrowedge", "e2e-artifacts", "cockpit", new Date().toISOString().replace(/[:.]/g, "-"));
const viewports = [
  { width: 1440, height: 900 },
  { width: 1180, height: 820 },
  { width: 768, height: 900 },
  { width: 390, height: 840 }
];

async function main(): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const workspace = await mkdtemp(path.join(os.tmpdir(), "tedge-cockpit-e2e-"));
  await cp(path.join(repoRoot, "tests", "fixtures", "sample-repo-basic"), workspace, { recursive: true });

  const child = spawn(process.execPath, [path.join(repoRoot, "dist", "cli", "index.js"), "client", "--no-open", "--port", "0"], {
    cwd: workspace,
    env: { ...process.env, NO_COLOR: "1" }
  });
  const stdout: string[] = [];
  const stderr: string[] = [];
  child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));

  let browser: Browser | undefined;
  try {
    const url = await waitForClientUrl(child, stdout, stderr);
    await writeFile(path.join(artifactDir, "server.log"), redactNonce([...stdout, ...stderr].join("")), "utf8");
    browser = await chromium.launch();
    await runCockpitFlow(browser, url);
    await writeFile(path.join(artifactDir, "result.json"), JSON.stringify({ ok: true, url: redactNonce(url), viewports }, null, 2), "utf8");
    process.stdout.write(`Cockpit e2e smoke passed. Artifacts: ${artifactDir}\n`);
  } catch (error) {
    await writeFile(path.join(artifactDir, "server.log"), redactNonce([...stdout, ...stderr].join("")), "utf8").catch(() => undefined);
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    await writeFile(path.join(artifactDir, "failure.txt"), message, "utf8").catch(() => undefined);
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    stopChild(child);
  }
}

async function runCockpitFlow(browser: Browser, url: string): Promise<void> {
  const failures: BrowserFailure[] = [];
  const context = await browser.newContext({ viewport: viewports[0] });
  const page = await context.newPage();
  attachFailureCollectors(page, failures, new URL(url).origin);

  await withTrace(context, page, "cockpit-main", async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-testid='cockpit-shell']", { timeout: 10_000 });
    await page.waitForSelector("[data-testid='language-selector']", { timeout: 5_000 });
    const defaultLanguage = await page.locator("[data-testid='language-selector']").inputValue();
    if (defaultLanguage !== "en") throw new Error(`expected default GUI language to be en, got ${defaultLanguage}`);
    await page.selectOption("[data-testid='language-selector']", "zh");
    await page.waitForFunction(() => window.localStorage.getItem("tomorrowedge.guiLanguage") === "zh", undefined, { timeout: 5_000 });
    await page.waitForSelector("text=命令", { timeout: 5_000 });
    await page.selectOption("[data-testid='language-selector']", "en");
    await page.waitForSelector("text=Command", { timeout: 5_000 });
    await assertVisibleTestIds(page, [
      "topbar",
      "task-panel",
      "workflow-panel",
      "workflow-spine",
      "main-view",
      "telemetry-panel",
      "trace-strip",
      "composer",
      "composer-input",
      "composer-mode",
      "composer-run-mode",
      "composer-target",
      "composer-validation-hint",
      "composer-submit"
    ], "initial cockpit contract");
    await touchOptionalTestIds(page, ["task-card"]);
    const setupDismiss = page.locator("[data-testid='setup-dismiss-demo']");
    if (await setupDismiss.isVisible().catch(() => false)) {
      await assertVisibleTestIds(page, [
        "setup-wizard",
        "setup-provider",
        "setup-model",
        "setup-base-url",
        "setup-env",
        "setup-key",
        "setup-save",
        "setup-test"
      ], "setup wizard contract");
      await touchOptionalTestIds(page, ["setup-message", "setup-connection"]);
      await setupDismiss.click();
    }
    await page.click("[data-testid='topbar-keys']");
    await page.waitForSelector("[data-testid='key-role-manager']", { timeout: 5_000 });
    await assertVisibleTestIds(page, [
      "keymgr-tab-keys",
      "keymgr-provider",
      "keymgr-model",
      "keymgr-base-url",
      "keymgr-env",
      "keymgr-key",
      "keymgr-save-key",
      "keymgr-refresh-models",
      "keymgr-test-key",
      "keymgr-delete-key"
    ], "key manager key contract");
    await touchOptionalTestIds(page, ["keymgr-message", "keymgr-connection", "keymgr-models-message"]);
    await page.click("[data-testid='keymgr-tab-roles']");
    await page.waitForSelector("[data-testid='keymgr-role-list']", { timeout: 5_000 });
    await assertVisibleTestIds(page, ["keymgr-save-roles"], "key manager role contract");
    await page.click("[data-testid='keymgr-close']");
    await page.waitForSelector("[data-testid='key-role-manager']", { state: "detached", timeout: 5_000 });
    await page.fill("[data-testid='composer-input']", "Create a deliberately long GUI e2e task title that should remain readable without horizontal overflow while the fixture workflow reaches approval.");
    await page.press("[data-testid='composer-input']", "Enter");
    await page.waitForSelector("[data-testid='approval-card']", { timeout: 20_000 });
    await assertAtLeastOneVisible(page, "task-card", "running task list");
    await touchOptionalTestIds(page, ["composer-status"]);
    await touchOptionalTestIds(page, ["workflow-current-agent"]);
    await page.waitForSelector("[data-testid='telemetry-routing']", { timeout: 10_000 });
    const routingText = await page.locator("[data-testid='telemetry-routing']").innerText();
    if (!/planner|coder|reviewer|judge/.test(routingText)) {
      throw new Error(`telemetry routing panel did not expose role routes: ${routingText}`);
    }
    await assertVisibleTestIds(page, [
      "approval-approve",
      "approval-reject",
      "approval-rereview",
      "approval-open-drawer"
    ], "approval contract");
    await assertNoHorizontalOverflow(page, "approval-main");
    await page.click("[data-testid='approval-open-drawer']");
    await page.waitForFunction(() => document.querySelector("[data-testid='detail-drawer']")?.classList.contains("open") === true, undefined, { timeout: 5_000 });
    await assertVisibleTestIds(page, ["drawer-backdrop", "detail-drawer", "detail-drawer-close", "drawer-artifacts"], "drawer contract");
    await waitForDrawerInViewport(page);
    await assertNoHorizontalOverflow(page, "drawer-open");
    await page.screenshot({ path: path.join(artifactDir, "waiting-approval.png"), fullPage: true });

    for (const viewport of viewports.slice(1)) {
      await page.setViewportSize(viewport);
      await page.waitForTimeout(100);
      await assertNoHorizontalOverflow(page, `${viewport.width}x${viewport.height}`);
      await waitForDrawerInViewport(page);
    }
    await page.setViewportSize(viewports[0]);
    await page.click("[data-testid='detail-drawer-close']");
    await page.waitForSelector("[data-testid='detail-drawer']", { state: "detached", timeout: 5_000 });
    await page.click("[data-testid='open-drawer']");
    await page.waitForFunction(() => document.querySelector("[data-testid='detail-drawer']")?.classList.contains("open") === true, undefined, { timeout: 5_000 });
    await touchOptionalTestIds(page, ["close-drawer"]);
    await page.click("[data-testid='detail-drawer-close']");
    await page.waitForSelector("[data-testid='detail-drawer']", { state: "detached", timeout: 5_000 });

    await page.click("[data-testid='approval-approve']");
    await page.waitForFunction(() => /shell/i.test(document.querySelector("[data-testid='approval-card']")?.textContent ?? ""), undefined, { timeout: 10_000 });
    await page.click("[data-testid='approval-approve']");
    await page.waitForSelector("[data-testid='approval-card']", { state: "detached", timeout: 20_000 });
    await page.waitForFunction(() => {
      const workflow = document.querySelector("[data-testid='workflow-panel']")?.textContent?.toLowerCase() ?? "";
      const taskPanel = document.querySelector("[data-testid='task-panel']")?.textContent?.toLowerCase() ?? "";
      return workflow.includes("completed") || workflow.includes("done") || taskPanel.includes("done") || taskPanel.includes("completed");
    }, undefined, { timeout: 20_000 });
    await page.screenshot({ path: path.join(artifactDir, "approval-flow-completed.png"), fullPage: true });
  });

  await context.close();
  if (failures.length) {
    await writeFile(path.join(artifactDir, "browser-failures.json"), JSON.stringify(failures, null, 2), "utf8");
    throw new Error(`Browser failures detected:\n${failures.map((failure) => `- ${failure.kind}: ${failure.detail}`).join("\n")}`);
  }
}

async function withTrace(context: BrowserContext, page: Page, name: string, run: () => Promise<void>): Promise<void> {
  await context.tracing.start({ screenshots: true, snapshots: true });
  try {
    await run();
    await context.tracing.stop();
  } catch (error) {
    await page.screenshot({ path: path.join(artifactDir, `${name}-failure.png`), fullPage: true }).catch(() => undefined);
    await context.tracing.stop({ path: path.join(artifactDir, `${name}-trace.zip`) }).catch(() => undefined);
    throw error;
  }
}

function attachFailureCollectors(page: Page, failures: BrowserFailure[], origin: string): void {
  page.on("console", (message) => {
    if (message.type() === "error") failures.push({ kind: "console", detail: message.text() });
  });
  page.on("pageerror", (error) => failures.push({ kind: "pageerror", detail: error.message }));
  page.on("requestfailed", (request) => {
    if (request.url().includes("/events/live")) return;
    failures.push({ kind: "requestfailed", detail: `${request.method()} ${redactNonce(request.url())} ${request.failure()?.errorText ?? ""}`.trim() });
  });
  page.on("response", (response) => {
    const responseUrl = response.url();
    if (!responseUrl.startsWith(origin)) return;
    if (responseUrl.includes("/events/live")) return;
    if (response.status() >= 400) failures.push({ kind: "response", detail: `${response.status()} ${redactNonce(responseUrl)}` });
  });
}

async function assertNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const metrics = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth
  }));
  const maxScrollWidth = Math.max(metrics.documentScrollWidth, metrics.bodyScrollWidth);
  if (maxScrollWidth > metrics.innerWidth + 1) {
    throw new Error(`${label} has horizontal overflow: scrollWidth=${maxScrollWidth}, innerWidth=${metrics.innerWidth}`);
  }
}

async function assertVisibleTestIds(page: Page, ids: string[], label: string): Promise<void> {
  const missing: string[] = [];
  for (const id of ids) {
    const visible = await page.locator(`[data-testid='${id}']`).first().isVisible().catch(() => false);
    if (!visible) missing.push(id);
  }
  if (missing.length) {
    throw new Error(`${label} missing visible data-testid(s): ${missing.join(", ")}`);
  }
}

async function assertAtLeastOneVisible(page: Page, id: string, label: string): Promise<void> {
  const count = await page.locator(`[data-testid='${id}']`).count();
  for (let index = 0; index < count; index += 1) {
    if (await page.locator(`[data-testid='${id}']`).nth(index).isVisible().catch(() => false)) return;
  }
  throw new Error(`${label} has no visible data-testid='${id}' element`);
}

async function touchOptionalTestIds(page: Page, ids: string[]): Promise<void> {
  for (const id of ids) {
    await page.locator(`[data-testid='${id}']`).count();
  }
}

async function waitForDrawerInViewport(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const drawer = document.querySelector("[data-testid='detail-drawer']");
    if (!drawer) return false;
    const rect = drawer.getBoundingClientRect();
    return rect.left >= -1 && rect.right <= window.innerWidth + 1;
  }, undefined, { timeout: 5_000 });
  const box = await page.locator("[data-testid='detail-drawer']").boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error("detail drawer is not measurable");
  if (box.x < -1 || box.x + box.width > viewport.width + 1) {
    throw new Error(`detail drawer is outside viewport: x=${box.x}, width=${box.width}, viewport=${viewport.width}`);
  }
}

async function waitForClientUrl(child: ChildProcessWithoutNullStreams, stdout: string[], stderr: string[]): Promise<string> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15_000) {
    const output = stdout.join("");
    const match = /TomorrowEdge GUI client:\s+(http:\/\/[^\s]+)/.exec(output);
    if (match) return match[1];
    if (child.exitCode !== null) throw new Error(`client exited before printing URL\n${stdout.join("")}\n${stderr.join("")}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for client URL\n${stdout.join("")}\n${stderr.join("")}`);
}

function stopChild(child: ChildProcessWithoutNullStreams): void {
  if (child.exitCode !== null) return;
  child.kill(process.platform === "win32" ? "SIGTERM" : "SIGINT");
  setTimeout(() => {
    if (child.exitCode === null) child.kill("SIGKILL");
  }, 2_000).unref();
}

function redactNonce(value: string): string {
  return value.replace(/nonce=([^&\s]+)/g, "nonce=[redacted]");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.stderr.write(`Cockpit e2e artifacts: ${artifactDir}\n`);
  process.exitCode = 1;
});
