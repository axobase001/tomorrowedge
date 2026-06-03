# UI Style

TomorrowEdge should feel like a sober programmer cockpit, closer to `lazygit`, `k9s`, `btop`, and `htop` than a SaaS landing page.

Default UI language: Chinese (`zh-CN`).

Principles:

- dense but readable
- dark terminal-first surface
- thin borders and stable panes
- restrained color for status, diff, and risk only
- no decorative gradients, mascots, or marketing hero treatment
- visible approval state for patch and shell actions
- panes should privilege state over raw log waterfall
- subtle sci-fi engineering accents are allowed, but workflow hierarchy must stay dominant

Recommended palette:

```text
background: #0d1117
panel:      #111827
border:     #30363d
text:       #d1d5db
muted:      #8b949e
green:      #3fb950
yellow:     #d29922
red:        #f85149
cyan:       #58a6ff
```

Image generation prompt for built-in imagegen/image2:

```text
Use case: ui-mockup
Asset type: product UI concept reference for a terminal/TUI coding agent cockpit
Primary request: Create a refined TomorrowEdge cockpit UI mockup with a subtle sci-fi engineering aesthetic, but keep the interface practical, programmer-friendly, and information-first. Default language must be Chinese.
Style/medium: high-fidelity terminal UI mockup, dark theme, sharp monospaced typography, thin borders, restrained sci-fi instrumentation.
Composition/framing: widescreen cockpit layout with panes for 智能体, 目标, 路由, 辩论, Diff, Shell, 证据, 记忆, 帮助.
Color palette: dark graphite background, muted gray panels, cyan active state, green success, amber approval warning, red failure, subtle cyan edge highlights, no purple gradients.
Text (verbatim): "TomorrowEdge / 明日边缘", "安全模式", "智能体", "Diff", "等待补丁授权", "裁决：选择 fixture_candidate_a", "拟运行：npm test"
Constraints: simple, sober, programmer-friendly, information dense, subtle sci-fi but not cyberpunk, no logo, no mascot, no stock imagery, no neon, no marketing hero.
Avoid: decorative blobs, glossy 3D, rounded SaaS cards, large illustrations, fake browser chrome, excessive purple gradients.
```

Current image2 baseline:

```text
docs/ui/tomorrowedge-cockpit-image2-v4-cn-sci.png
```

Use it as the visual target for the actual TUI: compact Chinese agent list, explicit routing state, central debate/shell/evidence panels, a large diff approval pane, and a bottom memory/keybinding strip. Treat generated text content as illustrative; runtime copy should come from real agent state.
