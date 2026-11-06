const pool = require("../config/databse");

const getNavigationByRole = async (role, userId) => {
    let roleId = null;

    if (userId) {
        const userInfoResult = await pool.query(
            `
            SELECT role_id
            FROM admin
            WHERE id = $1

            UNION ALL

            SELECT role_id
            FROM users
            WHERE id = $1

            LIMIT 1
            `,
            [userId]
        );

        if (userInfoResult.rows.length > 0) {
            roleId = userInfoResult.rows[0].role_id;
        }
    }

    let result;

    let isGA = role === "general_admin" || role === "super_admin";
    if (!isGA && userId) {
        const gaCheck = await pool.query(
            "SELECT role FROM admin WHERE id = $1 AND role = 'general_admin' LIMIT 1",
            [userId]
        );
        if (gaCheck.rows.length > 0) isGA = true;
    }
    if (!isGA && roleId) {
        const rCheck = await pool.query("SELECT name FROM roles WHERE id = $1 LIMIT 1", [roleId]);
        if (rCheck.rows.length > 0 && rCheck.rows[0].name.trim().toLowerCase() === "general admin") {
            isGA = true;
        }
    }

    if (isGA || (role === "admin" && !roleId)) {
        result = await pool.query(
            `
            SELECT
                id,
                name,
                identifier,
                row_level,
                parent_id,
                display_order
            FROM identifiers
            WHERE is_active = true
              AND is_deleted = false
            ORDER BY
                row_level,
                parent_id NULLS FIRST,
                display_order ASC,
                name ASC
            `
        );
    } else {
        if (!roleId && role === "employee") {
            const defaultRoleResult = await pool.query(`SELECT id FROM roles WHERE name = 'Employee' LIMIT 1`);
            if (defaultRoleResult.rows.length > 0) {
                roleId = defaultRoleResult.rows[0].id;
            }
        }

        if (!roleId) {
            return [];
        }

        result = await pool.query(
            `
            SELECT
                i.id,
                i.name,
                i.identifier,
                i.row_level,
                i.parent_id,
                i.display_order
            FROM identifiers i
            INNER JOIN role_identifier_access ria
                ON ria.identifier_id = i.id
                AND ria.role_id = $1
            WHERE i.is_active = true
              AND i.is_deleted = false
            GROUP BY
                i.id,
                i.name,
                i.identifier,
                i.row_level,
                i.parent_id,
                i.display_order
            ORDER BY
                i.row_level,
                i.parent_id NULLS FIRST,
                i.display_order ASC,
                i.name ASC
            `,
            [roleId]
        );
    }

    const navigation = [];

    const menus = result.rows
        .filter((item) => item.row_level === 0)
        .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0));

    for (const menu of menus) {
        const submenus = result.rows
            .filter(
                (item) =>
                    item.row_level === 1 &&
                    item.parent_id === menu.id
            )
            .sort((a, b) => (a.display_order ?? 0) - (b.display_order ?? 0))
            .map((submenu) => ({
                id: submenu.id,
                name: submenu.name,
                identifier: submenu.identifier,
                display_order: submenu.display_order,
            }));

        // Check if this menu is a parent container with submenus defined in the system
        const childCountResult = await pool.query(
            `SELECT COUNT(*) FROM identifiers WHERE parent_id = $1 AND is_active = true AND is_deleted = false`,
            [menu.id]
        );
        const hasChildrenInSystem = parseInt(childCountResult.rows[0].count, 10) > 0;

        // If it's a parent container with no allowed submenus for this role, don't show the empty container
        if (hasChildrenInSystem && submenus.length === 0) {
            continue;
        }

        navigation.push({
            id: menu.id,
            name: menu.name,
            identifier: menu.identifier,
            display_order: menu.display_order,
            submenus: submenus,
        });
    }

    return navigation;
};

module.exports = {
    getNavigationByRole,
};