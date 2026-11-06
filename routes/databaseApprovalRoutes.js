const express = require("express");
const router = express.Router();
const authenticateToken = require("../middleware/authMiddleware");

const {
  createChangeRequest,
  getChangeRequests,
  getChangeStats,
  getChangeRequestById,
  approveChangeRequest,
  rejectChangeRequest,
  rollbackChangeRequest,
} = require("../controllers/databaseApprovalController");

// Stats for badges & counters
router.get("/stats", authenticateToken, getChangeStats);

// List all change requests with filters
router.get("/all", authenticateToken, getChangeRequests);

// Get single request details
router.get("/get/:id", authenticateToken, getChangeRequestById);

// Create a new database change request
router.post("/create", authenticateToken, createChangeRequest);

// Approve and apply database change transaction
router.post("/approve/:id", authenticateToken, approveChangeRequest);

// Reject change request
router.post("/reject/:id", authenticateToken, rejectChangeRequest);

// Rollback / revert approved change back to old value
router.post("/rollback/:id", authenticateToken, rollbackChangeRequest);

module.exports = router;
