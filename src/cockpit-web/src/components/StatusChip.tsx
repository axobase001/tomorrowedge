export function StatusChip({ status }: { status: string }) {
  const lowered = status.toLowerCase();
  const tone = lowered.includes("fail") || lowered.includes("reject")
    ? "red"
    : lowered.includes("wait") || lowered.includes("approval") || lowered.includes("not_run")
      ? "amber"
      : lowered.includes("done") || lowered.includes("pass") || lowered.includes("low")
        ? "green"
        : "blue";
  return <span className={`te-chip te-chip-${tone}`}>{status}</span>;
}
