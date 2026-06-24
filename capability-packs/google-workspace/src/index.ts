export interface GoogleWorkspaceToolContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

export interface GoogleWorkspaceError {
  readonly error: string;
  readonly status?: number;
  readonly hint?: string;
}

interface GoogleCallOk {
  readonly ok: true;
  readonly data: unknown;
}

type GoogleCallResult = GoogleCallOk | (GoogleWorkspaceError & { readonly ok?: undefined });

function token(context: GoogleWorkspaceToolContext): string | undefined {
  return context.config.GOOGLE_WORKSPACE_ACCESS_TOKEN || context.config.GOOGLE_ACCESS_TOKEN;
}

function stringArg(args: Record<string, unknown>, name: string, fallback = ""): string {
  return typeof args[name] === "string" ? String(args[name]).trim() : fallback;
}

function positiveLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  return typeof record[name] === "string" ? record[name] as string : undefined;
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function authHeaders(context: GoogleWorkspaceToolContext): Record<string, string> | GoogleWorkspaceError {
  const accessToken = token(context);
  if (!accessToken) {
    return {
      error: "Google Workspace access token is not configured.",
      hint: "Set GOOGLE_WORKSPACE_ACCESS_TOKEN or GOOGLE_ACCESS_TOKEN, or complete the Google Workspace OAuth setup before enabling this pack.",
    };
  }
  return { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
}

async function googleRequest(context: GoogleWorkspaceToolContext, url: URL): Promise<GoogleCallResult> {
  if (typeof context.fetch !== "function") {
    return { error: "Google Workspace pack has no network access: the loader did not grant fetch." };
  }
  const headers = authHeaders(context);
  if ("error" in headers) return headers;
  let response: Response;
  try {
    response = await context.fetch(url, { headers });
  } catch (error) {
    return { error: `Google request failed before a response: ${error instanceof Error ? error.message : String(error)}` };
  }
  const text = await response.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    data = undefined;
  }
  if (!response.ok) {
    const record = asRecord(data);
    const nested = asRecord(record.error);
    const message = stringField(nested, "message") ?? stringField(record, "error_description") ?? (text || `HTTP ${response.status}`);
    return { error: message, status: response.status, hint: response.status === 401 || response.status === 403 ? "Check OAuth scopes and reconnect Google Workspace." : undefined };
  }
  return { ok: true, data };
}

function addParam(url: URL, key: string, value: string | undefined): void {
  if (value) url.searchParams.set(key, value);
}

function userId(args: Record<string, unknown>): string {
  return encodeURIComponent(stringArg(args, "userId", "me") || "me");
}

function headerValue(headers: unknown, name: string): string | undefined {
  const match = arrayField(headers)
    .map(asRecord)
    .find((header) => stringField(header, "name")?.toLowerCase() === name.toLowerCase());
  return match ? stringField(match, "value") : undefined;
}

function messageSummary(message: unknown): Record<string, unknown> {
  const record = asRecord(message);
  const payload = asRecord(record.payload);
  return {
    id: stringField(record, "id"),
    threadId: stringField(record, "threadId"),
    snippet: stringField(record, "snippet") ?? "",
    from: headerValue(payload.headers, "From"),
    to: headerValue(payload.headers, "To"),
    subject: headerValue(payload.headers, "Subject"),
    date: headerValue(payload.headers, "Date"),
  };
}

export async function google_workspace_profile(
  _args: Record<string, unknown>,
  context: GoogleWorkspaceToolContext,
): Promise<Record<string, unknown> | GoogleWorkspaceError> {
  const url = new URL("https://www.googleapis.com/oauth2/v2/userinfo");
  const result = await googleRequest(context, url);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    id: stringField(data, "id"),
    email: stringField(data, "email"),
    name: stringField(data, "name"),
    verifiedEmail: Boolean(data.verified_email),
  };
}

export async function gmail_search(
  args: Record<string, unknown>,
  context: GoogleWorkspaceToolContext,
): Promise<Record<string, unknown> | GoogleWorkspaceError> {
  const query = stringArg(args, "query");
  if (!query) return { error: 'gmail_search requires "query".' };
  const limit = positiveLimit(args.limit, 10, 50);
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${userId(args)}/messages`);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", String(limit));
  addParam(url, "pageToken", stringArg(args, "pageToken"));
  const result = await googleRequest(context, url);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    query,
    messages: arrayField(data.messages).map((item) => {
      const record = asRecord(item);
      return { id: stringField(record, "id"), threadId: stringField(record, "threadId") };
    }),
    resultSizeEstimate: typeof data.resultSizeEstimate === "number" ? data.resultSizeEstimate : undefined,
    nextPageToken: stringField(data, "nextPageToken"),
  };
}

export async function gmail_message_get(
  args: Record<string, unknown>,
  context: GoogleWorkspaceToolContext,
): Promise<Record<string, unknown> | GoogleWorkspaceError> {
  const messageId = stringArg(args, "messageId");
  if (!messageId) return { error: 'gmail_message_get requires "messageId".' };
  const format = stringArg(args, "format", "metadata") || "metadata";
  const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/${userId(args)}/messages/${encodeURIComponent(messageId)}`);
  url.searchParams.set("format", format);
  const result = await googleRequest(context, url);
  if (!result.ok) return result;
  return messageSummary(result.data);
}

function eventSummary(event: unknown): Record<string, unknown> {
  const record = asRecord(event);
  const start = asRecord(record.start);
  const end = asRecord(record.end);
  return {
    id: stringField(record, "id"),
    summary: stringField(record, "summary") ?? "",
    status: stringField(record, "status"),
    htmlLink: stringField(record, "htmlLink"),
    start: stringField(start, "dateTime") ?? stringField(start, "date"),
    end: stringField(end, "dateTime") ?? stringField(end, "date"),
    location: stringField(record, "location"),
  };
}

export async function calendar_events_list(
  args: Record<string, unknown>,
  context: GoogleWorkspaceToolContext,
): Promise<Record<string, unknown> | GoogleWorkspaceError> {
  const calendarId = encodeURIComponent(stringArg(args, "calendarId", "primary") || "primary");
  const limit = positiveLimit(args.limit, 10, 50);
  const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events`);
  url.searchParams.set("maxResults", String(limit));
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  addParam(url, "timeMin", stringArg(args, "timeMin"));
  addParam(url, "timeMax", stringArg(args, "timeMax"));
  addParam(url, "q", stringArg(args, "query"));
  const result = await googleRequest(context, url);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    calendarId: decodeURIComponent(calendarId),
    events: arrayField(data.items).map(eventSummary),
    nextPageToken: stringField(data, "nextPageToken"),
  };
}

function driveFileSummary(file: unknown): Record<string, unknown> {
  const record = asRecord(file);
  return {
    id: stringField(record, "id"),
    name: stringField(record, "name"),
    mimeType: stringField(record, "mimeType"),
    webViewLink: stringField(record, "webViewLink"),
    modifiedTime: stringField(record, "modifiedTime"),
  };
}

export async function drive_search(
  args: Record<string, unknown>,
  context: GoogleWorkspaceToolContext,
): Promise<Record<string, unknown> | GoogleWorkspaceError> {
  const query = stringArg(args, "query");
  if (!query) return { error: 'drive_search requires "query".' };
  const limit = positiveLimit(args.limit, 10, 50);
  const rawQuery = Boolean(args.rawQuery);
  const q = rawQuery ? query : `name contains '${query.replace(/'/g, "\\'")}' and trashed = false`;
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", q);
  url.searchParams.set("pageSize", String(limit));
  url.searchParams.set("fields", "nextPageToken,files(id,name,mimeType,webViewLink,modifiedTime)");
  addParam(url, "pageToken", stringArg(args, "pageToken"));
  const result = await googleRequest(context, url);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    query: q,
    files: arrayField(data.files).map(driveFileSummary),
    nextPageToken: stringField(data, "nextPageToken"),
  };
}

export async function sheets_values_get(
  args: Record<string, unknown>,
  context: GoogleWorkspaceToolContext,
): Promise<Record<string, unknown> | GoogleWorkspaceError> {
  const spreadsheetId = stringArg(args, "spreadsheetId");
  const range = stringArg(args, "range");
  if (!spreadsheetId || !range) return { error: 'sheets_values_get requires "spreadsheetId" and "range".' };
  const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}`);
  const result = await googleRequest(context, url);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    spreadsheetId: stringField(data, "spreadsheetId") ?? spreadsheetId,
    range: stringField(data, "range") ?? range,
    majorDimension: stringField(data, "majorDimension"),
    values: arrayField(data.values),
  };
}

export const tools = {
  google_workspace_profile,
  gmail_search,
  gmail_message_get,
  calendar_events_list,
  drive_search,
  sheets_values_get,
};
