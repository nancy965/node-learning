const approvalService = require("../services/approvalService");

// POST /approvals/create
const createRequest = async (req, res, next) => {
  try {
    const { title, description, request_type, amount } = req.body;
    const user = req.user;
    const files = req.files || [];

    if (!title || !description || !request_type) {
      return res.status(400).json({
        success: false,
        message: "Title, description, and request type are required.",
      });
    }

    const created = await approvalService.createRequest(
      { title, description, request_type, amount },
      user,
      files
    );

    return res.status(201).json({
      success: true,
      message: `Approval request ${created.request_code} created successfully.`,
      data: created,
    });
  } catch (error) {
    next(error);
  }
};

// GET /approvals/my-requests
const getMyRequests = async (req, res, next) => {
  try {
    const user = req.user;
    const result = await approvalService.getMyRequests(
      user.userId,
      user.role,
      req.query
    );

    return res.status(200).json({
      success: true,
      message: "My approval requests fetched successfully.",
      data: result.requests,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// GET /approvals/inbox
const getApprovalInbox = async (req, res, next) => {
  try {
    const user = req.user;
    const result = await approvalService.getApprovalInbox(user, req.query);

    return res.status(200).json({
      success: true,
      message: "Approval inbox fetched successfully.",
      data: result.requests,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// GET /approvals/get/:id
const getRequestById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const request = await approvalService.getRequestById(id, user);

    return res.status(200).json({
      success: true,
      message: "Approval request details retrieved successfully.",
      data: request,
    });
  } catch (error) {
    next(error);
  }
};

// POST /approvals/decide/:id
const processDecision = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { decision, comment } = req.body;
    const user = req.user;
    const files = req.files || [];

    if (!decision) {
      return res.status(400).json({
        success: false,
        message: "Decision ('Approved' or 'Rejected') is required.",
      });
    }

    const updated = await approvalService.processDecision(
      id,
      decision,
      comment,
      user,
      files
    );

    return res.status(200).json({
      success: true,
      message: `Request ${decision.toLowerCase()} successfully.`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// POST /approvals/cancel/:id
const cancelRequest = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const result = await approvalService.cancelRequest(id, user);

    return res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

// GET /approvals/stats
const getApprovalStats = async (req, res, next) => {
  try {
    const user = req.user;
    const stats = await approvalService.getApprovalStats(user);

    return res.status(200).json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

// GET /approvals/rules
const getApprovalRules = async (req, res, next) => {
  try {
    const rules = await approvalService.getApprovalRules();

    return res.status(200).json({
      success: true,
      data: rules,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createRequest,
  getMyRequests,
  getApprovalInbox,
  getRequestById,
  processDecision,
  cancelRequest,
  getApprovalStats,
  getApprovalRules,
};
