import { readFileSync } from "node:fs";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const stdin = Buffer.concat(chunks).toString("utf8");
const request = JSON.parse(stdin);
const fileRequest = JSON.parse(readFileSync(process.env.TOMORROWEDGE_EXTERNAL_CONTEXT_FILE, "utf8"));

process.stdout.write(JSON.stringify({
  ok: true,
  summary: `packaged mock command handled ${request.role}: ${request.task}`,
  sameTaskFromFile: fileRequest.task === request.task,
  externalAgentId: process.env.TOMORROWEDGE_EXTERNAL_AGENT_ID,
  role: process.env.TOMORROWEDGE_EXTERNAL_AGENT_ROLE
}));
