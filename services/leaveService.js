const pool = require("../config/databse");

/**
 * Helper: Format date as YYYY-MM-DD
 */
const formatDate = (date) => {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

/**
 * 1. Get all active leave types
 */
const getLeaveTypes = async () => {
  const result = await pool.query(`
    SELECT 
      id,
      code,
      name,
      description,
      annual_days,
      is_carry_forward,
      requires_attachment,
      color,
      is_active
    FROM leave_types
    WHERE is_active = true
    ORDER BY id ASC
  `);
  return result.rows;
};

/**
 * 2. Get company holidays for a given year
 */
const getCompanyHolidays = async (year) => {
  const targetYear = parseInt(year, 10) || new Date().getFullYear();
  const result = await pool.query(
    `
    SELECT 
      id,
      name,
      holiday_date,
      is_optional,
      description
    FROM company_holidays
    WHERE EXTRACT(YEAR FROM holiday_date) = $1
    ORDER BY holiday_date ASC
  `,
    [targetYear],
  );
  return result.rows;
};

/**
 * 3. Calculate working days between startDate and endDate
 * Excludes weekends (Sat/Sun) and company holidays
 */
const calculateWorkingDays = async (startDate, endDate) => {
  const finalEndDate = endDate || startDate;
  const start = new Date(startDate);
  const end = new Date(finalEndDate);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error("Invalid start or end date");
  }

  if (start > end) {
    throw new Error("Start date cannot be after end date");
  }

  // Fetch all holidays between these dates
  const holidaysRes = await pool.query(
    `
    SELECT name, holiday_date 
    FROM company_holidays
    WHERE holiday_date >= $1 AND holiday_date <= $2
  `,
    [formatDate(start), formatDate(end)],
  );

  const holidaySet = new Set(
    holidaysRes.rows.map((h) => formatDate(h.holiday_date)),
  );

  let totalCalendarDays = 0;
  let workingDays = 0;
  let weekendDays = 0;
  let holidayDays = 0;
  const holidaysInRange = [];

  const cur = new Date(start);
  while (cur <= end) {
    totalCalendarDays++;
    const dayOfWeek = cur.getDay(); // 0 = Sunday, 6 = Saturday
    const dateStr = formatDate(cur);

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      weekendDays++;
    } else if (holidaySet.has(dateStr)) {
      holidayDays++;
      const holidayItem = holidaysRes.rows.find(
        (h) => formatDate(h.holiday_date) === dateStr,
      );
      if (holidayItem) {
        holidaysInRange.push({
          date: dateStr,
          name: holidayItem.name,
        });
      }
    } else {
      workingDays++;
    }

    cur.setDate(cur.getDate() + 1);
  }

  return {
    startDate: formatDate(start),
    endDate: formatDate(end),
    totalCalendarDays,
    calendarDays: totalCalendarDays,
    workingDays,
    weekendDays,
    holidayDays,
    holidaysInRange,
    breakdown: {
      weekendDays,
      companyHolidays: holidayDays,
    },
  };
};

/**
 * 4. Get employee's leave balance for a given year
 */
const getEmployeeLeaveBalances = async (employeeId, year) => {
  const targetYear = parseInt(year, 10) || new Date().getFullYear();

  // Ensure balances exist for this employee for the given year
  const activeTypes = await pool.query(
    "SELECT id, annual_days FROM leave_types WHERE is_active = true",
  );

  for (const lt of activeTypes.rows) {
    await pool.query(
      `
      INSERT INTO leave_balances (employee_id, employee_role, leave_type_id, year, total_allocated, used_days, pending_days)
      VALUES ($1, 'employee', $2, $3, $4, 0.0, 0.0)
      ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING
    `,
      [employeeId, lt.id, targetYear, lt.annual_days],
    );
  }

  const result = await pool.query(
    `
    SELECT 
      lb.id,
      lb.employee_id,
      lb.leave_type_id,
      lb.year,
      lb.total_allocated,
      lb.used_days,
      lb.pending_days,
      (lb.total_allocated - lb.used_days - lb.pending_days) AS available_days,
      lt.code AS leave_type_code,
      lt.name AS leave_type_name,
      lt.description AS leave_type_description,
      lt.color AS leave_type_color,
      lt.requires_attachment
    FROM leave_balances lb
    JOIN leave_types lt ON lt.id = lb.leave_type_id
    WHERE lb.employee_id = $1 AND lb.year = $2
    ORDER BY lt.id ASC
  `,
    [employeeId, targetYear],
  );

  // Summary
  let totalAllocated = 0;
  let totalUsed = 0;
  let totalPending = 0;
  let totalAvailable = 0;

  const formattedBalances = result.rows.map((row) => {
    const allocated = parseFloat(row.total_allocated) || 0;
    const used = parseFloat(row.used_days) || 0;
    const pending = parseFloat(row.pending_days) || 0;
    const available = Math.max(0, allocated - used - pending);

    totalAllocated += allocated;
    totalUsed += used;
    totalPending += pending;
    totalAvailable += available;

    return {
      ...row,
      total_allocated: allocated,
      used_days: used,
      pending_days: pending,
      available_days: available,
    };
  });

  return {
    year: targetYear,
    balances: formattedBalances,
    summary: {
      totalAllocated,
      totalUsed,
      totalPending,
      totalAvailable,
    },
  };
};

/**
 * 5. Check for overlapping leave requests
 */
const checkOverlappingLeave = async (
  employeeId,
  startDate,
  endDate,
  excludeRequestId = null,
) => {
  const finalEndDate = endDate || startDate;
  let query = `
    SELECT 
      lr.id,
      lr.request_code,
      lr.start_date,
      lr.end_date,
      lr.status,
      lt.name AS leave_type_name
    FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.employee_id = $1
      AND lr.status IN ('Pending', 'Approved')
      AND lr.start_date <= $3
      AND lr.end_date >= $2
  `;
  const params = [employeeId, formatDate(startDate), formatDate(finalEndDate)];

  if (excludeRequestId) {
    query += ` AND lr.id != $4`;
    params.push(excludeRequestId);
  }

  const result = await pool.query(query, params);
  return {
    hasOverlap: result.rows.length > 0,
    conflicts: result.rows,
  };
};

/**
 * 6. Get leave transaction audit ledger
 */
const getLeaveTransactions = async (employeeId, year, filters = {}) => {
  let query = `
    SELECT 
      ltx.id,
      ltx.employee_id,
      COALESCE(lr.employee_name, u.name, adm.name, ltx.employee_id) AS employee_name,
      COALESCE(lr.employee_email, u.email, adm.email, '') AS employee_email,
      ltx.transaction_type,
      ltx.days,
      ltx.balance_before,
      ltx.balance_after,
      ltx.notes,
      ltx.created_by,
      ltx.created_at,
      lt.name AS leave_type_name,
      lt.code AS leave_type_code,
      lt.color AS leave_type_color,
      lr.request_code
    FROM leave_transactions ltx
    JOIN leave_types lt ON lt.id = ltx.leave_type_id
    LEFT JOIN leave_requests lr ON lr.id = ltx.leave_request_id
    LEFT JOIN users u ON u.id::text = ltx.employee_id OR u.register_id::text = ltx.employee_id
    LEFT JOIN admin adm ON adm.id::text = ltx.employee_id OR adm.register_id::text = ltx.employee_id
    WHERE 1=1
  `;
  const params = [];

  if (employeeId) {
    params.push(employeeId);
    query += " AND ltx.employee_id = $" + params.length;
  }

  if (year) {
    params.push(parseInt(year, 10));
    query += " AND EXTRACT(YEAR FROM ltx.created_at) = $" + params.length;
  }

  if (filters.transactionType && filters.transactionType !== "All") {
    params.push(filters.transactionType);
    query += " AND ltx.transaction_type = $" + params.length;
  }

  if (filters.leaveTypeId && filters.leaveTypeId !== "All") {
    params.push(parseInt(filters.leaveTypeId, 10));
    query += " AND ltx.leave_type_id = $" + params.length;
  }

  if (filters.search) {
    params.push("%" + filters.search.trim() + "%");
    const p = "$" + params.length;
    query +=
      " AND (ltx.notes ILIKE " +
      p +
      " OR lr.request_code ILIKE " +
      p +
      " OR u.name ILIKE " +
      p +
      " OR adm.name ILIKE " +
      p +
      ")";
  }

  query += " ORDER BY ltx.created_at DESC, ltx.id DESC LIMIT 200";

  const result = await pool.query(query, params);
  return result.rows;
};

/**
 * 7. Apply for Leave (Employee side)
 */
const applyLeave = async (employeeData, leavePayload) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { employeeId, employeeName, employeeEmail, employeeRole } =
      employeeData;
    const rawTypeId =
      leavePayload.leaveTypeId !== undefined
        ? leavePayload.leaveTypeId
        : leavePayload.leave_type_id;
    const leaveTypeId = Number(rawTypeId);
    const startDate = leavePayload.startDate || leavePayload.start_date;
    const rawEndDate = leavePayload.endDate || leavePayload.end_date;
    // If endDate is omitted or empty, default to startDate for a 1-day leave
    const endDate = rawEndDate || startDate;
    const reason = leavePayload.reason;
    const attachmentPath =
      leavePayload.attachmentPath || leavePayload.attachment_path;

    if (!leaveTypeId || !startDate || !endDate || !reason?.trim()) {
      throw new Error(
        "Leave type, start date, and reason are required",
      );
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new Error("Invalid start or end date format");
    }
    if (start > end) {
      throw new Error("Start date cannot be after end date");
    }

    // Check overlapping requests
    const overlap = await checkOverlappingLeave(employeeId, startDate, endDate);
    if (overlap.hasOverlap) {
      const conflict = overlap.conflicts[0];
      throw new Error(
        `Conflicting leave already exists: ${conflict.request_code} (${formatDate(conflict.start_date)} to ${formatDate(conflict.end_date)}) with status '${conflict.status}'`,
      );
    }

    // Calculate actual working days
    const calc = await calculateWorkingDays(startDate, endDate);
    if (calc.workingDays <= 0) {
      throw new Error(
        "The selected date range contains only weekends or company holidays (0 working days).",
      );
    }

    const requestYear = start.getFullYear();

    // Verify leave type
    const typeRes = await client.query(
      "SELECT id, name, code, requires_attachment FROM leave_types WHERE id = $1 AND is_active = true",
      [leaveTypeId],
    );
    if (typeRes.rows.length === 0) {
      throw new Error("Invalid or inactive leave type selected");
    }
    const leaveType = typeRes.rows[0];

    // Check balance for this year
    const balRes = await client.query(
      `SELECT id, total_allocated, used_days, pending_days 
       FROM leave_balances 
       WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3 
       FOR UPDATE`,
      [employeeId, leaveTypeId, requestYear],
    );

    let balanceRecord;
    if (balRes.rows.length === 0) {
      const initBalRes = await client.query(
        `INSERT INTO leave_balances (employee_id, employee_role, leave_type_id, year, total_allocated, used_days, pending_days)
         VALUES ($1, $2, $3, $4, 0.0, 0.0, 0.0)
         RETURNING id, total_allocated, used_days, pending_days`,
        [employeeId, employeeRole || "employee", leaveTypeId, requestYear],
      );
      balanceRecord = initBalRes.rows[0];
    } else {
      balanceRecord = balRes.rows[0];
    }

    const totalAllocated = parseFloat(balanceRecord.total_allocated) || 0;
    const usedDays = parseFloat(balanceRecord.used_days) || 0;
    const pendingDays = parseFloat(balanceRecord.pending_days) || 0;
    const availableDays = Math.max(0, totalAllocated - usedDays - pendingDays);

    if (calc.workingDays > availableDays) {
      throw new Error(
        `Insufficient leave balance. You have ${availableDays} day(s) available for ${leaveType.name}, but requested ${calc.workingDays} working day(s).`,
      );
    }

    // Generate unique request_code: LR-YYYY-XXXX
    const countRes = await client.query(
      "SELECT COUNT(*) FROM leave_requests WHERE EXTRACT(YEAR FROM created_at) = $1",
      [requestYear],
    );
    const seq = parseInt(countRes.rows[0].count, 10) + 1;
    const requestCode = `LR-${requestYear}-${String(seq).padStart(4, "0")}`;

    // Insert leave request
    const insertReqRes = await client.query(
      `INSERT INTO leave_requests (
        request_code,
        employee_id,
        employee_name,
        employee_email,
        employee_role,
        leave_type_id,
        start_date,
        end_date,
        total_days,
        reason,
        attachment_path,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Pending')
      RETURNING *`,
      [
        requestCode,
        employeeId,
        employeeName,
        employeeEmail,
        employeeRole || "employee",
        leaveTypeId,
        formatDate(start),
        formatDate(end),
        calc.workingDays,
        reason.trim(),
        attachmentPath || null,
      ],
    );
    const newRequest = insertReqRes.rows[0];

    // Update pending_days in balance
    await client.query(
      `UPDATE leave_balances 
       SET pending_days = pending_days + $1, updated_at = NOW()
       WHERE id = $2`,
      [calc.workingDays, balanceRecord.id],
    );

    await client.query("COMMIT");

    // Async notify admins
    try {
      const { createAdminNotification } = require("./notificationService");
      const adminUsers = await pool.query(
        "SELECT id FROM admin WHERE is_active = true LIMIT 5",
      );
      for (const adm of adminUsers.rows) {
        await createAdminNotification(
          adm.id,
          "New Leave Application",
          `${employeeName} applied for ${calc.workingDays} day(s) of ${leaveType.name} (${formatDate(start)} to ${formatDate(end)}).`,
          "leave_request",
        );
      }
    } catch (notifErr) {
      console.warn("Leave notification warning:", notifErr.message);
    }

    return {
      ...newRequest,
      leave_type_name: leaveType.name,
      leave_type_code: leaveType.code,
      calculation: calc,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * 8. Get current employee's leave requests history
 */
const getMyLeaveRequests = async (employeeId, filters = {}) => {
  let query = `
    SELECT 
      lr.id,
      lr.request_code,
      lr.employee_id,
      lr.employee_name,
      lr.employee_email,
      lr.employee_role,
      lr.leave_type_id,
      lr.start_date,
      lr.end_date,
      lr.total_days,
      lr.reason,
      lr.attachment_path,
      lr.status,
      lr.approver_id,
      lr.approver_name,
      lr.decision_date,
      lr.approver_remarks,
      lr.created_at,
      lr.updated_at,
      lt.name AS leave_type_name,
      lt.code AS leave_type_code,
      lt.color AS leave_type_color
    FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.employee_id = $1
  `;
  const params = [employeeId];

  if (filters.status && filters.status !== "All") {
    params.push(filters.status);
    query += ` AND lr.status = $${params.length}`;
  }

  if (filters.year) {
    params.push(parseInt(filters.year, 10));
    query += ` AND EXTRACT(YEAR FROM lr.start_date) = $${params.length}`;
  }

  if (filters.search) {
    params.push(`%${filters.search.trim()}%`);
    query += ` AND (lr.request_code ILIKE $${params.length} OR lr.reason ILIKE $${params.length} OR lt.name ILIKE $${params.length})`;
  }

  query += ` ORDER BY lr.created_at DESC`;

  const result = await pool.query(query, params);
  return result.rows;
};

/**
 * 9. Cancel a pending leave request
 */
const cancelLeaveRequest = async (employeeId, requestId) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const reqRes = await client.query(
      `SELECT * FROM leave_requests WHERE id = $1 AND employee_id = $2 FOR UPDATE`,
      [requestId, employeeId],
    );

    if (reqRes.rows.length === 0) {
      throw new Error("Leave request not found or unauthorized");
    }

    const leaveReq = reqRes.rows[0];
    if (leaveReq.status !== "Pending") {
      throw new Error(
        `Cannot cancel request with status '${leaveReq.status}'. Only pending requests can be cancelled.`,
      );
    }

    const updateRes = await client.query(
      `UPDATE leave_requests 
       SET status = 'Cancelled', updated_at = NOW() 
       WHERE id = $1 
       RETURNING *`,
      [requestId],
    );

    const reqYear = new Date(leaveReq.start_date).getFullYear();
    await client.query(
      `UPDATE leave_balances 
       SET pending_days = GREATEST(0, pending_days - $1), updated_at = NOW()
       WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
      [leaveReq.total_days, employeeId, leaveReq.leave_type_id, reqYear],
    );

    await client.query("COMMIT");
    return updateRes.rows[0];
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * 10. Get leave request by ID
 */
const getLeaveRequestById = async (requestId) => {
  const result = await pool.query(
    `
    SELECT 
      lr.*,
      lt.name AS leave_type_name,
      lt.code AS leave_type_code,
      lt.color AS leave_type_color,
      lt.description AS leave_type_description
    FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.id = $1
  `,
    [requestId],
  );
  if (result.rows.length === 0) {
    throw new Error("Leave request not found");
  }
  return result.rows[0];
};

/**
 * 11. Get all leave requests for Admin (Pending by default or filtered)
 */
const getAllLeaveRequests = async (filters = {}) => {
  let query = `
    SELECT 
      lr.id,
      lr.request_code,
      lr.employee_id,
      lr.employee_name,
      lr.employee_email,
      lr.employee_role,
      lr.leave_type_id,
      lr.start_date,
      lr.end_date,
      lr.total_days,
      lr.reason,
      lr.attachment_path,
      lr.status,
      lr.approver_id,
      lr.approver_name,
      lr.decision_date,
      lr.approver_remarks,
      lr.created_at,
      lr.updated_at,
      lt.name AS leave_type_name,
      lt.code AS leave_type_code,
      lt.color AS leave_type_color,
      COALESCE(lb.total_allocated, 0) AS emp_total_allocated,
      COALESCE(lb.used_days, 0) AS emp_used_days,
      COALESCE(lb.pending_days, 0) AS emp_pending_days,
      GREATEST(0, COALESCE(lb.total_allocated, 0) - COALESCE(lb.used_days, 0) - COALESCE(lb.pending_days, 0)) AS emp_available_days
    FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    LEFT JOIN leave_balances lb ON lb.employee_id = lr.employee_id 
      AND lb.leave_type_id = lr.leave_type_id 
      AND lb.year = EXTRACT(YEAR FROM lr.start_date)
    WHERE 1=1
  `;
  const params = [];

  if (filters.status && filters.status !== "All") {
    params.push(filters.status);
    query += " AND lr.status = $" + params.length;
  }

  if (filters.year) {
    params.push(parseInt(filters.year, 10));
    query += " AND EXTRACT(YEAR FROM lr.start_date) = $" + params.length;
  }

  if (filters.leaveTypeId) {
    params.push(parseInt(filters.leaveTypeId, 10));
    query += " AND lr.leave_type_id = $" + params.length;
  }

  if (filters.employeeId) {
    params.push(filters.employeeId);
    query += " AND lr.employee_id = $" + params.length;
  }

  if (filters.search) {
    params.push("%" + filters.search.trim() + "%");
    const p = "$" + params.length;
    query +=
      " AND (lr.request_code ILIKE " +
      p +
      " OR lr.employee_name ILIKE " +
      p +
      " OR lr.employee_email ILIKE " +
      p +
      " OR lr.reason ILIKE " +
      p +
      " OR lt.name ILIKE " +
      p +
      ")";
  }

  query += ` ORDER BY CASE WHEN lr.status = 'Pending' THEN 1 ELSE 2 END, lr.created_at DESC`;

  const result = await pool.query(query, params);
  return result.rows;
};

/**
 * 12. Get Admin Leave Statistics
 */
const getAdminLeaveStats = async (year) => {
  const targetYear = parseInt(year, 10) || new Date().getFullYear();

  // Pending count
  const pendingRes = await pool.query(
    "SELECT COUNT(*) FROM leave_requests WHERE status = 'Pending' AND EXTRACT(YEAR FROM start_date) = $1",
    [targetYear],
  );

  // Approved this month
  const approvedMonthRes = await pool.query(
    `SELECT COUNT(*) FROM leave_requests 
     WHERE status = 'Approved' 
       AND EXTRACT(YEAR FROM decision_date) = EXTRACT(YEAR FROM CURRENT_DATE) 
       AND EXTRACT(MONTH FROM decision_date) = EXTRACT(MONTH FROM CURRENT_DATE)`,
  );

  // Rejected this month
  const rejectedMonthRes = await pool.query(
    `SELECT COUNT(*) FROM leave_requests 
     WHERE status = 'Rejected' 
       AND EXTRACT(YEAR FROM decision_date) = EXTRACT(YEAR FROM CURRENT_DATE) 
       AND EXTRACT(MONTH FROM decision_date) = EXTRACT(MONTH FROM CURRENT_DATE)`,
  );

  // Employees on leave today
  const onLeaveTodayRes = await pool.query(
    `SELECT 
       lr.id,
       lr.employee_id,
       lr.employee_name,
       lr.start_date,
       lr.end_date,
       lt.name AS leave_type_name,
       lt.color AS leave_type_color
     FROM leave_requests lr
     JOIN leave_types lt ON lt.id = lr.leave_type_id
     WHERE lr.status = 'Approved'
       AND CURRENT_DATE BETWEEN lr.start_date AND lr.end_date`,
  );

  return {
    pendingCount: parseInt(pendingRes.rows[0].count, 10) || 0,
    approvedThisMonth: parseInt(approvedMonthRes.rows[0].count, 10) || 0,
    rejectedThisMonth: parseInt(rejectedMonthRes.rows[0].count, 10) || 0,
    onLeaveTodayCount: onLeaveTodayRes.rows.length,
    onLeaveTodayEmployees: onLeaveTodayRes.rows,
  };
};

/**
 * 13. Admin Decide Leave Request (Approve or Reject)
 */
const decideLeaveRequest = async (adminData, requestId, decisionPayload) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { adminId, adminName } = adminData;
    const { decision, remarks } = decisionPayload;

    if (!decision || !["Approved", "Rejected"].includes(decision)) {
      throw new Error("Invalid decision. Must be 'Approved' or 'Rejected'.");
    }

    if (decision === "Rejected" && !remarks?.trim()) {
      throw new Error(
        "A reason/remark is required when rejecting a leave request.",
      );
    }

    const reqRes = await client.query(
      `SELECT lr.*, lt.name AS leave_type_name, lt.code AS leave_type_code 
       FROM leave_requests lr
       JOIN leave_types lt ON lt.id = lr.leave_type_id
       WHERE lr.id = $1 
       FOR UPDATE`,
      [requestId],
    );

    if (reqRes.rows.length === 0) {
      throw new Error("Leave request not found");
    }

    const leaveReq = reqRes.rows[0];

    if (leaveReq.status !== "Pending") {
      throw new Error(
        `Cannot decide on request with status '${leaveReq.status}'. Only 'Pending' requests can be approved or rejected.`,
      );
    }

    const reqYear = new Date(leaveReq.start_date).getFullYear();

    // Fetch employee balance record
    const balRes = await client.query(
      `SELECT * FROM leave_balances 
       WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3 
       FOR UPDATE`,
      [leaveReq.employee_id, leaveReq.leave_type_id, reqYear],
    );

    let balRecord = balRes.rows[0];
    const totalAllocated = parseFloat(balRecord?.total_allocated) || 0;
    const usedDays = parseFloat(balRecord?.used_days) || 0;
    const pendingDays = parseFloat(balRecord?.pending_days) || 0;
    const currentAvailable = Math.max(
      0,
      totalAllocated - usedDays - pendingDays,
    );

    const totalDays = parseFloat(leaveReq.total_days);

    if (decision === "Approved") {
      // 1. Update request status to Approved
      const updateReqRes = await client.query(
        `UPDATE leave_requests 
         SET status = 'Approved',
             approver_id = $1,
             approver_name = $2,
             decision_date = NOW(),
             approver_remarks = $3,
             updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [adminId, adminName, remarks?.trim() || "Approved", requestId],
      );

      // 2. Update balance: deduct pending_days, increase used_days
      await client.query(
        `UPDATE leave_balances 
         SET pending_days = GREATEST(0, pending_days - $1),
             used_days = used_days + $1,
             updated_at = NOW()
         WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
        [totalDays, leaveReq.employee_id, leaveReq.leave_type_id, reqYear],
      );

      // 3. Record transaction ledger
      await client.query(
        `INSERT INTO leave_transactions (
          employee_id,
          leave_type_id,
          leave_request_id,
          transaction_type,
          days,
          balance_before,
          balance_after,
          notes,
          created_by
        ) VALUES ($1, $2, $3, 'DEBIT', $4, $5, $6, $7, $8)`,
        [
          leaveReq.employee_id,
          leaveReq.leave_type_id,
          leaveReq.id,
          totalDays,
          currentAvailable + totalDays,
          currentAvailable,
          `Leave Approved by ${adminName}${remarks ? `: ${remarks.trim()}` : ""}`,
          adminName,
        ],
      );

      await client.query("COMMIT");

      // Async notification to employee
      try {
        const {
          createEmployeeNotification,
          createAdminNotification,
        } = require("./notificationService");
        const notifMsg = `Your leave request ${leaveReq.request_code} for ${totalDays} day(s) of ${leaveReq.leave_type_name} has been Approved by ${adminName}.`;
        if (
          leaveReq.employee_role === "admin" ||
          leaveReq.employee_role === "general_admin"
        ) {
          await createAdminNotification(
            leaveReq.employee_id,
            "Leave Request Approved",
            notifMsg,
            "leave_approved",
          );
        } else {
          await createEmployeeNotification(
            leaveReq.employee_id,
            "Leave Request Approved",
            notifMsg,
            "leave_approved",
          );
        }
      } catch (notifyErr) {
        console.error(
          "Failed to send leave approval notification:",
          notifyErr.message,
        );
      }

      return updateReqRes.rows[0];
    } else {
      // Decision === "Rejected"
      // 1. Update request status to Rejected
      const updateReqRes = await client.query(
        `UPDATE leave_requests 
         SET status = 'Rejected',
             approver_id = $1,
             approver_name = $2,
             decision_date = NOW(),
             approver_remarks = $3,
             updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [adminId, adminName, remarks.trim(), requestId],
      );

      // 2. Update balance: release pending_days back to available
      await client.query(
        `UPDATE leave_balances 
         SET pending_days = GREATEST(0, pending_days - $1),
             updated_at = NOW()
         WHERE employee_id = $2 AND leave_type_id = $3 AND year = $4`,
        [totalDays, leaveReq.employee_id, leaveReq.leave_type_id, reqYear],
      );

      // 3. Record transaction ledger
      await client.query(
        `INSERT INTO leave_transactions (
          employee_id,
          leave_type_id,
          leave_request_id,
          transaction_type,
          days,
          balance_before,
          balance_after,
          notes,
          created_by
        ) VALUES ($1, $2, $3, 'CREDIT_REVERSAL', $4, $5, $6, $7, $8)`,
        [
          leaveReq.employee_id,
          leaveReq.leave_type_id,
          leaveReq.id,
          totalDays,
          currentAvailable,
          currentAvailable + totalDays,
          `Leave Rejected by ${adminName}: ${remarks.trim()}`,
          adminName,
        ],
      );

      await client.query("COMMIT");

      // Async notification to employee
      try {
        const {
          createEmployeeNotification,
          createAdminNotification,
        } = require("./notificationService");
        const notifMsg = `Your leave request ${leaveReq.request_code} for ${leaveReq.leave_type_name} was Rejected by ${adminName}. Reason: ${remarks.trim()}`;
        if (
          leaveReq.employee_role === "admin" ||
          leaveReq.employee_role === "general_admin"
        ) {
          await createAdminNotification(
            leaveReq.employee_id,
            "Leave Request Rejected",
            notifMsg,
            "leave_rejected",
          );
        } else {
          await createEmployeeNotification(
            leaveReq.employee_id,
            "Leave Request Rejected",
            notifMsg,
            "leave_rejected",
          );
        }
      } catch (notifyErr) {
        console.error(
          "Failed to send leave rejection notification:",
          notifyErr.message,
        );
      }

      return updateReqRes.rows[0];
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

/**
 * 14. Get Team Leave Calendar & Availability Matrix (Step 6)
 */
const getTeamLeaveCalendar = async (year, month, filters = {}) => {
  const targetYear = parseInt(year, 10) || new Date().getFullYear();
  const targetMonth = parseInt(month, 10) || new Date().getMonth() + 1;

  // Month boundary (UTC)
  const startOfMonth = new Date(Date.UTC(targetYear, targetMonth - 1, 1));
  const endOfMonth = new Date(Date.UTC(targetYear, targetMonth, 0));

  const startStr = formatDate(startOfMonth);
  const endStr = formatDate(endOfMonth);

  // 1. Fetch Approved Leaves in this month
  let leaveQuery = `
    SELECT 
      lr.id,
      lr.request_code,
      lr.employee_id,
      lr.employee_name,
      lr.employee_email,
      lr.employee_role,
      lr.leave_type_id,
      lr.start_date,
      lr.end_date,
      lr.total_days,
      lr.reason,
      lr.status,
      lt.name AS leave_type_name,
      lt.code AS leave_type_code,
      lt.color AS leave_type_color
    FROM leave_requests lr
    JOIN leave_types lt ON lt.id = lr.leave_type_id
    WHERE lr.status = 'Approved'
      AND lr.start_date <= $2
      AND lr.end_date >= $1
  `;
  const leaveParams = [startStr, endStr];

  if (filters.leaveTypeId && filters.leaveTypeId !== "All") {
    leaveParams.push(parseInt(filters.leaveTypeId, 10));
    leaveQuery += " AND lr.leave_type_id = $" + leaveParams.length;
  }

  if (filters.employeeId) {
    leaveParams.push(filters.employeeId);
    leaveQuery += " AND lr.employee_id = $" + leaveParams.length;
  }

  if (filters.search) {
    leaveParams.push("%" + filters.search.trim() + "%");
    const p = "$" + leaveParams.length;
    leaveQuery +=
      " AND (lr.employee_name ILIKE " +
      p +
      " OR lr.employee_email ILIKE " +
      p +
      " OR lr.request_code ILIKE " +
      p +
      ")";
  }

  leaveQuery += " ORDER BY lr.start_date ASC, lr.employee_name ASC";

  const leavesRes = await pool.query(leaveQuery, leaveParams);

  // 2. Fetch Company Holidays in this month
  const holidaysRes = await pool.query(
    `SELECT id, name, holiday_date, is_optional, description
     FROM company_holidays
     WHERE holiday_date >= $1 AND holiday_date <= $2
     ORDER BY holiday_date ASC`,
    [startStr, endStr],
  );

  // 3. Stats for this month
  const uniqueEmployees = new Set(leavesRes.rows.map((r) => r.employee_id));
  let totalDaysOff = 0;
  leavesRes.rows.forEach((r) => {
    totalDaysOff += parseFloat(r.total_days) || 0;
  });

  return {
    year: targetYear,
    month: targetMonth,
    daysInMonth: endOfMonth.getUTCDate(),
    startDate: startStr,
    endDate: endStr,
    holidays: holidaysRes.rows,
    leaves: leavesRes.rows,
    stats: {
      employeesOnLeaveCount: uniqueEmployees.size,
      totalDaysOff,
      holidayCount: holidaysRes.rows.length,
    },
  };
};

/**
 * 15. Admin Adjust Employee Leave Balance (Step 4 & 5)
 */
const adjustEmployeeLeaveBalance = async (adminData, payload) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { adminId, adminName } = adminData;
    const { employeeId, leaveTypeId, year, days, adjustmentType, reason } =
      payload;

    if (
      !employeeId ||
      !leaveTypeId ||
      !days ||
      !adjustmentType ||
      !reason?.trim()
    ) {
      throw new Error(
        "Employee, leave type, days, adjustment type, and reason are required.",
      );
    }

    const adjustDays = parseFloat(days);
    if (isNaN(adjustDays) || adjustDays <= 0) {
      throw new Error("Days must be a positive number.");
    }

    const targetYear = parseInt(year, 10) || new Date().getFullYear();

    // Fetch or create balance
    let balRes = await client.query(
      `SELECT * FROM leave_balances 
       WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3 
       FOR UPDATE`,
      [employeeId, leaveTypeId, targetYear],
    );

    if (balRes.rows.length === 0) {
      const insRes = await client.query(
        `INSERT INTO leave_balances (employee_id, employee_role, leave_type_id, year, total_allocated, used_days, pending_days)
         VALUES ($1, 'employee', $2, $3, 0.0, 0.0, 0.0)
         RETURNING *`,
        [employeeId, leaveTypeId, targetYear],
      );
      balRes = insRes;
    }

    const balRecord = balRes.rows[0];
    const oldAllocated = parseFloat(balRecord.total_allocated) || 0;
    const used = parseFloat(balRecord.used_days) || 0;
    const pending = parseFloat(balRecord.pending_days) || 0;
    const oldAvailable = Math.max(0, oldAllocated - used - pending);

    let newAllocated = oldAllocated;
    if (adjustmentType === "ADD") {
      newAllocated = oldAllocated + adjustDays;
    } else if (adjustmentType === "DEDUCT") {
      newAllocated = Math.max(used + pending, oldAllocated - adjustDays);
    } else {
      throw new Error("Invalid adjustmentType. Must be 'ADD' or 'DEDUCT'.");
    }

    const newAvailable = Math.max(0, newAllocated - used - pending);

    await client.query(
      `UPDATE leave_balances 
       SET total_allocated = $1, updated_at = NOW()
       WHERE id = $2`,
      [newAllocated, balRecord.id],
    );

    // Record ledger
    await client.query(
      `INSERT INTO leave_transactions (
        employee_id,
        leave_type_id,
        transaction_type,
        days,
        balance_before,
        balance_after,
        notes,
        created_by
      ) VALUES ($1, $2, 'ADJUSTMENT', $3, $4, $5, $6, $7)`,
      [
        employeeId,
        leaveTypeId,
        adjustmentType === "ADD" ? adjustDays : -adjustDays,
        oldAvailable,
        newAvailable,
        `Balance adjusted (${adjustmentType} ${adjustDays} days) by ${adminName}: ${reason.trim()}`,
        adminName,
      ],
    );

    await client.query("COMMIT");

    return {
      success: true,
      employeeId,
      leaveTypeId,
      year: targetYear,
      oldAllocated,
      newAllocated,
      oldAvailable,
      newAvailable,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

module.exports = {
  getLeaveTypes,
  getCompanyHolidays,
  calculateWorkingDays,
  getEmployeeLeaveBalances,
  checkOverlappingLeave,
  getLeaveTransactions,
  applyLeave,
  getMyLeaveRequests,
  cancelLeaveRequest,
  getLeaveRequestById,
  getAllLeaveRequests,
  getAdminLeaveStats,
  decideLeaveRequest,
  getTeamLeaveCalendar,
  adjustEmployeeLeaveBalance,
};
