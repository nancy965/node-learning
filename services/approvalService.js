const pool = require("../config/databse");
const { createActivityLog } = require("./activityLogService");
const {
  createEmployeeNotification,
  createAdminNotification,
} = require("./notificationService");

// Generate unique request code e.g. REQ-1001, REQ-1002
const generateRequestCode = async (client) => {
  try {
    const res = await client.query(`
      SELECT COALESCE(MAX(CAST(NULLIF(regexp_replace(request_code, '[^0-9]', '', 'g'), '') AS INTEGER)), 1000) + 1 AS next_num
      FROM approval_requests
    `);
    const num = res.rows[0]?.next_num || 1001;
    return `REQ-${num}`;
  } catch {
    const countRes = await client.query("SELECT COUNT(*) AS cnt FROM approval_requests");
    const nextNumber = 1001 + Number(countRes.rows[0]?.cnt || 0);
    return `REQ-${nextNumber}`;
  }
};


// UUID Validation Helper
const isUUID = (val) => {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(val || "").trim()
  );
};

// Resolve request_type (either UUID string or name) to common_master UUID
const resolveRequestTypeUUID = async (client, val) => {
  if (!val) return null;
  const str = String(val).trim();
  if (isUUID(str)) return str;

  const res = await client.query(
    `SELECT id FROM common_master WHERE LOWER(type) = 'approval_request_type' AND LOWER(name) = LOWER($1) LIMIT 1`,
    [str]
  );
  if (res.rows.length > 0) {
    return res.rows[0].id;
  }

  const fallback = await client.query(
    `SELECT id FROM common_master WHERE LOWER(type) = 'approval_request_type' ORDER BY (CASE WHEN LOWER(name) LIKE '%general%' THEN 1 ELSE 2 END), created_at ASC LIMIT 1`
  );
  return fallback.rows[0]?.id || null;
};

// Format Approval row so UI displays human readable names while preserving UUIDs
const formatApprovalRow = (row) => {
  if (!row) return row;
  return {
    ...row,
    request_type_id: row.request_type,
    request_type: row.request_type_name || row.request_type,
    request_type_name: row.request_type_name || row.request_type,
  };
};

// Create a new Approval Request
const createRequest = async (requestData, user, files = []) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { title, description, request_type, amount } = requestData;

    if (!title || !title.trim()) {
      throw new Error("Request title is required");
    }
    if (!description || !description.trim()) {
      throw new Error("Request description is required");
    }
    if (!request_type || !request_type.trim()) {
      throw new Error("Request type is required");
    }

    const resolvedRequestType = await resolveRequestTypeUUID(client, request_type);
    if (!resolvedRequestType) {
      throw new Error("Invalid request type: not found in master records");
    }

    const userId = user.userId;
    let userRole = (user.role || "employee").toLowerCase();

    // Check if user is in admin table
    const adminCheck = await client.query("SELECT id, role FROM admin WHERE id = $1", [userId]);
    if (adminCheck.rows.length > 0) {
      userRole = adminCheck.rows[0].role.toLowerCase();
    }

    const parsedAmount = amount ? parseFloat(amount) : null;

    // Disallow general admin from creating approval requests
    if (userRole === "general_admin" || userRole === "super_admin") {
      throw new Error("General Admin is not permitted to create approval requests.");
    }

    let stepsConfig = [];
    if (userRole === "admin") {
      // Admin requests bypass step 1 and go directly to General Admin
      stepsConfig = [
        {
          step_number: 1,
          step_name: "General Admin Review",
          approver_role: "general_admin",
          assigned_approver_id: null,
        },
      ];
    } else {
      // Employee request: Step 1 = employee's direct Admin, Step 2 = General Admin
      const uRes = await client.query("SELECT admin_id, name FROM users WHERE id = $1;", [userId]);
      const employeeAdminId = uRes.rows[0]?.admin_id ? Number(uRes.rows[0].admin_id) : null;

      stepsConfig = [
        {
          step_number: 1,
          step_name: "Direct Admin Review",
          approver_role: "admin",
          assigned_approver_id: employeeAdminId,
        },
        {
          step_number: 2,
          step_name: "General Admin Sign-off",
          approver_role: "general_admin",
          assigned_approver_id: null,
        },
      ];
    }

    const totalSteps = stepsConfig.length;
    const requestCode = await generateRequestCode(client);

    // 2. Insert into approval_requests
    const insertReqRes = await client.query(
      `
      INSERT INTO approval_requests (
        request_code,
        request_type,
        title,
        description,
        amount,
        status,
        current_step,
        total_steps,
        requested_by,
        requested_by_role,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, 'Pending', 1, $6, $7, $8, NOW(), NOW())
      RETURNING *;
      `,
      [
        requestCode,
        resolvedRequestType,
        title.trim(),
        description.trim(),
        parsedAmount,
        totalSteps,
        userId,
        userRole,
      ]
    );

    const createdRequest = insertReqRes.rows[0];

    // 3. Insert Steps into approval_steps
    const createdSteps = [];
    for (let i = 0; i < stepsConfig.length; i++) {
      const stepConf = stepsConfig[i];
      const stepNum = i + 1;
      const initialStatus = stepNum === 1 ? "Pending" : "Waiting";

      const insertStepRes = await client.query(
        `
        INSERT INTO approval_steps (
          request_id,
          step_number,
          step_name,
          approver_role,
          assigned_approver_id,
          status,
          created_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        RETURNING *;
        `,
        [
          createdRequest.id,
          stepNum,
          stepConf.step_name || `Step ${stepNum}`,
          stepConf.approver_role || "admin",
          stepConf.assigned_approver_id || null,
          initialStatus,
        ]
      );
      createdSteps.push(insertStepRes.rows[0]);
    }

    // 4. Save uploaded attachments if any
    const attachments = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const filePath = `/uploads/approvals/${file.filename}`;
        const attachRes = await client.query(
          `
          INSERT INTO approval_attachments (
            request_id,
            step_id,
            file_name,
            original_name,
            file_path,
            file_type,
            file_size,
            source,
            uploaded_by,
            created_at
          )
          VALUES ($1, NULL, $2, $3, $4, $5, $6, 'request', $7, NOW())
          RETURNING *;
          `,
          [
            createdRequest.id,
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

    // 5. Activity Log
    try {
      await createActivityLog(
        userId,
        `Submitted Approval Request ${requestCode} (${request_type})`,
        userId,
        {
          request_id: createdRequest.id,
          request_code: requestCode,
          request_type,
          title,
          amount: parsedAmount,
          total_steps: totalSteps,
        }
      );
    } catch (logErr) {
      console.error("Activity log error on request creation:", logErr);
    }

    // 6. Notify Initial Approver
    try {
      if (userRole === "admin") {
        // Admin created request -> notify General Admin directly
        const gaRes = await client.query(
          "SELECT id FROM admin WHERE role IN ('general_admin', 'super_admin') AND is_active = true;"
        );
        for (const ga of gaRes.rows) {
          await createAdminNotification(
            ga.id,
            `Action Required: Request ${requestCode}`,
            `New approval request ${requestCode} ("${title.trim()}") submitted by Admin requires your review.`,
            "approval_request_created"
          );
        }
      } else {
        // Employee created request -> notify employee's direct Admin ONLY
        const uRes = await client.query("SELECT admin_id, name FROM users WHERE id = $1;", [userId]);
        const employeeAdminId = uRes.rows[0]?.admin_id ? Number(uRes.rows[0].admin_id) : null;
        const employeeName = uRes.rows[0]?.name || "Employee";

        if (employeeAdminId) {
          await createAdminNotification(
            employeeAdminId,
            `Action Required: Request ${requestCode}`,
            `New approval request ${requestCode} ("${title.trim()}") submitted by ${employeeName} requires your review.`,
            "approval_request_created"
          );
        } else {
          // Fallback if employee has no admin assigned
          const adminList = await client.query("SELECT id FROM admin WHERE role = 'admin' AND is_active = true;");
          for (const adm of adminList.rows) {
            await createAdminNotification(
              adm.id,
              `Action Required: Request ${requestCode}`,
              `New approval request ${requestCode} ("${title.trim()}") submitted by ${employeeName} requires your review.`,
              "approval_request_created"
            );
          }
        }
      }
    } catch (notifErr) {
      console.error("Notification error on request creation:", notifErr);
    }

    await client.query("COMMIT");

    createdRequest.steps = createdSteps;
    createdRequest.attachments = attachments;
    return formatApprovalRow(createdRequest);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Get My Requests (submitted by the logged-in user)
const getMyRequests = async (userId, userRole, queryParams = {}) => {
  const {
    page = 1,
    limit = 10,
    status = "all",
    request_type = "all",
    search = "",
  } = queryParams;

  const offset = (Number(page) - 1) * Number(limit);
  const values = [userId];
  let paramIndex = 2;

  let whereClause = "ar.requested_by = $1";

  if (status && status !== "all") {
    whereClause += ` AND LOWER(ar.status) = LOWER($${paramIndex})`;
    values.push(status);
    paramIndex++;
  }

  if (request_type && request_type !== "all") {
    whereClause += ` AND (ar.request_type::text = $${paramIndex} OR LOWER(cm_rt.name) = LOWER($${paramIndex}))`;
    values.push(request_type);
    paramIndex++;
  }

  if (search && search.trim()) {
    whereClause += ` AND (
      ar.title ILIKE $${paramIndex} OR 
      ar.request_code ILIKE $${paramIndex} OR 
      ar.description ILIKE $${paramIndex}
    )`;
    values.push(`%${search.trim()}%`);
    paramIndex++;
  }

  // Count query
  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM approval_requests ar
    LEFT JOIN common_master cm_rt ON cm_rt.id = ar.request_type
    WHERE ${whereClause}
  `;
  const countRes = await pool.query(countQuery, values);
  const total = countRes.rows[0].total;

  // Data query with current step name
  const dataQuery = `
    SELECT 
      ar.*,
      cm_rt.name AS request_type_name,
      cur_step.step_name AS current_step_name,
      cur_step.approver_role AS current_approver_role,
      (SELECT COUNT(*)::int FROM approval_attachments WHERE request_id = ar.id) AS attachments_count
    FROM approval_requests ar
    LEFT JOIN common_master cm_rt ON cm_rt.id = ar.request_type
    LEFT JOIN approval_steps cur_step 
      ON cur_step.request_id = ar.id AND cur_step.step_number = ar.current_step
    WHERE ${whereClause}
    ORDER BY ar.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
  `;

  values.push(Number(limit), Number(offset));
  const dataRes = await pool.query(dataQuery, values);

  return {
    requests: dataRes.rows.map(formatApprovalRow),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)) || 1,
    },
  };
};

// Get Approval Inbox (for approvers: action required or all organization requests)
const getApprovalInbox = async (user, queryParams = {}) => {
  const {
    page = 1,
    limit = 10,
    tab = "action_required", // "action_required" | "all" | "history"
    status = "all",
    request_type = "all",
    search = "",
  } = queryParams;

  const offset = (Number(page) - 1) * Number(limit);
  const userRole = (user.role || "").toLowerCase();
  const userId = user.userId;

  const values = [];
  let paramIndex = 1;
  let whereConditions = [];

  if (tab === "action_required") {
    // Only pending requests where current active step matches user's approver role
    whereConditions.push("ar.status IN ('Pending', 'In Review')");
    whereConditions.push("cur_step.status = 'Pending'");

    if (userRole === "general_admin" || userRole === "super_admin") {
      // General Admin ONLY reviews 'general_admin' steps
      whereConditions.push("cur_step.approver_role = 'general_admin'");
      whereConditions.push(`(
        LOWER(ar.requested_by_role) = 'admin'
        OR EXISTS (
          SELECT 1 FROM approval_steps s1
          WHERE s1.request_id = ar.id AND s1.step_number = 1 AND s1.status = 'Approved'
        )
      )`);
    } else {
      // Regular admin reviews 'admin' steps for their assigned employees ONLY
      whereConditions.push("cur_step.approver_role = 'admin'");
      whereConditions.push("LOWER(ar.requested_by_role) = 'employee'");
      whereConditions.push(`(
        cur_step.assigned_approver_id = $${paramIndex}
        OR ar.requested_by IN (SELECT id FROM users WHERE admin_id = $${paramIndex})
      )`);
      values.push(userId);
      paramIndex++;

      // Admin does not approve their own request
      whereConditions.push(`ar.requested_by != $${paramIndex}`);
      values.push(userId);
      paramIndex++;
    }
  } else if (tab === "history") {
    // Requests decided by this user
    whereConditions.push(`EXISTS (
      SELECT 1 FROM approval_steps ast 
      WHERE ast.request_id = ar.id 
      AND ast.action_by = $${paramIndex}
    )`);
    values.push(userId);
    paramIndex++;
  } else {
    // tab === "all"
    if (userRole === "general_admin" || userRole === "super_admin") {
      // General Admin sees:
      // 1) All requests submitted by Admins (direct to general admin)
      // 2) All requests submitted by Employees that were APPROVED at Step 1 (or current_step >= 2)
      whereConditions.push(`(
        LOWER(ar.requested_by_role) = 'admin'
        OR EXISTS (
          SELECT 1 FROM approval_steps s1
          WHERE s1.request_id = ar.id AND s1.step_number = 1 AND s1.status = 'Approved'
        )
      )`);
    } else {
      // Regular admin sees ALL requests from their assigned employees
      whereConditions.push("LOWER(ar.requested_by_role) = 'employee'");
      whereConditions.push(`(
        ar.requested_by IN (SELECT id FROM users WHERE admin_id = $${paramIndex})
        OR cur_step.assigned_approver_id = $${paramIndex}
        OR EXISTS (
          SELECT 1 FROM approval_steps ast 
          WHERE ast.request_id = ar.id AND ast.action_by = $${paramIndex}
        )
      )`);
      values.push(userId);
      paramIndex++;
    }
  }

  if (status && status !== "all") {
    whereConditions.push(`LOWER(ar.status) = LOWER($${paramIndex})`);
    values.push(status);
    paramIndex++;
  }

  if (request_type && request_type !== "all") {
    whereConditions.push(`(ar.request_type::text = $${paramIndex} OR LOWER(cm_rt.name) = LOWER($${paramIndex}))`);
    values.push(request_type);
    paramIndex++;
  }

  if (search && search.trim()) {
    whereConditions.push(`(
      ar.title ILIKE $${paramIndex} OR 
      ar.request_code ILIKE $${paramIndex} OR 
      ar.description ILIKE $${paramIndex} OR
      requester.name ILIKE $${paramIndex}
    )`);
    values.push(`%${search.trim()}%`);
    paramIndex++;
  }

  const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(" AND ")}` : "";

  // Count query
  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM approval_requests ar
    LEFT JOIN common_master cm_rt ON cm_rt.id = ar.request_type
    LEFT JOIN approval_steps cur_step 
      ON cur_step.request_id = ar.id AND cur_step.step_number = ar.current_step
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = ar.requested_by AND LOWER(COALESCE(ar.requested_by_role, '')) IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM users WHERE id = ar.requested_by AND LOWER(COALESCE(ar.requested_by_role, '')) NOT IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM admin WHERE id = ar.requested_by
      UNION ALL
      SELECT name, email FROM users WHERE id = ar.requested_by
      LIMIT 1
    ) requester ON true
    ${whereClause}
  `;

  const countRes = await pool.query(countQuery, values);
  const total = countRes.rows[0].total;

  // Data query
  const dataQuery = `
    SELECT 
      ar.*,
      cm_rt.name AS request_type_name,
      requester.name AS requester_name,
      requester.email AS requester_email,
      cur_step.step_name AS current_step_name,
      cur_step.approver_role AS current_approver_role,
      cur_step.id AS current_step_id,
      (SELECT COUNT(*)::int FROM approval_attachments WHERE request_id = ar.id) AS attachments_count
    FROM approval_requests ar
    LEFT JOIN common_master cm_rt ON cm_rt.id = ar.request_type
    LEFT JOIN approval_steps cur_step 
      ON cur_step.request_id = ar.id AND cur_step.step_number = ar.current_step
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = ar.requested_by AND LOWER(COALESCE(ar.requested_by_role, '')) IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM users WHERE id = ar.requested_by AND LOWER(COALESCE(ar.requested_by_role, '')) NOT IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM admin WHERE id = ar.requested_by
      UNION ALL
      SELECT name, email FROM users WHERE id = ar.requested_by
      LIMIT 1
    ) requester ON true
    ${whereClause}
    ORDER BY ar.created_at DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
  `;

  values.push(Number(limit), Number(offset));
  const dataRes = await pool.query(dataQuery, values);

  return {
    requests: dataRes.rows.map(formatApprovalRow),
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)) || 1,
    },
  };
};

// Get Full Request Details by ID (including steps timeline and attachments)
const getRequestById = async (requestId, user) => {
  const reqRes = await pool.query(
    `
    SELECT 
      ar.*,
      cm_rt.name AS request_type_name,
      requester.name AS requester_name,
      requester.email AS requester_email,
      cur_step.step_name AS current_step_name,
      cur_step.approver_role AS current_approver_role,
      cur_step.id AS current_step_id
    FROM approval_requests ar
    LEFT JOIN common_master cm_rt ON cm_rt.id = ar.request_type
    LEFT JOIN approval_steps cur_step 
      ON cur_step.request_id = ar.id AND cur_step.step_number = ar.current_step
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = ar.requested_by AND LOWER(COALESCE(ar.requested_by_role, '')) IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM users WHERE id = ar.requested_by AND LOWER(COALESCE(ar.requested_by_role, '')) NOT IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM admin WHERE id = ar.requested_by
      UNION ALL
      SELECT name, email FROM users WHERE id = ar.requested_by
      LIMIT 1
    ) requester ON true
    WHERE ar.id = $1
    LIMIT 1;
    `,
    [requestId]
  );

  if (reqRes.rows.length === 0) {
    throw new Error("Approval request not found");
  }

  const request = reqRes.rows[0];

  // Permissions: Employee can only view their own requests
  if (user.role === "employee" && String(request.requested_by) !== String(user.userId)) {
    throw new Error("You do not have permission to view this request");
  }

  // Fetch Steps with action_by user names
  const stepsRes = await pool.query(
    `
    SELECT 
      ast.*,
      actor.name AS action_by_name,
      actor.email AS action_by_email
    FROM approval_steps ast
    LEFT JOIN LATERAL (
      SELECT name, email FROM admin WHERE id = ast.action_by AND LOWER(COALESCE(ast.action_by_role, '')) IN ('admin', 'general_admin')
      UNION ALL
      SELECT name, email FROM users WHERE id = ast.action_by
      LIMIT 1
    ) actor ON true
    WHERE ast.request_id = $1
    ORDER BY ast.step_number ASC;
    `,
    [requestId]
  );
  request.steps = stepsRes.rows;

  if (!request.current_approver_role && request.steps && request.steps.length > 0) {
    const curStep = request.steps.find((s) => Number(s.step_number) === Number(request.current_step));
    if (curStep) {
      request.current_approver_role = curStep.approver_role;
      request.current_step_name = curStep.step_name;
    }
  }

  // Fetch Attachments
  const attachRes = await pool.query(
    `
    SELECT *
    FROM approval_attachments
    WHERE request_id = $1
    ORDER BY id ASC;
    `,
    [requestId]
  );
  request.attachments = attachRes.rows;

  return formatApprovalRow(request);
};

// Process Approval Decision (Approve or Reject)
const processDecision = async (requestId, decision, comment, user, files = []) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (!["Approved", "Rejected"].includes(decision)) {
      throw new Error("Decision must be either 'Approved' or 'Rejected'");
    }

    if (decision === "Rejected" && (!comment || !comment.trim())) {
      throw new Error("A reason/comment is required when rejecting a request.");
    }

    const reqCheck = await client.query(
      "SELECT * FROM approval_requests WHERE id = $1 FOR UPDATE;",
      [requestId]
    );

    if (reqCheck.rows.length === 0) {
      throw new Error("Approval request not found");
    }

    const request = reqCheck.rows[0];

    if (request.status === "Approved" || request.status === "Rejected" || request.status === "Cancelled") {
      throw new Error(`This request has already been ${request.status.toLowerCase()} and cannot be modified.`);
    }

    const currentStepNum = request.current_step;

    // Get current step
    const stepCheck = await client.query(
      `SELECT * FROM approval_steps WHERE request_id = $1 AND step_number = $2 FOR UPDATE;`,
      [requestId, currentStepNum]
    );

    if (stepCheck.rows.length === 0) {
      throw new Error("Current approval step not found");
    }

    const currentStep = stepCheck.rows[0];

    if (currentStep.status !== "Pending") {
      throw new Error(`Current step status is already "${currentStep.status}".`);
    }

    const userId = user.userId;
    const userRole = (user.role || "").toLowerCase();

    // Permission check for approver
    const requiredRole = (currentStep.approver_role || "admin").toLowerCase();
    if (requiredRole === "general_admin") {
      if (userRole !== "general_admin" && userRole !== "super_admin") {
        throw new Error("Only a General Admin can approve this step.");
      }
    } else {
      if (!userRole.includes("admin")) {
        throw new Error("Only an Admin can approve this step.");
      }
    }

    // Save decision attachments if any
    if (files && files.length > 0) {
      for (const file of files) {
        const filePath = `/uploads/approvals/${file.filename}`;
        await client.query(
          `
          INSERT INTO approval_attachments (
            request_id,
            step_id,
            file_name,
            original_name,
            file_path,
            file_type,
            file_size,
            source,
            uploaded_by,
            created_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, 'approval', $8, NOW());
          `,
          [
            requestId,
            currentStep.id,
            file.filename,
            file.originalname,
            filePath,
            file.mimetype || "application/octet-stream",
            file.size || 0,
            userId,
          ]
        );
      }
    }

    if (decision === "Approved") {
      // 1. Update current step to Approved
      await client.query(
        `
        UPDATE approval_steps
        SET 
          status = 'Approved',
          decision_comment = $1,
          action_by = $2,
          action_by_role = $3,
          decided_at = NOW()
        WHERE id = $4;
        `,
        [comment ? comment.trim() : null, userId, userRole, currentStep.id]
      );

      // Check if there is another step
      const nextStepNum = currentStepNum + 1;
      const nextStepCheck = await client.query(
        `SELECT * FROM approval_steps WHERE request_id = $1 AND step_number = $2;`,
        [requestId, nextStepNum]
      );

      if (nextStepCheck.rows.length > 0) {
        // Activate Next Step
        await client.query(
          `
          UPDATE approval_steps
          SET status = 'Pending'
          WHERE id = $1;
          `,
          [nextStepCheck.rows[0].id]
        );

        await client.query(
          `
          UPDATE approval_requests
          SET 
            current_step = $1,
            status = 'In Review',
            updated_at = NOW()
          WHERE id = $2;
          `,
          [nextStepNum, requestId]
        );

        // Notify next approver (General Admin)
        try {
          const nextRole = nextStepCheck.rows[0].approver_role;
          let nextApproverQuery = "";
          if (nextRole === "general_admin") {
            nextApproverQuery = "SELECT id FROM admin WHERE role IN ('general_admin', 'super_admin') AND is_active = true";
          } else {
            nextApproverQuery = "SELECT id FROM admin WHERE is_active = true";
          }
          const nextApprovers = await client.query(nextApproverQuery);
          for (const ga of nextApprovers.rows) {
            await createAdminNotification(
              ga.id,
              `Action Required: Request ${request.request_code}`,
              `Request ${request.request_code} ("${request.title}") has been approved by Direct Admin and now requires your final sign-off.`,
              "approval_step_pending"
            );
          }
        } catch (notifErr) {
          console.error("Progression notification error:", notifErr);
        }
      } else {
        // Fully Approved by General Admin!
        await client.query(
          `
          UPDATE approval_requests
          SET 
            status = 'Approved',
            resolved_at = NOW(),
            updated_at = NOW()
          WHERE id = $1;
          `,
          [requestId]
        );

        // Notify Requester of final approval (employee or admin)
        try {
          const fullAppMsg = `Great news! Your request ${request.request_code} ("${request.title}") has been approved by General Admin.`;
          if (request.requested_by_role === "employee") {
            await createEmployeeNotification(
              request.requested_by,
              `Request ${request.request_code} Approved ✅`,
              fullAppMsg,
              "approval_fully_approved"
            );
          } else {
            await createAdminNotification(
              request.requested_by,
              `Request ${request.request_code} Approved ✅`,
              fullAppMsg,
              "approval_fully_approved"
            );
          }
        } catch (notifErr) {
          console.error("Full approval notification error:", notifErr);
        }
      }
    } else {
      // Decision === "Rejected"
      await client.query(
        `
        UPDATE approval_steps
        SET 
          status = 'Rejected',
          decision_comment = $1,
          action_by = $2,
          action_by_role = $3,
          decided_at = NOW()
        WHERE id = $4;
        `,
        [comment.trim(), userId, userRole, currentStep.id]
      );

      // Skip remaining steps
      await client.query(
        `
        UPDATE approval_steps
        SET status = 'Skipped'
        WHERE request_id = $1 AND step_number > $2;
        `,
        [requestId, currentStepNum]
      );

      // Set request to Rejected
      await client.query(
        `
        UPDATE approval_requests
        SET 
          status = 'Rejected',
          resolved_at = NOW(),
          updated_at = NOW()
        WHERE id = $1;
        `,
        [requestId]
      );

      // Notify Requester of rejection (whether rejected by Admin or General Admin)
      try {
        const rejecterTitle = (currentStep.approver_role === "general_admin" || userRole === "general_admin") 
          ? "General Admin" 
          : "Admin";
        const rejMsg = `Your request ${request.request_code} ("${request.title}") was rejected by ${rejecterTitle}. Reason: "${comment.trim()}"`;

        if (request.requested_by_role === "employee") {
          await createEmployeeNotification(
            request.requested_by,
            `Request ${request.request_code} Rejected ❌`,
            rejMsg,
            "approval_rejected"
          );
        } else {
          await createAdminNotification(
            request.requested_by,
            `Request ${request.request_code} Rejected ❌`,
            rejMsg,
            "approval_rejected"
          );
        }
      } catch (notifErr) {
        console.error("Rejection notification error:", notifErr);
      }
    }

    // Activity Log
    try {
      await createActivityLog(
        userId,
        `${decision} Request ${request.request_code} at Step ${currentStepNum}`,
        request.requested_by,
        {
          request_id: requestId,
          request_code: request.request_code,
          decision,
          step_number: currentStepNum,
          comment,
        }
      );
    } catch (logErr) {
      console.error("Activity log error on decision:", logErr);
    }

    await client.query("COMMIT");

    return await getRequestById(requestId, user);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Cancel Request (by requester)
const cancelRequest = async (requestId, user) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const check = await client.query(
      "SELECT * FROM approval_requests WHERE id = $1 FOR UPDATE;",
      [requestId]
    );

    if (check.rows.length === 0) {
      throw new Error("Request not found");
    }

    const request = check.rows[0];

    if (String(request.requested_by) !== String(user.userId)) {
      throw new Error("Only the requester can cancel their request");
    }

    if (request.status !== "Pending") {
      throw new Error(`Cannot cancel a request with status "${request.status}".`);
    }

    await client.query(
      `
      UPDATE approval_requests
      SET status = 'Cancelled', updated_at = NOW()
      WHERE id = $1;
      `,
      [requestId]
    );

    await client.query(
      `
      UPDATE approval_steps
      SET status = 'Skipped'
      WHERE request_id = $1 AND status IN ('Pending', 'Waiting');
      `,
      [requestId]
    );

    await client.query("COMMIT");
    return { success: true, message: "Request cancelled successfully" };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

// Get Approval Stats for KPI cards
const getApprovalStats = async (user) => {
  const userId = user.userId;
  const userRole = (user.role || "").toLowerCase();

  // 1. My Requests Stats
  const myStatsRes = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total,
      COUNT(CASE WHEN status IN ('Pending', 'In Review') THEN 1 END)::int AS pending,
      COUNT(CASE WHEN status = 'Approved' THEN 1 END)::int AS approved,
      COUNT(CASE WHEN status = 'Rejected' THEN 1 END)::int AS rejected
    FROM approval_requests
    WHERE requested_by = $1;
    `,
    [userId]
  );

  const myStats = myStatsRes.rows[0];

  // 2. Approver Inbox Stats (for admins)
  let inboxStats = { action_required: 0, all_requests: 0, total_processed: 0, approved_by_me: 0, rejected_by_me: 0 };

  if (userRole.includes("admin")) {
    let actionReqQuery = "";
    let allReqQuery = "";
    const statsParams = [];

    if (userRole === "general_admin" || userRole === "super_admin") {
      actionReqQuery = `
        SELECT COUNT(*)::int AS action_required
        FROM approval_requests ar
        JOIN approval_steps ast ON ast.request_id = ar.id AND ast.step_number = ar.current_step
        WHERE ar.status IN ('Pending', 'In Review')
        AND ast.status = 'Pending'
        AND ast.approver_role = 'general_admin'
        AND (
          LOWER(ar.requested_by_role) = 'admin'
          OR EXISTS (
            SELECT 1 FROM approval_steps s1
            WHERE s1.request_id = ar.id AND s1.step_number = 1 AND s1.status = 'Approved'
          )
        );
      `;
      allReqQuery = `
        SELECT COUNT(*)::int AS all_requests
        FROM approval_requests ar
        WHERE (
          LOWER(ar.requested_by_role) = 'admin'
          OR EXISTS (
            SELECT 1 FROM approval_steps s1
            WHERE s1.request_id = ar.id AND s1.step_number = 1 AND s1.status = 'Approved'
          )
        );
      `;
    } else {
      statsParams.push(userId);
      actionReqQuery = `
        SELECT COUNT(*)::int AS action_required
        FROM approval_requests ar
        JOIN approval_steps ast ON ast.request_id = ar.id AND ast.step_number = ar.current_step
        WHERE ar.status IN ('Pending', 'In Review')
        AND ast.status = 'Pending'
        AND ast.approver_role = 'admin'
        AND LOWER(ar.requested_by_role) = 'employee'
        AND (
          ast.assigned_approver_id = $1 
          OR ar.requested_by IN (SELECT id FROM users WHERE admin_id = $1)
        )
        AND ar.requested_by != $1;
      `;
      allReqQuery = `
        SELECT COUNT(*)::int AS all_requests
        FROM approval_requests ar
        WHERE LOWER(ar.requested_by_role) = 'employee'
        AND (
          ar.requested_by IN (SELECT id FROM users WHERE admin_id = $1)
          OR EXISTS (
            SELECT 1 FROM approval_steps ast WHERE ast.request_id = ar.id AND (ast.assigned_approver_id = $1 OR ast.action_by = $1)
          )
        );
      `;
    }

    const actionReqRes = await pool.query(actionReqQuery, statsParams);
    const allReqRes = await pool.query(allReqQuery, statsParams);

    const historyRes = await pool.query(
      `
      SELECT 
        COUNT(*)::int AS total_processed,
        COUNT(CASE WHEN status = 'Approved' THEN 1 END)::int AS approved_by_me,
        COUNT(CASE WHEN status = 'Rejected' THEN 1 END)::int AS rejected_by_me
      FROM approval_steps
      WHERE action_by = $1;
      `,
      [userId]
    );

    inboxStats = {
      action_required: actionReqRes.rows[0]?.action_required || 0,
      all_requests: allReqRes.rows[0]?.all_requests || 0,
      total_processed: historyRes.rows[0]?.total_processed || 0,
      approved_by_me: historyRes.rows[0]?.approved_by_me || 0,
      rejected_by_me: historyRes.rows[0]?.rejected_by_me || 0,
    };
  }

  return { myStats, inboxStats };
};

// Get Approval Rules
const getApprovalRules = async () => {
  const res = await pool.query(`
    SELECT 
      ar.id,
      ar.request_type AS request_type_id,
      COALESCE(cm.name, ar.request_type::text) AS request_type,
      cm.name AS request_type_name,
      ar.description,
      ar.steps,
      ar.is_active,
      ar.created_at,
      ar.updated_at
    FROM approval_rules ar
    LEFT JOIN common_master cm ON cm.id = ar.request_type
    WHERE ar.is_active = true 
    ORDER BY ar.id ASC;
  `);
  return res.rows;
};

module.exports = {
  createRequest,
  getMyRequests,
  getApprovalInbox,
  getRequestById,
  processDecision,
  cancelRequest,
  getApprovalStats,
  getApprovalRules,
};
