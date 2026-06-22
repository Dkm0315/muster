// The big MUSTER banner shown when the CLI opens (like OPENCLAW / opencode).
// Teal-on-near-black brand identity. Respects NO_COLOR and non-TTY output.

const TEAL = [20, 184, 166] as const;       // #14b8a6 brand teal
const CYAN = [103, 232, 249] as const;      // lighter top
const DEEP = [15, 118, 110] as const;       // deeper bottom

const LETTERS = [
  "███╗   ███╗██╗   ██╗███████╗████████╗███████╗██████╗ ",
  "████╗ ████║██║   ██║██╔════╝╚══██╔══╝██╔════╝██╔══██╗",
  "██╔████╔██║██║   ██║███████╗   ██║   █████╗  ██████╔╝",
  "██║╚██╔╝██║██║   ██║╚════██║   ██║   ██╔══╝  ██╔══██╗",
  "██║ ╚═╝ ██║╚██████╔╝███████║   ██║   ███████╗██║  ██║",
  "╚═╝     ╚═╝ ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝",
];

function lerp(a: readonly number[], b: readonly number[], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

function color(text: string, rgb: readonly number[]): string {
  return `\x1b[38;2;${rgb[0]};${rgb[1]};${rgb[2]}m${text}\x1b[0m`;
}

function colorEnabled(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.MUSTER_NO_BANNER) return false;
  return Boolean(process.stdout.isTTY);
}

/** Returns the banner string (colored if the terminal supports it, plain otherwise). */
export function renderBanner(): string {
  const enabled = colorEnabled();
  const lines = LETTERS.map((line, index) => {
    if (!enabled) return line;
    // vertical gradient: cyan at the crown, teal through the body, deep teal at the base
    const t = index / (LETTERS.length - 1);
    const top = lerp(CYAN, TEAL, Math.min(1, t * 2));
    const rgb = t <= 0.5 ? top : lerp(TEAL, DEEP, (t - 0.5) * 2);
    return color(line, rgb);
  });
  const tag = "  the agent harness you can audit";
  const tagline = enabled ? color(tag, TEAL) : tag;
  return `\n${lines.join("\n")}\n${tagline}\n`;
}

export function printBanner(): void {
  process.stdout.write(renderBanner());
}
