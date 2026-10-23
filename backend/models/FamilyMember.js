const mongoose = require("mongoose");

const RELATIONSHIPS = [
  "Spouse",
  "Parent",
  "Child",
  "Sibling",
  "Grandparent",
  "Grandchild",
  "Uncle/Aunt",
  "Cousin",
  "In-law",
  "Other",
];

const familyMemberSchema = new mongoose.Schema(
  {
    familyId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    relationship: {
      type: String,
      required: true,
      trim: true,
      enum: {
        values: RELATIONSHIPS,
        message: "Relationship must be one of: {VALUES}",
      },
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      default: "",
      maxlength: 200,
      match: [/^$|^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    phone: { type: String, trim: true, default: "", maxlength: 30 },
    birthday: { type: Date, default: null },
    address: { type: String, trim: true, default: "", maxlength: 300 },
    notes: { type: String, trim: true, default: "", maxlength: 1000 },
  },
  { timestamps: true, collection: "family" },
);

module.exports = {
  FamilyMember: mongoose.model("FamilyMember", familyMemberSchema),
  RELATIONSHIPS,
};
