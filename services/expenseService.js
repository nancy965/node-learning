const pool = require("../config/databse");
const { createActivityLog } = require("./activityLogService");
const {
  createEmployeeNotification,
  createAdminNotification,
} = require("./notificationService");
const payoutService = require("./payoutService");

// Generate unique sequential claim code: EXP-2026-0001
const generateClaimCode = async () => {
  const currentYear = new Date().getFullYear();
  try {
    const res = await pool.query(`
      SELECT COALESCE(MAX(CAST(NULLIF(SUBSTRING(claim_code FROM '([0-9]+)$'), '') AS BIGINT)), 0) + 1 AS next_num
      FROM expense_claims
      WHERE claim_code LIKE 'EXP-' || $1 || '-%'
    `, [String(currentYear)]);
    const num = res.rows[0]?.next_num || 1;
    const safeNum = Number(num) > 999999 ? (await pool.query("SELECT COUNT(*) FROM expense_claims")).rows[0].count + 1 : num;
    return `EXP-${currentYear}-${String(safeNum).padStart(4, "0")}`;
  } catch {
    return `EXP-${currentYear}-${Date.now().toString().slice(-4)}`;
  }
};

// 1. Get Categories
const getCategories = async (includeInactive = false) => {
  const query = includeInactive
    ? "SELECT * FROM expense_categories ORDER BY id ASC"
    : "SELECT * FROM expense_categories WHERE is_active = true ORDER BY id ASC";
  const res = await pool.query(query);
  return res.rows;
};

// 2. Update Category Limits
const updateCategoryLimits = async (id, data, user) => {
  const isGeneralAdmin = String(user?.role).toLowerCase() === "general_admin";
  if (!isGeneralAdmin) {
    throw new Error("Only General Admins have permission to update expense category limits.");
  }
  const { max_limit_per_claim, monthly_limit, is_active } = data;
  const res = await pool.query(
    `UPDATE expense_categories
     SET max_limit_per_claim = COALESCE($1, max_limit_per_claim),
         monthly_limit = COALESCE($2, monthly_limit),
         is_active = COALESCE($3, is_active),
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [max_limit_per_claim, monthly_limit, is_active, id]
  );
  if (res.rows.length === 0) throw new Error("Category not found");
  return res.rows[0];
};

// 3. Create Expense Claim
const createClaim = async (claimData, user, files = []) => {
  const isGeneralAdmin = String(user?.role).toLowerCase() === "general_admin";
  if (isGeneralAdmin) {
    throw new Error("General Admins cannot create expense claims. Only Admins and Employees can submit claims.");
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const {
      category_id,
      title,
      merchant_name = "",
      expense_date,
      claim_amount,
      payment_method = "UPI",
      description = "",
    } = claimData;

    if (!title || !expense_date || !claim_amount) {
      throw new Error("Expense reason/title, expense date, and claim amount are required.");
    }

    const numAmount = parseFloat(claim_amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      throw new Error("Claim amount must be a valid positive number.");
    }

    // Resolve category (use provided category_id or fallback to default active category)
    let category = null;
    let resolvedCatId = category_id ? Number(category_id) : null;
    if (resolvedCatId) {
      const catRes = await client.query(
        "SELECT * FROM expense_categories WHERE id = $1 AND is_active = true",
        [resolvedCatId]
      );
      if (catRes.rows.length > 0) category = catRes.rows[0];
    }
    if (!category) {
      const defCatRes = await client.query(
        "SELECT * FROM expense_categories WHERE is_active = true ORDER BY CASE WHEN category_code = 'MISC' THEN 0 ELSE 1 END, id ASC LIMIT 1"
      );
      if (defCatRes.rows.length > 0) {
        category = defCatRes.rows[0];
        resolvedCatId = category.id;
      }
    }

    const maxLimit = parseFloat(category?.max_limit_per_claim || 10000);
    const isOverLimit = numAmount > maxLimit;

    // Check receipt requirement: required for claims >= 500
    if (numAmount >= 500 && (!files || files.length === 0)) {
      throw new Error("Receipt / bill upload is required for expense claims of ₹500 or more.");
    }

    const claimCode = await generateClaimCode();
    const employeeId = String(user.userId || user.id);
    const employeeRole = user.role || "employee";

    const insertRes = await client.query(
      `INSERT INTO expense_claims (
        claim_code,
        employee_id,
        employee_role,
        category_id,
        title,
        merchant_name,
        expense_date,
        claim_amount,
        approved_amount,
        payment_method,
        status,
        description,
        is_over_limit,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, $9, 'Pending', $10, $11, NOW(), NOW())
      RETURNING *`,
      [
        claimCode,
        employeeId,
        employeeRole,
        resolvedCatId,
        title.trim(),
        merchant_name.trim(),
        expense_date,
        numAmount,
        payment_method,
        description ? description.trim() : "",
        isOverLimit,
      ]
    );

    const claim = insertRes.rows[0];

    // Insert Receipt Attachments
    const attachments = [];
    if (files && files.length > 0) {
      for (const file of files) {
        const filePath = `/uploads/receipts/${file.filename}`;
        const attRes = await client.query(
          `INSERT INTO expense_attachments (
            claim_id,
            file_name,
            original_name,
            file_path,
            file_type,
            file_size,
            uploaded_at
          ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
          RETURNING *`,
          [
            claim.id,
            file.filename,
            file.originalname,
            filePath,
            file.mimetype || "application/octet-stream",
            file.size || 0,
          ]
        );
        attachments.push(attRes.rows[0]);
      }
    }
    claim.attachments = attachments;
    claim.category = category;

    // Log Activity
    try {
      await createActivityLog(
        employeeId,
        "Created Expense Claim",
        employeeId,
        {
          claim_id: claim.id,
          claim_code: claim.claim_code,
          amount: claim.claim_amount,
          category: category.name,
        }
      );
    } catch (e) {
      console.warn("Activity log error:", e.message);
    }

    // Notify Admins
    try {
      const admins = await client.query("SELECT id FROM admin WHERE is_active = true");
      for (const adm of admins.rows) {
        await createAdminNotification(
          adm.id,
          "New Expense Claim Submitted",
          `Claim ${claim.claim_code} for ₹${numAmount.toLocaleString()} (${category.name}) submitted by employee.`,
          "expense_claim"
        );
      }
    } catch (e) {
      console.warn("Admin notification error:", e.message);
    }

    await client.query("COMMIT");
    return claim;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
};

// 4. List Expense Claims (with pagination and filters)
const getClaims = async (user, queryParams = {}) => {
  const {
    status,
    category_id,
    search,
    scope = "all", // "my" or "all"
    page = 1,
    limit = 10,
    startDate,
    endDate,
    tab, // "approvals" | "all_claims" | "my_claims"
  } = queryParams;

  const offset = (Number(page) - 1) * Number(limit);
  const conditions = [];
  const values = [];
  let pIdx = 1;

  const isGeneralAdmin = String(user.role).toLowerCase() === "general_admin";

  // Role scoping: Only general_admin can see company-wide claims (when scope !== "my");
  // All other users (admins, employees) can ONLY see their own claims.
  if (!isGeneralAdmin || scope === "my") {
    conditions.push(`exp.employee_id = $${pIdx}`);
    values.push(String(user.userId || user.id));
    pIdx++;
  }

  // Status & Tab Filtering
  if (tab === "pending") {
    // 1. Only pending claims
    conditions.push(`exp.status = 'Pending'`);
  } else if (tab === "reviewed") {
    // 2. Only Approved and Rejected claims
    if (status && (status === "Approved" || status === "Rejected")) {
      conditions.push(`exp.status = $${pIdx}`);
      values.push(status);
      pIdx++;
    } else {
      conditions.push(`exp.status IN ('Approved', 'Rejected')`);
    }
  } else if (tab === "reimbursed") {
    // 3. Only Reimbursed claims
    conditions.push(`exp.status = 'Reimbursed'`);
  } else if (tab === "approvals") {
    conditions.push(`exp.status = 'Pending'`);
  } else if (status && status !== "all") {
    // All Company Ledger or My Claims: filter by selected status
    conditions.push(`exp.status = $${pIdx}`);
    values.push(status);
    pIdx++;
  }

  if (category_id && category_id !== "all") {
    conditions.push(`exp.category_id = $${pIdx}`);
    values.push(Number(category_id));
    pIdx++;
  }

  if (search && search.trim()) {
    conditions.push(
      `(exp.claim_code ILIKE $${pIdx} OR exp.title ILIKE $${pIdx} OR exp.merchant_name ILIKE $${pIdx})`
    );
    values.push(`%${search.trim()}%`);
    pIdx++;
  }

  if (startDate) {
    conditions.push(`exp.expense_date >= $${pIdx}`);
    values.push(startDate);
    pIdx++;
  }

  if (endDate) {
    conditions.push(`exp.expense_date <= $${pIdx}`);
    values.push(endDate);
    pIdx++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Count query
  const countRes = await pool.query(
    `SELECT COUNT(*) FROM expense_claims exp ${whereClause}`,
    values
  );
  const total = parseInt(countRes.rows[0]?.count || 0, 10);

  // Data query with rich joins
  const dataQuery = `
    SELECT 
      exp.*,
      cat.name AS category_name,
      cat.category_code,
      cat.icon AS category_icon,
      cat.max_limit_per_claim AS category_max_limit,
      COALESCE(
        (SELECT name FROM users WHERE id::text = exp.employee_id LIMIT 1),
        (SELECT name FROM admin WHERE id::text = exp.employee_id LIMIT 1),
        'Employee'
      ) AS employee_name,
      COALESCE(
        (SELECT email FROM users WHERE id::text = exp.employee_id LIMIT 1),
        (SELECT email FROM admin WHERE id::text = exp.employee_id LIMIT 1),
        ''
      ) AS employee_email,
      COALESCE(
        (SELECT name FROM admin WHERE id::text = exp.approved_by LIMIT 1),
        (SELECT name FROM users WHERE id::text = exp.approved_by LIMIT 1),
        'Approver'
      ) AS approver_name,
      COALESCE(
        (SELECT name FROM admin WHERE id::text = exp.reimbursed_by LIMIT 1),
        (SELECT name FROM users WHERE id::text = exp.reimbursed_by LIMIT 1),
        'Finance Admin'
      ) AS reimbursed_by_name,
      (
        SELECT json_build_object(
          'id', b.id,
          'account_holder_name', b.account_holder_name,
          'bank_name', b.bank_name,
          'account_number', b.account_number,
          'account_number_masked', CASE 
            WHEN b.account_number IS NOT NULL AND length(b.account_number) > 4 
            THEN '•••• ' || right(b.account_number, 4) 
            ELSE b.account_number 
          END,
          'ifsc_code', b.ifsc_code,
          'upi_id', b.upi_id,
          'preferred_mode', b.preferred_mode,
          'is_verified', b.is_verified
        )
        FROM employee_bank_details b
        WHERE b.user_id = exp.employee_id
        LIMIT 1
      ) AS employee_bank_details,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', att.id,
              'file_name', att.file_name,
              'original_name', att.original_name,
              'file_path', att.file_path,
              'file_type', att.file_type,
              'file_size', att.file_size
            )
          )
          FROM expense_attachments att
          WHERE att.claim_id = exp.id
        ),
        '[]'::json
      ) AS attachments
    FROM expense_claims exp
    LEFT JOIN expense_categories cat ON exp.category_id = cat.id
    ${whereClause}
    ORDER BY exp.created_at DESC
    LIMIT $${pIdx} OFFSET $${pIdx + 1}
  `;

  const dataRes = await pool.query(dataQuery, [...values, Number(limit), offset]);

  return {
    claims: dataRes.rows,
    pagination: {
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)) || 1,
    },
  };
};

// 5. Get Claim by ID
const getClaimById = async (id, user) => {
  const query = `
    SELECT 
      exp.*,
      cat.name AS category_name,
      cat.category_code,
      cat.icon AS category_icon,
      cat.max_limit_per_claim AS category_max_limit,
      COALESCE(
        (SELECT name FROM users WHERE id::text = exp.employee_id LIMIT 1),
        (SELECT name FROM admin WHERE id::text = exp.employee_id LIMIT 1),
        'Employee'
      ) AS employee_name,
      COALESCE(
        (SELECT email FROM users WHERE id::text = exp.employee_id LIMIT 1),
        (SELECT email FROM admin WHERE id::text = exp.employee_id LIMIT 1),
        ''
      ) AS employee_email,
      COALESCE(
        (SELECT name FROM admin WHERE id::text = exp.approved_by LIMIT 1),
        (SELECT name FROM users WHERE id::text = exp.approved_by LIMIT 1),
        'Approver'
      ) AS approver_name,
      COALESCE(
        (SELECT name FROM admin WHERE id::text = exp.reimbursed_by LIMIT 1),
        (SELECT name FROM users WHERE id::text = exp.reimbursed_by LIMIT 1),
        'Finance Admin'
      ) AS reimbursed_by_name,
      (
        SELECT json_build_object(
          'id', b.id,
          'account_holder_name', b.account_holder_name,
          'bank_name', b.bank_name,
          'account_number', b.account_number,
          'account_number_masked', CASE 
            WHEN b.account_number IS NOT NULL AND length(b.account_number) > 4 
            THEN '•••• ' || right(b.account_number, 4) 
            ELSE b.account_number 
          END,
          'ifsc_code', b.ifsc_code,
          'upi_id', b.upi_id,
          'preferred_mode', b.preferred_mode,
          'is_verified', b.is_verified
        )
        FROM employee_bank_details b
        WHERE b.user_id = exp.employee_id
        LIMIT 1
      ) AS employee_bank_details,
      COALESCE(
        (
          SELECT json_agg(
            json_build_object(
              'id', att.id,
              'file_name', att.file_name,
              'original_name', att.original_name,
              'file_path', att.file_path,
              'file_type', att.file_type,
              'file_size', att.file_size
            )
          )
          FROM expense_attachments att
          WHERE att.claim_id = exp.id
        ),
        '[]'::json
      ) AS attachments
    FROM expense_claims exp
    LEFT JOIN expense_categories cat ON exp.category_id = cat.id
    WHERE exp.id = $1
  `;
  const res = await pool.query(query, [id]);
  if (res.rows.length === 0) throw new Error("Expense claim not found");

  const claim = res.rows[0];
  const isGeneralAdmin = String(user.role).toLowerCase() === "general_admin";
  if (!isGeneralAdmin && String(claim.employee_id) !== String(user.userId || user.id)) {
    throw new Error("You do not have permission to view this expense claim.");
  }

  return claim;
};

// 6. Approve Claim (General Admin only)
const approveClaim = async (id, data, adminUser) => {
  const isGeneralAdmin = String(adminUser.role).toLowerCase() === "general_admin";
  if (!isGeneralAdmin) {
    throw new Error("Only General Admins have permission to approve expense claims.");
  }

  const { approved_amount, notes = "" } = data;
  const adminId = String(adminUser.userId || adminUser.id);

  const claimRes = await pool.query("SELECT * FROM expense_claims WHERE id = $1", [id]);
  if (claimRes.rows.length === 0) throw new Error("Expense claim not found");
  const claim = claimRes.rows[0];

  if (String(claim.employee_id) === String(adminUser.userId || adminUser.id)) {
    throw new Error("You cannot approve your own expense claim.");
  }

  if (claim.status !== "Pending") {
    throw new Error(`Cannot approve a claim with status '${claim.status}'.`);
  }

  const finalApprovedAmount =
    approved_amount !== undefined && approved_amount !== null && approved_amount !== ""
      ? parseFloat(approved_amount)
      : parseFloat(claim.claim_amount);

  if (isNaN(finalApprovedAmount) || finalApprovedAmount <= 0) {
    throw new Error("Approved amount must be a positive number.");
  }

  const updateRes = await pool.query(
    `UPDATE expense_claims
     SET status = 'Approved',
         approved_amount = $1,
         approved_by = $2,
         approved_at = NOW(),
         approval_notes = $3,
         updated_at = NOW()
     WHERE id = $4
     RETURNING *`,
    [finalApprovedAmount, adminId, notes ? notes.trim() : null, id]
  );

  const updatedClaim = updateRes.rows[0];

  // Notify Submitter
  try {
    const isEmp = !["admin", "general_admin"].includes(String(updatedClaim.employee_role).toLowerCase());
    if (isEmp) {
      await createEmployeeNotification(
        updatedClaim.employee_id,
        "Expense Claim Approved 🎉",
        `Your claim ${updatedClaim.claim_code} for ₹${finalApprovedAmount.toLocaleString()} has been approved and is queued for reimbursement.`,
        "expense_claim"
      );
    } else {
      await createAdminNotification(
        updatedClaim.employee_id,
        "Expense Claim Approved 🎉",
        `Your claim ${updatedClaim.claim_code} for ₹${finalApprovedAmount.toLocaleString()} has been approved and is queued for reimbursement.`,
        "expense_claim"
      );
    }
  } catch (e) {
    console.warn("Notification error:", e.message);
  }

  // Log Activity
  try {
    await createActivityLog(adminId, "Approved Expense Claim", updatedClaim.employee_id, {
      claim_id: id,
      claim_code: updatedClaim.claim_code,
      approved_amount: finalApprovedAmount,
      claim_amount: updatedClaim.claim_amount,
    });
  } catch (e) {}

  return updatedClaim;
};

// 7. Reject Claim (General Admin only)
const rejectClaim = async (id, data, adminUser) => {
  const isGeneralAdmin = String(adminUser.role).toLowerCase() === "general_admin";
  if (!isGeneralAdmin) {
    throw new Error("Only General Admins have permission to reject expense claims.");
  }

  const { reason } = data;
  if (!reason || !reason.trim()) {
    throw new Error("A rejection reason is required.");
  }

  const adminId = String(adminUser.userId || adminUser.id);

  const claimRes = await pool.query("SELECT * FROM expense_claims WHERE id = $1", [id]);
  if (claimRes.rows.length === 0) throw new Error("Expense claim not found");
  const claim = claimRes.rows[0];

  if (String(claim.employee_id) === String(adminUser.userId || adminUser.id)) {
    throw new Error("You cannot reject your own expense claim.");
  }

  if (claim.status !== "Pending") {
    throw new Error(`Cannot reject a claim with status '${claim.status}'.`);
  }

  const updateRes = await pool.query(
    `UPDATE expense_claims
     SET status = 'Rejected',
         rejected_by = $1,
         rejected_at = NOW(),
         rejection_reason = $2,
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [adminId, reason.trim(), id]
  );

  const updatedClaim = updateRes.rows[0];

  // Notify Submitter
  try {
    const isEmp = !["admin", "general_admin"].includes(String(updatedClaim.employee_role).toLowerCase());
    if (isEmp) {
      await createEmployeeNotification(
        updatedClaim.employee_id,
        "Expense Claim Rejected",
        `Your claim ${updatedClaim.claim_code} was rejected. Reason: ${reason.trim()}`,
        "expense_claim"
      );
    } else {
      await createAdminNotification(
        updatedClaim.employee_id,
        "Expense Claim Rejected",
        `Your claim ${updatedClaim.claim_code} was rejected. Reason: ${reason.trim()}`,
        "expense_claim"
      );
    }
  } catch (e) {
    console.warn("Notification error:", e.message);
  }

  // Log Activity
  try {
    await createActivityLog(adminId, "Rejected Expense Claim", updatedClaim.employee_id, {
      claim_id: id,
      claim_code: updatedClaim.claim_code,
      reason: reason.trim(),
    });
  } catch (e) {}

  return updatedClaim;
};

// Helper to auto-generate realistic transaction / UTR references based on settlement mode
const generateAutoTransactionRef = (mode = "NEFT / IMPS") => {
  const now = new Date();
  const year = now.getFullYear();
  const monthNames = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  const mon = monthNames[now.getMonth()];
  const yymmdd = `${String(year).slice(-2)}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  const randomDigits = (len) => {
    let res = "";
    for (let i = 0; i < len; i++) res += Math.floor(Math.random() * 10);
    return res;
  };

  const randomAlphaNum = (len) => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let res = "";
    for (let i = 0; i < len; i++) res += chars.charAt(Math.floor(Math.random() * chars.length));
    return res;
  };

  const normalized = (mode || "").toLowerCase().trim();
  if (normalized.includes("upi")) return `UPI-${randomDigits(12)}`;
  if (normalized.includes("neft") || normalized.includes("imps")) return `UTR${yymmdd}${randomDigits(6)}`;
  if (normalized.includes("card")) return `CC-AUTH-${randomDigits(6)}`;
  if (normalized.includes("payroll")) return `PAY-${mon}${String(year).slice(-2)}-${randomDigits(4)}`;
  if (normalized.includes("bank") || normalized.includes("transfer")) return `CBT-${year}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${randomAlphaNum(4)}`;
  if (normalized.includes("cash")) return `CASH-VCH-${randomDigits(5)}`;
  if (normalized.includes("cheque") || normalized.includes("check")) return `CHQ-${randomDigits(6)}`;
  return `TXN-${yymmdd}-${randomAlphaNum(6)}`;
};

// 8. Settle / Reimburse Claim (General Admin only)
const settleClaim = async (id, data, adminUser) => {
  const isGeneralAdmin = String(adminUser.role).toLowerCase() === "general_admin";
  if (!isGeneralAdmin) {
    throw new Error("Only General Admins have permission to settle and reimburse expense claims.");
  }

  const { settlement_mode = "NEFT / IMPS", transaction_ref = "", notes = "", is_instant_payout = false } = data;

  // If automated / instant RazorpayX payout is requested, route to instant payout engine
  if (is_instant_payout || String(settlement_mode).toLowerCase().includes("razorpay")) {
    const payoutRes = await initiateInstantPayout(id, data, adminUser);
    return payoutRes.claim;
  }

  const effectiveRef = (transaction_ref && transaction_ref.trim())
    ? transaction_ref.trim()
    : generateAutoTransactionRef(settlement_mode);

  const adminId = String(adminUser.userId || adminUser.id);

  const claimRes = await pool.query("SELECT * FROM expense_claims WHERE id = $1", [id]);
  if (claimRes.rows.length === 0) throw new Error("Expense claim not found");
  const claim = claimRes.rows[0];

  if (claim.status !== "Approved") {
    throw new Error("Only approved claims can be marked as reimbursed.");
  }

  const updateRes = await pool.query(
    `UPDATE expense_claims
     SET status = 'Reimbursed',
         reimbursed_by = $1,
         reimbursed_at = NOW(),
         settlement_mode = $2,
         transaction_ref = $3,
         settlement_notes = $4,
         updated_at = NOW()
     WHERE id = $5
     RETURNING *`,
    [adminId, settlement_mode, effectiveRef, notes ? notes.trim() : null, id]
  );

  const updatedClaim = updateRes.rows[0];

  // Notify Submitter
  try {
    const isEmp = !["admin", "general_admin"].includes(String(updatedClaim.employee_role).toLowerCase());
    if (isEmp) {
      await createEmployeeNotification(
        updatedClaim.employee_id,
        "Expense Reimbursed to Bank 💸",
        `₹${(updatedClaim.approved_amount || updatedClaim.claim_amount).toLocaleString()} for ${updatedClaim.claim_code} has been disbursed via ${settlement_mode}. UTR Ref: ${effectiveRef}`,
        "expense_claim"
      );
    } else {
      await createAdminNotification(
        updatedClaim.employee_id,
        "Expense Reimbursed to Bank 💸",
        `₹${(updatedClaim.approved_amount || updatedClaim.claim_amount).toLocaleString()} for ${updatedClaim.claim_code} has been disbursed via ${settlement_mode}. UTR Ref: ${effectiveRef}`,
        "expense_claim"
      );
    }
  } catch (e) {
    console.warn("Notification error:", e.message);
  }

  // Log Activity
  try {
    await createActivityLog(adminId, "Settled Expense Claim", updatedClaim.employee_id, {
      claim_id: id,
      claim_code: updatedClaim.claim_code,
      disbursed: updatedClaim.approved_amount || updatedClaim.claim_amount,
      ref: effectiveRef,
    });
  } catch (e) {}

  return updatedClaim;
};

// 9. Delete Claim (Draft / Pending only)
const deleteClaim = async (id, user) => {
  const claimRes = await pool.query("SELECT * FROM expense_claims WHERE id = $1", [id]);
  if (claimRes.rows.length === 0) throw new Error("Claim not found");
  const claim = claimRes.rows[0];

  const isAdmin = ["admin", "general_admin"].includes(String(user.role).toLowerCase());
  if (!isAdmin && String(claim.employee_id) !== String(user.userId || user.id)) {
    throw new Error("You do not have permission to delete this claim.");
  }

  if (claim.status !== "Pending") {
    throw new Error("Only pending claims can be cancelled or deleted.");
  }

  await pool.query("DELETE FROM expense_claims WHERE id = $1", [id]);
  return { success: true, message: `Claim ${claim.claim_code} deleted successfully.` };
};

// 10. Summary KPIs & Stats
const getExpenseStats = async (user, scope = "all") => {
  const isGeneralAdmin = String(user.role).toLowerCase() === "general_admin";
  const conditions = [];
  const values = [];

  if (!isGeneralAdmin || scope === "my") {
    conditions.push(`employee_id = $1`);
    values.push(String(user.userId || user.id));
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const statsRes = await pool.query(`
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(claim_amount), 0) AS total_claimed_amount,
      COUNT(*) FILTER (WHERE status = 'Pending') AS pending_count,
      COALESCE(SUM(claim_amount) FILTER (WHERE status = 'Pending'), 0) AS pending_amount,
      COUNT(*) FILTER (WHERE status = 'Approved') AS approved_count,
      COALESCE(SUM(COALESCE(approved_amount, claim_amount)) FILTER (WHERE status = 'Approved'), 0) AS approved_amount,
      COUNT(*) FILTER (WHERE status = 'Reimbursed') AS reimbursed_count,
      COALESCE(SUM(COALESCE(approved_amount, claim_amount)) FILTER (WHERE status = 'Reimbursed'), 0) AS reimbursed_amount,
      COUNT(*) FILTER (WHERE status = 'Rejected') AS rejected_count
    FROM expense_claims
    ${whereClause}
  `, values);

  const row = statsRes.rows[0];
  return {
    totalCount: parseInt(row.total_count, 10),
    totalClaimedAmount: parseFloat(row.total_claimed_amount),
    pendingCount: parseInt(row.pending_count, 10),
    pendingAmount: parseFloat(row.pending_amount),
    approvedCount: parseInt(row.approved_count, 10),
    approvedAmount: parseFloat(row.approved_amount),
    reimbursedCount: parseInt(row.reimbursed_count, 10),
    reimbursedAmount: parseFloat(row.reimbursed_amount),
    rejectedCount: parseInt(row.rejected_count, 10),
  };
};

// 11. Initiate Instant Automated Payout via RazorpayX (General Admin only)
const initiateInstantPayout = async (id, data, adminUser) => {
  const isGeneralAdmin = String(adminUser?.role).toLowerCase() === "general_admin";
  if (!isGeneralAdmin) {
    throw new Error("Only General Admins have permission to initiate automated payouts.");
  }

  const claimRes = await pool.query("SELECT * FROM expense_claims WHERE id = $1", [id]);
  if (claimRes.rows.length === 0) throw new Error("Expense claim not found.");
  const claim = claimRes.rows[0];

  if (claim.status !== "Approved") {
    throw new Error(`Only approved claims can be reimbursed. Current claim status is '${claim.status}'.`);
  }

  // Get Submitter info
  const empRes = await pool.query(
    `SELECT id, name, email FROM users WHERE id::text = $1
     UNION ALL
     SELECT id, name, email FROM admin WHERE id::text = $1 LIMIT 1`,
    [String(claim.employee_id)]
  );
  const employeeInfo = empRes.rows[0] || {
    id: claim.employee_id,
    name: "Employee",
    email: "",
  };

  // Get Submitter Bank Details
  const bankDetails = await payoutService.getEmployeeBankDetails(claim.employee_id);
  if (!bankDetails) {
    throw new Error(
      "The employee has not configured their Bank / UPI payout details yet. Please have the employee save their bank details in Payout Settings before initiating automated transfer."
    );
  }

  const payoutMode = data.payout_mode || (bankDetails.preferred_mode === "upi" ? "UPI" : "IMPS");
  const notes = (data.notes || "").trim();
  const adminId = String(adminUser.userId || adminUser.id);

  // Execute payout via RazorpayX (or Sandbox Simulation if keys not configured)
  const payoutResult = await payoutService.processExpensePayout({
    claim,
    employeeInfo,
    bankDetails,
    payoutMode,
    adminUser,
    customNotes: notes,
  });

  const settlementModeText = `RazorpayX Instant (${payoutResult.mode})`;
  const effectiveRef = payoutResult.utr || payoutResult.id;
  const fullNotes = notes
    ? `${notes} | ${payoutResult.message}`
    : payoutResult.message;

  // Update claim record
  const updateRes = await pool.query(
    `UPDATE expense_claims
     SET status = 'Reimbursed',
         reimbursed_by = $1,
         reimbursed_at = NOW(),
         settlement_mode = $2,
         transaction_ref = $3,
         payout_id = $4,
         payout_status = $5,
         payout_utr = $6,
         payout_mode = $7,
         settlement_notes = $8,
         updated_at = NOW()
     WHERE id = $9
     RETURNING *`,
    [
      adminId,
      settlementModeText,
      effectiveRef,
      payoutResult.id,
      payoutResult.status,
      payoutResult.utr,
      payoutResult.mode,
      fullNotes,
      id,
    ]
  );

  const updatedClaim = updateRes.rows[0];

  // Notify submitter
  try {
    const isEmp = !["admin", "general_admin"].includes(String(updatedClaim.employee_role).toLowerCase());
    const notifyFn = isEmp ? createEmployeeNotification : createAdminNotification;
    await notifyFn(
      updatedClaim.employee_id,
      "Instant Reimbursement Sent 💸",
      `₹${(updatedClaim.approved_amount || updatedClaim.claim_amount).toLocaleString()} for ${updatedClaim.claim_code} was transferred via ${settlementModeText}. Reference / UTR: ${effectiveRef}`,
      "expense_claim"
    );
  } catch (e) {
    console.warn("Notification error:", e.message);
  }

  // Log Activity
  try {
    await createActivityLog(adminId, "Initiated Instant Expense Payout", updatedClaim.employee_id, {
      claim_id: id,
      claim_code: updatedClaim.claim_code,
      amount: updatedClaim.approved_amount || updatedClaim.claim_amount,
      payout_id: payoutResult.id,
      utr: payoutResult.utr,
      mode: payoutResult.mode,
      is_simulated: payoutResult.isSimulated,
    });
  } catch (e) {}

  return {
    claim: updatedClaim,
    payout: payoutResult,
  };
};

// 12. Employee Bank Details
const getMyBankDetails = async (user) => {
  const userId = String(user.userId || user.id);
  const details = await payoutService.getEmployeeBankDetails(userId);
  return (
    details || {
      user_id: userId,
      account_holder_name: "",
      account_number: "",
      ifsc_code: "",
      bank_name: "",
      upi_id: "",
      preferred_mode: "bank_account",
      is_configured: false,
    }
  );
};

const saveMyBankDetails = async (user, data) => {
  const isGeneralAdmin = String(user.role).toLowerCase() === "general_admin";
  const userId = (isGeneralAdmin && data.employee_id)
    ? String(data.employee_id)
    : String(user.userId || user.id);
  return await payoutService.saveEmployeeBankDetails(userId, data);
};

const getEmployeeBankDetailsById = async (employeeId, currentUser) => {
  const isGeneralAdmin = String(currentUser.role).toLowerCase() === "general_admin";
  const myId = String(currentUser.userId || currentUser.id);
  if (!isGeneralAdmin && myId !== String(employeeId)) {
    throw new Error("You do not have permission to view this bank detail.");
  }
  return await payoutService.getEmployeeBankDetails(employeeId);
};

module.exports = {
  getCategories,
  updateCategoryLimits,
  createClaim,
  getClaims,
  getClaimById,
  approveClaim,
  rejectClaim,
  settleClaim,
  deleteClaim,
  getExpenseStats,
  initiateInstantPayout,
  getMyBankDetails,
  saveMyBankDetails,
  getEmployeeBankDetailsById,
};
