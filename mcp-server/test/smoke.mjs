// Smoke test: runs the MCP server against an in-memory mock of the ContactFlow
// REST API and exercises every tool through a real MCP client.
// Run with: npm test
import http from "node:http";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CATS = ["Client", "Colleague", "Business Partner", "Vendor", "Other"];
const db = [];

// Mock mirrors backend/routes/contacts.js behaviour (validation, 409 on duplicate email, 404s).
const mock = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const send = (code, body) => {
    res.writeHead(code, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {};
    const p = url.pathname;
    if (req.method === "GET" && p === "/api/contacts/stats")
      return send(200, { totalContacts: db.length, companies: new Set(db.map((c) => c.company)).size, clients: db.filter((c) => c.category === "Client").length, recentlyAdded: db.length });
    if (req.method === "GET" && p === "/api/contacts") {
      const s = (url.searchParams.get("search") || "").toLowerCase();
      const cat = url.searchParams.get("category");
      return send(200, db.filter((c) => (!s || [c.name, c.email, c.company].some((v) => v.toLowerCase().includes(s))) && (!cat || c.category === cat)).reverse());
    }
    const m = p.match(/^\/api\/contacts\/(.+)$/);
    if (req.method === "GET" && m) {
      const c = db.find((x) => x.contactId === m[1]);
      return c ? send(200, c) : send(404, { error: "Contact not found" });
    }
    if (req.method === "POST" && p === "/api/contacts") {
      if (!body.name || !body.email || !body.company || !CATS.includes(body.category))
        return send(400, { error: "Validation failed." });
      if (db.some((c) => c.email === body.email.toLowerCase()))
        return send(409, { error: "A contact with this ID or email already exists." });
      const c = { contactId: "CT-" + (db.length + 1), ...body, email: body.email.toLowerCase() };
      db.push(c);
      return send(201, c);
    }
    if (req.method === "PUT" && m) {
      const c = db.find((x) => x.contactId === m[1]);
      if (!c) return send(404, { error: "Contact not found" });
      Object.assign(c, body);
      return send(200, c);
    }
    send(404, { error: "API route not found" });
  });
});
await new Promise((r) => mock.listen(0, r));
const apiUrl = `http://127.0.0.1:${mock.address().port}/api/contacts`;

const client = new Client({ name: "smoke-test", version: "0.0.0" });
await client.connect(
  new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../server.js", import.meta.url))],
    env: { ...process.env, CONTACTFLOW_API_URL: apiUrl },
    stderr: "ignore",
  }),
);

const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args });
  const text = r.content[0].text;
  let json;
  try { json = JSON.parse(text); } catch { json = text; }
  return { isError: !!r.isError, json, text };
};

try {
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["add_contact", "add_contacts_bulk", "get_contact", "get_stats", "list_contacts", "update_contact"]);

  let r = await call("add_contact", { name: "Asha Rao", email: "Asha@Example.com", company: "Acme", category: "Client", jobTitle: "CTO" });
  assert.ok(!r.isError); assert.equal(r.json.contact.email, "asha@example.com");
  const id = r.json.contact.contactId;

  r = await call("add_contact", { name: "Dup", email: "asha@example.com", company: "Acme", category: "Client" });
  assert.ok(r.isError); assert.match(r.text, /already exists/);

  r = await call("add_contact", { name: "Bad", email: "b@x.com", company: "X", category: "Friend" });
  assert.ok(r.isError); // rejected by tool schema before reaching the API

  r = await call("add_contacts_bulk", { contacts: [
    { name: "Ravi", email: "ravi@vend.com", company: "VendCo", category: "Vendor" },
    { name: "Asha again", email: "asha@example.com", company: "Acme", category: "Client" },
    { name: "Meera", email: "meera@acme.com", company: "Acme", category: "Colleague", phone: "+91 98765 43210" },
  ] });
  assert.ok(!r.isError); assert.equal(r.json.added, 2); assert.equal(r.json.failed, 1); assert.equal(r.json.failures[0].index, 1);

  r = await call("list_contacts", { search: "acme" });
  assert.equal(r.json.total, 2);
  r = await call("list_contacts", { category: "Vendor" });
  assert.equal(r.json.total, 1);

  r = await call("update_contact", { contactId: id, phone: "12345" });
  assert.equal(r.json.contact.phone, "12345");
  r = await call("update_contact", { contactId: id });
  assert.ok(r.isError);
  r = await call("get_contact", { contactId: "nope" });
  assert.ok(r.isError); assert.match(r.text, /not found/i);

  r = await call("get_stats");
  assert.equal(r.json.totalContacts, 3);

  console.log("All MCP tool checks passed (6 tools).");
} finally {
  await client.close();
  mock.close();
}
