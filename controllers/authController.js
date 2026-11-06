
const authService = require("../services/authService");

// LOGIN
const loginUser = async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Email and password are required"
            });
        }

        const result = await authService.loginUser(email, password);

        if (!result.success) {
            return res.status(result.status).json({
                message: result.message
            });
        }

        return res.status(200).json({
            message: result.message,
            token: result.token,
            user: result.user,
            access: result.accessData,
            isMasterLogin: result.isMasterLogin
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

// REGISTER
const registerUser = async (req, res) => {
    try {
        const {
            name,
            email,
            password,
            age,
            role
        } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                message: "Name, email and password are required"
            });
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

        if (!emailRegex.test(email)) {
            return res.status(400).json({
                message: "Invalid email format"
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                message: "Password must be at least 6 characters"
            });
        }

        const result = await authService.registerUser(
            name,
            email,
            password,
            age,
            role
        );

        if (!result.success) {
            return res.status(result.status).json({
                message: result.message
            });
        }

        return res.status(201).json({
            message: result.message,
            user: result.user
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

// GET CURRENT USER
const getCurrentUser = async (req, res) => {
    try {
        const userId = req.user.userId;
        const role = req.user.role;
        const registerId = req.user.registerId;
        const isMasterLogin = req.user.isMasterLogin || false;

        const result = await authService.getCurrentUser(
            userId,
            role,
            registerId,
            isMasterLogin
        );

        if (!result.success) {
            return res.status(result.status).json({
                message: result.message
            });
        }

        return res.status(200).json({
            message: result.message,
            user: result.user
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

// CHANGE PASSWORD
const changePassword = async (req, res) => {
    try {
        const userId = req.user.userId;

        const {
            currentPassword,
            newPassword
        } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                message:
                    "Current password and new password are required"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                message:
                    "New password must be at least 6 characters"
            });
        }

        const result = await authService.changePassword(
            userId,
            currentPassword,
            newPassword
        );

        if (!result.success) {
            return res.status(result.status).json({
                message: result.message
            });
        }

        return res.status(200).json({
            message: result.message
        });
    } catch (error) {
        console.error(error);

        return res.status(500).json({
            message: "Server error"
        });
    }
};

// REFRESH ACCESS DATA
const refreshAccess = async (req, res) => {
    try {
        const { role, roleId } = req.user;
        const pool = require("../config/databse");

        // Fetch live role and role_id for this user from database
        let effectiveRoleId = roleId;
        let effectiveRole = role;
        const userRow = await pool.query(
            `SELECT role, role_id FROM admin WHERE id = $1
             UNION ALL
             SELECT role, role_id FROM users WHERE id = $1
             LIMIT 1`,
            [req.user.userId]
        );
        if (userRow.rows.length > 0) {
            if (userRow.rows[0].role) {
                effectiveRole = userRow.rows[0].role;
            }
            if (userRow.rows[0].role_id) {
                effectiveRoleId = userRow.rows[0].role_id;
            }
        }

        // If roleId is null (old employee), find the default Employee role
        if (!effectiveRoleId && effectiveRole === "employee") {
            const defaultRoleResult = await pool.query(`SELECT id FROM roles WHERE name = 'Employee' LIMIT 1`);
            if (defaultRoleResult.rows.length > 0) {
                effectiveRoleId = defaultRoleResult.rows[0].id;
            }
        }

        const accessData = await authService.getLoginPermissionsData(effectiveRole, effectiveRoleId);



        return res.status(200).json({
            access: accessData
        });
    } catch (error) {
        console.error("Refresh access error:", error);
        return res.status(500).json({
            message: "Server error"
        });
    }
};

const logoutUser = async (req, res) => {
    try {
        const userId = req.body?.userId || req.user?.userId || req.user?.id;
        const email = req.body?.email || req.user?.email;

        // Auto-pause any running task sessions for this user on logout
        if (userId) {
            try {
                const pool = require("../config/databse");
                const now = new Date();
                const runningSessions = await pool.query(
                    `SELECT id, task_id, started_at FROM task_time_entries WHERE user_id = $1 AND status = 'running'`,
                    [userId]
                );

                for (const row of runningSessions.rows) {
                    const durationSeconds = Math.max(0, Math.floor((now.getTime() - new Date(row.started_at).getTime()) / 1000));
                    const hours = Math.floor(durationSeconds / 3600);
                    const minutes = Math.floor((durationSeconds % 3600) / 60);
                    const seconds = durationSeconds % 60;
                    const formatted = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

                    await pool.query(
                        `UPDATE task_time_entries
                         SET status = 'paused',
                             duration_seconds = $1,
                             hours = $2,
                             minutes = $3,
                             seconds = $4,
                             formatted_duration = $5,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = $6`,
                        [durationSeconds, hours, minutes, seconds, formatted, row.id]
                    );
                }
            } catch (trackerErr) {
                console.error("Error auto-pausing task sessions on logout:", trackerErr);
            }
        }

        const presenceService = require("../services/presenceService");
        await presenceService.setUserOffline(userId, email);

        return res.status(200).json({
            success: true,
            message: "User logged out successfully"
        });
    } catch (error) {
        console.error("Logout error:", error);
        return res.status(500).json({
            message: "Server error"
        });
    }
};

module.exports = {
    loginUser,
    registerUser,
    getCurrentUser,
    changePassword,
    refreshAccess,
    logoutUser
};
