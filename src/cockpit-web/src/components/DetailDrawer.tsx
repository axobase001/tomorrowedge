import type { CockpitViewModel } from "../../../cockpit/contracts.js";
import type { Translator } from "../i18n.js";

export function DetailDrawer({ viewModel, open, t, onClose }: { viewModel: CockpitViewModel; open: boolean; t: Translator; onClose: () => void }) {
  if (!open) return null;
  return (
    <>
      <div className="te-drawer-backdrop" onClick={onClose} data-testid="drawer-backdrop" />
      <aside className="te-drawer open" aria-hidden={false} data-testid="detail-drawer">
        <header>
          <h2>{t("drawer.title")}</h2>
          <button type="button" onClick={onClose} data-testid="detail-drawer-close">{t("drawer.close")}</button>
        </header>
      <h3>{t("drawer.approvalHistory")}</h3>
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
      <h3>{t("drawer.capabilityDashboard")}</h3>
      <pre>{viewModel.capabilities.map((capability) => [
        `${capability.label} [${capability.status}]`,
        `category=${capability.category}`,
        `readiness=${capability.readiness}`,
        `refs=${capability.refs.join(", ")}`
      ].join("\n")).join("\n\n") || "-"}</pre>
      <h3>{t("drawer.diff")}</h3>
      <pre>{viewModel.main.diff || t("drawer.noDiff")}</pre>
      <h3>{t("drawer.routes")}</h3>
      <pre>{viewModel.routes.map((route) => [
        `${route.role} -> ${route.provider}/${route.model}`,
        route.reason ? `because ${route.reason}` : undefined
      ].filter(Boolean).join("\n")).join("\n\n") || "-"}</pre>
      <h3>{t("drawer.roleGraph")}</h3>
      <pre>{formatRoleGraph(viewModel)}</pre>
      <h3>{t("drawer.artifacts")}</h3>
      <pre>{viewModel.artifacts.map((artifact) => artifact.ref).join("\n") || "-"}</pre>
      <h3>{t("drawer.rawEvents")}</h3>
      <pre>{JSON.stringify(viewModel.rawEvents.slice(-40), null, 2)}</pre>
    </aside>
    </>
  );
}

function formatRoleGraph(viewModel: CockpitViewModel): string {
  const graph = viewModel.roleGraph;
  if (!graph) return "-";
  const nodes = graph.nodes.map((node) => [
    `${node.id} (${node.role}) ${node.required ? "required" : "optional"}`,
    `after=${node.dependencies.join(", ") || "-"}`,
    `fallback=${node.canFallback ? "yes" : "no"} skip=${node.canSkip ? "yes" : "no"} retries=${node.maxRetries}`,
    node.consumes.length ? `consumes=${node.consumes.join(", ")}` : undefined,
    node.produces.length ? `produces=${node.produces.join(", ")}` : undefined
  ].filter(Boolean).join("\n"));
  return [
    `workflow=${graph.workflowKind}`,
    "",
    ...nodes,
    "",
    `stop=${graph.stopConditions.join(", ") || "-"}`
  ].join("\n");
}
