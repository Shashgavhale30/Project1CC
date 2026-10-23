require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Import your Contact model (adjust the path if your model file is named differently)
const Contact = require("./models/Contact"); 

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

// Standard API routes
app.use("/api/contacts", contactsRouter);

// ==========================================
// NEW: Gemini AI Natural Language Endpoint
// ==========================================
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post("/api/ai-command", async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: "Prompt is required" });

  try {
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash",
      generationConfig: { responseMimeType: "application/json" }
    });

    const systemInstruction = `
      You are a contact manager API assistant. Convert the user's request into this strict JSON structure:
      {
        "action": "CREATE" | "UPDATE" | "DELETE",
        "data": { "name": "...", "email": "...", "phone": "..." } 
      }
      Only return the JSON. Extract as much info as provided. Do not invent details.
    `;

    const result = await model.generateContent(`${systemInstruction}\n\nUser request: ${prompt}`);
    const aiResponse = JSON.parse(result.response.text());

    // Execute database operations based on AI parsed intent
    if (aiResponse.action === 'CREATE') {
      const newContact = new Contact(aiResponse.data);
      await newContact.save();
      return res.json({ message: `Successfully added ${aiResponse.data.name}`, action: "CREATE", data: aiResponse.data });
    } 
    
    if (aiResponse.action === 'UPDATE') {
      // Find by name and update with the new data
      await Contact.findOneAndUpdate({ name: aiResponse.data.name }, aiResponse.data);
      return res.json({ message: `Successfully updated ${aiResponse.data.name}`, action: "UPDATE", data: aiResponse.data });
    }
    
    if (aiResponse.action === 'DELETE') {
      // Delete the contact by name
      await Contact.findOneAndDelete({ name: aiResponse.data.name });
      return res.json({ message: `Successfully deleted ${aiResponse.data.name}`, action: "DELETE", name: aiResponse.data.name });
    }

    return res.status(400).json({ error: "AI returned an unknown action" });

  } catch (error) {
    console.error("AI Error:", error);
    res.status(500).json({ error: "Failed to process AI command" });
  }
});
// ==========================================

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