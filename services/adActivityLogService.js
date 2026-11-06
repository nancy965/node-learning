const pool = require("../config/databse");

const createAdActivityLog = async ({
  performedBy,
  action,
  entityType,
  entityId,
  details,
}) => {
  let adminId = performedBy;
  try {
    const adminCheck = await pool.query("SELECT id FROM admin WHERE id = $1", [adminId]);
    if (adminCheck.rows.length === 0) {
      const adminByRegister = await pool.query("SELECT id FROM admin WHERE register_id = $1", [performedBy]);
      if (adminByRegister.rows.length > 0) {
        adminId = adminByRegister.rows[0].id;
      } else {
        const firstAdmin = await pool.query("SELECT id FROM admin ORDER BY id LIMIT 1");
        adminId = firstAdmin.rows.length > 0 ? firstAdmin.rows[0].id : null;
      }
    }
  } catch (err) {
    console.error("ADMIN RESOLUTION ERROR:", err);
  }

  await pool.query(
    `
      INSERT INTO ad_activity_logs
      (
        performed_by,
        action,
        entity_type,
        entity_id,
        details
      )
      VALUES ($1, $2, $3, $4, $5)
    `,
    [
      adminId,
      action,
      entityType,
      entityId || null,
      details || {},
    ]
  );
};

module.exports = {
  createAdActivityLog,
};