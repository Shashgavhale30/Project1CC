/**
 * server.js — Tier 2 (Backend)
 * Express REST API for Student Information Management System.
 * Sits between the Netlify frontend and MongoDB Atlas.
 * All configuration comes from environment variables — no hardcoded secrets.
 */

require("dotenv").config(); // Load .env into process.env (ignored in production; Render injects env vars directly)
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// ─── CORS ────────────────────────────────────────────────────────────────────
// Allow ONLY the origins listed in FRONTEND_URL (comma-separated).
// This blocks requests from any other origin — satisfies the security requirement.
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin: function (origin, callback) {
      // Allow server-to-server requests (e.g., curl, Postman) where origin is undefined
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      callback(new Error(`CORS: origin '${origin}' is not allowed.`));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  })
);

// ─── MIDDLEWARE ───────────────────────────────────────────────────────────────
app.use(express.json()); // Parse incoming JSON request bodies

// ─── MONGOOSE SCHEMA & MODEL ──────────────────────────────────────────────────
// Tier 3 interface: defines the shape of a "Student" document in MongoDB Atlas.
const studentSchema = new mongoose.Schema(
  {
    studentId: {
      type: String,
      required: [true, "Student ID is required"],
      unique: true,
      trim: true,
    },
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, "Please enter a valid email address"],
    },
    department: {
      type: String,
      required: [true, "Department is required"],
      trim: true,
    },
    semester: {
      type: Number,
      required: [true, "Semester is required"],
      min: [1, "Semester must be between 1 and 12"],
      max: [12, "Semester must be between 1 and 12"],
    },
    contact: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt fields automatically
  }
);

const Student = mongoose.model("Student", studentSchema);

// ─── HELPER ───────────────────────────────────────────────────────────────────
// Escape special regex characters to prevent regex injection from search queries
function escapeRegex(text) {
  return text.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET / — Health check; confirms the API is alive
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Student Information Management System API is running",
    timestamp: new Date().toISOString(),
  });
});

// GET /api/students — Fetch all students; optional ?search=<text> filters by name
app.get("/api/students", async (req, res) => {
  try {
    const { search } = req.query;
    let filter = {};

    if (search && search.trim()) {
      // Case-insensitive partial match on name; regex is sanitized against injection
      const safeSearch = escapeRegex(search.trim());
      filter.name = { $regex: safeSearch, $options: "i" };
    }

    const students = await Student.find(filter).sort({ createdAt: -1 });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/students/:id — Fetch one student by studentId field (not MongoDB _id)
app.get("/api/students/:id", async (req, res) => {
  try {
    const student = await Student.findOne({ studentId: req.params.id });
    if (!student) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/students — Create a new student record
app.post("/api/students", async (req, res) => {
  try {
    const student = new Student(req.body);
    const saved = await student.save();
    res.status(201).json(saved);
  } catch (err) {
    // Duplicate key error (studentId already exists)
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ error: `Student ID '${req.body.studentId}' already exists` });
    }
    // Mongoose validation error (missing required field, bad email, etc.)
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join("; ") });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/students/:id — Update an existing student by studentId
app.put("/api/students/:id", async (req, res) => {
  try {
    const updated = await Student.findOneAndUpdate(
      { studentId: req.params.id },
      req.body,
      {
        new: true,           // Return the updated document
        runValidators: true, // Re-run schema validation on update
      }
    );
    if (!updated) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json(updated);
  } catch (err) {
    if (err.name === "ValidationError") {
      const messages = Object.values(err.errors).map((e) => e.message);
      return res.status(400).json({ error: messages.join("; ") });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/students/:id — Delete a student by studentId
app.delete("/api/students/:id", async (req, res) => {
  try {
    const deleted = await Student.findOneAndDelete({ studentId: req.params.id });
    if (!deleted) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json({ message: `Student '${req.params.id}' deleted successfully` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DATABASE CONNECTION & SERVER START ───────────────────────────────────────
// Connect to Tier 3 (MongoDB Atlas), then start listening for Tier 1 (frontend) requests
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => {
    console.log("✅ Connected to MongoDB Atlas");
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("❌ MongoDB connection error:", err.message);
    process.exit(1); // Exit so Render can detect the failure and restart
  });
