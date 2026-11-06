const pool = require("../config/databse");

async function initTaskDependencies() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("=== Initializing Task Dependencies & Critical Path Schema ===");

    await client.query(`
      CREATE TABLE IF NOT EXISTS task_dependencies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        depends_on_task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT unique_task_dependency UNIQUE (task_id, depends_on_task_id),
        CONSTRAINT check_not_self_dependent CHECK (task_id != depends_on_task_id)
      );
    `);

    // Ensure id column is UUID if table was created previously with integer
    const typeRes = await client.query(`
      SELECT data_type 
      FROM information_schema.columns 
      WHERE table_name = 'task_dependencies' AND column_name = 'id'
    `);
    if (typeRes.rows.length > 0 && typeRes.rows[0].data_type.toLowerCase() !== "uuid") {
      await client.query(`
        ALTER TABLE task_dependencies ADD COLUMN IF NOT EXISTS id_uuid UUID DEFAULT gen_random_uuid();
        UPDATE task_dependencies SET id_uuid = gen_random_uuid() WHERE id_uuid IS NULL;
        ALTER TABLE task_dependencies ALTER COLUMN id_uuid SET NOT NULL;
        ALTER TABLE task_dependencies DROP CONSTRAINT IF EXISTS task_dependencies_pkey;
        ALTER TABLE task_dependencies DROP COLUMN IF EXISTS id;
        ALTER TABLE task_dependencies RENAME COLUMN id_uuid TO id;
        ALTER TABLE task_dependencies ADD PRIMARY KEY (id);
        ALTER TABLE task_dependencies ALTER COLUMN id SET DEFAULT gen_random_uuid();
      `);
    }

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_task_dep_task_id ON task_dependencies(task_id);
      CREATE INDEX IF NOT EXISTS idx_task_dep_depends_on ON task_dependencies(depends_on_task_id);
    `);

    await client.query("COMMIT");
    console.log("=== Task Dependencies Schema Initialized Successfully ===");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error initializing task dependencies schema:", error.message);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  initTaskDependencies()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = initTaskDependencies;
