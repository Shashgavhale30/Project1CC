// Tests for the Git tools. Everything here runs against throwaway repositories
// in the OS temp directory (a local bare repo plays the part of GitHub), so the
// real project repository and the real remote are never touched.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  redactUrl,
  normalizeRemote,
  parseExpectedRemotes,
  isSafeBranchName,
  parseAheadBehind,
  scanDiff,
  scanFileText,
} from "../git-helpers.js";

const execFileAsync = promisify(execFile);
const git = (cwd, ...args) => execFileAsync("git", args, { cwd, windowsHide: true });
const gitOut = async (cwd, ...args) => (await git(cwd, ...args)).stdout.trim();

// Fake credentials are assembled at runtime so this file never contains a
// string that looks like a real secret.
const fakeGithubToken = "ghp_" + "Zz9Yy8Xx7W".repeat(4);
const fakeMongoUri = "mongodb+srv://" + "dbuser:" + "S3cretPassw0rd" + "@cluster0.example.mongodb.net/db";

function runHelperTests() {
  // redactUrl
  const creds = "https://someuser:" + fakeGithubToken + "@github.com/o/r.git";
  assert.ok(!redactUrl(creds).includes(fakeGithubToken));
  assert.match(redactUrl(creds), /^https:\/\/\*\*\*@github\.com\/o\/r\.git$/);
  assert.equal(redactUrl("git@github.com:o/r.git"), "git@github.com:o/r.git");

  // normalizeRemote treats every spelling of the same repo as equal
  const canonical = "github.com/shashgavhale30/ccproject1";
  for (const url of [
    "https://github.com/Shashgavhale30/CCProject1.git",
    "https://github.com/Shashgavhale30/CCProject1",
    "https://github.com/shashgavhale30/ccproject1/",
    "git@github.com:Shashgavhale30/CCProject1.git",
    "ssh://git@github.com/Shashgavhale30/CCProject1.git",
    creds.replace("/o/r.git", "/Shashgavhale30/CCProject1.git"),
  ]) {
    assert.equal(normalizeRemote(url), canonical, url);
  }
  assert.notEqual(normalizeRemote("https://github.com/Shashgavhale30/Project1CC.git"), canonical);
  assert.notEqual(normalizeRemote("https://example.com/Shashgavhale30/CCProject1.git"), canonical);
  assert.equal(normalizeRemote(""), null);
  assert.equal(normalizeRemote("not a url"), null);
  assert.match(normalizeRemote(path.join(os.tmpdir(), "x.git")), /^local:/);
  assert.deepEqual(parseExpectedRemotes("a, b  c"), ["a", "b", "c"]);

  // branch names
  for (const ok of ["main", "feature/theme-change", "release-1.2"]) assert.ok(isSafeBranchName(ok), ok);
  for (const bad of ["", "-f", "+main", "a..b", "a//b", "/abs", "x/", "x.lock", "a b", "a;b", "$(x)"]) {
    assert.equal(isSafeBranchName(bad), false, bad);
  }

  assert.deepEqual(parseAheadBehind("2\t3\n"), { ahead: 2, behind: 3 });
  assert.deepEqual(parseAheadBehind("garbage"), { ahead: null, behind: null });

  // secret scanner: finds the right file/line/rule and never returns the value
  const diff = [
    "diff --git a/app.txt b/app.txt",
    "--- a/app.txt",
    "+++ b/app.txt",
    "@@ -0,0 +1,2 @@",
    "+hello",
    "+value " + fakeGithubToken,
    "diff --git a/db.txt b/db.txt",
    "--- a/db.txt",
    "+++ b/db.txt",
    "@@ -3,0 +4,2 @@",
    "+uri " + fakeMongoUri,
    "+placeholder mongodb+srv://user:pass@cluster.example.net/db",
    "",
  ].join("\n");
  const found = scanDiff(diff);
  assert.deepEqual(
    found.map((f) => `${f.file}:${f.line}:${f.rule}:${f.severity}`),
    ["app.txt:2:github-token:high", "db.txt:4:mongodb-uri-with-password:high"]
  );
  const serialized = JSON.stringify(found);
  assert.ok(!serialized.includes(fakeGithubToken) && !serialized.includes("S3cretPassw0rd"));
  assert.deepEqual(scanFileText("a.txt", "fine\nalso fine\n"), []);
  assert.equal(scanFileText("a.txt", "x\n" + fakeGithubToken + "\n")[0].line, 2);
  console.log("PASS: git helpers (redaction, remote normalization, branch names, ahead/behind, secret scanner)");
}

export async function runGitToolTests({ serverPath }) {
  runHelperTests();

  const base = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "cf-mcp-git-")));
  const bare = path.join(base, "remote.git");
  const work = path.join(base, "work");
  const other = path.join(base, "other");
  const client = new Client({ name: "git-tools-test", version: "1.0.0" });

  const callRaw = (name, args = {}) => client.callTool({ name, arguments: args });
  const call = async (name, args = {}) => {
    const result = await callRaw(name, args);
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result.content)}`);
    return result.content[0].text;
  };
  const json = async (name, args = {}) => JSON.parse(await call(name, args));
  const refused = async (name, args, pattern) => {
    const result = await callRaw(name, args);
    assert.equal(result.isError, true, `${name} should be refused: ${JSON.stringify(args)}`);
    const message = result.content[0].text;
    if (pattern) assert.match(message, pattern, `${name} ${JSON.stringify(args)}`);
    return message;
  };
  const configure = async (dir) => {
    for (const [k, v] of [
      ["user.name", "MCP Smoke"],
      ["user.email", "smoke@example.test"],
      ["commit.gpgsign", "false"],
      ["core.autocrlf", "false"],
    ]) {
      await git(dir, "config", k, v);
    }
  };

  try {
    await git(base, "init", "--bare", bare);
    await git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
    await git(base, "init", work);
    await git(work, "symbolic-ref", "HEAD", "refs/heads/main");
    await configure(work);

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: [serverPath],
        env: {
          ...process.env,
          PROJECT_ROOT: work,
          CONTACTFLOW_EXPECTED_REMOTES: bare,
          CONTACTFLOW_API_URL: "http://127.0.0.1:9/api/contacts",
        },
        stderr: "inherit",
      })
    );

    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const n of ["git_inspect", "git_fetch", "git_set_origin", "git_unstage", "scan_for_secrets"]) {
      assert.ok(names.includes(n), `missing tool ${n}`);
    }

    // 1. Empty repository, no remote
    let info = await json("git_inspect");
    assert.equal(info.branch, "main");
    assert.equal(info.head, null);
    assert.deepEqual(info.remotes, []);
    assert.equal(info.originMatchesExpected, null);
    assert.equal(info.upstream, null);
    console.log("PASS: git_inspect on an empty repository without a remote");

    // 2. Stage only the relevant file, commit; unrelated files stay untouched
    await call("edit_project_file", { filePath: "app.txt", content: "one\n" });
    await call("edit_project_file", { filePath: "unrelated.txt", content: "keep me\n" });
    await call("git_add", { paths: ["app.txt"] });
    assert.match(await call("git_commit", { commitMessage: "first commit" }), /Committed 1 staged file/);
    assert.match(await gitOut(work, "status", "--short"), /\?\? unrelated\.txt/);
    assert.ok(!(await gitOut(work, "show", "--name-only", "--format=", "HEAD")).includes("unrelated.txt"));
    const head1 = await gitOut(work, "rev-parse", "HEAD");
    console.log("PASS: workflow stages only the relevant file and leaves unrelated changes alone");

    // 3. No origin yet: push and fetch refuse
    await refused("git_push", { confirm: true }, /no remote named "origin"/);
    await refused("git_fetch", {}, /no remote named "origin"/);
    console.log("PASS: git_push and git_fetch refuse when origin is missing");

    // 4. git_set_origin needs confirmation and only ever sets the expected URL
    await refused("git_set_origin", {}, /confirm/);
    await refused("git_set_origin", { confirm: false }, /confirm/);
    await refused("git_set_origin", { confirm: "true" }, /confirm/);
    const added = await json("git_set_origin", { confirm: true });
    assert.equal(added.changed, true);
    assert.equal(normalizeRemote(await gitOut(work, "remote", "get-url", "origin")), normalizeRemote(bare));
    assert.equal((await json("git_set_origin", { confirm: true })).changed, false);
    info = await json("git_inspect");
    assert.equal(info.originMatchesExpected, true);
    console.log("PASS: git_set_origin adds the expected origin, needs confirm, and is idempotent");

    // 5. Wrong remote: nothing is pushed or fetched; credentials never leak
    await git(work, "remote", "set-url", "origin", "https://example.invalid/someone/else.git");
    await refused("git_push", { confirm: true }, /does not match the expected/);
    await refused("git_fetch", {}, /does not match the expected/);
    info = await json("git_inspect", { checkRemote: true });
    assert.equal(info.originMatchesExpected, false);
    assert.equal(info.remoteBranch.checked, false);
    await assert.rejects(git(bare, "rev-parse", "--verify", "refs/heads/main"));

    await git(work, "remote", "set-url", "origin", `https://someuser:${fakeGithubToken}@example.invalid/someone/else.git`);
    const leakCheck = [await call("git_inspect")];
    leakCheck.push(await refused("git_push", { confirm: true }, /does not match the expected/));
    for (const out of leakCheck) assert.ok(!out.includes(fakeGithubToken), "credentials must never be printed");
    assert.match(leakCheck[0], /\*\*\*@example\.invalid/);
    const fixed = await json("git_set_origin", { confirm: true });
    assert.equal(fixed.changed, true);
    assert.ok(!JSON.stringify(fixed).includes(fakeGithubToken));
    assert.equal((await json("git_inspect")).originMatchesExpected, true);
    console.log("PASS: wrong or credentialed remotes are refused, masked, and fixable with git_set_origin");

    // 6. First push of a branch without an upstream
    info = await json("git_inspect", { checkRemote: true });
    assert.equal(info.upstream, null);
    assert.equal(info.remoteBranch.checked, true);
    assert.equal(info.remoteBranch.exists, false);
    await refused("git_push", {}, /confirm/);
    await refused("git_push", { confirm: true, expectedHead: "zzz" }, /expectedHead/);
    await refused("git_push", { confirm: true, expectedHead: "0000000" }, /not the reviewed commit/);
    await refused("git_push", { confirm: true, branch: "other" }, /not the checked-out branch/);
    await assert.rejects(git(bare, "rev-parse", "--verify", "refs/heads/main"));
    const first = await json("git_push", { confirm: true, expectedHead: head1.slice(0, 10) });
    assert.equal(first.pushed, true);
    assert.equal(first.upstreamWasSet, true);
    assert.equal(first.upstream, "origin/main");
    assert.equal(first.remoteHeadVerified, true);
    assert.equal(await gitOut(bare, "rev-parse", "refs/heads/main"), head1);
    assert.equal(await gitOut(work, "config", "branch.main.remote"), "origin");
    info = await json("git_inspect");
    assert.equal(info.upstream, "origin/main");
    assert.equal(info.ahead, 0);
    assert.equal(info.behind, 0);
    console.log("PASS: git_push first push verifies origin, sets the upstream explicitly, and checks the remote tip");

    // 7. Normal push once an upstream exists
    await call("edit_project_file", { filePath: "app.txt", content: "one\ntwo\n" });
    await call("git_add", { paths: ["app.txt"] });
    await call("git_commit", { commitMessage: "second commit" });
    info = await json("git_inspect");
    assert.equal(info.ahead, 1);
    assert.equal(info.behind, 0);
    const head2 = await gitOut(work, "rev-parse", "HEAD");
    const second = await json("git_push", { confirm: true, expectedHead: head2 });
    assert.equal(second.upstreamWasSet, false);
    assert.equal(second.remoteHeadVerified, true);
    assert.equal(await gitOut(bare, "rev-parse", "refs/heads/main"), head2);
    console.log("PASS: git_push with an existing upstream fast-forwards the remote");

    // 8. Diverged remote: the push is rejected and nothing is ever forced
    await git(base, "clone", bare, other);
    await configure(other);
    await fs.writeFile(path.join(other, "remote-only.txt"), "remote work\n");
    await git(other, "add", "remote-only.txt");
    await git(other, "commit", "-m", "remote-only commit");
    await git(other, "push", "origin", "HEAD:refs/heads/main");
    const remoteHead = await gitOut(bare, "rev-parse", "refs/heads/main");

    await call("edit_project_file", { filePath: "app.txt", content: "one\ntwo\nthree\n" });
    await call("git_add", { paths: ["app.txt"] });
    await call("git_commit", { commitMessage: "local divergent commit" });
    info = await json("git_inspect", { checkRemote: true });
    assert.match(info.remoteBranch.relation, /remote-has-commits-not-in-local-history/);

    const rejected = await refused("git_push", { confirm: true, force: true, forceWithLease: true }, /rejected|failed/i);
    assert.ok(rejected.length > 0);
    assert.equal(await gitOut(bare, "rev-parse", "refs/heads/main"), remoteHead, "remote history must be untouched");

    await call("git_fetch");
    info = await json("git_inspect", { checkRemote: true });
    assert.match(info.remoteBranch.relation, /diverged/);
    assert.equal(info.ahead, 1);
    assert.equal(info.behind, 1);
    console.log("PASS: diverged history is reported, never force-pushed, and git_fetch is read-only for local work");

    // 9. Secret gate: commit refuses, scan reports without values, unstage recovers
    await call("edit_project_file", { filePath: "leak.txt", content: `token = ${fakeGithubToken}\n` });
    await call("git_add", { paths: ["leak.txt"] });
    const scanText = await call("scan_for_secrets");
    const scan = JSON.parse(scanText);
    assert.ok(scan.highSeverity >= 1);
    assert.equal(scan.clean, false);
    assert.ok(scan.findings.some((f) => f.file === "leak.txt" && f.line === 1 && f.rule === "github-token"));
    assert.ok(!scanText.includes(fakeGithubToken), "scan output must not contain the secret");

    const headBefore = await gitOut(work, "rev-parse", "HEAD");
    const message = await refused("git_commit", { commitMessage: "must not commit" }, /possible secrets/i);
    assert.ok(!message.includes(fakeGithubToken));
    assert.equal(await gitOut(work, "rev-parse", "HEAD"), headBefore, "no commit may be created");

    await call("git_unstage", { paths: ["leak.txt"] });
    assert.equal(JSON.parse(await call("scan_for_secrets")).highSeverity, 0);
    const working = JSON.parse(await call("scan_for_secrets", { scope: "working" }));
    assert.ok(working.findings.some((f) => f.file === "leak.txt"), "working scope sees untracked files");
    assert.ok(!JSON.stringify(working).includes(fakeGithubToken));
    await refused("scan_for_secrets", { scope: "bogus" }, /scope/);
    for (const bad of [".git/config", ".env", "."]) await refused("git_unstage", { paths: [bad] });
    await refused("git_unstage", { paths: [] });
    assert.match(await gitOut(work, "status", "--short"), /\?\? leak\.txt/);
    console.log("PASS: scan_for_secrets and git_commit block secrets without revealing them; git_unstage keeps work");

    // 10. New read-only review commands
    for (const command of ["git diff --stat", "git diff --cached", "git diff --cached --check"]) {
      const run = JSON.parse(await call("run_approved_command", { command }));
      assert.equal(typeof run.exitCode, "number", command);
      assert.equal(run.exitCode, 0, command);
      assert.equal(run.timedOut, false);
    }
    console.log("PASS: git diff --stat, --cached and --cached --check are available and read-only");
  } finally {
    await client.close().catch(() => {});
    await fs.rm(base, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
  }
}
