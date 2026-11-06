const pool = require("../config/databse");
const {
    createAdminNotification,
    createEmployeeNotification,
} = require("./notificationService");

const EXCLUDED_IDENTIFIERS = [
    "chat_messages",
    "chat_conversations",
];

const formatOperationName = (operation) => {
    return operation
        .replace(/_/g, " ")
        .replace(/\b\w/g, (character) => character.toUpperCase());
};

const buildOperations = (identifier, operations = []) => {
    const allowed = ["view", "create", "edit", "delete", "import", "export"];
    const filteredOps = operations.filter((op) => allowed.includes(op));
    return filteredOps.map((operation) => ({
        id: `${identifier}.${operation}`,
        name: formatOperationName(operation),
        identifier: `${identifier}.${operation}`,
        operation,
    }));
};

const getAllMenusWithSubmenus = async () => {
    const result = await pool.query(
        `
        SELECT
            parent.id AS menu_id,
            parent.name AS menu_name,
            parent.identifier AS menu_identifier,
            parent.operations AS menu_operations,
            parent.display_order AS menu_display_order,

            child.id AS submenu_id,
            child.name AS submenu_name,
            child.identifier AS submenu_identifier,
            child.operations AS submenu_operations,
            child.display_order AS submenu_display_order

        FROM identifiers parent

        LEFT JOIN identifiers child
            ON child.parent_id = parent.id
            AND child.row_level = 1
            AND child.is_deleted = false
            AND child.is_active = true

        WHERE parent.row_level = 0
          AND parent.is_deleted = false
          AND parent.is_active = true
          AND parent.identifier != ALL($1::text[])

        ORDER BY COALESCE(parent.display_order, 999) ASC, parent.id, COALESCE(child.display_order, 999) ASC, child.id
        `,
        [EXCLUDED_IDENTIFIERS]
    );

    const menus = [];

    for (const row of result.rows) {
        let menu = menus.find(
            (item) => item.id === row.menu_id
        );

        if (!menu) {
            menu = {
                id: row.menu_id,
                name: row.menu_name,
                identifier: row.menu_identifier,
                display_order: row.menu_display_order,
                operations: row.menu_operations || [],
                permissions: buildOperations(
                    row.menu_identifier,
                    row.menu_operations || []
                ),
                submenus: [],
            };

            menus.push(menu);
        }

        if (
            row.submenu_id &&
            !menu.submenus.some(
                (submenu) => submenu.id === row.submenu_id
            )
        ) {
            menu.submenus.push({
                id: row.submenu_id,
                name: row.submenu_name,
                identifier: row.submenu_identifier,
                display_order: row.submenu_display_order,
                operations: row.submenu_operations || [],
                permissions: buildOperations(
                    row.submenu_identifier,
                    row.submenu_operations || []
                ),
            });
        }
    }

    menus.forEach((menu) => {
        if (Array.isArray(menu.submenus)) {
            menu.submenus.sort((a, b) => (a.display_order ?? 999) - (b.display_order ?? 999));
        }
    });

    return menus;
};

const ALLOWED_OPERATIONS = [
    "view",
    "create",
    "edit",
    "delete",
    "import",
    "export",
];

const getAllPermissions = async () => {
    return ALLOWED_OPERATIONS.map((operation) => ({
        id: operation,
        name: formatOperationName(operation),
        operation,
    }));
};

const getSubmenuPermissions = async (submenuId) => {
    const result = await pool.query(
        `
        SELECT
            id,
            name,
            identifier,
            operations
        FROM identifiers
        WHERE id = $1
          AND row_level = 1
          AND is_active = true
          AND is_deleted = false
        `,
        [submenuId]
    );

    if (result.rows.length === 0) {
        return [];
    }

    const submenu = result.rows[0];

    return buildOperations(
        submenu.identifier,
        submenu.operations || []
    );
};

const getAllRoles = async (options = {}) => {
    const { page, limit, search = "" } = options;

    let whereConditions = [
        "is_active = true",
        "LOWER(name) != 'general admin'"
    ];
    let params = [];

    if (search && search.trim()) {
        params.push(`%${search.trim().toLowerCase()}%`);
        whereConditions.push(`LOWER(name) LIKE $${params.length}`);
    }

    const whereClause = `WHERE ${whereConditions.join(" AND ")}`;

    // If page and limit are not provided, return all roles as array
    if (!page || !limit) {
        const result = await pool.query(
            `
            SELECT
                id,
                name,
                is_active
            FROM roles
            ${whereClause}
            ORDER BY id
            `,
            params
        );

        return result.rows;
    }

    // With pagination
    const countResult = await pool.query(
        `
        SELECT COUNT(*) AS total
        FROM roles
        ${whereClause}
        `,
        params
    );

    const totalRecords = parseInt(countResult.rows[0].total, 10) || 0;
    const totalPages = Math.ceil(totalRecords / limit) || 1;
    const offset = (page - 1) * limit;

    const queryParams = [...params, limit, offset];
    const result = await pool.query(
        `
        SELECT
            id,
            name,
            is_active
        FROM roles
        ${whereClause}
        ORDER BY id
        LIMIT $${queryParams.length - 1}
        OFFSET $${queryParams.length}
        `,
        queryParams
    );

    return {
        roles: result.rows,
        pagination: {
            page: Number(page),
            limit: Number(limit),
            totalRecords,
            totalPages
        }
    };
};

const getRolesByMenuOrSubmenu = async (identifierId) => {
    const result = await pool.query(
        `
        SELECT
            r.id,
            r.name
        FROM roles r

        INNER JOIN role_identifier_access ria
            ON ria.role_id = r.id

        INNER JOIN identifiers i
            ON i.id = ria.identifier_id

        WHERE i.id = $1
          AND i.is_deleted = false
          AND i.is_active = true
          AND r.is_active = true
          AND LOWER(r.name) != 'general admin'

        ORDER BY r.id
        `,
        [identifierId]
    );

    return result.rows;
};

const getRolePermissions = async (roleId) => {
    const result = await pool.query(
        `
        SELECT
            ria.id,
            ria.role_id,
            ria.identifier_id,
            i.name,
            i.identifier,
            ria.operations
        FROM role_identifier_access ria

        INNER JOIN identifiers i
            ON i.id = ria.identifier_id

        WHERE ria.role_id = $1
          AND i.is_active = true
          AND i.is_deleted = false

        ORDER BY COALESCE(i.display_order, 999) ASC, i.id
        `,
        [roleId]
    );

    return result.rows;
};

const saveRolePermissions = async (
    roleId,
    identifierId,
    operations
) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        if (!Array.isArray(operations)) {
            throw new Error("Operations must be an array");
        }

        const roleResult = await client.query(
            `
            SELECT
                id,
                name
            FROM roles
            WHERE id = $1
              AND is_active = true
            `,
            [roleId]
        );

        if (roleResult.rows.length === 0) {
            throw new Error("Role not found");
        }

        if (
            roleResult.rows[0].name &&
            roleResult.rows[0].name.trim().toLowerCase() === "general admin"
        ) {
            throw new Error(
                "General Admin permissions cannot be modified"
            );
        }

        const identifierResult = await client.query(
            `
            SELECT
                id,
                identifier,
                operations
            FROM identifiers
            WHERE id = $1
              AND is_active = true
              AND is_deleted = false
            `,
            [identifierId]
        );

        if (identifierResult.rows.length === 0) {
            throw new Error("Identifier not found");
        }

        const allowedOperations =
            identifierResult.rows[0].operations || [];

        const validOperations = [
            ...new Set(
                operations.filter((operation) =>
                    allowedOperations.includes(operation)
                )
            ),
        ];

        await client.query(
            `
            INSERT INTO role_identifier_access (
                role_id,
                identifier_id,
                operations
            )
            VALUES ($1, $2, $3::jsonb)

            ON CONFLICT (role_id, identifier_id)
            DO UPDATE SET
                operations = EXCLUDED.operations
            `,
            [
                roleId,
                identifierId,
                JSON.stringify(validOperations),
            ]
        );

        await client.query("COMMIT");

const role = roleResult.rows[0];

const generalAdminResult = await pool.query(
    `
    SELECT id
    FROM admin
    WHERE role = 'general_admin'
      AND is_active = true
    LIMIT 1
    `
);

if (generalAdminResult.rows.length > 0) {
    await createAdminNotification(
        generalAdminResult.rows[0].id,
        "Role Permissions Updated",
        `${role.name} permissions have been updated.`,
        "role_permissions_updated",
    );
}

try {
    const roleUsers = await getRoleUsers(roleId);
    for (const u of roleUsers) {
        if (u.user_type === "employee") {
            await createEmployeeNotification(
                u.id,
                "Role Permissions Updated",
                `Permissions for your role (${role.name}) have been updated.`,
                "role_permissions_updated",
            );
        } else if (u.user_type === "admin") {
            await createAdminNotification(
                u.id,
                "Role Permissions Updated",
                `Permissions for your role (${role.name}) have been updated.`,
                "role_permissions_updated",
            );
        }
    }
} catch (e) {
    console.error("Role users notification error:", e);
}
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const createRole = async (name, access = []) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        if (!name || !name.trim()) {
            throw new Error("Role name is required");
        }

        if (!Array.isArray(access)) {
            throw new Error("Access must be an array");
        }

        const cleanName = name.trim();

        const roleResult = await client.query(
            `
            INSERT INTO roles (
                name,
                is_active
            )
            VALUES ($1, true)
            RETURNING id, name, is_active
            `,
            [cleanName]
        );

        const role = roleResult.rows[0];

        for (const item of access) {
            const identifierId = item.identifierId;

            if (!identifierId) {
                continue;
            }

            const identifierResult = await client.query(
                `
                SELECT
                    id,
                    operations
                FROM identifiers
                WHERE id = $1
                  AND is_active = true
                  AND is_deleted = false
                `,
                [identifierId]
            );

            if (identifierResult.rows.length === 0) {
                throw new Error(
                    `Identifier ${identifierId} not found`
                );
            }

            const allowedOperations =
                identifierResult.rows[0].operations || [];

            const operations = Array.isArray(item.operations)
                ? [
                      ...new Set(
                          item.operations.filter((operation) =>
                              allowedOperations.includes(operation)
                          )
                      ),
                  ]
                : [];

            await client.query(
                `
                INSERT INTO role_identifier_access (
                    role_id,
                    identifier_id,
                    operations
                )
                VALUES ($1, $2, $3::jsonb)

                ON CONFLICT (role_id, identifier_id)
                DO UPDATE SET
                    operations = EXCLUDED.operations
                `,
                [
                    role.id,
                    identifierId,
                    JSON.stringify(operations),
                ]
            );
        }

       await client.query("COMMIT");

const generalAdminResult = await pool.query(
    `
    SELECT id
    FROM admin
    WHERE role = 'general_admin'
      AND is_active = true
    LIMIT 1
    `
);

if (generalAdminResult.rows.length > 0) {
    await createAdminNotification(
        generalAdminResult.rows[0].id,
        "Role Created",
        `${role.name} role has been created.`,
        "role_created",
    );
}

return role;
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const getRoleById = async (roleId) => {
    const result = await pool.query(
        `
        SELECT
            id,
            name,
            is_active
        FROM roles
        WHERE id = $1
          AND is_active = true
        `,
        [roleId]
    );

    if (result.rows.length === 0) {
        return null;
    }

    return result.rows[0];
};

const updateRole = async (
    roleId,
    name,
    access = []
) => {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        if (!name || !name.trim()) {
            throw new Error("Role name is required");
        }

        if (!Array.isArray(access)) {
            throw new Error("Access must be an array");
        }

        const roleResult = await client.query(
            `
            SELECT
                id,
                name,
                is_active
            FROM roles
            WHERE id = $1
              AND is_active = true
            `,
            [roleId]
        );

        if (roleResult.rows.length === 0) {
            throw new Error("Role not found");
        }

        if (
            roleResult.rows[0].name &&
            roleResult.rows[0].name.trim().toLowerCase() === "general admin"
        ) {
            throw new Error(
                "General Admin role cannot be modified"
            );
        }

        const cleanName = name.trim();

        await client.query(
            `
            UPDATE roles
            SET name = $1
            WHERE id = $2
            `,
            [cleanName, roleId]
        );

        await client.query(
            `
            DELETE FROM role_identifier_access
            WHERE role_id = $1
            `,
            [roleId]
        );

        for (const item of access) {
            const identifierId = item.identifierId;

            if (!identifierId) {
                continue;
            }

            const identifierResult = await client.query(
                `
                SELECT
                    id,
                    operations
                FROM identifiers
                WHERE id = $1
                  AND is_active = true
                  AND is_deleted = false
                `,
                [identifierId]
            );

            if (identifierResult.rows.length === 0) {
                throw new Error(
                    `Identifier ${identifierId} not found`
                );
            }

            const allowedOperations =
                identifierResult.rows[0].operations && identifierResult.rows[0].operations.length > 0
                    ? identifierResult.rows[0].operations
                    : ["view", "create", "edit", "delete", "import", "export"];

            let operations = Array.isArray(item.operations)
                ? [
                      ...new Set(
                          item.operations.filter((operation) =>
                              allowedOperations.includes(operation)
                          )
                      ),
                  ]
                : [];

            if (operations.length === 0 && allowedOperations.length > 0) {
                operations = allowedOperations;
            }

            await client.query(
                `
                INSERT INTO role_identifier_access (
                    role_id,
                    identifier_id,
                    operations
                )
                VALUES ($1, $2, $3::jsonb)
                `,
                [
                    roleId,
                    identifierId,
                    JSON.stringify(operations),
                ]
            );
        }

        await client.query("COMMIT");

const generalAdminResult = await pool.query(
    `
    SELECT id
    FROM admin
    WHERE role = 'general_admin'
      AND is_active = true
    LIMIT 1
    `
);

if (generalAdminResult.rows.length > 0) {
    await createAdminNotification(
        generalAdminResult.rows[0].id,
        "Role Updated",
        `${cleanName} role and permissions have been updated.`,
        "role_updated",
    );
}

try {
    const roleUsers = await getRoleUsers(roleId);
    for (const u of roleUsers) {
        if (u.user_type === "employee") {
            await createEmployeeNotification(
                u.id,
                "Role Updated",
                `Your role (${cleanName}) and its permissions have been updated.`,
                "role_updated",
            );
        } else if (u.user_type === "admin") {
            await createAdminNotification(
                u.id,
                "Role Updated",
                `Your role (${cleanName}) and its permissions have been updated.`,
                "role_updated",
            );
        }
    }
} catch (e) {
    console.error("Role users notification error:", e);
}

return {
    id: roleResult.rows[0].id,
    name: cleanName,
    is_active: roleResult.rows[0].is_active,
};

    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

const deleteRole = async (roleId) => {
    const roleResult = await pool.query(
        `
        SELECT
            id,
            name
        FROM roles
        WHERE id = $1
          AND is_active = true
        `,
        [roleId]
    );

    if (roleResult.rows.length === 0) {
        throw new Error("Role not found");
    }

    if (
        roleResult.rows[0].name &&
        roleResult.rows[0].name.trim().toLowerCase() === "general admin"
    ) {
        throw new Error(
            "General Admin role cannot be deleted"
        );
    }

    const result = await pool.query(
        `
        UPDATE roles
        SET is_active = false
        WHERE id = $1
          AND is_active = true
        RETURNING id, name, is_active
        `,
        [roleId]
    );

    if (result.rows.length === 0) {
        throw new Error("Role not found");
    }

    const generalAdminResult = await pool.query(
    `
    SELECT id
    FROM admin
    WHERE role = 'general_admin'
      AND is_active = true
    LIMIT 1
    `
);

if (generalAdminResult.rows.length > 0) {
    await createAdminNotification(
        generalAdminResult.rows[0].id,
        "Role Deleted",
        `${result.rows[0].name} role has been deleted.`,
        "role_deleted",
    );
}

try {
    const roleUsers = await getRoleUsers(roleId);
    for (const u of roleUsers) {
        if (u.user_type === "employee") {
            await createEmployeeNotification(
                u.id,
                "Role Deleted",
                `The role (${result.rows[0].name}) assigned to you has been deactivated.`,
                "role_deleted",
            );
        } else if (u.user_type === "admin") {
            await createAdminNotification(
                u.id,
                "Role Deleted",
                `The role (${result.rows[0].name}) assigned to you has been deactivated.`,
                "role_deleted",
            );
        }
    }
} catch (e) {
    console.error("Role users notification error:", e);
}

return result.rows[0];
};


const getRoleUsers = async (roleId) => {
    const query = `
        SELECT id, name, email, role, is_active, created_at, 'admin' as user_type
        FROM admin
        WHERE role_id = $1
        UNION ALL
        SELECT id, name, email, role, is_active, created_at, 'employee' as user_type
        FROM register
        WHERE role_id = $1
        ORDER BY created_at DESC
    `;
    const result = await pool.query(query, [roleId]);
    return result.rows;
};

module.exports = {
    getAllMenusWithSubmenus,
    getAllPermissions,
    getSubmenuPermissions,
    getAllRoles,
    getRolesByMenuOrSubmenu,
    getRolePermissions,
    saveRolePermissions,
    createRole,
    getRoleById,
    updateRole,
    deleteRole,
    getRoleUsers,
};
