const express = require("express");
const service = require("../services/familyService");
const { RELATIONSHIPS } = require("../models/FamilyMember");

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
    const members = await service.listFamily({
      search: req.query.search || "",
      relationship: req.query.relationship || "",
    });
    res.json(members);
  }),
);

router.get("/relationships", (req, res) => {
  res.json(RELATIONSHIPS);
});

router.get(
  "/stats",
  handle(async (req, res) => {
    res.json(await service.getFamilyStats());
  }),
);

router.get(
  "/birthdays",
  handle(async (req, res) => {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
    res.json(await service.getUpcomingBirthdays(days));
  }),
);

router.get(
  "/:id",
  handle(async (req, res) => {
    const member = await service.getFamilyMemberById(req.params.id);
    if (!member) return res.status(404).json({ error: "Family member not found" });
    res.json(member);
  }),
);

router.post(
  "/",
  handle(async (req, res) => {
    const errors = service.validateFamilyInput(req.body);
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });
    const created = await service.createFamilyMember(req.body);
    res.status(201).json(created);
  }),
);

router.put(
  "/:id",
  handle(async (req, res) => {
    const errors = service.validateFamilyInput(req.body, { partial: true });
    if (errors.length) return res.status(400).json({ error: errors.join(" ") });
    const updated = await service.updateFamilyMember(req.params.id, req.body);
    if (!updated) return res.status(404).json({ error: "Family member not found" });
    res.json(updated);
  }),
);

router.delete(
  "/:id",
  handle(async (req, res) => {
    const deleted = await service.deleteFamilyMember(req.params.id);
    if (!deleted) return res.status(404).json({ error: "Family member not found" });
    res.json({ message: `Family member '${req.params.id}' deleted` });
  }),
);

module.exports = router;
