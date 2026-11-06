const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const {
  getUsers,
  getUserById,
  addUser,
  bulkAddUsers,
  updateUser,
  deleteUser,
  getAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
} = require("../controllers/userController");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");
const upload = require("../middleware/uploadMiddleware");

router.get(
  PATHS.USERS.GET_ALL_USERS,
  authenticateToken,
  checkPermission("users.view"),
  getUsers
);

router.get(
  PATHS.USERS.GET_USER_BY_ID,
  authenticateToken,
  checkPermission("users.view"),
  getUserById
);

router.get(
  "/check-edit-permission",
  authenticateToken,
  checkPermission("users.edit"),
  (req, res) => res.status(200).json({ hasAccess: true })
);

router.post(
  PATHS.USERS.CREATE_USER,
  authenticateToken,
  checkPermission("users.create"),
  addUser
);

router.post(
  PATHS.USERS.BULK_IMPORT_USERS,
  authenticateToken,
  checkPermission("users.import"),
  upload.single("file"),
  bulkAddUsers
);

router.put(
  PATHS.USERS.UPDATE_USER,
  authenticateToken,
  checkPermission("users.edit"),
  updateUser
);

router.delete(
  PATHS.USERS.DELETE_USER,
  authenticateToken,
  checkPermission("users.delete"),
  deleteUser
);

router.get(
  PATHS.USERS.GET_ALL_ADMINS,
  authenticateToken,
  checkPermission("admins.view"),
  getAdmins
);

router.get(
  PATHS.USERS.GET_ADMIN_BY_ID,
  authenticateToken,
  checkPermission("admins.view"),
  getAdminById
);

router.put(
  PATHS.USERS.UPDATE_ADMIN,
  authenticateToken,
  checkPermission("admins.edit"),
  updateAdmin
);

router.delete(
  PATHS.USERS.DELETE_ADMIN,
  authenticateToken,
  checkPermission("admins.delete"),
  deleteAdmin
);

module.exports = router;