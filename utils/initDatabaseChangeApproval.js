const pool = require("../config/databse");

async function initDatabaseChangeApproval() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("=== Initializing Database Change Approval (Bytebase Workflow) Schema ===");

    await client.query(`
      CREATE TABLE IF NOT EXISTS database_change_approvals (
        id SERIAL PRIMARY KEY,
        request_code VARCHAR(50) UNIQUE NOT NULL,
        module_name VARCHAR(50) NOT NULL DEFAULT 'USER_MANAGEMENT',
        table_name VARCHAR(50) NOT NULL DEFAULT 'users',
        record_id VARCHAR(100) NOT NULL,
        record_identifier VARCHAR(255) NOT NULL,
        change_type VARCHAR(50) NOT NULL DEFAULT 'UPDATE',
        change_summary TEXT NOT NULL,
        old_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        new_data JSONB NOT NULL DEFAULT '{}'::jsonb,
        diff_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
        status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
        rejection_reason TEXT,
        rollback_reason TEXT,
        requested_by VARCHAR(100) NOT NULL,
        requested_by_name VARCHAR(255) NOT NULL,
        requested_by_role VARCHAR(50) DEFAULT 'admin',
        reviewer_id VARCHAR(100),
        reviewer_name VARCHAR(255),
        reviewed_at TIMESTAMPTZ,
        is_reverted BOOLEAN DEFAULT FALSE,
        reverted_by VARCHAR(100),
        reverted_by_name VARCHAR(255),
        reverted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_db_changes_status ON database_change_approvals(status);
      CREATE INDEX IF NOT EXISTS idx_db_changes_table_record ON database_change_approvals(table_name, record_id);
      CREATE INDEX IF NOT EXISTS idx_db_changes_created_at ON database_change_approvals(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_db_changes_module ON database_change_approvals(module_name);
    `);

    await client.query("COMMIT");
    console.log("=== Database Change Approval Schema Initialized Successfully ===");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error initializing database change approval schema:", error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  initDatabaseChangeApproval()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = initDatabaseChangeApproval;
