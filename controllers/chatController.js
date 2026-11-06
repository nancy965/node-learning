const chatService = require("../services/chatService");

const getConversations = async (req, res, next) => {
  try {
    const role = req.user.baseRole || req.user.role;
    const conversations = await chatService.getConversations(
      req.user.userId,
      role,
    );

    res.status(200).json({
      success: true,
      message: "Conversations fetched successfully",
      data: conversations,
    });
  } catch (error) {
    next(error);
  }
};

const createConversation = async (req, res, next) => {
  try {
    const { employeeId } = req.body;

    if (!employeeId) {
      return res.status(400).json({
        success: false,
        message: "Employee ID is required",
      });
    }

    const employeeResult = await chatService.getOrCreateConversation(
      req.user.userId,
      employeeId,
    );

    res.status(200).json({
      success: true,
      message: "Conversation ready",
      data: employeeResult,
    });
  } catch (error) {
    next(error);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const role = req.user.baseRole || req.user.role;

    const result = await chatService.getMessages(
      conversationId,
      req.user.userId,
      role,
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: "Messages fetched successfully",
      data: result.messages,
    });
  } catch (error) {
    next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const { message } = req.body;
    const role = req.user.baseRole || req.user.role;

    if (!message || !message.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const result = await chatService.sendMessage(
      conversationId,
      req.user.userId,
      role,
      message,
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(201).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const markMessagesAsRead = async (req, res, next) => {
  try {
    const conversationId = req.params.id;
    const role = req.user.baseRole || req.user.role;

    const result = await chatService.markMessagesAsRead(
      conversationId,
      req.user.userId,
      role,
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

const getChatEmployees = async (req, res, next) => {
  try {
    const employees = await chatService.getChatEmployees();

    res.status(200).json({
      success: true,
      message: "Employees fetched successfully",
      data: employees,
    });
  } catch (error) {
    next(error);
  }
};

const getPresence = async (req, res, next) => {
  try {
    const presenceService = require("../services/presenceService");
    const onlineMap = presenceService.getAllOnlineUsers();
    res.status(200).json({
      success: true,
      data: onlineMap,
    });
  } catch (error) {
    next(error);
  }
};

const editMessage = async (req, res, next) => {
  try {
    const messageId = req.params.id;
    const { message } = req.body;
    const result = await chatService.editMessage(
      messageId,
      req.user.userId,
      message,
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const deleteMessage = async (req, res, next) => {
  try {
    const messageId = req.params.id;
    const result = await chatService.deleteMessage(messageId, req.user.userId);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const createGroup = async (req, res, next) => {
  try {
    const { name, description, memberIds } = req.body;
    const role = req.user.baseRole || req.user.role;
    const result = await chatService.createGroup(
      name,
      description,
      memberIds,
      req.user.userId,
      role,
      req.user.name,
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(201).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/chat/${req.file.filename}`;

    res.status(200).json({
      success: true,
      message: "File uploaded successfully",
      data: {
        url: fileUrl,
        name: req.file.originalname,
        size: req.file.size,
        type: req.file.mimetype,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getGroupDetails = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await chatService.getGroupDetails(id);
    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }
    res.status(200).json({
      success: true,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const updateGroup = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;
    const operatorName = req.user?.name || "Admin";
    const result = await chatService.updateGroup(
      id,
      { name, description },
      operatorName,
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const addGroupMembers = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { memberIds } = req.body;
    const operatorName = req.user?.name || "Admin";
    const result = await chatService.addGroupMembers(
      id,
      memberIds,
      operatorName,
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const removeGroupMember = async (req, res, next) => {
  try {
    const { id, memberId } = req.params;
    const operatorName = req.user?.name || "Admin";
    const result = await chatService.removeGroupMember(
      id,
      memberId,
      operatorName,
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const deleteGroup = async (req, res, next) => {
  try {
    const { id } = req.params;
    const result = await chatService.deleteGroup(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.data,
    });
  } catch (error) {
    next(error);
  }
};

const toggleReaction = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { emoji, userName } = req.body;
    const userId = req.user.userId;

    if (!emoji) {
      return res.status(400).json({
        success: false,
        message: "Emoji is required",
      });
    }

    const result = await chatService.toggleReaction(
      id,
      userId,
      userName || req.user.name || "User",
      emoji,
    );

    return res.status(result.status || 200).json(result);
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getConversations,
  createConversation,
  getMessages,
  sendMessage,
  markMessagesAsRead,
  getChatEmployees,
  getPresence,
  editMessage,
  deleteMessage,
  createGroup,
  getGroupDetails,
  updateGroup,
  addGroupMembers,
  removeGroupMember,
  deleteGroup,
  uploadFile,
  toggleReaction,
};