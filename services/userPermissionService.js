
const pool = require("../config/databse");
const {
    createAdminNotification,
    createEmployeeNotification,
} = require("./notificationService");

const getUserRoleInfo = async (userId) => {
    const result = await pool.query(
        `
        SELECT
            role,
            role_id
        FROM admin
        WHERE id = $1

        UNION ALL

        SELECT
            role,
            role_id
        FROM users
        WHERE id = $1

        LIMIT 1
        `,
        [userId]
    );

    if (result.rows.length === 0) {
        throw new Error("User not found");
    }

    return result.rows[0];
};

const getUserPermissions = async (userId) => {
    const userInfo = await getUserRoleInfo(userId);

    const result = await pool.query(
        `
        SELECT
            i.id AS identifier_id,
            i.name,
            i.identifier,
            operation.value AS operation,
            i.identifier || '.' || operation.value AS permission_identifier,

            COALESCE(
                uia.is_allowed,
                ria.operations ? operation.value,
                false
            ) AS is_allowed,

            COALESCE(
                ria.operations ? operation.value,
                false
            ) AS role_allowed,

            CASE
                WHEN uia.id IS NOT NULL THEN true
                ELSE false
            END AS is_overridden

        FROM identifiers i

        CROSS JOIN LATERAL jsonb_array_elements_text(
            i.operations
        ) AS operation(value)

        LEFT JOIN roles r
            ON r.id = $1
            AND r.is_active = true

        LEFT JOIN role_identifier_access ria
            ON ria.role_id = r.id
            AND ria.identifier_id = i.id

        LEFT JOIN user_identifier_access uia
            ON uia.user_id = $2
            AND uia.identifier_id = i.id
            AND uia.operation = operation.value

        WHERE i.is_active = true
          AND i.is_deleted = false

        ORDER BY
            i.id,
            operation.value
        `,
        [
            userInfo.role_id,
            userId,
        ]
    );

    return result.rows;
};

const getMyPermissions = async (userId) => {
    const userInfo = await getUserRoleInfo(userId);

    if (userInfo.role === "general_admin" || userInfo.role === "admin") {
        const result = await pool.query(
            `
            SELECT
                i.identifier || '.' || operation.value AS permission_identifier
            FROM identifiers i
            CROSS JOIN LATERAL jsonb_array_elements_text(i.operations) AS operation(value)
            WHERE i.is_active = true AND i.is_deleted = false
            `
        );
        return result.rows.map(row => row.permission_identifier);
    }

    const permissions = await getUserPermissions(userId);

    return permissions
        .filter((permission) => permission.is_allowed)
        .map(
            (permission) =>
                permission.permission_identifier
        );
};

const saveUserPermissions = async (
    userId,
    permissionIdentifiers
) => {
    if (!Array.isArray(permissionIdentifiers)) {
        throw new Error("Permissions must be an array");
    }

    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const roleResult = await client.query(
    `
    SELECT
        name,
        role,
        role_id
    FROM admin
    WHERE id = $1

    UNION ALL

    SELECT
        name,
        role,
        role_id
    FROM users
    WHERE id = $1

    LIMIT 1
    `,
    [userId]
);

        if (roleResult.rows.length === 0) {
            throw new Error("User not found");
        }

        const roleInfo = roleResult.rows[0];

        const identifierResult = await client.query(
            `
            SELECT
                i.id,
                i.identifier,
                operation.value AS operation
            FROM identifiers i

            CROSS JOIN LATERAL jsonb_array_elements_text(
                i.operations
            ) AS operation(value)

            WHERE i.is_active = true
              AND i.is_deleted = false
            `
        );

        const validPermissions = new Set();

        identifierResult.rows.forEach((row) => {
            validPermissions.add(
                `${row.identifier}.${row.operation}`
            );
        });

        const requestedPermissions = [
            ...new Set(permissionIdentifiers),
        ];

        const invalidPermissions =
            requestedPermissions.filter(
                (permission) =>
                    !validPermissions.has(permission)
            );

        if (invalidPermissions.length > 0) {
            throw new Error(
                `Invalid permission identifiers: ${invalidPermissions.join(", ")}`
            );
        }

        const rolePermissionsResult =
            await client.query(
                `
                SELECT
                    i.identifier,
                    operation.value AS operation
                FROM role_identifier_access ria

                INNER JOIN identifiers i
                    ON i.id = ria.identifier_id

                INNER JOIN roles r
                    ON r.id = ria.role_id

                CROSS JOIN LATERAL jsonb_array_elements_text(
                    ria.operations
                ) AS operation(value)

                WHERE r.id = $1
                  AND r.is_active = true
                  AND i.is_active = true
                  AND i.is_deleted = false
                `,
                [roleInfo.role_id]
            );

        const rolePermissions = new Set(
            rolePermissionsResult.rows.map(
                (row) =>
                    `${row.identifier}.${row.operation}`
            )
        );

        const requestedSet = new Set(
            requestedPermissions
        );

        await client.query(
            `
            DELETE FROM user_identifier_access
            WHERE user_id = $1
            `,
            [userId]
        );

        for (const row of identifierResult.rows) {
            const permissionIdentifier =
                `${row.identifier}.${row.operation}`;

            const roleAllowed =
                rolePermissions.has(
                    permissionIdentifier
                );

            const userRequested =
                requestedSet.has(
                    permissionIdentifier
                );

            if (roleAllowed === userRequested) {
                continue;
            }

            await client.query(
                `
                INSERT INTO user_identifier_access (
                    user_id,
                    identifier_id,
                    operation,
                    is_allowed
                )
                VALUES ($1, $2, $3, $4)
                `,
                [
                    userId,
                    row.id,
                    row.operation,
                    userRequested,
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
        "User Permissions Updated",
        `${roleInfo.name}'s permissions have been updated.`,
        "user_permissions_updated",
    );
}

if (roleInfo.role === "employee") {
    await createEmployeeNotification(
        userId,
        "Permissions Updated",
        "Your account permissions have been updated.",
        "user_permissions_updated",
    );
} else {
    await createAdminNotification(
        userId,
        "Permissions Updated",
        "Your account permissions have been updated.",
        "user_permissions_updated",
    );
}
    } catch (error) {
        await client.query("ROLLBACK");
        throw error;
    } finally {
        client.release();
    }
};

module.exports = {
    getUserPermissions,
    getMyPermissions,
    saveUserPermissions,
};

