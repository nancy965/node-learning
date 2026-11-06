const lifecycleService = require("../services/lifecycleService");

// Get all templates
const getTemplates = async (req, res, next) => {
  try {
    const templates = await lifecycleService.getTemplates();
    return res.status(200).json({
      success: true,
      data: templates,
    });
  } catch (error) {
    next(error);
  }
};

// Create template
const createTemplate = async (req, res, next) => {
  try {
    const template = await lifecycleService.createTemplate(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: "Template created successfully",
      data: template,
    });
  } catch (error) {
    next(error);
  }
};

// Get eligible employees for selection
const getEligibleEmployees = async (req, res, next) => {
  try {
    const { type, search } = req.query;
    const employees = await lifecycleService.getEligibleEmployees(type, search);
    return res.status(200).json({
      success: true,
      data: employees,
    });
  } catch (error) {
    next(error);
  }
};

// Start lifecycle process
const startLifecycle = async (req, res, next) => {
  try {
    const record = await lifecycleService.startLifecycleRecord(req.body, req.user);
    return res.status(201).json({
      success: true,
      message: `${record.type === "onboarding" ? "Onboarding" : "Offboarding"} initiated successfully!`,
      data: record,
    });
  } catch (error) {
    next(error);
  }
};

// Get all lifecycle records with pagination & filters
const getRecords = async (req, res, next) => {
  try {
    const filters = {
      type: req.query.type || "all",
      status: req.query.status || "all",
      search: req.query.search || "",
      page: parseInt(req.query.page, 10) || 1,
      limit: parseInt(req.query.limit, 10) || 10,
    };

    const result = await lifecycleService.getLifecycleRecords(filters, req.user);
    return res.status(200).json({
      success: true,
      data: result.records,
      pagination: {
        totalRecords: result.totalRecords,
        currentPage: result.currentPage,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get single record details with checklist
const getRecordById = async (req, res, next) => {
  try {
    const record = await lifecycleService.getLifecycleRecordById(req.params.id, req.user);
    return res.status(200).json({
      success: true,
      data: record,
    });
  } catch (error) {
    next(error);
  }
};

// Toggle checklist item
const toggleItem = async (req, res, next) => {
  try {
    const { isCompleted, notes } = req.body;
    const result = await lifecycleService.toggleChecklistItem(
      req.params.itemId,
      isCompleted,
      notes,
      req.user
    );
    return res.status(200).json({
      success: true,
      message: isCompleted ? "Step marked as completed" : "Step reopened",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// Finalize complete lifecycle
const completeRecord = async (req, res, next) => {
  try {
    const result = await lifecycleService.completeLifecycleRecord(req.params.id, req.user);
    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

// Cancel lifecycle
const cancelRecord = async (req, res, next) => {
  try {
    const { reason } = req.body;
    const record = await lifecycleService.cancelLifecycleRecord(req.params.id, reason, req.user);
    return res.status(200).json({
      success: true,
      message: "Lifecycle process cancelled",
      data: record,
    });
  } catch (error) {
    next(error);
  }
};

// Get dashboard statistics
const getStats = async (req, res, next) => {
  try {
    const stats = await lifecycleService.getLifecycleStats();
    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getTemplates,
  createTemplate,
  getEligibleEmployees,
  startLifecycle,
  getRecords,
  getRecordById,
  toggleItem,
  completeRecord,
  cancelRecord,
  getStats,
};
