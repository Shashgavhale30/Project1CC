import http from "node:http";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const db = [];
let seq = 0;

const mock = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (status, data) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };

  try {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};

    if (url.pathname === "/api/contacts" && req.method === "GET")
      return send(200, db);

    if (url.pathname === "/api/contacts" && req.method === "POST") {
      const contact = { id: String(++seq), ...body };
      db.push(contact);
      return send(201, contact);
    }

    const match = url.pathname.match(/^\/api\/contacts\/(.+)$/);
    if (match) {
      const id = decodeURIComponent(match[1]);
      const index = db.findIndex(c => c.id === id);
      if (index < 0) return send(404, { error: "Contact not found" });

      if (req.method === "PUT") {
        db[index] = { ...db[index], ...body };
        return send(200, db[index]);
      }
      if (req.method === "DELETE") {
        const [deleted] = db.splice(index, 1);
        return send(200, deleted);
      }
    }

    send(404, { error: "Not found" });
  } catch {
    send(400, { error: "Invalid request" });
  }
});

await new Promise(resolve => mock.listen(0, "127.0.0.1", resolve));

const tempFile = ".mcp-smoke-temp.txt";
const client = new Client({ name: "contactflow-smoke", version: "1.0.0" });

try {
  await fs.writeFile(tempFile, "before", "utf8");

  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../server.js", import.meta.url))],
    env: {
      ...process.env,
      CONTACTFLOW_API_URL:
        `http://127.0.0.1:${mock.address().port}/api/contacts`,
      PROJECT_ROOT: process.cwd()
    },
    stderr: "inherit"
  }));

  const tools = (await client.listTools()).tools;
  const names = tools.map(t => t.name).sort();

  assert.deepEqual(names, [
    "add_contact",
    "delete_contact",
    "edit_project_file",
    "get_contacts",
    "git_commit_and_push",
    "git_status",
    "read_project_file",
    "update_contact"
  ].sort());
  console.log("PASS: all 8 MCP tools are discoverable");

  const call = async (name, args = {}) => {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
    return result.content[0].text;
  };

  await call("edit_project_file", {
    filePath: tempFile,
    content: "after"
  });
  assert.equal(await fs.readFile(tempFile, "utf8"), "after");
  assert.equal(await call("read_project_file", {
    filePath: tempFile
  }), "after");
  console.log("PASS: project file read and edit");

  await call("add_contact", {
    name: "Smoke Test",
    email: "smoke@example.test",
    company: "Local Test",
    category: "Other"
  });

  let contacts = JSON.parse(await call("get_contacts"));
  assert.equal(contacts.length, 1);
  assert.equal(contacts[0].name, "Smoke Test");
  console.log("PASS: contact creation and listing");

  await call("update_contact", {
    id: contacts[0].id,
    name: "Updated Smoke Test"
  });
  contacts = JSON.parse(await call("get_contacts"));
  assert.equal(contacts[0].name, "Updated Smoke Test");
  console.log("PASS: contact update");

  await call("delete_contact", { id: contacts[0].id });
  contacts = JSON.parse(await call("get_contacts"));
  assert.equal(contacts.length, 0);
  console.log("PASS: contact deletion against local mock");

  await call("git_status");
  console.log("PASS: Git status tool");

  console.log("\nAll smoke checks passed.");
} finally {
  await client.close().catch(() => {});
  await fs.unlink(tempFile).catch(() => {});
  await new Promise(resolve => mock.close(resolve));
}
