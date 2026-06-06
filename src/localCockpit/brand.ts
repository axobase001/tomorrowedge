export const cockpitIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="TomorrowEdge">
  <rect width="64" height="64" rx="14" fill="#f7f7f3"/>
  <rect x="1" y="1" width="62" height="62" rx="13" fill="none" stroke="#161616" stroke-opacity=".18" stroke-width="2"/>
  <path d="M13 18h38l-9 10H4z" fill="#d81f0d"/>
  <path d="M29 29h15l7 7v7l-22 8z" fill="#050505"/>
  <path d="M15 49h22" stroke="#25d7e8" stroke-width="4" stroke-linecap="square"/>
</svg>`;

export function cockpitManifest(): Record<string, unknown> {
  return {
    name: "TomorrowEdge GUI Client",
    short_name: "TomorrowEdge",
    description: "A local GUI client for full-access multi-model coding agents.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#f6fafc",
    theme_color: "#f7f7f3",
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any maskable"
      }
    ]
  };
}
