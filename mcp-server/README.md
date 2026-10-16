# ContactFlow MCP Server

Lets Claude add and look up contacts in the ContactFlow portal. You describe the data in a prompt ("add Asha Rao, CTO at Acme, asha@acme.com, a client"), Claude calls this server, and the server writes it through the portal's REST API, so it shows up in the web app immediately.

It talks to the **deployed backend API** (not MongoDB directly), so you don't need database credentials, and the backend's validation applies to everything Claude adds.

## Tools

| Tool | What it does |
|------|--------------|
| `add_contact` | Create one contact (`name`, `email`, `company`, `category` required; `phone`, `jobTitle`, `notes` optional) |
| `add_contacts_bulk` | Create up to 100 contacts in one go; reports which succeeded and which failed (e.g. duplicate email) |
| `list_contacts` | Search by name/email/company and/or filter by category (use it to avoid duplicates) |
| `get_contact` | Fetch one contact by `contactId` |
| `update_contact` | Partial update by `contactId` |
| `get_stats` | Dashboard numbers (total, companies, clients, recently added) |

Valid categories: `Client`, `Colleague`, `Business Partner`, `Vendor`, `Other`.

There is deliberately no delete tool, so a prompt can't remove data by accident.

## Setup

```bash
cd mcp-server
npm install
npm test        # optional: runs every tool against a local mock of the API
```

### Claude Desktop

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config), using the real absolute path to `server.js`, then restart Claude Desktop:

```json
{
  "mcpServers": {
    "contactflow": {
      "command": "node",
      "args": ["/absolute/path/to/Project1CC/mcp-server/server.js"],
      "env": {
        "CONTACTFLOW_API_URL": "https://project1cc-backend.onrender.com/api/contacts"
      }
    }
  }
}
```

### Claude Code

```bash
claude mcp add contactflow \
  --env CONTACTFLOW_API_URL=https://project1cc-backend.onrender.com/api/contacts \
  -- node /absolute/path/to/Project1CC/mcp-server/server.js
```

`CONTACTFLOW_API_URL` is optional; it defaults to the Render URL above. Point it at `http://localhost:5000/api/contacts` to use a local backend.

## Notes

- Render's free tier sleeps when idle, so the first request after a quiet period can take 30–60 seconds. The server waits up to 60 seconds before giving up.
- This is a local (stdio) server. The Claude app on the web can't launch it; use Claude Desktop or Claude Code on the machine where it's installed.
- The API has no authentication today, so anyone who knows the Render URL can add contacts. If you add auth to the backend later, pass the token to this server through an env var and send it in the `api()` helper in `server.js`.
