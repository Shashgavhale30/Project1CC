import http from "node:http";
import path from "node:path";
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

// Throwaway fixtures, all created in (and removed from) the current directory.
// PROJECT_ROOT is the current directory for this test, so the server can only
// touch these files. Real project files are never used as delete targets.
const tempFile = ".mcp-smoke-temp.txt";
const deleteFile = ".mcp-smoke-delete.txt";
const decoyEnv = ".env.mcp-smoke"; // protected: must never be listed or deleted
const fixtureDir = ".mcp-smoke-dir";
const fixtureInner = path.join(fixtureDir, "inner.txt");
const badJs = ".mcp-smoke-bad.js";
const fixtures = [tempFile, deleteFile, decoyEnv, badJs];

const serverPath = fileURLToPath(new URL("../server.js", import.meta.url));
const client = new Client({ name: "contactflow-smoke", version: "1.0.0" });

try {
  await fs.writeFile(tempFile, "before", "utf8");

  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [serverPath],
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
    "delete_project_file",
    "edit_project_file",
    "get_contacts",
    "git_add",
    "git_commit",
    "git_fetch",
    "git_inspect",
    "git_push",
    "git_review",
    "git_set_origin",
    "git_status",
    "git_unstage",
    "list_project_files",
    "read_project_file",
    "run_approved_command",
    "scan_for_secrets",
    "update_contact"
  ].sort());
  assert.ok(!names.includes("git_commit_and_push"), "git_commit_and_push must be gone");
  console.log(`PASS: all ${names.length} MCP tools are discoverable (git_commit_and_push removed)`);

  const callRaw = (name, args = {}) => client.callTool({ name, arguments: args });
  const call = async (name, args = {}) => {
    const result = await callRaw(name, args);
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
    return result.content[0].text;
  };
  const refused = async (name, args, pattern) => {
    const result = await callRaw(name, args);
    assert.equal(result.isError, true, `${name} should be refused: ${JSON.stringify(args)}`);
    const message = result.content[0].text;
    if (pattern) assert.match(message, pattern, `${name} ${JSON.stringify(args)}`);
    return message;
  };
  const exists = async (p) => fs.lstat(p).then(() => true, () => false);

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

  // git_add must refuse blocked paths and the project root (nothing is staged here)
  for (const bad of [".env", ".git/config", "."]) {
    const result = await client.callTool({ name: "git_add", arguments: { paths: [bad] } });
    assert.equal(result.isError, true, `git_add should reject "${bad}"`);
  }
  console.log("PASS: git_add rejects blocked paths and project root");

  // ---- list_project_files -------------------------------------------------
  await fs.writeFile(decoyEnv, "SMOKE_DECOY=1", "utf8");
  await fs.mkdir(fixtureDir, { recursive: true });
  await fs.writeFile(fixtureInner, "inner", "utf8");

  const listing = await call("list_project_files");
  assert.match(listing, /server\.js/);
  assert.match(listing, /package\.json/);
  assert.match(listing, /test\//);
  const entryLines = listing.split("\n").filter(l => !l.includes("protected entr"));
  assert.ok(!entryLines.some(l => l.startsWith(".env")), "listing must hide .env* files");
  assert.ok(!entryLines.some(l => /^(\.git|node_modules)\//.test(l)), "listing must hide .git and node_modules");
  assert.match(await call("list_project_files", { directory: "test" }), /test\/smoke\.mjs/);
  assert.match(
    await call("list_project_files", { directory: fixtureDir }),
    new RegExp(`${fixtureDir}/inner\\.txt`)
  );
  const fsRoot = path.parse(process.cwd()).root;
  for (const dir of ["..", "../..", ".git", "node_modules", decoyEnv, fsRoot, "nope-does-not-exist"]) {
    await refused("list_project_files", { directory: dir });
  }
  console.log("PASS: list_project_files lists the project, hides protected entries, rejects unsafe paths");

  // ---- delete_project_file ------------------------------------------------
  await fs.writeFile(deleteFile, "12345", "utf8");
  await refused("delete_project_file", { filePath: deleteFile }, /confirm/);
  await refused("delete_project_file", { filePath: deleteFile, confirm: false }, /confirm/);
  await refused("delete_project_file", { filePath: deleteFile, confirm: "true" }, /confirm/);
  assert.ok(await exists(deleteFile), "unconfirmed deletion must not delete");
  console.log("PASS: delete_project_file refuses without confirm === true");

  const unsafeDeletes = [
    [decoyEnv, /blocked/],
    [".mcp.json", /blocked/],
    [".git/config", /blocked/],
    ["node_modules/.mcp-smoke-nope.txt", /blocked/],
    ["../outside.txt", /outside/],
    ["backend/../../outside.txt", /outside/],
    [path.join(fsRoot, "mcp-smoke-outside.txt"), /outside/],
    [".", /project root/],
    [fixtureDir, /directory/],
    ["mcp-smoke-missing.txt", /not found/i]
  ];
  for (const [filePath, pattern] of unsafeDeletes) {
    await refused("delete_project_file", { filePath, confirm: true }, pattern);
  }
  assert.ok(await exists(decoyEnv), "protected decoy must survive");
  assert.ok(await exists(fixtureInner), "directory contents must survive");
  // The MCP server's own files can never be deleted through the tool
  for (const core of ["server.js", "git-helpers.js", "package.json"]) {
    await refused("delete_project_file", { filePath: core, confirm: true }, /core MCP server file/);
    assert.ok(await exists(core), `${core} must survive`);
  }
  console.log("PASS: delete_project_file rejects protected paths, traversal, directories and missing files");

  const deleted = await call("delete_project_file", { filePath: deleteFile, confirm: true });
  assert.match(deleted, /Deleted file: \.mcp-smoke-delete\.txt \(5 bytes\)/);
  assert.equal(await exists(deleteFile), false);
  await refused("delete_project_file", { filePath: deleteFile, confirm: true }, /not found/i);
  console.log("PASS: confirmed delete removes exactly the requested file and reports it");

  // ---- run_approved_command ----------------------------------------------
  for (const command of [
    "git push",
    "git status --short && echo hi",
    "git status",
    "git log",
    "git remote -v",
    "git diff --cached --name-only",
    "npm install",
    "node --version",
    "powershell -c 1",
    ""
  ]) {
    await refused("run_approved_command", { command }, /not allowed/i);
  }
  await refused("run_approved_command", { command: "git status --short", file: "package.json" }, /only accepted/);
  console.log("PASS: run_approved_command rejects anything off the allowlist");

  for (const command of ["git status --short", "git diff", "git diff --check"]) {
    const run = JSON.parse(await call("run_approved_command", { command }));
    assert.equal(typeof run.exitCode, "number", command);
    assert.equal(typeof run.stdout, "string");
    assert.equal(typeof run.stderr, "string");
    assert.equal(run.timedOut, false);
  }
  console.log("PASS: git status --short, git diff and git diff --check return exit code and output");

  const checkOk = JSON.parse(await call("run_approved_command", { command: "node --check", file: "server.js" }));
  assert.equal(checkOk.exitCode, 0);
  await fs.writeFile(badJs, "let = ;\n", "utf8");
  const checkBad = JSON.parse(await call("run_approved_command", { command: "node --check", file: badJs }));
  assert.notEqual(checkBad.exitCode, 0);
  assert.match(checkBad.stderr, /SyntaxError/);
  for (const file of [undefined, "", "package.json", "test", decoyEnv, "node_modules/x.js", ".git/config",
    "../server.js", path.join(fsRoot, "x.js"), "mcp-smoke-missing.js", "-e"]) {
    await refused("run_approved_command", { command: "node --check", file });
  }
  console.log("PASS: node --check works on project JS and rejects unsafe or non-JS paths");

  // PROJECT_ROOT is this directory, so there is no <root>/mcp-server here: npm test
  // must refuse instead of recursively running this test again.
  await refused("run_approved_command", { command: "npm test" }, /mcp-server\/package\.json/);
  console.log("PASS: npm test refuses outside <project>/mcp-server (no recursive test run)");

  // ---- git_review / git_commit / git_push --------------------------------
  const review = await call("git_review");
  assert.match(review, /== Status ==/);
  assert.match(review, /Read-only review/);
  console.log("PASS: git_review is read-only");

  // Never call git_commit with a valid message here: it would commit whatever is staged.
  await refused("git_commit", { commitMessage: "" }, /required/);
  // Never call git_push with confirm: true here: it would really push.
  await refused("git_push", {}, /confirm/);
  await refused("git_push", { confirm: false }, /confirm/);
  await refused("git_push", { confirm: "true" }, /confirm/);
  console.log("PASS: git_commit needs a message; git_push refuses unless confirm === true");

  // ---- Git inspection, safe first push, secret gate (throwaway repos) -----
  // These tests spawn their own server against a temp repository and a local
  // bare repository standing in for GitHub; the real repo and remote are never used.
  const { runGitToolTests } = await import("./git-tools.mjs");
  await runGitToolTests({ serverPath });

  // ---- Backend MongoDB URI handling (real backend/server.js, fake URIs only) ----
  // Malformed URIs must be detected before any connection attempt, and no
  // credential may ever be printed. Production is never contacted.
  const { runMongoUriTests } = await import("./mongo-uri.mjs");
  await runMongoUriTests();

  console.log("\nAll smoke checks passed.");
} finally {
  await client.close().catch(() => {});
  for (const f of fixtures) await fs.unlink(f).catch(() => {});
  await fs.rm(fixtureDir, { recursive: true, force: true }).catch(() => {});
  await new Promise(resolve => mock.close(resolve));
}
