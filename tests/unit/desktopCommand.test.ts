import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { bindDesktopShutdown, buildElectronLaunchConfig, desktopCommandWithDependencies, isWslEnvironment, isWslgEnvironment, launchDesktopWindow } from "../../src/cli/commands/desktop.js";
import type { LocalCockpitHandle } from "../../src/localCockpit/server.js";

describe("desktop command", () => {
  it("surfaces an actionable error when no desktop runtime can launch", async () => {
    await expect(launchDesktopWindow("auto", fakeHandle(), {
      electron: () => { throw new Error("Electron runtime is not installed."); },
      appMode: () => { throw new Error("No Chromium-compatible app-mode browser was found."); },
      browser: () => { throw new Error("No desktop browser launcher was found."); }
    })).rejects.toThrow("No desktop browser launcher was found");
  });

  it("closes the local cockpit server when desktop launch fails", async () => {
    let closed = 0;
    const handle = fakeHandle({ close: async () => { closed += 1; } });

    await expect(desktopCommandWithDependencies(process.cwd(), { runtime: "auto" }, {
      startServer: async () => handle,
      launchWindow: async () => { throw new Error("No desktop browser launcher was found."); },
      write: () => undefined,
      bindShutdown: () => undefined
    })).rejects.toThrow("No desktop browser launcher was found");

    expect(closed).toBe(1);
  });

  it("reports desktop port fallback and launches against the bound port", async () => {
    const writes: string[] = [];
    let launchedUrl = "";
    const handle = fakeHandle({
      requestedPort: 18792,
      port: 18793,
      url: "http://127.0.0.1:18793",
      openUrl: "http://127.0.0.1:18793/?nonce=test"
    });

    await desktopCommandWithDependencies(process.cwd(), { runtime: "app-mode", port: "18792" }, {
      startServer: async () => handle,
      launchWindow: async (_runtime, startedHandle) => {
        launchedUrl = startedHandle.openUrl;
        return { runtime: "app-mode", child: fakeChild(), closeOnExit: false };
      },
      write: (message) => writes.push(message),
      bindShutdown: () => undefined
    });

    expect(writes.join("")).toContain("Port 18792 is in use; using 18793 instead.");
    expect(writes.join("")).toContain("Runtime: app-mode");
    expect(launchedUrl).toBe("http://127.0.0.1:18793/?nonce=test");
  });

  it("closes the server when an Electron-style child exits", async () => {
    let closed = 0;
    const exitCodes: number[] = [];
    const child = fakeChild();

    bindDesktopShutdown(fakeHandle({ close: async () => { closed += 1; } }), child, true, {
      onceSignal: () => undefined,
      exit: (code) => { exitCodes.push(code); }
    });
    child.emit("exit", 0);
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(closed).toBe(1);
    expect(exitCodes).toEqual([0]);
  });

  it("keeps the default Electron launch config minimal outside WSLg", () => {
    const config = buildElectronLaunchConfig("http://127.0.0.1:18792/?nonce=test", {
      PATH: "/usr/bin"
    });

    expect(config.args).toHaveLength(1);
    expect(toPosixPath(config.args[0])).toContain("desktop/electron-main.cjs");
    expect(config.args).not.toContain("--disable-gpu");
    expect(config.env.TOMORROWEDGE_DESKTOP_URL).toBe("http://127.0.0.1:18792/?nonce=test");
    expect(config.env.TOMORROWEDGE_DESKTOP_WSLG).toBeUndefined();
  });

  it("adds WSLg-safe Electron rendering flags when launched from WSLg", () => {
    const env = {
      PATH: "/usr/bin",
      WSL_DISTRO_NAME: "Ubuntu-24.04",
      WSL2_GUI_APPS_ENABLED: "1",
      WAYLAND_DISPLAY: "wayland-0",
      DISPLAY: ":0"
    };
    const config = buildElectronLaunchConfig("http://127.0.0.1:18792/?nonce=test", env);

    expect(isWslgEnvironment(env)).toBe(true);
    expect(config.args).toEqual(expect.arrayContaining([
      "--class=TomorrowEdge",
      "--disable-gpu",
      "--disable-gpu-compositing",
      "--disable-dev-shm-usage",
      "--ozone-platform=x11",
      "--no-sandbox"
    ]));
    expect(toPosixPath(config.args.at(-1) ?? "")).toContain("desktop/electron-main.cjs");
    expect(config.env.TOMORROWEDGE_DESKTOP_WSLG).toBe("1");
    expect(config.env.LIBGL_ALWAYS_SOFTWARE).toBe("1");
  });

  it("detects WSL when common WSL variables are present", () => {
    expect(isWslEnvironment({ WSL_INTEROP: "/run/WSL/1_interop" })).toBe(true);
    expect(isWslEnvironment({ WSL_DISTRO_NAME: "Ubuntu-24.04" })).toBe(true);
  });
});

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function fakeHandle(overrides: Partial<LocalCockpitHandle> = {}): LocalCockpitHandle {
  return {
    server: {} as LocalCockpitHandle["server"],
    url: "http://127.0.0.1:18792",
    openUrl: "http://127.0.0.1:18792/?nonce=test",
    nonce: "test",
    requestedPort: 18792,
    port: 18792,
    close: async () => undefined,
    ...overrides
  };
}

function fakeChild(): ChildProcess {
  return new EventEmitter() as ChildProcess;
}
