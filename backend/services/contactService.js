const { Contact } = require("../models/Contact");

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function escapeRegex(str) {
  return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

// ── Input validation (shared by create & update) ───────────
function validateContactInput(data, { partial = false } = {}) {
  const errors = [];

  if (!partial || data.name !== undefined) {
    if (!data.name || !String(data.name).trim())
      errors.push("Full name is required.");
    else if (String(data.name).trim().length > 100)
      errors.push("Full name must be 100 characters or fewer.");
  }
  if (!partial || data.email !== undefined) {
    const email = String(data.email || "").trim();
    if (!email) errors.push("Email address is required.");
    else if (!EMAIL_RE.test(email))
      errors.push("Please provide a valid email address.");
  }
  if (!partial || data.company !== undefined) {
    if (!data.company || !String(data.company).trim())
      errors.push("Company / organization is required.");
    else if (String(data.company).trim().length > 120)
      errors.push("Company name must be 120 characters or fewer.");
  }
  if (data.category !== undefined || !partial) {
    const valid = [
      "Client",
      "Colleague",
      "Business Partner",
      "Vendor",
      "Other",
    ];
    if (!valid.includes(data.category)) {
      errors.push("Category must be one of: " + valid.join(", ") + ".");
    }
  }
  if (data.phone !== undefined && String(data.phone).trim().length > 30)
    errors.push("Phone number must be 30 characters or fewer.");
  if (data.jobTitle !== undefined && String(data.jobTitle).trim().length > 120)
    errors.push("Job title must be 120 characters or fewer.");
  if (data.notes !== undefined && String(data.notes).trim().length > 1000)
    errors.push("Notes must be 1000 characters or fewer.");

  return errors;
}

// Build a clean, normalized payload from a request body.
function normalizeContactPayload(body) {
  const payload = {};
  if (body.name !== undefined) payload.name = String(body.name).trim();
  if (body.email !== undefined)
    payload.email = String(body.email).trim().toLowerCase();
  if (body.phone !== undefined) payload.phone = String(body.phone).trim();
  if (body.company !== undefined) payload.company = String(body.company).trim();
  if (body.jobTitle !== undefined)
    payload.jobTitle = String(body.jobTitle).trim();
  if (body.category !== undefined)
    payload.category = String(body.category).trim();
  if (body.notes !== undefined) payload.notes = String(body.notes).trim();
  return payload;
}

// ── Data operations (kept separate from HTTP handlers so a
//    future MCP server can reuse them directly) ──────────────

async function listContacts({ search = "", category = "" } = {}) {
  const filter = {};
  if (search && search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), "i");
    filter.$or = [{ name: rx }, { email: rx }, { company: rx }];
  }
  if (category && category.trim()) {
    filter.category = category.trim();
  }
  return Contact.find(filter).sort({ createdAt: -1 }).lean();
}

async function getContactById(contactId) {
  return Contact.findOne({ contactId }).lean();
}

async function createContact(data) {
  const contactId =
    data.contactId && String(data.contactId).trim()
      ? String(data.contactId).trim()
      : `CT-${Date.now().toString(36).toUpperCase()}-${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`;
  const payload = normalizeContactPayload(data);
  payload.contactId = contactId;
  return Contact.create(payload);
}

async function updateContact(contactId, data) {
  const payload = normalizeContactPayload(data);
  return Contact.findOneAndUpdate({ contactId }, payload, {
    new: true,
    runValidators: true,
    context: "query",
  }).lean();
}

async function deleteContact(contactId) {
  return Contact.findOneAndDelete({ contactId }).lean();
}

// Aggregate summary metrics for the dashboard.
async function getStats() {
  const [total, companies, clients, recent] = await Promise.all([
    Contact.countDocuments({}),
    Contact.distinct("company"),
    Contact.countDocuments({ category: "Client" }),
    Contact.countDocuments({
      createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    }),
  ]);
  return {
    totalContacts: total,
    companies: companies.length,
    clients,
    recentlyAdded: recent,
  };
}

// Translate common Mongo errors into user-facing messages.
function toServiceError(err) {
  if (err && err.code === 11000) {
    return {
      status: 409,
      message: "A contact with this ID or email already exists.",
    };
  }
  if (err && err.name === "ValidationError") {
    return {
      status: 400,
      message: Object.values(err.errors)
        .map((e) => e.message)
        .join("; "),
    };
  }
  return { status: 500, message: "Internal server error." };
}

module.exports = {
  validateContactInput,
  normalizeContactPayload,
  listContacts,
  getContactById,
  createContact,
  updateContact,
  deleteContact,
  getStats,
  toServiceError,
};
