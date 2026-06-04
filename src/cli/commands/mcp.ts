import { TomorrowEdgeMcpBridge } from "../../mcp/bridge.js";
import { serveMcpStdio } from "../../mcp/server.js";

export function mcpStatusCommand(): void {
  process.stdout.write("MCP Agent Bridge: experimental.\n");
  process.stdout.write("stdio server and TomorrowEdge tool listing are available; external agent invocation requires external_agents config.\n");
}

export async function mcpServeCommand(cwd: string): Promise<void> {
  await serveMcpStdio({ cwd });
}

export function mcpToolsCommand(cwd: string): void {
  const bridge = new TomorrowEdgeMcpBridge(cwd);
  for (const tool of bridge.listTools()) {
    process.stdout.write(`${tool.name}\t${tool.description}\n`);
  }
}

export async function mcpAgentsCommand(cwd: string, options: { probe?: boolean } = {}): Promise<void> {
  const bridge = new TomorrowEdgeMcpBridge(cwd);
  const agents = bridge.listAgents();
  if (!agents.length) {
    process.stdout.write("No enabled external MCP agents. Configure external_agents in .tomorrowedge/config.yaml.\n");
    return;
  }
  if (options.probe) {
    const rows = await bridge.probeAgents();
    for (const row of rows) {
      process.stdout.write(`${row.id}\t${row.name}\t${row.ok ? "ok" : "error"}\t${row.detail}${row.tools?.length ? `\ttools=${row.tools.join(",")}` : ""}\n`);
    }
    return;
  }
  for (const agent of agents) {
    const proxy = agent.proxyPort ? `\tproxy=127.0.0.1:${agent.proxyPort}` : "";
    process.stdout.write(`${agent.id}\t${agent.name}\troles=${agent.allowedRoles.join(",")}\tcapabilities=${agent.capabilities.join(",")}\ttrust=${agent.trustLevel}\tcommand=${agent.command || "(not configured)"}${proxy}\n`);
  }
}

export async function mcpInvokeCommand(cwd: string, externalAgentId: string, options: { session?: string; role?: string; tool?: string; prompt?: string }): Promise<void> {
  const bridge = new TomorrowEdgeMcpBridge(cwd);
  const result = await bridge.invokeExternalAgent({
    sessionId: options.session ?? "latest",
    externalAgentId,
    role: (options.role ?? "reviewer") as never,
    toolName: options.tool,
    prompt: options.prompt
  });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
}
