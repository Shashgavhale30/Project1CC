// Safe MongoDB URI handling test.
//
// Runs the REAL backend/server.js in a child process, but only ever with fake
// URIs, so production is never contacted:
//   - malformed URIs make the backend exit before any connection attempt;
//   - the one well-formed URI points at a host under the reserved .invalid TLD,
//     which can never resolve, so the connection fails at DNS.
// The child environment overrides MONGODB_URI explicitly (dotenv never
// overrides variables that are already set), so a local backend/.env with a
// real URI is not used. Nothing here reads or prints a real credential.
import { spawn } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const backendDir = fileURLToPath(new URL("../../backend/", import.meta.url));
const backendServer = path.join(backendDir, "server.js");

function runBackend(uri, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const env = {
      ...process.env,
      MONGODB_URI: uri,
      MONGODB_DB_NAME: "",
      FRONTEND_URL: "",
      GEMINI_API_KEY: "",
      NODE_ENV: "test",
      PORT: "0",
    };
    const child = spawn(process.execPath, [backendServer], {
      cwd: backendDir,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out });
    });
  });
}

export async function runMongoUriTests() {
  if (!fs.existsSync(path.join(backendDir, "node_modules", "mongoose"))) {
    console.log("SKIP: backend dependencies are not installed (run npm install in backend/); MongoDB URI tests not run");
    return;
  }

  // 1. Missing / empty URI
  let r = await runBackend("");
  assert.equal(r.code, 1, "empty URI must stop the backend");
  assert.match(r.out, /MONGODB_URI is not set/);
  console.log("PASS: missing MONGODB_URI is detected (backend exits 1 with a clear message)");

  // 2. Wrong scheme
  r = await runBackend("http://example.invalid/contactflow");
  assert.equal(r.code, 1);
  assert.match(r.out, /must start with mongodb:\/\/ or mongodb\+srv:\/\//);
  console.log("PASS: wrong scheme is rejected with a clear message");

  // 3. Unencoded "@" inside the password
  r = await runBackend("mongodb+srv://demo:p@ss@cluster0.example.invalid/contactflow");
  assert.equal(r.code, 1);
  assert.match(r.out, /unencoded '@'/);
  assert.ok(!r.out.includes("p@ss"), "the password must never be printed");
  console.log("PASS: unencoded @ in the password is detected and the password is not printed");

  // 4. Copy/paste mistakes (outer spaces, wrapping quotes) are tolerated: the URI
  //    passes validation, then the connection fails at DNS because the host can
  //    never resolve (.invalid is reserved).
  const secret = "SecretPass123";
  r = await runBackend(`  "mongodb+srv://demo:${secret}@cluster0.example.invalid/demo"  `);
  assert.equal(r.code, 1, `backend should exit 1 after the failed connection\n${r.out}`);
  assert.ok(!/is not set|must start with|unencoded/.test(r.out), "a quoted, padded URI must pass validation");
  assert.match(r.out, /MongoDB connection failed/);
  if (/ENOTFOUND|querySrv/.test(r.out)) assert.match(r.out, /Hint: Check the cluster hostname/);
  assert.ok(!r.out.includes(secret), "the password must never be printed");
  console.log("PASS: padded/quoted URI is tolerated, the failed connection gets a hint and no credentials are printed");
}
