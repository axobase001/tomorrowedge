import type { AccessMode } from "../../config/schema.js";

export type WorkflowRecipe = {
  id: string;
  name: string;
  description: string;
  defaultGoal: string;
  accessMode?: AccessMode;
  options?: {
    repairOnFail?: boolean;
    redTeamReview?: boolean;
    liveAdvisory?: boolean;
    livePatch?: boolean;
    testCommand?: string;
  };
  roles: string[];
  verification: string[];
};
