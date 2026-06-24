# Muster Retrieval And Goal-Loop Design

Status: active design and audit log for the governed retrieval workstream.

## Product Position

Muster should not compete by copying Hermes session search or OpenClaw hybrid memory. The product wedge is governed retrieval:

- every recalled memory has scope proof
- every injected memory has a receipt
- ranking changes are eval-gated
- hybrid/vector retrieval is optional and must beat lexical retrieval before promotion
- long-running goals use working memory first, durable memory only after evidence

The end-user promise is simple: Muster should remember quickly, explain what it remembered, and prove why that memory was eligible.

## Current Evidence Snapshot

This section is deliberately concrete so the retrieval workstream does not drift into hand-wavy "memory is faster" claims.

Implemented and locally/Frappe-2 verified:

- SQLite FTS is the interactive search path for memory recall. `searchMemory`, `searchMemoryWithReceipts`, and `addMemory` open the index with an `if-missing` rebuild policy so stale/corrupt JSONL is not rescanned on the warm hot path.
- Query recall does not pad query results with unrelated recent memories. Recent fallback is only for empty-query browsing.
- Receipts are available from `searchMemoryWithReceipts`, run recall, CLI memory search, chat output, TUI transcript pinning, and goal-loop records.
- Retrieval evals include recall@5, MRR@5, leakage rate, unexpected-hit rate for no-hit fixtures, stale-hit rate, and p95 latency.
- Empty retrieval eval suites fail through the `non_empty_suite` check. A green retrieval gate now requires at least one fixture.
- Retrieval eval runs can persist artifact bundles via `--artifact-dir`, including `manifest.json`, `suite.json`, `cases.jsonl`, and `memory-status.json`.
- `muster eval retrieval seed-pack` creates a representative lexical gate pack with exact-hit, no-hit, stale, forbidden-scope, and distractor latency fixtures.
- `muster eval retrieval seed-frappe-pack` creates a generic Frappe/ERPNext graph pack for app/module/DocType/child-DocType metadata. OxygenHR is only one possible seeded use case, not a hardcoded product assumption.
- Optional linked-memory graph expansion is available behind fixture/command opt-in. It starts from lexical seed hits, pulls only visible linked memories, records linked candidate counts, and remains off for normal recall until evals justify it.
- Hybrid retrieval remains blocked unless lexical retrieval fails recall/MRR while safety gates still pass.
- Goal-loop records track retrieved evidence, remembered memory, promoted memory, rejected memory on failed runs, and follow-up retrieval need.
- `muster memory status` and `muster memory doctor` expose JSONL validity, SQLite readability/freshness, backend, object counts, scope counts, safe repair guidance, and optional p50/p95 retrieval probes.
- `muster memory doctor --fix` safely rebuilds the derived SQLite index from valid JSONL after DB corruption or staleness.
- Frappe-2 live timings showed recall in the single-digit to low-double-digit millisecond range while provider time dominated end-to-end latency.

Representative Frappe-2 evidence:

```text
timings total=16360ms provider=16277ms recall=6ms prompt=4ms persist=70ms planning=2ms
memory backend=sqlite-fts5 recalled=0 candidates=0 scopes=tenant:f2,user:goblin
```

```text
retrieval_suite status=failed cases=1 recall@5=0.000 mrr@5=0.000 leakage_rate=0.000 unexpected_hit_rate=1.000 stale_hit_rate=0.000 p95_ms=6.188
hybrid_gate allowed=false reason=fix unexpected, scoped leakage, or stale-hit safety before adding hybrid retrieval
check=unexpected_hit_rate_ceiling status=failed detail=actual=1.000 max=0
```

Latest Frappe-2 representative artifact gate:

```text
artifact=/home/goblin/muster-artifacts/retrieval-20260624T061316Z
retrieval_suite status=passed cases=5 recall@5=1.000 mrr@5=1.000 leakage_rate=0.000 unexpected_hit_rate=0.000 stale_hit_rate=0.000 p95_ms=12.704
probe_latency p50_ms=3.876 p95_ms=9.961 min_ms=3.518 max_ms=9.961
backend=sqlite-fts5 objects=254 scope_rows=508
fixtures=f2-live-exact-hit,f2-live-forbidden-scope,f2-live-latency-distractors,f2-live-no-hit,f2-live-stale-hit
```

This artifact directory contains `manifest.json`, `suite.json`, `cases.jsonl`, `memory-status.json`, `memory-status-probe.txt`, `retrieval-run.txt`, `seed-pack.txt`, and `paths.txt`.

Current completion state: not complete. The core retrieval lane is much closer to the desired shape, but larger-scale latency artifacts, richer receipt UX, and a full Frappe-2 break-test artifact pack are still required before this workstream can be called finished.

## Subagent Review Convergence

Six read-only reviewers examined the retrieval direction from architecture, product, performance, and break-test angles. Their strongest shared conclusions:

- Keep SQLite/FTS lexical retrieval as the default. Do not make vectors or hybrid retrieval the primary contract.
- Make receipt visibility a product feature, not only an internal structure. Users need to see id, scope, provenance, confidence, matched terms, backend, and latency.
- Treat eval coverage itself as a gate. Empty eval packs, cherry-picked fixtures, and aggregate-only output are dangerous because they create false confidence.
- Add memory status and doctor commands before adding more retrieval backends.
- Frappe-2 testing needs durable artifacts: seeded dataset manifest, query/result snapshots, latency histogram, PTY transcript, provider stub logs, MCP failure logs, and `.muster/data` snapshots around corruption tests.
- The biggest product wedge remains governed retrieval: "Muster can prove why this memory was eligible and why it was injected."

## Architecture

### 1. Fast Lexical Retrieval First

The durable source of truth is `.muster/data/memory.jsonl`. SQLite is a disposable accelerator.

Default retrieval stays local and deterministic:

1. normalize query and scopes
2. enforce scope visibility in SQL
3. generate bounded FTS/LIKE candidates
4. score candidates with deterministic lexical, confidence, and freshness signals
5. for empty-query browsing only, return recent visible memories
6. return structured receipts, not just memory objects

Do not make vector search the default. Do not let SQLite become the only copy of memory.

Hot-path invariant:

- normal query recall must not scan `memory.jsonl`
- writes update SQLite directly after appending the source JSONL record
- stale/corrupt source logs must not poison already-initialized warm search
- corrupt or unavailable SQLite must be surfaced as a repairable memory-index problem, not silently hidden as "no memory"

### 2. Explainable Memory Receipts

A memory receipt records:

- memory id
- score
- matched terms
- reason
- scopes
- confidence
- provenance
- backend
- candidate count
- fallback state

Receipts must be available to:

- `muster run`
- `muster memory search --explain`
- TUI `/memory` and future `/receipt`
- episode evidence
- retrieval evals

### 2.5. Frappe/ERPNext Hybrid Graph Retrieval

Frappe and ERPNext are not just free-text projects. The useful context lives in a relational domain graph:

- apps, modules, and installed custom apps
- DocTypes and MariaDB tables such as `tabEmployee`
- DocFields and Custom Fields with fieldtype, options, fetches, dependencies, and permissions
- Link, Dynamic Link, and Table fields that create graph edges
- child DocTypes and parent table fields
- workflows, states, transitions, roles, and permission rules
- server scripts, hooks, reports, print formats, workspace pages, and fixtures

The retrieval model for this domain should be hybrid, but not vector-first. The default lane remains scoped SQLite FTS. The Frappe graph lane is:

1. Use scoped FTS to find a seed node, for example a DocType, Custom Field, Workflow, or Module memory.
2. Expand to linked visible memories such as child tables, linked DocFields, permission rules, workflows, and app metadata.
3. Keep scope filtering on every neighbor so one site/user cannot leak into another.
4. Return graph-neighbor receipts with a reason like `linked from mem_...`.
5. Promote this lane only when Frappe graph fixtures beat lexical-only retrieval without leakage, stale-hit, or no-hit regressions.

The generic fixture command is:

```text
muster eval retrieval seed-frappe-pack frappe-hr --tenant f2 --user goblin --app erpnext --module HR --doctype Employee --child-doctype "Employee Detail" --distractors 250
```

An OxygenHR pack is just a parameterized case:

```text
muster eval retrieval seed-frappe-pack oxygenhr --tenant f2 --user goblin --app oxygenhr --module OxygenHR --doctype "Oxygen Employee" --child-doctype "Oxygen Payroll Component" --distractors 250
```

This is deliberately a graph-over-memory implementation first, not a separate graph database. It lets Muster validate the product behavior before adding heavier MariaDB metadata crawlers or vector/rerank stages.

### 3. Eval-Gated Retrieval

Retrieval evals are separate from answer evals.

Each case is:

```json
{
  "kind": "retrieval",
  "query": "frappe payroll finance bench",
  "scopes": ["tenant:hybrow", "user:dhairya"],
  "expectedIds": ["mem_expected"],
  "forbiddenIds": ["mem_other_user"],
  "topK": 5
}
```

Metrics:

- recall@K
- MRR
- leakage rate
- unexpected-hit rate for no-hit fixtures
- stale-hit rate
- p95 latency
- backend
- returned ids

Hard gates:

- non-empty fixture suite
- zero cross-scope leaks
- zero unexpected hits for expected-none cases
- zero stale hits unless explicitly tolerated by the fixture
- zero blocked/redacted memory injection
- no silent retriever degradation
- p95 latency budget per scale tier

### 4. Optional Hybrid Retrieval

Hybrid retrieval is a later stage. It is only enabled after the lexical eval suite proves a real gap.

Candidate future pipeline:

```text
query
 -> scope resolver
 -> BM25 lexical candidates
 -> optional vector candidates
 -> optional session candidates
 -> optional graph-neighbor candidates
 -> RRF fusion
 -> policy, freshness, contradiction filters
 -> optional reranker on top N
 -> final top memories
```

Promotion gate:

- hybrid improves semantic/paraphrase nDCG@10 materially
- exact-query MRR does not regress
- latency remains inside budget
- fallback/degraded mode is recorded as evidence
- no safety gates fail before the hybrid experiment starts

### 5. Goal-Loop Memory

Goal loops need two memory lanes:

- working memory: active goal, blockers, decisions, assumptions, last retrieval set
- durable memory: promoted facts with evidence and scope

The write path should produce candidates first. Durable memory promotion requires evidence, eval success, or explicit user approval depending on target scope.

Do not auto-promote failed or partial goal turns into broad memory.

## Implementation Slices

### Slice A: Lexical Receipts And Eval Base

Implemented:

- `searchMemoryWithReceipts`
- `recallMemoryWithReceipt`
- run evidence for memory recall
- `memory search --explain`
- retrieval eval primitive with recall@K, MRR, leakage, latency
- no-hit fixtures with `expectedNone`
- stale-hit checks
- empty-suite failure
- hybrid-gate decision output

### Slice B: User Trust Surface

Partially implemented:

- chat output can show timing and memory receipt lines
- TUI transcript keeps receipt/timing lines visible in cramped views
- goal-loop status includes matched terms and provenance

Next:

- `muster run --receipt`
- `muster explain <run>`
- TUI memory health in status line
- `/receipt`, `/memory <query>`, `/goal status`
- staged progress: recall, route, connect, stream, ledger
- zero-recall explanation: no memory exists vs scope excluded vs score below threshold

### Slice C: Memory Doctor And Status

Implemented:

- `muster memory status`
- `muster memory doctor`
- `muster memory doctor --fix`
- JSONL line diagnostics
- index freshness/readability diagnostics
- backend, object, and scope counts
- safe repair guidance for source-first failure handling
- corrupt DB rebuild from JSONL
- scoped p50/p95 probe via `--probe --scope ...`

Next:

- FTS unavailable diagnostics
- index freshness and last rebuild time
- probe artifact export for release gates

### Slice D: Goal-Loop Store

Implemented:

- goal state ledger
- retrieval set attached to goal turn
- remembered/promoted/rejected candidate states
- no broad promotion without evidence
- follow-up retrieval need

Next:

- separate working-memory lane from durable memory UI
- promotion review flow for higher scopes
- goal-loop benchmark across long-running tasks

### Slice E: Hybrid Candidate Provider

Later:

- vector candidate provider behind feature flag
- RRF fusion
- rerank cache
- graph-neighbor expansion

## Frappe-2 Break-Test Gate

A release candidate is not ready until Frappe-2 produces artifacts for:

- seeded dataset manifest
- query/result snapshots
- latency histogram
- PTY transcript
- provider stub logs
- MCP failure logs
- Frappe auth/stale-schema logs
- `.muster/data` snapshots before and after corruption tests

Minimum command families:

```bash
muster eval retrieval <pack> --min-recall 1 --min-mrr 1 --max-leakage-rate 0 --max-stale-hit-rate 0 --max-p95-ms <budget> --artifact-dir <artifact-dir>
muster eval retrieval seed-pack f2-live --tenant f2 --user goblin --other-user alice --distractors 250
MUSTER_TIMINGS=1 muster chat --name f2-latency
muster memory search --explain --query "<needle>" --scope tenant:f2 --scope user:goblin
muster goal status --limit 20
```

The retrieval artifact directory must contain:

- `manifest.json`: target, thresholds, metrics, fixture coverage, and hybrid-gate decision
- `suite.json`: raw suite result and hybrid gate
- `cases.jsonl`: one line per fixture with fixture path, fixture body, returned ids, checks, backend, and latency
- `memory-status.json`: JSONL/index health captured at gate time

The representative seed pack is not a substitute for domain-specific Frappe fixtures, but it prevents the most dangerous false positives before those fixtures exist:

- exact scoped recall
- no-hit canary
- stale fact canary
- forbidden other-user scope canary
- latency with distractors

Fail the gate on:

- cross-scope memory leak
- silent fallback
- stale/corrupt index data loss
- unbounded provider hang
- plugin/MCP crash propagation
- mismatch between CLI output, episode evidence, token ledger, traces, and context graph

## Open Gaps Before Completion

The goal is not done until these are proven in the current tree and on Frappe-2:

- A representative retrieval eval pack exists and is checked into or generated by the harness. It must include exact hits, no-hit canaries, stale facts, forbidden cross-scope facts, and paraphrase misses.
- A large-scale local dataset test records warm p95 recall latency at realistic memory counts.
- `muster memory status` and `muster memory doctor` expose backend, freshness, counts, JSONL diagnostics, corrupt DB rebuild, and p50/p95 probes; next Frappe-2 needs checked-in or archived artifact output from those commands plus PTY transcripts.
- Run/chat receipts expose enough information for a lay user to understand why a memory was used or why none was used.
- Provider latency and Muster overhead are separated in normal diagnostics, not only under `MUSTER_TIMINGS=1`.
- TUI receipt visibility is covered by PTY-level tests, not only pure render tests.
- Frappe-2 artifact pack proves no cross-scope leakage, no silent fallback, no data loss after index corruption, and no unbounded provider hang.
- Hybrid/vector retrieval remains disabled until the lexical eval suite proves a gap and safety gates pass.
