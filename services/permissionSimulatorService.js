const pool = require("../config/databse");
const { getAllMenusWithSubmenus } = require("./rolePermissionService");

/**
 * Check if a role or user name/email indicates General Admin
 */
const isGeneralAdmin = (userOrRole) => {
    if (!userOrRole) return false;
    const r = String(userOrRole.role || "").toLowerCase().trim();
    const rn = String(userOrRole.role_name || userOrRole.roleName || userOrRole.name || "").toLowerCase().trim();
    const email = String(userOrRole.email || "").toLowerCase().trim();

    return (
        r === "general_admin" ||
        r === "general admin" ||
        r.includes("general") ||
        r === "super_admin" ||
        rn === "general admin" ||
        rn === "general_admin" ||
        rn.includes("general") ||
        email === "nency@gmail.com"
    );
};

/**
 * Get all available metadata for the Permission Simulator:
 * - Active users (from users and admin) with role info
 * - Active roles
 * - Active modules with identifiers and operations
 */
const getSimulatorMeta = async () => {
    // 1. Fetch Users
    const usersQuery = `
        SELECT 
            u.id, 
            u.name, 
            u.email, 
            u.role, 
            u.role_id, 
            COALESCE(r.name, u.role) AS role_name,
            'employee' AS user_type,
            u.is_active
        FROM users u
        LEFT JOIN roles r ON u.role_id = r.id
        WHERE u.is_active = true

        UNION ALL

        SELECT 
            a.id, 
            a.name, 
            a.email, 
            a.role, 
            a.role_id, 
            COALESCE(r.name, a.role) AS role_name,
            'admin' AS user_type,
            a.is_active
        FROM admin a
        LEFT JOIN roles r ON a.role_id = r.id
        WHERE a.is_active = true

        ORDER BY name ASC
    `;
    const usersResult = await pool.query(usersQuery);

    // 2. Fetch Roles
    const rolesQuery = `
        SELECT id, name, is_active
        FROM roles
        WHERE is_active = true
        ORDER BY name ASC
    `;
    const rolesResult = await pool.query(rolesQuery);

    // 3. Fetch Modules & Submenus
    const rawMenus = await getAllMenusWithSubmenus();
    const flatModules = [];

    rawMenus.forEach((menu) => {
        if (Array.isArray(menu.submenus) && menu.submenus.length > 0) {
            menu.submenus.forEach((sub) => {
                flatModules.push({
                    id: sub.id,
                    name: `${menu.name} › ${sub.name}`,
                    shortName: sub.name,
                    parentName: menu.name,
                    identifier: sub.identifier,
                    operations: sub.operations || ["view"],
                });
            });
        } else {
            flatModules.push({
                id: menu.id,
                name: menu.name,
                shortName: menu.name,
                parentName: null,
                identifier: menu.identifier,
                operations: menu.operations || ["view"],
            });
        }
    });

    return {
        users: usersResult.rows,
        roles: rolesResult.rows,
        modules: flatModules,
    };
};

/**
 * Simulate permission evaluation for a user or a role
 * @param {Object} params
 * @param {'user'|'role'} params.targetType
 * @param {string} [params.userId]
 * @param {string} [params.roleId]
 * @param {string} params.identifier - Module identifier or ID
 * @param {string} [params.operation] - Specific operation e.g. 'view', 'edit', or null/'all'
 */
const simulatePermission = async ({
    targetType = "user",
    userId,
    roleId,
    identifier,
    operation = "view",
}) => {
    if (!identifier) {
        throw new Error("Module identifier is required for simulation");
    }

    let targetUser = null;
    let targetRole = null;
    let effectiveRoleId = roleId;

    // 1. Resolve Target
    if (targetType === "user") {
        if (!userId) {
            throw new Error("User ID is required when targetType is 'user'");
        }

        const userRes = await pool.query(
            `
            SELECT * FROM (
                SELECT 
                    u.id, u.name, u.email, u.role, u.role_id, 
                    COALESCE(r.name, u.role) AS role_name,
                    u.is_active, 'employee' AS user_type
                FROM users u
                LEFT JOIN roles r ON u.role_id = r.id
                WHERE u.id = $1

                UNION ALL

                SELECT 
                    a.id, a.name, a.email, a.role, a.role_id, 
                    COALESCE(r.name, a.role) AS role_name,
                    a.is_active, 'admin' AS user_type
                FROM admin a
                LEFT JOIN roles r ON a.role_id = r.id
                WHERE a.id = $1
            ) AS combined
            LIMIT 1
            `,
            [userId]
        );

        if (userRes.rows.length === 0) {
            throw new Error(`Target user not found (ID: ${userId})`);
        }
        targetUser = userRes.rows[0];
        effectiveRoleId = targetUser.role_id;

        if (effectiveRoleId) {
            const roleRes = await pool.query(
                `SELECT id, name, is_active FROM roles WHERE id = $1`,
                [effectiveRoleId]
            );
            if (roleRes.rows.length > 0) {
                targetRole = roleRes.rows[0];
            }
        }
    } else {
        if (!roleId) {
            throw new Error("Role ID is required when targetType is 'role'");
        }
        const roleRes = await pool.query(
            `SELECT id, name, is_active FROM roles WHERE id = $1`,
            [roleId]
        );
        if (roleRes.rows.length === 0) {
            throw new Error(`Target role not found (ID: ${roleId})`);
        }
        targetRole = roleRes.rows[0];
        effectiveRoleId = targetRole.id;
    }

    // 2. Resolve Identifier (Module)
    const idRes = await pool.query(
        `
        SELECT id, name, identifier, operations, is_active, is_deleted
        FROM identifiers
        WHERE (identifier = $1 OR id::text = $1)
          AND is_deleted = false
        LIMIT 1
        `,
        [identifier]
    );

    if (idRes.rows.length === 0) {
        throw new Error(`Module identifier '${identifier}' not found in system.`);
    }

    const moduleRecord = idRes.rows[0];
    const supportedOps = Array.isArray(moduleRecord.operations)
        ? moduleRecord.operations
        : ["view"];

    // 3. Fetch Role Permissions for this Module
    let roleGrantedOperations = [];
    if (effectiveRoleId) {
        const riaRes = await pool.query(
            `
            SELECT operations
            FROM role_identifier_access
            WHERE role_id = $1 AND identifier_id = $2
            `,
            [effectiveRoleId, moduleRecord.id]
        );
        if (riaRes.rows.length > 0 && Array.isArray(riaRes.rows[0].operations)) {
            roleGrantedOperations = riaRes.rows[0].operations;
        }
    }

    // 4. Fetch User Overrides for this Module
    let userOverridesMap = {}; // operation -> boolean
    if (targetType === "user" && targetUser) {
        const uiaRes = await pool.query(
            `
            SELECT operation, is_allowed
            FROM user_identifier_access
            WHERE user_id = $1 AND identifier_id = $2
            `,
            [targetUser.id, moduleRecord.id]
        );
        uiaRes.rows.forEach((row) => {
            userOverridesMap[row.operation] = row.is_allowed;
        });
    }

    // 5. Evaluate an individual operation helper
    const isTargetGA = targetType === "user" && isGeneralAdmin(targetUser);

    const evaluateOperation = (op) => {
        const trace = [];
        let isAllowed = false;
        let verdict = "DENIED";
        let reason = "";
        let source = "none";

        // Step 1: General Admin Check
        if (isTargetGA) {
            isAllowed = true;
            verdict = "ALLOWED";
            source = "general_admin";
            reason = "Universal access granted via General Admin role.";
            trace.push({
                step: 1,
                name: "General Admin Check",
                status: "GRANTED",
                detail: `User '${targetUser.name}' is a General Admin. Bypass rule grants all permissions unconditionally.`,
            });
            return { op, isAllowed, verdict, reason, source, trace };
        } else {
            trace.push({
                step: 1,
                name: "General Admin Check",
                status: "PASSED",
                detail: targetType === "user"
                    ? `User '${targetUser.name}' (Role: ${targetUser.role_name || targetUser.role}) is not a General Admin. Standard evaluation applies.`
                    : `Simulating role '${targetRole.name}'. Standard evaluation applies.`,
            });
        }

        // Step 2: Module Operation Validation Check
        if (!supportedOps.includes(op)) {
            isAllowed = false;
            verdict = "DENIED";
            source = "invalid_operation";
            reason = `Operation '${op}' is not supported by module '${moduleRecord.name}'.`;
            trace.push({
                step: 2,
                name: "Module Operation Support",
                status: "NOT_SUPPORTED",
                detail: `Module '${moduleRecord.name}' only supports [${supportedOps.join(", ")}]. '${op}' is invalid.`,
            });
            return { op, isAllowed, verdict, reason, source, trace };
        } else {
            trace.push({
                step: 2,
                name: "Module Operation Support",
                status: "SUPPORTED",
                detail: `Operation '${op}' is valid for module '${moduleRecord.name}'.`,
            });
        }

        // Step 3: User Override Check (user_identifier_access)
        if (targetType === "user") {
            if (Object.prototype.hasOwnProperty.call(userOverridesMap, op)) {
                const overrideAllowed = userOverridesMap[op];
                if (overrideAllowed === true) {
                    isAllowed = true;
                    verdict = "ALLOWED";
                    source = "user_override";
                    reason = `Explicitly granted by custom user override in user_identifier_access.`;
                    trace.push({
                        step: 3,
                        name: "User-Specific Override Check",
                        status: "OVERRIDE_ALLOW",
                        detail: `Found custom override for user '${targetUser.name}' with is_allowed = TRUE. Overrides role base rules.`,
                    });
                    return { op, isAllowed, verdict, reason, source, trace };
                } else {
                    isAllowed = false;
                    verdict = "DENIED";
                    source = "user_override";
                    reason = `Explicitly revoked by custom user override in user_identifier_access.`;
                    trace.push({
                        step: 3,
                        name: "User-Specific Override Check",
                        status: "OVERRIDE_DENY",
                        detail: `Found custom override for user '${targetUser.name}' with is_allowed = FALSE. Access blocked regardless of role.`,
                    });
                    return { op, isAllowed, verdict, reason, source, trace };
                }
            } else {
                trace.push({
                    step: 3,
                    name: "User-Specific Override Check",
                    status: "NO_OVERRIDE",
                    detail: `No custom user override found for '${op}'. Inheriting from assigned role '${targetRole ? targetRole.name : targetUser.role_name}'.`,
                });
            }
        }

        // Step 4: Role Permissions Check (role_identifier_access)
        const roleName = targetRole ? targetRole.name : (targetUser?.role_name || "Unknown");
        if (roleGrantedOperations.includes(op)) {
            isAllowed = true;
            verdict = "ALLOWED";
            source = "role";
            reason = `Granted by role '${roleName}' permissions.`;
            trace.push({
                step: 4,
                name: "Role Permissions Check",
                status: "ROLE_GRANTED",
                detail: `Role '${roleName}' has granted operations: [${roleGrantedOperations.join(", ")}]. '${op}' is allowed.`,
            });
        } else {
            isAllowed = false;
            verdict = "DENIED";
            source = "role_missing";
            reason = `Role '${roleName}' does not grant '${op}' permission.`;
            trace.push({
                step: 4,
                name: "Role Permissions Check",
                status: "ROLE_DENIED",
                detail: `Role '${roleName}' operations: [${roleGrantedOperations.length ? roleGrantedOperations.join(", ") : "none"}]. '${op}' is missing.`,
            });
        }

        // Step 5: Final Zero-Trust Security Summary
        trace.push({
            step: 5,
            name: "Final Evaluation",
            status: isAllowed ? "ALLOWED" : "DENIED",
            detail: isAllowed
                ? `Permission authorized for '${moduleRecord.identifier}.${op}'.`
                : `Permission blocked for '${moduleRecord.identifier}.${op}' by system security rules.`,
        });

        return { op, isAllowed, verdict, reason, source, trace };
    };

    // 6. Generate Matrix for ALL supported operations
    const operationsMatrix = {};
    supportedOps.forEach((op) => {
        const res = evaluateOperation(op);
        operationsMatrix[op] = {
            isAllowed: res.isAllowed,
            verdict: res.verdict,
            source: res.source,
            reason: res.reason,
        };
    });

    // 7. Evaluate the primary requested operation
    const primaryOp = operation && operation !== "all" ? operation : (supportedOps[0] || "view");
    const primaryResult = evaluateOperation(primaryOp);

    // 8. Generate Actionable Recommendation
    let recommendation = "";
    if (primaryResult.isAllowed) {
        recommendation = `Access is fully functional. User can perform '${primaryOp}' on '${moduleRecord.name}'.`;
    } else {
        if (primaryResult.source === "user_override") {
            recommendation = `To grant access: Open User Permissions for ${targetUser.name} and toggle '${primaryOp}' to Allow, or delete the override.`;
        } else if (primaryResult.source === "role_missing") {
            const roleLabel = targetRole ? targetRole.name : targetUser.role_name;
            recommendation = `To grant access: Open Role Permissions for '${roleLabel}' and enable '${primaryOp}' under '${moduleRecord.name}', or assign an individual user override.`;
        } else if (primaryResult.source === "invalid_operation") {
            recommendation = `Ensure that operation '${primaryOp}' is registered as a valid operation for module '${moduleRecord.name}'.`;
        } else {
            recommendation = `Check system roles and identifier mappings for '${moduleRecord.identifier}'.`;
        }
    }

    return {
        targetType,
        target: targetType === "user" ? targetUser : targetRole,
        module: {
            id: moduleRecord.id,
            name: moduleRecord.name,
            identifier: moduleRecord.identifier,
            supportedOperations: supportedOps,
        },
        primaryOperation: primaryOp,
        result: {
            isAllowed: primaryResult.isAllowed,
            verdict: primaryResult.verdict,
            source: primaryResult.source,
            reason: primaryResult.reason,
            recommendation,
            trace: primaryResult.trace,
        },
        operationsMatrix,
    };
};

module.exports = {
    getSimulatorMeta,
    simulatePermission,
};
