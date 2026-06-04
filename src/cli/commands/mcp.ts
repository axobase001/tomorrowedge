import { TomorrowEdgeMcpBridge } from "../../mcp/bridge.js";
import { serveMcpStdio } from "../../mcp/server.js";

export async function mcpServeCommand(cwd: string): Promise<void> {
  await serveMcpStdio({ cwd });
}

export function mcpToolsCommand(cwd: string): void {
  const bridge = new TomorrowEdgeMcpBridge(cwd);
  for (const tool of bridge.listTools()) {
    process.stdout.write(`${tool.name}\t${tool.description}\n`);
  }
}

export function mcpAgentsCommand(cwd: string): void {
  const bridge = new TomorrowEdgeMcpBridge(cwd);
  const agents = bridge.listAgents();
  if (!agents.length) {
    process.stdout.write("No enabled external MCP agents. Configure external_agents in .tomorrowedge/config.yaml.\n");
    return;
  }
  for (const agent of agents) {
    process.stdout.write(`${agent.id}\t${agent.name}\troles=${agent.allowedRoles.join(",")}\tcapabilities=${agent.capabilities.join(",")}\ttrust=${agent.trustLevel}\n`);
  }
}
