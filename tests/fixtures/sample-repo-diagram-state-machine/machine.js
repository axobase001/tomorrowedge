export const states = ["idle", "running", "failed", "done"];

export function transition(state, event) {
  if (state === "idle" && event === "start") return "running";
  if (state === "running" && event === "fail") return "failed";
  if (state === "running" && event === "finish") return "done";
  if (state === "failed" && event === "retry") return "running";
  return state;
}
