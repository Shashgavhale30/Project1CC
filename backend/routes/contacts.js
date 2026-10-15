const express = require("express");
const service = require("../services/contactService");

const router = express.Router();

// Wrap an async service call with consistent error handling.
function handle(fn) {
  return async (req, res) => {
    try {
      await fn(req, res);
    } catch (err) {
      const { status, message } = service.toServiceError(err);
      res.status(status).json({ error: message });
    }
  };
}

router.get(
  "/",
  handle(async (req, res) => {
    const contacts = await service.listContacts({
      search: req.query.search || "",
      category: req.query.category || "",
    });
    res.json(contacts);
  }),
);

router.get(
  "/stats",
  handle(async (req, res) => {
    res.json(await service.getStats());
  }),
);

router.get(
  "/:id",
  handle(async (req, res) => {
    const contact = await service.getContactById(req.params.id);
    if (!contact) return res.status(404).json({ error: "Contact not found" });
    res.json(contact);
  }),
);

router.post(
  "/",
  handle(async (req, res) => {
    const errors = service.validateContactInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });
    const created = await service.createContact(req.body);
    res.status(201).json(created);
  }),
);

router.put(
  "/:id",
  handle(async (req, res) => {
    const errors = service.validateContactInput(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });
    const updated = await service.updateContact(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Contact not found" });
    res.json(updated);
  }),
);

router.delete(
  "/:id",
  handle(async (req, res) => {
    const deleted = await service.deleteContact(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Contact not found" });
    res.json({ message: `Contact '${req.params.id}' deleted` });
  }),
);

module.exports = router;
