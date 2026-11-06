const databaseApprovalService = require("../services/databaseApprovalService");

const createChangeRequest = async (req, res, next) => {
  try {
    const {
      moduleName,
      tableName,
      recordId,
      recordIdentifier,
      changeType,
      changeSummary,
      oldData,
      newData,
      diffFields,
    } = req.body;

    if (!recordId) {
      return res.status(400).json({
        success: false,
        message: "Record ID is required",
      });
    }

    const result = await databaseApprovalService.createChangeRequest({
      moduleName,
      tableName,
      recordId,
      recordIdentifier,
      changeType,
      changeSummary,
      oldData,
      newData,
      diffFields,
      user: req.user,
    });

    return res.status(201).json({
      success: true,
      message: "Database change request created successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getChangeRequests = async (req, res, next) => {
  try {
    const { status, moduleName, search, page, limit } = req.query;

    const result = await databaseApprovalService.getChangeRequests({
      status,
      moduleName,
      search,
      page,
      limit,
    });

    return res.status(200).json(result);
  } catch (error) {
    next(error);
  }
};

const getChangeStats = async (req, res, next) => {
  try {
    const stats = await databaseApprovalService.getChangeStats();
    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

const getChangeRequestById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const request = await databaseApprovalService.getChangeRequestById(id);

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Database change request not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: request,
    });
  } catch (error) {
    next(error);
  }
};

const approveChangeRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { comment } = req.body;

    const result = await databaseApprovalService.approveChangeRequest(
      id,
      req.user,
      comment
    );

    return res.status(200).json({
      success: true,
      message: "Database change approved and applied successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const rejectChangeRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    const result = await databaseApprovalService.rejectChangeRequest(
      id,
      req.user,
      reason
    );

    return res.status(200).json({
      success: true,
      message: "Database change request rejected",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const rollbackChangeRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { rollbackReason } = req.body;

    const result = await databaseApprovalService.rollbackChangeRequest(
      id,
      req.user,
      rollbackReason
    );

    return res.status(200).json({
      success: true,
      message: "Database change rolled back and reverted to previous value successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createChangeRequest,
  getChangeRequests,
  getChangeStats,
  getChangeRequestById,
  approveChangeRequest,
  rejectChangeRequest,
  rollbackChangeRequest,
};
