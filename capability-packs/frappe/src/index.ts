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
  readonly headers?: Headers;
}

type FrappeCallResult = FrappeCallOk | (FrappeError & { readonly ok?: undefined });

type FrappeAuth =
  | { readonly kind: "token"; readonly value: string }
  | { readonly kind: "cookie"; readonly value: string };

interface FrappeDocSource {
  readonly label: string;
  readonly url: string;
  readonly scope: "framework" | "erpnext" | "frappe-suite" | "installed-app" | "module";
}

interface FrappeModuleContext {
  readonly module: string;
  readonly apps: string[];
  readonly docs: FrappeDocSource[];
  readonly concepts: string[];
  readonly retrievalHints: string[];
}

const FRAPPE_DOCS: readonly FrappeDocSource[] = [
  { label: "Frappe Framework docs", url: "https://frappeframework.com/docs", scope: "framework" },
  { label: "Frappe REST API", url: "https://frappeframework.com/docs/user/en/api/rest", scope: "framework" },
  { label: "Frappe DocType model", url: "https://frappeframework.com/docs/user/en/basics/doctypes", scope: "framework" },
  { label: "Frappe Custom Fields", url: "https://frappeframework.com/docs/user/en/customize-erpnext/custom-field", scope: "framework" },
  { label: "Frappe Workflows", url: "https://frappeframework.com/docs/user/en/desk/workflows", scope: "framework" },
  { label: "ERPNext manual", url: "https://docs.erpnext.com/", scope: "erpnext" },
  { label: "ERPNext modules", url: "https://docs.erpnext.com/docs/user/manual/en/modules", scope: "erpnext" },
  { label: "Frappe CRM docs", url: "https://docs.frappe.io/crm", scope: "frappe-suite" },
  { label: "Frappe HR docs", url: "https://docs.frappe.io/hr", scope: "frappe-suite" },
  { label: "Frappe Helpdesk docs", url: "https://docs.frappe.io/helpdesk", scope: "frappe-suite" },
  { label: "Frappe Insights docs", url: "https://docs.frappe.io/insights", scope: "frappe-suite" },
  { label: "Frappe Builder docs", url: "https://docs.frappe.io/builder", scope: "frappe-suite" },
  { label: "Frappe LMS docs", url: "https://docs.frappe.io/lms", scope: "frappe-suite" },
  { label: "Frappe Wiki docs", url: "https://docs.frappe.io/wiki", scope: "frappe-suite" },
];

const MODULE_PRIORS: readonly FrappeModuleContext[] = [
  modulePrior("Accounts", ["erpnext"], ["Company", "Account", "Journal Entry", "Sales Invoice", "Purchase Invoice", "Payment Entry"], ["GL Entry", "accounting dimensions", "party ledger", "currency"]),
  modulePrior("Selling", ["erpnext"], ["Customer", "Lead", "Opportunity", "Quotation", "Sales Order", "Sales Invoice"], ["selling pipeline", "pricing rules", "taxes", "territory"]),
  modulePrior("Buying", ["erpnext"], ["Supplier", "Material Request", "Request for Quotation", "Purchase Order", "Purchase Receipt", "Purchase Invoice"], ["supplier quotation", "stock impact", "landed cost"]),
  modulePrior("Stock", ["erpnext"], ["Item", "Warehouse", "Stock Entry", "Delivery Note", "Purchase Receipt", "Bin"], ["valuation", "serial/batch", "reserved stock", "reorder"]),
  modulePrior("Manufacturing", ["erpnext"], ["BOM", "Work Order", "Job Card", "Production Plan", "Operation"], ["routing", "workstation", "subcontracting", "WIP"]),
  modulePrior("Projects", ["erpnext"], ["Project", "Task", "Timesheet", "Project Template"], ["milestones", "billing", "costing"]),
  modulePrior("HR", ["erpnext", "hrms"], ["Employee", "Department", "Designation", "Leave Application", "Attendance", "Salary Slip"], ["permissions by employee", "payroll", "shift", "leave allocation"]),
  modulePrior("Payroll", ["erpnext", "hrms"], ["Payroll Entry", "Salary Structure", "Salary Component", "Salary Slip"], ["earnings", "deductions", "tax", "arrears"]),
  modulePrior("CRM", ["erpnext", "frappe_crm"], ["Lead", "Deal", "Contact", "Organization", "Opportunity"], ["pipeline", "assignment", "communication timeline"]),
  modulePrior("Support", ["erpnext", "helpdesk"], ["Issue", "Ticket", "SLA", "Customer"], ["service levels", "assignment", "responses"]),
  modulePrior("Website", ["frappe", "webshop"], ["Web Page", "Website Theme", "Blog Post", "Item Group"], ["portal", "route", "guest access"]),
];

function configError(name: string): FrappeError {
  return { error: `Frappe pack is not configured: ${name} is missing. Declare it in the environment (manifest secret).` };
}

function authorizationHeader(token: string): string {
  // Frappe API key:secret pairs use "token ..."; bare OAuth access tokens use "Bearer ...".
  return token.includes(":") ? `token ${token}` : `Bearer ${token}`;
}

function argString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
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

async function frappeAuthedRequest(
  fetchFn: typeof globalThis.fetch,
  siteUrl: string,
  auth: FrappeAuth,
  method: "GET" | "POST",
  path: string,
  body?: Record<string, unknown>,
): Promise<FrappeCallResult> {
  const url = `${siteUrl.replace(/\/$/, "")}${path}`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      method,
      headers: {
        ...(auth.kind === "token" ? { Authorization: authorizationHeader(auth.value) } : { Cookie: auth.value }),
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
  return { ok: true, data: parsed as Record<string, unknown>, headers: response.headers };
}

async function resolveRuntimeAuth(args: Record<string, unknown>, context: FrappeToolContext): Promise<{ siteUrl: string; auth: FrappeAuth; mode: "api_token" | "admin_login" } | FrappeError> {
  if (typeof context.fetch !== "function") {
    return { error: "Frappe pack has no network access: the loader did not grant fetch (manifest must declare the \"network\" permission)." };
  }
  const siteUrl = argString(args, "siteUrl") ?? context.config.FRAPPE_SITE_URL;
  if (!siteUrl) return configError("FRAPPE_SITE_URL");
  const token = argString(args, "apiToken") ?? context.config.FRAPPE_API_TOKEN;
  if (token) return { siteUrl, auth: { kind: "token", value: token }, mode: "api_token" };

  const user = argString(args, "adminUser") ?? argString(args, "user");
  const password = argString(args, "adminPassword") ?? argString(args, "password");
  if (!user || !password) {
    return { error: "Frappe context build needs FRAPPE_API_TOKEN, or runtime args siteUrl + adminUser + adminPassword. Password args are used only for this call and are never returned." };
  }
  const login = await frappeLogin(context.fetch, siteUrl, user, password);
  if (!login.ok) return login;
  return { siteUrl, auth: { kind: "cookie", value: login.cookie }, mode: "admin_login" };
}

async function frappeLogin(fetchFn: typeof globalThis.fetch, siteUrl: string, user: string, password: string): Promise<{ ok: true; cookie: string } | FrappeError> {
  const url = `${siteUrl.replace(/\/$/, "")}/api/method/login`;
  let response: Response;
  try {
    response = await fetchFn(url, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ usr: user, pwd: password }).toString(),
    });
  } catch (error) {
    return { error: `Frappe login to ${url} failed before a response: ${error instanceof Error ? error.message : String(error)}` };
  }
  const rawText = await response.text();
  let parsed: unknown;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    parsed = undefined;
  }
  if (!response.ok) return { error: extractFrappeMessage(parsed, rawText), status: response.status };
  const getSetCookie = (response.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  const rawCookie = getSetCookie.length ? getSetCookie.join(",") : response.headers.get("set-cookie") ?? "";
  const cookie = rawCookie.split(/,(?=[^;]+?=)/).map((item) => item.split(";")[0]?.trim()).filter(Boolean).join("; ");
  if (!cookie) return { error: "Frappe login succeeded but no session cookie was returned; use an API token instead.", status: response.status };
  return { ok: true, cookie };
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

/**
 * Return docs and module priors used by retrieval before hitting a live site.
 * This is intentionally generic: OxygenHR is just one custom app name in args.apps.
 */
export async function frappe_docs_context(
  args: Record<string, unknown>,
  _context: FrappeToolContext,
): Promise<{ apps: string[]; modules: FrappeModuleContext[]; docs: FrappeDocSource[]; retrievalPlan: string[] }> {
  const apps = stringList(args.apps);
  const modules = stringList(args.modules);
  const query = typeof args.query === "string" ? args.query : "";
  const selectedModules = selectModulePriors({ apps, modules, query });
  const installedDocs = apps
    .filter((app) => !["frappe", "erpnext", "hrms"].includes(app.toLowerCase()))
    .map((app): FrappeDocSource => ({
      label: `${app} installed app docs`,
      url: `apps/${app}/README.md`,
      scope: "installed-app",
    }));
  return {
    apps,
    modules: selectedModules,
    docs: uniqueDocs([...FRAPPE_DOCS, ...installedDocs, ...selectedModules.flatMap((module) => module.docs)]),
    retrievalPlan: [
      "Start with installed apps and sites/apps.txt or live version metadata.",
      "Index app README/docs plus each app's module tree before field-level memory.",
      "Index DocType, DocField, Custom Field, Property Setter, Workflow, Role Permission, Report, Print Format, Workspace, Client Script, and Server Script nodes.",
      "Create graph links: app -> module -> DocType -> fields/customizations/workflows/permissions/reports.",
      "Use scoped FTS for the seed, then graph-expand to linked module and field evidence.",
    ],
  };
}

export async function frappe_context_setup_plan(
  args: Record<string, unknown>,
  _context: FrappeToolContext,
): Promise<{ plugin: string; setupModes: string[]; fields: string[]; setupUrls: string[]; notes: string[]; next: string[] }> {
  const siteUrl = argString(args, "siteUrl") ?? "<your-frappe-site-url>";
  return {
    plugin: "frappe-federated-bridge",
    setupModes: ["recommended: siteUrl + API token", "one-time: siteUrl + adminUser + adminPassword"],
    fields: ["siteUrl", "apiToken", "adminUser", "adminPassword"],
    setupUrls: [
      `${siteUrl.replace(/\/$/, "")}/app/user`,
      "https://frappeframework.com/docs/user/en/api/rest",
      "https://docs.erpnext.com/",
      "https://frappeframework.com/docs",
    ],
    notes: [
      "Keep the main Muster binary light: this plugin owns Frappe/ERPNext context building.",
      "API token is preferred for repeatable use. Admin password mode is for a one-time context build and should not be stored.",
      "The context builder discovers installed apps/modules, then combines live metadata with Frappe, ERPNext, and Frappe Suite docs.",
      "Generated context should be indexed as scoped memory by tenant/site/user before agent runs use it.",
    ],
    next: [
      "Run plugin setup with site URL and token, or one-time admin credentials.",
      "Build installed context.",
      "Run module context for high-value modules such as Accounts, HR, Selling, Buying, Stock, CRM, or custom apps.",
      "Seed retrieval evals with module-specific DocType/field/workflow cases before relying on it in production.",
    ],
  };
}

/**
 * Live-site context: installed apps, workspaces/modules, plus docs and priors.
 * The method calls are read-only and tolerate permission-limited Frappe users.
 */
export async function frappe_installed_context(
  args: Record<string, unknown>,
  context: FrappeToolContext,
): Promise<{ site?: string; installedApps: string[]; modules: string[]; docs: FrappeDocSource[]; warnings: string[] } | FrappeError> {
  const warnings: string[] = [];
  const installedApps = new Set(stringList(args.apps));
  const modules = new Set(stringList(args.modules));

  const auth = await resolveRuntimeAuth(args, context);
  if ("error" in auth) return auth;

  const versions = await frappeAuthedRequest(context.fetch!, auth.siteUrl, auth.auth, "GET", "/api/method/frappe.utils.change_log.get_versions");
  if (versions.ok) {
    for (const app of extractInstalledApps(versions.data)) installedApps.add(app);
  } else {
    warnings.push(`versions unavailable: ${versions.error}`);
  }

  const workspaces = await frappeAuthedRequest(context.fetch!, auth.siteUrl, auth.auth, "GET", "/api/method/frappe.desk.desktop.get_workspace_sidebar_items");
  if (workspaces.ok) {
    for (const module of extractWorkspaceModules(workspaces.data)) modules.add(module);
  } else {
    warnings.push(`workspace modules unavailable: ${workspaces.error}`);
  }

  const docs = await frappe_docs_context({ apps: [...installedApps], modules: [...modules], query: args.query }, context);
  return {
    site: auth.siteUrl,
    installedApps: [...installedApps].sort(),
    modules: [...modules].sort(),
    docs: docs.docs,
    warnings,
  };
}

export async function frappe_context_build(
  args: Record<string, unknown>,
  context: FrappeToolContext,
): Promise<{
  site: string;
  authMode: "api_token" | "admin_login";
  installedApps: string[];
  modules: string[];
  docs: FrappeDocSource[];
  moduleContexts: Array<Awaited<ReturnType<typeof frappe_module_context>>>;
  indexPlan: string[];
  warnings: string[];
} | FrappeError> {
  const auth = await resolveRuntimeAuth(args, context);
  if ("error" in auth) return auth;
  const installed = await frappe_installed_context(args, context);
  if ("error" in installed) return installed;
  const requestedModules = stringList(args.modules);
  const modules = requestedModules.length ? requestedModules : installed.modules.slice(0, 8);
  const moduleContexts = [];
  for (const module of modules) {
    moduleContexts.push(await frappe_module_context({ ...args, module, siteUrl: auth.siteUrl }, context));
  }
  return {
    site: auth.siteUrl,
    authMode: auth.mode,
    installedApps: installed.installedApps,
    modules: installed.modules,
    docs: installed.docs,
    moduleContexts,
    indexPlan: [
      "Index site/app/module overview as scoped memory.",
      "Index Frappe/ERPNext/Frappe Suite docs URLs as retrieval sources, not prompt bulk.",
      "Index live DocType, DocField, Custom Field, Workflow, Permission, Report, Print Format, Workspace, Client Script, and Server Script nodes.",
      "Link nodes app -> module -> DocType -> child table/Link fields/customizations/workflows/permissions.",
      "Run retrieval eval seed-frappe-pack or module-specific fixtures before enabling graph expansion for production users.",
    ],
    warnings: installed.warnings,
  };
}

/**
 * Module-specific retrieval context for Frappe/ERPNext and installed suite apps.
 * Returns DocTypes when the paired user can read metadata; otherwise returns priors
 * plus exact diagnostics so the UI can guide setup instead of pretending context exists.
 */
export async function frappe_module_context(
  args: Record<string, unknown>,
  context: FrappeToolContext,
): Promise<{
  module: string;
  docs: FrappeDocSource[];
  priors: FrappeModuleContext[];
  doctypes: unknown[];
  customFields: unknown[];
  workflows: unknown[];
  warnings: string[];
} | FrappeError> {
  const module = typeof args.module === "string" && args.module.trim() ? args.module.trim() : "";
  if (!module) return { error: 'frappe_module_context requires a "module" argument.' };
  const warnings: string[] = [];
  const apps = stringList(args.apps);
  const docs = await frappe_docs_context({ apps, modules: [module], query: args.query }, context);
  const auth = await resolveRuntimeAuth(args, context);
  if ("error" in auth) {
    warnings.push(auth.error);
    return { module, docs: docs.docs, priors: docs.modules, doctypes: [], customFields: [], workflows: [], warnings };
  }
  const doctypes = await frappeList(context, auth.siteUrl, auth.auth, "DocType", ["name", "module", "custom", "istable"], [["module", "=", module]], 200, warnings);
  const customFields = await frappeList(context, auth.siteUrl, auth.auth, "Custom Field", ["name", "dt", "fieldname", "fieldtype", "options"], [["dt", "like", `%${module}%`]], 100, warnings);
  const workflows = await frappeList(context, auth.siteUrl, auth.auth, "Workflow", ["name", "document_type", "is_active"], [["document_type", "like", `%${module}%`]], 100, warnings);
  return {
    module,
    docs: docs.docs,
    priors: docs.modules,
    doctypes,
    customFields,
    workflows,
    warnings,
  };
}

/** Loader entrypoint contract: tools record, registered as frappe-federated-bridge__<name>. */
export const tools = {
  frappe_identity_resolve,
  frappe_semantic_data_resolve_lite,
  frappe_records_create,
  frappe_docs_context,
  frappe_context_setup_plan,
  frappe_context_build,
  frappe_installed_context,
  frappe_module_context,
};

function modulePrior(module: string, apps: string[], doctypes: string[], concepts: string[]): FrappeModuleContext {
  const slug = module.toLowerCase().replace(/\s+/g, "-");
  return {
    module,
    apps,
    docs: [
      { label: `${module} module docs`, url: `https://docs.erpnext.com/docs/user/manual/en/${slug}`, scope: "module" },
    ],
    concepts,
    retrievalHints: [
      ...doctypes.map((doctype) => `DocType:${doctype}`),
      ...concepts.map((concept) => `concept:${concept}`),
    ],
  };
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function selectModulePriors(input: { readonly apps: readonly string[]; readonly modules: readonly string[]; readonly query: string }): FrappeModuleContext[] {
  const appSet = new Set(input.apps.map((app) => app.toLowerCase()));
  const moduleSet = new Set(input.modules.map((module) => module.toLowerCase()));
  const query = input.query.toLowerCase();
  if (moduleSet.size) {
    const selected = MODULE_PRIORS.filter((prior) => moduleSet.has(prior.module.toLowerCase()));
    if (selected.length) return selected;
  }
  const selected = MODULE_PRIORS.filter((prior) => {
    if (prior.apps.some((app) => appSet.has(app))) return true;
    if (query && [prior.module, ...prior.concepts, ...prior.retrievalHints].some((text) => text.toLowerCase().includes(query) || query.includes(text.toLowerCase()))) return true;
    return false;
  });
  return selected.length ? selected : MODULE_PRIORS.slice(0, 6);
}

function uniqueDocs(docs: readonly FrappeDocSource[]): FrappeDocSource[] {
  return [...new Map(docs.map((doc) => [doc.url, doc])).values()];
}

function extractInstalledApps(data: Record<string, unknown>): string[] {
  const message = data.message;
  if (typeof message === "object" && message !== null) {
    return Object.keys(message as Record<string, unknown>);
  }
  return [];
}

function extractWorkspaceModules(data: Record<string, unknown>): string[] {
  const message = data.message;
  const source = Array.isArray(message) ? message : Array.isArray((message as Record<string, unknown> | undefined)?.pages) ? (message as { pages: unknown[] }).pages : [];
  return source.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title : typeof row.name === "string" ? row.name : undefined;
    return title ? [title] : [];
  });
}

async function frappeList(
  context: FrappeToolContext,
  siteUrl: string,
  auth: FrappeAuth,
  doctype: string,
  fields: readonly string[],
  filters: readonly unknown[],
  limit: number,
  warnings: string[],
): Promise<unknown[]> {
  const query = new URLSearchParams();
  query.set("fields", JSON.stringify(fields));
  query.set("filters", JSON.stringify(filters));
  query.set("limit_page_length", String(limit));
  if (typeof context.fetch !== "function") {
    warnings.push(`${doctype} unavailable: network permission was not granted`);
    return [];
  }
  const result = await frappeAuthedRequest(context.fetch, siteUrl, auth, "GET", `/api/resource/${encodeURIComponent(doctype)}?${query.toString()}`);
  if (!result.ok) {
    warnings.push(`${doctype} unavailable: ${result.error}`);
    return [];
  }
  return Array.isArray(result.data.data) ? result.data.data : [];
}
