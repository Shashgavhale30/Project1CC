const { FamilyMember, RELATIONSHIPS } = require("../models/FamilyMember");

const EMAIL_RE = /^\S+@\S+\.\S+$/;

function escapeRegex(str) {
  return str.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&");
}

// ── Input validation (shared by create & update) ───────────
function validateFamilyInput(data, { partial = false } = {}) {
  const errors = [];

  if (!partial || data.name !== undefined) {
    if (!data.name || !String(data.name).trim())
      errors.push("Full name is required.");
    else if (String(data.name).trim().length > 100)
      errors.push("Full name must be 100 characters or fewer.");
  }
  if (!partial || data.relationship !== undefined) {
    if (!RELATIONSHIPS.includes(data.relationship))
      errors.push("Relationship must be one of: " + RELATIONSHIPS.join(", ") + ".");
  }
  if (data.email !== undefined) {
    const email = String(data.email || "").trim();
    if (email && !EMAIL_RE.test(email))
      errors.push("Please provide a valid email address.");
  }
  if (data.phone !== undefined && String(data.phone).trim().length > 30)
    errors.push("Phone number must be 30 characters or fewer.");
  if (data.birthday !== undefined && data.birthday !== null && data.birthday !== "") {
    const d = new Date(data.birthday);
    if (Number.isNaN(d.getTime())) errors.push("Birthday must be a valid date.");
    else if (d.getTime() > Date.now()) errors.push("Birthday cannot be in the future.");
  }
  if (data.address !== undefined && String(data.address).trim().length > 300)
    errors.push("Address must be 300 characters or fewer.");
  if (data.notes !== undefined && String(data.notes).trim().length > 1000)
    errors.push("Notes must be 1000 characters or fewer.");

  return errors;
}

function normalizeFamilyPayload(body) {
  const payload = {};
  if (body.name !== undefined) payload.name = String(body.name).trim();
  if (body.relationship !== undefined)
    payload.relationship = String(body.relationship).trim();
  if (body.email !== undefined)
    payload.email = String(body.email).trim().toLowerCase();
  if (body.phone !== undefined) payload.phone = String(body.phone).trim();
  if (body.birthday !== undefined)
    payload.birthday =
      body.birthday === null || body.birthday === "" ? null : new Date(body.birthday);
  if (body.address !== undefined) payload.address = String(body.address).trim();
  if (body.notes !== undefined) payload.notes = String(body.notes).trim();
  return payload;
}

// ── Data operations ────────────────────────────────────────

async function listFamily({ search = "", relationship = "" } = {}) {
  const filter = {};
  if (search && search.trim()) {
    const rx = new RegExp(escapeRegex(search.trim()), "i");
    filter.$or = [{ name: rx }, { email: rx }, { phone: rx }];
  }
  if (relationship && relationship.trim()) {
    filter.relationship = relationship.trim();
  }
  return FamilyMember.find(filter).sort({ createdAt: -1 }).lean();
}

async function getFamilyMemberById(familyId) {
  return FamilyMember.findOne({ familyId }).lean();
}

async function createFamilyMember(data) {
  const familyId =
    data.familyId && String(data.familyId).trim()
      ? String(data.familyId).trim()
      : `FM-${Date.now().toString(36).toUpperCase()}-${Math.random()
          .toString(36)
          .slice(2, 6)
          .toUpperCase()}`;
  const payload = normalizeFamilyPayload(data);
  payload.familyId = familyId;
  return FamilyMember.create(payload);
}

async function updateFamilyMember(familyId, data) {
  const payload = normalizeFamilyPayload(data);
  return FamilyMember.findOneAndUpdate({ familyId }, payload, {
    new: true,
    runValidators: true,
    context: "query",
  }).lean();
}

async function deleteFamilyMember(familyId) {
  return FamilyMember.findOneAndDelete({ familyId }).lean();
}

// Members whose birthday falls within the next `days` days (default 30).
async function getUpcomingBirthdays(days = 30) {
  const members = await FamilyMember.find({ birthday: { $ne: null } }).lean();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return members
    .map((m) => {
      const b = new Date(m.birthday);
      let next = new Date(today.getFullYear(), b.getUTCMonth(), b.getUTCDate());
      if (next < today)
        next = new Date(today.getFullYear() + 1, b.getUTCMonth(), b.getUTCDate());
      const daysUntil = Math.round((next - today) / (24 * 60 * 60 * 1000));
      return { ...m, nextBirthday: next, daysUntil };
    })
    .filter((m) => m.daysUntil <= days)
    .sort((a, b) => a.daysUntil - b.daysUntil);
}

async function getFamilyStats() {
  const [total, byRelationship] = await Promise.all([
    FamilyMember.countDocuments({}),
    FamilyMember.aggregate([
      { $group: { _id: "$relationship", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
    ]),
  ]);
  return {
    totalFamilyMembers: total,
    byRelationship: byRelationship.map((r) => ({
      relationship: r._id,
      count: r.count,
    })),
  };
}

function toServiceError(err) {
  if (err && err.code === 11000) {
    return { status: 409, message: "A family member with this ID already exists." };
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
  validateFamilyInput,
  normalizeFamilyPayload,
  listFamily,
  getFamilyMemberById,
  createFamilyMember,
  updateFamilyMember,
  deleteFamilyMember,
  getUpcomingBirthdays,
  getFamilyStats,
  toServiceError,
};
