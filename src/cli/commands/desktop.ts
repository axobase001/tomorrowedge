import { createRequire } from "node:module";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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

export type ElectronLaunchConfig = {
  args: string[];
  env: NodeJS.ProcessEnv;
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
    dependencies.write("Warning: desktop mode is bound to a non-loopback host. Keep the local cockpit session private.\n");
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
  if (isWslEnvironment()) {
    const windowsElectron = launchWindowsElectronFromWsl(url);
    if (windowsElectron) return windowsElectron;
  }

  const require = createRequire(import.meta.url);
  let electronPath: string;
  try {
    electronPath = require("electron") as string;
  } catch {
    throw new Error("Electron runtime is not installed. Install it only when needed with `npm install --save-dev electron`, or use `tedge desktop --runtime app-mode`.");
  }
  const launchConfig = buildElectronLaunchConfig(url);
  return spawn(electronPath, launchConfig.args, {
    detached: false,
    env: launchConfig.env,
    stdio: "ignore",
    windowsHide: true
  });
}

export function buildElectronLaunchConfig(url: string, env: NodeJS.ProcessEnv = process.env): ElectronLaunchConfig {
  const mainPath = resolveElectronMainPath();
  const launchEnv: NodeJS.ProcessEnv = { ...env, TOMORROWEDGE_DESKTOP_URL: url };
  if (!isWslgEnvironment(env)) return { args: [mainPath], env: launchEnv };

  launchEnv.TOMORROWEDGE_DESKTOP_WSLG = "1";
  launchEnv.LIBGL_ALWAYS_SOFTWARE = launchEnv.LIBGL_ALWAYS_SOFTWARE ?? "1";
  return {
    args: [
      "--class=TomorrowEdge",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-dev-shm-usage",
      "--ozone-platform=x11",
      "--no-sandbox",
      mainPath
    ],
    env: launchEnv
  };
}

function launchWindowsElectronFromWsl(url: string): ChildProcess | undefined {
  const launchConfig = buildWindowsElectronLaunchConfigFromWsl(url);
  if (!launchConfig) return undefined;
  return spawn(launchConfig.command, launchConfig.args, {
    cwd: launchConfig.cwd,
    detached: false,
    stdio: "ignore",
    windowsHide: true
  });
}

export function buildWindowsElectronLaunchConfigFromWsl(url: string): { command: string; args: string[]; cwd: string } | undefined {
  const nodePath = findWindowsNodeFromWsl();
  const npxCliPath = findWindowsNpxCliFromWsl();
  const mainPath = toWindowsPathFromWsl(resolveElectronMainPath());
  if (!nodePath || !npxCliPath || !mainPath) return undefined;

  return {
    command: nodePath,
    args: [
      npxCliPath,
      "--yes",
      `electron@${resolveElectronPackageVersion()}`,
      mainPath,
      `--tomorrowedge-url=${url}`
    ],
    cwd: "/mnt/c/Windows/System32"
  };
}

function resolveElectronMainPath(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "desktop", "electron-main.cjs");
}

function resolveElectronPackageVersion(): string {
  const require = createRequire(import.meta.url);
  try {
    const pkg = require("electron/package.json") as { version?: string };
    return pkg.version ?? "latest";
  } catch {
    return "latest";
  }
}

function findWindowsNodeFromWsl(): string | undefined {
  for (const command of [
    "/mnt/c/Program Files/nodejs/node.exe",
    "/mnt/c/Program Files (x86)/nodejs/node.exe"
  ]) {
    if (existsSync(command)) return command;
  }
  return undefined;
}

function findWindowsNpxCliFromWsl(): string | undefined {
  for (const command of [
    "/mnt/c/Program Files/nodejs/node_modules/npm/bin/npx-cli.js",
    "/mnt/c/Program Files (x86)/nodejs/node_modules/npm/bin/npx-cli.js"
  ]) {
    if (!existsSync(command)) continue;
    return toWindowsPathFromWsl(command);
  }
  return undefined;
}

function toWindowsPathFromWsl(value: string): string | undefined {
  const result = spawnSync("wslpath", ["-w", value], { encoding: "utf8" });
  if (result.status !== 0) return undefined;
  const converted = result.stdout.trim();
  return converted.length > 0 ? converted : undefined;
}

export function isWslgEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(
    env.WSL_DISTRO_NAME &&
    (env.WSL2_GUI_APPS_ENABLED === "1" || env.WAYLAND_DISPLAY || env.DISPLAY)
  );
}

export function isWslEnvironment(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.WSL_DISTRO_NAME || env.WSL_INTEROP || env.WSL2_GUI_APPS_ENABLED) return true;
  if (process.platform !== "linux") return false;
  try {
    const release = readFileSync("/proc/sys/kernel/osrelease", "utf8").toLowerCase();
    return release.includes("microsoft") || release.includes("wsl");
  } catch {
    return false;
  }
}

function launchAppMode(url: string): ChildProcess {
  if (process.platform === "win32") {
    return spawn("cmd", ["/c", "start", "", "msedge", `--app=${url}`, "--new-window"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });
  }
  if (isWslEnvironment()) {
    const command = findWindowsBrowserFromWsl();
    if (command) {
      return spawn(command, [`--app=${url}`, "--new-window"], {
        cwd: "/mnt/c/Windows/System32",
        detached: true,
        stdio: "ignore",
        windowsHide: true
      });
    }
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

function findWindowsBrowserFromWsl(): string | undefined {
  for (const command of [
    "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/mnt/c/Program Files/Microsoft/Edge/Application/msedge.exe",
    "/mnt/c/Program Files/Google/Chrome/Application/chrome.exe",
    "/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe"
  ]) {
    if (existsSync(command)) return command;
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
