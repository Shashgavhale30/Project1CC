require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// allowed origins from env (comma-separated)
const allowedOrigins = (process.env.FRONTEND_URL || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    if (!origin) return cb(null, true);
    if (origin === "null" && process.env.NODE_ENV !== "production") return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error("CORS: origin not allowed"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type"],
}));

app.use(express.json());

const studentSchema = new mongoose.Schema({
  studentId:  { type: String, required: true, unique: true, trim: true },
  name:       { type: String, required: true, trim: true },
  email:      { type: String, required: true, trim: true, lowercase: true,
                match: [/^\S+@\S+\.\S+$/, "Invalid email"] },
  department: { type: String, required: true, trim: true },
  semester:   { type: Number, required: true, min: 1, max: 12 },
  contact:    { type: String, trim: true, default: "" },
}, { timestamps: true });

const Student = mongoose.model("Student", studentSchema);

function escapeRegex(str) {
  return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Student API running" });
});

app.get("/api/students", async (req, res) => {
  try {
    const filter = req.query.search
      ? { name: { $regex: escapeRegex(req.query.search.trim()), $options: "i" } }
      : {};
    const students = await Student.find(filter).sort({ createdAt: -1 });
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/students/:id", async (req, res) => {
  try {
    const student = await Student.findOne({ studentId: req.params.id });
    if (!student) return res.status(404).json({ error: "Student not found" });
    res.json(student);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/students", async (req, res) => {
  try {
    const saved = await new Student(req.body).save();
    res.status(201).json(saved);
  } catch (err) {
    if (err.code === 11000)
      return res.status(409).json({ error: `Student ID '${req.body.studentId}' already exists` });
    if (err.name === "ValidationError")
      return res.status(400).json({ error: Object.values(err.errors).map(e => e.message).join("; ") });
    res.status(500).json({ error: err.message });
  }
});

app.put("/api/students/:id", async (req, res) => {
  try {
    const updated = await Student.findOneAndUpdate(
      { studentId: req.params.id },
      req.body,
      { new: true, runValidators: true }
    );
    if (!updated) return res.status(404).json({ error: "Student not found" });
    res.json(updated);
  } catch (err) {
    if (err.name === "ValidationError")
      return res.status(400).json({ error: Object.values(err.errors).map(e => e.message).join("; ") });
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/students/:id", async (req, res) => {
  try {
    const deleted = await Student.findOneAndDelete({ studentId: req.params.id });
    if (!deleted) return res.status(404).json({ error: "Student not found" });
    res.json({ message: `Student '${req.params.id}' deleted` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
