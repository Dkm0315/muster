export interface AirtableToolContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

export interface AirtableError {
  readonly error: string;
  readonly status?: number;
  readonly code?: string;
  readonly hint?: string;
}

interface AirtableCallOk {
  readonly ok: true;
  readonly data: unknown;
}

type AirtableCallResult = AirtableCallOk | (AirtableError & { readonly ok?: undefined });

function token(context: AirtableToolContext): string | undefined {
  return context.config.AIRTABLE_API_KEY || context.config.AIRTABLE_PAT;
}

function stringArg(args: Record<string, unknown>, name: string, fallback = ""): string {
  return typeof args[name] === "string" ? String(args[name]).trim() : fallback;
}

function positiveLimit(value: unknown, fallback: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(Math.floor(value), max);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function arrayField(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringField(record: Record<string, unknown>, name: string): string | undefined {
  return typeof record[name] === "string" ? record[name] as string : undefined;
}

function fieldsArg(args: Record<string, unknown>, name = "fields"): Record<string, unknown> | AirtableError {
  const value = args[name];
  if (!isRecord(value) || !Object.keys(value).length) return { error: `airtable tool requires "${name}" as a non-empty object of field values.` };
  return value;
}

function recordListArg(args: Record<string, unknown>, name = "records"): Array<{ fields: Record<string, unknown> }> | AirtableError {
  if (!Array.isArray(args[name]) || !(args[name] as unknown[]).length) return { error: `airtable tool requires "${name}" as a non-empty array.` };
  const records = (args[name] as unknown[]).map(asRecord);
  if (records.length > 10) return { error: "Airtable batch writes are capped at 10 records per request." };
  const normalized = records.map((record) => ({ fields: asRecord(record.fields) }));
  if (normalized.some((record) => !Object.keys(record.fields).length)) return { error: `Every "${name}" entry must contain a non-empty fields object.` };
  return normalized;
}

function authHeaders(context: AirtableToolContext, json = false): Record<string, string> | AirtableError {
  const accessToken = token(context);
  if (!accessToken) {
    return {
      error: "Airtable token is not configured.",
      hint: "Create a Personal Access Token at https://airtable.com/create/tokens, grant schema.bases:read and data.records scopes, add the target base to token Access, then set AIRTABLE_API_KEY or AIRTABLE_PAT.",
    };
  }
  return {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
}

function airtableHint(status: number, code?: string): string | undefined {
  if (status === 401) return "Check AIRTABLE_API_KEY/AIRTABLE_PAT. Legacy key... API keys are deprecated; use a pat... Personal Access Token.";
  if (status === 403) return "The token may lack scopes or the base is not in the token Access list at https://airtable.com/create/tokens.";
  if (status === 404) return "Check the base id, table id/name, and record id. Prefer stable app..., tbl..., and rec... ids.";
  if (status === 429) return "Airtable rate limit is 5 requests/sec per base; retry after the server's backoff.";
  if (code === "INVALID_MULTIPLE_CHOICE_OPTIONS") return "Single/multi-select values must already exist unless typecast=true is set.";
  return undefined;
}

async function airtableRequest(
  context: AirtableToolContext,
  path: string,
  options: { readonly method?: string; readonly query?: URLSearchParams; readonly body?: unknown } = {},
): Promise<AirtableCallResult> {
  if (typeof context.fetch !== "function") return { error: "Airtable pack has no network access: the loader did not grant fetch." };
  const headers = authHeaders(context, options.body !== undefined);
  if ("error" in headers) return headers;
  const url = new URL(`https://api.airtable.com${path}`);
  if (options.query) {
    for (const [key, value] of options.query) url.searchParams.append(key, value);
  }
  let response: Response;
  try {
    response = await context.fetch(url, {
      method: options.method ?? "GET",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch (error) {
    return { error: `Airtable request failed before a response: ${error instanceof Error ? error.message : String(error)}` };
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
    const code = stringField(nested, "type") ?? stringField(nested, "code") ?? stringField(record, "error");
    const message = stringField(nested, "message") ?? stringField(record, "message") ?? (text || `HTTP ${response.status}`);
    return { error: message, code, status: response.status, hint: airtableHint(response.status, code) };
  }
  return { ok: true, data };
}

function basePath(baseId: string, table?: string, recordId?: string): string {
  const parts = ["/v0", encodeURIComponent(baseId)];
  if (table) parts.push(encodeURIComponent(table));
  if (recordId) parts.push(encodeURIComponent(recordId));
  return parts.join("/");
}

function baseIdArg(args: Record<string, unknown>): string | AirtableError {
  const baseId = stringArg(args, "baseId");
  return baseId ? baseId : { error: 'airtable tool requires "baseId" (app...).'};
}

function tableArg(args: Record<string, unknown>): string | AirtableError {
  const table = stringArg(args, "table");
  return table ? table : { error: 'airtable tool requires "table" (prefer tbl... id; table names also work).'};
}

function recordSummary(record: unknown): Record<string, unknown> {
  const item = asRecord(record);
  return {
    id: stringField(item, "id"),
    createdTime: stringField(item, "createdTime"),
    fields: asRecord(item.fields),
  };
}

export async function airtable_bases_list(
  _args: Record<string, unknown>,
  context: AirtableToolContext,
): Promise<Record<string, unknown> | AirtableError> {
  const result = await airtableRequest(context, "/v0/meta/bases");
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    bases: arrayField(data.bases).map((base) => {
      const item = asRecord(base);
      return { id: stringField(item, "id"), name: stringField(item, "name"), permissionLevel: stringField(item, "permissionLevel") };
    }),
  };
}

export async function airtable_tables_list(
  args: Record<string, unknown>,
  context: AirtableToolContext,
): Promise<Record<string, unknown> | AirtableError> {
  const baseId = baseIdArg(args);
  if (typeof baseId !== "string") return baseId;
  const result = await airtableRequest(context, `/v0/meta/bases/${encodeURIComponent(baseId)}/tables`);
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    baseId,
    tables: arrayField(data.tables).map((table) => {
      const item = asRecord(table);
      return {
        id: stringField(item, "id"),
        name: stringField(item, "name"),
        primaryFieldId: stringField(item, "primaryFieldId"),
        fields: arrayField(item.fields).map((field) => {
          const fieldRecord = asRecord(field);
          return { id: stringField(fieldRecord, "id"), name: stringField(fieldRecord, "name"), type: stringField(fieldRecord, "type") };
        }),
      };
    }),
  };
}

export async function airtable_records_list(
  args: Record<string, unknown>,
  context: AirtableToolContext,
): Promise<Record<string, unknown> | AirtableError> {
  const baseId = baseIdArg(args);
  if (typeof baseId !== "string") return baseId;
  const table = tableArg(args);
  if (typeof table !== "string") return table;
  const query = new URLSearchParams();
  query.set("pageSize", String(positiveLimit(args.limit, 10, 100)));
  for (const field of Array.isArray(args.fields) ? args.fields.filter((value): value is string => typeof value === "string") : []) {
    query.append("fields[]", field);
  }
  const filter = stringArg(args, "filterByFormula");
  if (filter) query.set("filterByFormula", filter);
  const view = stringArg(args, "view");
  if (view) query.set("view", view);
  const offset = stringArg(args, "offset");
  if (offset) query.set("offset", offset);
  const result = await airtableRequest(context, basePath(baseId, table), { query });
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return { baseId, table, records: arrayField(data.records).map(recordSummary), offset: stringField(data, "offset") };
}

export async function airtable_record_get(
  args: Record<string, unknown>,
  context: AirtableToolContext,
): Promise<Record<string, unknown> | AirtableError> {
  const baseId = baseIdArg(args);
  if (typeof baseId !== "string") return baseId;
  const table = tableArg(args);
  if (typeof table !== "string") return table;
  const recordId = stringArg(args, "recordId");
  if (!recordId) return { error: 'airtable_record_get requires "recordId" (rec...).'};
  const result = await airtableRequest(context, basePath(baseId, table, recordId));
  if (!result.ok) return result;
  return recordSummary(result.data);
}

export async function airtable_record_create(
  args: Record<string, unknown>,
  context: AirtableToolContext,
): Promise<Record<string, unknown> | AirtableError> {
  const baseId = baseIdArg(args);
  if (typeof baseId !== "string") return baseId;
  const table = tableArg(args);
  if (typeof table !== "string") return table;
  const fields = fieldsArg(args);
  if ("error" in fields) return fields;
  const body = { fields, ...(args.typecast === true ? { typecast: true } : {}) };
  const result = await airtableRequest(context, basePath(baseId, table), { method: "POST", body });
  if (!result.ok) return result;
  return recordSummary(result.data);
}

export async function airtable_record_update(
  args: Record<string, unknown>,
  context: AirtableToolContext,
): Promise<Record<string, unknown> | AirtableError> {
  const baseId = baseIdArg(args);
  if (typeof baseId !== "string") return baseId;
  const table = tableArg(args);
  if (typeof table !== "string") return table;
  const recordId = stringArg(args, "recordId");
  if (!recordId) return { error: 'airtable_record_update requires "recordId" (rec...).'};
  const fields = fieldsArg(args);
  if ("error" in fields) return fields;
  const body = { fields, ...(args.typecast === true ? { typecast: true } : {}) };
  const result = await airtableRequest(context, basePath(baseId, table, recordId), { method: "PATCH", body });
  if (!result.ok) return result;
  return recordSummary(result.data);
}

export async function airtable_records_upsert(
  args: Record<string, unknown>,
  context: AirtableToolContext,
): Promise<Record<string, unknown> | AirtableError> {
  const baseId = baseIdArg(args);
  if (typeof baseId !== "string") return baseId;
  const table = tableArg(args);
  if (typeof table !== "string") return table;
  const fieldsToMergeOn = Array.isArray(args.fieldsToMergeOn) ? args.fieldsToMergeOn.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [];
  if (!fieldsToMergeOn.length) return { error: 'airtable_records_upsert requires "fieldsToMergeOn" as a non-empty string array.' };
  const records = recordListArg(args);
  if ("error" in records) return records;
  const body = {
    performUpsert: { fieldsToMergeOn },
    records,
    ...(args.typecast === true ? { typecast: true } : {}),
  };
  const result = await airtableRequest(context, basePath(baseId, table), { method: "PATCH", body });
  if (!result.ok) return result;
  const data = asRecord(result.data);
  return {
    baseId,
    table,
    records: arrayField(data.records).map(recordSummary),
    createdRecords: arrayField(data.createdRecords),
    updatedRecords: arrayField(data.updatedRecords),
  };
}

export const tools = {
  airtable_bases_list,
  airtable_tables_list,
  airtable_records_list,
  airtable_record_get,
  airtable_record_create,
  airtable_record_update,
  airtable_records_upsert,
};
