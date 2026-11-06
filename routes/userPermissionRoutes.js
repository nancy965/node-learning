const express = require("express");

const router = express.Router();

const PATHS = require("../config/path.config");

const authenticateToken = require("../middleware/authMiddleware");

const checkPermission = require("../middleware/permissionMiddleware");

const {
    getUserPermissionsController,
    getMyPermissionsController,
    saveUserPermissionsController,
} = require("../controllers/userPermissionController");

router.get(
    PATHS.USER_PERMISSIONS.MY_PERMISSIONS,
    authenticateToken,
    getMyPermissionsController
);

router.get(
    PATHS.USER_PERMISSIONS.GET_BY_USER_ID,
    authenticateToken,
    checkPermission("users.view"),
    getUserPermissionsController
);

router.put(
    PATHS.USER_PERMISSIONS.UPDATE_BY_USER_ID,
    authenticateToken,
    checkPermission("users.edit"),
    saveUserPermissionsController
);

module.exports = router;