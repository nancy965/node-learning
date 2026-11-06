const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const {
  getAdminNotifications,
  getEmployeeNotifications,
  getAdminNotificationById,
  getEmployeeNotificationById,
  markAllAdminNotificationsAsRead,
  markAllEmployeeNotificationsAsRead,
  listManagementNotifications,
  listManagementRecipients,
  getManagementNotification,
  createManagementNotificationController,
  updateManagementNotificationController,
  deleteManagementNotificationController,
  sendManagementNotificationController,
} = require("../controllers/notificationController");

const authMiddleware = require("../middleware/authMiddleware");
const requireNotificationPermission = require("../middleware/notificationPermissionMiddleware");

// Existing notification center routes
router.get(PATHS.NOTIFICATIONS.ADMIN, authMiddleware, getAdminNotifications);
router.get(PATHS.NOTIFICATIONS.ADMIN_BY_ID, authMiddleware, getAdminNotificationById);
router.get(PATHS.NOTIFICATIONS.EMPLOYEE, authMiddleware, getEmployeeNotifications);
router.get(PATHS.NOTIFICATIONS.EMPLOYEE_BY_ID, authMiddleware, getEmployeeNotificationById);
router.patch(PATHS.NOTIFICATIONS.MARK_ALL_ADMIN_READ, authMiddleware, markAllAdminNotificationsAsRead);
router.patch(PATHS.NOTIFICATIONS.MARK_ALL_EMPLOYEE_READ, authMiddleware, markAllEmployeeNotificationsAsRead);

// Notification management routes
router.get(
  PATHS.NOTIFICATIONS.MANAGEMENT_RECIPIENTS,
  authMiddleware,
  requireNotificationPermission("view"),
  listManagementRecipients,
);

router.get(
  PATHS.NOTIFICATIONS.MANAGEMENT,
  authMiddleware,
  requireNotificationPermission("view"),
  listManagementNotifications,
);

router.post(
  PATHS.NOTIFICATIONS.MANAGEMENT,
  authMiddleware,
  requireNotificationPermission("create"),
  createManagementNotificationController,
);

router.get(
  PATHS.NOTIFICATIONS.MANAGEMENT_BY_ID,
  authMiddleware,
  requireNotificationPermission("view"),
  getManagementNotification,
);

router.put(
  PATHS.NOTIFICATIONS.MANAGEMENT_BY_ID,
  authMiddleware,
  requireNotificationPermission("edit"),
  updateManagementNotificationController,
);

router.delete(
  PATHS.NOTIFICATIONS.MANAGEMENT_BY_ID,
  authMiddleware,
  requireNotificationPermission("delete"),
  deleteManagementNotificationController,
);

router.post(
  PATHS.NOTIFICATIONS.MANAGEMENT_SEND,
  authMiddleware,
  requireNotificationPermission("send"),
  sendManagementNotificationController,
);

module.exports = router;
