import { describe, expect, it } from "vitest";
import React from "react";
import { PassThrough, Writable } from "node:stream";
import path from "node:path";
import { render } from "ink";
import { defaultConfig } from "../../src/config/defaultConfig.js";
import { runOfflineGraph } from "../../src/core/agentGraph/executor.js";
import { App } from "../../src/tui/App.js";

class RawModeInput extends PassThrough {
  isTTY = true;
  rawModeHistory: boolean[] = [];

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }

  setRawMode(mode: boolean): this {
    this.rawModeHistory.push(mode);
    return this;
  }
}

class CaptureOutput extends Writable {
  isTTY = true;
  columns = 120;
  rows = 34;
  chunks: string[] = [];

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    callback();
  }

  text(): string {
    return stripAnsi(this.chunks.join(""));
  }
}

describe("raw-mode TUI keyboard workflow", () => {
  it("boots the Ink cockpit, accepts operator input, changes focus, and exits on Ctrl+Q", async () => {
    const cwd = path.join(process.cwd(), "tests", "fixtures", "sample-repo-basic");
    const graph = await runOfflineGraph(cwd, "raw mode keyboard smoke", defaultConfig);
    const stdin = new RawModeInput();
    const stdout = new CaptureOutput();
    const stderr = new CaptureOutput();

    const instance = render(React.createElement(App, { graph, safeMode: true, cwd }), {
      stdin,
      stdout,
      stderr,
      exitOnCtrlC: false,
      patchConsole: false
    });

    await waitFor(() => stdout.text().includes("TomorrowEdge"), 5000);
    await waitFor(() => stdin.rawModeHistory.includes(true), 5000);
    for (const char of "review this") {
      stdin.write(char);
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await waitFor(() => stdout.text().includes("review this"), 5000);
    stdin.write("\t");
    await waitFor(() => stdout.text().includes("focus agents"), 5000);
    stdin.write("\x11");
    await instance.waitUntilExit();

    expect(stdin.rawModeHistory).toContain(true);
    expect(stdout.text()).toContain("TomorrowEdge");
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for TUI output");
}

function stripAnsi(value: string): string {
  return value.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
}
