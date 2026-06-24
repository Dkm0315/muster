export interface WebSearchContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

export interface WebSearchError {
  readonly error: string;
}

interface SearchResult {
  readonly title: string;
  readonly url: string;
  readonly snippet: string;
}

const MAX_FETCH_CHARS = 12000;

function requireFetch(context: WebSearchContext): typeof globalThis.fetch | WebSearchError {
  return typeof context.fetch === "function"
    ? context.fetch
    : { error: "Web search pack has no network access: manifest must declare the network permission." };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function normalizeDuckDuckGoUrl(value: string): string {
  try {
    const decoded = decodeHtml(value);
    const url = new URL(decoded.startsWith("//") ? `https:${decoded}` : decoded);
    const uddg = url.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : url.toString();
  } catch {
    return decodeHtml(value);
  }
}

export async function duckduckgo_search(
  args: Record<string, unknown>,
  context: WebSearchContext,
): Promise<{ query: string; results: SearchResult[] } | WebSearchError> {
  const fetchImpl = requireFetch(context);
  if (typeof fetchImpl !== "function") return fetchImpl;
  const query = typeof args.query === "string" ? args.query.trim() : "";
  if (!query) return { error: "duckduckgo_search requires a non-empty query." };
  const count = Math.min(Math.max(typeof args.count === "number" ? Math.floor(args.count) : 5, 1), 10);
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/html",
      "User-Agent": "muster-web-search/0.1",
    },
  });
  if (!response.ok) return { error: `DuckDuckGo search failed with HTTP ${response.status}.` };
  const html = await response.text();
  const blocks = html.split(/<div class="result(?:__body)?">/).slice(1);
  const results: SearchResult[] = [];
  for (const block of blocks) {
    const link = block.match(/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!link) continue;
    const snippet = block.match(/<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/) ?? block.match(/<div[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    results.push({
      title: stripHtml(link[2]),
      url: normalizeDuckDuckGoUrl(link[1]),
      snippet: snippet ? stripHtml(snippet[1]) : "",
    });
    if (results.length >= count) break;
  }
  return { query, results };
}

export async function public_web_fetch(
  args: Record<string, unknown>,
  context: WebSearchContext,
): Promise<{ url: string; status: number; text: string; truncated: boolean } | WebSearchError> {
  const fetchImpl = requireFetch(context);
  if (typeof fetchImpl !== "function") return fetchImpl;
  const rawUrl = typeof args.url === "string" ? args.url.trim() : "";
  if (!rawUrl) return { error: "public_web_fetch requires a url." };
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { error: `Invalid URL: ${rawUrl}` };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { error: `Unsupported URL protocol: ${url.protocol}` };
  const response = await fetchImpl(url, {
    headers: {
      Accept: "text/html,text/plain,application/json",
      "User-Agent": "muster-web-search/0.1",
    },
  });
  const rawText = await response.text();
  const text = stripHtml(rawText).slice(0, MAX_FETCH_CHARS);
  return { url: url.toString(), status: response.status, text, truncated: rawText.length > MAX_FETCH_CHARS };
}

export const tools = {
  duckduckgo_search,
  public_web_fetch,
};
