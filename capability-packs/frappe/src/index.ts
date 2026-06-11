/**
 * Frappe/ERPNext capability pack v0 — three real tools ported from the
 * production patterns in ../FRAPPE_SURFACE_SPEC.md and the
 * frappe2-openclaw-gateway reference deployment.
 *
 * Contract:
 * - Pure functions: every tool takes (args, context) where context is the
 *   frozen, permission-scoped CapabilityToolContext handed in by the loader
 *   (HC-012). No ambient fetch, no direct process.env reads.
 * - Permission-scoped: every call executes as the configured Frappe user;
 *   Frappe remains the only authorization authority. A 403 PermissionError is
 *   returned verbatim, never masked.
 * - Error-diagnostic: failures return { error } carrying the exact Frappe
 *   message (exception / _server_messages / message) plus HTTP status and
 *   exc_type — never a swallowed "malformed data".
 *
 * Config comes from manifest secrets via context.config:
 *   FRAPPE_SITE_URL  e.g. https://uat-erp.pwhr.in
 *   FRAPPE_API_TOKEN api_key:api_secret ("token ..." auth) or a bare OAuth
 *                    bearer token ("Bearer ..." auth)
 */

export interface FrappeToolContext {
  readonly fetch?: typeof globalThis.fetch;
  readonly config: Readonly<Record<string, string | undefined>>;
}

export interface FrappeError {
  readonly error: string;
  readonly status?: number;
  readonly excType?: string;
}

interface FrappeCallOk {
  readonly ok: true;
  readonly data: Record<string, unknown>;
}

type FrappeCallResult = FrappeCallOk | (FrappeError & { readonly ok?: undefined });

function configError(name: string): FrappeError {
  return { error: `Frappe pack is not configured: ${name} is missing. Declare it in the environment (manifest secret).` };
}

function authorizationHeader(token: string): string {
  // Frappe API key:secret pairs use "token ..."; bare OAuth access tokens use "Bearer ...".
  return token.includes(":") ? `token ${token}` : `Bearer ${token}`;
}

/** Extracts the exact human-readable Frappe error from a failed response body. */
function extractFrappeMessage(body: unknown, rawText: string): string {
  if (typeof body === "object" && body !== null) {
    const record = body as Record<string, unknown>;
    if (typeof record.exception === "string" && record.exception.trim()) return record.exception;
    if (typeof record._server_messages === "string" && record._server_messages.trim()) {
      try {
        const outer = JSON.parse(record._server_messages) as unknown[];
        const messages = outer.map((item) => {
          if (typeof item !== "string") return String(item);
          try {
            const inner = JSON.parse(item) as { message?: string };
            return typeof inner.message === "string" ? inner.message : item;
          } catch {
            return item;
          }
        });
        if (messages.length) return messages.join(" | ");
      } catch {
        return record._server_messages;
      }
    }
    if (typeof record.message === "string" && record.message.trim()) return record.message;
  }
  return rawText || "Frappe returned an empty error body.";
}

async function frappeRequest(
  context: FrappeToolContext,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<FrappeCallResult> {
  if (typeof context.fetch !== "function") {
    return { error: "Frappe pack has no network access: the loader did not grant fetch (manifest must declare the \"network\" permission)." };
  }
  const siteUrl = context.config.FRAPPE_SITE_URL;
  if (!siteUrl) return configError("FRAPPE_SITE_URL");
  const token = context.config.FRAPPE_API_TOKEN;
  if (!token) return configError("FRAPPE_API_TOKEN");

  const url = `${siteUrl.replace(/\/$/, "")}${path}`;
  let response: Response;
  try {
    response = await context.fetch(url, {
      method,
      headers: {
        Authorization: authorizationHeader(token),
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (error) {
    return { error: `Frappe request to ${url} failed before a response: ${error instanceof Error ? error.message : String(error)}` };
  }

  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    parsed = undefined;
  }
  if (!response.ok) {
    const excType =
      typeof parsed === "object" && parsed !== null && typeof (parsed as Record<string, unknown>).exc_type === "string"
        ? ((parsed as Record<string, unknown>).exc_type as string)
        : undefined;
    return { error: extractFrappeMessage(parsed, rawText), status: response.status, excType };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { error: `Frappe returned a non-JSON success body from ${url}: ${rawText.slice(0, 200)}`, status: response.status };
  }
  return { ok: true, data: parsed as Record<string, unknown> };
}

/** GET /api/method/frappe.auth.get_logged_user — who does this token act as? */
export async function frappe_identity_resolve(
  _args: Record<string, unknown>,
  context: FrappeToolContext,
): Promise<{ user: string; site: string } | FrappeError> {
  const result = await frappeRequest(context, "GET", "/api/method/frappe.auth.get_logged_user");
  if (!result.ok) return result;
  const user = result.data.message;
  if (typeof user !== "string" || !user) {
    return { error: `Frappe get_logged_user returned no user: ${JSON.stringify(result.data).slice(0, 200)}` };
  }
  return { user, site: context.config.FRAPPE_SITE_URL as string };
}

/**
 * Lite resource-list resolution: GET /api/resource/:doctype with fields,
 * filters, and limit. Permission scoping is Frappe's: a doctype the user
 * cannot read returns the exact PermissionError.
 */
export async function frappe_semantic_data_resolve_lite(
  args: Record<string, unknown>,
  context: FrappeToolContext,
): Promise<{ doctype: string; rows: unknown[]; count: number } | FrappeError> {
  const doctype = typeof args.doctype === "string" ? args.doctype.trim() : "";
  if (!doctype) return { error: 'frappe_semantic_data_resolve_lite requires a "doctype" argument.' };
  const query = new URLSearchParams();
  if (Array.isArray(args.fields) && args.fields.length) query.set("fields", JSON.stringify(args.fields));
  if (args.filters !== undefined) query.set("filters", JSON.stringify(args.filters));
  const limit = typeof args.limit === "number" && Number.isFinite(args.limit) && args.limit > 0 ? Math.floor(args.limit) : 20;
  query.set("limit_page_length", String(limit));

  const result = await frappeRequest(context, "GET", `/api/resource/${encodeURIComponent(doctype)}?${query.toString()}`);
  if (!result.ok) return result;
  const rows = Array.isArray(result.data.data) ? result.data.data : [];
  return { doctype, rows, count: rows.length };
}

/** POST /api/resource/:doctype — create one document as the paired Frappe user. */
export async function frappe_records_create(
  args: Record<string, unknown>,
  context: FrappeToolContext,
): Promise<{ created: Record<string, unknown> } | FrappeError> {
  const doctype = typeof args.doctype === "string" ? args.doctype.trim() : "";
  if (!doctype) return { error: 'frappe_records_create requires a "doctype" argument.' };
  const doc = args.doc;
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return { error: 'frappe_records_create requires a "doc" object with the document fields.' };
  }
  const result = await frappeRequest(context, "POST", `/api/resource/${encodeURIComponent(doctype)}`, doc as Record<string, unknown>);
  if (!result.ok) return result;
  const created = result.data.data;
  if (typeof created !== "object" || created === null) {
    return { error: `Frappe create returned no document body: ${JSON.stringify(result.data).slice(0, 200)}` };
  }
  return { created: created as Record<string, unknown> };
}

/** Loader entrypoint contract: tools record, registered as frappe-federated-bridge__<name>. */
export const tools = {
  frappe_identity_resolve,
  frappe_semantic_data_resolve_lite,
  frappe_records_create,
};
