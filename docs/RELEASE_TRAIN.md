# Muster Release Train

This release train keeps the live product honest: every promised surface must
ship behind a concrete test, artifact, or live Frappe-2 regression before it is
called ready.

## Stack

1. `muster/qa-release-gates`
   - Adds artifact-backed QA, live Frappe-2 regression, gateway auth hardening,
     config permission hardening, and timing evidence.
   - PR: https://github.com/Dkm0315/muster/pull/59
2. `muster/release-train-gates`
   - Defines the linked PR stack and release acceptance gates.
3. `muster/provider-latency-workflows`
   - Provider/model/speed workflows become transactional and measurable.
   - Must prove warm-session latency and provider split on local and Frappe-2.
4. `muster/integration-packs`
   - MCP, plugin, channel, and skill setup become guided workflows with clear
     setup, auth, test, enable, disable, and recovery states.
5. `muster/frappe-graph-retrieval`
   - Frappe/ERPNext support gets a lightweight plugin with docs/app/site context,
     MariaDB schema awareness, module boundaries, and hybrid graph retrieval.
6. `muster/release-readiness`
   - README, changelog, website claims, package metadata, and release notes are
     reconciled with the verified feature set.

## Acceptance Gates

Each PR must include the smallest useful implementation plus evidence:

- Unit or integration tests for the changed behavior.
- `muster qa scorecard` impact when relevant.
- Frappe-2 live evidence for terminal, provider, retrieval, or integration work.
- No passed QA suite without `manifest.json` and passing `cases.jsonl`.
- No provider or integration feature marked ready without setup and failure UX.
- No token, OAuth, webhook, or gateway credential printed by default.
- No release note claim that is not backed by a test or live artifact.

## Product Promises To Protect

- Fast, provider-agnostic local harness behavior.
- Memory retrieval that stays scoped, accurate, and cheap as it grows.
- Friendly terminal onboarding and picker workflows for non-experts.
- Strong default integrations for MCPs, plugins, skills, chat channels, and web
  frameworks.
- Frappe/ERPNext usefulness beyond generic code search.
- Auditable release confidence rather than screenshot-only proof.

## Current Known Gaps

- Live Frappe-2 prompt latency is still around 10-12 seconds for a trivial
  response. The next implementation PR must isolate provider transport,
  app-server warm reuse, and first-token latency.
- Provider/model/speed pickers are visible and tested, but the full workflow
  still needs transactional setup, preflight, rollback, and model inventory.
- Integration packs exist, but several setup paths are still guidance-heavy
  rather than guided, testable workflows.
- Frappe/ERPNext graph retrieval exists as an eval direction, not as a complete
  user-facing plugin.
