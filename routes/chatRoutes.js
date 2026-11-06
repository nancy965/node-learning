const express = require("express");
const router = express.Router();
const PATHS = require("../config/path.config");

const {
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
} = require("../controllers/chatController");

const authenticateToken = require("../middleware/authMiddleware");
const checkPermission = require("../middleware/permissionMiddleware");
const chatUpload = require("../middleware/chatUploadMiddleware");

router.get("/presence", authenticateToken, getPresence);

router.post(
    "/groups",
    authenticateToken,
    checkPermission("chat"),
    createGroup
);

router.get(
    "/groups/:id",
    authenticateToken,
    checkPermission("chat"),
    getGroupDetails
);

router.put(
    "/groups/:id",
    authenticateToken,
    checkPermission("chat"),
    updateGroup
);

router.post(
    "/groups/:id/members",
    authenticateToken,
    checkPermission("chat"),
    addGroupMembers
);

router.delete(
    "/groups/:id/members/:memberId",
    authenticateToken,
    checkPermission("chat"),
    removeGroupMember
);

router.delete(
    "/groups/:id",
    authenticateToken,
    checkPermission("chat"),
    deleteGroup
);

router.post(
    "/upload",
    authenticateToken,
    checkPermission("chat"),
    chatUpload.single("file"),
    uploadFile
);

router.put(
    PATHS.CHAT.MESSAGE_BY_ID,
    authenticateToken,
    checkPermission("chat"),
    editMessage
);

router.delete(
    PATHS.CHAT.MESSAGE_BY_ID,
    authenticateToken,
    checkPermission("chat"),
    deleteMessage
);

router.post(
    PATHS.CHAT.REACT_MESSAGE || "/messages/:id/react",
    authenticateToken,
    checkPermission("chat"),
    toggleReaction
);

router.get(
    PATHS.CHAT.CONVERSATIONS,
    authenticateToken,
    checkPermission("chat"),
    getConversations
);

router.post(
    PATHS.CHAT.CONVERSATIONS,
    authenticateToken,
    checkPermission("chat"),
    createConversation
);

router.get(
    PATHS.CHAT.CONVERSATION_MESSAGES,
    authenticateToken,
    checkPermission("chat"),
    getMessages
);

router.post(
    PATHS.CHAT.CONVERSATION_MESSAGES,
    authenticateToken,
    checkPermission("chat"),
    sendMessage
);

router.put(
    PATHS.CHAT.MARK_CONVERSATION_READ,
    authenticateToken,
    checkPermission("chat"),
    markMessagesAsRead
);

router.get(
    PATHS.CHAT.GET_CHAT_EMPLOYEES,
    authenticateToken,
    checkPermission("chat"),
    getChatEmployees
);

module.exports = router;
