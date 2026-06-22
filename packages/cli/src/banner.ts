// The big MUSTER banner shown when the CLI opens.
// Uses the same dark-console accent palette as the Muster UI.

const CYAN = [41, 211, 255] as const;       // #29d3ff
const GREEN = [104, 245, 168] as const;     // #68f5a8
const AMBER = [247, 198, 106] as const;     // #f7c66a
const MUTED = [142, 161, 181] as const;     // #8ea1b5

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
    // vertical gradient: website cyan crown, green body, warm amber foot.
    const t = index / (LETTERS.length - 1);
    const top = lerp(CYAN, GREEN, Math.min(1, t * 2));
    const rgb = t <= 0.5 ? top : lerp(GREEN, AMBER, (t - 0.5) * 2);
    return color(line, rgb);
  });
  const tag = "  the agent harness you can audit";
  const tagline = enabled ? color(tag, MUTED) : tag;
  return `\n${lines.join("\n")}\n${tagline}\n`;
}

export function printBanner(): void {
  process.stdout.write(renderBanner());
}
