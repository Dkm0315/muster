# Frappe Surface Spec — what no other harness can build

The Frappe pack is not "a chatbot for ERPNext". It is an AI operating layer that
sees what the user sees, knows how the site was customized, and remembers each
employee separately — enforced by Muster's trust kernel, not by prompt hope.
Reference deployment: Oxygen HR (uat-erp.pwhr.in) — thousands of employees,
2,000+ custom fields, 926 property setters, custom workflows per module.

## 1. Screen Context Protocol (the "it picks up the current screen" layer)

A ~2KB embeddable snippet (`muster-frappe-surface.js`) for ANY Frappe UI —
Desk, Helpdesk, Gameplan, ChatNext, custom SPAs. It observes, never controls:

- Hooks `frappe.router` (Desk) / route change events (SPA) to capture:
  `{ route, doctype, docname, view (form/list/report/kanban), workspace }`
- On form views: visible fields, dirty fields, current values of non-sensitive
  fields (permlevel-0 only, redaction rules applied client-side), validation
  errors currently shown, workflow state + available actions.
- On list/report views: active filters, sort, visible columns, selected rows.
- User interactions stream (throttled): field focus, failed saves, repeated
  attempts — the "user is stuck" signal.

Payload posts to the harness as a `ContextObject`:
```json
{
  "kind": "frappe_screen_context",
  "summary": "Form: Leave Application HR-LAP-2026-00031, state=Open, dirty=[leave_type], validation_error='Leave Reason is required'",
  "scopes": [{"kind":"user","id":"pradip.irkar@pw.live"},{"kind":"session","id":"desk:tab:9f2"}],
  "redactionState": "redacted",
  "provenance": ["surface:desk", "site:uat-erp.pwhr.in"],
  "validTo": "<now + 10 minutes>"
}
```
Key properties: session-scoped + short TTL (screen context is perishable),
redacted client-side, and the agent receives it through normal recall — so
"why can't I save this?" is answered from the user's ACTUAL screen state.

## 2. Customization Core (proven in production, being ported)

The `frappe_customization_context` engine already running on Oxygen HR:
- Read-only, permission-scoped map of custom fields, property setters,
  workflows, server/client scripts, print formats, reports, DocPerms,
  assignment rules — by doctype, module, app, or free-text flow.
- Domain DocType priors validated against the live site index (payslip →
  Salary Slip only if that doctype exists on THIS site).
- Error-aware fetch diagnostics: the agent reports the exact blocker
  ("Expense Claim Type Cab/Taxi has no default account") — never "malformed data".

## 3. Per-employee memory lanes (thousands of users, zero leaks)

Direct mapping onto Muster scoped memory — already enforced and tested:
- `user:<frappe_user>` — personal facts, preferences, recurring requests
- `role:<frappe_role>` — what HR managers vs employees see
- `workspace:<module>` — module-level operational memory (HR, Payroll, Helpdesk)
- `tenant:<site>` — site-wide approved knowledge (promotion-gated)
- `session:<surface tab>` — screen context, expires
Promotion to tenant/global requires the eval gate. The harness self-check
(`memory_isolation`) makes cross-employee leakage a CI failure, not a hope.

## 4. Workflow Loop Studio (what others haven't thought of)

Not "AI writes a script": governed creation of living automation:
- `frappe_workflow_draft`: from natural language ("expense claims over 50k
  need L2 approval then CFO"), generate a real Frappe Workflow document draft
  + transition matrix, validated against live roles/states, behind approval.
- `frappe_loop_create`: recurring agent loops bound to doctype events or cron
  ("every Monday 9am: summarize unassigned HD Tickets per team and post to
  the team lead") — each loop is a Muster schedule + run with its own
  token budget, evidence trail, and kill switch. Loops are data: list, diff,
  pause, replay (`hc loop list/pause/replay`).
- `frappe_script_propose`: server/client script drafts with a dry-run diff of
  affected records — never applied without explicit approval.
- Every generated artifact carries provenance and an eval fixture, so a site
  upgrade that breaks a loop is caught by `hc evolve`, not by users.

## 5. Embeddable everywhere

One contract, three transports:
- `<script>` snippet for classic Desk
- npm package `@musterhq/frappe-surface` for Vue/React SPAs (Helpdesk,
  Gameplan, ChatNext, custom apps) — 0 deps, emits ContextObjects + renders
  an optional headless chat/drawer primitive (BYO styling)
- REST/WS bridge for server-side surfaces (Telegram/WhatsApp federation,
  already proven on the OpenClaw gateway)

## Build order (each a PR slice with tests)
1. `frappe-surface` types + ContextObject ingestion endpoint in core (screen
   context as perishable session memory) + simulator fixture for tests
2. Port customization-context + identity tools from frappe2-openclaw-gateway
   into the pack (loader: HC-012)
3. Desk snippet + SPA package (observe-only v1)
4. Workflow Loop Studio: loop_create on top of `hc schedule` + approval gates
5. OxygenHR pilot: Pradip's 158-case workbook as the pack's eval suite
