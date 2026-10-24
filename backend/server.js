require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// models/Contact.js exports { Contact, CATEGORIES }; destructure the model
const { Contact } = require("./models/Contact");
const contactsRouter = require("./routes/contacts");

const app = express();
const PORT = process.env.PORT || 5000;

// Render sits behind a proxy; needed for correct client IPs in rate limiting
app.set("trust proxy", 1);

// Allowed browser origins come from FRONTEND_URL (comma-separated).
// Set it on Render to the Vercel production URL, e.g. https://your-app.vercel.app
const DEFAULT_ALLOWED_ORIGINS = [];

function normalizeOrigin(origin) {
  return origin.trim().replace(/\/+$/, "");
}

const allowedOrigins = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.FRONTEND_URL || "")
    .split(",")
    .map((o) => normalizeOrigin(o))
    .filter(Boolean),
]);

if (process.env.NODE_ENV === "production" && allowedOrigins.size === 0) {
  console.warn(
    "FRONTEND_URL is not set: browser requests from the frontend will be blocked by CORS."
  );
}

const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

app.use(
  cors({
    // No Origin header (MCP server, curl, Postman) is allowed through
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      const normalizedOrigin = normalizeOrigin(origin);
      if (
        process.env.NODE_ENV !== "production" &&
        (normalizedOrigin === "null" || isLocalOrigin(normalizedOrigin))
      )
        return cb(null, true);
      if (allowedOrigins.has(normalizedOrigin)) return cb(null, true);
      cb(new Error("CORS: origin not allowed"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json({ limit: "100kb" }));

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "ContactFlow API running" });
});

// Standard CRUD routes (also used by the MCP server)
app.use("/api/contacts", contactsRouter);

// ==========================================
// Gemini AI natural-language endpoint
// ==========================================
const genAI = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const ALLOWED_ACTIONS = new Set(["CREATE", "READ", "UPDATE", "DELETE"]);
const ALLOWED_FIELDS = ["name", "email", "phone"];

const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests, slow down" },
});

// Keep only whitelisted string fields (blocks NoSQL operator injection like {"$ne": ""})
function sanitizeData(data) {
  const clean = {};
  if (!data || typeof data !== "object") return clean;
  for (const key of ALLOWED_FIELDS) {
    const val = data[key];
    if (typeof val === "string" && val.trim()) clean[key] = val.trim();
  }
  return clean;
}

// Case-insensitive exact match on name
const byName = (name) => ({ name });
const NAME_COLLATION = { locale: "en", strength: 2 };

const SYSTEM_INSTRUCTION = `
You are a contact manager API assistant. Convert the user's request into this strict JSON:
{
  "action": "CREATE" | "READ" | "UPDATE" | "DELETE",
  "data": { "name": "...", "email": "...", "phone": "..." }
}
Rules:
- Return only JSON.
- "name" identifies the contact. For UPDATE, put the new values in email/phone.
- READ with no name means list all contacts.
- Extract only what the user provided. Never invent details.
`;

app.post("/api/ai-command", aiLimiter, async (req, res) => {
  const { prompt } = req.body || {};
  if (typeof prompt !== "string" || !prompt.trim())
    return res.status(400).json({ error: "Prompt is required" });
  if (prompt.length > 500)
    return res.status(400).json({ error: "Prompt too long (max 500 chars)" });
  if (!genAI)
    return res.status(503).json({ error: "AI service not configured" });

  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: { responseMimeType: "application/json" },
    });

    const result = await model.generateContent(
      `${SYSTEM_INSTRUCTION}\n\nUser request: ${prompt}`
    );

    let aiResponse;
    try {
      aiResponse = JSON.parse(result.response.text());
    } catch {
      return res.status(502).json({ error: "AI returned invalid JSON" });
    }

    const action = String(aiResponse.action || "").toUpperCase();
    if (!ALLOWED_ACTIONS.has(action))
      return res.status(400).json({ error: "AI returned an unknown action" });

    const data = sanitizeData(aiResponse.data);

    if (action === "CREATE") {
      if (!data.name)
        return res.status(400).json({ error: "Name is required to create a contact" });
      const contact = await Contact.create(data);
      return res.status(201).json({
        message: `Successfully added ${contact.name}`,
        action,
        data: contact,
      });
    }

    if (action === "READ") {
      const contacts = data.name
        ? await Contact.find(byName(data.name)).collation(NAME_COLLATION)
        : await Contact.find();
      return res.json({ message: `Found ${contacts.length} contact(s)`, action, data: contacts });
    }

    // UPDATE and DELETE both need a name to target
    if (!data.name)
      return res.status(400).json({ error: "Name is required to identify the contact" });

    if (action === "UPDATE") {
      const { name, ...changes } = data;
      if (!Object.keys(changes).length)
        return res.status(400).json({ error: "Nothing to update" });
      const updated = await Contact.findOneAndUpdate(
        byName(name),
        { $set: changes },
        { new: true, runValidators: true, collation: NAME_COLLATION }
      );
      if (!updated) return res.status(404).json({ error: `Contact "${name}" not found` });
      return res.json({ message: `Successfully updated ${updated.name}`, action, data: updated });
    }

    if (action === "DELETE") {
      const deleted = await Contact.findOneAndDelete(byName(data.name), {
        collation: NAME_COLLATION,
      });
      if (!deleted) return res.status(404).json({ error: `Contact "${data.name}" not found` });
      return res.json({ message: `Successfully deleted ${deleted.name}`, action, name: deleted.name });
    }
  } catch (error) {
    console.error("AI Error:", error.message);
    res.status(500).json({ error: "Failed to process AI command" });
  }
});
// ==========================================

// 404 for unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Central error handler: never leaks stack traces or connection details
app.use((err, req, res, next) => {
  if (err && err.message && err.message.startsWith("CORS:")) {
    return res.status(403).json({ error: "Origin not allowed by CORS policy" });
  }
  console.error("Unhandled error:", err && err.message);
  res.status(500).json({ error: "Internal server error" });
});

// ==========================================
// MongoDB connection
// ==========================================

// Reads MONGODB_URI, tolerating common copy/paste mistakes (whitespace, wrapping quotes).
// Never logs the URI itself.
function getMongoUri() {
  const raw = process.env.MONGODB_URI;
  if (!raw || !raw.trim()) {
    console.error(
      "MONGODB_URI is not set. Add it in Render > Environment (or backend/.env locally)."
    );
    return null;
  }
  const uri = raw.trim().replace(/^['"]|['"]$/g, "");
  if (!/^mongodb(\+srv)?:\/\//.test(uri)) {
    console.error("MONGODB_URI must start with mongodb:// or mongodb+srv://");
    return null;
  }
  // More than one "@" in the authority means the password has an unencoded "@"
  const authority = uri.replace(/^mongodb(\+srv)?:\/\//, "").split("/")[0];
  if ((authority.match(/@/g) || []).length > 1) {
    console.error(
      "MONGODB_URI looks like its password contains an unencoded '@'. URL-encode special characters (e.g. @ -> %40)."
    );
    return null;
  }
  return uri;
}

// Strip any credentials that might appear in a driver error message
const redact = (msg) => String(msg || "").replace(/:\/\/\S*@/g, "://***@");

function mongoHint(msg) {
  if (/bad auth|authentication failed/i.test(msg))
    return "Check the Atlas database user and password (URL-encode special characters in the password).";
  if (/ENOTFOUND|querySrv|EAI_AGAIN/i.test(msg))
    return "Check the cluster hostname in MONGODB_URI.";
  if (/ECONNREFUSED|timed out|ReplicaSetNoPrimary|Server selection/i.test(msg))
    return "Check Atlas > Network Access allows connections from Render (e.g. 0.0.0.0/0).";
  return "";
}

const mongoUri = getMongoUri();
if (!mongoUri) process.exit(1);

const connectOptions = { serverSelectionTimeoutMS: 15000 };
// Optional: force a specific database when the URI has no /dbname segment
// (without one, MongoDB silently uses a database called "test").
if (process.env.MONGODB_DB_NAME && process.env.MONGODB_DB_NAME.trim()) {
  connectOptions.dbName = process.env.MONGODB_DB_NAME.trim();
}

mongoose
  .connect(mongoUri, connectOptions)
  .then(() => {
    console.log(`Connected to MongoDB Atlas (database: ${mongoose.connection.name})`);
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    const msg = redact(err.message);
    console.error("MongoDB connection failed:", msg);
    const hint = mongoHint(msg);
    if (hint) console.error("Hint:", hint);
    process.exit(1);
  });
