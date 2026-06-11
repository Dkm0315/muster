/**
 * Fake-but-faithful terminal replay. Output strings mirror the REAL formats
 * produced by packages/cli (runCommand, renderTokenTable, renderIntegrityReport).
 */

interface Block {
  cmd: string;
  durationLabel: string;
  /** Output as HTML (pre-escaped, spans for highlight only). */
  out: string;
}

const BLOCKS: Block[] = [
  {
    cmd: 'muster run "Where do we deploy?" --runtime claude-code --model haiku',
    durationLabel: "3.1s",
    out: [
      '<span class="hl">recalled 1 scoped memories into context</span>',
      "run=run_8f3ka2c1 runtime=claude-code model=anthropic/claude-haiku task=qa status=completed",
      "tokens in=1842~ out=96~ cost=$0.0021",
      "",
      '<span class="resp">We deploy to uat-erp.example.com.</span>',
    ].join("\n"),
  },
  {
    cmd: "muster tokens",
    durationLabel: "0.2s",
    out: [
      '<span class="dim">run            model                        in       out      est  cost$    waste   session</span>',
      '<span class="dim">------------------------------------------------------------------------------------------------</span>',
      "run_2b9dd41e   anthropic/claude-haiku       1842     96       ~    0.0021   -       memory",
      "run_77c01a9f   anthropic/claude-sonnet      12.4K    1.2K          0.0612   -       continue",
      'run_d3e85k20   openai/gpt-5-mini            48.1K    410      ~    0.0301   <span class="hl">6.2x !</span>  continue',
      "run_8f3ka2c1   ollama/qwen3:14b             2.1K     880      ~    -        -       create",
      "",
      '<span class="dim">totals by model              runs   in         out        cost$      waste-runs</span>',
      '<span class="dim">--------------------------------------------------------------------------------</span>',
      "anthropic/claude-haiku       21     38.7K      2.0K       0.0441     0",
      "anthropic/claude-sonnet      9      112.0K     10.8K      0.5510     0",
      'openai/gpt-5-mini            4      96.2K      1.6K       0.0602     <span class="hl">1 !</span>',
      "ollama/qwen3:14b             12     25.3K      9.4K       -          0",
    ].join("\n"),
  },
  {
    cmd: "muster verify",
    durationLabel: "0.4s",
    out: [
      'integrity check at 2026-06-11T09:14:02Z: <span class="ok-text">OK</span>',
      "",
      '<span class="dim">store      lines    corrupt</span>',
      '<span class="dim">---------- -------- --------</span>',
      "episodes   146      0",
      "tokens     146      0",
      "memory     42       0",
      "feedback   7        0",
    ].join("\n"),
  },
];

function buildBlock(block: Block): {
  root: HTMLElement;
  cmdEl: HTMLElement;
  outEl: HTMLElement;
  chips: HTMLElement[];
} {
  const root = document.createElement("div");
  root.className = "tblock";
  const head = document.createElement("div");
  head.className = "tblock-head";
  const cmdEl = document.createElement("span");
  cmdEl.className = "tcmd";
  const chipOk = document.createElement("span");
  chipOk.className = "tchip ok";
  chipOk.textContent = "✓ completed";
  const chipDur = document.createElement("span");
  chipDur.className = "tchip dur";
  chipDur.textContent = block.durationLabel;
  head.append(cmdEl, chipOk, chipDur);
  const outEl = document.createElement("pre");
  outEl.className = "tout";
  root.append(head, outEl);
  return { root, cmdEl, outEl, chips: [chipOk, chipDur] };
}

function renderStatic(body: HTMLElement): void {
  for (const block of BLOCKS) {
    const { root, cmdEl, outEl, chips } = buildBlock(block);
    cmdEl.textContent = block.cmd;
    outEl.innerHTML = block.out;
    root.classList.add("done");
    for (const chip of chips) chip.classList.add("show");
    body.append(root);
  }
}

async function typeCommand(el: HTMLElement, cmd: string): Promise<void> {
  const caret = document.createElement("span");
  caret.className = "caret";
  caret.innerHTML = "&nbsp;";
  const text = document.createTextNode("");
  el.append(text, caret);
  for (const ch of cmd) {
    text.textContent += ch;
    await sleep(ch === " " ? 38 : 16 + Math.random() * 26);
  }
  await sleep(180);
  caret.remove();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function revealOutput(outEl: HTMLElement, html: string): Promise<void> {
  const lines = html.split("\n");
  for (const line of lines) {
    outEl.innerHTML += (outEl.innerHTML ? "\n" : "") + (line || " ");
    await sleep(46);
  }
}

async function play(body: HTMLElement): Promise<void> {
  for (const block of BLOCKS) {
    const { root, cmdEl, outEl, chips } = buildBlock(block);
    body.append(root);
    await typeCommand(cmdEl, block.cmd);
    await sleep(220);
    await revealOutput(outEl, block.out);
    root.classList.add("done");
    for (const chip of chips) chip.classList.add("show");
    await sleep(450);
  }
}

export function initTerminal(): void {
  const body = document.getElementById("terminal-body");
  if (!body) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) {
    renderStatic(body);
    return;
  }
  let started = false;
  const observer = new IntersectionObserver(
    (entries) => {
      if (started || !entries.some((entry) => entry.isIntersecting)) return;
      started = true;
      observer.disconnect();
      void play(body);
    },
    { threshold: 0.25 },
  );
  observer.observe(body);
}
