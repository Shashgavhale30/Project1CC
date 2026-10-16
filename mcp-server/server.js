#!/usr/bin/env node
// ContactFlow MCP server (stdio).
//
// Lets an MCP client (Claude Desktop, Claude Code, ...) read and add contacts in
// the ContactFlow portal by calling its REST API. It never touches MongoDB
// directly, so no database credentials are needed here, and all validation
// stays in the backend.
//
// Config (env):
//   CONTACTFLOW_API_URL  Base URL of the contacts API.
//                        Default: https://project1cc-backend.onrender.com/api/contacts

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const API = (
  process.env.CONTACTFLOW_API_URL ||
  "https://project1cc-backend.onrender.com/api/contacts"
).replace(/\/+$/, "");

// Render's free tier sleeps when idle; the first request can take ~30-60s.
const TIMEOUT_MS = 60000;

const CATEGORIES = ["Client", "Colleague", "Business Partner", "Vendor", "Other"];

// ── HTTP helper ────────────────────────────────────────────
class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function api(path = "", { method = "GET", body, query } = {}) {
  const url = new URL(API + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, v);
  }
  let res;
  try {
    res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    throw new ApiError(
      0,
      `Could not reach the ContactFlow API at ${API} (${err.name === "TimeoutError" ? "timed out" : err.message}).`,
    );
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || `API returned HTTP ${res.status}.`);
  }
  return data;
}

// ── Result helpers ─────────────────────────────────────────
const ok = (value) => ({
  content: [
    { type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) },
  ],
});
const fail = (message) => ({ isError: true, content: [{ type: "text", text: message }] });

async function guarded(fn) {
  try {
    return await fn();
  } catch (err) {
    return fail(err instanceof ApiError ? err.message : `Unexpected error: ${err.message}`);
  }
}

// ── Schemas ────────────────────────────────────────────────
const contactFields = {
  name: z.string().min(1).max(100).describe("Full name (required, max 100 chars)"),
  email: z.string().min(1).describe("Email address (required, must be valid; unique across contacts)"),
  company: z.string().min(1).max(120).describe("Company / organization (required, max 120 chars)"),
  category: z.enum(CATEGORIES).describe("One of: " + CATEGORIES.join(", ")),
  phone: z.string().max(30).optional().describe("Phone number (max 30 chars)"),
  jobTitle: z.string().max(120).optional().describe("Job title (max 120 chars)"),
  notes: z.string().max(1000).optional().describe("Free-text notes (max 1000 chars)"),
};
const contactSchema = z.object(contactFields);

const server = new McpServer({ name: "contactflow", version: "1.0.0" });

// ── Tools ──────────────────────────────────────────────────
server.registerTool(
  "list_contacts",
  {
    title: "List / search contacts",
    description:
      "List contacts in ContactFlow, newest first. Optionally filter by a search term (matches name, email or company) and/or category. Use this to check for an existing contact before adding one.",
    inputSchema: {
      search: z.string().optional().describe("Substring to match in name, email or company"),
      category: z.enum(CATEGORIES).optional().describe("Only return this category"),
      limit: z.number().int().min(1).max(200).optional().describe("Max contacts to return (default 50)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ search, category, limit }) =>
    guarded(async () => {
      const all = await api("", { query: { search, category } });
      const max = limit ?? 50;
      return ok({ total: all.length, returned: Math.min(all.length, max), contacts: all.slice(0, max) });
    }),
);

server.registerTool(
  "get_contact",
  {
    title: "Get one contact",
    description: "Fetch a single contact by its contactId (e.g. CT-ABC123-XY12).",
    inputSchema: { contactId: z.string().min(1).describe("The contact's contactId") },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  ({ contactId }) => guarded(async () => ok(await api(`/${encodeURIComponent(contactId)}`))),
);

server.registerTool(
  "get_stats",
  {
    title: "Dashboard stats",
    description: "Summary numbers shown on the portal dashboard: total contacts, companies, clients, recently added.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  () => guarded(async () => ok(await api("/stats"))),
);

server.registerTool(
  "add_contact",
  {
    title: "Add a contact",
    description:
      "Create one contact in the ContactFlow portal. name, email, company and category are required. The contactId is generated automatically. Fails with a clear message if the email already exists or validation fails.",
    inputSchema: contactFields,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  (contact) =>
    guarded(async () => {
      const created = await api("", { method: "POST", body: contact });
      return ok({ message: "Contact added.", contact: created });
    }),
);

server.registerTool(
  "add_contacts_bulk",
  {
    title: "Add many contacts",
    description:
      "Create several contacts in one call (max 100). Each is added independently: a failure on one (e.g. duplicate email) does not stop the rest. Returns which succeeded and which failed, with reasons.",
    inputSchema: { contacts: z.array(contactSchema).min(1).max(100).describe("Contacts to add") },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  ({ contacts }) =>
    guarded(async () => {
      const added = [];
      const failed = [];
      // Sequential on purpose: keeps load on the (free-tier) backend low and
      // gives a deterministic order in the portal.
      for (const [i, c] of contacts.entries()) {
        try {
          const created = await api("", { method: "POST", body: c });
          added.push({ contactId: created.contactId, name: created.name, email: created.email });
        } catch (err) {
          failed.push({ index: i, name: c.name, email: c.email, error: err.message });
        }
      }
      const summary = { requested: contacts.length, added: added.length, failed: failed.length, addedContacts: added, failures: failed };
      return failed.length === contacts.length ? { ...fail(JSON.stringify(summary, null, 2)) } : ok(summary);
    }),
);

server.registerTool(
  "update_contact",
  {
    title: "Update a contact",
    description:
      "Partially update an existing contact by contactId. Only the fields you pass are changed. Look the contact up first with list_contacts if you only know the name or email.",
    inputSchema: {
      contactId: z.string().min(1).describe("The contact's contactId"),
      name: contactFields.name.optional(),
      email: contactFields.email.optional(),
      company: contactFields.company.optional(),
      category: contactFields.category.optional(),
      phone: contactFields.phone,
      jobTitle: contactFields.jobTitle,
      notes: contactFields.notes,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  ({ contactId, ...changes }) =>
    guarded(async () => {
      if (Object.keys(changes).length === 0) return fail("No fields to update were provided.");
      const updated = await api(`/${encodeURIComponent(contactId)}`, { method: "PUT", body: changes });
      return ok({ message: "Contact updated.", contact: updated });
    }),
);

server.registerTool(
  "delete_contact",
  {
    title: "Delete a contact",
    description:
      "PERMANENTLY delete one contact by contactId. This cannot be undone. If the person only gave a name or email, find the contactId with list_contacts first, and if more than one contact could match or the request is vague, confirm which one with the person before deleting. Returns the contact that was removed.",
    inputSchema: { contactId: z.string().min(1).describe("The contactId of the contact to delete") },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  ({ contactId }) =>
    guarded(async () => {
      const path = `/${encodeURIComponent(contactId)}`;
      // Fetch first so the result says exactly what was removed (and a missing ID fails cleanly).
      const existing = await api(path);
      await api(path, { method: "DELETE" });
      return ok({ message: "Contact deleted.", deleted: existing });
    }),
);

// ── Start ──────────────────────────────────────────────────
await server.connect(new StdioServerTransport());
console.error(`ContactFlow MCP server running (API: ${API})`);
