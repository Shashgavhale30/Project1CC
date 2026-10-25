// Pure helpers for the Git tools. No I/O happens here, so everything in this
// file can be unit-tested directly (see test/git-tools.mjs).
import path from "node:path";

// ---------------------------------------------------------------------------
// Remote URLs
// ---------------------------------------------------------------------------

// Replace credentials embedded in a URL (https://user:token@host/...) with ***.
export function redactUrl(value) {
  return String(value ?? "").replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi, "$1***@");
}

// Reduce any common spelling of a Git remote to "host/owner/repo" so that
//   https://github.com/Owner/Repo.git
//   git@github.com:Owner/Repo.git
//   https://user:token@github.com/owner/repo/
// all compare equal. Credentials are dropped. Local paths (used by tests and
// local mirrors) become "local:<absolute path>". Returns null when unparseable.
export function normalizeRemote(url) {
  const s = String(url ?? "").trim();
  if (!s) return null;

  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(s)) {
    return (
      "local:" +
      path
        .resolve(s)
        .replace(/\\/g, "/")
        .replace(/\/+$/, "")
        .replace(/\.git$/i, "")
        .toLowerCase()
    );
  }

  let m = s.match(/^(?:https?|ssh|git):\/\/(?:[^@/]*@)?([^/:]+)(?::\d+)?\/(.+)$/i);
  if (!m) m = s.match(/^(?:[^@/\s]+@)?([A-Za-z0-9.-]+):(?!\/)(.+)$/);
  if (!m) return null;

  const repoPath = m[2].replace(/\/+$/, "").replace(/\.git$/i, "").toLowerCase();
  if (!repoPath) return null;
  return `${m[1].toLowerCase()}/${repoPath}`;
}

// "url1, url2" or whitespace separated -> ["url1", "url2"]
export function parseExpectedRemotes(raw) {
  return String(raw ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// Branches and counts
// ---------------------------------------------------------------------------

// Conservative branch-name check: no leading "-" or "+", no "..", no "//",
// no trailing "/" or ".lock", only plain characters.
export function isSafeBranchName(name) {
  if (typeof name !== "string") return false;
  if (!/^[A-Za-z0-9._/-]{1,200}$/.test(name)) return false;
  if (name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return false;
  if (name.includes("..") || name.includes("//") || name.endsWith(".lock")) return false;
  return true;
}

// Output of: git rev-list --left-right --count HEAD...@{upstream}
export function parseAheadBehind(output) {
  const m = String(output ?? "").trim().match(/^(\d+)\s+(\d+)$/);
  return m ? { ahead: Number(m[1]), behind: Number(m[2]) } : { ahead: null, behind: null };
}

// ---------------------------------------------------------------------------
// Secret scanning (never returns matched values, only file, line and rule)
// ---------------------------------------------------------------------------

const PLACEHOLDER_PASSWORD =
  /^(?:\*+|<[^>]*>|x+|pass(?:word)?|your[-_ ]?.*|\$\{.*\}|%[^%]*%|\{\{.*\}\}|redacted|changeme|example)$/i;

export const SECRET_RULES = [
  { id: "private-key-block", severity: "high", re: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { id: "aws-access-key-id", severity: "high", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "github-token", severity: "high", re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { id: "github-fine-grained-token", severity: "high", re: /\bgithub_pat_[A-Za-z0-9_]{50,}\b/ },
  { id: "google-api-key", severity: "high", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "slack-token", severity: "high", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { id: "llm-api-key", severity: "high", re: /\bsk-(?:ant-)?[A-Za-z0-9_-]{32,}\b/ },
  {
    id: "mongodb-uri-with-password",
    severity: "high",
    re: /mongodb(?:\+srv)?:\/\/[^\s:/@'"`]+:([^\s@'"`]+)@/,
    accept: (m) => !PLACEHOLDER_PASSWORD.test(m[1]),
  },
  {
    id: "credential-assignment",
    severity: "review",
    re: /(?:api[_-]?key|secret|passwd|password|auth[_-]?token|access[_-]?token)["']?\s*[:=]\s*["'][A-Za-z0-9_\-/+=.]{16,}["']/i,
  },
];

function scanLine(rawText, file, lineNo, out) {
  const text = rawText.length > 20000 ? rawText.slice(0, 20000) : rawText;
  for (const rule of SECRET_RULES) {
    const m = rule.re.exec(text);
    if (m && (!rule.accept || rule.accept(m))) {
      out.push({ file, line: lineNo, rule: rule.id, severity: rule.severity });
    }
  }
}

// Scan the ADDED lines of a unified diff (use `git diff -U0`).
export function scanDiff(diff) {
  const findings = [];
  let file = "(unknown)";
  let newLine = 0;
  let inHunk = false;

  for (const raw of String(diff ?? "").split("\n")) {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;

    if (line.startsWith("diff --git ")) {
      inHunk = false;
      continue;
    }
    if (!inHunk && line.startsWith("+++ ")) {
      const name = line.slice(4).replace(/^b\//, "");
      file = name === "/dev/null" ? "(deleted)" : name;
      continue;
    }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      inHunk = true;
      newLine = Number(hunk[1]);
      continue;
    }
    if (!inHunk) continue;

    if (line.startsWith("+")) {
      scanLine(line.slice(1), file, newLine, findings);
      newLine++;
    } else if (line.startsWith(" ")) {
      newLine++;
    }
  }
  return findings;
}

// Scan the whole text of one file (used for untracked files).
export function scanFileText(file, content) {
  const findings = [];
  String(content ?? "")
    .split("\n")
    .forEach((l, i) => scanLine(l.endsWith("\r") ? l.slice(0, -1) : l, file, i + 1, findings));
  return findings;
}
