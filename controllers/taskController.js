const {
  createTask,
  getEmployeesForTask,
  getTasks,
  getTaskById,
  getMyTasks,
  deleteTask,
  updateTask,
  startTask,
  endTask,
} = require("../services/taskService");

const {
  startTaskSession,
  endTaskSession,
  pauseTaskSession,
  resumeTaskSession,
  getActiveTaskSession,
  getTaskSessionHistory,
} = require("../services/taskTimeEntryService");

const {
  getTaskDependencies,
  setTaskDependencies,
  getCriticalPathData,
} = require("../services/taskDependencyService");

const pool = require("../config/databse");

// Validate task frequency against common_master with fallback
const validateTaskFrequency = async (frequency) => {
  if (!frequency) return false;
  const cleanFreq = String(frequency).trim().toLowerCase();
  try {
    const res = await pool.query(
      `SELECT id FROM common_master WHERE LOWER(type) = 'task_frequency' AND LOWER(name) = $1 AND is_active = true LIMIT 1`,
      [cleanFreq]
    );
    if (res.rows.length > 0) return true;
  } catch (err) {
    console.error("Error validating frequency against common_master:", err);
  }
  const defaultFreqs = ["daily", "one-time"];
  return defaultFreqs.includes(cleanFreq);
};

// Validate task dates
const validateTaskDates = (taskDate, dueDate, frequency) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const taskDateValue = new Date(taskDate);
  const dueDateValue = new Date(dueDate);

  taskDateValue.setHours(0, 0, 0, 0);
  dueDateValue.setHours(0, 0, 0, 0);

  if (Number.isNaN(taskDateValue.getTime())) {
    return {
      valid: false,
      message: "Invalid task date",
    };
  }

  if (Number.isNaN(dueDateValue.getTime())) {
    return {
      valid: false,
      message: "Invalid due date",
    };
  }

  if (taskDateValue < today) {
    return {
      valid: false,
      message: "Task date cannot be in the past",
    };
  }

  if (frequency === "daily") {
    if (dueDateValue < taskDateValue) {
      return {
        valid: false,
        message: "Due date cannot be before task date",
      };
    }
  } else {
    if (dueDateValue <= today) {
      return {
        valid: false,
        message: "Due date must be a future date",
      };
    }

    if (dueDateValue <= taskDateValue) {
      return {
        valid: false,
        message: "Due date must be after task date",
      };
    }
  }

  return {
    valid: true,
  };
};

// Create task
const addTask = async (req, res) => {
  try {
    const {
      taskName,
      taskDate,
      dueDate,
      isActive,
      taskType,
      assignedTo,
      frequency,
      dependsOnTaskIds,
      dependencyIds,
    } = req.body;

    const taskDependencies = dependsOnTaskIds || dependencyIds || [];

    if (!taskName || !taskDate || !dueDate || !taskType || !assignedTo) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled",
      });
    }

    const assignedEmployees = Array.isArray(assignedTo)
      ? assignedTo
      : [assignedTo];

    if (assignedEmployees.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Please select at least one employee",
      });
    }

    const isValidFrequency = await validateTaskFrequency(frequency);
    if (!isValidFrequency) {
      return res.status(400).json({
        success: false,
        message: "Invalid task frequency",
      });
    }

    const dateValidation = validateTaskDates(taskDate, dueDate, frequency);

    if (!dateValidation.valid) {
      return res.status(400).json({
        success: false,
        message: dateValidation.message,
      });
    }

    const assignedBy = req.user.userId;
    const role = req.user.baseRole;

    const result = await createTask(
      taskName,
      taskDate,
      dueDate,
      isActive,
      taskType,
      assignedEmployees,
      assignedBy,
      role,
      frequency,
      taskDependencies,
    );

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("CREATE TASK ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

// Get employees
const getTaskEmployees = async (req, res) => {
  try {
    const adminId = req.user.userId;
    const role = req.user.baseRole;

    const result = await getEmployeesForTask(adminId, role);

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("GET TASK EMPLOYEES ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

const getTaskList = async (req, res) => {
  try {
    const userId = req.user.userId;
    const role = req.user.baseRole || req.user.role;

    const page = Math.max(parseInt(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 100);

    const status = req.query.status || "";
    const employeeId = req.query.employeeId || "";
    const taskType = req.query.taskType || "";
    const search = req.query.search || "";
    const dateRange = req.query.dateRange || "";
    const customFrom = req.query.customFrom || "";
    const customTo = req.query.customTo || "";

    const result = await getTasks(
      userId,
      role,
      page,
      limit,
      status,
      employeeId,
      taskType,
      search,
      dateRange,
      customFrom,
      customTo,
    );

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("Get task list error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch tasks",
    });
  }
};

// Find task by ID
const getTaskByIdController = async (req, res) => {
  try {
    const taskId = req.params.id;
    const userId = req.user.userId;
    const role = req.user.baseRole || req.user.role;

    const result = await getTaskById(taskId, userId, role);

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("GET TASK BY ID ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

// Find employee's tasks
const getMyTaskList = async (req, res) => {
  try {
    const employeeId = req.user.userId;

    const page = Math.max(parseInt(req.query.page) || 1, 1);

    const limit = Math.min(Math.max(parseInt(req.query.limit) || 5, 1), 100);

    const search = req.query.search || "";
    const status = req.query.status || "";

    const result = await getMyTasks(employeeId, page, limit, search, status);

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("GET MY TASKS ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

// Start task
const startTaskById = async (req, res) => {
  try {
    const taskId = req.params.id;
    const employeeId = req.user.userId;

    const result = await startTask(taskId, employeeId);

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("START TASK ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

// End task
const endTaskById = async (req, res) => {
  try {
    const taskId = req.params.id;
    const employeeId = req.user.userId;

    const result = await endTask(taskId, employeeId);

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("END TASK ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

// Delete task
const deleteTaskById = async (req, res) => {
  try {
    const taskId = req.params.id;
    const userId = req.user.userId;
    const role = req.user.baseRole || req.user.role;

    const result = await deleteTask(taskId, userId, role);

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("DELETE TASK ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

// Update task
const updateTaskById = async (req, res) => {
  try {
    const taskId = req.params.id;

    const {
      taskName,
      taskDate,
      dueDate,
      isActive,
      taskType,
      assignedTo,
      dependsOnTaskIds,
      dependencyIds,
    } = req.body;

    const taskDependencies =
      dependsOnTaskIds !== undefined
        ? dependsOnTaskIds
        : dependencyIds !== undefined
        ? dependencyIds
        : undefined;

    if (!taskName || !taskDate || !dueDate || !taskType || !assignedTo) {
      return res.status(400).json({
        success: false,
        message: "All required fields must be filled",
      });
    }

    const dateValidation = validateTaskDates(taskDate, dueDate, "one-time");

    if (!dateValidation.valid) {
      return res.status(400).json({
        success: false,
        message: dateValidation.message,
      });
    }

    const userId = req.user.userId;
    const role = req.user.baseRole || req.user.role;

    const result = await updateTask(
      taskId,
      taskName,
      taskDate,
      dueDate,
      isActive,
      taskType,
      assignedTo,
      userId,
      role,
      taskDependencies,
    );

    return res.status(result.status).json(result);
  } catch (error) {
    console.error("UPDATE TASK ERROR:", error);

    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

const startTrackingSession = async (req, res) => {
  try {
    const { taskId } = req.params;
    const userId = req.user.userId;

    const session = await startTaskSession(taskId, userId);

    return res.status(201).json({
      success: true,
      message: "Tracking session started successfully.",
      data: session,
    });
  } catch (error) {
    console.error("Start tracking session error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to start tracking session.",
      ...(error.activeSession ? { activeSession: error.activeSession } : {}),
    });
  }
};

const endTrackingSession = async (req, res) => {
  try {
    const { taskId, sessionId } = req.params;
    const { workSummary } = req.body;
    const userId = req.user.userId;

    const session = await endTaskSession(
      taskId,
      userId,
      sessionId,
      workSummary,
    );

    return res.status(200).json({
      success: true,
      message: "Tracking session saved successfully.",
      data: session,
    });
  } catch (error) {
    console.error("End tracking session error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to end tracking session.",
    });
  }
};

const pauseTrackingSession = async (req, res) => {
  try {
    const { taskId, sessionId } = req.params;
    const userId = req.user.userId;

    const session = await pauseTaskSession(taskId, userId, sessionId);

    return res.status(200).json({
      success: true,
      message: "Tracking session paused successfully.",
      data: session,
    });
  } catch (error) {
    console.error("Pause tracking session error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to pause tracking session.",
    });
  }
};

const resumeTrackingSession = async (req, res) => {
  try {
    const { taskId, sessionId } = req.params;
    const userId = req.user.userId;

    const session = await resumeTaskSession(taskId, userId, sessionId);

    return res.status(200).json({
      success: true,
      message: "Tracking session resumed successfully.",
      data: session,
    });
  } catch (error) {
    console.error("Resume tracking session error:", error);

    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to resume tracking session.",
    });
  }
};

const getActiveTrackingSession = async (req, res) => {
  try {
    const session = await getActiveTaskSession(req.user.userId);

    return res.status(200).json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Get active tracking session error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve the active tracking session.",
    });
  }
};

const getTrackingSessionHistory = async (req, res) => {
  try {
    const { taskId } = req.params;
    const session = await getTaskSessionHistory(taskId, req.user.userId);

    return res.status(200).json({
      success: true,
      data: session,
    });
  } catch (error) {
    console.error("Get tracking session history error:", error);

    return res.status(500).json({
      success: false,
      message: "Failed to retrieve tracking session history.",
    });
  }
};

const getTaskDependenciesController = async (req, res) => {
  try {
    const { id } = req.params;
    const data = await getTaskDependencies(id);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("GET TASK DEPENDENCIES ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Server Error",
    });
  }
};

const setTaskDependenciesController = async (req, res) => {
  try {
    const { id } = req.params;
    const dependsOn = req.body.dependsOnTaskIds || req.body.dependencyIds || [];
    const data = await setTaskDependencies(id, dependsOn);
    return res.status(200).json({
      success: true,
      message: "Task dependencies updated successfully",
      data,
    });
  } catch (error) {
    console.error("SET TASK DEPENDENCIES ERROR:", error);
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Server Error",
    });
  }
};

const getCriticalPathController = async (req, res) => {
  try {
    const data = await getCriticalPathData(req.query);
    return res.status(200).json({
      success: true,
      data,
    });
  } catch (error) {
    console.error("GET CRITICAL PATH ERROR:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to calculate critical path",
    });
  }
};

module.exports = {
  addTask,
  getTaskEmployees,
  getTaskList,
  getTaskByIdController,
  getMyTaskList,
  deleteTaskById,
  updateTaskById,
  startTaskById,
  endTaskById,
  startTrackingSession,
  endTrackingSession,
  pauseTrackingSession,
  resumeTrackingSession,
  getActiveTrackingSession,
  getTrackingSessionHistory,
  getTaskDependenciesController,
  setTaskDependenciesController,
  getCriticalPathController,
};
