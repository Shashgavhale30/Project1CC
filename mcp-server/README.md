# ContactFlow MCP Server

A local (stdio) MCP server that lets Claude work with the ContactFlow project: manage contacts through the portal's REST API, inspect and edit project files, run a few approved checks, and stage, commit and push through separate, deliberate steps.

Contacts go through the **deployed backend API** (not MongoDB directly), so no database credentials are needed and the backend's validation applies to everything Claude adds.

## Tools

### Contacts (via the REST API)

| Tool | What it does |
|------|--------------|
| `get_contacts` | List all contacts |
| `add_contact` | Create a contact (`name` required; `email`, `phone`, `company`, `jobTitle`, `category`, `notes`) |
| `update_contact` | Partial update by `id` |
| `delete_contact` | Permanently delete one contact by `id` |

Valid categories: `Client`, `Colleague`, `Business Partner`, `Vendor`, `Other`.

### Project files

| Tool | What it does | Changes anything? |
|------|--------------|-------------------|
| `list_project_files` | Lists files and folders under the project root, or an optional relative `directory` (`recursive`, `maxDepth` 1-5 optional, 500 entries max) | No |
| `read_project_file` | Reads one file | No |
| `edit_project_file` | Creates or overwrites one file with the complete new content | Yes, one file |
| `delete_project_file` | Deletes one file. Needs `confirm: true` | Yes, one file |

### Approved commands

| Tool | What it does | Changes anything? |
|------|--------------|-------------------|
| `run_approved_command` | Runs exactly one allowlisted command and returns `exitCode`, `stdout`, `stderr` | No (read-only commands, plus the test run) |

Allowed commands, and nothing else:

- `git status --short`
- `git diff` (secret files such as `.env*` and `.mcp.json` are excluded from the output)
- `git diff --check`
- `node --check` with `file`: a `.js`, `.mjs` or `.cjs` file inside the project
- `npm test`: runs from `mcp-server` only

### Git (separate steps, nothing automatic)

| Tool | What it does | Changes anything? |
|------|--------------|-------------------|
| `git_status` | Short status with branch | No |
| `git_review` | Branch status, staged files, unstaged summary, commits not yet pushed, HEAD | No |
| `git_add` | Stages explicit project-relative files (never the whole repo) | Index only |
| `git_commit` | Commits **only what is already staged**. Never stages, never pushes | Local commit |
| `git_push` | Pushes the current branch to `origin`. Needs `confirm: true`; never forced | Remote |

`git_commit_and_push` was removed. The old tool committed and pushed in one step. The new flow is: `git_add` → `git_review` → (you approve) → `git_commit` → `git_review` → (you approve) → `git_push`.

> The README used to list `add_contacts_bulk`, `list_contacts`, `get_contact` and `get_stats`. The current `server.js` does not expose them, so they are no longer documented here.

## Permissions and protections

- **Project root only.** All paths are resolved against `PROJECT_ROOT` (default `D:\Project1CC`). `..` traversal, absolute paths outside the root and symlinks that lead outside are rejected.
- **Protected paths.** `.git`, `node_modules`, `.env*`, `.mcp.json`, `.npmrc`, `.netrc`, `.ssh`, `.aws`, private keys and certificates (`*.pem`, `*.key`, `*.pfx`, `*.p12`, `id_rsa*`), and `credentials*`/`secrets*` files are hidden from listings and refused for edit, delete and `node --check`.
- **Deletion.** `delete_project_file` refuses unless `confirm` is exactly the boolean `true`. It deletes one regular file, never a directory, and refuses the MCP server's own `server.js`, `package.json` and `package-lock.json`. It reports the path and size it removed and checks the file is gone. It never touches the database or Git.
- **Commands.** No shell is ever used: commands run as argument arrays in a fixed working directory (project root, or `mcp-server` for `npm test`). Each run has a timeout (30 s; 120 s for `npm test`) and an output cap (200 KB per stream). `CONTACTFLOW_API_TOKEN` is removed from the child environment. `npm test` only runs when `mcp-server/package.json` has `scripts.test` exactly `node test/smoke.mjs` and no `pretest`/`posttest`.
- **Commit and push.** `git_commit` refuses when nothing is staged or when a protected path is staged. `git_push` refuses unless `confirm` is `true`, can check an `expectedHead` commit hash, and never uses `--force`. Credentials in remote URLs are masked in output.

### Limits to know about

- `confirm: true` is a guard inside the tool, not authentication. The real approval is your MCP client's permission prompt for each call, so keep prompts enabled for `delete_project_file`, `git_commit` and `git_push`, and only approve after reading `git_review`.
- Timeouts stop the process that was started. On Windows, a child it spawned itself (for example during `npm test`) may keep running briefly.
- `git diff` and `git_review` can show tracked files other than the excluded secret patterns, so don't track secrets in Git.
- Contacts have no authentication on the API today (see Notes).

## Examples

```text
list_project_files { "directory": "backend", "recursive": true }

delete_project_file { "filePath": "backend/routes/family.js", "confirm": true }   # only after you approved this exact path

run_approved_command { "command": "node --check", "file": "backend/server.js" }
run_approved_command { "command": "git diff --check" }
run_approved_command { "command": "npm test" }

git_add { "paths": ["backend/server.js", "frontend/script.js"] }
git_review {}
git_commit { "commitMessage": "Remove Family section" }
git_review {}
git_push { "confirm": true, "expectedHead": "a1b2c3d" }   # only after you approved the push
```

## Setup

```bash
cd mcp-server
npm install
npm test        # runs every tool against a local mock of the API (no real contacts are touched)
```

`npm test` creates and removes a few `.mcp-smoke-*` files in `mcp-server`. It never commits or pushes, and never deletes a real project file.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONTACTFLOW_API_URL` | `https://project1cc-backend.onrender.com/api/contacts` | Contacts API. Use `http://localhost:5000/api/contacts` for a local backend |
| `CONTACTFLOW_API_TOKEN` | none | Optional bearer token for the API |
| `PROJECT_ROOT` | `D:\Project1CC` | Folder the file, command and git tools work in |

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config) and fully restart Claude Desktop:

```json
{
  "mcpServers": {
    "contactflow": {
      "command": "node",
      "args": ["D:\\Project1CC\\mcp-server\\server.js"],
      "env": {
        "PROJECT_ROOT": "D:\\Project1CC",
        "CONTACTFLOW_API_URL": "https://project1cc-backend.onrender.com/api/contacts"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add contactflow \
  --env PROJECT_ROOT=D:\\Project1CC \
  --env CONTACTFLOW_API_URL=https://project1cc-backend.onrender.com/api/contacts \
  -- node D:\\Project1CC\\mcp-server\\server.js
```

### Restarting after you change `server.js`

The server is a long-running process, so changes take effect only after a restart:

- **Claude Desktop:** quit it completely (right-click the tray icon → Quit, not just close the window) and open it again.
- **Claude Code:** run `/mcp` and reconnect `contactflow`, or start a new session.

## Notes

- Render's free tier sleeps when idle, so the first contacts request after a quiet period can take 30-60 seconds. The server waits up to 60 seconds before giving up.
- This is a local (stdio) server. The Claude app on the web can't launch it; use Claude Desktop or Claude Code on the machine where it's installed.
- The contacts API has no authentication today, so anyone who knows the Render URL can add contacts. If you add auth to the backend later, set `CONTACTFLOW_API_TOKEN`; the server already sends it as a bearer token.
