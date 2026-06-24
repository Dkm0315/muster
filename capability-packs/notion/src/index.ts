export interface NotionToolContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

export interface NotionError {
  readonly error: string;
  readonly status?: number;
  readonly hint?: string;
}

interface NotionCallOk {
  readonly ok: true;
  readonly data: unknown;
}

type NotionCallResult = NotionCallOk | (NotionError & { readonly ok?: undefined });

const DEFAULT_NOTION_VERSION = "2026-03-11";

function token(context: NotionToolContext): string | undefined {
  return context.config.NOTION_API_KEY || context.config.NOTION_API_TOKEN;
}

function notionVersion(context: NotionToolContext): string {
  return context.config.NOTION_API_VERSION || DEFAULT_NOTION_VERSION;
}

function stringArg(args: Record<string, unknown>, name: string): string {
  return typeof args[name] === "string" ? String(args[name]).trim() : "";
}

function positiveLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return optionalRecord(value) ?? {};
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  return typeof record[name] === "string" ? record[name] as string : undefined;
}

function arrayField(record: Record<string, unknown>, name: string): unknown[] {
  return Array.isArray(record[name]) ? record[name] as unknown[] : [];
}

function titleText(value: unknown): string {
  const title = arrayField(asRecord(value), "title");
  return title
    .map((item) => stringField(asRecord(item), "plain_text") ?? stringField(asRecord(asRecord(item).text), "content") ?? "")
    .join("")
    .trim();
}

function pageTitle(record: Record<string, unknown>): string {
  const properties = asRecord(record.properties);
  for (const value of Object.values(properties)) {
    const property = asRecord(value);
    if (property.type === "title") return titleText(property);
  }
  return titleText(record);
}

function headers(context: NotionToolContext): Record<string, string> | NotionError {
  const auth = token(context);
  if (!auth) {
    return {
      error: "Notion token is not configured.",
      hint: "Set NOTION_API_KEY or NOTION_API_TOKEN, then share target pages/data sources with the integration in Notion.",
    };
  }
  return {
    Authorization: `Bearer ${auth}`,
    "Notion-Version": notionVersion(context),
    "Content-Type": "application/json",
  };
}

async function notionRequest(
  context: NotionToolContext,
  method: "GET" | "POST" | "PATCH",
  path: string,
  body?: Record<string, unknown>,
): Promise<NotionCallResult> {
  if (typeof context.fetch !== "function") {
    return { error: "Notion pack has no network access: the loader did not grant fetch." };
  }
  const requestHeaders = headers(context);
  if ("error" in requestHeaders) return requestHeaders;
  let response: Response;
  try {
    response = await context.fetch(`https://api.notion.com/v1${path}`, {
      method,
      headers: requestHeaders,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    return { error: `Notion request failed before a response: ${error instanceof Error ? error.message : String(error)}` };
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
    return {
      error: message,
      status: response.status,
      hint: response.status === 404 ? "Share this page, database, or data source with the Notion integration, then retry." : undefined,
    };
  }
  return { ok: true, data };
}

function summarizeSearchItem(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  return {
    id: stringField(record, "id"),
    object: stringField(record, "object"),
    title: pageTitle(record),
    url: stringField(record, "url"),
    createdTime: stringField(record, "created_time"),
    lastEditedTime: stringField(record, "last_edited_time"),
  };
}

function summarizeBlock(value: unknown): Record<string, unknown> {
  const record = asRecord(value);
  const type = stringField(record, "type");
  const typed = asRecord(type ? record[type] : undefined);
  const text = arrayField(typed, "rich_text")
    .map((item) => stringField(asRecord(item), "plain_text") ?? "")
    .join("")
    .trim();
  return {
    id: stringField(record, "id"),
    type,
    hasChildren: Boolean(record.has_children),
    text,
  };
}

export async function notion_search(
  args: Record<string, unknown>,
  context: NotionToolContext,
): Promise<Record<string, unknown> | NotionError> {
  const query = stringArg(args, "query");
  const limit = positiveLimit(args.limit, 10, 50);
  const object = stringArg(args, "object");
  const body: Record<string, unknown> = { page_size: limit };
  if (query) body.query = query;
  if (object) body.filter = { property: "object", value: object };
  const result = await notionRequest(context, "POST", "/search", body);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  const results = arrayField(data, "results").map(summarizeSearchItem);
  return { query, object: object || "all", results, hasMore: Boolean(data.has_more), nextCursor: stringField(data, "next_cursor") };
}

export async function notion_page_get(
  args: Record<string, unknown>,
  context: NotionToolContext,
): Promise<Record<string, unknown> | NotionError> {
  const pageId = stringArg(args, "pageId") || stringArg(args, "id");
  if (!pageId) return { error: 'notion_page_get requires "pageId".' };
  const result = await notionRequest(context, "GET", `/pages/${encodeURIComponent(pageId)}`);
  if (!result.ok) return result;
  const page = asRecord(result.data);
  return {
    id: stringField(page, "id"),
    object: stringField(page, "object"),
    title: pageTitle(page),
    url: stringField(page, "url"),
    createdTime: stringField(page, "created_time"),
    lastEditedTime: stringField(page, "last_edited_time"),
    archived: Boolean(page.archived),
    inTrash: Boolean(page.in_trash),
    properties: page.properties ?? {},
  };
}

export async function notion_block_children(
  args: Record<string, unknown>,
  context: NotionToolContext,
): Promise<Record<string, unknown> | NotionError> {
  const blockId = stringArg(args, "blockId") || stringArg(args, "pageId") || stringArg(args, "id");
  if (!blockId) return { error: 'notion_block_children requires "blockId" or "pageId".' };
  const limit = positiveLimit(args.limit, 25, 100);
  const result = await notionRequest(context, "GET", `/blocks/${encodeURIComponent(blockId)}/children?page_size=${limit}`);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    blockId,
    blocks: arrayField(data, "results").map(summarizeBlock),
    hasMore: Boolean(data.has_more),
    nextCursor: stringField(data, "next_cursor"),
  };
}

export async function notion_data_source_query(
  args: Record<string, unknown>,
  context: NotionToolContext,
): Promise<Record<string, unknown> | NotionError> {
  const dataSourceId = stringArg(args, "dataSourceId") || stringArg(args, "databaseId") || stringArg(args, "id");
  if (!dataSourceId) return { error: 'notion_data_source_query requires "dataSourceId".' };
  const limit = positiveLimit(args.limit, 25, 100);
  const body: Record<string, unknown> = { page_size: limit };
  const filter = optionalRecord(args.filter);
  const sorts = Array.isArray(args.sorts) ? args.sorts : undefined;
  if (filter) body.filter = filter;
  if (sorts) body.sorts = sorts;
  const result = await notionRequest(context, "POST", `/data_sources/${encodeURIComponent(dataSourceId)}/query`, body);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    dataSourceId,
    results: arrayField(data, "results").map(summarizeSearchItem),
    hasMore: Boolean(data.has_more),
    nextCursor: stringField(data, "next_cursor"),
  };
}

export async function notion_create_markdown_page(
  args: Record<string, unknown>,
  context: NotionToolContext,
): Promise<Record<string, unknown> | NotionError> {
  const parentPageId = stringArg(args, "parentPageId");
  const parentDatabaseId = stringArg(args, "parentDatabaseId") || stringArg(args, "parentDataSourceId");
  const title = stringArg(args, "title");
  const markdown = stringArg(args, "markdown");
  if (!parentPageId && !parentDatabaseId) return { error: 'notion_create_markdown_page requires "parentPageId" or "parentDatabaseId".' };
  if (!title) return { error: 'notion_create_markdown_page requires "title".' };
  const parent = parentPageId ? { page_id: parentPageId } : { database_id: parentDatabaseId };
  const result = await notionRequest(context, "POST", "/pages", {
    parent,
    properties: {
      title: [{ text: { content: title } }],
    },
    ...(markdown ? { markdown } : {}),
  });
  if (!result.ok) return result;
  const page = asRecord(result.data);
  return {
    id: stringField(page, "id"),
    title: pageTitle(page) || title,
    url: stringField(page, "url"),
    createdTime: stringField(page, "created_time"),
  };
}

export const tools = {
  notion_search,
  notion_page_get,
  notion_block_children,
  notion_data_source_query,
  notion_create_markdown_page,
};
