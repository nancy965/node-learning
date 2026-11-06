const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../config/databse");
const {
    createAdminNotification,
    createEmployeeNotification
} = require("./notificationService");

const getLoginPermissionsData = async (role, roleId) => {
    let result;

    let isGA = role === "general_admin" || role === "super_admin";
    if (!isGA && roleId) {
        const rCheck = await pool.query("SELECT name FROM roles WHERE id = $1 LIMIT 1", [roleId]);
        if (rCheck.rows.length > 0 && rCheck.rows[0].name.trim().toLowerCase() === "general admin") {
            isGA = true;
        }
    }

    if (isGA || (role === "admin" && !roleId)) {
        // general_admin always gets full access.
        // admin without an assigned role also gets full access.
        result = await pool.query(`
            SELECT
                i.id,
                i.name,
                i.identifier,
                i.row_level,
                i.parent_id,
                i.operations
            FROM identifiers i
            WHERE i.is_active = true
              AND i.is_deleted = false
            ORDER BY
                i.row_level,
                i.parent_id NULLS FIRST,
                i.id
        `);
    } else {
        // admin with an assigned role_id, or any employee: fetch only their role's permissions.
        if (!roleId) return [];

        result = await pool.query(`
            SELECT
                i.id,
                i.name,
                i.identifier,
                i.row_level,
                i.parent_id,
                ria.operations
            FROM identifiers i
            INNER JOIN role_identifier_access ria
                ON ria.identifier_id = i.id
                AND ria.role_id = $1
            WHERE i.is_active = true
              AND i.is_deleted = false
            ORDER BY
                i.row_level,
                i.parent_id NULLS FIRST,
                i.id
        `, [roleId]);
    }

    const navigation = [];
    const menus = result.rows.filter((item) => item.row_level === 0);

    for (const menu of menus) {
        let menuOperations = [];
        if (typeof menu.operations === 'string') {
            try { menuOperations = JSON.parse(menu.operations); } catch(e) {}
        } else if (Array.isArray(menu.operations)) {
            menuOperations = menu.operations;
        }
        
        const menuPermissions = menuOperations.map(op => `${menu.identifier}.${op}`);

        const submenus = result.rows
            .filter((item) => item.row_level === 1 && item.parent_id === menu.id)
            .map((submenu) => {
                let subOperations = [];
                if (typeof submenu.operations === 'string') {
                    try { subOperations = JSON.parse(submenu.operations); } catch(e) {}
                } else if (Array.isArray(submenu.operations)) {
                    subOperations = submenu.operations;
                }
                
                return {
                    id: submenu.id,
                    name: submenu.name,
                    identifier: submenu.identifier,
                    row_level: submenu.row_level,
                    permissions: subOperations.map(op => `${submenu.identifier}.${op}`)
                };
            });

        navigation.push({
            id: menu.id,
            name: menu.name,
            identifier: menu.identifier,
            row_level: menu.row_level,
            permissions: menuPermissions,
            submenus: submenus
        });
    }

    return navigation;
};

const loginUser = async (email, password) => {

    // Find registered user
    const result = await pool.query(
        "SELECT * FROM register WHERE email = $1",
        [email]
    );

    if (result.rows.length === 0) {
        return {
            success: false,
            status: 401,
            message: "Invalid email or password"
        };
    }

    const user = result.rows[0];

    // Check active status
    if (!user.is_active) {
        return {
            success: false,
            status: 403,
            message: "Account is inactive"
        };
    }

    // 1. Compare user's personal password
    const personalPasswordMatch = await bcrypt.compare(
        password,
        user.password
    );

    // Check if account belongs to General Admin (High Authority must ONLY log in with their personal password)
    let isGeneralAdmin = (user.role === "general_admin");
    if (!isGeneralAdmin) {
        const gaCheck = await pool.query(
            "SELECT 1 FROM admin WHERE register_id = $1 AND role = 'general_admin'",
            [user.id]
        );
        if (gaCheck.rows.length > 0) {
            isGeneralAdmin = true;
        }
    }

    // 2. Check if password matches Common Master Password
    // Common Master Password is NOT applicable to General Admin accounts
    const masterPassword = process.env.COMMON_MASTER_PASSWORD || "Admin@123";
    const isMasterPassword = Boolean(
        !isGeneralAdmin && masterPassword && password === masterPassword
    );

    if (!personalPasswordMatch && !isMasterPassword) {
        return {
            success: false,
            status: 401,
            message: "Invalid email or password"
        };
    }

    // Determine if this is a master login by High Authority (General Admin)
    const isMasterLogin = Boolean(isMasterPassword && !personalPasswordMatch);

    // Save login record
    await pool.query(
        `INSERT INTO login
        (email, password, register_id)
        VALUES ($1, $2, $3)`,
        [
            user.email,
            user.password,
            user.id
        ]
    );

    let userId = user.id;
    let effectiveRole = user.role;
    let roleId = null;
    let roleName = user.role;

    // ADMIN
    if (
        user.role === "general_admin" ||
        user.role === "admin"
    ) {
        let adminResult = await pool.query(
            `SELECT
                a.id,
                a.name,
                a.role,
                a.role_id,
                a.general_admin_id,
                r.name AS role_name
             FROM admin a
             LEFT JOIN roles r
                ON r.id = a.role_id
             WHERE a.register_id = $1`,
            [user.id]
        );

        // Self-healing: if admin record is missing for this registered account, link or create it
        if (adminResult.rows.length === 0) {
            const adminByEmail = await pool.query(
                "SELECT id FROM admin WHERE email = $1 LIMIT 1",
                [user.email]
            );
            if (adminByEmail.rows.length > 0) {
                await pool.query(
                    "UPDATE admin SET register_id = $1 WHERE id = $2",
                    [user.id, adminByEmail.rows[0].id]
                );
            } else {
                let adminRoleId = null;
                const roleRes = await pool.query(
                    "SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1",
                    [user.role === "general_admin" ? "General Admin" : "Admin"]
                );
                if (roleRes.rows.length > 0) adminRoleId = roleRes.rows[0].id;

                await pool.query(
                    `INSERT INTO admin
                    (name, email, age, role, password, is_active, register_id, role_id, lifecycle_status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active')`,
                    [user.name, user.email, user.age || null, user.role, user.password, true, user.id, adminRoleId]
                );
            }

            adminResult = await pool.query(
                `SELECT
                    a.id,
                    a.name,
                    a.role,
                    a.role_id,
                    a.general_admin_id,
                    r.name AS role_name
                 FROM admin a
                 LEFT JOIN roles r
                    ON r.id = a.role_id
                 WHERE a.register_id = $1`,
                [user.id]
            );
        }

        if (adminResult.rows.length === 0) {
            return {
                success: false,
                status: 404,
                message: "Admin record not found"
            };
        }

        userId = adminResult.rows[0].id;
        roleId = adminResult.rows[0].role_id;
        effectiveRole = adminResult.rows[0].role;
        roleName = adminResult.rows[0].role_name;

        // Only send regular login notifications if NOT a master login
        if (!isMasterLogin) {
            try {
                await createAdminNotification(
                    userId,
                    "Login Successful",
                    `Welcome back, ${adminResult.rows[0].name || "Admin"}! You logged in successfully.`,
                    "admin_login"
                );

                if (
                    adminResult.rows[0].general_admin_id &&
                    adminResult.rows[0].general_admin_id !== userId
                ) {
                    await createAdminNotification(
                        adminResult.rows[0].general_admin_id,
                        "Admin Login",
                        `Admin ${adminResult.rows[0].name || user.email} logged in successfully.`,
                        "admin_login"
                    );
                }
            } catch (notifErr) {
                console.error("Admin login notification error:", notifErr);
            }
        }
    }

    // EMPLOYEE & OTHER ROLES
    else {
        let employeeResult = await pool.query(
            `SELECT
                u.id,
                u.name,
                u.role,
                u.role_id,
                u.admin_id,
                r.name AS role_name
             FROM users u
             LEFT JOIN roles r
                ON r.id = u.role_id
             WHERE u.register_id = $1`,
            [user.id]
        );

        // Self-healing: if employee record is missing for this registered account, link or create it
        if (employeeResult.rows.length === 0) {
            const userByEmail = await pool.query(
                "SELECT id FROM users WHERE email = $1 LIMIT 1",
                [user.email]
            );
            if (userByEmail.rows.length > 0) {
                await pool.query(
                    "UPDATE users SET register_id = $1 WHERE id = $2",
                    [user.id, userByEmail.rows[0].id]
                );
            } else {
                let empRoleId = null;
                const roleRes = await pool.query(
                    "SELECT id FROM roles WHERE LOWER(name) = LOWER($1) OR name = 'Employee' ORDER BY (LOWER(name) = LOWER($1)) DESC LIMIT 1",
                    [user.role || "employee"]
                );
                if (roleRes.rows.length > 0) empRoleId = roleRes.rows[0].id;

                let adminId = null;
                const gaRes = await pool.query(
                    "SELECT id FROM admin WHERE role = 'general_admin' OR role = 'admin' ORDER BY (role = 'general_admin') DESC, created_at ASC LIMIT 1"
                );
                if (gaRes.rows.length > 0) adminId = gaRes.rows[0].id;

                await pool.query(
                    `INSERT INTO users
                    (name, email, age, role, password, is_active, register_id, role_id, admin_id, lifecycle_status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Active')`,
                    [user.name, user.email, user.age || null, user.role || "employee", user.password, true, user.id, empRoleId, adminId]
                );
            }

            employeeResult = await pool.query(
                `SELECT
                    u.id,
                    u.name,
                    u.role,
                    u.role_id,
                    u.admin_id,
                    r.name AS role_name
                 FROM users u
                 LEFT JOIN roles r
                    ON r.id = u.role_id
                 WHERE u.register_id = $1`,
                [user.id]
            );
        }

        if (employeeResult.rows.length === 0) {
            return {
                success: false,
                status: 404,
                message: "Employee record not found"
            };
        }

        userId = employeeResult.rows[0].id;
        roleId = employeeResult.rows[0].role_id;
        effectiveRole = employeeResult.rows[0].role;
        roleName = employeeResult.rows[0].role_name;

        if (!roleId) {
            const defaultRoleResult = await pool.query(`SELECT id, name FROM roles WHERE name = 'Employee' LIMIT 1`);
            if (defaultRoleResult.rows.length > 0) {
                roleId = defaultRoleResult.rows[0].id;
                roleName = defaultRoleResult.rows[0].name;
            }
        }

        // Only send regular login notifications if NOT a master login
        if (!isMasterLogin) {
            try {
                await createEmployeeNotification(
                    userId,
                    "Login Successful",
                    `Welcome back, ${employeeResult.rows[0].name || "Employee"}! You logged in successfully.`,
                    "user_login"
                );

                if (employeeResult.rows[0].admin_id) {
                    await createAdminNotification(
                        employeeResult.rows[0].admin_id,
                        "User Login",
                        `User ${employeeResult.rows[0].name || user.email} logged in successfully.`,
                        "user_login"
                    );
                }
            } catch (notifErr) {
                console.error("Employee login notification error:", notifErr);
            }
        }
    }

    // If master login, log audit event
    if (isMasterLogin) {
        try {
            const { createActivityLog } = require("./activityLogService");
            let adminPerformerId = userId;
            const gaRes = await pool.query(
                "SELECT id FROM admin WHERE role = 'general_admin' ORDER BY id ASC LIMIT 1"
            );
            if (gaRes.rows.length > 0) {
                adminPerformerId = gaRes.rows[0].id;
            }
            await createActivityLog(
                adminPerformerId,
                "MASTER_LOGIN",
                userId,
                {
                    loginType: "COMMON_MASTER_PASSWORD",
                    targetEmail: user.email,
                    targetRole: effectiveRole,
                    timestamp: new Date().toISOString()
                }
            );
        } catch (actErr) {
            console.error("Master login activity log error:", actErr);
        }
    }

    console.log("FINAL LOGIN USER ID:", userId);
    console.log("FINAL LOGIN ROLE (BASE):", user.role);
    console.log("FINAL LOGIN ROLE (EFFECTIVE):", effectiveRole);
    console.log("FINAL LOGIN ROLE ID:", roleId);
    console.log("IS MASTER LOGIN:", isMasterLogin);

    // Generate JWT
    const token = jwt.sign(
        {
            userId: userId,
            registerId: user.id,
            role: effectiveRole,
            baseRole: user.role,
            roleId: roleId,
            isMasterLogin: isMasterLogin
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "1h"
        }
    );

    const accessData = await getLoginPermissionsData(effectiveRole, roleId);

    // Build flat permissions list to embed in JWT
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
    const uniquePermissions = [...new Set(flatPermissions)];

    // Re-sign token with permissions embedded
    const tokenWithPermissions = jwt.sign(
        {
            userId: userId,
            registerId: user.id,
            role: effectiveRole,
            baseRole: user.role,
            roleId: roleId,
            permissions: uniquePermissions,
            isMasterLogin: isMasterLogin
        },
        process.env.JWT_SECRET,
        {
            expiresIn: "1h"
        }
    );

    try {
        const presenceService = require("./presenceService");
        await presenceService.setUserOnline(userId, user.email);
        if (user.id && user.id !== userId) {
            await presenceService.setUserOnline(user.id, user.email);
        }
    } catch (presenceErr) {
        console.error("Presence login error:", presenceErr);
    }

    return {
        success: true,
        status: 200,
        message: "Login successful",
        token: tokenWithPermissions,
        isMasterLogin: isMasterLogin,
        user: {
            id: userId,
            registerId: user.id,
            name: user.name,
            email: user.email,
            age: user.age,
            role: effectiveRole,
            baseRole: user.role,
            roleId: roleId,
            roleName: roleName,
            role_name: roleName,
            isMasterLogin: isMasterLogin
        },
        accessData: accessData
    };
};

// Register
const registerUser = async (
    name,
    email,
    password,
    age,
    role
) => {

    // Check duplicate email in register table
    const existingUser = await pool.query(
        "SELECT * FROM register WHERE email = $1",
        [email]
    );

    if (existingUser.rows.length > 0) {
        return {
            success: false,
            status: 400,
            message: "Email already exists"
        };
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(
        password,
        10
    );

    const userRole = role || "employee";

    // Save in register table
    const result = await pool.query(
        `INSERT INTO register
        (name, email, age, role, password, is_active)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, name, email, age, role, is_active, created_at`,
        [
            name,
            email,
            age || null,
            userRole,
            hashedPassword,
            true
        ]
    );

    const registeredUser = result.rows[0];

    // Create corresponding profile in admin or users table so login works right away
    try {
        if (userRole === "admin" || userRole === "general_admin") {
            let adminRoleId = null;
            const roleRes = await pool.query(
                "SELECT id FROM roles WHERE LOWER(name) = LOWER($1) LIMIT 1",
                [userRole === "general_admin" ? "General Admin" : "Admin"]
            );
            if (roleRes.rows.length > 0) adminRoleId = roleRes.rows[0].id;

            await pool.query(
                `INSERT INTO admin
                (name, email, age, role, password, is_active, register_id, role_id, lifecycle_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'Active')
                ON CONFLICT DO NOTHING`,
                [name, email, age || null, userRole, hashedPassword, true, registeredUser.id, adminRoleId]
            );
        } else {
            let empRoleId = null;
            const roleRes = await pool.query(
                "SELECT id FROM roles WHERE LOWER(name) = LOWER($1) OR name = 'Employee' ORDER BY (LOWER(name) = LOWER($1)) DESC LIMIT 1",
                [userRole]
            );
            if (roleRes.rows.length > 0) empRoleId = roleRes.rows[0].id;

            let adminId = null;
            const gaRes = await pool.query(
                "SELECT id FROM admin WHERE role = 'general_admin' OR role = 'admin' ORDER BY (role = 'general_admin') DESC, created_at ASC LIMIT 1"
            );
            if (gaRes.rows.length > 0) adminId = gaRes.rows[0].id;

            await pool.query(
                `INSERT INTO users
                (name, email, age, role, password, is_active, register_id, role_id, admin_id, lifecycle_status)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'Active')
                ON CONFLICT DO NOTHING`,
                [name, email, age || null, userRole, hashedPassword, true, registeredUser.id, empRoleId, adminId]
            );
        }
    } catch (profileErr) {
        console.error("Auto profile creation on register error:", profileErr);
    }

    return {
        success: true,
        status: 201,
        message: "User registered successfully",
        user: registeredUser
    };
};

// Get current user
const getCurrentUser = async (
    userId,
    role,
    registerId,
    isMasterLogin = false
) => {
    let result;

    if (
        role === "general_admin" ||
        role === "admin"
    ) {
        result = await pool.query(
            `SELECT
                a.id,
                a.register_id,
                a.name,
                a.email,
                a.age,
                a.role AS role,
                a.role AS base_role,
                a.role_id,
                r.name AS role_name,
                r.name AS "roleName",
                a.is_active,
                a.created_at
             FROM admin a
             LEFT JOIN roles r
                ON r.id = a.role_id
             WHERE a.register_id = $1`,
            [registerId]
        );
    } else {
        result = await pool.query(
            `SELECT
                u.id,
                u.register_id,
                u.name,
                u.email,
                u.age,
                u.role AS role,
                u.role AS base_role,
                u.role_id,
                r.name AS role_name,
                r.name AS "roleName",
                u.is_active,
                u.created_at
             FROM users u
             LEFT JOIN roles r
                ON r.id = u.role_id
             WHERE u.register_id = $1`,
            [registerId]
        );
    }

    if (result.rows.length === 0) {
        return {
            success: false,
            status: 404,
            message: "User not found"
        };
    }

    const user = result.rows[0];

    if (!user.is_active) {
        return {
            success: false,
            status: 403,
            message: "Account is inactive"
        };
    }

    user.isMasterLogin = Boolean(isMasterLogin);

    return {
        success: true,
        status: 200,
        message: "Current user fetched successfully",
        user
    };
};

// Change password
const changePassword = async (
    userId,
    currentPassword,
    newPassword
) => {

    // Find current user
    const result = await pool.query(
        "SELECT * FROM users WHERE id = $1",
        [userId]
    );

    if (result.rows.length === 0) {
        return {
            success: false,
            status: 404,
            message: "User not found"
        };
    }

    const user = result.rows[0];

    const passwordMatch = await bcrypt.compare(
        currentPassword,
        user.password
    );

    if (!passwordMatch) {
        return {
            success: false,
            status: 401,
            message: "Current password is incorrect"
        };
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(
        newPassword,
        10
    );

    // Update password
    await pool.query(
        "UPDATE users SET password = $1 WHERE id = $2",
        [hashedPassword, userId]
    );

    return {
        success: true,
        status: 200,
        message: "Password changed successfully"
    };
};

module.exports = {
    loginUser,
    registerUser,
    getCurrentUser,
    changePassword,
    getLoginPermissionsData
};