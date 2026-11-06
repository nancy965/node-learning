const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");

const {
  addTask,
  getTaskEmployees,
  getTaskList,
  getMyTaskList,
  getTaskByIdController,
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
} = require("../controllers/taskController");

const { getTaskLogsController } = require("../controllers/taskLogController");

// Find employees
router.get(
  PATHS.TASKS.GET_TASK_EMPLOYEES,
  authenticateToken,
  checkPermission([
    "tasks.view",
    "tasks.view_employees",
    "all_tasks.view_employees",
    "all_tasks.view",
  ]),
  getTaskEmployees,
);

// Find all tasks
router.get(
  PATHS.TASKS.GET_ALL_TASKS,
  authenticateToken,
  checkPermission(["tasks.view", "all_tasks.view"]),
  getTaskList,
);

// Find task by ID
router.get(
  PATHS.TASKS.GET_TASK_BY_ID,
  authenticateToken,
  checkPermission(["tasks.view", "all_tasks.view", "my_tasks.view"]),
  getTaskByIdController,
);

// Find task logs
router.get(
  PATHS.TASKS.GET_TASK_LOGS,
  authenticateToken,
  checkPermission([
    "tasks.view",
    "tasks.view_logs",
    "all_tasks.view_logs",
    "my_tasks.view_logs",
    "all_tasks.view",
  ]),
  getTaskLogsController,
);

// Find employee's tasks
router.get(
  PATHS.TASKS.GET_EMPLOYEE_TASKS,
  authenticateToken,
  checkPermission(["tasks.view", "my_tasks.view"]),
  getMyTaskList,
);

// Create task
router.post(
  PATHS.TASKS.CREATE_TASK,
  authenticateToken,
  checkPermission(["tasks.create", "all_tasks.create"]),
  addTask,
);

// Update task
router.put(
  PATHS.TASKS.UPDATE_TASK,
  authenticateToken,
  checkPermission(["tasks.edit", "all_tasks.edit"]),
  updateTaskById,
);

// Delete task
router.delete(
  PATHS.TASKS.DELETE_TASK,
  authenticateToken,
  checkPermission(["tasks.delete", "all_tasks.delete"]),
  deleteTaskById,
);

// Start task
router.patch(
  PATHS.TASKS.START_TASK,
  authenticateToken,
  checkPermission([
    "tasks.edit",
    "tasks.start",
    "all_tasks.start",
    "my_tasks.start",
    "tasks.view",
  ]),
  startTaskById,
);

// End task
router.patch(
  PATHS.TASKS.END_TASK,
  authenticateToken,
  checkPermission([
    "tasks.edit",
    "tasks.end",
    "all_tasks.end",
    "my_tasks.end",
    "tasks.view",
  ]),
  endTaskById,
);

router.post(
  "/:taskId/tracking/start",
  authenticateToken,
  checkPermission(["tasks.start", "my_tasks.start", "tasks.view"]),
  startTrackingSession,
);

router.post(
  "/:taskId/tracking/:sessionId/end",
  authenticateToken,
  checkPermission(["tasks.end", "my_tasks.end", "tasks.view"]),
  endTrackingSession,
);

router.post(
  "/:taskId/tracking/:sessionId/pause",
  authenticateToken,
  checkPermission(["tasks.start", "my_tasks.start", "tasks.view", "tasks.edit"]),
  pauseTrackingSession,
);

router.post(
  "/:taskId/tracking/:sessionId/resume",
  authenticateToken,
  checkPermission(["tasks.start", "my_tasks.start", "tasks.view", "tasks.edit"]),
  resumeTrackingSession,
);

router.get(
  "/tracking/active",
  authenticateToken,
  checkPermission(["tasks.view", "my_tasks.view"]),
  getActiveTrackingSession,
);

router.get(
  "/:taskId/tracking/history",
  authenticateToken,
  checkPermission(["tasks.view", "my_tasks.view"]),
  getTrackingSessionHistory,
);

// Critical path calculation
router.get(
  "/critical-path",
  authenticateToken,
  checkPermission(["tasks.view", "all_tasks.view", "my_tasks.view", "task_analytics.view"]),
  getCriticalPathController,
);

// Task dependencies
router.get(
  "/:id/dependencies",
  authenticateToken,
  checkPermission(["tasks.view", "all_tasks.view", "my_tasks.view"]),
  getTaskDependenciesController,
);

router.post(
  "/:id/dependencies",
  authenticateToken,
  checkPermission(["tasks.edit", "all_tasks.edit"]),
  setTaskDependenciesController,
);

module.exports = router;
