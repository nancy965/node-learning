const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");
const authenticateToken = require("../middleware/authMiddleware");
const approvalUpload = require("../middleware/approvalUploadMiddleware");

const {
  createRequest,
  getMyRequests,
  getApprovalInbox,
  getRequestById,
  processDecision,
  cancelRequest,
  getApprovalStats,
  getApprovalRules,
} = require("../controllers/approvalController");

// Stats for badges/KPI cards
router.get(
  PATHS.APPROVALS.STATS,
  authenticateToken,
  getApprovalStats
);

// Rules configuration
router.get(
  PATHS.APPROVALS.RULES,
  authenticateToken,
  getApprovalRules
);

// Employee/User: Get requests created by logged-in user
router.get(
  PATHS.APPROVALS.GET_MY,
  authenticateToken,
  getMyRequests
);

// Approver/Admin: Get inbox (action required or history)
router.get(
  PATHS.APPROVALS.INBOX,
  authenticateToken,
  getApprovalInbox
);

// Get single request details by ID
router.get(
  PATHS.APPROVALS.GET_BY_ID,
  authenticateToken,
  getRequestById
);

// Create a new approval request (with optional attachments)
router.post(
  PATHS.APPROVALS.CREATE,
  authenticateToken,
  approvalUpload.array("files", 5),
  createRequest
);

// Process approval decision (Approve / Reject with optional files/comment)
router.post(
  PATHS.APPROVALS.DECIDE,
  authenticateToken,
  approvalUpload.array("files", 5),
  processDecision
);

// Cancel pending request
router.post(
  PATHS.APPROVALS.CANCEL,
  authenticateToken,
  cancelRequest
);

module.exports = router;
