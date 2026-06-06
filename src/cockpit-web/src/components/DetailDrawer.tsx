import type { CockpitViewModel } from "../../../cockpit/contracts.js";

export function DetailDrawer({ viewModel }: { viewModel: CockpitViewModel }) {
  return (
    <aside className="te-drawer" hidden>
      <h2>详情</h2>
      <pre>{viewModel.routes.map((route) => `${route.role} -> ${route.provider}/${route.model}`).join("\n")}</pre>
    </aside>
  );
}
