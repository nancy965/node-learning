const pool = require("../config/databse");
const { createActivityLog } = require("./activityLogService");
const {
  createEmployeeNotification,
  createAdminNotification,
} = require("./notificationService");

// Generate unique ticket code like TKT-1001, TKT-1002
const generateTicketCode = async (client) => {
  try {
    const res = await client.query(`
      SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(ticket_code, '[^0-9]', '', 'g'), '') AS INTEGER)), 1000) + 1 AS next_num
      FROM support_tickets
    `);
    const num = res.rows[0]?.next_num || 1001;
    return `TKT-${num}`;
  } catch {
    return `TKT-${Date.now().toString().slice(-4)}`;
  }
};

// Resolve category name or UUID to valid UUID from common_master
const resolveCategoryUUID = async (clientOrPool, catInput) => {
  if (!catInput) return null;
  const str = String(catInput).trim();
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  if (isUUID) return str;
  const res = await clientOrPool.query(
    "SELECT id FROM common_master WHERE LOWER(type) = 'ticket_category' AND LOWER(name) = LOWER($1) AND is_active = true LIMIT 1",
    [str]
  );
  if (res.rows.length > 0) return res.rows[0].id;
  const fallback = await clientOrPool.query(
    "SELECT id FROM common_master WHERE LOWER(type) = 'ticket_category' AND is_active = true ORDER BY created_at ASC LIMIT 1"
  );
  return fallback.rows[0]?.id || null;
};

// Resolve priority name or UUID to valid UUID from common_master
const resolvePriorityUUID = async (clientOrPool, prioInput) => {
  if (!prioInput) return null;
  const str = String(prioInput).trim();
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
  if (isUUID) return str;
  const res = await clientOrPool.query(
    "SELECT id FROM common_master WHERE LOWER(type) = 'ticket_priority' AND LOWER(name) = LOWER($1) AND is_active = true LIMIT 1",
    [str]
  );
  if (res.rows.length > 0) return res.rows[0].id;
  const fallback = await clientOrPool.query(
    "SELECT id FROM common_master WHERE LOWER(type) = 'ticket_priority' AND is_active = true ORDER BY created_at ASC LIMIT 1"
  );
  return fallback.rows[0]?.id || null;
};

const formatTicketRow = (row) => {
  if (!row) return row;
  const catName = row.category_name || row.category;
  const prioName = row.priority_name || row.priority;
  return {
    ...row,
    category_id: row.category,
    category_name: catName,
    category: catName,
    priority_id: row.priority,
    priority_name: prioName,
    priority: prioName,
  };
};

// Create a new support ticket
const createTicket = async (ticketData, user) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { title, description, category, priority = "Medium", files = [] } = ticketData;

    if (!title || !description || !category) {
      throw new Error("Title, description, and category are required");
    }

    const categoryUUID = await resolveCategoryUUID(client, category);
    const priorityUUID = await resolvePriorityUUID(client, priority);

    if (!categoryUUID) {
      throw new Error("Invalid ticket category selected");
    }

    const ticketCode = await generateTicketCode(client);
    const userId = user.userId;
    const userRole = user.role || "employee";

    const insertResult = await client.query(
      `
      INSERT INTO support_tickets (
        ticket_code,
        title,
        description,
        category,
        priority,
        status,
        created_by,
        created_by_role,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'Open', $6, $7, NOW(), NOW())
      RETURNING *;
      `,
      [ticketCode, title.trim(), description.trim(), categoryUUID, priorityUUID, userId, userRole]
    );

    const ticket = insertResult.rows[0];

    // Fetch display names for the created ticket
    const namesRes = await client.query(`
      SELECT 
        cm_cat.name as category_name,
        cm_prio.name as priority_name
      FROM (SELECT $1::uuid as cat_id, $2::uuid as prio_id) ids
      LEFT JOIN common_master cm_cat ON cm_cat.id = ids.cat_id
      LEFT JOIN common_master cm_prio ON cm_prio.id = ids.prio_id
    `, [categoryUUID, priorityUUID]);

    if (namesRes.rows.length > 0) {
      ticket.category_name = namesRes.rows[0].category_name || category;
      ticket.category = ticket.category_name;
      ticket.category_id = categoryUUID;
      ticket.priority_name = namesRes.rows[0].priority_name || priority;
      ticket.priority = ticket.priority_name;
      ticket.priority_id = priorityUUID;
    }

    // Save uploaded attachments if any
    const attachments = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const filePath = `/uploads/tickets/${file.filename}`;
        const attachRes = await client.query(
          `
          INSERT INTO ticket_attachments (
            ticket_id,
            file_name,
            original_name,
            file_path,
            file_type,
            file_size,
            source,
            uploaded_by,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'creation', $7, NOW())
          RETURNING *;
          `,
          [
            ticket.id,
            file.filename,
            file.originalname,
            filePath,
            file.mimetype || "application/octet-stream",
            file.size || 0,
            userId,
          ]
        );
        attachments.push(attachRes.rows[0]);
      }
    }
    ticket.attachments = attachments;

    // Log Activity
    try {
      await createActivityLog(
        userId,
        "Created Support Ticket",
        userId,
        {
          ticket_id: ticket.id,
          ticket_code: ticket.ticket_code,
          title: ticket.title,
          category: ticket.category,
          priority: ticket.priority,
        }
      );
    } catch (logErr) {
      console.error("Activity log error:", logErr);
    }

    // Notify Admins about new ticket
    try {
      const admins = await client.query("SELECT id FROM admin WHERE is_active = true");
      for (const adm of admins.rows) {
        await createAdminNotification(
          adm.id,
          "New Support Ticket Created",
          `Ticket ${ticket.ticket_code}: "${ticket.title}" submitted by ${user.name || "Employee"}`,
          "ticket_created"
        );
      }
    } catch (notifErr) {
      console.error("Admin notification error:", notifErr);
    }

    await client.query("COMMIT");
    return ticket;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Get tickets created by the logged-in user
const getMyTickets = async (userId, userRole, queryParams = {}) => {
  const { status, priority, category, search, page = 1, limit = 10 } = queryParams;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = ["st.created_by = $1"];
  const values = [userId];
  let paramIndex = 2;

  if (userRole) {
    if (["admin", "general_admin"].includes(userRole.toLowerCase())) {
      conditions.push(`LOWER(COALESCE(st.created_by_role, '')) IN ('admin', 'general_admin')`);
    } else {
      conditions.push(`LOWER(COALESCE(st.created_by_role, '')) NOT IN ('admin', 'general_admin')`);
    }
  }

  if (status && status !== "all") {
    conditions.push(`st.status = $${paramIndex}`);
    values.push(status);
    paramIndex++;
  }

  if (priority && priority !== "all") {
    conditions.push(`(st.priority::text = $${paramIndex} OR LOWER(COALESCE(cm_prio.name, '')) = LOWER($${paramIndex}))`);
    values.push(priority);
    paramIndex++;
  }

  if (category && category !== "all") {
    conditions.push(`(st.category::text = $${paramIndex} OR LOWER(COALESCE(cm_cat.name, '')) = LOWER($${paramIndex}))`);
    values.push(category);
    paramIndex++;
  }

  if (search && search.trim()) {
    conditions.push(`(st.ticket_code ILIKE $${paramIndex} OR st.title ILIKE $${paramIndex})`);
    values.push(`%${search.trim()}%`);
    paramIndex++;
  }

  const whereClause = conditions.join(" AND ");

  // Count total matching
  const countQuery = `
    SELECT COUNT(*) as total
    FROM support_tickets st
    LEFT JOIN common_master cm_cat ON cm_cat.id = st.category
    LEFT JOIN common_master cm_prio ON cm_prio.id = st.priority
    WHERE ${whereClause}
  `;
  const countRes = await pool.query(countQuery, values);
  const total = parseInt(countRes.rows[0].total, 10);

  // Fetch paginated rows with creator and assignee info
  const dataQuery = `
    SELECT 
      st.*,
      cm_cat.name AS category_name,
      cm_prio.name AS priority_name,
      creator.name AS creator_name,
      creator.email AS creator_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email,
      (SELECT COUNT(*)::int FROM ticket_attachments WHERE ticket_id = st.id) AS attachments_count
    FROM support_tickets st
    LEFT JOIN common_master cm_cat ON cm_cat.id = st.category
    LEFT JOIN common_master cm_prio ON cm_prio.id = st.priority
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = st.created_by AND LOWER(COALESCE(st.created_by_role, '')) IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM users WHERE id = st.created_by AND LOWER(COALESCE(st.created_by_role, '')) NOT IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM admin WHERE id = st.created_by
      UNION ALL
      SELECT name, email FROM users WHERE id = st.created_by
      LIMIT 1
    ) creator ON true
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = st.assigned_to
      UNION ALL
      SELECT name, email FROM users WHERE id = st.assigned_to
      LIMIT 1
    ) assignee ON true
    WHERE ${whereClause}
    ORDER BY st.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
  `;

  values.push(Number(limit), Number(offset));
  const dataRes = await pool.query(dataQuery, values);

  return {
    tickets: dataRes.rows.map(formatTicketRow),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)) || 1,
    },
  };
};

// Get all tickets (for Admins / General Admins)
const getAllTickets = async (user, queryParams = {}) => {
  const { status, priority, category, search, assignedTo, page = 1, limit = 10 } = queryParams;
  const offset = (Number(page) - 1) * Number(limit);

  const conditions = [];
  const values = [];
  let paramIndex = 1;

  // Role scoping:
  // Admin only sees tickets assigned to them by General Admin
  if (user.role === "admin") {
    conditions.push(`st.assigned_to = $${paramIndex}`);
    values.push(user.userId);
    paramIndex++;
  } else if (user.role === "employee") {
    conditions.push(`st.created_by = $${paramIndex}`);
    values.push(user.userId);
    paramIndex++;
  }

  if (status && status !== "all") {
    conditions.push(`st.status = $${paramIndex}`);
    values.push(status);
    paramIndex++;
  }

  if (priority && priority !== "all") {
    conditions.push(`(st.priority::text = $${paramIndex} OR LOWER(COALESCE(cm_prio.name, '')) = LOWER($${paramIndex}))`);
    values.push(priority);
    paramIndex++;
  }

  if (category && category !== "all") {
    conditions.push(`(st.category::text = $${paramIndex} OR LOWER(COALESCE(cm_cat.name, '')) = LOWER($${paramIndex}))`);
    values.push(category);
    paramIndex++;
  }

  if (assignedTo && assignedTo !== "all") {
    if (assignedTo === "unassigned") {
      conditions.push("st.assigned_to IS NULL");
    } else {
      conditions.push(`st.assigned_to = $${paramIndex}`);
      values.push(Number(assignedTo));
      paramIndex++;
    }
  }

  if (search && search.trim()) {
    conditions.push(
      `(st.ticket_code ILIKE $${paramIndex} OR st.title ILIKE $${paramIndex} OR creator.name ILIKE $${paramIndex})`
    );
    values.push(`%${search.trim()}%`);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count query
  const countQuery = `
    SELECT COUNT(*) as total
    FROM support_tickets st
    LEFT JOIN common_master cm_cat ON cm_cat.id = st.category
    LEFT JOIN common_master cm_prio ON cm_prio.id = st.priority
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = st.created_by AND LOWER(COALESCE(st.created_by_role, '')) IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM users WHERE id = st.created_by AND LOWER(COALESCE(st.created_by_role, '')) NOT IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM admin WHERE id = st.created_by
      UNION ALL
      SELECT name, email FROM users WHERE id = st.created_by
      LIMIT 1
    ) creator ON true
    ${whereClause}
  `;
  const countRes = await pool.query(countQuery, values);
  const total = parseInt(countRes.rows[0].total, 10);

  // Data query
  const dataQuery = `
    SELECT 
      st.*,
      cm_cat.name AS category_name,
      cm_prio.name AS priority_name,
      creator.name AS creator_name,
      creator.email AS creator_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email,
      (SELECT COUNT(*)::int FROM ticket_attachments WHERE ticket_id = st.id) AS attachments_count
    FROM support_tickets st
    LEFT JOIN common_master cm_cat ON cm_cat.id = st.category
    LEFT JOIN common_master cm_prio ON cm_prio.id = st.priority
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = st.created_by AND LOWER(COALESCE(st.created_by_role, '')) IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM users WHERE id = st.created_by AND LOWER(COALESCE(st.created_by_role, '')) NOT IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM admin WHERE id = st.created_by
      UNION ALL
      SELECT name, email FROM users WHERE id = st.created_by
      LIMIT 1
    ) creator ON true
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = st.assigned_to
      UNION ALL
      SELECT name, email FROM users WHERE id = st.assigned_to
      LIMIT 1
    ) assignee ON true
    ${whereClause}
    ORDER BY 
      CASE 
        WHEN st.status = 'Open' THEN 1
        WHEN st.status = 'In Progress' THEN 2
        WHEN st.status = 'Resolved' THEN 3
        ELSE 4
      END,
      st.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
  `;

  values.push(Number(limit), Number(offset));
  const dataRes = await pool.query(dataQuery, values);

  return {
    tickets: dataRes.rows.map(formatTicketRow),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)) || 1,
    },
  };
};

// Get single ticket by ID
const getTicketById = async (ticketId, user) => {
  const query = `
    SELECT 
      st.*,
      cm_cat.name AS category_name,
      cm_prio.name AS priority_name,
      creator.name AS creator_name,
      creator.email AS creator_email,
      assignee.name AS assignee_name,
      assignee.email AS assignee_email
    FROM support_tickets st
    LEFT JOIN common_master cm_cat ON cm_cat.id = st.category
    LEFT JOIN common_master cm_prio ON cm_prio.id = st.priority
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = st.created_by AND LOWER(COALESCE(st.created_by_role, '')) IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM users WHERE id = st.created_by AND LOWER(COALESCE(st.created_by_role, '')) NOT IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM admin WHERE id = st.created_by
      UNION ALL
      SELECT name, email FROM users WHERE id = st.created_by
      LIMIT 1
    ) creator ON true
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = st.assigned_to
      UNION ALL
      SELECT name, email FROM users WHERE id = st.assigned_to
      LIMIT 1
    ) assignee ON true
    WHERE st.id = $1
    LIMIT 1;
  `;

  const result = await pool.query(query, [ticketId]);
  if (result.rows.length === 0) {
    throw new Error("Ticket not found");
  }

  const ticket = formatTicketRow(result.rows[0]);

  // Employee can only view their own ticket
  if (user.role === "employee" && String(ticket.created_by) !== String(user.userId)) {
    throw new Error("You do not have permission to view this ticket");
  }

  // Fetch ticket attachments
  const attachRes = await pool.query(
    `SELECT id, ticket_id, file_name, original_name, file_path, file_type, file_size, source, created_at
     FROM ticket_attachments
     WHERE ticket_id = $1
     ORDER BY id ASC`,
    [ticketId]
  );
  ticket.attachments = attachRes.rows;

  return ticket;
};

// Update Ticket Status & Resolution Note
const updateTicketStatus = async (ticketId, status, resolutionNote, user, files = []) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const validStatuses = ["Open", "In Progress", "Resolved", "Closed"];
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid status: ${status}. Must be one of: ${validStatuses.join(", ")}`);
    }

    const currentCheck = await client.query("SELECT * FROM support_tickets WHERE id = $1", [ticketId]);
    if (currentCheck.rows.length === 0) {
      throw new Error("Ticket not found");
    }

    const currentTicket = currentCheck.rows[0];

    // Permission Check: Only the assigned user can update status and resolution
    if (!currentTicket.assigned_to || String(currentTicket.assigned_to) !== String(user.userId)) {
      throw new Error("You do not have permission to update this ticket. Only the assigned support agent can update status & resolution.");
    }

    // Status Progression Check: forward-only transitions and closed ticket lock
    const STATUS_RANK = {
      "Open": 0,
      "In Progress": 1,
      "Resolved": 2,
      "Closed": 3,
    };

    if (currentTicket.status === "Closed") {
      throw new Error("This ticket is closed and cannot be updated.");
    }

    const currentRank = STATUS_RANK[currentTicket.status] ?? 0;
    const newRank = STATUS_RANK[status] ?? 0;

    if (newRank < currentRank) {
      throw new Error(`Cannot revert ticket status from "${currentTicket.status}" back to "${status}". Status can only move forward.`);
    }

    let resolvedAt = currentTicket.resolved_at;
    if (status === "Resolved" || status === "Closed") {
      resolvedAt = new Date();
    } else if (status === "Open" || status === "In Progress") {
      resolvedAt = null;
    }

    const updateQuery = `
      UPDATE support_tickets
      SET 
        status = $1,
        resolution_note = COALESCE($2, resolution_note),
        resolved_at = $3,
        updated_at = NOW()
      WHERE id = $4
      RETURNING *;
    `;

    const updateRes = await client.query(updateQuery, [
      status,
      resolutionNote !== undefined ? resolutionNote : null,
      resolvedAt,
      ticketId,
    ]);

    const updatedTicket = updateRes.rows[0];

    // Save resolution attachments if uploaded
    if (files && files.length > 0) {
      for (const file of files) {
        const filePath = `/uploads/tickets/${file.filename}`;
        await client.query(
          `
          INSERT INTO ticket_attachments (
            ticket_id,
            file_name,
            original_name,
            file_path,
            file_type,
            file_size,
            source,
            uploaded_by,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, 'resolution', $7, NOW());
          `,
          [
            ticketId,
            file.filename,
            file.originalname,
            filePath,
            file.mimetype || "application/octet-stream",
            file.size || 0,
            user.userId,
          ]
        );
      }
    }

    // Log Activity
    try {
      await createActivityLog(
        user.userId,
        `Updated Ticket Status to ${status}`,
        updatedTicket.created_by,
        {
          ticket_id: updatedTicket.id,
          ticket_code: updatedTicket.ticket_code,
          previous_status: currentTicket.status,
          new_status: status,
          resolution_note: resolutionNote || updatedTicket.resolution_note,
        }
      );
    } catch (logErr) {
      console.error("Activity log error:", logErr);
    }

    // Notify ticket creator & General Admin about the status update
    try {
      let notifTitle = `Ticket ${updatedTicket.ticket_code} Updated`;
      let notifType = "ticket_status_changed";

      if (status === "Resolved") {
        notifTitle = `Ticket ${updatedTicket.ticket_code} Resolved`;
        notifType = "ticket_resolved";
      } else if (status === "Closed") {
        notifTitle = `Ticket ${updatedTicket.ticket_code} Closed`;
        notifType = "ticket_closed";
      } else if (status === "In Progress") {
        notifTitle = `Ticket ${updatedTicket.ticket_code} In Progress`;
        notifType = "ticket_in_progress";
      }

      const creatorMsg = `Your ticket ${updatedTicket.ticket_code}: "${updatedTicket.title}" status has been updated to "${status}".` +
        (resolutionNote ? ` Resolution Note: ${resolutionNote}` : "");

      // 1. Notify Creator (Employee or Admin)
      if (updatedTicket.created_by) {
        if (updatedTicket.created_by_role === "employee") {
          await createEmployeeNotification(
            updatedTicket.created_by,
            notifTitle,
            creatorMsg,
            notifType
          );
        } else {
          await createAdminNotification(
            updatedTicket.created_by,
            notifTitle,
            creatorMsg,
            notifType
          );
        }
      }

      // 2. Notify General Admins
      const genAdmins = await client.query(
        "SELECT id FROM admin WHERE (role = 'general_admin' OR role = 'super_admin') AND is_active = true"
      );
      const adminMsg = `Ticket ${updatedTicket.ticket_code}: "${updatedTicket.title}" status has been updated to "${status}".` +
        (resolutionNote ? ` Resolution Note: ${resolutionNote}` : "");

      for (const ga of genAdmins.rows) {
        if (updatedTicket.created_by_role !== "employee" && String(updatedTicket.created_by) === String(ga.id)) {
          continue;
        }
        await createAdminNotification(
          ga.id,
          notifTitle,
          adminMsg,
          notifType
        );
      }
    } catch (notifErr) {
      console.error("Status update notification error:", notifErr);
    }

    await client.query("COMMIT");
    return updatedTicket;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Assign or Reassign Ticket to a responsible person (with optional session termination)
const assignTicket = async (ticketId, assignedToId, priority, user, terminateSession = false, terminationReason = "") => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const currentCheck = await client.query("SELECT * FROM support_tickets WHERE id = $1", [ticketId]);
    if (currentCheck.rows.length === 0) {
      throw new Error("Ticket not found");
    }
    const currentTicket = currentCheck.rows[0];
    const previousAssigneeId = currentTicket.assigned_to;
    const isTerminatingSession = Boolean(terminateSession && currentTicket.status === "In Progress");

    // If session is terminated, restart the entire process fresh: status becomes 'Open'
    // If ticket was Open, status remains 'Open'
    let newStatus = currentTicket.status;
    let reassignedCount = currentTicket.reassigned_count || 0;
    let termReason = currentTicket.termination_reason;

    if (isTerminatingSession) {
      newStatus = "Open"; // Process restarts fresh from Open!
      reassignedCount += 1;
      termReason = terminationReason || "Session terminated by General Admin";
    } else if (currentTicket.status === "Open") {
      newStatus = "Open";
    }

    const newPriority = priority ? await resolvePriorityUUID(client, priority) : currentTicket.priority;

    const updateQuery = `
      UPDATE support_tickets
      SET 
        assigned_to = $1,
        status = $2,
        priority = $3,
        reassigned_count = $4,
        termination_reason = $5,
        previous_assigned_to = $6,
        updated_at = NOW()
      WHERE id = $7
      RETURNING *;
    `;

    const updateRes = await client.query(updateQuery, [
      assignedToId,
      newStatus,
      newPriority,
      reassignedCount,
      termReason,
      previousAssigneeId,
      ticketId,
    ]);
    const updatedTicket = updateRes.rows[0];

    // Activity Log
    const actionText = isTerminatingSession
      ? `Terminated active session and reassigned Ticket ${updatedTicket.ticket_code} (Process Restarted)`
      : `Assigned Ticket ${updatedTicket.ticket_code}`;

    try {
      await createActivityLog(
        user.userId,
        actionText,
        assignedToId,
        {
          ticket_id: updatedTicket.id,
          ticket_code: updatedTicket.ticket_code,
          previous_assignee: previousAssigneeId,
          new_assignee: assignedToId,
          terminated_session: isTerminatingSession,
          termination_reason: termReason,
          status: newStatus,
        }
      );
    } catch (logErr) {
      console.error("Activity log error:", logErr);
    }

    // Notify previous agent if their in-progress session was terminated
    if (isTerminatingSession && previousAssigneeId) {
      try {
        await createAdminNotification(
          previousAssigneeId,
          "Ticket Session Terminated & Reassigned",
          `Your active session on Ticket ${updatedTicket.ticket_code}: "${updatedTicket.title}" was terminated by General Admin and reassigned. Reason: ${termReason}`,
          "ticket_session_terminated"
        );
      } catch (notifErr) {
        console.error("Previous assignee notification error:", notifErr);
      }
    }

    // Notify the newly assigned agent
    try {
      if (assignedToId) {
        const msg = isTerminatingSession
          ? `Ticket ${updatedTicket.ticket_code}: "${updatedTicket.title}" has been reassigned to you (Process restarted fresh).`
          : `You have been assigned to Ticket ${updatedTicket.ticket_code}: "${updatedTicket.title}".`;
        await createAdminNotification(
          assignedToId,
          "Support Ticket Assigned to You",
          msg,
          "ticket_assigned"
        );
      }
    } catch (notifErr) {
      console.error("Assignee notification error:", notifErr);
    }

    await client.query("COMMIT");
    return updatedTicket;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Get Available Agents for assignment (Admins and General Admins)
const getAvailableAgents = async () => {
  const query = `
    SELECT 
      id,
      name,
      email,
      role
    FROM admin
    WHERE is_active = true
    ORDER BY name ASC;
  `;
  const result = await pool.query(query);
  return result.rows;
};

// Summary metrics (Totals by status)
const getTicketStats = async (user, scope = "all") => {
  let whereClause = "";
  const values = [];

  // If scope === 'my' (My Tickets page) or user is employee:
  // Show ONLY tickets created by this user
  if (scope === "my" || user.role === "employee") {
    if (["admin", "general_admin"].includes((user.role || "").toLowerCase())) {
      whereClause = "WHERE created_by = $1 AND LOWER(COALESCE(created_by_role, '')) IN ('admin', 'general_admin')";
    } else {
      whereClause = "WHERE created_by = $1 AND LOWER(COALESCE(created_by_role, '')) NOT IN ('admin', 'general_admin')";
    }
    values.push(user.userId);
  } else if (user.role === "admin") {
    // On Manage Tickets page, Admin only sees stats for tickets assigned to them
    whereClause = "WHERE assigned_to = $1";
    values.push(user.userId);
  }

  const query = `
    SELECT 
      COUNT(*) AS total,
      COUNT(*) FILTER (WHERE status = 'Open') AS open_count,
      COUNT(*) FILTER (WHERE status = 'In Progress') AS in_progress_count,
      COUNT(*) FILTER (WHERE status = 'Resolved') AS resolved_count,
      COUNT(*) FILTER (WHERE status = 'Closed') AS closed_count
    FROM support_tickets
    ${whereClause};
  `;

  const result = await pool.query(query, values);
  const row = result.rows[0];

  return {
    total: parseInt(row.total, 10) || 0,
    open: parseInt(row.open_count, 10) || 0,
    inProgress: parseInt(row.in_progress_count, 10) || 0,
    resolved: parseInt(row.resolved_count, 10) || 0,
    closed: parseInt(row.closed_count, 10) || 0,
  };
};

module.exports = {
  createTicket,
  getMyTickets,
  getAllTickets,
  getTicketById,
  updateTicketStatus,
  assignTicket,
  getAvailableAgents,
  getTicketStats,
};
