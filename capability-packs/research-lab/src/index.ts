export interface ResearchContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

export interface ResearchError {
  readonly error: string;
}

interface ArxivPaper {
  readonly id: string;
  readonly title: string;
  readonly authors: string[];
  readonly published: string;
  readonly updated: string;
  readonly summary: string;
  readonly url: string;
}

function requireFetch(context: ResearchContext): typeof globalThis.fetch | ResearchError {
  return typeof context.fetch === "function"
    ? context.fetch
    : { error: "Research Lab pack has no network access: manifest must declare the network permission." };
}

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function firstTag(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`));
  return match ? decodeXml(match[1].replace(/\s+/g, " ").trim()) : "";
}

function allAuthors(block: string): string[] {
  return [...block.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>\s*<\/author>/g)].map((match) => decodeXml(match[1].replace(/\s+/g, " ").trim()));
}

export async function arxiv_search(
  args: Record<string, unknown>,
  context: ResearchContext,
): Promise<{ query: string; papers: ArxivPaper[] } | ResearchError> {
  const fetchImpl = requireFetch(context);
  if (typeof fetchImpl !== "function") return fetchImpl;
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { error: "arxiv_search requires a non-empty query." };
  const count = Math.min(Math.max(typeof args.count === "number" ? Math.floor(args.count) : 5, 1), 10);
  const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${count}&sortBy=submittedDate&sortOrder=descending`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/atom+xml",
      "User-Agent": "muster-research-lab/0.1",
    },
  });
  if (!response.ok) return { error: `arXiv search failed with HTTP ${response.status}.` };
  const xml = await response.text();
  const entries = xml.split("<entry>").slice(1).map((entry) => entry.split("</entry>")[0]);
  const papers = entries.map((entry) => {
    const id = firstTag(entry, "id");
    return {
      id,
      title: firstTag(entry, "title"),
      authors: allAuthors(entry),
      published: firstTag(entry, "published"),
      updated: firstTag(entry, "updated"),
      summary: firstTag(entry, "summary"),
      url: id,
    };
  });
  return { query, papers };
}

export const tools = {
  arxiv_search,
};
