const mongoose = require("mongoose");

const CATEGORIES = [
  "Client",
  "Colleague",
  "Business Partner",
  "Vendor",
  "Other",
];

const contactSchema = new mongoose.Schema(
  {
    contactId: { type: String, required: true, unique: true, trim: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 200,
      match: [/^\S+@\S+\.\S+$/, "Please provide a valid email address"],
    },
    phone: { type: String, trim: true, default: "", maxlength: 30 },
    company: { type: String, required: true, trim: true, maxlength: 120 },
    jobTitle: { type: String, trim: true, default: "", maxlength: 120 },
    category: {
      type: String,
      required: true,
      trim: true,
      enum: {
        values: CATEGORIES,
        message: "Category must be one of: {VALUES}",
      },
    },
    notes: { type: String, trim: true, default: "", maxlength: 1000 },
  },
  { timestamps: true, collection: "contacts" },
);

module.exports = {
  Contact: mongoose.model("Contact", contactSchema),
  CATEGORIES,
};
