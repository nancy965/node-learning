const express = require("express");
const router = express.Router();
const emailController = require("../controllers/emailController");
const authenticateToken = require("../middleware/authMiddleware");
const emailUpload = require("../middleware/emailUploadMiddleware");

// All email routes require authentication
router.use(authenticateToken);

// Stats & folder counts
router.get("/stats", emailController.getMailboxStats);

// Search users/recipients for auto-completion
router.get("/recipients/search", emailController.searchRecipients);

// Distinct contacts for search filter dropdowns (From / To)
router.get("/filter-contacts", emailController.getFilterContacts);

// Predefined email templates
router.get("/templates", emailController.getTemplates);

// List emails with filter & search
router.get("/", emailController.getEmails);

// Send new email with attachments
router.post("/send", emailUpload.array("attachments", 10), emailController.sendEmail);

// Save / update draft
router.post("/:id/cancel-schedule", emailController.cancelScheduledEmail);
router.post("/draft", emailUpload.array("attachments", 10), emailController.saveDraft);

// Mark all as read
router.patch("/mark-all-read", emailController.markAllAsRead);

// Download attachment directly
router.get(
  "/attachments/:id/download",
  (req, res, next) => {
    if (req.query.token && !req.headers.authorization) {
      req.headers.authorization = `Bearer ${req.query.token}`;
    }
    next();
  },
  emailController.downloadAttachment
);

// Get single email details
router.get("/:id", emailController.getEmailById);

// Archive actions
router.patch("/archive-bulk", emailController.bulkArchive);
router.patch("/:id/archive", emailController.archiveEmail);

// Snooze / Unsnooze
router.patch("/:id/snooze", emailController.snoozeEmail);
router.patch("/:id/unsnooze", emailController.unsnoozeEmail);

// Actions on an email
router.patch("/:id/star", emailController.toggleStar);
router.patch("/:id/read", emailController.toggleRead);
router.patch("/:id/trash", emailController.moveToTrash);
router.patch("/:id/restore", emailController.restoreFromTrash);
router.delete("/:id", emailController.deletePermanently);

module.exports = router;
