const pool = require("../config/databse");
const { decodeUUIDToId } = require("../utils/uuidUtils");

const normalizeRecipientId = (val) => {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "string" && val.includes("-")) {
    const decoded = decodeUUIDToId(val);
    return Number.isInteger(decoded) && decoded > 0 ? decoded : null;
  }
  const num = Number(val);
  return Number.isInteger(num) && num > 0 ? num : null;
};

// Create employee notification
const createEmployeeNotification = async (
  employeeId,
  title,
  message,
  type = "general",
) => {
  if (!employeeId) return null;

  const result = await pool.query(
    `INSERT INTO employee_notifications
     (employee_id, title, message, type, is_read)
     VALUES ($1, $2, $3, $4, false)
     RETURNING *`,
    [employeeId, title, message, type],
  );

  return result.rows[0];
};

// Create admin notification
const createAdminNotification = async (
  adminId,
  title,
  message,
  type = "general",
) => {
  if (!adminId) return null;

  const result = await pool.query(
    `INSERT INTO admin_notifications
     (admin_id, title, message, type, is_read)
     VALUES ($1, $2, $3, $4, false)
     RETURNING *`,
    [adminId, title, message, type],
  );

  return result.rows[0];
};

// Get employee notifications
const getEmployeeNotifications = async (employeeId) => {
  const result = await pool.query(
    `SELECT id, employee_id, title, message, type, is_read, created_at
     FROM employee_notifications
     WHERE employee_id = $1
     ORDER BY created_at DESC`,
    [employeeId],
  );

  return {
    success: true,
    status: 200,
    notifications: result.rows,
  };
};

// Get admin notifications
const getAdminNotifications = async (adminId) => {
  const result = await pool.query(
    `SELECT id, admin_id, title, message, type, is_read, created_at
     FROM admin_notifications
     WHERE admin_id = $1
     ORDER BY created_at DESC`,
    [adminId],
  );

  return {
    success: true,
    status: 200,
    notifications: result.rows,
  };
};

// Get employee notification by id
const getEmployeeNotificationById = async (notificationId, employeeId) => {
  const result = await pool.query(
    `UPDATE employee_notifications
     SET is_read = true
     WHERE id = $1 AND employee_id = $2
     RETURNING *`,
    [notificationId, employeeId],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Employee notification not found",
    };
  }

  return {
    success: true,
    status: 200,
    message: "Employee notification marked as read",
    notification: result.rows[0],
  };
};

// Get admin notification by id
const getAdminNotificationById = async (notificationId, adminId) => {
  const result = await pool.query(
    `UPDATE admin_notifications
     SET is_read = true
     WHERE id = $1 AND admin_id = $2
     RETURNING *`,
    [notificationId, adminId],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Admin notification not found",
    };
  }

  return {
    success: true,
    status: 200,
    message: "Admin notification marked as read",
    notification: result.rows[0],
  };
};

// Get employee unread count
const getEmployeeUnreadCount = async (employeeId) => {
  const result = await pool.query(
    `SELECT COUNT(*) AS count
     FROM employee_notifications
     WHERE employee_id = $1 AND is_read = false`,
    [employeeId],
  );

  return Number(result.rows[0].count);
};

// Get admin unread count
const getAdminUnreadCount = async (adminId) => {
  const result = await pool.query(
    `SELECT COUNT(*) AS count
     FROM admin_notifications
     WHERE admin_id = $1 AND is_read = false`,
    [adminId],
  );

  return Number(result.rows[0].count);
};

const markAllEmployeeNotificationsAsRead = async (employeeId) => {
  const result = await pool.query(
    `UPDATE employee_notifications
     SET is_read = true
     WHERE employee_id = $1 AND is_read = false
     RETURNING id`,
    [employeeId],
  );

  return {
    success: true,
    status: 200,
    message: "All employee notifications marked as read",
    updatedCount: result.rowCount,
  };
};

const markAllAdminNotificationsAsRead = async (adminId) => {
  const result = await pool.query(
    `UPDATE admin_notifications
     SET is_read = true
     WHERE admin_id = $1 AND is_read = false
     RETURNING id`,
    [adminId],
  );

  return {
    success: true,
    status: 200,
    message: "All admin notifications marked as read",
    updatedCount: result.rowCount,
  };
};

// Validate notification input
const validateManagementInput = (data) => {
  const {
    title,
    details,
    notificationType,
    status,
    expiresAt,
    adminIds = [],
    employeeIds = [],
  } = data;

  if (!title?.trim() || !details?.trim()) {
    throw new Error("Title and details are required");
  }

  if (!["all_users", "separate_users"].includes(notificationType)) {
    throw new Error("Invalid notification type");
  }

  if (!["active", "inactive"].includes(status)) {
    throw new Error("Invalid notification status");
  }

  if (!expiresAt || !/^\d{4}-\d{2}-\d{2}$/.test(expiresAt)) {
    throw new Error("A valid expiry date is required");
  }

  const parsedDate = new Date(`${expiresAt}T00:00:00Z`);

  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== expiresAt
  ) {
    throw new Error("Invalid expiry date");
  }

  const today = new Date().toISOString().slice(0, 10);

  if (expiresAt < today) {
    throw new Error("Expiry date cannot be in the past");
  }

  if (!Array.isArray(adminIds) || !Array.isArray(employeeIds)) {
    throw new Error("Recipient selections must be arrays");
  }

  const cleanAdminIds = (Array.isArray(adminIds) ? adminIds : [adminIds])
    .map(normalizeRecipientId)
    .filter(Boolean);
  const cleanEmployeeIds = (Array.isArray(employeeIds) ? employeeIds : [employeeIds])
    .map(normalizeRecipientId)
    .filter(Boolean);

  if (
    notificationType === "separate_users" &&
    cleanAdminIds.length === 0 &&
    cleanEmployeeIds.length === 0
  ) {
    throw new Error("Select at least one Admin or Employee");
  }
};

// Validate and save separate recipients
const saveManagementRecipients = async (
  client,
  notificationId,
  adminIds = [],
  employeeIds = [],
) => {
  const uniqueAdminIds = [
    ...new Set(
      (Array.isArray(adminIds) ? adminIds : [adminIds])
        .map(normalizeRecipientId)
        .filter(Boolean),
    ),
  ];
  const uniqueEmployeeIds = [
    ...new Set(
      (Array.isArray(employeeIds) ? employeeIds : [employeeIds])
        .map(normalizeRecipientId)
        .filter(Boolean),
    ),
  ];

  if (uniqueAdminIds.length === 0 && uniqueEmployeeIds.length === 0) {
    throw new Error("Select at least one Admin or Employee");
  }

  if (uniqueAdminIds.length) {
    const admins = await client.query(
      `SELECT id
       FROM admin
       WHERE id = ANY($1::int[])
         AND is_active = true`,
      [uniqueAdminIds],
    );

    if (admins.rowCount !== uniqueAdminIds.length) {
      throw new Error("One or more selected Admins are invalid or inactive");
    }
  }

  if (uniqueEmployeeIds.length) {
    const employees = await client.query(
      `SELECT id, admin_id
       FROM users
       WHERE id = ANY($1::int[])
         AND is_active = true`,
      [uniqueEmployeeIds],
    );

    if (employees.rowCount !== uniqueEmployeeIds.length) {
      throw new Error("One or more selected Employees are invalid or inactive");
    }

    // Ensure the creator admin of every selected employee is included
    for (const emp of employees.rows) {
      if (emp.admin_id && !uniqueAdminIds.includes(Number(emp.admin_id))) {
        uniqueAdminIds.push(Number(emp.admin_id));
      }
    }
  }

  for (const adminId of uniqueAdminIds) {
    await client.query(
      `INSERT INTO notification_template_recipients
       (notification_id, recipient_type, admin_id, user_id)
       VALUES ($1, 'admin', $2, NULL)`,
      [notificationId, adminId],
    );
  }

  for (const employeeId of uniqueEmployeeIds) {
    await client.query(
      `INSERT INTO notification_template_recipients
       (notification_id, recipient_type, user_id, admin_id)
       VALUES ($1, 'employee', $2, NULL)`,
      [notificationId, employeeId],
    );
  }
};

// List notification management records
const getManagementNotifications = async (query = {}) => {
  const { page, limit, search, status, type } = query;
  const isPaginated = page !== undefined || limit !== undefined;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.max(parseInt(limit, 10) || 5, 1);
  const offset = (pageNum - 1) * limitNum;

  const conditions = [];
  const params = [];

  if (search && search.trim()) {
    params.push(`%${search.trim().toLowerCase()}%`);
    conditions.push(
      `(LOWER(nt.title) LIKE $${params.length} OR LOWER(nt.details) LIKE $${params.length})`
    );
  }

  if (status && status !== "all") {
    params.push(status);
    conditions.push(`nt.status = $${params.length}`);
  }

  if (type && type !== "all") {
    params.push(type);
    conditions.push(`nt.notification_type = $${params.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count total matching
  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT nt.id)::int AS total
     FROM notification_templates nt
     ${whereClause}`,
    params,
  );
  const total = countResult.rows[0]?.total || 0;

  const queryParams = [...params];
  let queryText = `
    SELECT
       nt.*,
       COUNT(DISTINCT CASE
         WHEN nr.recipient_type = 'admin' THEN nr.admin_id
       END)::int AS selected_admin_count,
       COUNT(DISTINCT CASE
         WHEN nr.recipient_type = 'employee' THEN nr.user_id
       END)::int AS selected_employee_count
     FROM notification_templates nt
     LEFT JOIN notification_template_recipients nr
       ON nr.notification_id = nt.id
     ${whereClause}
     GROUP BY nt.id
     ORDER BY nt.created_at DESC, nt.id DESC
  `;

  if (isPaginated) {
    queryParams.push(limitNum);
    const limitIdx = queryParams.length;
    queryParams.push(offset);
    const offsetIdx = queryParams.length;
    queryText += ` LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  }

  const result = await pool.query(queryText, queryParams);

  if (isPaginated) {
    return {
      notifications: result.rows,
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.max(1, Math.ceil(total / limitNum)),
    };
  }

  return result.rows;
};

// Get active Admin and Employee options
const getManagementRecipients = async () => {
  const [admins, employees] = await Promise.all([
    pool.query(
      `SELECT id, name, email
       FROM admin
       WHERE is_active = true
         AND LOWER(role) = 'admin'
       ORDER BY name`,
    ),
    pool.query(
      `SELECT id, name, email, admin_id
       FROM users
       WHERE is_active = true
         AND LOWER(role) = 'employee'
       ORDER BY name`,
    ),
  ]);

  return {
    admins: admins.rows,
    employees: employees.rows,
  };
};

// Get one management notification
const getManagementNotificationById = async (id) => {
  const result = await pool.query(
    `SELECT *
     FROM notification_templates
     WHERE id = $1`,
    [id],
  );

  if (!result.rowCount) return null;

  const recipients = await pool.query(
    `SELECT 
       ntr.id,
       ntr.recipient_type,
       ntr.admin_id,
       ntr.user_id,
       adm.name AS admin_name,
       adm.email AS admin_email,
       emp.name AS employee_name,
       emp.email AS employee_email,
       emp.admin_id AS employee_admin_id,
       creator_adm.name AS employee_creator_admin_name
     FROM notification_template_recipients ntr
     LEFT JOIN admin adm ON (ntr.recipient_type = 'admin' AND ntr.admin_id = adm.id)
     LEFT JOIN users emp ON (ntr.recipient_type = 'employee' AND ntr.user_id = emp.id)
     LEFT JOIN admin creator_adm ON (ntr.recipient_type = 'employee' AND emp.admin_id = creator_adm.id)
     WHERE ntr.notification_id = $1
     ORDER BY ntr.id`,
    [id],
  );

  const adminRows = recipients.rows.filter((item) => item.recipient_type === "admin");
  const employeeRows = recipients.rows.filter((item) => item.recipient_type === "employee");

  return {
    ...result.rows[0],
    adminIds: adminRows.map((item) => item.admin_id),
    employeeIds: employeeRows.map((item) => item.user_id),
    admins: adminRows.map((item) => ({
      id: item.admin_id,
      name: item.admin_name,
      email: item.admin_email,
    })),
    employees: employeeRows.map((item) => ({
      id: item.user_id,
      name: item.employee_name,
      email: item.employee_email,
      admin_id: item.employee_admin_id,
      creator_admin_name: item.employee_creator_admin_name,
    })),
  };
};

// Create management notification
const createManagementNotification = async (data, createdBy) => {
  validateManagementInput(data);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `INSERT INTO notification_templates
       (title, details, notification_type, status, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [
        data.title.trim(),
        data.details.trim(),
        data.notificationType,
        data.status,
        data.expiresAt,
        createdBy,
      ],
    );

    const notification = result.rows[0];

    if (data.notificationType === "separate_users") {
      await saveManagementRecipients(
        client,
        notification.id,
        data.adminIds || [],
        data.employeeIds || [],
      );
    }

    await client.query("COMMIT");
    return getManagementNotificationById(notification.id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Update management notification
const updateManagementNotification = async (id, data) => {
  validateManagementInput(data);

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existing = await client.query(
      `SELECT id
       FROM notification_templates
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    if (!existing.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }

    const result = await client.query(
      `UPDATE notification_templates
       SET title = $1,
           details = $2,
           notification_type = $3,
           status = $4,
           expires_at = $5,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6
       RETURNING *`,
      [
        data.title.trim(),
        data.details.trim(),
        data.notificationType,
        data.status,
        data.expiresAt,
        id,
      ],
    );

    await client.query(
      `DELETE FROM notification_template_recipients
       WHERE notification_id = $1`,
      [id],
    );

    if (data.notificationType === "separate_users") {
      await saveManagementRecipients(
        client,
        id,
        data.adminIds || [],
        data.employeeIds || [],
      );
    }

    await client.query("COMMIT");
    return getManagementNotificationById(result.rows[0].id);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Delete management notification
const deleteManagementNotification = async (id) => {
  const result = await pool.query(
    `DELETE FROM notification_templates
     WHERE id = $1
     RETURNING id`,
    [id],
  );

  return result.rowCount > 0;
};

// Send a management notification now
const sendManagementNotification = async (id) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const templateResult = await client.query(
      `SELECT *
       FROM notification_templates
       WHERE id = $1
       FOR UPDATE`,
      [id],
    );

    if (!templateResult.rowCount) {
      throw new Error("Notification not found");
    }

    const template = templateResult.rows[0];

    const todayResult = await client.query(
      `SELECT CURRENT_DATE::text AS today`,
    );

    if (template.status !== "active") {
      throw new Error("Inactive notifications cannot be sent");
    }

    if (String(template.expires_at).slice(0, 10) < todayResult.rows[0].today) {
      throw new Error("This notification has expired");
    }

    let adminIds = [];
    let employeeIds = [];

    if (template.notification_type === "all_users") {
      const [admins, employees] = await Promise.all([
        client.query(
          `SELECT id
           FROM admin
           WHERE is_active = true`,
        ),
        client.query(
          `SELECT id
           FROM users
           WHERE is_active = true`,
        ),
      ]);

      adminIds = admins.rows.map((row) => row.id);
      employeeIds = employees.rows.map((row) => row.id);
    } else {
      const recipients = await client.query(
        `SELECT recipient_type, admin_id, user_id
         FROM notification_template_recipients
         WHERE notification_id = $1`,
        [id],
      );

      adminIds = recipients.rows
        .filter((row) => row.recipient_type === "admin")
        .map((row) => row.admin_id);

      employeeIds = recipients.rows
        .filter((row) => row.recipient_type === "employee")
        .map((row) => row.user_id);
    }

    const activeAdmins = adminIds.length
      ? await client.query(
          `SELECT id
           FROM admin
           WHERE id = ANY($1::int[])
             AND is_active = true`,
          [adminIds],
        )
      : { rows: [] };

    const activeEmployees = employeeIds.length
      ? await client.query(
          `SELECT id
           FROM users
           WHERE id = ANY($1::int[])
             AND is_active = true`,
          [employeeIds],
        )
      : { rows: [] };

    let sentCount = 0;
    let failedCount = 0;

    for (const admin of activeAdmins.rows) {
      try {
        await client.query(
          `INSERT INTO admin_notifications
           (admin_id, title, message, type, is_read)
           VALUES ($1, $2, $3, 'general', false)`,
          [admin.id, template.title, template.details],
        );

        await client.query(
          `INSERT INTO notification_delivery_logs
           (notification_id, recipient_type, admin_id, user_id,
            delivery_status, sent_at, error_message)
           VALUES ($1, 'admin', $2, NULL, 'sent', CURRENT_TIMESTAMP, NULL)
           ON CONFLICT (notification_id, admin_id)
           WHERE recipient_type = 'admin'
           DO UPDATE SET
             delivery_status = 'sent',
             sent_at = CURRENT_TIMESTAMP,
             error_message = NULL`,
          [id, admin.id],
        );

        sentCount++;
      } catch (error) {
        await client.query(
          `INSERT INTO notification_delivery_logs
           (notification_id, recipient_type, admin_id, user_id,
            delivery_status, error_message)
           VALUES ($1, 'admin', $2, NULL, 'failed', $3)
           ON CONFLICT (notification_id, admin_id)
           WHERE recipient_type = 'admin'
           DO UPDATE SET
             delivery_status = 'failed',
             error_message = EXCLUDED.error_message`,
          [id, admin.id, error.message],
        );

        failedCount++;
      }
    }

    for (const employee of activeEmployees.rows) {
      try {
        await client.query(
          `INSERT INTO employee_notifications
           (employee_id, title, message, type, is_read)
           VALUES ($1, $2, $3, 'general', false)`,
          [employee.id, template.title, template.details],
        );

        await client.query(
          `INSERT INTO notification_delivery_logs
           (notification_id, recipient_type, admin_id, user_id,
            delivery_status, sent_at, error_message)
           VALUES ($1, 'employee', NULL, $2, 'sent', CURRENT_TIMESTAMP, NULL)
           ON CONFLICT (notification_id, user_id)
           WHERE recipient_type = 'employee'
           DO UPDATE SET
             delivery_status = 'sent',
             sent_at = CURRENT_TIMESTAMP,
             error_message = NULL`,
          [id, employee.id],
        );

        sentCount++;
      } catch (error) {
        await client.query(
          `INSERT INTO notification_delivery_logs
           (notification_id, recipient_type, admin_id, user_id,
            delivery_status, error_message)
           VALUES ($1, 'employee', NULL, $2, 'failed', $3)
           ON CONFLICT (notification_id, user_id)
           WHERE recipient_type = 'employee'
           DO UPDATE SET
             delivery_status = 'failed',
             error_message = EXCLUDED.error_message`,
          [id, employee.id, error.message],
        );

        failedCount++;
      }
    }

    await client.query("COMMIT");

    return {
      notificationId: id,
      sentCount,
      failedCount,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  createEmployeeNotification,
  createAdminNotification,
  getEmployeeNotifications,
  getAdminNotifications,
  getEmployeeNotificationById,
  getAdminNotificationById,
  getEmployeeUnreadCount,
  getAdminUnreadCount,
  markAllEmployeeNotificationsAsRead,
  markAllAdminNotificationsAsRead,
  getManagementNotifications,
  getManagementRecipients,
  getManagementNotificationById,
  createManagementNotification,
  updateManagementNotification,
  deleteManagementNotification,
  sendManagementNotification,
};
