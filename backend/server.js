import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import axios from "axios";
import fs from "fs/promises";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

const API_URL =
  process.env.CONTACTFLOW_API_URL ||
  "https://project1cc-backend.onrender.com/api/contacts";
const API_TOKEN = process.env.CONTACTFLOW_API_TOKEN || "";
const PROJECT_ROOT = path.resolve(process.env.PROJECT_ROOT || "D:\\Project1CC");

// Files/folders the AI must never write to
const BLOCKED = [".git", "node_modules", ".env", ".mcp.json"];

const api = axios.create({
  timeout: 60000, // Render free tier cold start
  headers: API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {},
});

// Resolve a relative path and make sure it stays inside PROJECT_ROOT
function safePath(relPath) {
  const full = path.resolve(PROJECT_ROOT, relPath);
  const rel = path.relative(PROJECT_ROOT, full);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error("Path is outside the project directory");
  }
  const parts = rel.split(path.sep).map((p) => p.toLowerCase());
  if (parts.some((p) => BLOCKED.includes(p) || p.startsWith(".env"))) {
    throw new Error(`Writing to "${rel}" is blocked`);
  }
  return full;
}

async function git(...gitArgs) {
  return execFileAsync("git", gitArgs, { cwd: PROJECT_ROOT, windowsHide: true });
}

const text = (t) => ({ content: [{ type: "text", text: t }] });

const server = new Server(
  { name: "project1cc-mcp-server", version: "1.1.0" },
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

    // 3. GIT
    {
      name: "git_status",
      description: "Show git status of the project (changed files, current branch).",
      inputSchema: { type: "object", properties: {} },
    },
    {
      name: "git_commit_and_push",
      description:
        "Stage all changes, commit with a message, and push the current branch to GitHub.",
      inputSchema: {
        type: "object",
        properties: {
          commitMessage: {
            type: "string",
            description: "Commit message describing the changes",
          },
        },
        required: ["commitMessage"],
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

      case "read_project_file": {
        const full = path.resolve(PROJECT_ROOT, args.filePath);
        const rel = path.relative(PROJECT_ROOT, full);
        if (rel.startsWith("..") || path.isAbsolute(rel))
          throw new Error("Path is outside the project directory");
        if (rel.split(path.sep).some((p) => p.toLowerCase().startsWith(".env")))
          throw new Error("Reading .env files is blocked");
        return text(await fs.readFile(full, "utf8"));
      }
      case "edit_project_file": {
        const full = safePath(args.filePath);
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, args.content, "utf8");
        return text(`Wrote file: ${args.filePath}`);
      }

      case "git_status": {
        const { stdout } = await git("status", "--short", "--branch");
        return text(stdout || "Working tree clean");
      }
      case "git_commit_and_push": {
        await git("add", "-A");
        const { stdout: staged } = await git("status", "--porcelain");
        if (!staged.trim()) return text("Nothing to commit, working tree clean.");
        await git("commit", "-m", args.commitMessage);
        const { stdout, stderr } = await git("push", "origin", "HEAD");
        return text(`Committed and pushed.\n${stdout}${stderr}`);
      }

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