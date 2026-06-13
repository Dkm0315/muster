# Muster ecosystem — feel large, stay clean

OpenClaw's org page (ClawSweeper, Crabfleet, mcporter, Peekaboo, the crawlers, Lobster…)
makes the product feel enormous: dozens of small, sharply-branded, single-purpose tools,
each its own repo + site + one-line value prop. That perceived surface area pulls users.

## The reconciliation (vs our "one monorepo" rule)
We are NOT externalizing the *core* into many fragile packages — OpenClaw's own
"rough week" post-mortem proves that path causes version-skew and plugin-repair hell.

Instead:
- **Core stays one monorepo, one version** (@musterhq/core/cli/gateway/surface). Engineering win.
- **Marketing surface = present those packages AS products** + add a *small* number of
  genuinely-separate satellite tools (only where separation is justified) + the
  capability-pack ecosystem. An **Ecosystem page** on the site ties them together,
  OpenClaw-org-style. This buys the "large" feeling honestly.

## Naming theme: military assembly / formation
Muster = to assemble troops. Distinctive vein nobody in AI tooling uses (vs crustacean/greek-god).
Candidate names: Muster · Roster · Garrison · Picket · Dispatch · Recon · Tally · Defector · Cadre · Rally · Beacon · Sortie.

## Ecosystem map (HONEST: real today vs planned)

### Real today — already shippable as "products" on the ecosystem page
| Name | What | Status |
|---|---|---|
| **Muster** (core/cli) | the governed agent harness | shipped |
| **Garrison** (gateway) | one governed envelope for 7 chat surfaces | shipped (@musterhq/gateway) |
| **Dispatch** (surface) | zero-dep web client for any frontend | shipped (@musterhq/surface) |
| **Tally** (benchmark) | the Token Waste Index — prove the savings | shipped (`muster benchmark`) |
| **Frappe pack** | ERPNext/Frappe capability pack | v0 shipped |

### Planned satellites — genuinely useful, buildable, themed (NOT vapor — build a few in the loop)
| Name | What | Build cost |
|---|---|---|
| **Roster** | capability-pack registry + `roster install <pack>` (our honest ClawHub) | medium |
| **Defector** | migrate from OpenClaw / Hermes into Muster, with verification | medium (we have migration scanners) |
| **Recon** | standalone eval-suite runner / agent benchmark (harness+config+model, not just LLM) | small (wraps `muster evolve`) |
| **Picket** | local monitor/TUI over the gateway RPC — watch runs, ledger.tick live | medium (RPC exists) |
| **Beacon** | one-file status badge / shields endpoint for a Muster fleet | small |

## Site implications (folds into SITE_PLAN.md)
- Add an **Ecosystem** page: grid of the products above (real ones first, "planned" labeled).
- "Build with us — everything is open source. Ship a capability pack to Roster."
- This is the breadth surface that makes Muster read as a platform, not a CLI.

## Honesty rules
- Real, working tools listed as shipped; everything else clearly "planned."
- No fake tool entries. The page grows as we build the satellites — and we WILL build
  a few (Recon and Defector are cheap because the core already has the pieces).
