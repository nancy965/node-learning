const path = require("path");
const fs = require("fs");
const emailService = require("../services/emailService");

/**
 * Helper to ensure user's email and name are loaded
 */
async function resolveCurrentUserInfo(user) {
  const userId = user.userId || user.registerId;
  let email = user.email;
  let name = user.name;

  if (!email || !name) {
    const userRow = await emailService.getUserById(userId);
    if (userRow) {
      email = userRow.email;
      name = userRow.name;
    }
  }

  return {
    userId,
    userEmail: email || "user@app.local",
    userName: name || "User",
  };
}

/**
 * GET /emails
 */
async function getEmails(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const {
      folder = "inbox",
      search = "",
      page = 1,
      limit = 20,
      filter = "all",
      searchFrom = "",
      searchTo = "",
      searchTime = "any",
      hasAttachment = false,
    } = req.query;

    const result = await emailService.getEmails({
      userId,
      userEmail,
      folder,
      search,
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 20,
      filter,
      searchFrom,
      searchTo,
      searchTime,
      hasAttachment,
    });

    return res.json({
      success: true,
      folder,
      ...result,
    });
  } catch (error) {
    console.error("GET EMAILS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to retrieve emails.",
    });
  }
}

/**
 * GET /emails/stats
 */
async function getMailboxStats(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const stats = await emailService.getMailboxStats({ userId, userEmail });

    return res.json({
      success: true,
      stats,
    });
  } catch (error) {
    console.error("GET MAILBOX STATS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to retrieve mailbox statistics.",
    });
  }
}

/**
 * GET /emails/recipients/search
 */
async function searchRecipients(req, res) {
  try {
    const { userId } = await resolveCurrentUserInfo(req.user);
    const { q = "" } = req.query;

    const results = await emailService.searchRecipients(q, userId);

    return res.json({
      success: true,
      recipients: results,
    });
  } catch (error) {
    console.error("SEARCH RECIPIENTS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to search recipients.",
    });
  }
}

/**
 * GET /emails/filter-contacts
 */
async function getFilterContacts(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const data = await emailService.getFilterContacts({ userId, userEmail });
    return res.json({
      success: true,
      ...data,
    });
  } catch (error) {
    console.error("GET FILTER CONTACTS ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to get filter contacts.",
    });
  }
}

/**
 * GET /emails/templates
 */
async function getTemplates(req, res) {
  try {
    const templates = await emailService.getTemplates();
    return res.json({
      success: true,
      templates,
    });
  } catch (error) {
    console.error("GET TEMPLATES ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to fetch email templates.",
    });
  }
}

/**
 * GET /emails/:id
 */
async function getEmailById(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const messageId = parseInt(req.params.id, 10);

    const email = await emailService.getEmailById({
      messageId,
      userId,
      userEmail,
    });

    return res.json({
      success: true,
      email,
    });
  } catch (error) {
    console.error("GET EMAIL BY ID ERROR:", error);
    return res.status(404).json({
      success: false,
      message: error.message || "Email not found.",
    });
  }
}

/**
 * POST /emails/send
 */
async function sendEmail(req, res) {
  try {
    const { userId, userEmail, userName } = await resolveCurrentUserInfo(req.user);
    const {
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
      draftId,
      scheduledAt,
    } = req.body;

    const email = await emailService.sendOrDraftEmail({
      senderId: userId,
      senderEmail: userEmail,
      senderName: userName,
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
      files: req.files || [],
      isDraft: false,
      draftId: draftId ? parseInt(draftId, 10) : null,
      scheduledAt: scheduledAt || null,
    });

    return res.status(201).json({
      success: true,
      message: scheduledAt ? "Email scheduled successfully." : "Email sent successfully.",
      email,
    });
  } catch (error) {
    console.error("SEND EMAIL ERROR:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to send email.",
    });
  }
}

/**
 * POST /emails/draft
 */
async function saveDraft(req, res) {
  try {
    const { userId, userEmail, userName } = await resolveCurrentUserInfo(req.user);
    const {
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
      draftId,
    } = req.body;

    const draft = await emailService.sendOrDraftEmail({
      senderId: userId,
      senderEmail: userEmail,
      senderName: userName,
      to,
      cc,
      bcc,
      subject,
      bodyHtml,
      bodyText,
      files: req.files || [],
      isDraft: true,
      draftId: draftId ? parseInt(draftId, 10) : null,
    });

    return res.json({
      success: true,
      message: "Draft saved.",
      draft,
    });
  } catch (error) {
    console.error("SAVE DRAFT ERROR:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to save draft.",
    });
  }
}

/**
 * PATCH /emails/:id/star
 */
async function toggleStar(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const messageId = parseInt(req.params.id, 10);

    const result = await emailService.toggleStar({
      messageId,
      userId,
      userEmail,
    });

    return res.json(result);
  } catch (error) {
    console.error("TOGGLE STAR ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update star status.",
    });
  }
}

/**
 * PATCH /emails/:id/read
 */
async function toggleRead(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const messageId = parseInt(req.params.id, 10);
    const { isRead = true } = req.body;

    const result = await emailService.toggleRead({
      messageId,
      userId,
      userEmail,
      isRead,
    });

    return res.json(result);
  } catch (error) {
    console.error("TOGGLE READ ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to update read status.",
    });
  }
}

/**
 * PATCH /emails/mark-all-read
 */
async function markAllAsRead(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const result = await emailService.markAllAsRead({ userId, userEmail });
    return res.json(result);
  } catch (error) {
    console.error("MARK ALL READ ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to mark all as read.",
    });
  }
}

/**
 * PATCH /emails/:id/trash
 */
async function moveToTrash(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const messageId = parseInt(req.params.id, 10);

    const result = await emailService.moveToTrash({
      messageId,
      userId,
      userEmail,
    });

    return res.json(result);
  } catch (error) {
    console.error("MOVE TO TRASH ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to move email to trash.",
    });
  }
}

/**
 * PATCH /emails/:id/restore
 */
async function restoreFromTrash(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const messageId = parseInt(req.params.id, 10);

    const result = await emailService.restoreFromTrash({
      messageId,
      userId,
      userEmail,
    });

    return res.json(result);
  } catch (error) {
    console.error("RESTORE FROM TRASH ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to restore email.",
    });
  }
}

/**
 * DELETE /emails/:id
 */
async function deletePermanently(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const messageId = parseInt(req.params.id, 10);

    const result = await emailService.deletePermanently({
      messageId,
      userId,
      userEmail,
    });

    return res.json(result);
  } catch (error) {
    console.error("DELETE PERMANENTLY ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to delete email permanently.",
    });
  }
}

/**
 * PATCH /emails/:id/archive
 */
async function archiveEmail(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const messageId = parseInt(req.params.id, 10);
    const isArchived = req.body.isArchived !== false;

    const result = await emailService.archiveEmail({
      messageId,
      userId,
      userEmail,
      isArchived,
    });

    return res.json(result);
  } catch (error) {
    console.error("ARCHIVE EMAIL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to archive email.",
    });
  }
}

/**
 * PATCH /emails/archive-bulk
 */
async function bulkArchive(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const messageIds = req.body.messageIds || [];
    const isArchived = req.body.isArchived !== false;

    const result = await emailService.bulkArchive({
      messageIds,
      userId,
      userEmail,
      isArchived,
    });

    return res.json(result);
  } catch (error) {
    console.error("BULK ARCHIVE ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to bulk archive emails.",
    });
  }
}

/**
 * GET /emails/attachments/:id/download
 */
async function downloadAttachment(req, res) {
  try {
    const { id } = req.params;
    const att = await emailService.getAttachmentById(id);
    if (!att) {
      return res.status(404).json({ success: false, message: "Attachment not found." });
    }

    const relativePath = att.file_path.startsWith("/") ? att.file_path.slice(1) : att.file_path;
    const absolutePath = path.join(__dirname, "..", relativePath);

    if (!fs.existsSync(absolutePath)) {
      return res.status(404).json({ success: false, message: "File not found on server." });
    }

    return res.download(absolutePath, att.original_name);
  } catch (error) {
    console.error("DOWNLOAD ATTACHMENT ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to download attachment.",
    });
  }
}


/**
 * POST /emails/:id/cancel-schedule
 */
async function cancelScheduledEmail(req, res) {
  try {
    const { id } = req.params;
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const success = await emailService.cancelScheduledEmail({
      messageId: parseInt(id, 10),
      userId,
      userEmail,
    });

    if (!success) {
      return res.status(404).json({
        success: false,
        message: "Scheduled email not found or already sent.",
      });
    }

    return res.json({
      success: true,
      message: "Scheduled email cancelled and reverted to draft.",
    });
  } catch (error) {
    console.error("CANCEL SCHEDULED EMAIL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to cancel scheduled email.",
    });
  }
}

/**
 * PATCH /emails/:id/snooze
 */
async function snoozeEmail(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const { id } = req.params;
    const { snoozedUntil } = req.body;
    if (!snoozedUntil) {
      return res.status(400).json({
        success: false,
        message: "snoozedUntil is required.",
      });
    }
    const result = await emailService.snoozeEmail({
      userId,
      userEmail,
      emailId: parseInt(id, 10),
      snoozedUntil,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("SNOOZE EMAIL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to snooze email.",
    });
  }
}

/**
 * PATCH /emails/:id/unsnooze
 */
async function unsnoozeEmail(req, res) {
  try {
    const { userId, userEmail } = await resolveCurrentUserInfo(req.user);
    const { id } = req.params;
    const result = await emailService.unsnoozeEmail({
      userId,
      userEmail,
      emailId: parseInt(id, 10),
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error("UNSNOOZE EMAIL ERROR:", error);
    return res.status(500).json({
      success: false,
      message: error.message || "Failed to unsnooze email.",
    });
  }
}

module.exports = {
  getEmails,
  getMailboxStats,
  searchRecipients,
  getTemplates,
  getEmailById,
  downloadAttachment,
  sendEmail,
  cancelScheduledEmail,
  saveDraft,
  toggleStar,
  toggleRead,
  markAllAsRead,
  moveToTrash,
  restoreFromTrash,
  deletePermanently,
  archiveEmail,
  bulkArchive,
  getFilterContacts,
  snoozeEmail,
  unsnoozeEmail,
};
