const pool = require("../config/databse");
const authService = require("../services/authService");
const { getRevokedForSession } = require("../utils/sessionRevocation");

const checkPermission = (requiredPermission) => {
    return async (req, res, next) => {
        try {
            if (!req.user || !req.user.userId) {
                return res.status(403).json({
                    message: "Access denied"
                });
            }

            // Only general_admin has unconditional full access.
            if (
                req.user.role === "general_admin" ||
                req.user.baseRole === "general_admin" ||
                req.user.role === "super_admin"
            ) {
                return next();
            }

            const adminCheck = await pool.query(
                "SELECT a.role, r.name as role_name FROM admin a LEFT JOIN roles r ON r.id = a.role_id WHERE a.id = $1 LIMIT 1",
                [req.user.userId]
            );
            if (adminCheck.rows.length > 0) {
                const aRole = String(adminCheck.rows[0].role || "").toLowerCase();
                const aRoleName = String(adminCheck.rows[0].role_name || "").toLowerCase();
                if (aRole === "general_admin" || aRoleName === "general admin") {
                    return next();
                }
            }

            // admin with no assigned permission role gets full access.
            if (req.user.role === "admin" && !req.user.roleId) {
                return next();
            }

            // Permissions granted at the time of login
            let loginPermissions = req.user.permissions || [];
            let effectivePermissions = loginPermissions;

            let effectiveRoleId = req.user.roleId;

            // Fetch live role_id from database
            const userRow = await pool.query(
                `SELECT role_id FROM users WHERE id = $1
                 UNION ALL
                 SELECT role_id FROM admin WHERE id = $1
                 LIMIT 1`,
                [req.user.userId]
            );
            if (userRow.rows.length > 0 && userRow.rows[0].role_id) {
                effectiveRoleId = userRow.rows[0].role_id;
            }

            if (!effectiveRoleId && req.user.role === "employee") {
                const defaultRoleResult = await pool.query(`SELECT id FROM roles WHERE name = 'Employee' LIMIT 1`);
                if (defaultRoleResult.rows.length > 0) {
                    effectiveRoleId = defaultRoleResult.rows[0].id;
                }
            }

            const isRoleChanged = req.user.roleId && effectiveRoleId && String(req.user.roleId) !== String(effectiveRoleId);

            if (effectiveRoleId && req.user.userId) {
                try {
                    const accessData = await authService.getLoginPermissionsData(req.user.role, effectiveRoleId);
                    const flatPermissions = [];
                    accessData.forEach(menu => {
                        if (Array.isArray(menu.permissions)) {
                            flatPermissions.push(...menu.permissions);
                        }
                        if (Array.isArray(menu.submenus)) {
                            menu.submenus.forEach(sub => {
                                if (Array.isArray(sub.permissions)) {
                                    flatPermissions.push(...sub.permissions);
                                }
                            });
                        }
                    });

                    const dbPerms = new Set(flatPermissions);

                    // Intersection:
                    // 1. Newly added permissions to a role CANNOT be accessed until user logs out and logs back in (loginPermissions is the session ceiling).
                    // 2. Removed permissions are immediately revoked in real-time (dropped as soon as removed from DB).
                    effectivePermissions = loginPermissions.filter((p) => dbPerms.has(p));
                } catch (err) {
                    console.error("Error fetching real-time permissions in middleware:", err);
                }
            }

            const permissionsToCheck = Array.isArray(requiredPermission)
                ? requiredPermission
                : [requiredPermission];

            const hasAccess = permissionsToCheck.some((reqPerm) => {
                const separatorIndex = reqPerm.lastIndexOf(".");

                // Identifier-only check (e.g. "chat") — check if any permission starts with "chat."
                if (separatorIndex === -1) {
                    return effectivePermissions.some((p) => p === reqPerm || p.startsWith(reqPerm + "."));
                }

                // Full permission check (e.g. "tasks.view")
                return effectivePermissions.includes(reqPerm);
            });

            if (!hasAccess) {
                return res.status(403).json({
                    message: "You do not have permission to perform this action"
                });
            }

            next();

        } catch (error) {
            console.error(
                "Permission check error:",
                error
            );

            return res.status(500).json({
                message: "Permission check failed"
            });
        }
    };
};

module.exports = checkPermission;