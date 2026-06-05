import { startLocalCockpitServer } from "../../localCockpit/server.js";

export async function serveCommand(cwd: string, options: { port?: string; host?: string; open?: boolean } = {}): Promise<void> {
  const port = options.port ? Number(options.port) : 18792;
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) throw new Error(`Invalid port: ${options.port}`);
  const handle = await startLocalCockpitServer(cwd, { port, host: options.host });
  if (handle.port !== handle.requestedPort && handle.requestedPort !== 0) {
    process.stdout.write(`Port ${handle.requestedPort} is in use; using ${handle.port} instead.\n`);
  }
  process.stdout.write(`TomorrowEdge local cockpit: ${handle.url}\n`);
  process.stdout.write("Press Ctrl+C to stop.\n");
  if (options.open) {
    await openBrowser(handle.url);
  }
}

async function openBrowser(url: string): Promise<void> {
  const { spawn } = await import("node:child_process");
  const command = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.unref();
}
