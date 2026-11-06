
const activityLogService = require("../services/activityLogService");

// Get all activity logs
const getActivityLogs = async (req, res, next) => {
  try {
    const logs = await activityLogService.getActivityLogs(
      req.user.userId,
      req.user.role
    );

    res.status(200).json({
      success: true,
      message: "Activity logs fetched successfully",
      data: logs,
    });
  } catch (error) {
    next(error);
  }
};

// Get activity history for a selected user
const getUserActivityHistory = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;

    if (!targetUserId || String(targetUserId).trim() === "") {
      return res.status(400).json({
        success: false,
        message: "A valid user ID is required",
      });
    }

    const requesterId = req.user.userId;
    const role = req.user.baseRole || req.user.role;

    const logs = await activityLogService.getUserActivityHistory(
      targetUserId,
      requesterId,
      role
    );

    res.status(200).json({
      success: true,
      message: "User activity history fetched successfully",
      data: logs,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getActivityLogs,
  getUserActivityHistory,
};