const pool = require("../config/databse");
const nodemailer = require("nodemailer");
const path = require("path");
const fs = require("fs");

let cachedTransporter = null;

/**
 * Get or create an SMTP transporter.
 * Uses environment variables if provided (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS),
 * or falls back to an Ethereal test account so local development always works flawlessly!
 */
async function getTransporter() {
  if (cachedTransporter) {
    return cachedTransporter;
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    cachedTransporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || "587", 10),
      secure:
        process.env.SMTP_SECURE === "true" || process.env.SMTP_PORT === "465",
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    return cachedTransporter;
  }

  // Fallback: Automatic Ethereal test account for local testing & development
  try {
    const testAccount = await nodemailer.createTestAccount();
    cachedTransporter = nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
    });
    console.log(
      "EmailCenter: Initialized Ethereal test SMTP account:",
      testAccount.user,
    );
    return cachedTransporter;
  } catch (err) {
    console.warn(
      "EmailCenter: Could not create Ethereal account, using JSON/stream transport fallback:",
      err.message,
    );
    cachedTransporter = nodemailer.createTransport({
      jsonTransport: true,
    });
    return cachedTransporter;
  }
}

/**
 * Search existing employees/admins to auto-populate recipient suggestions
 */
async function searchRecipients(query = "", currentUserId = null) {
  const searchTerm = `%${query.trim().toLowerCase()}%`;
  const result = await pool.query(
    `
    SELECT id, name, email, role, is_active
    FROM (
      SELECT id, name, email, role, is_active FROM admin
      UNION ALL
      SELECT id, name, email, role, is_active FROM users
    ) AS all_accounts
    WHERE (LOWER(name) LIKE $1 OR LOWER(email) LIKE $1)
      ${currentUserId ? "AND id != $2" : ""}
    ORDER BY name ASC
    LIMIT 20;
    `,
    currentUserId ? [searchTerm, currentUserId] : [searchTerm],
  );
  return result.rows;
}

/**
 * Get active user details by ID (searches admin, users, and register tables)
 */
async function getUserById(userId) {
  if (!userId) return null;

  // 1. Check admin table
  const adminRes = await pool.query(
    `SELECT id, name, email, role FROM admin WHERE id = $1 LIMIT 1;`,
    [userId],
  );
  if (adminRes.rows.length > 0) return adminRes.rows[0];

  // 2. Check users table
  const userRes = await pool.query(
    `SELECT id, name, email, role FROM users WHERE id = $1 LIMIT 1;`,
    [userId],
  );
  if (userRes.rows.length > 0) return userRes.rows[0];

  // 3. Check register table fallback
  const regRes = await pool.query(
    `SELECT id, name, email, role FROM register WHERE id = $1 LIMIT 1;`,
    [userId],
  );
  if (regRes.rows.length > 0) return regRes.rows[0];

  return null;
}

/**
 * Normalize and parse recipient list
 */
function parseRecipients(recipientsInput) {
  if (!recipientsInput) return [];
  if (Array.isArray(recipientsInput)) {
    return recipientsInput
      .map((r) =>
        typeof r === "string" ? r.trim() : r.email ? r.email.trim() : "",
      )
      .filter(Boolean);
  }
  if (typeof recipientsInput === "string") {
    try {
      const parsed = JSON.parse(recipientsInput);
      if (Array.isArray(parsed)) {
        return parseRecipients(parsed);
      }
    } catch {
      // Comma-separated fallback
      return recipientsInput
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
    }
  }
  return [];
}

/**
 * Send or Save Draft Email
 */
async function sendOrDraftEmail({
  senderId,
  senderEmail,
  senderName,
  to,
  cc = [],
  bcc = [],
  subject = "",
  bodyHtml = "",
  bodyText = "",
  files = [],
  isDraft = false,
  draftId = null,
  scheduledAt = null,
}) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const isScheduled = !!scheduledAt && !isDraft;

    const toList = parseRecipients(to);
    const ccList = parseRecipients(cc);
    const bccList = parseRecipients(bcc);

    if (!isDraft && toList.length === 0) {
      throw new Error(
        "At least one 'To' recipient is required to send an email.",
      );
    }

    let messageId = null;

    if (draftId) {
      // Update existing draft
      const updateRes = await client.query(
        `
        UPDATE mail_messages
        SET subject = $1, body_html = $2, body_text = $3, is_draft = $4, is_sent = $5,
            is_scheduled = $6, scheduled_at = $7, delivery_status = $8, updated_at = NOW()
        WHERE id = $9 AND sender_id = $10
        RETURNING id;
        `,
        [
          subject,
          bodyHtml,
          bodyText,
          isDraft,
          !isDraft && !isScheduled,
          isScheduled,
          isScheduled ? new Date(scheduledAt) : null,
          isDraft ? "draft" : (isScheduled ? "scheduled" : "sending"),
          draftId,
          senderId,
        ],
      );
      if (updateRes.rows.length > 0) {
        messageId = updateRes.rows[0].id;
        // Clear previous recipients for this draft
        await client.query(
          `DELETE FROM mail_recipients WHERE message_id = $1;`,
          [messageId],
        );
      }
    }

    if (!messageId) {
      // Insert new message
      const insertRes = await client.query(
        `
        INSERT INTO mail_messages (
          sender_id, sender_email, sender_name, subject, body_html, body_text,
          is_draft, is_sent, is_scheduled, scheduled_at, delivery_status
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id;
        `,
        [
          senderId,
          senderEmail,
          senderName,
          subject,
          bodyHtml,
          bodyText,
          isDraft,
          !isDraft && !isScheduled,
          isScheduled,
          isScheduled ? new Date(scheduledAt) : null,
          isDraft ? "draft" : (isScheduled ? "scheduled" : "sending"),
        ],
      );
      messageId = insertRes.rows[0].id;
    }

    // Insert recipients
    const allRecipients = [
      ...toList.map((e) => ({ email: e, type: "to" })),
      ...ccList.map((e) => ({ email: e, type: "cc" })),
      ...bccList.map((e) => ({ email: e, type: "bcc" })),
    ];

    const notifiedRecipientIds = new Set();

    for (const r of allRecipients) {
      // Check if recipient is a registered system user (admin or employee)
      const userMatch = await client.query(
        `
        SELECT id, name, 'admin' AS source FROM admin WHERE LOWER(email) = LOWER($1)
        UNION ALL
        SELECT id, name, 'employee' AS source FROM users WHERE LOWER(email) = LOWER($1)
        LIMIT 1;
        `,
        [r.email],
      );
      const recipientUserId = userMatch.rows[0]?.id || null;
      const recipientName = userMatch.rows[0]?.name || r.email.split("@")[0];
      const recipientSource = userMatch.rows[0]?.source || null;

      await client.query(
        `
        INSERT INTO mail_recipients (
          message_id, recipient_email, recipient_name, recipient_user_id, recipient_type, is_read
        )
        VALUES ($1, $2, $3, $4, $5, false);
        `,
        [messageId, r.email, recipientName, recipientUserId, r.type],
      );

      // Create notification for registered admin/employee if sending immediately
      if (!isDraft && !isScheduled && recipientUserId && !notifiedRecipientIds.has(recipientUserId)) {
        notifiedRecipientIds.add(recipientUserId);
        const notifTitle = `New Email from ${senderName || senderEmail}`;
        const cleanSnippet = (bodyText || bodyHtml || "")
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 120);
        const notifMsg = subject
          ? (cleanSnippet ? `${subject} - ${cleanSnippet}` : subject)
          : (cleanSnippet || "You received a new email.");

        if (recipientSource === "admin") {
          await client.query(
            `
            INSERT INTO admin_notifications (admin_id, title, message, type, is_read, created_at)
            VALUES ($1, $2, $3, 'email', false, NOW());
            `,
            [recipientUserId, notifTitle, notifMsg]
          );
        } else if (recipientSource === "employee") {
          await client.query(
            `
            INSERT INTO employee_notifications (employee_id, title, message, type, is_read, created_at)
            VALUES ($1, $2, $3, 'email', false, NOW());
            `,
            [recipientUserId, notifTitle, notifMsg]
          );
        }
      }
    }

    // Insert attachments
    if (files && files.length > 0) {
      for (const file of files) {
        const relativePath = `/uploads/emails/${file.filename}`;
        await client.query(
          `
          INSERT INTO mail_attachments (
            message_id, file_name, original_name, file_path, file_size, mime_type
          )
          VALUES ($1, $2, $3, $4, $5, $6);
          `,
          [
            messageId,
            file.filename,
            file.originalname,
            relativePath,
            file.size || 0,
            file.mimetype || "application/octet-stream",
          ],
        );
      }
    }

    await client.query("COMMIT");

    // If it's a real email send (not a draft), dispatch via Nodemailer
    let smtpResult = null;
    let previewUrl = null;

    if (!isDraft && !isScheduled) {
      try {
        const transporter = await getTransporter();

        const mailAttachments = (files || []).map((file) => ({
          filename: file.originalname,
          path: file.path,
          contentType: file.mimetype,
        }));

        const mailOptions = {
          from: `"${senderName}" <${senderEmail}>`,
          to: toList.join(", "),
          cc: ccList.length > 0 ? ccList.join(", ") : undefined,
          bcc: bccList.length > 0 ? bccList.join(", ") : undefined,
          subject: subject || "(No Subject)",
          text: bodyText || "",
          html: bodyHtml || `<p>${bodyText || ""}</p>`,
          attachments: mailAttachments,
        };

        smtpResult = await transporter.sendMail(mailOptions);
        previewUrl = nodemailer.getTestMessageUrl(smtpResult) || null;

        await pool.query(
          `
          UPDATE mail_messages
          SET delivery_status = 'sent', smtp_message_id = $1, smtp_preview_url = $2, updated_at = NOW()
          WHERE id = $3;
          `,
          [smtpResult.messageId || null, previewUrl, messageId],
        );
      } catch (sendErr) {
        console.error("EmailCenter SMTP Dispatch Error:", sendErr);
        await pool.query(
          `
          UPDATE mail_messages
          SET delivery_status = 'failed', error_message = $1, updated_at = NOW()
          WHERE id = $2;
          `,
          [sendErr.message, messageId],
        );
      }
    }

    // Return the full message details
    return await getEmailById({
      messageId,
      userId: senderId,
      userEmail: senderEmail,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get emails for a specific folder with pagination & search
 */
async function getEmails({
  userId,
  userEmail,
  folder = "inbox",
  search = "",
  page = 1,
  limit = 20,
  filter = "all",
  searchFrom = "",
  searchTo = "",
  searchTime = "any",
  hasAttachment = false,
}) {
  const offset = (page - 1) * limit;
  const searchFilter = search ? `%${search.trim().toLowerCase()}%` : null;

  let whereClause = "";
  let queryParams = [userId, userEmail.toLowerCase()];
  let paramIdx = 3;

  switch (folder) {
    case "all":
      whereClause = `
        (
          -- Sent by me (non-trashed)
          ((m.sender_id = $1 OR LOWER(m.sender_email) = $2) AND m.is_sent = true AND m.is_draft = false AND m.is_trashed = false)
          OR
          -- Received by me (non-trashed)
          (
            EXISTS (
              SELECT 1 FROM mail_recipients mr
              WHERE mr.message_id = m.id
                AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
                AND mr.is_trashed = false
            )
            AND m.is_sent = true
            AND m.is_draft = false
          )
        )
      `;
      break;

    case "sent":
      whereClause = `
        (m.sender_id = $1 OR LOWER(m.sender_email) = $2)
        AND m.is_sent = true
        AND m.is_draft = false
        AND m.is_trashed = false
        AND m.is_archived = false
      `;
      break;

    case "drafts":
      whereClause = `
        (m.sender_id = $1 OR LOWER(m.sender_email) = $2)
        AND m.is_draft = true
        AND m.is_trashed = false
      `;
      break;
    case "scheduled":
      whereClause = `
        (m.sender_id = $1 OR LOWER(m.sender_email) = $2)
        AND m.is_scheduled = true
        AND m.is_sent = false
        AND m.is_trashed = false
      `;
      break;

    case "starred":
      whereClause = `
        (
          ((m.sender_id = $1 OR LOWER(m.sender_email) = $2) AND m.is_starred = true AND m.is_trashed = false)
          OR
          EXISTS (
            SELECT 1 FROM mail_recipients mr
            WHERE mr.message_id = m.id
              AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
              AND mr.is_starred = true
              AND mr.is_trashed = false
          )
        )
      `;
      break;

    case "trash":
      whereClause = `
        (
          ((m.sender_id = $1 OR LOWER(m.sender_email) = $2) AND m.is_trashed = true)
          OR
          EXISTS (
            SELECT 1 FROM mail_recipients mr
            WHERE mr.message_id = m.id
              AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
              AND mr.is_trashed = true
          )
        )
      `;
      break;

    case "snoozed":
      whereClause = `
        (
          EXISTS (
            SELECT 1 FROM mail_recipients mr
            WHERE mr.message_id = m.id
              AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
              AND mr.is_trashed = false
              AND mr.snoozed_until IS NOT NULL
              AND mr.snoozed_until > NOW()
          )
          OR
          (
            (m.sender_id = $1 OR LOWER(m.sender_email) = $2)
            AND m.is_trashed = false
            AND m.snoozed_until IS NOT NULL
            AND m.snoozed_until > NOW()
          )
        )
        AND m.is_draft = false
      `;
      break;

    case "inbox":
    default:
      whereClause = `
        EXISTS (
          SELECT 1 FROM mail_recipients mr
          WHERE mr.message_id = m.id
            AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
            AND mr.is_trashed = false
            AND mr.is_archived = false
            AND (mr.snoozed_until IS NULL OR mr.snoozed_until <= NOW())
        )
        AND m.is_draft = false
        AND m.is_sent = true
      `;
      break;
  }

  if (searchFilter) {
    whereClause += `
      AND (
        LOWER(m.subject) LIKE $${paramIdx}
        OR LOWER(m.body_text) LIKE $${paramIdx}
        OR LOWER(m.sender_name) LIKE $${paramIdx}
        OR LOWER(m.sender_email) LIKE $${paramIdx}
        OR EXISTS (
          SELECT 1 FROM mail_recipients mr2
          WHERE mr2.message_id = m.id
            AND (LOWER(mr2.recipient_email) LIKE $${paramIdx} OR LOWER(mr2.recipient_name) LIKE $${paramIdx})
        )
      )
    `;
    queryParams.push(searchFilter);
    paramIdx++;
  }

  // Filter by Sender (From)
  if (searchFrom && searchFrom.trim()) {
    const fromVal = `%${searchFrom.trim().toLowerCase()}%`;
    whereClause += `
      AND (
        LOWER(m.sender_name) LIKE $${paramIdx}
        OR LOWER(m.sender_email) LIKE $${paramIdx}
      )
    `;
    queryParams.push(fromVal);
    paramIdx++;
  }

  // Filter by Recipient (To)
  if (searchTo && searchTo.trim()) {
    const toVal = `%${searchTo.trim().toLowerCase()}%`;
    whereClause += `
      AND EXISTS (
        SELECT 1 FROM mail_recipients mr_to
        WHERE mr_to.message_id = m.id
          AND (LOWER(mr_to.recipient_email) LIKE $${paramIdx} OR LOWER(mr_to.recipient_name) LIKE $${paramIdx})
      )
    `;
    queryParams.push(toVal);
    paramIdx++;
  }

  // Filter by Has Attachment
  if (
    hasAttachment === true ||
    hasAttachment === "true" ||
    hasAttachment === 1 ||
    hasAttachment === "1"
  ) {
    whereClause += `
      AND (
        EXISTS (
          SELECT 1 FROM mail_attachments ma_filter
          WHERE ma_filter.message_id = m.id
        )
      )
    `;
  }

  // Filter by Timeframe (Any time / Week / Month / 6 Months / Year)
  if (searchTime && searchTime !== "any") {
    if (searchTime === "week") {
      whereClause += ` AND m.created_at >= (NOW() - INTERVAL '7 days') `;
    } else if (searchTime === "month") {
      whereClause += ` AND m.created_at >= (NOW() - INTERVAL '1 month') `;
    } else if (searchTime === "6months") {
      whereClause += ` AND m.created_at >= (NOW() - INTERVAL '6 months') `;
    } else if (searchTime === "year") {
      whereClause += ` AND m.created_at >= (NOW() - INTERVAL '1 year') `;
    }
  }

  if (filter === "unread") {
    whereClause += `
      AND EXISTS (
        SELECT 1 FROM mail_recipients mr_filter
        WHERE mr_filter.message_id = m.id
          AND (mr_filter.recipient_user_id = $1 OR LOWER(mr_filter.recipient_email) = $2)
          AND mr_filter.is_read = false
      )
    `;
  } else if (filter === "read") {
    whereClause += `
      AND (
        (m.sender_id = $1 OR LOWER(m.sender_email) = $2)
        OR EXISTS (
          SELECT 1 FROM mail_recipients mr_filter
          WHERE mr_filter.message_id = m.id
            AND (mr_filter.recipient_user_id = $1 OR LOWER(mr_filter.recipient_email) = $2)
            AND mr_filter.is_read = true
        )
      )
    `;
  }

  // Count total records
  const countQuery = `
    SELECT COUNT(DISTINCT m.id) as total
    FROM mail_messages m
    WHERE ${whereClause};
  `;
  const countResult = await pool.query(countQuery, queryParams);
  const total = parseInt(countResult.rows[0]?.total || 0, 10);

  // Fetch paginated messages with recipient & attachment summaries
  const listQuery = `
    SELECT
      m.id,
      m.sender_id,
      m.sender_email,
      m.sender_name,
      m.subject,
      m.body_text,
      SUBSTRING(m.body_text FROM 1 FOR 140) as snippet,
      m.is_draft,
      m.is_sent,
      m.delivery_status,
      m.smtp_preview_url,
      m.created_at,
      m.updated_at,
      (m.sender_id = $1 OR LOWER(m.sender_email) = $2) as is_sender,
      -- Determine is_read status for this user
      COALESCE((
        SELECT mr.is_read
        FROM mail_recipients mr
        WHERE mr.message_id = m.id
          AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
        LIMIT 1
      ), true) as is_read,
      -- Determine is_starred status for this user
      (
        CASE
          WHEN (m.sender_id = $1 OR LOWER(m.sender_email) = $2) AND m.is_starred = true THEN true
          WHEN EXISTS (
            SELECT 1 FROM mail_recipients mr
            WHERE mr.message_id = m.id
              AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
              AND mr.is_starred = true
          ) THEN true
          ELSE false
        END
      ) as is_starred,
      -- Attachments count
      (
        SELECT COUNT(*)
        FROM mail_attachments ma
        WHERE ma.message_id = m.id
      ) as attachment_count,
      -- Recipients JSON summary
      COALESCE((
        SELECT json_agg(json_build_object(
          'email', mr.recipient_email,
          'name', mr.recipient_name,
          'type', mr.recipient_type
        ))
        FROM mail_recipients mr
        WHERE mr.message_id = m.id
          AND (
            mr.recipient_type != 'bcc'
            OR m.sender_id = $1
            OR LOWER(m.sender_email) = LOWER($2)
          )
      ), '[]'::json) as recipients
    FROM mail_messages m
    WHERE ${whereClause}
    ORDER BY m.created_at DESC
    LIMIT $${paramIdx} OFFSET $${paramIdx + 1};
  `;

  queryParams.push(limit, offset);
  const listResult = await pool.query(listQuery, queryParams);

  return {
    messages: listResult.rows,
    pagination: {
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    },
  };
}

/**
 * Get full email details by ID
 */
async function getEmailById({ messageId, userId, userEmail }) {
  const messageRes = await pool.query(
    `
    SELECT
      m.*,
      COALESCE((
        SELECT mr.is_read
        FROM mail_recipients mr
        WHERE mr.message_id = m.id
          AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = LOWER($2))
        LIMIT 1
      ), true) as is_read,
      (
        CASE
          WHEN m.sender_id = $1 AND m.is_starred = true THEN true
          WHEN EXISTS (
            SELECT 1 FROM mail_recipients mr
            WHERE mr.message_id = m.id
              AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = LOWER($2))
              AND mr.is_starred = true
          ) THEN true
          ELSE false
        END
      ) as is_starred
    FROM mail_messages m
    WHERE m.id = $3
    LIMIT 1;
    `,
    [userId, userEmail, messageId],
  );

  if (messageRes.rows.length === 0) {
    throw new Error("Email not found.");
  }

  const message = messageRes.rows[0];

  // Fetch all recipients
  const recipientsRes = await pool.query(
    `
    SELECT id, recipient_email, recipient_name, recipient_user_id, recipient_type, is_read, read_at
    FROM mail_recipients
    WHERE message_id = $1
    ORDER BY id ASC;
    `,
    [messageId],
  );

  // Privacy rule: receivers must NOT see BCC recipients (BCC is invisible to receiver)
  const isSender =
    (message.sender_id && String(message.sender_id) === String(userId)) ||
    (userEmail &&
      message.sender_email &&
      message.sender_email.toLowerCase() === userEmail.toLowerCase());

  if (!isSender) {
    message.recipients = recipientsRes.rows.filter(
      (r) => r.recipient_type !== "bcc",
    );
  } else {
    message.recipients = recipientsRes.rows;
  }

  // Fetch all attachments
  const attachmentsRes = await pool.query(
    `
    SELECT id, file_name, original_name, file_path, file_size, mime_type, created_at
    FROM mail_attachments
    WHERE message_id = $1
    ORDER BY id ASC;
    `,
    [messageId],
  );
  message.attachments = attachmentsRes.rows;

  // If current user is a recipient and it's unread, automatically mark it as read
  if (userId || userEmail) {
    await pool.query(
      `
      UPDATE mail_recipients
      SET is_read = true, read_at = NOW()
      WHERE message_id = $1
        AND (recipient_user_id = $2 OR LOWER(recipient_email) = LOWER($3))
        AND is_read = false;
      `,
      [messageId, userId, userEmail],
    );
    message.is_read = true;
  }

  return message;
}

/**
 * Toggle Star / Unstar
 */
async function toggleStar({ messageId, userId, userEmail }) {
  // If user is sender, toggle on message
  await pool.query(
    `
    UPDATE mail_messages
    SET is_starred = NOT is_starred, updated_at = NOW()
    WHERE id = $1 AND (sender_id = $2 OR LOWER(sender_email) = LOWER($3));
    `,
    [messageId, userId, userEmail],
  );

  // If user is recipient, toggle on recipient record
  await pool.query(
    `
    UPDATE mail_recipients
    SET is_starred = NOT is_starred
    WHERE message_id = $1 AND (recipient_user_id = $2 OR LOWER(recipient_email) = LOWER($3));
    `,
    [messageId, userId, userEmail],
  );

  return { success: true };
}

/**
 * Toggle Read / Unread
 */
async function toggleRead({ messageId, userId, userEmail, isRead }) {
  await pool.query(
    `
    UPDATE mail_recipients
    SET is_read = $1, read_at = CASE WHEN $1 = true THEN NOW() ELSE NULL END
    WHERE message_id = $2 AND (recipient_user_id = $3 OR LOWER(recipient_email) = LOWER($4));
    `,
    [Boolean(isRead), messageId, userId, userEmail],
  );
  return { success: true };
}

/**
 * Move to Trash
 */
async function moveToTrash({ messageId, userId, userEmail }) {
  // Sender side
  await pool.query(
    `
    UPDATE mail_messages
    SET is_trashed = true, updated_at = NOW()
    WHERE id = $1 AND (sender_id = $2 OR LOWER(sender_email) = LOWER($3));
    `,
    [messageId, userId, userEmail],
  );

  // Recipient side
  await pool.query(
    `
    UPDATE mail_recipients
    SET is_trashed = true
    WHERE message_id = $1 AND (recipient_user_id = $2 OR LOWER(recipient_email) = LOWER($3));
    `,
    [messageId, userId, userEmail],
  );

  return { success: true };
}

/**
 * Restore from Trash
 */
async function restoreFromTrash({ messageId, userId, userEmail }) {
  await pool.query(
    `
    UPDATE mail_messages
    SET is_trashed = false, updated_at = NOW()
    WHERE id = $1 AND (sender_id = $2 OR LOWER(sender_email) = LOWER($3));
    `,
    [messageId, userId, userEmail],
  );

  await pool.query(
    `
    UPDATE mail_recipients
    SET is_trashed = false
    WHERE message_id = $1 AND (recipient_user_id = $2 OR LOWER(recipient_email) = LOWER($3));
    `,
    [messageId, userId, userEmail],
  );

  return { success: true };
}

/**
 *
 *
 *
 * Delete Permanently
 */
async function deletePermanently({ messageId, userId, userEmail }) {
  // If user is the sender, delete the entire message & file attachments
  const senderCheck = await pool.query(
    `SELECT id FROM mail_messages WHERE id = $1 AND (sender_id = $2 OR LOWER(sender_email) = LOWER($3));`,
    [messageId, userId, userEmail],
  );

  if (senderCheck.rows.length > 0) {
    // Delete attached physical files
    const filesRes = await pool.query(
      `SELECT file_path FROM mail_attachments WHERE message_id = $1;`,
      [messageId],
    );
    for (const f of filesRes.rows) {
      try {
        const fullPath = path.join(__dirname, "..", f.file_path);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      } catch (err) {
        console.warn("Could not delete attachment file:", err.message);
      }
    }
    await pool.query(`DELETE FROM mail_messages WHERE id = $1;`, [messageId]);
    return { success: true, deleted: "message" };
  }

  // If user is recipient, just remove their recipient record
  await pool.query(
    `
    DELETE FROM mail_recipients
    WHERE message_id = $1 AND (recipient_user_id = $2 OR LOWER(recipient_email) = LOWER($3));
    `,
    [messageId, userId, userEmail],
  );

  return { success: true, deleted: "recipient_record" };
}

/**
 * Mailbox Folder Stats & Unread Counts
 */
async function getMailboxStats({ userId, userEmail }) {
  const normEmail = (userEmail || "").toLowerCase();

  // Inbox total & unread (excluding archived and snoozed)
  const inboxRes = await pool.query(
    `
    SELECT
      COUNT(DISTINCT m.id) as total,
      COUNT(DISTINCT CASE WHEN mr.is_read = false THEN m.id END) as unread
    FROM mail_messages m
    JOIN mail_recipients mr ON mr.message_id = m.id
    WHERE (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
      AND mr.is_trashed = false
      AND mr.is_archived = false
      AND (mr.snoozed_until IS NULL OR mr.snoozed_until <= NOW())
      AND m.is_draft = false
      AND m.is_sent = true;
    `,
    [userId, normEmail],
  );

  // Snoozed total
  const snoozedRes = await pool.query(
    `
    SELECT COUNT(DISTINCT m.id) as total
    FROM mail_messages m
    WHERE (
      EXISTS (
        SELECT 1 FROM mail_recipients mr
        WHERE mr.message_id = m.id
          AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
          AND mr.is_trashed = false
          AND mr.snoozed_until IS NOT NULL
          AND mr.snoozed_until > NOW()
      )
      OR
      (
        (m.sender_id = $1 OR LOWER(m.sender_email) = $2)
        AND m.is_trashed = false
        AND m.snoozed_until IS NOT NULL
        AND m.snoozed_until > NOW()
      )
    )
    AND m.is_draft = false;
    `,
    [userId, normEmail],
  );

  // Sent total (excluding archived)
  const sentRes = await pool.query(
    `
    SELECT COUNT(*) as total
    FROM mail_messages
    WHERE (sender_id = $1 OR LOWER(sender_email) = $2) AND is_sent = true AND is_draft = false AND is_trashed = false AND is_archived = false;
    `,
    [userId, normEmail],
  );

  // Drafts total
  const draftsRes = await pool.query(
    `
    SELECT COUNT(*) as total
    FROM mail_messages
    WHERE (sender_id = $1 OR LOWER(sender_email) = $2) AND is_draft = true AND is_trashed = false;
    `,
    [userId, normEmail],
  );

  // Starred total
  const starredRes = await pool.query(
    `
    SELECT COUNT(DISTINCT m.id) as total
    FROM mail_messages m
    WHERE (
      ((m.sender_id = $1 OR LOWER(m.sender_email) = $2) AND m.is_starred = true AND m.is_trashed = false)
      OR
      EXISTS (
        SELECT 1 FROM mail_recipients mr
        WHERE mr.message_id = m.id
          AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
          AND mr.is_starred = true
          AND mr.is_trashed = false
      )
    );
    `,
    [userId, normEmail],
  );

  // Trash total
  const trashRes = await pool.query(
    `
    SELECT COUNT(DISTINCT m.id) as total
    FROM mail_messages m
    WHERE (
      ((m.sender_id = $1 OR LOWER(m.sender_email) = $2) AND m.is_trashed = true)
      OR
      EXISTS (
        SELECT 1 FROM mail_recipients mr
        WHERE mr.message_id = m.id
          AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
          AND mr.is_trashed = true
      )
    );
    `,
    [userId, normEmail],
  );

  // All non-trashed mail (both sent by this user and received by this user)
  const allRes = await pool.query(
    `
    SELECT COUNT(DISTINCT m.id) as total
    FROM mail_messages m
    WHERE (
      ((m.sender_id = $1 OR LOWER(m.sender_email) = $2) AND m.is_sent = true AND m.is_draft = false AND m.is_trashed = false)
      OR
      (
        EXISTS (
          SELECT 1 FROM mail_recipients mr
          WHERE mr.message_id = m.id
            AND (mr.recipient_user_id = $1 OR LOWER(mr.recipient_email) = $2)
            AND mr.is_trashed = false
        )
        AND m.is_sent = true
        AND m.is_draft = false
      )
    );
    `,
    [userId, normEmail],
  );

    const scheduledRes = await pool.query(
    `
    SELECT COUNT(*) as total
    FROM mail_messages
    WHERE (sender_id = $1 OR LOWER(sender_email) = $2)
      AND is_scheduled = true
      AND is_sent = false
      AND is_trashed = false;
    `,
    [userId, normEmail],
  );

  return {
    all: parseInt(allRes.rows[0]?.total || 0, 10),
    inbox: {
      total: parseInt(inboxRes.rows[0]?.total || 0, 10),
      unread: parseInt(inboxRes.rows[0]?.unread || 0, 10),
    },
    sent: parseInt(sentRes.rows[0]?.total || 0, 10),
    drafts: parseInt(draftsRes.rows[0]?.total || 0, 10),
    scheduled: parseInt(scheduledRes.rows[0]?.total || 0, 10),
    snoozed: parseInt(snoozedRes.rows[0]?.total || 0, 10),
    starred: parseInt(starredRes.rows[0]?.total || 0, 10),
    trash: parseInt(trashRes.rows[0]?.total || 0, 10),
  };
}

/**
 * Get Predefined Email Templates
 */
async function getTemplates() {
  const result = await pool.query(
    `SELECT id, title, subject, body_html, category, created_at FROM mail_templates ORDER BY category, title;`,
  );
  return result.rows;
}

/**
 * Mark All As Read for Current User
 */
async function markAllAsRead({ userId, userEmail }) {
  const normEmail = (userEmail || "").toLowerCase();
  const res = await pool.query(
    `UPDATE mail_recipients
     SET is_read = true, read_at = NOW()
     WHERE (recipient_user_id = $1 OR LOWER(recipient_email) = $2)
       AND is_read = false
     RETURNING id;`,
    [userId, normEmail],
  );
  return { success: true, updatedCount: res.rowCount };
}

/**
 * Archive / Unarchive Single Email
 */
async function archiveEmail({
  messageId,
  userId,
  userEmail,
  isArchived = true,
}) {
  const normEmail = userEmail ? userEmail.toLowerCase() : "";

  // Update recipient row if user is recipient
  await pool.query(
    `
    UPDATE mail_recipients
    SET is_archived = $1
    WHERE message_id = $2
      AND (recipient_user_id = $3 OR LOWER(recipient_email) = LOWER($4));
    `,
    [isArchived, messageId, userId, normEmail],
  );

  // Update message row if user is sender
  await pool.query(
    `
    UPDATE mail_messages
    SET is_archived = $1, updated_at = NOW()
    WHERE id = $2 AND (sender_id = $3 OR LOWER(sender_email) = LOWER($4));
    `,
    [isArchived, messageId, userId, normEmail],
  );

  return { success: true, isArchived, messageId };
}

/**
 * Bulk Archive / Unarchive Emails
 */
async function bulkArchive({
  messageIds = [],
  userId,
  userEmail,
  isArchived = true,
}) {
  if (!Array.isArray(messageIds) || messageIds.length === 0) {
    return { success: true, count: 0 };
  }
  const normEmail = userEmail ? userEmail.toLowerCase() : "";

  await pool.query(
    `
    UPDATE mail_recipients
    SET is_archived = $1
    WHERE message_id = ANY($2::int[])
      AND (recipient_user_id = $3 OR LOWER(recipient_email) = LOWER($4));
    `,
    [isArchived, messageIds, userId, normEmail],
  );

  await pool.query(
    `
    UPDATE mail_messages
    SET is_archived = $1, updated_at = NOW()
    WHERE id = ANY($2::int[])
      AND (sender_id = $3 OR LOWER(sender_email) = LOWER($4));
    `,
    [isArchived, messageIds, userId, normEmail],
  );

  return { success: true, count: messageIds.length, isArchived };
}

/**
 * Get distinct senders and recipients for search filters
 */
async function getFilterContacts({ userId, userEmail }) {
  const sendersRes = await pool.query(`
    SELECT DISTINCT
      m.sender_name as name,
      m.sender_email as email
    FROM mail_messages m
    WHERE m.is_draft = false
      AND m.is_trashed = false
    ORDER BY m.sender_name ASC
    LIMIT 50;
  `);

  const recipientsRes = await pool.query(`
    SELECT DISTINCT
      mr.recipient_name as name,
      mr.recipient_email as email
    FROM mail_recipients mr
    JOIN mail_messages m ON m.id = mr.message_id
    WHERE m.is_draft = false
      AND mr.is_trashed = false
    ORDER BY mr.recipient_name ASC
    LIMIT 50;
  `);

  const systemUsersRes = await pool.query(`
    SELECT DISTINCT name, email
    FROM (
      SELECT name, email FROM admin
      UNION ALL
      SELECT name, email FROM users
    ) u
    WHERE email IS NOT NULL AND email != ''
    ORDER BY name ASC
    LIMIT 50;
  `);

  const sendersMap = new Map();
  sendersRes.rows.forEach((s) => {
    if (s.email) {
      sendersMap.set(s.email.toLowerCase(), {
        name: s.name || s.email.split("@")[0],
        email: s.email,
      });
    }
  });
  systemUsersRes.rows.forEach((u) => {
    if (u.email && !sendersMap.has(u.email.toLowerCase())) {
      sendersMap.set(u.email.toLowerCase(), {
        name: u.name || u.email.split("@")[0],
        email: u.email,
      });
    }
  });

  const recipientsMap = new Map();
  recipientsRes.rows.forEach((r) => {
    if (r.email) {
      recipientsMap.set(r.email.toLowerCase(), {
        name: r.name || r.email.split("@")[0],
        email: r.email,
      });
    }
  });
  systemUsersRes.rows.forEach((u) => {
    if (u.email && !recipientsMap.has(u.email.toLowerCase())) {
      recipientsMap.set(u.email.toLowerCase(), {
        name: u.name || u.email.split("@")[0],
        email: u.email,
      });
    }
  });

  return {
    senders: Array.from(sendersMap.values()),
    recipients: Array.from(recipientsMap.values()),
  };
}

/**
 * Fetch a single attachment record by its ID
 */
async function getAttachmentById(id) {
  const result = await pool.query(
    `SELECT id, file_name, original_name, file_path, file_size, mime_type FROM mail_attachments WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
}


/**
 * Cancel a scheduled email (reverts back to editable draft)
 */
async function cancelScheduledEmail({ messageId, userId, userEmail }) {
  const res = await pool.query(
    `
    UPDATE mail_messages
    SET is_scheduled = false, is_draft = true, scheduled_at = NULL, delivery_status = 'draft', updated_at = NOW()
    WHERE id = $1 AND (sender_id = $2 OR LOWER(sender_email) = $3)
    RETURNING id;
    `,
    [messageId, userId, (userEmail || "").toLowerCase()]
  );
  return res.rows.length > 0;
}

/**
 * Background worker: Dispatches scheduled emails whose scheduled_at has arrived
 */
async function processScheduledEmails() {
  const client = await pool.connect();
  try {
    const res = await client.query(`
      SELECT m.*
      FROM mail_messages m
      WHERE m.is_scheduled = true
        AND m.is_sent = false
        AND m.is_trashed = false
        AND m.scheduled_at <= NOW()
      ORDER BY m.scheduled_at ASC
      LIMIT 10;
    `);

    if (res.rows.length === 0) return;

    for (const msg of res.rows) {
      try {
        const recRes = await client.query(
          `SELECT recipient_email, recipient_type FROM mail_recipients WHERE message_id = $1;`,
          [msg.id]
        );
        const toList = recRes.rows.filter((r) => r.recipient_type === "to").map((r) => r.recipient_email);
        const ccList = recRes.rows.filter((r) => r.recipient_type === "cc").map((r) => r.recipient_email);
        const bccList = recRes.rows.filter((r) => r.recipient_type === "bcc").map((r) => r.recipient_email);

        const attRes = await client.query(
          `SELECT file_name, original_name, file_path, mime_type FROM mail_attachments WHERE message_id = $1;`,
          [msg.id]
        );
        const mailAttachments = attRes.rows.map((att) => ({
          filename: att.original_name,
          path: path.join(__dirname, "..", att.file_path),
          contentType: att.mime_type,
        }));

        const transporter = await getTransporter();
        const mailOptions = {
          from: `"${msg.sender_name}" <${msg.sender_email}>`,
          to: toList.join(", "),
          cc: ccList.length > 0 ? ccList.join(", ") : undefined,
          bcc: bccList.length > 0 ? bccList.join(", ") : undefined,
          subject: msg.subject || "(No Subject)",
          text: msg.body_text || "",
          html: msg.body_html || `<p>${msg.body_text || ""}</p>`,
          attachments: mailAttachments,
        };

        const smtpResult = await transporter.sendMail(mailOptions);
        const previewUrl = nodemailer.getTestMessageUrl(smtpResult) || null;

        await client.query(
          `
          UPDATE mail_messages
          SET is_scheduled = false, is_sent = true, delivery_status = 'sent',
              smtp_message_id = $1, smtp_preview_url = $2, updated_at = NOW()
          WHERE id = $3;
          `,
          [smtpResult.messageId || null, previewUrl, msg.id]
        );
        console.log(`[Scheduled Mail] Dispatched email #${msg.id} to ${toList.join(", ")}`);

        // Notify recipients if they are registered users/admins
        try {
          const cleanSnippet = (msg.body_text || msg.body_html || "")
            .replace(/<[^>]*>/g, " ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 120);
          const notifTitle = `New Email from ${msg.sender_name || msg.sender_email}`;
          const notifMsg = msg.subject
            ? (cleanSnippet ? `${msg.subject} - ${cleanSnippet}` : msg.subject)
            : (cleanSnippet || "You received a new email.");

          const scheduledRecipients = await client.query(
            `SELECT recipient_email, recipient_user_id FROM mail_recipients WHERE message_id = $1;`,
            [msg.id]
          );

          const notifiedScheduledIds = new Set();
          for (const r of scheduledRecipients.rows) {
            const userMatch = await client.query(
              `
              SELECT id, 'admin' AS source FROM admin WHERE LOWER(email) = LOWER($1)
              UNION ALL
              SELECT id, 'employee' AS source FROM users WHERE LOWER(email) = LOWER($1)
              LIMIT 1;
              `,
              [r.recipient_email]
            );
            const recId = userMatch.rows[0]?.id || r.recipient_user_id;
            const recSource = userMatch.rows[0]?.source;
            if (recId && !notifiedScheduledIds.has(recId)) {
              notifiedScheduledIds.add(recId);
              if (recSource === "admin") {
                await client.query(
                  `
                  INSERT INTO admin_notifications (admin_id, title, message, type, is_read, created_at)
                  VALUES ($1, $2, $3, 'email', false, NOW());
                  `,
                  [recId, notifTitle, notifMsg]
                );
              } else if (recSource === "employee") {
                await client.query(
                  `
                  INSERT INTO employee_notifications (employee_id, title, message, type, is_read, created_at)
                  VALUES ($1, $2, $3, 'email', false, NOW());
                  `,
                  [recId, notifTitle, notifMsg]
                );
              }
            }
          }
        } catch (notifErr) {
          console.error("Scheduled email recipient notification error:", notifErr);
        }
      } catch (sendErr) {
        console.error(`[Scheduled Mail Error] Message #${msg.id}:`, sendErr.message);
        await client.query(
          `
          UPDATE mail_messages
          SET delivery_status = 'failed', error_message = $1, updated_at = NOW()
          WHERE id = $2;
          `,
          [sendErr.message, msg.id]
        );
      }
    }
  } catch (err) {
    console.error("processScheduledEmails loop error:", err.message);
  } finally {
    client.release();
  }
}

/**
 * Snooze an email until a specified timestamp
 */
async function snoozeEmail({ userId, userEmail, emailId, snoozedUntil }) {
  const normEmail = (userEmail || "").toLowerCase();
  const snoozeDate = new Date(snoozedUntil);
  if (isNaN(snoozeDate.getTime()) || snoozeDate.getTime() <= Date.now()) {
    throw new Error("Snooze time must be in the future.");
  }

  // Update recipient row if user received it
  await pool.query(
    `
    UPDATE mail_recipients
    SET snoozed_until = $1
    WHERE message_id = $2
      AND (recipient_user_id = $3 OR LOWER(recipient_email) = $4)
    `,
    [snoozeDate.toISOString(), emailId, userId, normEmail]
  );

  // Update sender row in mail_messages if user sent it
  await pool.query(
    `
    UPDATE mail_messages
    SET snoozed_until = $1
    WHERE id = $2
      AND (sender_id = $3 OR LOWER(sender_email) = $4)
    `,
    [snoozeDate.toISOString(), emailId, userId, normEmail]
  );

  return { success: true, emailId, snoozedUntil: snoozeDate.toISOString() };
}

/**
 * Remove snooze from an email
 */
async function unsnoozeEmail({ userId, userEmail, emailId }) {
  const normEmail = (userEmail || "").toLowerCase();

  await pool.query(
    `
    UPDATE mail_recipients
    SET snoozed_until = NULL
    WHERE message_id = $1
      AND (recipient_user_id = $2 OR LOWER(recipient_email) = $3)
    `,
    [emailId, userId, normEmail]
  );

  await pool.query(
    `
    UPDATE mail_messages
    SET snoozed_until = NULL
    WHERE id = $1
      AND (sender_id = $2 OR LOWER(sender_email) = $3)
    `,
    [emailId, userId, normEmail]
  );

  return { success: true, emailId, unsnoozed: true };
}

// Background scheduler interval (checks every 20 seconds)
const scheduleTimer = setInterval(processScheduledEmails, 20000);
if (scheduleTimer.unref) scheduleTimer.unref();

module.exports = {
  searchRecipients,
  getUserById,
  sendOrDraftEmail,
  getEmails,
  getEmailById,
  getAttachmentById,
  toggleStar,
  toggleRead,
  markAllAsRead,
  moveToTrash,
  restoreFromTrash,
  deletePermanently,
  archiveEmail,
  bulkArchive,
  getMailboxStats,
  getTemplates,
  cancelScheduledEmail,
  processScheduledEmails,
  getFilterContacts,
  snoozeEmail,
  unsnoozeEmail,
};
