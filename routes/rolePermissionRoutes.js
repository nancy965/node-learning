const express = require("express");

const router = express.Router();

const authenticateToken = require("../middleware/authMiddleware");

const {
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
} = require("../controllers/rolePermissionController");

router.get(
    "/simulator/meta",
    authenticateToken,
    getSimulatorMetaController
);

router.post(
    "/simulator/simulate",
    authenticateToken,
    simulatePermissionController
);

router.get(
    "/menus",
    authenticateToken,
    getAllMenusWithSubmenusController
);

router.get(
    "/permissions",
    authenticateToken,
    getAllPermissionsController
);

router.get(
    "/submenu-permissions/:submenuId",
    authenticateToken,
    getSubmenuPermissionsController
);

router.get(
    "/roles",
    authenticateToken,
    getAllRolesController
);

router.get(
    "/roles-by-access/:identifierId",
    authenticateToken,
    getRolesByMenuOrSubmenuController
);

router.get(
    "/roles/:roleId/permissions",
    authenticateToken,
    getRolePermissionsController
);

router.put(
    "/roles/:roleId/permissions",
    authenticateToken,
    saveRolePermissionsController
);

router.post(
    "/roles",
    authenticateToken,
    createRoleController
);

router.get(
    "/roles/:roleId",
    authenticateToken,
    getRoleByIdController
);

router.put(
    "/roles/:roleId",
    authenticateToken,
    updateRoleController
);

router.delete(
    "/roles/:roleId",
    authenticateToken,
    deleteRoleController
);

router.get(
    "/roles/:roleId/users",
    authenticateToken,
    getRoleUsersController
);

module.exports = router;
