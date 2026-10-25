import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";
import { fileURLToPath } from "url";
import {
  redactUrl,
  normalizeRemote,
  parseExpectedRemotes,
  isSafeBranchName,
  parseAheadBehind,
  scanDiff,
  scanFileText,
} from "./git-helpers.js";

const execFileAsync = promisify(execFile);

const API_URL =
  process.env.CONTACTFLOW_API_URL ||
  "https://project1cc-backend.onrender.com/api/contacts";
const API_TOKEN = process.env.CONTACTFLOW_API_TOKEN || "";
const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || "D:\\Project1CC");

// The only GitHub repositories git_push / git_fetch / git_set_origin will talk
// to. Comma-separated list in CONTACTFLOW_EXPECTED_REMOTES; the first entry is
// the one git_set_origin configures. Anything else is refused, never guessed.
const DEFAULT_EXPECTED_REMOTE = "https://github.com/Shashgavhale30/CCProject1.git";
const EXPECTED_REMOTES = parseExpectedRemotes(
  process.env.CONTACTFLOW_EXPECTED_REMOTES ||
    process.env.CONTACTFLOW_EXPECTED_REMOTE ||
    DEFAULT_EXPECTED_REMOTE
);
const EXPECTED_NORMALIZED = EXPECTED_REMOTES.map(normalizeRemote).filter(Boolean);

// Files/folders the AI must never write to
const BLOCKED = [".git", "node_modules", ".env", ".mcp.json"];

// Extra names treated as sensitive: hidden from listings, never deletable,
// never committable. Matched against every path segment (case-insensitive).
const SENSITIVE_NAME_PATTERNS = [
  /^\.env/i,
  /^\.mcp\.json$/i,
  /^\.git$/i,
  /^node_modules$/i,
  /^\.npmrc$/i,
  /^\.pypirc$/i,
  /^\.netrc$/i,
  /^\.ssh$/i,
  /^\.aws$/i,
  /^id_(rsa|dsa|ecdsa|ed25519)/i,
  /\.(pem|key|pfx|p12|keystore|jks)$/i,
  /^credentials/i,
  /^secrets?(\.|$)/i,
];
const isSensitiveName = (name) => SENSITIVE_NAME_PATTERNS.some((re) => re.test(name));
const isSensitiveRel = (rel) => rel.split(/[\\/]/).filter(Boolean).some(isSensitiveName);

// The MCP server's own files can never be deleted through delete_project_file
const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const DELETE_PROTECTED = new Set(
  ["server.js", "git-helpers.js", "package.json", "package-lock.json"].map((n) =>
    path.join(SERVER_DIR, n).toLowerCase()
  )
);

// Limits for listings and approved commands
const LIST_MAX_ENTRIES = 500;
const LIST_MAX_DEPTH = 5;
const CMD_TIMEOUT_MS = 30_000;
const NPM_TEST_TIMEOUT_MS = 120_000;
const PUSH_TIMEOUT_MS = 120_000;
const REMOTE_QUERY_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 200_000;
const SCAN_MAX_BYTES = 5_000_000;
const SCAN_MAX_UNTRACKED_FILES = 200;
const SCAN_MAX_FILE_BYTES = 200_000;

const APPROVED_COMMANDS = [
  "git status --short",
  "git diff",
  "git diff --check",
  "git diff --stat",
  "git diff --cached",
  "git diff --cached --check",
  "node --check",
  "npm test",
];

const api = axios.create({
  timeout: 60000, // Render free tier cold start
  headers: API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {},
});

// Resolve a relative path and make sure it stays inside PROJECT_ROOT.
// `action` only changes the wording of the error message.
function safePath(relPath, action = "Writing to") {
  if (typeof relPath !== "string") throw new Error("Path must be a string");
  if (relPath.includes("\0")) throw new Error("Path contains an invalid character");
  const full = path.resolve(PROJECT_ROOT, relPath);
  const rel = path.relative(PROJECT_ROOT, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path is outside the project directory");
  }
  const parts = rel.split(path.sep).map((p) => p.toLowerCase());
  if (parts.some((p) => BLOCKED.includes(p) || p.startsWith(".env"))) {
    throw new Error(`${action} "${rel}" is blocked`);
  }
  return full;
}

// Defence against symlinks/junctions: the real location of a directory must
// still be inside the real project root.
async function assertRealInside(dir) {
  let realRoot;
  let realDir;
  try {
    [realRoot, realDir] = await Promise.all([fs.realpath(PROJECT_ROOT), fs.realpath(dir)]);
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("Path not found inside the project");
    throw e;
  }
  const rel = path.relative(realRoot, realDir);
  if (rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    throw new Error("Path resolves outside the project directory");
  }
}

const toPosix = (p) => p.split(path.sep).join("/");

async function git(...gitArgs) {
  return execFileAsync("git", gitArgs, { cwd: PROJECT_ROOT, windowsHide: true });
}

// ---------------------------------------------------------------------------
// Controlled process runner: no shell, fixed cwd, timeout, output cap.
// ---------------------------------------------------------------------------
const redactSecrets = (s) => s.replace(/:\/\/[^\s/@]+@/g, "://***@");

function childEnv() {
  const env = { ...process.env };
  delete env.CONTACTFLOW_API_TOKEN; // never hand the API token to child processes
  delete env.GIT_EXTERNAL_DIFF; // never run an external diff program
  env.GIT_TERMINAL_PROMPT = "0"; // fail instead of hanging on a credential prompt
  env.GIT_PAGER = "cat";
  return env;
}

function runCommand(
  file,
  args,
  { cwd = PROJECT_ROOT, timeoutMs = CMD_TIMEOUT_MS, maxBytes = MAX_OUTPUT_BYTES } = {}
) {
  return new Promise((resolve) => {
    const chunks = { stdout: [], stderr: [] };
    const size = { stdout: 0, stderr: 0 };
    let truncated = false;
    let timedOut = false;
    let settled = false;
    let child;

    const timer = setTimeout(() => {
      timedOut = true;
      child?.kill("SIGKILL");
    }, timeoutMs);

    const finish = (extra) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        stdout: redactSecrets(Buffer.concat(chunks.stdout).toString("utf8")),
        stderr: redactSecrets(Buffer.concat(chunks.stderr).toString("utf8")),
        truncated,
        timedOut,
        ...extra,
      });
    };

    const collect = (key) => (chunk) => {
      const room = maxBytes - size[key];
      if (room <= 0) {
        truncated = true;
        return;
      }
      if (chunk.length > room) {
        chunks[key].push(chunk.subarray(0, room));
        size[key] += room;
        truncated = true;
      } else {
        chunks[key].push(chunk);
        size[key] += chunk.length;
      }
    };

    try {
      child = spawn(file, args, {
        cwd,
        env: childEnv(),
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      finish({ exitCode: null, signal: null, spawnError: err.message });
      return;
    }
    child.stdout.on("data", collect("stdout"));
    child.stderr.on("data", collect("stderr"));
    child.on("error", (err) => finish({ exitCode: null, signal: null, spawnError: err.message }));
    child.on("close", (code, signal) => finish({ exitCode: code, signal }));
  });
}

// git via the controlled runner. fsmonitor is disabled so repo config cannot
// make a read-only command launch a helper program.
const gitArgs = (...a) => ["-c", "core.fsmonitor=false", ...a];
const runGit = (a, opts = {}) => runCommand("git", gitArgs(...a), opts);
const trimOut = (r) => (r.stdout || "").trim();
const firstLine = (s) => String(s || "").trim().split(/\r?\n/)[0] || "";

// Pathspecs that keep secret files out of diffs
const DIFF_PATHSPEC = [
  "--",
  ".",
  ":(exclude,glob)**/.env*",
  ":(exclude,glob)**/.mcp.json",
];

// Locate npm without a shell (npm.cmd cannot be spawned directly on Windows)
async function npmInvocation() {
  const candidates = [];
  if (process.env.npm_execpath && /npm-cli\.js$/i.test(process.env.npm_execpath)) {
    candidates.push(process.env.npm_execpath);
  }
  const nodeDir = path.dirname(process.execPath);
  candidates.push(path.join(nodeDir, "node_modules", "npm", "bin", "npm-cli.js"));
  candidates.push(path.join(nodeDir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"));
  for (const c of candidates) {
    try {
      await fs.access(c);
      return { file: process.execPath, args: [c] };
    } catch {
      /* try next */
    }
  }
  if (process.platform !== "win32") return { file: "npm", args: [] };
  throw new Error("Could not locate npm-cli.js next to node.exe");
}

const text = (t) => ({ content: [{ type: "text", text: t }] });

function formatRun(label, cwdRel, r) {
  return JSON.stringify(
    {
      command: label,
      cwd: cwdRel,
      exitCode: r.exitCode,
      signal: r.signal ?? null,
      timedOut: r.timedOut,
      outputTruncated: r.truncated,
      ...(r.spawnError ? { spawnError: r.spawnError } : {}),
      stdout: r.stdout,
      stderr: r.stderr,
    },
    null,
    2
  );
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------
async function listProjectFiles(args) {
  const directory =
    typeof args.directory === "string" && args.directory.trim() ? args.directory.trim() : ".";
  const recursive = args.recursive === true;
  const depthArg = Number.isInteger(args.maxDepth) ? args.maxDepth : 3;
  const maxDepth = Math.min(Math.max(depthArg, 1), LIST_MAX_DEPTH);

  const full = safePath(directory, "Listing");
  const startRel = path.relative(PROJECT_ROOT, full);
  if (startRel && isSensitiveRel(startRel)) {
    throw new Error(`Listing "${toPosix(startRel)}" is blocked`);
  }
  let st;
  try {
    st = await fs.lstat(full);
  } catch (e) {
    if (e.code === "ENOENT") throw new Error(`Directory not found: ${toPosix(startRel) || "."}`);
    throw e;
  }
  if (!st.isDirectory()) throw new Error(`"${toPosix(startRel)}" is not a directory`);
  await assertRealInside(full);

  const entries = [];
  let hidden = 0;
  let truncated = false;

  async function walk(dir, depth) {
    const items = await fs.readdir(dir, { withFileTypes: true });
    items.sort(
      (a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name)
    );
    for (const item of items) {
      if (isSensitiveName(item.name)) {
        hidden++;
        continue;
      }
      if (entries.length >= LIST_MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const abs = path.join(dir, item.name);
      const rel = toPosix(path.relative(PROJECT_ROOT, abs));
      if (item.isDirectory()) {
        entries.push(`${rel}/`);
        if (recursive && depth < maxDepth) await walk(abs, depth + 1);
      } else if (item.isFile()) {
        const { size } = await fs.stat(abs);
        entries.push(`${rel} (${size} bytes)`);
      } else if (item.isSymbolicLink()) {
        entries.push(`${rel} (symlink, not followed)`);
      } else {
        entries.push(`${rel} (other)`);
      }
    }
  }

  await walk(full, 1);

  const header = `Directory: ${toPosix(startRel) || "."}${recursive ? ` (recursive, max depth ${maxDepth})` : ""}`;
  const notes = [];
  if (hidden) notes.push(`${hidden} protected entr${hidden === 1 ? "y" : "ies"} hidden (.git, node_modules, .env*, .mcp.json, keys, credentials).`);
  if (truncated) notes.push(`Listing truncated at ${LIST_MAX_ENTRIES} entries; list a subdirectory for more.`);
  return text([header, ...(entries.length ? entries : ["(empty)"]), ...notes].join("\n"));
}

async function deleteProjectFile(args) {
  if (args.confirm !== true) {
    throw new Error(
      'Deletion refused: "confirm" must be boolean true. Show the user the exact path and wait for their approval first. Nothing was deleted.'
    );
  }
  if (typeof args.filePath !== "string" || !args.filePath.trim()) {
    throw new Error("filePath is required");
  }
  const full = safePath(args.filePath, "Deleting");
  const rel = path.relative(PROJECT_ROOT, full);
  if (!rel) throw new Error("Refusing to delete the project root");
  const relPosix = toPosix(rel);
  if (isSensitiveRel(rel)) throw new Error(`Deleting "${relPosix}" is blocked (protected path)`);
  if (DELETE_PROTECTED.has(full.toLowerCase())) {
    throw new Error(`Deleting "${relPosix}" is blocked (core MCP server file)`);
  }
  await assertRealInside(path.dirname(full));

  let st;
  try {
    st = await fs.lstat(full);
  } catch (e) {
    if (e.code === "ENOENT") throw new Error(`File not found: ${relPosix}`);
    throw e;
  }
  if (st.isDirectory()) throw new Error(`"${relPosix}" is a directory; only files can be deleted`);
  if (!st.isFile()) {
    throw new Error(`"${relPosix}" is not a regular file (symlink or special file); refusing`);
  }

  await fs.unlink(full);
  const stillThere = await fs.lstat(full).then(() => true, () => false);
  if (stillThere) throw new Error(`Delete reported success but "${relPosix}" still exists`);
  return text(
    `Deleted file: ${relPosix} (${st.size} bytes). Verified it no longer exists. ` +
      "No directories, database records or Git state were touched; nothing was staged, committed or pushed."
  );
}

async function runApprovedCommand(args) {
  const command =
    typeof args.command === "string" ? args.command.trim().replace(/\s+/g, " ") : "";
  if (!APPROVED_COMMANDS.includes(command)) {
    throw new Error(`Command not allowed. Approved commands: ${APPROVED_COMMANDS.join(" | ")}`);
  }
  const hasFile = args.file !== undefined && args.file !== null && args.file !== "";
  if (hasFile && command !== "node --check") {
    throw new Error('"file" is only accepted with "node --check"');
  }

  if (command === "git status --short") {
    const r = await runGit(["status", "--short"]);
    return text(formatRun(command, ".", r));
  }

  if (command === "git diff") {
    const r = await runGit(["diff", "--no-color", "--no-ext-diff", "--no-textconv", ...DIFF_PATHSPEC]);
    return text(formatRun(command, ".", r));
  }

  if (command === "git diff --check") {
    const r = await runGit(["diff", "--check", "--no-ext-diff", "--no-textconv", ...DIFF_PATHSPEC]);
    return text(formatRun(command, ".", r));
  }

  if (command === "git diff --stat") {
    const r = await runGit(["diff", "--stat", "--no-color", "--no-ext-diff", "--no-textconv", ...DIFF_PATHSPEC]);
    return text(formatRun(command, ".", r));
  }

  if (command === "git diff --cached") {
    const r = await runGit(["diff", "--cached", "--no-color", "--no-ext-diff", "--no-textconv", ...DIFF_PATHSPEC]);
    return text(formatRun(command, ".", r));
  }

  if (command === "git diff --cached --check") {
    const r = await runGit(["diff", "--cached", "--check", "--no-ext-diff", "--no-textconv", ...DIFF_PATHSPEC]);
    return text(formatRun(command, ".", r));
  }

  if (command === "node --check") {
    if (typeof args.file !== "string" || !args.file.trim()) {
      throw new Error('"file" (project-relative path) is required for node --check');
    }
    const full = safePath(args.file, "Checking");
    const rel = path.relative(PROJECT_ROOT, full);
    if (!rel || isSensitiveRel(rel)) throw new Error(`Checking "${toPosix(rel)}" is blocked`);
    if (!/\.(js|mjs|cjs)$/i.test(rel)) {
      throw new Error("node --check is limited to .js, .mjs and .cjs files");
    }
    await assertRealInside(path.dirname(full));
    const st = await fs.lstat(full).catch(() => null);
    if (!st || !st.isFile()) throw new Error(`Not a regular file: ${toPosix(rel)}`);
    const r = await runCommand(process.execPath, ["--check", full]);
    return text(formatRun(`node --check ${toPosix(rel)}`, ".", r));
  }

  // npm test: only from <project>/mcp-server, and only the exact known test script
  const mcpDir = path.join(PROJECT_ROOT, "mcp-server");
  let pkg;
  try {
    pkg = JSON.parse(await fs.readFile(path.join(mcpDir, "package.json"), "utf8"));
  } catch {
    throw new Error("npm test needs mcp-server/package.json under the project root");
  }
  const scripts = pkg?.scripts || {};
  if (scripts.test !== "node test/smoke.mjs" || scripts.pretest || scripts.posttest) {
    throw new Error(
      'Refusing npm test: mcp-server/package.json must have scripts.test exactly "node test/smoke.mjs" and no pretest/posttest'
    );
  }
  const npm = await npmInvocation();
  const r = await runCommand(npm.file, [...npm.args, "test"], {
    cwd: mcpDir,
    timeoutMs: NPM_TEST_TIMEOUT_MS,
  });
  return text(formatRun("npm test", "mcp-server", r));
}

async function gitReview() {
  const sections = [];
  const add = (title, r, empty = "(none)") => {
    const body = (r.stdout || "").trim();
    sections.push(`== ${title} ==\n${body || (r.exitCode === 0 ? empty : (r.stderr || "").trim() || empty)}`);
  };
  add("Status", await runGit(["status", "--short", "--branch"]));
  add("Staged files (what git_commit would commit)", await runGit(["diff", "--cached", "--name-status", "--no-ext-diff", "--no-textconv"]));
  add("Unstaged changes (not committed unless staged)", await runGit(["diff", "--stat", "--no-ext-diff", "--no-textconv"]));
  const ahead = await runGit(["log", "--oneline", "@{upstream}..HEAD"]);
  if (ahead.exitCode === 0) add("Commits not yet pushed", ahead);
  else sections.push("== Commits not yet pushed ==\n(no upstream branch configured)");
  add("HEAD", await runGit(["log", "-1", "--format=%H %s"]));
  sections.push("Read-only review. Nothing was staged, committed or pushed.");
  return text(sections.join("\n\n"));
}

// ---------------------------------------------------------------------------
// Git remote inspection and safe remote operations
// ---------------------------------------------------------------------------
async function currentBranch() {
  const r = await runGit(["symbolic-ref", "--short", "-q", "HEAD"]);
  return r.exitCode === 0 ? trimOut(r) || null : null;
}

// Raw (unredacted) remote URLs; only ever compared internally. Output goes
// through redactUrl() before it reaches the user.
async function readRemotes() {
  const list = await runGit(["remote"]);
  if (list.exitCode !== 0) return [];
  const names = list.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const name of names) {
    const f = await runGit(["remote", "get-url", name]);
    const p = await runGit(["remote", "get-url", "--push", name]);
    out.push({
      name,
      fetchUrl: f.exitCode === 0 ? trimOut(f) : null,
      pushUrl: p.exitCode === 0 ? trimOut(p) : null,
    });
  }
  return out;
}

const remoteMatchesExpected = (url) => {
  const n = normalizeRemote(url);
  return !!n && EXPECTED_NORMALIZED.includes(n);
};
const originMatchesExpected = (origin) =>
  !!origin && remoteMatchesExpected(origin.fetchUrl) && remoteMatchesExpected(origin.pushUrl);

const describeExpected = () => EXPECTED_REMOTES.map(redactUrl).join(" or ") || "(none configured)";

async function requireExpectedOrigin(action) {
  const remotes = await readRemotes();
  const origin = remotes.find((r) => r.name === "origin");
  if (!origin) {
    throw new Error(
      `${action} refused: no remote named "origin" is configured. Use git_set_origin (confirm=true) to add the expected remote (${describeExpected()}). Nothing was changed.`
    );
  }
  const bad = [];
  if (!remoteMatchesExpected(origin.fetchUrl)) bad.push(`fetch URL ${redactUrl(origin.fetchUrl)}`);
  if (!remoteMatchesExpected(origin.pushUrl)) bad.push(`push URL ${redactUrl(origin.pushUrl)}`);
  if (bad.length) {
    throw new Error(
      `${action} refused: origin does not match the expected repository (${describeExpected()}). Found ${bad.join(" and ")}. Use git_set_origin (confirm=true) to correct it, or set CONTACTFLOW_EXPECTED_REMOTES if a different repository is intended. Nothing was changed.`
    );
  }
  return origin;
}

async function relationTo(remoteHash, headHash) {
  if (remoteHash === headHash) return "up-to-date";
  const known = await runGit(["cat-file", "-e", remoteHash + "^{commit}"]);
  if (known.exitCode !== 0) {
    return "remote-has-commits-not-in-local-history (run git_fetch; a push would be rejected until histories are reconciled)";
  }
  const ff = await runGit(["merge-base", "--is-ancestor", remoteHash, headHash]);
  if (ff.exitCode === 0) return "fast-forward (a push will update the remote)";
  const behind = await runGit(["merge-base", "--is-ancestor", headHash, remoteHash]);
  if (behind.exitCode === 0) return "remote-is-ahead (nothing to push; incorporate the remote commits first)";
  return "diverged (merge or rebase needed; a push would be rejected)";
}

async function gitInspect(args) {
  const checkRemote = args?.checkRemote === true;
  const notes = [];

  const branch = await currentBranch();
  if (!branch) notes.push("No branch is checked out (detached HEAD) or this is not a repository.");

  let head = null;
  const headRes = await runGit(["log", "-1", "--format=%H%x09%s"]);
  if (headRes.exitCode === 0 && trimOut(headRes)) {
    const [hash, ...rest] = trimOut(headRes).split("\t");
    head = { hash, subject: rest.join("\t") };
  } else {
    notes.push("This repository has no commits yet.");
  }

  const remotes = await readRemotes();
  const origin = remotes.find((r) => r.name === "origin") || null;
  const matches = origin ? originMatchesExpected(origin) : null;
  if (!origin) {
    notes.push(`No "origin" remote is configured. git_set_origin can add the expected one (${describeExpected()}).`);
  } else if (!matches) {
    notes.push("origin does not match the expected repository, so git_push and git_fetch will refuse. git_set_origin can correct it.");
  }

  let upstream = null;
  let ahead = null;
  let behind = null;
  const up = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  if (up.exitCode === 0) {
    upstream = trimOut(up);
    const counts = await runGit(["rev-list", "--left-right", "--count", "HEAD...@{upstream}"]);
    if (counts.exitCode === 0) ({ ahead, behind } = parseAheadBehind(trimOut(counts)));
    notes.push("ahead/behind is relative to the last fetch; use git_fetch or checkRemote=true for fresh data.");
  } else if (branch && head) {
    notes.push(`Branch "${branch}" has no upstream; the first git_push will set it to origin/${branch}.`);
  }

  const wt = { staged: 0, unstaged: 0, untracked: 0 };
  const st = await runGit(["status", "--porcelain=v1"]);
  for (const line of st.stdout.split(/\r?\n/)) {
    if (line.length < 3) continue;
    const x = line[0];
    const y = line[1];
    if (x === "?" && y === "?") wt.untracked++;
    else {
      if (x !== " " && x !== "?") wt.staged++;
      if (y !== " " && y !== "?") wt.unstaged++;
    }
  }

  let remoteBranch = { checked: false };
  if (checkRemote) {
    if (!branch || !head) {
      remoteBranch = { checked: false, reason: "No branch or commit to compare." };
    } else if (!origin || !matches) {
      remoteBranch = { checked: false, reason: "origin is missing or not the expected repository; the remote was not contacted." };
    } else {
      const ls = await runGit(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], {
        timeoutMs: REMOTE_QUERY_TIMEOUT_MS,
      });
      if (ls.exitCode !== 0) {
        remoteBranch = { checked: true, error: firstLine(ls.stderr || ls.stdout), timedOut: ls.timedOut };
      } else {
        const line = ls.stdout.split(/\r?\n/).find((l) => l.trim());
        if (!line) {
          remoteBranch = {
            checked: true,
            exists: false,
            relation: "remote-branch-missing (the first git_push will create it)",
          };
        } else {
          const remoteHash = line.split(/\s+/)[0].toLowerCase();
          remoteBranch = {
            checked: true,
            exists: true,
            hash: remoteHash,
            relation: await relationTo(remoteHash, head.hash.toLowerCase()),
          };
        }
      }
    }
  }

  return text(
    JSON.stringify(
      {
        branch,
        head,
        remotes: remotes.map((r) => ({
          name: r.name,
          fetchUrl: redactUrl(r.fetchUrl),
          pushUrl: redactUrl(r.pushUrl),
        })),
        expectedRemotes: EXPECTED_REMOTES.map(redactUrl),
        originMatchesExpected: matches,
        upstream,
        ahead,
        behind,
        remoteBranch,
        workingTree: wt,
        notes,
      },
      null,
      2
    )
  );
}

async function gitFetch() {
  await requireExpectedOrigin("Fetch");
  const r = await runGit(["fetch", "origin"], { timeoutMs: PUSH_TIMEOUT_MS });
  if (r.exitCode !== 0) {
    throw new Error(
      `git fetch failed (exit ${r.exitCode}${r.timedOut ? ", timed out" : ""}): ${(r.stderr || r.stdout).trim()}`
    );
  }
  return text(
    "Fetched origin. Only remote-tracking refs were updated; your branches, commits and working tree were not changed.\n" +
      ((r.stderr + r.stdout).trim() || "Already up to date.")
  );
}

async function gitSetOrigin(args) {
  if (args.confirm !== true) {
    throw new Error(
      'git_set_origin refused: "confirm" must be boolean true, set only after the user approved pointing origin at the expected repository. Nothing was changed.'
    );
  }
  const target = EXPECTED_REMOTES[0];
  if (
    !target ||
    target.startsWith("-") ||
    !normalizeRemote(target) ||
    /^[a-z][a-z0-9+.-]*:\/\/[^/@]*:[^/@]*@/i.test(target)
  ) {
    throw new Error(
      "git_set_origin refused: no usable expected remote is configured (CONTACTFLOW_EXPECTED_REMOTES), or it embeds credentials. Nothing was changed."
    );
  }

  const remotes = await readRemotes();
  const origin = remotes.find((r) => r.name === "origin");
  const before = origin
    ? { fetchUrl: redactUrl(origin.fetchUrl), pushUrl: redactUrl(origin.pushUrl) }
    : null;
  if (origin && originMatchesExpected(origin)) {
    return text(
      JSON.stringify({ changed: false, message: "origin already matches the expected repository.", origin: before }, null, 2)
    );
  }

  let r;
  if (!origin) {
    r = await runGit(["remote", "add", "origin", target]);
  } else {
    r = await runGit(["remote", "set-url", "origin", target]);
    if (r.exitCode === 0) r = await runGit(["remote", "set-url", "--push", "origin", target]);
  }
  if (r.exitCode !== 0) {
    throw new Error(`Could not configure origin (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim()}`);
  }

  const after = (await readRemotes()).find((x) => x.name === "origin");
  if (!originMatchesExpected(after)) {
    throw new Error("origin still does not match the expected repository after the update. Please inspect it with git_inspect.");
  }
  return text(
    JSON.stringify(
      {
        changed: true,
        before,
        after: { fetchUrl: redactUrl(after.fetchUrl), pushUrl: redactUrl(after.pushUrl) },
      },
      null,
      2
    )
  );
}

async function gitUnstage(args) {
  const paths = Array.isArray(args.paths) ? args.paths : [];
  if (!paths.length) {
    throw new Error("paths must be a non-empty array of project-relative file paths.");
  }
  const rels = paths.map((p) => {
    const rel = path.relative(PROJECT_ROOT, safePath(p, "Unstaging"));
    if (!rel) throw new Error("Unstaging the whole project root is not allowed.");
    return rel;
  });
  const r = await runGit(["restore", "--staged", "--", ...rels]);
  if (r.exitCode !== 0) {
    throw new Error(`git restore --staged failed (exit ${r.exitCode}): ${(r.stderr || r.stdout).trim()}`);
  }
  const st = await runGit(["status", "--short"]);
  return text(
    `Unstaged (working-tree files untouched): ${rels.map(toPosix).join(", ")}\n${st.stdout}`
  );
}

// ---------------------------------------------------------------------------
// Secret scanning: reports file, line and rule only, never the matched value.
// ---------------------------------------------------------------------------
async function scanChanges(scope) {
  const findings = [];
  const incomplete = [];
  let filesScanned = 0;

  const scanDiffOutput = async (diffArgs, label) => {
    const r = await runGit(diffArgs, { maxBytes: SCAN_MAX_BYTES, timeoutMs: 60_000 });
    if (r.exitCode !== 0) {
      throw new Error(`Could not read ${label}: ${(r.stderr || r.stdout).trim()}`);
    }
    if (r.truncated) incomplete.push(`${label} (output larger than ${SCAN_MAX_BYTES} bytes)`);
    findings.push(...scanDiff(r.stdout));
  };

  if (scope === "staged" || scope === "all") {
    await scanDiffOutput(
      ["diff", "--cached", "-U0", "--no-color", "--no-ext-diff", "--no-textconv"],
      "staged diff"
    );
    const names = await runGit(["diff", "--cached", "--name-only", "-z"]);
    for (const n of names.stdout.split("\0").filter(Boolean)) {
      filesScanned++;
      if (isSensitiveRel(n)) {
        findings.push({ file: n, line: 0, rule: "sensitive-file-name", severity: "high" });
      }
    }
  }

  if (scope === "working" || scope === "all") {
    await scanDiffOutput(
      ["diff", "-U0", "--no-color", "--no-ext-diff", "--no-textconv"],
      "unstaged diff"
    );
    const ls = await runGit(["ls-files", "--others", "--exclude-standard", "-z"]);
    const files = ls.stdout.split("\0").filter(Boolean);
    for (const rel of files.slice(0, SCAN_MAX_UNTRACKED_FILES)) {
      if (isSensitiveRel(rel)) {
        findings.push({ file: toPosix(rel), line: 0, rule: "sensitive-file-name", severity: "high" });
        continue;
      }
      let full;
      try {
        full = safePath(rel, "Scanning");
      } catch {
        continue;
      }
      const st = await fs.lstat(full).catch(() => null);
      if (!st || !st.isFile()) continue;
      if (st.size > SCAN_MAX_FILE_BYTES) {
        incomplete.push(`${toPosix(rel)} (larger than ${SCAN_MAX_FILE_BYTES} bytes)`);
        continue;
      }
      const buf = await fs.readFile(full);
      if (buf.includes(0)) continue; // binary
      filesScanned++;
      findings.push(...scanFileText(toPosix(rel), buf.toString("utf8")));
    }
    if (files.length > SCAN_MAX_UNTRACKED_FILES) {
      incomplete.push(`${files.length - SCAN_MAX_UNTRACKED_FILES} more untracked files were not scanned`);
    }
  }

  return { findings, incomplete, filesScanned };
}

async function scanForSecrets(args) {
  const scope = args.scope === undefined ? "staged" : args.scope;
  if (!["staged", "working", "all"].includes(scope)) {
    throw new Error('scope must be "staged", "working" or "all".');
  }
  const { findings, incomplete, filesScanned } = await scanChanges(scope);
  const high = findings.filter((f) => f.severity === "high").length;
  return text(
    JSON.stringify(
      {
        scope,
        filesScanned,
        clean: findings.length === 0 && incomplete.length === 0,
        highSeverity: high,
        reviewSeverity: findings.length - high,
        findings,
        incomplete,
        note: "Matched values are never shown. Remove the flagged lines before committing; git_commit refuses while highSeverity > 0.",
      },
      null,
      2
    )
  );
}

async function gitCommit(args) {
  const message = typeof args.commitMessage === "string" ? args.commitMessage.trim() : "";
  if (!message) throw new Error("Commit message is required.");
  if (message.length > 2000) throw new Error("Commit message is too long (max 2000 characters).");

  const stagedRes = await runGit(["diff", "--cached", "--name-only", "-z"]);
  if (stagedRes.exitCode !== 0) {
    throw new Error(`Could not read staged files: ${stagedRes.stderr.trim() || stagedRes.stdout.trim()}`);
  }
  const staged = stagedRes.stdout.split("\0").filter(Boolean);
  if (!staged.length) {
    return text("Nothing staged. Stage specific files with git_add first. Nothing was committed.");
  }
  const protectedFiles = staged.filter(isSensitiveRel);
  if (protectedFiles.length) {
    throw new Error(
      `Refusing to commit: staged files include protected paths (${protectedFiles.join(", ")}). Unstage them first. Nothing was committed.`
    );
  }

  const scan = await scanChanges("staged");
  const high = scan.findings.filter((f) => f.severity === "high");
  if (high.length) {
    const shown = high.slice(0, 10).map((f) => `${f.file}:${f.line} ${f.rule}`).join(", ");
    throw new Error(
      `Refusing to commit: possible secrets in staged changes (${shown}${high.length > 10 ? ", ..." : ""}). Values are not shown. Remove them, restage, and try again. Nothing was committed.`
    );
  }

  const res = await runGit(["commit", `--message=${message}`]);
  if (res.exitCode !== 0) {
    throw new Error(`git commit failed (exit ${res.exitCode}): ${(res.stderr || res.stdout).trim()}`);
  }
  const head = await runGit(["log", "-1", "--format=%h %s"]);
  const warnings = scan.incomplete.length
    ? `\nNote: the secret scan was incomplete for: ${scan.incomplete.join("; ")}`
    : "";
  return text(
    `Committed ${staged.length} staged file(s) locally:\n${staged.join("\n")}\n\nHEAD: ${head.stdout.trim()}${warnings}\n` +
      "Not pushed. Review with git_review, then call git_push with confirm=true only after the user approves."
  );
}

async function gitPush(args) {
  if (args.confirm !== true) {
    throw new Error(
      'Push refused: "confirm" must be boolean true, and only after the user has reviewed git_review output and explicitly approved pushing. Nothing was pushed.'
    );
  }
  let expected = "";
  if (args.expectedHead !== undefined && args.expectedHead !== null && args.expectedHead !== "") {
    if (typeof args.expectedHead !== "string" || !/^[0-9a-f]{7,40}$/i.test(args.expectedHead)) {
      throw new Error('"expectedHead" must be a 7-40 character commit hash. Nothing was pushed.');
    }
    expected = args.expectedHead.toLowerCase();
  }

  const branch = await currentBranch();
  if (!branch) {
    throw new Error("Refusing to push: no current branch (detached HEAD or not a repository). Nothing was pushed.");
  }
  if (!isSafeBranchName(branch)) {
    throw new Error("Refusing to push: the current branch name contains unusual characters. Nothing was pushed.");
  }
  if (typeof args.branch === "string" && args.branch.trim() && args.branch.trim() !== branch) {
    throw new Error(
      `Refusing to push: requested branch "${args.branch.trim()}" is not the checked-out branch "${branch}". Nothing was pushed.`
    );
  }

  const origin = await requireExpectedOrigin("Push");

  const headRes = await runGit(["rev-parse", "--verify", "HEAD"]);
  if (headRes.exitCode !== 0) {
    throw new Error("Refusing to push: the repository has no commits. Nothing was pushed.");
  }
  const head = trimOut(headRes).toLowerCase();
  if (expected && !head.startsWith(expected)) {
    throw new Error(
      `Refusing to push: HEAD is ${head.slice(0, 12)}, not the reviewed commit ${expected}. Nothing was pushed.`
    );
  }

  // Upstream handling: with an upstream it must be origin/<same branch>; without
  // one the first push sets it explicitly.
  const up = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const hasUpstream = up.exitCode === 0;
  if (hasUpstream) {
    const upRemote = trimOut(await runGit(["config", "--get", `branch.${branch}.remote`]));
    const upMerge = trimOut(await runGit(["config", "--get", `branch.${branch}.merge`]));
    if (upRemote !== "origin" || upMerge !== `refs/heads/${branch}`) {
      throw new Error(
        `Refusing to push: "${branch}" tracks ${upRemote || "?"}/${upMerge.replace(/^refs\/heads\//, "") || "?"}, not origin/${branch}. Fix the tracking branch first. Nothing was pushed.`
      );
    }
  }

  const refspec = `HEAD:refs/heads/${branch}`;
  const pushArgs = hasUpstream
    ? ["push", "origin", refspec]
    : ["push", "--set-upstream", "origin", refspec];
  // Defence in depth: a push can never be forced, mirrored, pruned or delete anything.
  if (
    pushArgs.some(
      (a) =>
        /^(--force|--force-with-lease|-f$|--mirror|--delete|--prune|--all|--tags)/.test(a) ||
        a.startsWith("+") ||
        a.includes(":+")
    )
  ) {
    throw new Error("Internal safety check failed: unsafe push arguments. Nothing was pushed.");
  }

  const res = await runGit(pushArgs, { timeoutMs: PUSH_TIMEOUT_MS });
  if (res.exitCode !== 0) {
    throw new Error(
      `git push failed (exit ${res.exitCode}${res.timedOut ? ", timed out" : ""}): ${(res.stderr || res.stdout).trim()}`
    );
  }

  // Verify the outcome instead of trusting the exit code alone.
  const ls = await runGit(["ls-remote", "--heads", "origin", `refs/heads/${branch}`], {
    timeoutMs: REMOTE_QUERY_TIMEOUT_MS,
  });
  const remoteLine = ls.exitCode === 0 ? ls.stdout.split(/\r?\n/).find((l) => l.trim()) || "" : "";
  const remoteHash = remoteLine.split(/\s+/)[0].toLowerCase();
  const upNow = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]);
  const dirty = (await runGit(["status", "--porcelain=v1"])).stdout
    .split(/\r?\n/)
    .filter((l) => l.trim()).length;

  return text(
    JSON.stringify(
      {
        pushed: true,
        branch,
        head,
        remote: redactUrl(origin.pushUrl),
        upstream: upNow.exitCode === 0 ? trimOut(upNow) : null,
        upstreamWasSet: !hasUpstream,
        remoteHeadVerified: remoteHash === head,
        uncommittedChangesNotPushed: dirty,
        output: (res.stdout + res.stderr).trim(),
      },
      null,
      2
    )
  );
}

const server = new Server(
  { name: "project1cc-mcp-server", version: "1.4.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // 1. CONTACTS CRUD
    {
      name: "get_contacts",
      description: "Retrieve all contacts from the backend API.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "add_contact",
      description: "Add a new contact to the backend.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          company: { type: "string" },
          jobTitle: { type: "string" },
          category: {
            type: "string",
            enum: ["Client", "Colleague", "Business Partner", "Vendor", "Other"],
          },
          notes: { type: "string" },
        },
        required: ["name"],
      },
    },
    {
      name: "update_contact",
      description: "Update an existing contact by ID.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
          phone: { type: "string" },
          company: { type: "string" },
          jobTitle: { type: "string" },
          category: {
            type: "string",
            enum: ["Client", "Colleague", "Business Partner", "Vendor", "Other"],
          },
          notes: { type: "string" },
        },
        required: ["id"],
      },
    },
    {
      name: "delete_contact",
      description: "Delete a contact by ID.",
      inputSchema: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },

    // 2. FILE TOOLS
    {
      name: "list_project_files",
      description:
        "List files and folders under the project root (or a project-relative subdirectory). Read-only. Hides .git, node_modules, .env* files, .mcp.json, keys and credentials, and never leaves the project root.",
      inputSchema: {
        type: "object",
        properties: {
          directory: {
            type: "string",
            description: "Optional project-relative directory, e.g. 'backend/routes'. Defaults to the project root.",
          },
          recursive: { type: "boolean", description: "Also list subdirectories (default false)." },
          maxDepth: {
            type: "integer",
            description: `Depth limit when recursive (1-${LIST_MAX_DEPTH}, default 3).`,
          },
        },
      },
    },
    {
      name: "read_project_file",
      description:
        "Read a file in the Project1CC directory. Always read a file before editing it.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Relative path from project root, e.g. 'backend/server.js'",
          },
        },
        required: ["filePath"],
      },
    },
    {
      name: "edit_project_file",
      description:
        "Create or overwrite a file in the Project1CC directory (frontend or backend). Send the COMPLETE new file content.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: {
            type: "string",
            description: "Relative path from project root, e.g. 'frontend/src/App.jsx'",
          },
          content: { type: "string", description: "Complete new content for the file" },
        },
        required: ["filePath", "content"],
      },
    },
    {
      name: "delete_project_file",
      description:
        "Permanently delete ONE file inside the project. Requires confirm=true, which must only be set after the user has seen the exact path and approved. Files only: directories, protected paths (.git, node_modules, .env*, .mcp.json, keys) and the MCP server's own files are refused. Does not touch Git or any database.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "Project-relative path of the file to delete." },
          confirm: {
            type: "boolean",
            description: "Must be exactly true after explicit user approval; anything else refuses.",
          },
        },
        required: ["filePath", "confirm"],
      },
    },

    // 3. APPROVED COMMANDS
    {
      name: "run_approved_command",
      description:
        'Run one allowlisted command with no shell, a fixed working directory, a timeout and an output cap. Allowed: "git status --short", "git diff", "git diff --check", "git diff --stat", "git diff --cached", "git diff --cached --check", "node --check" (requires "file": a project .js/.mjs/.cjs file), "npm test" (runs from mcp-server only). Returns exit code, stdout and stderr. Nothing else can be run.',
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", enum: APPROVED_COMMANDS },
          file: {
            type: "string",
            description: 'Project-relative .js/.mjs/.cjs path; only for "node --check".',
          },
        },
        required: ["command"],
      },
    },

    // 4. GIT (inspect, stage, review, commit, push are separate steps)
    {
      name: "git_status",
      description: "Show git status of the project (changed files, current branch).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "git_inspect",
      description:
        "Read-only Git inspection: current branch, HEAD, configured remotes (credentials masked), whether origin matches the expected repository, upstream tracking, ahead/behind counts and working-tree counts. With checkRemote=true it also asks the expected remote for the branch's current commit (network, read-only) and reports whether a push would fast-forward.",
      inputSchema: {
        type: "object",
        properties: {
          checkRemote: {
            type: "boolean",
            description: "Also query origin for the branch tip (only contacts the expected repository).",
          },
        },
      },
    },
    {
      name: "git_fetch",
      description:
        "Run 'git fetch origin' (only when origin matches the expected repository). Updates remote-tracking refs only; never changes your branches, commits or working tree.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "git_set_origin",
      description:
        "Point the 'origin' remote at the expected repository (CONTACTFLOW_EXPECTED_REMOTES, first entry). It can only ever set that configured URL, never an arbitrary one. Requires confirm=true after the user approved. Does not push or fetch.",
      inputSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            description: "Must be exactly true after explicit user approval; anything else refuses.",
          },
        },
        required: ["confirm"],
      },
    },
    {
      name: "git_review",
      description:
        "Read-only review before committing or pushing: branch status, staged files, unstaged change summary, commits not yet pushed, and HEAD. Changes nothing.",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "git_add",
      description:
        "Stage specific files for commit. Takes explicit project-relative paths only (no whole-repo staging). Does not commit or push.",
      inputSchema: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Project-relative file paths to stage, e.g. ['backend/server.js']",
          },
        },
        required: ["paths"],
      },
    },
    {
      name: "git_unstage",
      description:
        "Remove specific files from the staging area (git restore --staged). Working-tree files are left untouched, so no work is lost. Use it to keep unrelated changes out of a commit.",
      inputSchema: {
        type: "object",
        properties: {
          paths: {
            type: "array",
            items: { type: "string" },
            description: "Project-relative file paths to unstage.",
          },
        },
        required: ["paths"],
      },
    },
    {
      name: "scan_for_secrets",
      description:
        "Scan changes for credentials (private keys, cloud/GitHub/Google/Slack/LLM tokens, MongoDB URIs with real passwords, sensitive file names). Read-only. Reports file, line and rule only, never the matched value. scope: 'staged' (default), 'working' (unstaged + untracked) or 'all'.",
      inputSchema: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["staged", "working", "all"] },
        },
      },
    },
    {
      name: "git_commit",
      description:
        "Commit ONLY the files already staged with git_add. Never stages anything, never pushes. Refuses when nothing is staged, when a protected path (.env*, keys, .mcp.json) is staged, or when the staged changes contain a high-severity secret. Use only when the user has asked for a commit.",
      inputSchema: {
        type: "object",
        properties: {
          commitMessage: { type: "string", description: "Commit message describing the changes" },
        },
        required: ["commitMessage"],
      },
    },
    {
      name: "git_push",
      description:
        "Push the current branch to origin, never forced. Verifies that origin matches the expected repository (both fetch and push URLs), that the branch and optional expectedHead match, and that any existing upstream is origin/<same branch>. If the branch has no upstream it sets one explicitly (--set-upstream). Afterwards it checks the remote branch tip. Requires confirm=true after the user approved the push.",
      inputSchema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            description: "Must be exactly true after explicit user approval; anything else refuses.",
          },
          expectedHead: {
            type: "string",
            description: "Optional commit hash (7-40 chars) the user reviewed; the push is refused if HEAD differs.",
          },
          branch: {
            type: "string",
            description: "Optional; must equal the checked-out branch or the push is refused.",
          },
        },
        required: ["confirm"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  try {
    switch (name) {
      case "get_contacts": {
        const res = await api.get(API_URL);
        return text(JSON.stringify(res.data, null, 2));
      }
      case "add_contact": {
        const res = await api.post(API_URL, args);
        return text(`Added contact: ${JSON.stringify(res.data)}`);
      }
      case "update_contact": {
        const { id, ...updateData } = args;
        const res = await api.put(`${API_URL}/${encodeURIComponent(id)}`, updateData);
        return text(`Updated contact: ${JSON.stringify(res.data)}`);
      }
      case "delete_contact": {
        await api.delete(`${API_URL}/${encodeURIComponent(args.id)}`);
        return text(`Deleted contact with ID: ${args.id}`);
      }

      case "list_project_files":
        return await listProjectFiles(args);

      case "read_project_file": {
        const full = safePath(args.filePath);
        return text(await fs.readFile(full, "utf8"));
      }
      case "edit_project_file": {
        const full = safePath(args.filePath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, args.content, "utf8");
        return text(`Wrote file: ${args.filePath}`);
      }
      case "delete_project_file":
        return await deleteProjectFile(args);

      case "run_approved_command":
        return await runApprovedCommand(args);

      case "git_status": {
        const { stdout } = await git("status", "--short", "--branch");
        return text(stdout || "Working tree clean");
      }

      case "git_inspect":
        return await gitInspect(args);

      case "git_fetch":
        return await gitFetch();

      case "git_set_origin":
        return await gitSetOrigin(args);

      case "git_review":
        return await gitReview();

      case "git_add": {
        const paths = Array.isArray(args.paths) ? args.paths : [];
        if (!paths.length) {
          throw new Error("paths must be a non-empty array of project-relative file paths.");
        }
        const rels = paths.map((p) => {
          const rel = path.relative(PROJECT_ROOT, safePath(p));
          if (!rel) throw new Error("Staging the whole project root is not allowed.");
          return rel;
        });
        await git("add", "--", ...rels);
        const { stdout } = await git("status", "--short");
        return text(`Staged: ${rels.join(", ")}\n${stdout}`);
      }

      case "git_unstage":
        return await gitUnstage(args);

      case "scan_for_secrets":
        return await scanForSecrets(args);

      case "git_commit":
        return await gitCommit(args);

      case "git_push":
        return await gitPush(args);

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error) {
    const detail = error.response
      ? `${error.response.status}: ${JSON.stringify(error.response.data)}`
      : error.stderr || error.message;
    return { content: [{ type: "text", text: `Error in ${name}: ${detail}` }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
