const pool = require("../config/databse");

async function init() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Create common_master table
    await client.query(`
      CREATE TABLE IF NOT EXISTS common_master (
        id SERIAL PRIMARY KEY,
        type VARCHAR(100) NOT NULL,
        name VARCHAR(255) NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Create unique index on lower(type), lower(name)
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_common_master_type_name_lower 
      ON common_master (LOWER(type), LOWER(name));
    `);

    // 3. Seed initial values
    const seedValues = [
      ["task_type", "basic"],
      ["task_type", "normal"],
      ["task_type", "hard"],
      ["task_frequency", "daily"],
      ["task_frequency", "one-time"],
    ];

    for (const [type, name] of seedValues) {
      await client.query(
        `
        INSERT INTO common_master (type, name, is_active)
        VALUES ($1, $2, true)
        ON CONFLICT (LOWER(type), LOWER(name)) DO NOTHING;
      `,
        [type, name],
      );
    }

    // 4. Check if common_master identifier exists in identifiers table
    const idCheck = await client.query(`
      SELECT id FROM identifiers WHERE identifier = 'common_master'
    `);

    let commonMasterId;
    if (idCheck.rows.length === 0) {
      // Find parent 'admins' (id: 3)
      const parentResult = await client.query(`
        SELECT id FROM identifiers WHERE identifier = 'admins' AND row_level = 0 LIMIT 1
      `);
      const parentId =
        parentResult.rows.length > 0 ? parentResult.rows[0].id : 3;

      const insertIdent = await client.query(
        `
        INSERT INTO identifiers (name, identifier, row_level, parent_id, is_active, is_deleted)
        VALUES ('Common Master', 'common_master', 1, $1, true, false)
        RETURNING id;
      `,
        [parentId],
      );
      commonMasterId = insertIdent.rows[0].id;
      console.log("Inserted common_master identifier with ID:", commonMasterId);
    } else {
      commonMasterId = idCheck.rows[0].id;
      console.log(
        "common_master identifier already exists with ID:",
        commonMasterId,
      );
    }

    // 5. Ensure roles (General Admin, Admin) have access to common_master in role_identifier_access
    const rolesResult = await client.query(`
      SELECT id FROM roles WHERE LOWER(name) IN ('admin', 'general admin', 'manager')
    `);

    for (const roleRow of rolesResult.rows) {
      await client.query(
        `
        INSERT INTO role_identifier_access (role_id, identifier_id)
        SELECT $1, $2
        WHERE NOT EXISTS (
          SELECT 1 FROM role_identifier_access WHERE role_id = $1 AND identifier_id = $2
        );
      `,
        [roleRow.id, commonMasterId],
      );
    }

    await client.query("COMMIT");
    console.log(
      "SUCCESS: common_master table initialized and seeded successfully.",
    );

    const res = await client.query("SELECT * FROM common_master ORDER BY id");
    console.log("CURRENT COMMON_MASTER ROWS:", res.rows);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("FAILED to initialize common_master:", err);
  } finally {
    client.release();
    pool.end();
  }
}

init();
