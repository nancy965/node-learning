const {
    getUserPermissions,
    getMyPermissions,
    saveUserPermissions,
} = require("../services/userPermissionService");

const getUserPermissionsController = async (req, res) => {
    try {
        const { userId } = req.params;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId is required",
            });
        }

        const permissions =
            await getUserPermissions(userId);

        return res.status(200).json({
            success: true,
            data: permissions,
        });
    } catch (error) {
        console.error(
            "Get user permissions error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Failed to get user permissions",
        });
    }
};

const getMyPermissionsController = async (req, res) => {
    try {
        const permissions =
            await getMyPermissions(req.user.userId);

        return res.status(200).json({
            success: true,
            data: permissions,
        });
    } catch (error) {
        console.error(
            "Get my permissions error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Failed to get permissions",
        });
    }
};

const saveUserPermissionsController = async (
    req,
    res
) => {
    try {
        const { userId } = req.params;
        const { permissions } = req.body;

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "userId is required",
            });
        }

        if (!Array.isArray(permissions)) {
            return res.status(400).json({
                success: false,
                message:
                    "permissions must be an array",
            });
        }

        await saveUserPermissions(
            userId,
            permissions
        );

        return res.status(200).json({
            success: true,
            message:
                "User permissions updated successfully",
        });
    } catch (error) {
        console.error(
            "Save user permissions error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                error.message ||
                "Failed to update user permissions",
        });
    }
};

module.exports = {
    getUserPermissionsController,
    getMyPermissionsController,
    saveUserPermissionsController,
};