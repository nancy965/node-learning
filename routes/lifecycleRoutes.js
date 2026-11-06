const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authMiddleware");

const {
  getTemplates,
  createTemplate,
  getEligibleEmployees,
  startLifecycle,
  getRecords,
  getRecordById,
  toggleItem,
  completeRecord,
  cancelRecord,
  getStats,
} = require("../controllers/lifecycleController");

// Stats for KPI cards
router.get("/stats", authenticateToken, getStats);

// Eligible employees for selector
router.get("/eligible-employees", authenticateToken, getEligibleEmployees);

// Templates
router.get("/templates", authenticateToken, getTemplates);
router.post("/templates", authenticateToken, createTemplate);

// Records
router.get("/records", authenticateToken, getRecords);
router.post("/records/start", authenticateToken, startLifecycle);
router.get("/records/:id", authenticateToken, getRecordById);
router.post("/records/:id/complete", authenticateToken, completeRecord);
router.post("/records/:id/cancel", authenticateToken, cancelRecord);

// Checklist items toggle
router.patch("/items/:itemId/toggle", authenticateToken, toggleItem);

module.exports = router;
