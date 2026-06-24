interface Finding {
  readonly rule: string;
  readonly severity: "low" | "medium" | "high";
  readonly line: number;
  readonly evidence: string;
  readonly recommendation: string;
}

const RULES: readonly {
  readonly id: string;
  readonly severity: Finding["severity"];
  readonly pattern: RegExp;
  readonly recommendation: string;
}[] = [
  { id: "possible-api-key", severity: "high", pattern: /(api[_-]?key|secret|token|password)\s*[:=]\s*['"]?[A-Za-z0-9_\-]{16,}/i, recommendation: "Move secrets to an environment variable or secret store and rotate if this value was committed." },
  { id: "private-key", severity: "high", pattern: /-----BEGIN (?:RSA |EC |OPENSSH |)PRIVATE KEY-----/, recommendation: "Remove private keys from source and load them through a secret manager." },
  { id: "shell-injection", severity: "high", pattern: /\b(exec|spawn|execFile|system|popen)\s*\([^)]*(user|input|query|body|params)/i, recommendation: "Avoid shell interpolation; pass argv arrays and validate untrusted input." },
  { id: "unsafe-eval", severity: "high", pattern: /\b(eval|Function)\s*\(/, recommendation: "Replace dynamic code evaluation with a parser, dispatch table, or sandboxed evaluator." },
  { id: "insecure-tls", severity: "medium", pattern: /(rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*0)/, recommendation: "Keep TLS verification enabled outside a tightly-scoped local test." },
  { id: "sql-concat", severity: "medium", pattern: /(SELECT|UPDATE|DELETE|INSERT)[\s\S]{0,80}(\+|\$\{|format\()/i, recommendation: "Use parameterized queries or a query builder for untrusted values." },
  { id: "xss-html", severity: "medium", pattern: /(dangerouslySetInnerHTML|innerHTML\s*=)/, recommendation: "Sanitize HTML and prefer safe text rendering." },
];

function textArg(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  return typeof value === "string" ? value : "";
}

export async function scan_text_for_risks(args: Record<string, unknown>): Promise<{ findings: Finding[]; count: number }> {
  const text = textArg(args, "text");
  const findings: Finding[] = [];
  const lines = text.split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      findings.push({
        rule: rule.id,
        severity: rule.severity,
        line: index + 1,
        evidence: line.trim().slice(0, 240),
        recommendation: rule.recommendation,
      });
    }
  }
  return { findings, count: findings.length };
}

export async function summarize_risk_findings(args: Record<string, unknown>): Promise<{ summary: string; high: number; medium: number; low: number }> {
  const scan = await scan_text_for_risks(args);
  const high = scan.findings.filter((finding) => finding.severity === "high").length;
  const medium = scan.findings.filter((finding) => finding.severity === "medium").length;
  const low = scan.findings.filter((finding) => finding.severity === "low").length;
  const summary = scan.count
    ? `${scan.count} finding(s): ${high} high, ${medium} medium, ${low} low. First: ${scan.findings[0].rule} on line ${scan.findings[0].line}.`
    : "No rule-based risks found in the provided text.";
  return { summary, high, medium, low };
}

export const tools = {
  scan_text_for_risks,
  summarize_risk_findings,
};
