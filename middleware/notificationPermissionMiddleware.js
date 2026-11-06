const pool = require("../config/databse");

const requireNotificationPermission = (operation) => {
  return async (req, res, next) => {
    try {
      const role = req.user.baseRole || req.user.role;
      const userId = req.user.userId;

      if (!["general_admin", "admin"].includes(role)) {
        return res.status(403).json({
          success: false,
          message: "You are not allowed to manage notifications",
        });
      }

      let roleId = req.user.roleId;

      if (!roleId) {
        const result = await pool.query(
          `SELECT role_id
           FROM admin
           WHERE id = $1
           LIMIT 1`,
          [userId],
        );

        roleId = result.rows[0]?.role_id;
      }

      if (!roleId) {
        return res.status(403).json({
          success: false,
          message: "Role permissions could not be determined",
        });
      }

      const result = await pool.query(
        `SELECT ria.operations
         FROM role_identifier_access ria
         INNER JOIN identifiers i ON i.id = ria.identifier_id
         WHERE ria.role_id = $1
           AND i.identifier = 'notifications'
           AND i.is_active = true
           AND i.is_deleted = false
         LIMIT 1`,
        [roleId],
      );

      const operations = result.rows[0]?.operations || [];

      if (!Array.isArray(operations) || !operations.includes(operation)) {
        return res.status(403).json({
          success: false,
          message: `Missing notifications.${operation} permission`,
        });
      }

      return next();
    } catch (error) {
      console.error("Notification permission error:", error.message);

      return res.status(500).json({
        success: false,
        message: "Failed to verify notification permissions",
      });
    }
  };
};

module.exports = requireNotificationPermission;
