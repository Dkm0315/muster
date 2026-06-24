export interface GithubToolContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

export interface GithubError {
  readonly error: string;
  readonly status?: number;
}

interface GithubCallOk {
  readonly ok: true;
  readonly data: unknown;
}

type GithubCallResult = GithubCallOk | (GithubError & { readonly ok?: undefined });

function token(context: GithubToolContext): string | undefined {
  return context.config.GITHUB_PERSONAL_ACCESS_TOKEN || context.config.GITHUB_TOKEN;
}

function stringArg(args: Record<string, unknown>, name: string): string {
  return typeof args[name] === "string" ? String(args[name]).trim() : "";
}

function positiveLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function headers(context: GithubToolContext): Record<string, string> {
  const auth = token(context);
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(auth ? { Authorization: `Bearer ${auth}` } : {}),
  };
}

async function githubRequest(context: GithubToolContext, path: string, query?: URLSearchParams): Promise<GithubCallResult> {
  if (typeof context.fetch !== "function") {
    return { error: "GitHub pack has no network access: the loader did not grant fetch." };
  }
  const url = new URL(`https://api.github.com${path}`);
  if (query) {
    for (const [key, value] of query) url.searchParams.set(key, value);
  }
  let response: Response;
  try {
    response = await context.fetch(url, { headers: headers(context) });
  } catch (error) {
    return { error: `GitHub request failed before a response: ${error instanceof Error ? error.message : String(error)}` };
  }
  const text = await response.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const message = typeof data === "object" && data !== null && typeof (data as Record<string, unknown>).message === "string"
      ? (data as Record<string, unknown>).message as string
      : text || `HTTP ${response.status}`;
    return { error: message, status: response.status };
  }
  return { ok: true, data };
}

function repoPath(owner: string, repo: string): string {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  return typeof record[name] === "string" ? record[name] as string : undefined;
}

function numberField(record: Record<string, unknown>, name: string): number | undefined {
  return typeof record[name] === "number" && Number.isFinite(record[name]) ? record[name] as number : undefined;
}

export async function github_repo_summary(
  args: Record<string, unknown>,
  context: GithubToolContext,
): Promise<Record<string, unknown> | GithubError> {
  const owner = stringArg(args, "owner");
  const repo = stringArg(args, "repo");
  if (!owner || !repo) return { error: 'github_repo_summary requires "owner" and "repo".' };

  const repoResult = await githubRequest(context, repoPath(owner, repo));
  if (!repoResult.ok) return repoResult;
  const repoData = asRecord(repoResult.data);
  const langResult = await githubRequest(context, `${repoPath(owner, repo)}/languages`);
  const languages = langResult.ok && typeof langResult.data === "object" && langResult.data !== null ? langResult.data : {};

  return {
    fullName: stringField(repoData, "full_name"),
    description: stringField(repoData, "description") ?? "",
    private: Boolean(repoData.private),
    defaultBranch: stringField(repoData, "default_branch"),
    stars: numberField(repoData, "stargazers_count") ?? 0,
    forks: numberField(repoData, "forks_count") ?? 0,
    openIssues: numberField(repoData, "open_issues_count") ?? 0,
    language: stringField(repoData, "language"),
    languages,
    htmlUrl: stringField(repoData, "html_url"),
    authenticated: Boolean(token(context)),
  };
}

export async function github_issue_search(
  args: Record<string, unknown>,
  context: GithubToolContext,
): Promise<{ query: string; total: number; items: Array<Record<string, unknown>> } | GithubError> {
  const query = stringArg(args, "query");
  if (!query) return { error: 'github_issue_search requires "query".' };
  const owner = stringArg(args, "owner");
  const repo = stringArg(args, "repo");
  const limit = positiveLimit(args.limit, 10, 50);
  const q = [query, owner && repo ? `repo:${owner}/${repo}` : "", "is:issue"].filter(Boolean).join(" ");
  const params = new URLSearchParams({ q, per_page: String(limit) });
  const result = await githubRequest(context, "/search/issues", params);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  const items = Array.isArray(data.items) ? data.items.map((item) => {
    const record = asRecord(item);
    return {
      number: numberField(record, "number"),
      title: stringField(record, "title"),
      state: stringField(record, "state"),
      htmlUrl: stringField(record, "html_url"),
      updatedAt: stringField(record, "updated_at"),
    };
  }) : [];
  return { query: q, total: numberField(data, "total_count") ?? items.length, items };
}

export async function github_pull_request_list(
  args: Record<string, unknown>,
  context: GithubToolContext,
): Promise<{ owner: string; repo: string; pulls: Array<Record<string, unknown>> } | GithubError> {
  const owner = stringArg(args, "owner");
  const repo = stringArg(args, "repo");
  if (!owner || !repo) return { error: 'github_pull_request_list requires "owner" and "repo".' };
  const state = stringArg(args, "state") || "open";
  const limit = positiveLimit(args.limit, 10, 50);
  const params = new URLSearchParams({ state, per_page: String(limit) });
  const result = await githubRequest(context, `${repoPath(owner, repo)}/pulls`, params);
  if (!result.ok) return result;
  const pulls = Array.isArray(result.data) ? result.data.map((item) => {
    const record = asRecord(item);
    const user = asRecord(record.user);
    return {
      number: numberField(record, "number"),
      title: stringField(record, "title"),
      state: stringField(record, "state"),
      htmlUrl: stringField(record, "html_url"),
      updatedAt: stringField(record, "updated_at"),
      author: stringField(user, "login"),
    };
  }) : [];
  return { owner, repo, pulls };
}

export const tools = {
  github_repo_summary,
  github_issue_search,
  github_pull_request_list,
};
