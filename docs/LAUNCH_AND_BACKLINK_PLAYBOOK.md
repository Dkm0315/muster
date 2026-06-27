# Muster Launch and Backlink Playbook

This playbook is for improving discovery without black-hat SEO. The goal is to
make Google and developers understand the exact brand/category match:

**Muster = governed agent harness for production AI agents.**

## Search Console Checks

Use Google Search Console for `themuster.dev`.

Inspect these URLs:

- `https://themuster.dev/`
- `https://themuster.dev/docs.html`
- `https://themuster.dev/guides.html`
- `https://themuster.dev/guide-agent-harness.html`
- `https://themuster.dev/guide-mcp-agent-harness.html`
- `https://themuster.dev/guide-frappe-ai.html`
- `https://themuster.dev/guide-governed-memory.html`
- `https://themuster.dev/frappe-ai.html`
- `https://themuster.dev/agent-harness.html`
- `https://themuster.dev/mcp-agent-harness.html`
- `https://themuster.dev/browser-automation-agent.html`

Submit or refresh:

- `https://themuster.dev/sitemap.xml`

Track exact-query goals:

- `themuster.dev` should rank first.
- `Muster agent harness` should rank first or near top.
- `governed agent harness` should gradually improve.
- Broad query `muster` is not the immediate target because it is ambiguous.

## GitHub Sidebar Checklist

Update the repository About sidebar manually:

- Description: `Muster — governed agent harness for production AI agents`
- Website: `https://themuster.dev`
- Topics:
  - `ai-agent`
  - `agent-harness`
  - `mcp`
  - `frappe`
  - `erpnext`
  - `token-ledger`
  - `scoped-memory`
  - `evals`
  - `browser-automation`
  - `typescript`

## npm Checklist

Verify the published packages show:

- homepage: `https://themuster.dev`
- repository: `https://github.com/Dkm0315/muster`
- bugs: `https://github.com/Dkm0315/muster/issues`
- keywords:
  - `agent-harness`
  - `ai-agent`
  - `ai-agents`
  - `governed-agents`
  - `production-ai`
  - `mcp`
  - `scoped-memory`
  - `token-ledger`
  - `eval-gated-learning`
  - `browser-automation`
  - `frappe`
  - `erpnext`

## Backlink Targets

Do not spam. Each post should be useful on its own and point to the website and
GitHub only when relevant.

- GitHub README
- GitHub repo About sidebar
- npm package page
- GitHub releases
- LinkedIn launch post
- X launch thread
- Frappe forum
- Hacker News Show HN
- Product Hunt
- Reddit `r/opensource`, `r/LocalLLaMA`, `r/Frappe`, `r/selfhosted` if appropriate
- DEV.to / Hashnode technical post

## LinkedIn Draft

I have been building Muster, an early open-source governed agent harness for
production AI agents.

The wedge is simple: agents that run longer than a demo should not leak memory,
waste tokens, or learn new behavior without tests.

Muster puts the control layer outside the model provider:

- scoped memory across tenant/workspace/user/session boundaries
- a token ledger for run cost and replay waste
- eval-gated learning before behavior becomes durable
- MCP/plugin controls for tools and auth
- browser automation and channel adapters
- Frappe / ERPNext context packs for ERP workflows

It is pre-1.0 and still early. The most useful feedback right now is from
engineers building long-running assistants, MCP-heavy systems, Frappe/ERPNext
automation, or agent infrastructure that has to be auditable.

Website: https://themuster.dev
GitHub: https://github.com/Dkm0315/muster

## X Thread Draft

1. I am building Muster: an early open-source governed agent harness for
production AI agents.

2. The problem: most agents work in a demo, then fall apart when memory grows,
tools multiply, token spend disappears, and "learning" happens without tests.

3. Muster's wedge: agents should not leak memory, waste tokens, or learn new
behavior without eval gates.

4. The harness owns the boring-but-critical layer: scoped memory, token ledger,
tool policy, MCP setup, channel boundaries, browser actions, and run evidence.

5. It is provider-flexible. The governance layer should not depend on one model
family or one runtime.

6. Frappe / ERPNext is one of the first domain focuses because ERP agents need
DocType, field, workflow, role, and permission context.

7. It is pre-1.0 and open source. Looking for feedback from people building
real agent systems, MCP tools, browser automation, and ERP workflows.

8. Website: https://themuster.dev
GitHub: https://github.com/Dkm0315/muster

## Hacker News Show HN Draft

Title:

Show HN: Muster - an open-source governed agent harness

Post:

I am building Muster, an early open-source TypeScript harness for long-running
AI agents.

The goal is not to be another chatbot wrapper. Muster is focused on the control
layer around agent runs: scoped memory, a token ledger, MCP/tool policy,
capability packs, channel adapters, browser automation, and eval-gated learning.

The reason is that production-ish agents fail differently from demos. They
accumulate hidden context, replay too much history, call tools without clear
boundaries, and sometimes "learn" from feedback without a test fixture.

There is also a deterministic Token Waste Index benchmark in the repo. It
compares Muster against naive replay-everything context rendering and makes no
model calls.

It is pre-1.0, rough in places, and I am looking for technical feedback,
especially from people building MCP-heavy systems, browser operators, or
Frappe/ERPNext automation.

Website: https://themuster.dev
GitHub: https://github.com/Dkm0315/muster

## Frappe Forum Draft

Title:

Muster: early open-source harness for Frappe / ERPNext AI agents

Post:

I am building Muster, an early open-source governed agent harness for production
AI agents, and one of the first domain packs is focused on Frappe / ERPNext.

The Frappe angle is specific: useful ERP agents need more than generic ERPNext
docs. They need site-aware context around DocTypes, fields, custom fields,
workflows, roles, reports, scripts, installed apps, and permissions.

Muster's approach is to keep the core harness light and put Frappe intelligence
in a capability pack. The harness provides scoped memory, token visibility,
tool policy, MCP/plugin setup, and eval-gated learning. Frappe remains the
authorization authority for reads/writes.

It is pre-1.0. I am looking for feedback from Frappe/ERPNext builders on what a
safe and useful Frappe AI operator should inspect first: DocTypes, Custom Fields,
Workflows, Reports, Server Scripts, fixtures, permissions, or bench/app state.

Website: https://themuster.dev
GitHub: https://github.com/Dkm0315/muster

## Reddit Draft

Title:

I am building an open-source governed agent harness for long-running AI agents

Post:

I am building Muster, an early open-source TypeScript project for people working
on long-running AI agents.

The core idea is that agent infrastructure needs a harness around the model:
scoped memory, token accounting, tool policy, MCP setup, channel boundaries,
browser automation evidence, and eval-gated learning.

The project is pre-1.0. It is not a claim that everything is production-ready.
The point is to make the control layer explicit instead of hiding it in prompts
or provider logs.

I would especially like feedback from people using MCP servers, browser
automation, self-hosted models, Frappe/ERPNext, or long-running personal/team
assistants.

Website: https://themuster.dev
GitHub: https://github.com/Dkm0315/muster

What would you expect from an agent harness before trusting it with real tools?

## Release Note Draft

Title:

Muster discovery and SEO positioning update

Body:

This update improves the public discovery surface for Muster as a governed
agent harness for production AI agents.

Highlights:

- clearer website metadata for "Muster agent harness" and governed AI agents
- package metadata aligned with `https://themuster.dev`
- new guides for agent harnesses, MCP token visibility, Frappe AI, and governed
  memory
- sitemap and `llms.txt` updated with guide and integration landing pages
- launch/backlink playbook added for Search Console, GitHub, npm, LinkedIn, X,
  Hacker News, Frappe Forum, and Reddit

No ranking claims are made here. The goal is to make the site easier for Google,
developers, and contributors to understand and cite.
