const pool = require("../config/databse");

async function initLifecycleManagement() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("=== Initializing Employee Lifecycle Management Schema ===");

    // 1. Add lifecycle_status to users and admin tables if not present
    await client.query(`
      ALTER TABLE users ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(50) DEFAULT 'Active';
      ALTER TABLE admin ADD COLUMN IF NOT EXISTS lifecycle_status VARCHAR(50) DEFAULT 'Active';
    `);

    // 2. Templates Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lifecycle_templates (
        id SERIAL PRIMARY KEY,
        title VARCHAR(150) NOT NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('onboarding', 'offboarding')),
        department VARCHAR(100) DEFAULT 'General',
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 3. Template Items Blueprint Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lifecycle_template_items (
        id SERIAL PRIMARY KEY,
        template_id INT NOT NULL REFERENCES lifecycle_templates(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        assignee_role VARCHAR(50) DEFAULT 'admin',
        due_days_offset INT DEFAULT 2,
        is_required BOOLEAN DEFAULT true,
        order_index INT DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lifecycle_tpl_items_template ON lifecycle_template_items(template_id);
    `);

    // 4. Employee Lifecycle Records Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS employee_lifecycle_records (
        id SERIAL PRIMARY KEY,
        record_code VARCHAR(30) UNIQUE NOT NULL,
        employee_id INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        template_id INT REFERENCES lifecycle_templates(id) ON DELETE SET NULL,
        type VARCHAR(50) NOT NULL CHECK (type IN ('onboarding', 'offboarding')),
        target_date DATE NOT NULL,
        status VARCHAR(50) DEFAULT 'In Progress' CHECK (status IN ('In Progress', 'Completed', 'Cancelled')),
        progress_pct INT DEFAULT 0,
        notes TEXT,
        initiated_by INT NOT NULL,
        initiated_by_name VARCHAR(150),
        completed_at TIMESTAMPTZ NULL,
        completed_by INT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lifecycle_rec_employee ON employee_lifecycle_records(employee_id);
      CREATE INDEX IF NOT EXISTS idx_lifecycle_rec_status ON employee_lifecycle_records(status);
      CREATE INDEX IF NOT EXISTS idx_lifecycle_rec_type ON employee_lifecycle_records(type);
    `);

    // 5. Checklist Items Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lifecycle_checklist_items (
        id SERIAL PRIMARY KEY,
        record_id INT NOT NULL REFERENCES employee_lifecycle_records(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        assigned_to INT NULL,
        assigned_to_name VARCHAR(150),
        due_date DATE,
        is_completed BOOLEAN DEFAULT false,
        completed_at TIMESTAMPTZ NULL,
        completed_by INT NULL,
        completed_by_name VARCHAR(150),
        completion_notes TEXT,
        linked_task_id INT NULL REFERENCES tasks(id) ON DELETE SET NULL,
        order_index INT DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_lifecycle_chk_record ON lifecycle_checklist_items(record_id);
      CREATE INDEX IF NOT EXISTS idx_lifecycle_chk_status ON lifecycle_checklist_items(is_completed);
    `);

    // 6. Seed Default Templates if empty
    const tplCheck = await client.query("SELECT COUNT(*) FROM lifecycle_templates;");
    if (parseInt(tplCheck.rows[0].count, 10) === 0) {
      console.log("Seeding default lifecycle templates...");

      // Template 1: Software Engineer Onboarding
      const t1 = await client.query(`
        INSERT INTO lifecycle_templates (title, type, department, description)
        VALUES ('Software Engineer Onboarding', 'onboarding', 'Engineering', 'Comprehensive IT, tooling, and team onboarding for software engineers.')
        RETURNING id;
      `);
      const t1Id = t1.rows[0].id;

      await client.query(`
        INSERT INTO lifecycle_template_items (template_id, title, category, assignee_role, due_days_offset, is_required, order_index)
        VALUES
          (${t1Id}, 'Provision Laptop, Charger & Configure VPN Access', 'IT', 'admin', 1, true, 1),
          (${t1Id}, 'Grant GitHub Organization & Cloud Sandbox Access', 'IT', 'admin', 2, true, 2),
          (${t1Id}, 'Verify Government ID, Tax Forms & Bank Account Details', 'HR', 'admin', 3, true, 3),
          (${t1Id}, 'Assign Onboarding Buddy & Schedule 1-on-1 Intro', 'Manager', 'manager', 1, true, 4),
          (${t1Id}, 'Complete POSH & Corporate Security Compliance Training', 'Security', 'employee', 5, true, 5);
      `);

      // Template 2: General Corporate Onboarding
      const t2 = await client.query(`
        INSERT INTO lifecycle_templates (title, type, department, description)
        VALUES ('General Staff Onboarding', 'onboarding', 'General', 'Standard corporate onboarding for all departments.')
        RETURNING id;
      `);
      const t2Id = t2.rows[0].id;

      await client.query(`
        INSERT INTO lifecycle_template_items (template_id, title, category, assignee_role, due_days_offset, is_required, order_index)
        VALUES
          (${t2Id}, 'Setup Corporate Google Workspace & Slack Account', 'IT', 'admin', 1, true, 1),
          (${t2Id}, 'Collect Signed Employment Contract & Emergency Contacts', 'HR', 'admin', 2, true, 2),
          (${t2Id}, 'Conduct HR Orientation & Employee Handbook Briefing', 'HR', 'admin', 3, true, 3),
          (${t2Id}, 'Enroll in Health Insurance & Corporate Benefits Portal', 'HR', 'admin', 5, false, 4);
      `);

      // Template 3: Graceful Employee Offboarding (Exit)
      const t3 = await client.query(`
        INSERT INTO lifecycle_templates (title, type, department, description)
        VALUES ('Standard Employee Offboarding', 'offboarding', 'General', 'Secure offboarding, asset recovery, and knowledge transfer handover.')
        RETURNING id;
      `);
      const t3Id = t3.rows[0].id;

      await client.query(`
        INSERT INTO lifecycle_template_items (template_id, title, category, assignee_role, due_days_offset, is_required, order_index)
        VALUES
          (${t3Id}, 'Collect Company Laptop, Charger & Office Access Badge', 'IT', 'admin', 0, true, 1),
          (${t3Id}, 'Revoke Corporate Email, Slack, GitHub & Cloud Logins', 'IT', 'admin', 0, true, 2),
          (${t3Id}, 'Complete Project Handover & Knowledge Transfer Sign-off', 'Manager', 'manager', 0, true, 3),
          (${t3Id}, 'Conduct Exit Interview & Collect Experience Feedback', 'HR', 'admin', 0, true, 4),
          (${t3Id}, 'Finance Clearance & Full and Final Settlement (FNF)', 'Finance', 'admin', 3, true, 5);
      `);
    }

    // 7. Register Identifiers for Navigation
    let rootLifecycleId;
    const rootCheck = await client.query(
      "SELECT id FROM identifiers WHERE identifier = 'employee_lifecycle' LIMIT 1;"
    );

    if (rootCheck.rows.length === 0) {
      const insertRoot = await client.query(`
        INSERT INTO identifiers (name, identifier, row_level, parent_id, is_active, is_deleted)
        VALUES ('Lifecycle Management', 'employee_lifecycle', 0, NULL, true, false)
        RETURNING id;
      `);
      rootLifecycleId = insertRoot.rows[0].id;
      console.log("Created root identifier 'employee_lifecycle' with ID:", rootLifecycleId);
    } else {
      rootLifecycleId = rootCheck.rows[0].id;
    }

    const submenus = [
      { name: "Active Workflows", identifier: "lifecycle_overview" },
      { name: "Templates & Plans", identifier: "lifecycle_templates" },
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
        `, [sub.name, sub.identifier, rootLifecycleId]);
        submenuMap[sub.identifier] = insertSub.rows[0].id;
      } else {
        submenuMap[sub.identifier] = subCheck.rows[0].id;
      }
    }

    // Grant access in role_identifier_access to Admins and Managers
    const allRoles = await client.query("SELECT id, LOWER(name) as name FROM roles;");
    for (const roleRow of allRoles.rows) {
      const roleName = roleRow.name;
      const roleId = roleRow.id;

      if (
        roleName.includes("admin") ||
        roleName.includes("general") ||
        roleName.includes("super") ||
        roleName.includes("manager") ||
        roleName.includes("hr")
      ) {
        const identifiersToGrant = [
          rootLifecycleId,
          submenuMap["lifecycle_overview"],
          submenuMap["lifecycle_templates"],
        ];

        for (const identId of identifiersToGrant) {
          if (identId) {
            await client.query(`
              INSERT INTO role_identifier_access (role_id, identifier_id)
              VALUES ($1, $2)
              ON CONFLICT DO NOTHING;
            `, [roleId, identId]);
          }
        }
      }
    }

    await client.query("COMMIT");
    console.log("=== Employee Lifecycle Management Schema Initialized Successfully ===");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error initializing Lifecycle Management schema:", error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  initLifecycleManagement()
    .then(() => {
      console.log("Initialization complete!");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Init failed:", err);
      process.exit(1);
    });
}

module.exports = initLifecycleManagement;
