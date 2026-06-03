const header = document.querySelector(".site-header");
const toggle = document.querySelector(".nav-toggle");
const mobileNav = document.querySelector("#mobile-nav");

function syncHeader() {
  header?.setAttribute("data-elevated", String(window.scrollY > 12));
}

syncHeader();
window.addEventListener("scroll", syncHeader, { passive: true });

toggle?.addEventListener("click", () => {
  const isOpen = toggle.getAttribute("aria-expanded") === "true";
  toggle.setAttribute("aria-expanded", String(!isOpen));
  if (mobileNav) {
    mobileNav.hidden = isOpen;
  }
});

mobileNav?.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    toggle?.setAttribute("aria-expanded", "false");
    mobileNav.hidden = true;
  });
});

const revealItems = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.16 }
  );

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const featureCopy = {
  providers: {
    kicker: "Provider layer",
    title: "Route work across model families without locking the cockpit to one stack.",
    description:
      "Connect OpenRouter, DeepSeek, MiMo, OpenAI-compatible endpoints, Ollama, fixture, and mock providers. TomorrowEdge keeps provider choice visible instead of hiding it behind a single black-box call.",
    href: "./architecture/providers.html",
    action: "Open providers",
  },
  router: {
    kicker: "Role router",
    title: "Assign the right model to the right agent role.",
    description:
      "Planner, explorer, coder, reviewer, judge, runner, repairer, and summarizer can each use different providers, prices, and privacy boundaries while sharing one traceable workflow.",
    href: "./architecture/role-router.html",
    action: "Open role router",
  },
  backend: {
    kicker: "Architecture",
    title: "Neutral control layer for agent execution.",
    description:
      "The cockpit owns access modes, routing, authorization, replay, and traceability. Native execution is available now; external frameworks can stream their steps back as TomorrowEdge events.",
    href: "./architecture/orchestration-backend.html",
    action: "Open backend",
  },
  runtime: {
    kicker: "Cockpit runtime",
    title: "Render autonomy as state, not as a hidden transcript.",
    description:
      "The TUI cockpit shows agents, routing, debate, diffs, shell commands, evidence, memory, approvals, and cost in one dense operator surface built for real engineering sessions.",
    href: "./architecture/cockpit-runtime.html",
    action: "Open runtime",
  },
  ledger: {
    kicker: "Event ledger",
    title: "Replay every meaningful action after the run.",
    description:
      "Model calls, context selection, patches, commands, review decisions, fallbacks, artifacts, and verification results are written into a ledger that can be traced, replayed, and exported.",
    href: "./architecture/event-ledger.html",
    action: "Open event ledger",
  },
  adapters: {
    kicker: "Adapters",
    title: "Let external frameworks execute without owning the cockpit.",
    description:
      "LangGraph, CrewAI, AutoGen, and MCP adapters can plug into the same event contract so TomorrowEdge remains the supervision, governance, and visibility layer.",
    href: "./architecture/adapters.html",
    action: "Open adapters",
  },
};

const featureTiles = document.querySelectorAll("[data-feature]");
const featureKicker = document.querySelector("#architecture-kicker");
const featureTitle = document.querySelector("#architecture-title");
const featureDescription = document.querySelector("#architecture-description");
const featureLink = document.querySelector("#architecture-link");

function setFeature(feature) {
  const copy = featureCopy[feature];
  if (!copy || !featureKicker || !featureTitle || !featureDescription || !featureLink) {
    return;
  }

  featureKicker.textContent = copy.kicker;
  featureTitle.textContent = copy.title;
  featureDescription.textContent = copy.description;
  featureLink.href = copy.href;
  featureLink.querySelector("span:first-child").textContent = copy.action;

  featureTiles.forEach((tile) => {
    tile.setAttribute("aria-current", String(tile.dataset.feature === feature));
  });
}

featureTiles.forEach((tile) => {
  tile.addEventListener("mouseenter", () => setFeature(tile.dataset.feature));
  tile.addEventListener("focus", () => setFeature(tile.dataset.feature));
});
