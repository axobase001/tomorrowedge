import { parseGoalToPlan } from "../goal/goalParser.js";
import { BaseAgent } from "./baseAgent.js";
import type { Plan } from "../../schemas/plan.js";

export class PlannerAgent extends BaseAgent<{ goal: string }, Plan> {
  readonly role = "planner";

  async run(input: { goal: string }): Promise<Plan> {
    return parseGoalToPlan(input.goal);
  }
}
