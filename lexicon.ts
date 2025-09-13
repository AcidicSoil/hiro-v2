// Configurable lexicon, scalable via data not code
const ROLE_LEXICON: Record<string, { re: RegExp; weight: number }[]> = {
  "Backend Engineer": [
    {
      re: /\b(api|rest|grpc|graphql|service|microservice|endpoint)\b/i,
      weight: 3,
    },
    { re: /\b(auth|jwt|rbac|rate[- ]?limit|idempotent)\b/i, weight: 2 },
  ],
  "Frontend Engineer": [
    { re: /\b(ui|ux|frontend|react|component|storybook)\b/i, weight: 3 },
    { re: /\b(accessibility|wcag|aria)\b/i, weight: 2 },
  ],
  "DevOps/SRE": [
    {
      re: /\b(kubernetes|k8s|terraform|helm|pipeline|cicd|slo|prometheus|grafana)\b/i,
      weight: 3,
    },
  ],
  "Data Engineer": [
    {
      re: /\b(etl|elt|warehouse|lakehouse|airflow|dbt|ingest|cdc)\b/i,
      weight: 3,
    },
  ],
  "ML Engineer": [
    {
      re: /\b(model|training|inference|serving|onnx|tensor|feature store)\b/i,
      weight: 3,
    },
  ],
  "QA Automation Engineer": [
    {
      re: /\b(test plan|automation|e2e|playwright|selenium|coverage)\b/i,
      weight: 3,
    },
  ],
  "Mobile Engineer": [
    { re: /\b(ios|android|swift|kotlin|compose|swiftui)\b/i, weight: 3 },
  ],
};

// Tech-stack boosts
const TECH_BOOST: Record<string, { roles: string[]; weight: number }> = {
  react: { roles: ["Frontend Engineer"], weight: 2 },
  vue: { roles: ["Frontend Engineer"], weight: 2 },
  grpc: { roles: ["Backend Engineer"], weight: 2 },
  fastify: { roles: ["Backend Engineer"], weight: 2 },
  postgres: { roles: ["Backend Engineer", "Data Engineer"], weight: 1 },
  kubernetes: { roles: ["DevOps/SRE"], weight: 3 },
  terraform: { roles: ["DevOps/SRE"], weight: 3 },
  airflow: { roles: ["Data Engineer"], weight: 3 },
  dbt: { roles: ["Data Engineer"], weight: 2 },
  pytorch: { roles: ["ML Engineer"], weight: 3 },
  swift: { roles: ["Mobile Engineer"], weight: 2 },
  kotlin: { roles: ["Mobile Engineer"], weight: 2 },
};

function inferRoleFromInputs(needs: string, techStack: string) {
  const text = `${needs || ""} ${techStack || ""}`;
  const scores: Record<string, number> = {};

  // Base lexical scoring with word boundaries
  for (const [role, features] of Object.entries(ROLE_LEXICON)) {
    let s = 0;
    for (const f of features) if (f.re.test(text)) s += f.weight;
    scores[role] = s;
  }

  // Tech boosts
  const techTokens = (techStack || "")
    .toLowerCase()
    .split(/[^a-z0-9.+-]+/)
    .filter(Boolean);
  for (const token of techTokens) {
    const boost = TECH_BOOST[token];
    if (!boost) continue;
    for (const r of boost.roles) scores[r] = (scores[r] || 0) + boost.weight;
  }

  // Rank
  const ranked = Object.entries(scores)
    .map(([role, score]) => ({ role, score }))
    .sort((a, b) => b.score - a.score);

  const top = ranked[0];
  const second = ranked[1] || { score: 0 };
  const confidence =
    top.score === 0 ? 0 : (top.score - second.score) / Math.max(1, top.score);

  const table: Record<string, { stages: string[]; scope: string }> = {
    "Backend Engineer": {
      stages: ["Backend", "Tooling"],
      scope:
        "Design stable APIs and services with reliability and observability.",
    },
    "Frontend Engineer": {
      stages: ["UI/UX", "Frontend"],
      scope:
        "Deliver accessible, performant UI against design and API contracts.",
    },
    "DevOps/SRE": {
      stages: ["Infra/Cloud", "Build/CI", "Observability"],
      scope: "Provide reliable deploys, infra as code, and SLOs.",
    },
    "Data Engineer": {
      stages: ["Data/DB", "Backend"],
      scope: "Build pipelines, schemas, and data quality checks.",
    },
    "ML Engineer": {
      stages: ["Data/DB", "Backend"],
      scope: "Train and serve models with reproducibility.",
    },
    "QA Automation Engineer": {
      stages: ["QA/Test", "Maintenance"],
      scope: "Automate regression and quality gates.",
    },
    "Mobile Engineer": {
      stages: ["UI/UX", "Frontend"],
      scope: "Ship native app features with offline and telemetry.",
    },
  };

  const chosen =
    table[top?.role || "Backend Engineer"] || table["Backend Engineer"];
  return {
    role: top?.role || "Backend Engineer",
    stages: chosen.stages,
    scope: chosen.scope,
    confidence,
    topN: ranked.slice(0, 3),
  };
}
