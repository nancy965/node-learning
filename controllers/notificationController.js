const notificationService = require("../services/notificationService");
const {
  getManagementNotifications,
  getManagementRecipients,
  getManagementNotificationById,
  createManagementNotification,
  updateManagementNotification,
  deleteManagementNotification,
  sendManagementNotification,
} = require("../services/notificationService");

const getAdminNotifications = async (req, res) => {
  try {
    const result = await notificationService.getAdminNotifications(
      req.user.userId,
    );

    res.status(result.status).json(result);
  } catch (error) {
    console.error("GET ADMIN NOTIFICATIONS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get admin notifications",
    });
  }
};

const getEmployeeNotifications = async (req, res) => {
  try {
    const result = await notificationService.getEmployeeNotifications(
      req.user.userId,
    );

    res.status(result.status).json(result);
  } catch (error) {
    console.error("GET EMPLOYEE NOTIFICATIONS ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get employee notifications",
    });
  }
};

const getAdminNotificationById = async (req, res) => {
  try {
    const result = await notificationService.getAdminNotificationById(
      req.params.id,
      req.user.userId,
    );

    res.status(result.status).json(result);
  } catch (error) {
    console.error("GET ADMIN NOTIFICATION ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get admin notification",
    });
  }
};

const getEmployeeNotificationById = async (req, res) => {
  try {
    const result = await notificationService.getEmployeeNotificationById(
      req.params.id,
      req.user.userId,
    );

    res.status(result.status).json(result);
  } catch (error) {
    console.error("GET EMPLOYEE NOTIFICATION ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to get employee notification",
    });
  }
};

const markAllAdminNotificationsAsRead = async (req, res) => {
  try {
    const result = await notificationService.markAllAdminNotificationsAsRead(
      req.user.userId,
    );

    res.status(result.status).json(result);
  } catch (error) {
    console.error("MARK ALL ADMIN NOTIFICATIONS AS READ ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to mark all admin notifications as read",
      error: error.message,
    });
  }
};

const markAllEmployeeNotificationsAsRead = async (req, res) => {
  try {
    const result = await notificationService.markAllEmployeeNotificationsAsRead(
      req.user.userId,
    );

    res.status(result.status).json(result);
  } catch (error) {
    console.error("MARK ALL EMPLOYEE NOTIFICATIONS AS READ ERROR:", error);

    res.status(500).json({
      success: false,
      message: "Failed to mark all employee notifications as read",
      error: error.message,
    });
  }
};

const listManagementNotifications = async (req, res) => {
  try {
    const page = req.query.page;
    const limit = req.query.limit;
    const search = req.query.search;
    const status = req.query.status;
    const type = req.query.type;

    const result = await getManagementNotifications({
      page,
      limit,
      search,
      status,
      type,
    });

    if (result && Array.isArray(result.notifications)) {
      return res.status(200).json({
        success: true,
        message: "Notifications fetched successfully",
        data: result.notifications,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notifications fetched successfully",
      data: result,
    });
  } catch (error) {
    console.error("List notifications error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch notifications",
    });
  }
};

const listManagementRecipients = async (req, res) => {
  try {
    const data = await getManagementRecipients();

    return res.status(200).json({
      success: true,
      message: "Recipients fetched successfully",
      data,
    });
  } catch (error) {
    console.error("Fetch notification recipients error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch notification recipients",
    });
  }
};

const getManagementNotification = async (req, res) => {
  try {
    const id = req.params.id;

    if (!id || String(id).trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const data = await getManagementNotificationById(id);

    if (!data) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification fetched successfully",
      data,
    });
  } catch (error) {
    console.error("Get notification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch notification",
    });
  }
};

const createManagementNotificationController = async (req, res) => {
  try {
    const data = await createManagementNotification(req.body, req.user.userId);

    return res.status(201).json({
      success: true,
      message: "Notification created successfully",
      data,
    });
  } catch (error) {
    console.error("Create notification error:", error.message);

    const status = error.statusCode || 400;

    return res.status(status).json({
      success: false,
      message: error.message || "Failed to create notification",
    });
  }
};

const updateManagementNotificationController = async (req, res) => {
  try {
    const id = req.params.id;

    if (!id || String(id).trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const existing = await getManagementNotificationById(id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    const data = await updateManagementNotification(id, req.body);

    return res.status(200).json({
      success: true,
      message: "Notification updated successfully",
      data,
    });
  } catch (error) {
    console.error("Update notification error:", error.message);

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to update notification",
    });
  }
};

const deleteManagementNotificationController = async (req, res) => {
  try {
    const id = req.params.id;

    if (!id || String(id).trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const deleted = await deleteManagementNotification(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: "Notification not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification deleted successfully",
    });
  } catch (error) {
    console.error("Delete notification error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to delete notification",
    });
  }
};

const sendManagementNotificationController = async (req, res) => {
  try {
    const id = req.params.id;

    if (!id || String(id).trim() === "") {
      return res.status(400).json({
        success: false,
        message: "Invalid notification ID",
      });
    }

    const result = await sendManagementNotification(id);

    return res.status(200).json({
      success: true,
      message: "Notification sent successfully",
      data: result,
    });
  } catch (error) {
    console.error("Send notification error:", error.message);

    return res.status(error.statusCode || 400).json({
      success: false,
      message: error.message || "Failed to send notification",
    });
  }
};

module.exports = {
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
};
