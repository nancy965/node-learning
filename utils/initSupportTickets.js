const pool = require("../config/databse");

async function init() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create support_tickets table
    await client.query(`
      CREATE TABLE IF NOT EXISTS support_tickets (
        id SERIAL PRIMARY KEY,
        ticket_code VARCHAR(30) UNIQUE NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        category VARCHAR(100) NOT NULL,
        priority VARCHAR(20) DEFAULT 'Medium',
        status VARCHAR(30) DEFAULT 'Open',
        created_by INTEGER NOT NULL,
        created_by_role VARCHAR(50) DEFAULT 'employee',
        assigned_to INTEGER NULL,
        resolution_note TEXT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Indexes for fast filtering and searching
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_support_tickets_created_by ON support_tickets (created_by);
      CREATE INDEX IF NOT EXISTS idx_support_tickets_assigned_to ON support_tickets (assigned_to);
      CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets (status);
      CREATE INDEX IF NOT EXISTS idx_support_tickets_priority ON support_tickets (priority);
      CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets (created_at DESC);
    `);

    // 2.1 Create ticket_attachments table
    await client.query(`
      CREATE TABLE IF NOT EXISTS ticket_attachments (
        id SERIAL PRIMARY KEY,
        ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_type VARCHAR(100) NOT NULL,
        file_size BIGINT NOT NULL,
        source VARCHAR(30) DEFAULT 'creation',
        uploaded_by INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_ticket_attachments_ticket_id ON ticket_attachments(ticket_id);
    `);

    // 3. Seed initial categories and priorities in common_master if common_master exists
    const commonMasterTableCheck = await client.query(`
      SELECT table_name FROM information_schema.tables WHERE table_name = 'common_master';
    `);

    if (commonMasterTableCheck.rows.length > 0) {
      const seedValues = [
        ['ticket_category', 'Technical Issue'],
        ['ticket_category', 'Account Access'],
        ['ticket_category', 'Data Problem'],
        ['ticket_category', 'Billing'],
        ['ticket_category', 'Software Request'],
        ['ticket_category', 'Other'],
        ['ticket_priority', 'Low'],
        ['ticket_priority', 'Medium'],
        ['ticket_priority', 'High'],
        ['ticket_priority', 'Urgent']
      ];

      for (const [type, name] of seedValues) {
        await client.query(`
          INSERT INTO common_master (type, name, is_active)
          VALUES ($1, $2, true)
          ON CONFLICT (LOWER(type), LOWER(name)) DO NOTHING;
        `, [type, name]);
      }
    }

    // 4. Register Root Menu: 'support_tickets' (Level 0) in identifiers
    let rootTicketMenuId;
    const rootCheck = await client.query(`
      SELECT id FROM identifiers WHERE identifier = 'support_tickets' LIMIT 1;
    `);

    if (rootCheck.rows.length === 0) {
      const insertRoot = await client.query(`
        INSERT INTO identifiers (name, identifier, row_level, parent_id, is_active, is_deleted)
        VALUES ('Support Tickets', 'support_tickets', 0, NULL, true, false)
        RETURNING id;
      `);
      rootTicketMenuId = insertRoot.rows[0].id;
      console.log("Created root identifier 'support_tickets' with ID:", rootTicketMenuId);
    } else {
      rootTicketMenuId = rootCheck.rows[0].id;
      console.log("Root identifier 'support_tickets' already exists with ID:", rootTicketMenuId);
    }

    // 5. Register Submenus: 'my_tickets' and 'manage_tickets' (Level 1)
    const submenus = [
      { name: 'My Tickets', identifier: 'my_tickets' },
      { name: 'Manage Tickets', identifier: 'manage_tickets' }
    ];

    const submenuMap = {};

    for (const sub of submenus) {
      const subCheck = await client.query(`
        SELECT id FROM identifiers WHERE identifier = $1 LIMIT 1;
      `, [sub.identifier]);

      if (subCheck.rows.length === 0) {
        const insertSub = await client.query(`
          INSERT INTO identifiers (name, identifier, row_level, parent_id, is_active, is_deleted)
          VALUES ($1, $2, 1, $3, true, false)
          RETURNING id;
        `, [sub.name, sub.identifier, rootTicketMenuId]);
        submenuMap[sub.identifier] = insertSub.rows[0].id;
        console.log(`Created submenu '${sub.identifier}' with ID:`, insertSub.rows[0].id);
      } else {
        submenuMap[sub.identifier] = subCheck.rows[0].id;
        console.log(`Submenu '${sub.identifier}' already exists with ID:`, subCheck.rows[0].id);
      }
    }

    // 6. Grant Role Access in role_identifier_access
    // General Admin & Admin get Root + My Tickets + Manage Tickets
    // Employee gets Root + My Tickets
    const allRoles = await client.query(`SELECT id, LOWER(name) as name FROM roles;`);

    for (const roleRow of allRoles.rows) {
      const roleName = roleRow.name;
      const roleId = roleRow.id;

      // Everyone gets root 'support_tickets' and 'my_tickets'
      const grantedIdentifiers = [rootTicketMenuId, submenuMap['my_tickets']];

      // Admin / General Admin / Manager also get 'manage_tickets'
      if (roleName.includes('admin') || roleName.includes('manager')) {
        grantedIdentifiers.push(submenuMap['manage_tickets']);
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
    console.log("SUCCESS: support_tickets table and navigation permissions initialized successfully!");

  } catch (error) {
    await client.query("ROLLBACK");
    console.error("FAILED to initialize support_tickets:", error);
  } finally {
    client.release();
    pool.end();
  }
}

init();
