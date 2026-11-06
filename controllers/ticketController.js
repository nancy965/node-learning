const ticketService = require("../services/ticketService");

// POST /tickets/create
const createTicket = async (req, res, next) => {
  try {
    const { title, description, category, priority } = req.body;
    const user = req.user;

    if (!title || !description || !category) {
      return res.status(400).json({
        success: false,
        message: "Title, description, and category are required.",
      });
    }

    const files = req.files || [];

    const ticket = await ticketService.createTicket(
      { title, description, category, priority, files },
      user
    );

    return res.status(201).json({
      success: true,
      message: "Support ticket created successfully.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// GET /tickets/my-tickets
const getMyTickets = async (req, res, next) => {
  try {
    const user = req.user;
    const result = await ticketService.getMyTickets(
      user.userId,
      user.role,
      req.query
    );

    return res.status(200).json({
      success: true,
      message: "My tickets fetched successfully.",
      data: result.tickets,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// GET /tickets/get-all
const getAllTickets = async (req, res, next) => {
  try {
    const user = req.user;
    const result = await ticketService.getAllTickets(user, req.query);

    return res.status(200).json({
      success: true,
      message: "All tickets fetched successfully.",
      data: result.tickets,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

// GET /tickets/get/:id
const getTicketById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const ticket = await ticketService.getTicketById(id, user);

    return res.status(200).json({
      success: true,
      message: "Ticket details retrieved successfully.",
      data: ticket,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /tickets/update-status/:id
const updateTicketStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { status, resolution_note } = req.body;
    const user = req.user;

    if (!status) {
      return res.status(400).json({
        success: false,
        message: "Status is required.",
      });
    }

    const files = req.files || [];

    const updated = await ticketService.updateTicketStatus(
      id,
      status,
      resolution_note,
      user,
      files
    );

    return res.status(200).json({
      success: true,
      message: `Ticket status successfully updated to ${status}.`,
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// PATCH /tickets/assign/:id
const assignTicket = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { assigned_to, priority, terminate_session, termination_reason } = req.body;
    const user = req.user;

    if (!assigned_to) {
      return res.status(400).json({
        success: false,
        message: "assigned_to (agent ID) is required.",
      });
    }

    const updated = await ticketService.assignTicket(
      id,
      assigned_to,
      priority,
      user,
      Boolean(terminate_session),
      termination_reason || ""
    );

    return res.status(200).json({
      success: true,
      message: terminate_session
        ? "Active session terminated and ticket reassigned successfully (Process restarted)."
        : "Ticket assigned successfully.",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};

// GET /tickets/agents
const getAvailableAgents = async (req, res, next) => {
  try {
    const agents = await ticketService.getAvailableAgents();

    return res.status(200).json({
      success: true,
      message: "Available agents retrieved successfully.",
      data: agents,
    });
  } catch (error) {
    next(error);
  }
};

// GET /tickets/stats
const getTicketStats = async (req, res, next) => {
  try {
    const user = req.user;
    const { scope } = req.query;
    const stats = await ticketService.getTicketStats(user, scope);

    return res.status(200).json({
      success: true,
      message: "Ticket statistics retrieved successfully.",
      data: stats,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createTicket,
  getMyTickets,
  getAllTickets,
  getTicketById,
  updateTicketStatus,
  assignTicket,
  getAvailableAgents,
  getTicketStats,
};
