require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

const contactsRouter = require("./routes/contacts");

const DEFAULT_ALLOWED_ORIGINS = [
  "https://project1cc.netlify.app",
];

function normalizeOrigin(origin) {
  return origin.trim().replace(/\/+$/, "");
}

// allowed origins from env (comma-separated), plus the deployed Netlify app
const allowedOrigins = new Set([
  ...DEFAULT_ALLOWED_ORIGINS,
  ...(process.env.FRONTEND_URL || "")
    .split(",")
    .map((o) => normalizeOrigin(o))
    .filter(Boolean),
]);

const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    const normalizedOrigin = normalizeOrigin(origin);
    if (process.env.NODE_ENV !== "production" && (normalizedOrigin === "null" || isLocalOrigin(normalizedOrigin)))
      return cb(null, true);
    if (allowedOrigins.has(normalizedOrigin)) return cb(null, true);
    cb(new Error("CORS: origin not allowed"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

app.use(express.json());

// Health check
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "ContactFlow API running" });
});

// API routes
app.use("/api/contacts", contactsRouter);

// 404 for unknown API routes
app.use("/api", (req, res) => {
  res.status(404).json({ error: "API route not found" });
});

// Central error handler — never leaks stack traces or connection details.
app.use((err, req, res, next) => {
  if (err && err.message && err.message.startsWith("CORS:")) {
    return res.status(403).json({ error: "Origin not allowed by CORS policy" });
  }
  console.error("Unhandled error:", err.message);
  res.status(500).json({ error: "Internal server error" });
});

mongoose.connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("Connected to MongoDB Atlas");
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("MongoDB connection failed:", err.message);
    process.exit(1);
  });
