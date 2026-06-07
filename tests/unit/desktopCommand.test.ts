import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { describe, expect, it } from "vitest";
import { bindDesktopShutdown, desktopCommandWithDependencies, launchDesktopWindow } from "../../src/cli/commands/desktop.js";
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
});

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
