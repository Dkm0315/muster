import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { defaultConfig, loadCapabilityPack, parseFlow, runFlow } from "../src/index.js";
import type { FlowToolRegistry } from "../src/index.js";
import {
  frappe_identity_resolve,
  frappe_records_create,
  frappe_semantic_data_resolve_lite,
  type FrappeToolContext,
} from "../../../capability-packs/frappe/src/index.js";

const packDir = resolve(import.meta.dirname, "..", "..", "..", "capability-packs", "frappe");

interface RecordedRequest {
  method: string;
  url: string;
  authorization?: string;
  body: string;
}

/** Stub Frappe site: logged-user endpoint, resource list, resource create, and a 403 PermissionError doctype. */
function startFrappeStub(): Promise<{ url: string; requests: RecordedRequest[]; close: () => void }> {
  const requests: RecordedRequest[] = [];
  return new Promise((resolvePromise) => {
    const server = createServer((request: IncomingMessage, response: ServerResponse) => {
      let body = "";
      request.on("data", (chunk) => { body += chunk; });
      request.on("end", () => {
        requests.push({ method: request.method ?? "", url: request.url ?? "", authorization: request.headers.authorization, body });
        const respond = (status: number, payload: unknown) => {
          response.writeHead(status, { "content-type": "application/json" });
          response.end(JSON.stringify(payload));
        };
        const url = request.url ?? "";
        if (!request.headers.authorization) {
          return respond(401, { exc_type: "AuthenticationError", exception: "frappe.exceptions.AuthenticationError: Invalid token" });
        }
        if (url.startsWith("/api/method/frappe.auth.get_logged_user")) {
          return respond(200, { message: "dhairya@hybrowlabs.com" });
        }
        if (url.startsWith("/api/resource/Salary%20Slip")) {
          // exact Frappe PermissionError shape, passed through verbatim
          return respond(403, {
            exc_type: "PermissionError",
            exception: "frappe.exceptions.PermissionError: User dhairya@hybrowlabs.com does not have doctype access via role permission for document Salary Slip",
            _server_messages: JSON.stringify([JSON.stringify({ message: "Insufficient Permission for Salary Slip" })]),
          });
        }
        if (url.startsWith("/api/resource/HD%20Ticket") && request.method === "GET") {
          return respond(200, { data: [{ name: "T-1", status: "Open" }, { name: "T-2", status: "Open" }] });
        }
        if (url.startsWith("/api/resource/ToDo") && request.method === "POST") {
          const doc = JSON.parse(body) as Record<string, unknown>;
          return respond(200, { data: { name: "TODO-0001", doctype: "ToDo", ...doc } });
        }
        return respond(404, { exc_type: "DoesNotExistError", exception: `frappe.exceptions.DoesNotExistError: ${url}` });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolvePromise({ url: `http://127.0.0.1:${port}`, requests, close: () => server.close() });
    });
  });
}

function contextFor(siteUrl: string, token = "api-key:api-secret"): FrappeToolContext {
  return Object.freeze({
    fetch: globalThis.fetch.bind(globalThis),
    config: Object.freeze({ FRAPPE_SITE_URL: siteUrl, FRAPPE_API_TOKEN: token }),
  });
}

test("frappe_identity_resolve returns the logged user with token auth", async () => {
  const site = await startFrappeStub();
  try {
    const result = await frappe_identity_resolve({}, contextFor(site.url));
    assert.deepEqual(result, { user: "dhairya@hybrowlabs.com", site: site.url });
    assert.equal(site.requests[0].authorization, "token api-key:api-secret", "key:secret tokens use Frappe token auth");

    await frappe_identity_resolve({}, contextFor(site.url, "bare-oauth-token"));
    assert.equal(site.requests[1].authorization, "Bearer bare-oauth-token", "bare tokens use Bearer auth");
  } finally {
    site.close();
  }
});

test("frappe_semantic_data_resolve_lite lists resources with fields/filters/limit", async () => {
  const site = await startFrappeStub();
  try {
    const result = await frappe_semantic_data_resolve_lite(
      { doctype: "HD Ticket", fields: ["name", "status"], filters: { status: "Open" }, limit: 5 },
      contextFor(site.url),
    );
    assert.deepEqual(result, {
      doctype: "HD Ticket",
      rows: [{ name: "T-1", status: "Open" }, { name: "T-2", status: "Open" }],
      count: 2,
    });
    const url = site.requests[0].url;
    assert.match(url, /fields=%5B%22name%22%2C%22status%22%5D/, "fields are JSON-encoded query params");
    assert.match(url, /filters=/);
    assert.match(url, /limit_page_length=5/);

    const noDoctype = await frappe_semantic_data_resolve_lite({}, contextFor(site.url));
    assert.match((noDoctype as { error: string }).error, /requires a "doctype"/);
  } finally {
    site.close();
  }
});

test("frappe_records_create posts the doc and returns the created document", async () => {
  const site = await startFrappeStub();
  try {
    const result = await frappe_records_create(
      { doctype: "ToDo", doc: { description: "Follow up on T-1", priority: "High" } },
      contextFor(site.url),
    );
    assert.deepEqual(result, {
      created: { name: "TODO-0001", doctype: "ToDo", description: "Follow up on T-1", priority: "High" },
    });
    assert.equal(site.requests[0].method, "POST");
    assert.deepEqual(JSON.parse(site.requests[0].body), { description: "Follow up on T-1", priority: "High" });
  } finally {
    site.close();
  }
});

test("a 403 PermissionError passes through with the exact Frappe message, never swallowed", async () => {
  const site = await startFrappeStub();
  try {
    const result = await frappe_semantic_data_resolve_lite({ doctype: "Salary Slip" }, contextFor(site.url));
    assert.equal((result as { status: number }).status, 403);
    assert.equal((result as { excType: string }).excType, "PermissionError");
    assert.match(
      (result as { error: string }).error,
      /frappe\.exceptions\.PermissionError: User dhairya@hybrowlabs\.com does not have doctype access/,
      "the exact Frappe exception string is returned",
    );
  } finally {
    site.close();
  }
});

test("missing config and missing network access produce diagnostic errors", async () => {
  const noSite = await frappe_identity_resolve({}, Object.freeze({ fetch: globalThis.fetch, config: Object.freeze({ FRAPPE_API_TOKEN: "x" }) }));
  assert.match((noSite as { error: string }).error, /FRAPPE_SITE_URL is missing/);

  const noToken = await frappe_identity_resolve({}, Object.freeze({ fetch: globalThis.fetch, config: Object.freeze({ FRAPPE_SITE_URL: "https://x" }) }));
  assert.match((noToken as { error: string }).error, /FRAPPE_API_TOKEN is missing/);

  const noFetch = await frappe_identity_resolve({}, Object.freeze({ config: Object.freeze({ FRAPPE_SITE_URL: "https://x", FRAPPE_API_TOKEN: "y" }) }));
  assert.match((noFetch as { error: string }).error, /no network access/);
});

test("the frappe pack loads through loadCapabilityPack and runs inside a flow", async () => {
  const site = await startFrappeStub();
  try {
    const registry: FlowToolRegistry = {};
    const loaded = await loadCapabilityPack(packDir, {
      registry,
      allowHighRisk: true, // declares secrets -> high risk by design
      env: { FRAPPE_SITE_URL: site.url, FRAPPE_API_TOKEN: "api-key:api-secret" },
    });
    assert.equal(loaded.manifest.id, "frappe-federated-bridge");
    assert.deepEqual(
      [...loaded.toolNames].sort(),
      [
        "frappe-federated-bridge__frappe_context_build",
        "frappe-federated-bridge__frappe_context_setup_plan",
        "frappe-federated-bridge__frappe_docs_context",
        "frappe-federated-bridge__frappe_identity_resolve",
        "frappe-federated-bridge__frappe_installed_context",
        "frappe-federated-bridge__frappe_module_context",
        "frappe-federated-bridge__frappe_records_create",
        "frappe-federated-bridge__frappe_semantic_data_resolve_lite",
      ],
    );

    const cwd = await mkdtemp(join(tmpdir(), "muster-frappe-flow-"));
    const flow = parseFlow({
      id: "frappe-smoke",
      steps: [
        { id: "who", kind: "tool", tool: "frappe-federated-bridge__frappe_identity_resolve" },
        { id: "tickets", kind: "tool", tool: "frappe-federated-bridge__frappe_semantic_data_resolve_lite", args: { doctype: "HD Ticket", limit: 10 } },
        { id: "todo", kind: "tool", tool: "frappe-federated-bridge__frappe_records_create", args: { doctype: "ToDo", doc: { description: "{{who.user}} has {{tickets.count}} open tickets" } } },
      ],
    });
    const result = await runFlow(flow, { config: defaultConfig(), registry, cwd });
    assert.equal(result.status, "completed");
    assert.equal(
      ((result.outputs.todo as { created: { description: string } }).created).description,
      "dhairya@hybrowlabs.com has 2 open tickets",
    );
  } finally {
    site.close();
  }
});
