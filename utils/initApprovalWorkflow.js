const pool = require("../config/databse");

async function initApprovalWorkflow() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("=== Initializing Configurable Approval Workflow Database Schema ===");

    // 1. Create approval_requests table
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_requests (
        id SERIAL PRIMARY KEY,
        request_code VARCHAR(30) UNIQUE NOT NULL,
        request_type UUID NOT NULL REFERENCES common_master(id) ON DELETE RESTRICT,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        amount NUMERIC(12, 2) DEFAULT NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        current_step INT DEFAULT 1,
        total_steps INT DEFAULT 1,
        requested_by INT NOT NULL,
        requested_by_role VARCHAR(50) DEFAULT 'employee',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ NULL
      );
    `);

    // Indexes for approval_requests
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_requests_requested_by ON approval_requests(requested_by);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_status ON approval_requests(status);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_type ON approval_requests(request_type);
      CREATE INDEX IF NOT EXISTS idx_approval_requests_created_at ON approval_requests(created_at DESC);
    `);

    // 2. Create approval_steps table
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_steps (
        id SERIAL PRIMARY KEY,
        request_id INT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
        step_number INT NOT NULL,
        step_name VARCHAR(100) NOT NULL,
        approver_role VARCHAR(50) NOT NULL,
        assigned_approver_id INT NULL,
        status VARCHAR(50) DEFAULT 'Pending',
        decision_comment TEXT NULL,
        action_by INT NULL,
        action_by_role VARCHAR(50) NULL,
        decided_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_steps_request_id ON approval_steps(request_id);
      CREATE INDEX IF NOT EXISTS idx_approval_steps_status ON approval_steps(status);
      CREATE INDEX IF NOT EXISTS idx_approval_steps_role ON approval_steps(approver_role);
    `);

    // 3. Create approval_rules table (for configurable multi-step workflows)
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_rules (
        id SERIAL PRIMARY KEY,
        request_type UUID UNIQUE NOT NULL REFERENCES common_master(id) ON DELETE RESTRICT,
        description TEXT,
        steps JSONB NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 4. Create approval_attachments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS approval_attachments (
        id SERIAL PRIMARY KEY,
        request_id INT NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
        step_id INT NULL REFERENCES approval_steps(id) ON DELETE SET NULL,
        file_name VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_type VARCHAR(100),
        file_size BIGINT,
        source VARCHAR(50) DEFAULT 'request',
        uploaded_by INT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_approval_attachments_request_id ON approval_attachments(request_id);
    `);

    // 5. Seed Common Master types for request types
    const commonMasterTableCheck = await client.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'common_master';
    `);

    if (commonMasterTableCheck.rows.length > 0) {
      const requestTypeSeed = [
        ["approval_request_type", "Laptop / Hardware Purchase"],
        ["approval_request_type", "Expense Reimbursement"],
        ["approval_request_type", "Work From Home"],
        ["approval_request_type", "Software / Tool Access"],
        ["approval_request_type", "General Request"]
      ];

      for (const [type, name] of requestTypeSeed) {
        await client.query(`
          INSERT INTO common_master (type, name, is_active)
          VALUES ($1, $2, true)
          ON CONFLICT (LOWER(type), LOWER(name)) DO NOTHING;
        `, [type, name]);
      }
    }

    // 6. Seed default approval rules if table is empty
    const rulesCheck = await client.query("SELECT COUNT(*) FROM approval_rules;");
    if (parseInt(rulesCheck.rows[0].count, 10) === 0) {
      const defaultRules = [
        {
          typeName: "Laptop / Hardware Purchase",
          desc: "Requires Direct Admin review first, then final General Admin budget sign-off",
          steps: JSON.stringify([
            { step_number: 1, step_name: "Direct Admin Review", approver_role: "admin" },
            { step_number: 2, step_name: "General Admin Sign-off", approver_role: "general_admin" }
          ])
        },
        {
          typeName: "Expense Reimbursement",
          desc: "Requires Direct Admin receipt check, then General Admin disbursement",
          steps: JSON.stringify([
            { step_number: 1, step_name: "Direct Admin Receipt Verification", approver_role: "admin" },
            { step_number: 2, step_name: "General Admin Financial Approval", approver_role: "general_admin" }
          ])
        },
        {
          typeName: "Work From Home",
          desc: "Requires Direct Admin schedule approval",
          steps: JSON.stringify([
            { step_number: 1, step_name: "Direct Admin Approval", approver_role: "admin" }
          ])
        },
        {
          typeName: "Software / Tool Access",
          desc: "Requires Admin technical validation",
          steps: JSON.stringify([
            { step_number: 1, step_name: "Admin Review", approver_role: "admin" }
          ])
        },
        {
          typeName: "General Request",
          desc: "Standard 1-step request review",
          steps: JSON.stringify([
            { step_number: 1, step_name: "Admin Approval", approver_role: "admin" }
          ])
        }
      ];

      for (const rule of defaultRules) {
        const cmRes = await client.query(
          "SELECT id FROM common_master WHERE LOWER(type) = 'approval_request_type' AND LOWER(name) = LOWER($1) LIMIT 1",
          [rule.typeName]
        );
        if (cmRes.rows.length > 0) {
          await client.query(
            `INSERT INTO approval_rules (request_type, description, steps, is_active, created_at, updated_at)
             VALUES ($1, $2, $3, true, NOW(), NOW())
             ON CONFLICT (request_type) DO NOTHING;`,
            [cmRes.rows[0].id, rule.desc, rule.steps]
          );
        }
      }
      console.log("Seeded default approval rules successfully.");
    }

    // 7. Register Identifiers for Navigation
    let rootApprovalMenuId;
    const rootCheck = await client.query(`
      SELECT id FROM identifiers WHERE identifier = 'approval_workflow' LIMIT 1;
    `);

    if (rootCheck.rows.length === 0) {
      const insertRoot = await client.query(`
        INSERT INTO identifiers (name, identifier, row_level, parent_id, is_active, is_deleted)
        VALUES ('Approval Workflow', 'approval_workflow', 0, NULL, true, false)
        RETURNING id;
      `);
      rootApprovalMenuId = insertRoot.rows[0].id;
      console.log("Created root identifier 'approval_workflow' with ID:", rootApprovalMenuId);
    } else {
      rootApprovalMenuId = rootCheck.rows[0].id;
      console.log("Root identifier 'approval_workflow' exists with ID:", rootApprovalMenuId);
    }

    // Submenus: 'my_requests' and 'approval_inbox'
    const submenus = [
      { name: "My Requests", identifier: "my_requests" },
      { name: "Approval Inbox", identifier: "approval_inbox" }
    ];

    const submenuMap = {};
    for (const sub of submenus) {
      const subCheck = await client.query(
        "SELECT id FROM identifiers WHERE identifier = $1 LIMIT 1;",
        [sub.identifier]
      );

      if (subCheck.rows.length === 0) {
        const insertSub = await client.query(`
          INSERT INTO identifiers (name, identifier, row_level, parent_id, is_active, is_deleted)
          VALUES ($1, $2, 1, $3, true, false)
          RETURNING id;
        `, [sub.name, sub.identifier, rootApprovalMenuId]);
        submenuMap[sub.identifier] = insertSub.rows[0].id;
        console.log(`Created submenu '${sub.identifier}' with ID:`, insertSub.rows[0].id);
      } else {
        submenuMap[sub.identifier] = subCheck.rows[0].id;
        console.log(`Submenu '${sub.identifier}' exists with ID:`, subCheck.rows[0].id);
      }
    }

    // Grant access in role_identifier_access
    const allRoles = await client.query("SELECT id, LOWER(name) as name FROM roles;");
    for (const roleRow of allRoles.rows) {
      const roleName = roleRow.name;
      const roleId = roleRow.id;

      // Everyone (employee, admin, general_admin) gets root and 'my_requests'
      const grantedIdentifiers = [rootApprovalMenuId, submenuMap["my_requests"]];

      // Admin, General Admin, Super Admin, Manager also get 'approval_inbox'
      if (
        roleName.includes("admin") ||
        roleName.includes("general") ||
        roleName.includes("super") ||
        roleName.includes("manager")
      ) {
        grantedIdentifiers.push(submenuMap["approval_inbox"]);
      }

      for (const identId of grantedIdentifiers) {
        if (identId) {
          await client.query(`
            INSERT INTO role_identifier_access (role_id, identifier_id)
            SELECT $1, $2
            WHERE NOT EXISTS (
              SELECT 1 FROM role_identifier_access WHERE role_id = $1 AND identifier_id = $2
            );
          `, [roleId, identId]);
        }
      }
    }

    await client.query("COMMIT");
    console.log("=== Approval Workflow Database Initialized Successfully! ===");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error initializing approval workflow database:", error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  initApprovalWorkflow()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = initApprovalWorkflow;
