export type TaskMemory = {
  preferredTestCommands: string[];
  commonConstraints: string[];
  routingPreference?: string;
};

export const emptyTaskMemory: TaskMemory = {
  preferredTestCommands: [],
  commonConstraints: []
};
