const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");
const authenticateToken = require("../middleware/authMiddleware");

const {
  createTicket,
  getMyTickets,
  getAllTickets,
  getTicketById,
  updateTicketStatus,
  assignTicket,
  getAvailableAgents,
  getTicketStats,
} = require("../controllers/ticketController");

// Stats for badges/KPI cards
router.get(
  PATHS.TICKETS.STATS,
  authenticateToken,
  getTicketStats
);

// Get available agents for assignment
router.get(
  PATHS.TICKETS.GET_AGENTS,
  authenticateToken,
  getAvailableAgents
);

// Employee: Get tickets created by logged-in user
router.get(
  PATHS.TICKETS.GET_MY,
  authenticateToken,
  getMyTickets
);

// Admin: Get all tickets with filters
router.get(
  PATHS.TICKETS.GET_ALL,
  authenticateToken,
  getAllTickets
);

// Get single ticket details
router.get(
  PATHS.TICKETS.GET_BY_ID,
  authenticateToken,
  getTicketById
);

const ticketUpload = require("../middleware/ticketUploadMiddleware");

// Create a new support ticket (with optional attachments)
router.post(
  PATHS.TICKETS.CREATE,
  authenticateToken,
  ticketUpload.array("files", 5),
  createTicket
);

// Update status & resolution note (with optional resolution attachments)
router.patch(
  PATHS.TICKETS.UPDATE_STATUS,
  authenticateToken,
  ticketUpload.array("files", 5),
  updateTicketStatus
);

// Assign ticket to agent
router.patch(
  PATHS.TICKETS.ASSIGN,
  authenticateToken,
  assignTicket
);

module.exports = router;
