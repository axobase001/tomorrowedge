import { createRequire } from "node:module";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { startLocalCockpitServer, type LocalCockpitHandle } from "../../localCockpit/server.js";
import { parseServePort } from "./serve.js";

type DesktopRuntime = "auto" | "app-mode" | "electron";

type DesktopCommandOptions = {
  port?: string;
  host?: string;
  runtime?: string;
};

type DesktopLaunchResult = {
  runtime: Exclude<DesktopRuntime, "auto"> | "browser";
  child?: ChildProcess;
  closeOnExit: boolean;
};

type DesktopCommandDependencies = {
  startServer: typeof startLocalCockpitServer;
  launchWindow: (runtime: DesktopRuntime, handle: LocalCockpitHandle) => Promise<DesktopLaunchResult>;
  write: (message: string) => void;
  bindShutdown: (handle: LocalCockpitHandle, child: ChildProcess | undefined, closeOnExit: boolean) => void;
};

type DesktopLaunchers = {
  electron: (url: string) => ChildProcess;
  appMode: (url: string) => ChildProcess;
  browser: (url: string) => ChildProcess;
};

export async function desktopCommand(cwd: string, options: DesktopCommandOptions = {}): Promise<void> {
  return desktopCommandWithDependencies(cwd, options, defaultDesktopCommandDependencies);
}

export async function desktopCommandWithDependencies(cwd: string, options: DesktopCommandOptions = {}, dependencies: DesktopCommandDependencies): Promise<void> {
  const runtime = parseDesktopRuntime(options.runtime);
  const port = parseServePort(options.port);
  const host = options.host ?? "127.0.0.1";
  const handle = await dependencies.startServer(cwd, { port, host });
  if (!isLoopbackHost(host)) {
    dependencies.write("Warning: desktop mode is bound to a non-loopback host. Keep the nonce URL private.\n");
  }
  if (handle.port !== handle.requestedPort && handle.requestedPort !== 0) {
    dependencies.write(`Port ${handle.requestedPort} is in use; using ${handle.port} instead.\n`);
  }

  try {
    const launched = await dependencies.launchWindow(runtime, handle);
    dependencies.write(`TomorrowEdge desktop app: ${handle.openUrl}\n`);
    dependencies.write(`Runtime: ${launched.runtime}\n`);
    dependencies.write("Close the desktop window or press Ctrl+C to stop.\n");
    dependencies.bindShutdown(handle, launched.child, launched.closeOnExit);
  } catch (error) {
    await handle.close();
    throw error;
  }
}

function parseDesktopRuntime(value?: string): DesktopRuntime {
  if (!value) return "auto";
  if (value === "auto" || value === "app-mode" || value === "electron") return value;
  throw new Error(`Invalid desktop runtime: ${value}. Use auto, app-mode, or electron.`);
}

export async function launchDesktopWindow(runtime: DesktopRuntime, handle: LocalCockpitHandle, launchers: DesktopLaunchers = defaultDesktopLaunchers): Promise<DesktopLaunchResult> {
  if (runtime === "electron") return { runtime: "electron", child: launchers.electron(handle.openUrl), closeOnExit: true };
  if (runtime === "app-mode") return { runtime: "app-mode", child: launchers.appMode(handle.openUrl), closeOnExit: false };

  try {
    return { runtime: "electron", child: launchers.electron(handle.openUrl), closeOnExit: true };
  } catch {
    try {
      return { runtime: "app-mode", child: launchers.appMode(handle.openUrl), closeOnExit: false };
    } catch {
      return { runtime: "browser", child: launchers.browser(handle.openUrl), closeOnExit: false };
    }
  }
}

function launchElectron(url: string): ChildProcess {
  const require = createRequire(import.meta.url);
  let electronPath: string;
  try {
    electronPath = require("electron") as string;
  } catch {
    throw new Error("Electron runtime is not installed. Install it only when needed with `npm install --save-dev electron`, or use `tedge desktop --runtime app-mode`.");
  }
  const mainPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "desktop", "electron-main.cjs");
  return spawn(electronPath, [mainPath], {
    detached: false,
    env: { ...process.env, TOMORROWEDGE_DESKTOP_URL: url },
    stdio: "ignore",
    windowsHide: true
  });
}

function launchAppMode(url: string): ChildProcess {
  if (process.platform === "win32") {
    return spawn("cmd", ["/c", "start", "", "msedge", `--app=${url}`, "--new-window"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
  }
  if (process.platform === "darwin") {
    const appName = findMacBrowserApp();
    if (!appName) throw new Error("No Chromium-compatible app-mode browser was found. Install Electron and run `tedge desktop --runtime electron`, or use `tedge client`.");
    return spawn("open", ["-na", appName, "--args", `--app=${url}`], { detached: true, stdio: "ignore" });
  }
  const command = findLinuxBrowserCommand();
  if (!command) throw new Error("No Chromium-compatible app-mode browser was found. Install Electron and run `tedge desktop --runtime electron`, or use `tedge client`.");
  return spawn(command, [`--app=${url}`, "--new-window"], { detached: true, stdio: "ignore" });
}

function findMacBrowserApp(): string | undefined {
  for (const appName of ["Google Chrome", "Microsoft Edge", "Chromium"]) {
    const result = spawnSync("open", ["-Ra", appName], { stdio: "ignore" });
    if (result.status === 0) return appName;
  }
  return undefined;
}

function findLinuxBrowserCommand(): string | undefined {
  for (const command of ["google-chrome", "chromium", "chromium-browser", "microsoft-edge"]) {
    const result = spawnSync(command, ["--version"], { stdio: "ignore" });
    if (result.status === 0) return command;
  }
  return undefined;
}

function openDefaultBrowser(url: string): ChildProcess {
  const launcher = findDefaultBrowserLauncher();
  if (!launcher) throw new Error("No desktop browser launcher was found. Install Electron and run `tedge desktop --runtime electron`, install a Chromium-compatible browser for app-mode, or use `tedge client --no-open`.");
  return spawn(launcher.command, [...launcher.args, url], { detached: true, stdio: "ignore", windowsHide: true });
}

export function bindDesktopShutdown(handle: LocalCockpitHandle, child: ChildProcess | undefined, closeOnExit: boolean, lifecycle = defaultLifecycle): void {
  const shutdown = () => {
    void handle.close().finally(() => lifecycle.exit(0));
  };
  lifecycle.onceSignal("SIGINT", shutdown);
  lifecycle.onceSignal("SIGTERM", shutdown);
  if (!closeOnExit) return;
  child?.once("exit", () => {
    void handle.close().finally(() => lifecycle.exit(0));
  });
}

function findDefaultBrowserLauncher(): { command: string; args: string[] } | undefined {
  if (process.platform === "win32") {
    return spawnSync("cmd", ["/c", "ver"], { stdio: "ignore" }).status === 0 ? { command: "cmd", args: ["/c", "start", ""] } : undefined;
  }
  if (process.platform === "darwin") {
    return spawnSync("open", ["-h"], { stdio: "ignore" }).status === 0 ? { command: "open", args: [] } : undefined;
  }
  return spawnSync("xdg-open", ["--version"], { stdio: "ignore" }).status === 0 ? { command: "xdg-open", args: [] } : undefined;
}

const defaultDesktopLaunchers: DesktopLaunchers = {
  electron: launchElectron,
  appMode: launchAppMode,
  browser: openDefaultBrowser
};

const defaultLifecycle = {
  onceSignal: (signal: NodeJS.Signals, listener: () => void) => process.once(signal, listener),
  exit: (code: number) => process.exit(code)
};

const defaultDesktopCommandDependencies: DesktopCommandDependencies = {
  startServer: startLocalCockpitServer,
  launchWindow: (runtime, handle) => launchDesktopWindow(runtime, handle),
  write: (message) => process.stdout.write(message),
  bindShutdown: (handle, child, closeOnExit) => bindDesktopShutdown(handle, child, closeOnExit)
};

function isLoopbackHost(host: string): boolean {
  return host === "127.0.0.1" || host === "localhost" || host === "::1";
}
