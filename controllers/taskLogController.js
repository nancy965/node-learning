
const { getTaskLogs } = require("../services/taskLogService");

const getTaskLogsController = async (req, res) => {
  try {
    const { id } = req.params;

    const logs = await getTaskLogs(
      id,
      req.user.userId,
      req.user.baseRole
    );

    return res.status(200).json({
      success: true,
      message: "Task logs fetched successfully",
      data: logs,
    });
  } catch (error) {
    console.error("GET TASK LOGS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch task logs",
    });
  }
};

module.exports = {
  getTaskLogsController,
};

