const {
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
} = require("../services/rolePermissionService");

const getAllMenusWithSubmenusController = async (req, res) => {
    try {
        const menus = await getAllMenusWithSubmenus();

        return res.status(200).json({
            success: true,
            data: menus
        });
    } catch (error) {
        console.error("Get all menus error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to get menus"
        });
    }
};

const getAllPermissionsController = async (req, res) => {
    try {
        const permissions = await getAllPermissions();

        return res.status(200).json({
            success: true,
            data: permissions
        });
    } catch (error) {
        console.error("Get all permissions error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to get permissions"
        });
    }
};

const getSubmenuPermissionsController = async (req, res) => {
    try {
        const { submenuId } = req.params;

        if (!submenuId) {
            return res.status(400).json({
                success: false,
                message: "submenuId is required"
            });
        }

        const permissions = await getSubmenuPermissions(submenuId);

        return res.status(200).json({
            success: true,
            data: permissions
        });
    } catch (error) {
        console.error("Get submenu permissions error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to get submenu permissions"
        });
    }
};

const getAllRolesController = async (req, res) => {
    try {
        const page = req.query.page ? parseInt(req.query.page, 10) : null;
        const limit = req.query.limit ? parseInt(req.query.limit, 10) : null;
        const search = req.query.search || "";

        const result = await getAllRoles({ page, limit, search });

        if (result && result.pagination) {
            return res.status(200).json({
                success: true,
                data: result.roles,
                pagination: result.pagination
            });
        }

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (error) {
        console.error("Get all roles error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to get roles"
        });
    }
};

const getRolesByMenuOrSubmenuController = async (req, res) => {
    try {
        const { identifierId } = req.query;

        if (!identifierId) {
            return res.status(400).json({
                success: false,
                message: "identifierId is required"
            });
        }

        const roles = await getRolesByMenuOrSubmenu(identifierId);

        return res.status(200).json({
            success: true,
            data: roles
        });
    } catch (error) {
        console.error("Get roles by identifier error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to get roles"
        });
    }
};

const getRolePermissionsController = async (req, res) => {
    try {
        const { roleId } = req.params;

        if (!roleId) {
            return res.status(400).json({
                success: false,
                message: "roleId is required"
            });
        }

        const permissions = await getRolePermissions(roleId);

        return res.status(200).json({
            success: true,
            data: permissions
        });
    } catch (error) {
        console.error("Get role permissions error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to get role permissions"
        });
    }
};

const saveRolePermissionsController = async (req, res) => {
    try {
        const { roleId } = req.params;
        const { identifierId, operations } = req.body;

        if (!roleId) {
            return res.status(400).json({
                success: false,
                message: "roleId is required"
            });
        }

        if (!identifierId) {
            return res.status(400).json({
                success: false,
                message: "identifierId is required"
            });
        }

        if (!Array.isArray(operations)) {
            return res.status(400).json({
                success: false,
                message: "operations must be an array"
            });
        }

        await saveRolePermissions(
            roleId,
            identifierId,
            operations
        );

        return res.status(200).json({
            success: true,
            message: "Role permissions updated successfully"
        });
    } catch (error) {
        console.error("Save role permissions error:", error);

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Failed to update role permissions"
        });
    }
};

const createRoleController = async (req, res) => {
    try {
        const { name, access } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Role name is required"
            });
        }

        if (!Array.isArray(access)) {
            return res.status(400).json({
                success: false,
                message: "Access must be an array"
            });
        }

        const role = await createRole(name, access);

        return res.status(201).json({
            success: true,
            message: "Role created successfully",
            data: role
        });
    } catch (error) {
        console.error("Create role error:", error);

        if (error.code === "23505" || error.message?.includes("roles_name_key")) {
            return res.status(400).json({
                success: false,
                message: "A role with this name already exists. Please choose a different name."
            });
        }

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Failed to create role"
        });
    }
};

const getRoleByIdController = async (req, res) => {
    try {
        const { roleId } = req.params;

        if (!roleId) {
            return res.status(400).json({
                success: false,
                message: "roleId is required",
            });
        }

        const role = await getRoleById(roleId);

        if (!role) {
            return res.status(404).json({
                success: false,
                message: "Role not found",
            });
        }

        const permissions = await getRolePermissions(roleId);

        return res.status(200).json({
            success: true,
            data: {
                role,
                permissions,
            },
        });
    } catch (error) {
        console.error("Get role error:", error);

        return res.status(500).json({
            success: false,
            message: "Failed to get role",
        });
    }
};

const updateRoleController = async (req, res) => {
    try {
        const { roleId } = req.params;
        const { name, access } = req.body;

        if (!roleId) {
            return res.status(400).json({
                success: false,
                message: "roleId is required",
            });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Role name is required",
            });
        }

        if (!Array.isArray(access)) {
            return res.status(400).json({
                success: false,
                message: "Access must be an array",
            });
        }

        const role = await updateRole(
            roleId,
            name,
            access
        );


        return res.status(200).json({
            success: true,
            message: "Role updated successfully",
            data: role,
        });
    } catch (error) {
        console.error("Update role error:", error);

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Failed to update role",
        });
    }
};

const deleteRoleController = async (req, res) => {
    try {
        const { roleId } = req.params;

        if (!roleId) {
            return res.status(400).json({
                success: false,
                message: "roleId is required",
            });
        }

        const role = await deleteRole(roleId);

        return res.status(200).json({
            success: true,
            message: "Role deleted successfully",
            data: role,
        });
    } catch (error) {
        console.error("Delete role error:", error);

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Failed to delete role",
        });
    }
};

const getRoleUsersController = async (req, res) => {
    try {
        const { roleId } = req.params;
        if (!roleId) {
            return res.status(400).json({ success: false, message: "roleId is required" });
        }
        const users = await getRoleUsers(roleId);
        res.status(200).json({ success: true, data: users });
    } catch (error) {
        console.error("Get role users error:", error);
        res.status(500).json({ success: false, message: error.message || "Failed to fetch users for role" });
    }
};

const {
    getSimulatorMeta,
    simulatePermission,
} = require("../services/permissionSimulatorService");

const getSimulatorMetaController = async (req, res) => {
    try {
        const meta = await getSimulatorMeta();
        return res.status(200).json({
            success: true,
            data: meta,
        });
    } catch (error) {
        console.error("Get simulator meta error:", error);
        return res.status(500).json({
            success: false,
            message: error.message || "Failed to load simulator metadata",
        });
    }
};

const simulatePermissionController = async (req, res) => {
    try {
        const { targetType, userId, roleId, identifier, operation } = req.body;
        const result = await simulatePermission({
            targetType,
            userId,
            roleId,
            identifier,
            operation,
        });
        return res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error("Simulate permission error:", error);
        return res.status(400).json({
            success: false,
            message: error.message || "Failed to simulate permission",
        });
    }
};

module.exports = {
    getAllMenusWithSubmenusController,
    getAllPermissionsController,
    getSubmenuPermissionsController,
    getAllRolesController,
    getRolesByMenuOrSubmenuController,
    getRolePermissionsController,
    saveRolePermissionsController,
    createRoleController,
    getRoleByIdController,
    updateRoleController,
    deleteRoleController,
    getRoleUsersController,
    getSimulatorMetaController,
    simulatePermissionController,
};