import type { CockpitViewModel } from "../../../cockpit/contracts.js";

export function DetailDrawer({ viewModel, open, onClose }: { viewModel: CockpitViewModel; open: boolean; onClose: () => void }) {
  return (
    <aside className={`te-drawer ${open ? "open" : ""}`} aria-hidden={!open} data-testid="detail-drawer">
      <header>
        <h2>Details</h2>
        <button type="button" onClick={onClose} data-testid="close-drawer">Close</button>
      </header>
      <h3>Approval history</h3>
      <pre>{viewModel.approvalHistory.map((item) => [
        `${item.timestamp} ${item.approvalId} ${item.kind}/${item.status}`,
        `action=${item.action} actor=${item.actor} source=${item.source}`,
        item.blocksProgress ? "blocks=workflow progress is waiting on this approval" : "blocks=-",
        item.command ? `command=${item.command}` : undefined,
        item.candidateId ? `candidate=${item.candidateId}` : undefined,
        item.filesChanged.length ? `files=${item.filesChanged.join(", ")}` : undefined,
        item.diffRef ? `diff=${item.diffRef}` : undefined,
        item.stdoutRef ? `stdout=${item.stdoutRef}` : undefined,
        item.stderrRef ? `stderr=${item.stderrRef}` : undefined,
        item.undoSnapshotIds?.length ? `undo=${item.undoSnapshotIds.join(", ")}` : undefined,
        `filters=${item.filterTags.join(", ")}`
      ].filter(Boolean).join("\n")).join("\n\n") || "-"}</pre>
      <h3>Capability dashboard</h3>
      <pre>{viewModel.capabilities.map((capability) => [
        `${capability.label} [${capability.status}]`,
        `category=${capability.category}`,
        `readiness=${capability.readiness}`,
        `refs=${capability.refs.join(", ")}`
      ].join("\n")).join("\n\n") || "-"}</pre>
      <h3>Diff</h3>
      <pre>{viewModel.main.diff || "No diff in the current main view."}</pre>
      <h3>Routes</h3>
      <pre>{viewModel.routes.map((route) => `${route.role} -> ${route.provider}/${route.model}`).join("\n") || "-"}</pre>
      <h3>Artifacts</h3>
      <pre>{viewModel.artifacts.map((artifact) => artifact.ref).join("\n") || "-"}</pre>
      <h3>Raw events</h3>
      <pre>{JSON.stringify(viewModel.rawEvents.slice(-40), null, 2)}</pre>
    </aside>
  );
}
