# ContactFlow MCP Server

A local (stdio) MCP server that lets Claude work with the ContactFlow project end to end: manage contacts through the portal's REST API, inspect and edit project files, run approved checks, and move changes through Git (inspect, stage, scan, commit, push) in separate, guarded steps.

Contacts go through the **deployed backend API** (not MongoDB directly), so no database credentials are needed and the backend's validation applies to everything Claude adds.

## Tools (19)

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
- `git diff`, `git diff --stat`, `git diff --check`
- `git diff --cached`, `git diff --cached --check` (review exactly what a commit would contain)
- `node --check` with `file`: a `.js`, `.mjs` or `.cjs` file inside the project
- `npm test`: runs from `mcp-server` only

Diffs exclude secret files such as `.env*` and `.mcp.json`.

### Git

| Tool | What it does | Changes anything? |
|------|--------------|-------------------|
| `git_status` | Short status with branch | No |
| `git_inspect` | Branch, HEAD, configured remotes (credentials masked), whether `origin` matches the expected repository, upstream, ahead/behind, working-tree counts. `checkRemote: true` also asks the remote for the branch tip and says whether a push would fast-forward | No |
| `git_review` | Branch status, staged files, unstaged summary, commits not yet pushed, HEAD | No |
| `git_fetch` | `git fetch origin`, only when origin matches the expected repository | Remote-tracking refs only |
| `git_set_origin` | Points `origin` at the **configured expected URL** (never an arbitrary one). Needs `confirm: true` | Local Git config |
| `git_add` | Stages explicit project-relative files (never the whole repo) | Index only |
| `git_unstage` | Removes explicit files from the index; working files are untouched | Index only |
| `scan_for_secrets` | Scans staged (default), working or all changes for credentials. Reports file, line and rule, never the value | No |
| `git_commit` | Commits **only what is already staged**. Never stages, never pushes. Refuses protected paths and high-severity secrets | Local commit |
| `git_push` | Verified push of the current branch to `origin`. Needs `confirm: true`; never forced | Remote |

`git_commit_and_push` was removed. The old tool committed and pushed in one step.

#### How `git_push` works

1. `confirm` must be exactly `true`; `expectedHead` (optional) must match HEAD.
2. A branch must be checked out, and an optional `branch` argument must equal it.
3. Both the fetch URL and the push URL of `origin` must match the expected repository (see `CONTACTFLOW_EXPECTED_REMOTES`). Otherwise nothing is pushed and the message says how to fix it.
4. If the branch has an upstream, it must be `origin/<same branch>`; the push is `git push origin HEAD:refs/heads/<branch>`.
5. If the branch has **no upstream** (first push), the push is `git push --set-upstream origin HEAD:refs/heads/<branch>`.
6. Force, force-with-lease, mirror, prune, delete, tags and `+refspec` are never used. If the remote has commits you don't have, Git rejects the push and the tool reports it; history is never rewritten.
7. Afterwards the tool asks the remote for the branch tip and reports `remoteHeadVerified`.

#### First push and remote problems

```text
git_inspect { "checkRemote": true }      # what is origin? does it match? does the remote branch exist?
git_set_origin { "confirm": true }       # only if origin is missing/wrong and the user approved
git_push { "confirm": true, "expectedHead": "<hash>" }
```

`git_inspect` is why the remote can now be seen: the old allowlist had no remote command, `.git/config` is deliberately unreadable, and the old `git_push` ran a bare `git push origin HEAD` with no upstream handling or remote verification.

The first push may open a Git Credential Manager sign-in window on Windows. Prompts on a terminal are disabled (`GIT_TERMINAL_PROMPT=0`), so an unauthenticated push fails with a clear error instead of hanging; the call times out after 120 seconds.

## Autonomous workflow ("remove the Family section and deploy")

Claude chains the tools above; each step has its own guard:

1. **Inspect:** `git_inspect`, `git_review`, `list_project_files`, `read_project_file`.
2. **Edit:** `edit_project_file`, and `delete_project_file` (one confirmed file at a time).
3. **Test:** `run_approved_command` with `node --check`, `git diff --check`, `npm test`, plus any test script that really exists.
4. **Review:** `git diff --stat`, `git diff`, then after staging `git diff --cached` and `git diff --cached --check`.
5. **Stage only what belongs to the task:** `git_add` with explicit paths. Unrelated changes stay in the working tree; `git_unstage` fixes mistakes.
6. **Scan:** `scan_for_secrets`. `git_commit` runs the same scan itself and refuses on high-severity findings.
7. **Commit:** `git_commit`, then confirm with `git_review`.
8. **Push:** `git_inspect { checkRemote: true }`, then `git_push { confirm: true, expectedHead }` once the plan was approved.
9. **Deploy and verify:** with the Vercel and Render connectors (next section) plus live checks.

## Deployment discovery and verification (Vercel and Render)

This MCP server does **not** talk to Vercel or Render. They are separate connectors in Claude, each with its own sign-in. The server contributes the Git side (a verified push to the right repository); the connectors handle the rest.

### Identify your existing projects without guessing

Never create a project or service to find one. Always list first and match on several facts:

- **Vercel connector:** `list_projects` with `search` (for example `project1cc`), then confirm with `list_deployments` for that project. A single exact name match is a hit; zero or several matches means ask.
- **Render connector:** `list_workspaces`, confirm the workspace, then `list_services`. Match on service name **and** `url`, `repo`, `branch` and `rootDir`. Other services in the same workspace belong to other projects and must not be touched.
- **Repository check (important):** a platform deploys from the repository it is linked to. Compare that linked `repo` with the repository `origin` pushes to. If they differ, a push will not deploy anything; fix the mismatch deliberately (relink the platform, or change `CONTACTFLOW_EXPECTED_REMOTES`) instead of pushing and hoping.

### What each connector can do

| Need | Vercel connector | Render connector |
|------|------------------|------------------|
| Find the project | `list_projects` | `list_services` (after `list_workspaces`) |
| Deployment status and commit | `list_deployments`, `get_deployment` | `list_deploys`, `get_deploy`, `list_events` |
| Build and runtime logs | `list_deployment_events`, `get_runtime_logs` | `list_logs` |
| Environment variable **presence** | `filter_project_envs` (keys; never print values) | No read tool is exposed, only `update_environment_variables` (write). Presence cannot be verified through the connector; check the dashboard or infer from startup logs |
| Deploy the pushed commit | Automatic on push to the linked branch; otherwise `create_deployment` (redeploy) | Automatic when `autoDeploy` is on; `trigger_deploy` only when it is off or for a redeploy without a code change |

Rules: do not call `trigger_deploy` after a push to a service with auto-deploy (the push already deploys); never read, print or change secret values; never edit environment variables unless asked; never touch other services.

### Connections you must make once

- **Vercel:** the connector may see a project yet get `403` on deployment calls until the team is authorized. Claude calls `authorize_team_access`, which returns a one-time link (valid 10 minutes); open it, review, and approve. After that, retry; no reconnect is needed.
- **Render:** the connector requires you to confirm which workspace to use before it lists or changes services. Claude lists workspaces and asks; reply with the workspace name once.
- **Git push credentials:** the first push needs GitHub sign-in on this machine (Git Credential Manager, or an SSH key). This server never stores or prints credentials.

### Live verification

After a deploy, check the live URLs (`web_fetch`), the platform's deployment status and logs, that the frontend assets load, and that CORS allows the frontend origin. Use only disposable test records for write checks, and remove them afterward. A page that renders client-side cannot be fully verified by fetching its HTML; say so rather than claiming a pass.

## Permissions and protections

- **Project root only.** All paths are resolved against `PROJECT_ROOT` (default `D:\Project1CC`). `..` traversal, absolute paths outside the root and symlinks that lead outside are rejected.
- **Protected paths.** `.git`, `node_modules`, `.env*`, `.mcp.json`, `.npmrc`, `.netrc`, `.ssh`, `.aws`, private keys and certificates (`*.pem`, `*.key`, `*.pfx`, `*.p12`, `id_rsa*`), and `credentials*`/`secrets*` files are hidden from listings and refused for edit, delete and `node --check`.
- **Deletion.** `delete_project_file` refuses unless `confirm` is exactly the boolean `true`. It deletes one regular file, never a directory, and refuses the MCP server's own `server.js`, `git-helpers.js`, `package.json` and `package-lock.json`. It never touches the database or Git.
- **Commands.** No shell is ever used: commands run as argument arrays in a fixed working directory. Each run has a timeout (30 s; 120 s for `npm test` and network Git calls) and an output cap (200 KB per stream; larger for the secret scan). `CONTACTFLOW_API_TOKEN` is removed from the child environment. `npm test` only runs when `mcp-server/package.json` has `scripts.test` exactly `node test/smoke.mjs` and no `pretest`/`posttest`.
- **Remote safety.** `git_push`, `git_fetch` and `git_inspect { checkRemote }` only contact a remote whose URL (fetch and push) matches the expected repository. `git_set_origin` can only set that configured URL, and refuses a configured URL that embeds credentials.
- **Credentials.** Credentials embedded in any URL are masked (`https://***@host/...`) in all output, including errors.
- **Secrets.** `scan_for_secrets` and the `git_commit` gate detect private keys, AWS, GitHub, Google, Slack and LLM-style keys, MongoDB URIs with real passwords (placeholders such as `user:pass` are ignored) and sensitive file names. Findings are `high` (blocks commits) or `review` (reported only). Matched values are never output. This is a pattern scan, not a guarantee; it can miss unusual secrets.
- **No force, ever.** Nothing in this server force-pushes, deletes branches, resets, or rewrites history.

### Limits to know about

- `confirm: true` is a guard inside the tool, not authentication. The real approval is your MCP client's permission prompt for each call, so keep prompts enabled for `delete_project_file`, `git_set_origin`, `git_commit` and `git_push`.
- Timeouts stop the process that was started. On Windows, a child it spawned itself (for example during `npm test`) may keep running briefly.
- `git diff` and `git_review` can show tracked files other than the excluded secret patterns, so don't track secrets in Git.
- Contacts have no authentication on the API today (see Notes).

## Examples

```text
git_inspect { "checkRemote": true }

list_project_files { "directory": "backend", "recursive": true }
run_approved_command { "command": "node --check", "file": "backend/server.js" }
run_approved_command { "command": "npm test" }

git_add { "paths": ["backend/server.js", "frontend/script.js"] }
run_approved_command { "command": "git diff --cached --check" }
scan_for_secrets {}
git_commit { "commitMessage": "Remove Family section" }
git_review {}
git_push { "confirm": true, "expectedHead": "a1b2c3d" }   # only after the push was approved
```

## Setup

```bash
cd mcp-server
npm install
npm test        # contacts against a local mock, plus the Git tools against throwaway repos
```

`npm test` creates and removes a few `.mcp-smoke-*` files in `mcp-server`, and builds temporary Git repositories (including a local bare repository standing in for GitHub) in your OS temp folder. It never contacts GitHub, never commits or pushes in your real repository, and never deletes a real project file.

### Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `CONTACTFLOW_API_URL` | `https://project1cc-backend.onrender.com/api/contacts` | Contacts API. Use `http://localhost:5000/api/contacts` for a local backend |
| `CONTACTFLOW_API_TOKEN` | none | Optional bearer token for the API |
| `PROJECT_ROOT` | `D:\Project1CC` | Folder the file, command and git tools work in |
| `CONTACTFLOW_EXPECTED_REMOTES` | `https://github.com/Shashgavhale30/CCProject1.git` | Comma-separated repositories `origin` must match. The first one is what `git_set_origin` configures. URL spellings (https, ssh, `.git` suffix, case) are treated as equal |

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
        "CONTACTFLOW_API_URL": "https://project1cc-backend.onrender.com/api/contacts",
        "CONTACTFLOW_EXPECTED_REMOTES": "https://github.com/Shashgavhale30/CCProject1.git"
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
  --env CONTACTFLOW_EXPECTED_REMOTES=https://github.com/Shashgavhale30/CCProject1.git \
  -- node D:\\Project1CC\\mcp-server\\server.js
```

### Restarting after you change `server.js`

The server is a long-running process, so changes take effect only after a restart. This is the one manual step, needed when the server's own code changes, not for routine project work:

- **Claude Desktop:** quit it completely (right-click the tray icon → Quit, not just close the window) and open it again.
- **Claude Code:** run `/mcp` and reconnect `contactflow`, or start a new session.

## Notes

- Render's free tier sleeps when idle, so the first contacts request after a quiet period can take 30-60 seconds. The server waits up to 60 seconds before giving up.
- This is a local (stdio) server. The Claude app on the web can't launch it; use Claude Desktop or Claude Code on the machine where it's installed.
- The contacts API has no authentication today, so anyone who knows the Render URL can add contacts. If you add auth to the backend later, set `CONTACTFLOW_API_TOKEN`; the server already sends it as a bearer token.
