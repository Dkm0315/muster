#!/usr/bin/env node
/**
 * Generate website/src/portal-data.json from a REAL Muster workspace.
 *
 * What this does (no fakery):
 *   1. creates a temp workspace and a tiny stub OpenAI-compatible LLM server
 *      (node:http, deterministic canned answers — clearly labeled "stub" in
 *      every recorded model string),
 *   2. runs the actual muster CLI against it: init, provider add, runtime
 *      use-provider, memory add, three governed runs, a gated flow
 *      (save -> check -> run -> approve -> show), tokens, verify, status,
 *   3. captures the verbatim stdout of every command into portal-data.json.
 *
 * The portal page renders exclusively from that JSON, so every number on the
 * page came from these runs. Re-run any time: node scripts/generate-portal-data.mjs
 */
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = join(repoRoot, "packages", "cli", "src", "index.ts");
const tsxBin = join(repoRoot, "node_modules", ".bin", "tsx");
const outputPath = join(repoRoot, "website", "src", "portal-data.json");

// --- stub LLM: deterministic answers keyed on the prompt, honest about being a stub ---

const CANNED = [
  {
    match: /changed.*since friday|deploy/i,
    reply:
      "Since Friday, 23 changes landed on uat-erp. Two are release-blocking: the pending payroll patch (migration 0412_payroll not applied) and a failing permission test on Leave Application (perm_scope_user). Everything else is documentation and fixture updates.",
  },
  {
    match: /where do we deploy/i,
    reply: "We deploy to uat-erp.example.com (noted in your scoped memory).",
  },
  {
    match: /token spend|ledger/i,
    reply:
      "Across the recorded runs in this workspace the ledger shows estimated input/output tokens per run; no replay-waste flags so far. Run `muster tokens` for the per-run table.",
  },
];

function startStubLlm() {
  return new Promise((resolvePromise) => {
    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url?.endsWith("/models")) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ data: [{ id: "stub-model" }] }));
        return;
      }
      let body = "";
      request.on("data", (chunk) => (body += chunk));
      request.on("end", () => {
        let content = "This is a deterministic stub response.";
        try {
          const payload = JSON.parse(body);
          const userText = (payload.messages ?? [])
            .filter((message) => message.role === "user")
            .map((message) => message.content)
            .join("\n");
          content = CANNED.find((entry) => entry.match.test(userText))?.reply ?? content;
        } catch {
          /* keep default */
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ choices: [{ message: { content } }] }));
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      resolvePromise({ url: `http://127.0.0.1:${port}/v1`, close: () => server.close() });
    });
  });
}

// --- CLI capture ---

const captured = [];

async function muster(args, cwd, { record = true } = {}) {
  const { stdout } = await execFileAsync(tsxBin, [cliPath, ...args], {
    cwd,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  const entry = { cmd: `muster ${args.join(" ")}`, output: stdout.trimEnd() };
  if (record) captured.push(entry);
  console.log(`$ ${entry.cmd}`);
  return stdout;
}

async function main() {
  const workspace = await mkdtemp(join(tmpdir(), "muster-portal-"));
  const llm = await startStubLlm();
  console.log(`workspace=${workspace} stub-llm=${llm.url}`);
  try {
    // 1. workspace bootstrap
    await muster(["init"], workspace);
    await muster(["provider", "add-openai-compatible", "stub", llm.url, "stub-model"], workspace);
    await muster(["runtime", "use-provider", "native", "stub", "stub-model"], workspace);
    await muster(["doctor"], workspace);

    // 2. scoped memory so the runs demonstrate real recall
    await muster(
      ["memory", "add", "--summary", "We deploy to uat-erp.example.com.", "--scope", "user:dhairya", "--provenance", "manual"],
      workspace,
    );

    // 3. governed runs against the stub LLM
    const runOutputs = [];
    const runPrompts = [
      "Summarize what changed on uat-erp since Friday and flag anything blocking the release.",
      "Where do we deploy?",
      "What does our token spend look like so far?",
    ];
    for (const prompt of runPrompts) {
      const stdout = await muster(["run", prompt, "--scope", "user:dhairya"], workspace);
      runOutputs.push({ prompt, output: stdout.trimEnd() });
    }

    // 4. a flow with a human approval gate, end to end
    const flow = {
      id: "deploy-digest",
      description: "Summarize deploy changes, gate on human approval, then post.",
      steps: [
        { id: "fetch", kind: "tool", tool: "echo", args: { summary: "23 changes since Friday; 2 release blockers" } },
        { id: "approve", kind: "gate", show: "fetch.summary", expiresHours: 48 },
        { id: "post", kind: "tool", tool: "echo", args: { body: "{{fetch.summary}}" }, when: "approve.granted" },
      ],
    };
    await writeFile(join(workspace, "deploy-digest.json"), JSON.stringify(flow, null, 2), "utf8");
    await muster(["flow", "save", "deploy-digest.json"], workspace);
    await muster(["flow", "check", "deploy-digest"], workspace);
    const flowRunOut = await muster(["flow", "run", "deploy-digest"], workspace);
    const flowRunId = flowRunOut.match(/flow_run=(flowrun_[a-f0-9]+)/)?.[1];
    if (!flowRunId) throw new Error("flow run id not found in output");
    await muster(["flow", "approve", flowRunId], workspace);
    const flowShow = await muster(["flow", "show", flowRunId], workspace);

    // 5. ledger / integrity / mission control
    const tokensOut = await muster(["tokens"], workspace);
    const verifyOut = await muster(["verify"], workspace);
    const statusOut = await muster(["status"], workspace);
    const episodesOut = await muster(["episodes"], workspace);

    // --- derive the small set of parsed fields the portal renders ---
    const runs = runOutputs.map(({ prompt, output }) => {
      const head = output.match(/run=(\S+) runtime=(\S+) model=(\S+) task=(\S+) status=(\S+)/);
      const tokens = output.match(/tokens (in=\S+ out=\S+(?: cost=\$\S+)?)/);
      const recalled = output.match(/recalled (\d+) scoped memories/);
      const response = output.split("\n").slice(output.split("\n").findIndex((line) => line.startsWith("tokens ")) + 1).join("\n").trim();
      return {
        prompt,
        runId: head?.[1] ?? "",
        runtime: head?.[2] ?? "",
        model: head?.[3] ?? "",
        taskKind: head?.[4] ?? "",
        status: head?.[5] ?? "",
        tokensLine: tokens?.[1] ?? "",
        recalledMemories: recalled ? Number(recalled[1]) : 0,
        response,
        rawOutput: output,
      };
    });

    const data = {
      meta: {
        generatedAt: new Date().toISOString(),
        generator: "scripts/generate-portal-data.mjs",
        note:
          "Captured from a real Muster workspace: actual CLI runs against a deterministic stub LLM (provider id 'stub'). Every value below is verbatim command output.",
        stubLlm: true,
      },
      runs,
      flow: {
        definition: flow,
        runId: flowRunId,
        saveOutput: captured.find((entry) => entry.cmd.startsWith("muster flow save"))?.output ?? "",
        checkOutput: captured.find((entry) => entry.cmd.startsWith("muster flow check"))?.output ?? "",
        runOutput: flowRunOut.trimEnd(),
        approveOutput: captured.find((entry) => entry.cmd.startsWith("muster flow approve"))?.output ?? "",
        showOutput: flowShow.trimEnd(),
      },
      tokens: tokensOut.trimEnd(),
      verify: verifyOut.trimEnd(),
      status: statusOut.trimEnd(),
      episodes: episodesOut.trimEnd(),
      counts: {
        sessions: episodesOut.trim().split("\n").filter(Boolean).length,
        flows: 1,
        // The six webhook adapters that exist in packages/gateway/src/adapters + the web client in packages/surface.
        surfaces: ["telegram", "slack", "discord", "whatsapp", "gchat", "teams", "web"],
      },
      commands: captured,
    };

    await writeFile(outputPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    console.log(`\nwrote ${outputPath}`);
  } finally {
    llm.close();
    await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
