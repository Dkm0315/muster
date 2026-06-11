# Competitive comparison (engineering notes)

Moved here from the marketing site: the website now carries the three-pillar
"Why teams choose Muster" story; the evidence-grade table with competitor issue
links lives in docs only.

Honest framing: the competitors have breadth and ecosystems we don't (yet). We
have the governance core they demonstrably lack — each ✕ links to their own
issue tracker where applicable.

| Capability | Muster | OpenClaw | Hermes | crewAI |
| --- | --- | --- | --- | --- |
| Token ledger + waste detection | ✓ | ✕ | ✕ | ✕ |
| Scoped memory (leak = failing check in CI) | ✓ | partial | ✕ (single MEMORY.md) | ✕ |
| Eval-gated learning | ✓ | ✕ | ✕ (promotes on use) | ✕ |
| Governed fallback (evidence, never silent) | ✓ | ✕ ([openclaw#65646](https://github.com/openclaw/openclaw/issues/65646)) | ✕ | ✕ |
| Session integrity verification | ✓ | ✕ ([openclaw#75235](https://github.com/openclaw/openclaw/issues/75235)) | ✕ ([hermes-agent#5563](https://github.com/NousResearch/hermes-agent/issues/5563)) | ✕ |
| Channels (Slack/Discord/Telegram/WhatsApp/GChat/Teams) | ✓ 6 | ✓ 20+ | ✓ | ✕ |
| Maturity / ecosystem | v0 | huge | large | large |
