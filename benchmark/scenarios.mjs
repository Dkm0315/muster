// Token Waste Index scenarios. Each is a realistic multi-turn, multi-tool task
// whose transcript accumulates context the way real agent sessions do.
// Pure data — no LLM calls; the benchmark is deterministic token accounting.

function toolResult(name, size) {
  return { role: "tool", toolName: name, content: `[${name}] ` + "result line ".repeat(size) };
}

function task({ id, description, turns, toolSize }) {
  const transcript = [
    { role: "system", content: "You are an autonomous coding/ops agent. Use tools, then report." },
    { role: "user", content: `Task: ${description}` },
  ];
  for (let i = 0; i < turns; i += 1) {
    transcript.push({ role: "assistant", content: `Step ${i + 1}: I'll inspect the next artifact and proceed.` });
    transcript.push(toolResult(`read_file_${i}`, toolSize));
    transcript.push({ role: "user", content: `Looks right, continue with step ${i + 2}.` });
  }
  transcript.push({ role: "assistant", content: "Done. Summary of all steps follows." });
  return { id, description, transcript };
}

export const SCENARIOS = [
  task({ id: "codebase-refactor-20", description: "Refactor a module across 20 files", turns: 20, toolSize: 120 }),
  task({ id: "incident-triage-30", description: "Triage an incident across 30 log/metric pulls", turns: 30, toolSize: 90 }),
  task({ id: "erp-data-audit-40", description: "Audit ERP records across 40 queries", turns: 40, toolSize: 70 }),
  task({ id: "research-synthesis-25", description: "Synthesize findings from 25 fetched sources", turns: 25, toolSize: 150 }),
  task({ id: "long-support-thread-50", description: "Resolve a 50-message support thread with tool lookups", turns: 50, toolSize: 60 }),
];
