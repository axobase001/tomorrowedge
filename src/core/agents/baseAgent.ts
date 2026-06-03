import type { ModelRouter } from "../routing/router.js";

export type AgentContext = {
  cwd: string;
  router: ModelRouter;
};

export abstract class BaseAgent<Input, Output> {
  abstract readonly role: string;
  abstract run(input: Input, context: AgentContext): Promise<Output>;
}
