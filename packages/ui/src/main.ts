import "./styles.css";

type Episode = {
  id: string;
  createdAt: string;
  prompt: string;
  taskKind: string;
  runtimeId: string;
  providerId: string;
  model: string;
  reasoning?: string;
  responseText: string;
  evidence: Array<{ kind: string; label: string; status: string; detail?: string }>;
};

type CockpitState = {
  generatedAt: string;
  generatedFrom?: string;
  source?: "exported" | "fallback" | "invalid";
  error?: string;
  configured?: boolean;
  configSummary?: {
    defaultRuntime: string;
    oneRuntimePerRun: boolean;
    preferLocalForSensitive: boolean;
    providers: Array<{ id: string; kind: string; defaultModel: string; baseUrl?: string; apiKeyEnv?: string }>;
    runtimes: Array<{ id: string; enabled: boolean; provider: string; taskRoutes: string[] }>;
  };
  episodes: Episode[];
  feedback: Array<{ episodeId: string; value: string; adjudication: string }>;
  candidates: Array<{ episodeId: string; kind: string; risk: string; summary: string; autoApply: boolean }>;
};

const state = await loadCockpitState();
const activeEpisode = state.episodes.at(-1);
const activeFeedback = activeEpisode ? state.feedback.filter((item) => item.episodeId === activeEpisode.id).at(-1) : undefined;
const activeCandidates = activeEpisode ? state.candidates.filter((item) => item.episodeId === activeEpisode.id) : [];
const visibleCandidates = (activeCandidates.length ? activeCandidates : state.candidates).slice(-3);
const providerCount = state.configSummary?.providers.length ?? 0;
const runtimeCount = state.configSummary?.runtimes.length ?? 0;
const runId = shortRunId(activeEpisode?.id ?? "demo-run");
const runtimeLabel = `${activeEpisode?.runtimeId ?? state.configSummary?.defaultRuntime ?? "native"} (${activeEpisode?.model ?? "llama3.1"})`;
const routeLabel = `${activeEpisode?.providerId ?? "local"}:${activeEpisode?.model ?? "llama3.1"} -> primary`;

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main class="cockpit" aria-label="Muster Terminal Cockpit">
    <header class="top-frame">
      <div class="brand-block">
        <div class="flame">HC</div>
        <div>
          <div class="brand-line">
            <strong>Muster</strong>
            <span>v0.1.0</span>
          </div>
        </div>
      </div>
      ${metricBlock("Run", runId, "RUNNING", "good")}
      ${metricBlock("Active Runtime", runtimeLabel, "agent", "info")}
      ${metricBlock("Route", routeLabel, "policy", "plain")}
      ${metricBlock("Environment", state.configured ? "Local" : "Demo", state.source === "exported" ? "synced" : "fallback", state.source === "exported" ? "good" : "warn")}
      ${metricBlock("Workspace", "Hybrow Labs", `${providerCount} provider / ${runtimeCount} runtime`, "plain")}
      <div class="avatar">HK</div>
    </header>

    <section class="body-grid">
      <aside class="rail">
        <button class="terminal-button">>_</button>
        <nav>
          ${railItem("Workspaces")}
          ${railItem("Runs", true, "12")}
          ${railItem("Flows")}
          ${railItem("Memory")}
          ${railItem("Tools")}
          ${railItem("Providers")}
          ${railItem("Migration")}
          ${railItem("Evals")}
          ${railItem("Channels")}
          ${railItem("OAuth & Pairing")}
          ${railItem("Settings")}
        </nav>
        <div class="system-card">
          <p><span class="dot good"></span>System</p>
          <strong>All systems operational.</strong>
          <hr />
          <p>Muster Engine</p>
          <strong>v0.1.0 - pi.dev - node</strong>
          <hr />
          <p><span class="dot good"></span>Connected</p>
          <strong>localhost:5188</strong>
        </div>
      </aside>

      <section class="run-panel">
        <div class="panel-title">
          <div><span class="dot good"></span>LIVE RUN</div>
          <div class="action-row">
            <button disabled>Stop</button>
            <button disabled>Steer</button>
            <button disabled>Modify</button>
            <button disabled>More</button>
          </div>
        </div>

        <article class="message user-message">
          <div class="message-meta"><strong>USER</strong><time>${clock(activeEpisode?.createdAt)}</time></div>
          <p>${escapeHtml(activeEpisode?.prompt ?? "Analyze the latest Redis security advisory and draft a mitigation plan for our production deployment.")}</p>
        </article>

        <article class="message assistant-message">
          <div class="message-meta"><strong>ASSISTANT</strong><time>${clock(state.generatedAt)}</time></div>
          <p>${escapeHtml(activeEpisode ? leadSentence(activeEpisode.responseText) : "I will fetch the latest advisory, review impact, and draft a mitigation plan tailored to your setup.")}<span class="cursor"></span></p>

          <section class="tool-ledger">
            <button class="ledger-head" disabled>Tool Calls (${toolRows(activeEpisode).length})</button>
            ${toolRows(activeEpisode).map(renderToolRow).join("")}
          </section>

          <section class="assistant-output">
            <h3>## Summary</h3>
            <p>${escapeHtml(activeEpisode?.responseText ?? "Muster should route the task through the trust kernel, inspect source evidence, then produce a scoped answer without promoting memory globally.")}</p>
            <h3>### Recommended Mitigations</h3>
            <ul>
              <li>Keep memory scoped to tenant, user, pairing, session, role, and persona.</li>
              <li>Promote learning only after feedback adjudication and eval coverage.</li>
              <li>Use capability manifests before activating tools or skills.</li>
            </ul>
          </section>
        </article>

        ${state.source === "fallback" ? warningCard("Demo fallback loaded", "Run pnpm hc state export to render current local episodes.") : ""}
        ${state.source === "invalid" ? warningCard("Invalid export ignored", state.error ?? "The exported state did not match the cockpit schema.") : ""}

        <form class="composer">
          <span>/</span>
          <input disabled value="Type a command or ask anything..." aria-label="Command input preview" />
          <button disabled>Send</button>
          <button disabled>v</button>
          <div class="examples">
            <small>Examples:</small>
            <code>/migrate openclaw --dry-run</code>
            <code>/provider local</code>
            <code>/eval run</code>
            <code>/memory search redis</code>
            <code>/flow new incident-response</code>
          </div>
        </form>
      </section>

      <aside class="inspector">
        <section class="context-card">
          <div class="section-heading">
            <strong>CONTEXT GRAPH</strong>
            <span>expand</span>
          </div>
          <div class="graph-canvas">
            ${graphNode("Workspace KB", "Memory", "left")}
            ${graphNode("Run " + runId, "Active", "center")}
            ${graphNode("Repo Context", "Code", "right")}
            ${graphNode("User Prompt", "Input", "bottom-left")}
            ${graphNode("Provider Route", "Tool", "bottom-right")}
          </div>
        </section>

        <section class="memory-card">
          <div class="section-heading">
            <strong>MEMORY WRITES</strong>
            <span>${visibleCandidates.length} pending</span>
          </div>
          ${visibleCandidates.length ? visibleCandidates.map(renderCandidate).join("") : renderCandidate({ kind: "eval", risk: "pending", summary: "No pending memory candidates yet." })}
        </section>

        <section class="feedback-card">
          <strong>FEEDBACK & ADJUDICATION</strong>
          <p>How was this response?</p>
          <div class="feedback-buttons">
            <button disabled>Useful</button>
            <button disabled>Not useful</button>
          </div>
          <label>Why (optional)</label>
          <textarea disabled placeholder="${escapeHtml(activeFeedback?.adjudication ?? "Add a note to improve future answers...")}"></textarea>
        </section>
      </aside>
    </section>

    <footer class="bottom-strip">
      <div>Logs</div>
      <div>Streaming</div>
      <div>Tokens <strong>12.4k</strong><span class="bar"><i></i></span></div>
      <div>Cost <strong>$0.0412</strong><span class="spark"></span></div>
      <div>Latency <strong>1.2s</strong><span class="spark"></span></div>
      <div>Inspector</div>
    </footer>
  </main>
`;

async function loadCockpitState(): Promise<CockpitState> {
  try {
    const response = await fetch("/muster-state.json", { cache: "no-store" });
    if (!response.ok) return demoState();
    return normalizeCockpitState(await response.json());
  } catch (error) {
    return demoState(error instanceof Error ? error.message : String(error));
  }
}

function demoState(error?: string): CockpitState {
  return {
    generatedAt: new Date().toISOString(),
    source: error ? "invalid" : "fallback",
    error,
    configured: false,
    episodes: [],
    feedback: [],
    candidates: []
  };
}

function normalizeCockpitState(value: unknown): CockpitState {
  if (!isRecord(value)) return demoState("State export was not a JSON object.");
  const episodes = Array.isArray(value.episodes) ? value.episodes.filter(isEpisode) : undefined;
  const feedback = Array.isArray(value.feedback) ? value.feedback.filter(isFeedback) : undefined;
  const candidates = Array.isArray(value.candidates) ? value.candidates.filter(isCandidate) : undefined;
  if (!episodes || !feedback || !candidates) {
    return demoState("State export is missing episodes, feedback, or candidates arrays.");
  }
  return {
    generatedAt: typeof value.generatedAt === "string" ? value.generatedAt : new Date().toISOString(),
    generatedFrom: typeof value.generatedFrom === "string" ? value.generatedFrom : undefined,
    source: value.source === "exported" ? "exported" : "invalid",
    configured: Boolean(value.configured),
    configSummary: normalizeConfigSummary(value.configSummary),
    episodes,
    feedback,
    candidates
  };
}

function metricBlock(label: string, value: string, note: string, tone: "good" | "warn" | "info" | "plain"): string {
  return `<div class="metric ${tone}"><small>${escapeHtml(label)}</small><strong>${escapeHtml(value)}</strong><span>${escapeHtml(note)}</span></div>`;
}

function railItem(label: string, active = false, badge?: string): string {
  return `<button class="rail-item ${active ? "active" : ""}"><span>${escapeHtml(label)}</span>${badge ? `<em>${escapeHtml(badge)}</em>` : ""}</button>`;
}

function toolRows(episode: Episode | undefined): Array<{ name: string; detail: string; duration: string; ok: boolean }> {
  const evidenceRows =
    episode?.evidence.map((item, index) => ({
      name: item.kind.replace("_", "."),
      detail: item.detail ?? item.label,
      duration: `${(index + 1) / 10}s`,
      ok: item.status !== "failed"
    })) ?? [];
  return [
    ...evidenceRows,
    { name: "context.graph", detail: "scope: tenant + user + session", duration: "0.4s", ok: true },
    { name: "memory.guard", detail: "promotion: eval-gated", duration: "0.2s", ok: true },
    { name: "plan.create", detail: "type: trust-kernel", duration: "0.3s", ok: true }
  ].slice(0, 5);
}

function renderToolRow(row: { name: string; detail: string; duration: string; ok: boolean }): string {
  return `<div class="tool-row"><strong>${escapeHtml(row.name)}</strong><span>${escapeHtml(row.detail)}</span><em>${row.ok ? "ok" : "fail"} ${escapeHtml(row.duration)}</em></div>`;
}

function renderCandidate(candidate: { kind: string; risk: string; summary: string }): string {
  return `<div class="memory-row"><strong>${escapeHtml(candidate.summary)}</strong><span>${escapeHtml(candidate.kind)} - ${escapeHtml(candidate.risk)} relevance</span><em>Pending</em></div>`;
}

function graphNode(title: string, subtitle: string, position: string): string {
  return `<div class="graph-node ${position}"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div>`;
}

function warningCard(title: string, body: string): string {
  return `<div class="warning-card"><strong>${escapeHtml(title)}</strong><span>${escapeHtml(body)}</span></div>`;
}

function leadSentence(value: string): string {
  return value.split(/\n|\.\s/)[0]?.trim() || value;
}

function shortRunId(id: string): string {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "demo";
}

function clock(value: string | undefined): string {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.valueOf())) return "00:00:00";
  return date.toLocaleTimeString("en-IN", { hour12: false });
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEpisode(value: unknown): value is Episode {
  return isRecord(value) && typeof value.id === "string" && typeof value.prompt === "string" && typeof value.responseText === "string" && Array.isArray(value.evidence);
}

function isFeedback(value: unknown): value is CockpitState["feedback"][number] {
  return isRecord(value) && typeof value.episodeId === "string" && typeof value.value === "string" && typeof value.adjudication === "string";
}

function isCandidate(value: unknown): value is CockpitState["candidates"][number] {
  return isRecord(value) && typeof value.episodeId === "string" && typeof value.kind === "string" && typeof value.risk === "string" && typeof value.summary === "string";
}

function normalizeConfigSummary(value: unknown): CockpitState["configSummary"] {
  if (!isRecord(value) || typeof value.defaultRuntime !== "string" || !Array.isArray(value.providers) || !Array.isArray(value.runtimes)) return undefined;
  return {
    defaultRuntime: value.defaultRuntime,
    oneRuntimePerRun: Boolean(value.oneRuntimePerRun),
    preferLocalForSensitive: Boolean(value.preferLocalForSensitive),
    providers: value.providers.filter(isProviderSummary),
    runtimes: value.runtimes.filter(isRuntimeSummary)
  };
}

function isProviderSummary(value: unknown): value is NonNullable<CockpitState["configSummary"]>["providers"][number] {
  return isRecord(value) && typeof value.id === "string" && typeof value.kind === "string" && typeof value.defaultModel === "string";
}

function isRuntimeSummary(value: unknown): value is NonNullable<CockpitState["configSummary"]>["runtimes"][number] {
  return isRecord(value) && typeof value.id === "string" && typeof value.provider === "string" && Array.isArray(value.taskRoutes);
}
