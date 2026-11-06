
const pool = require("../config/databse");
const {
  createEmployeeNotification,
  createAdminNotification,
} = require("./notificationService");

const isAdminRole = (role) => {
  if (!role) return false;
  const r = String(role).toLowerCase().trim();
  return r === "admin" || r === "general_admin" || r === "general admin" || r === "super_admin";
};

const getOrCreateConversation = async (adminId, employeeId) => {
  const existingConversation = await pool.query(
    `SELECT
       c.id,
       c.admin_id,
       c.employee_id,
       c.created_at,
       u.name AS employee_name,
       u.email AS employee_email,
       a.name AS admin_name,
       a.email AS admin_email
     FROM conversations c
     JOIN users u ON u.id = c.employee_id
     JOIN admin a ON a.id = c.admin_id
     WHERE c.admin_id = $1::uuid
     AND c.employee_id = $2::uuid`,
    [adminId, employeeId],
  );

  if (existingConversation.rows.length > 0) {
    return existingConversation.rows[0];
  }

  const insertResult = await pool.query(
    `INSERT INTO conversations
     (admin_id, employee_id)
     VALUES ($1::uuid, $2::uuid)
     RETURNING *`,
    [adminId, employeeId],
  );

  const newId = insertResult.rows[0].id;

  const fullConversation = await pool.query(
    `SELECT
       c.id,
       c.admin_id,
       c.employee_id,
       c.created_at,
       u.name AS employee_name,
       u.email AS employee_email,
       a.name AS admin_name,
       a.email AS admin_email
     FROM conversations c
     JOIN users u ON u.id = c.employee_id
     JOIN admin a ON a.id = c.admin_id
     WHERE c.id = $1::uuid`,
    [newId],
  );

  return fullConversation.rows[0] || insertResult.rows[0];
};

const getConversations = async (userId, role) => {
  let result;

  if (isAdminRole(role)) {
    result = await pool.query(
      `SELECT
         c.id,
         c.admin_id,
         c.employee_id,
         u.name AS employee_name,
         u.email AS employee_email,
         c.created_at,
         (
           SELECT message
           FROM messages
           WHERE conversation_id = c.id
           ORDER BY created_at DESC
           LIMIT 1
         ) AS last_message,
         (
           SELECT created_at
           FROM messages
           WHERE conversation_id = c.id
           ORDER BY created_at DESC
           LIMIT 1
         ) AS last_message_time,
         (
           SELECT COUNT(*)
           FROM messages
           WHERE conversation_id = c.id
           AND sender_id::varchar != $1::varchar
           AND is_read = false
         ) AS unread_count
       FROM conversations c
       JOIN users u ON u.id = c.employee_id
       WHERE c.admin_id = $1::uuid
       ORDER BY COALESCE(
         (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1),
         c.created_at
       ) DESC`,
      [userId],
    );
  } else if (role === "employee") {
    result = await pool.query(
      `SELECT
         c.id,
         c.admin_id,
         c.employee_id,
         a.name AS admin_name,
         a.email AS admin_email,
         c.created_at,
         (
           SELECT message
           FROM messages
           WHERE conversation_id = c.id
           ORDER BY created_at DESC
           LIMIT 1
         ) AS last_message,
         (
           SELECT created_at
           FROM messages
           WHERE conversation_id = c.id
           ORDER BY created_at DESC
           LIMIT 1
         ) AS last_message_time,
         (
           SELECT COUNT(*)
           FROM messages
           WHERE conversation_id = c.id
           AND sender_id::varchar != $1::varchar
           AND is_read = false
         ) AS unread_count
       FROM conversations c
       JOIN admin a ON a.id = c.admin_id
       WHERE c.employee_id = $1::uuid
       ORDER BY COALESCE(
         (SELECT created_at FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1),
         c.created_at
       ) DESC`,
      [userId],
    );
  } else {
    result = { rows: [] };
  }

  const presenceService = require("./presenceService");
  const isUserAdmin = isAdminRole(role);

  const directList = result.rows.map((row) => {
    const otherId = isUserAdmin ? row.employee_id : row.admin_id;
    const otherEmail = isUserAdmin ? row.employee_email : row.admin_email;
    return {
      ...row,
      is_group: false,
      is_online: presenceService.isUserOnline(otherId, otherEmail),
    };
  });

  const groupList = await getGroups(userId, role);
  const combined = [...directList, ...groupList];
  combined.sort((a, b) => {
    const timeA = new Date(a.last_message_time || a.created_at).getTime();
    const timeB = new Date(b.last_message_time || b.created_at).getTime();
    return timeB - timeA;
  });

  return combined;
};

const getMessages = async (conversationId, userId, role) => {
  // Check if group conversation
  const groupCheck = await pool.query(
    `SELECT * FROM chat_groups WHERE id = $1::uuid`,
    [conversationId],
  );

  if (groupCheck.rows.length > 0) {
    const groupMsgs = await pool.query(
      `SELECT
         id,
         group_id AS conversation_id,
         sender_id,
         sender_role,
         sender_name,
         message,
         created_at,
         true AS is_read,
         COALESCE(reactions, '[]'::jsonb) AS reactions
       FROM chat_group_messages
       WHERE group_id = $1::uuid
       ORDER BY created_at ASC`,
      [conversationId],
    );

    return {
      success: true,
      status: 200,
      messages: groupMsgs.rows,
    };
  }

  let accessQuery;
  let accessParams;

  if (isAdminRole(role)) {
    accessQuery = `
      SELECT id
      FROM conversations
      WHERE id = $1::uuid
      AND admin_id = $2::uuid
    `;

    accessParams = [conversationId, userId];
  } else if (role === "employee") {
    accessQuery = `
      SELECT id
      FROM conversations
      WHERE id = $1::uuid
      AND employee_id = $2::uuid
    `;

    accessParams = [conversationId, userId];
  } else {
    return {
      success: false,
      status: 403,
      message: "Access denied",
    };
  }

  const accessResult = await pool.query(accessQuery, accessParams);

  if (accessResult.rows.length === 0) {
    return {
      success: false,
      status: 403,
      message: "You do not have access to this conversation",
    };
  }

  const result = await pool.query(
    `SELECT
       id,
       conversation_id,
       sender_id,
       sender_role,
       message,
       is_read,
       created_at,
       COALESCE(reactions, '[]'::jsonb) AS reactions
     FROM messages
     WHERE conversation_id = $1::uuid
     ORDER BY created_at ASC`,
    [conversationId],
  );

  return {
    success: true,
    status: 200,
    messages: result.rows,
  };
};

const sendMessage = async (
  conversationId,
  senderId,
  senderRole,
  message,
  senderName,
) => {
  if (!message || !message.trim()) {
    return {
      success: false,
      status: 400,
      message: "Message cannot be empty",
    };
  }

  // Check if group conversation
  const groupCheck = await pool.query(
    `SELECT * FROM chat_groups WHERE id = $1::uuid`,
    [conversationId],
  );

  if (groupCheck.rows.length > 0) {
    let finalSenderName = senderName;
    if (!finalSenderName) {
      if (isAdminRole(senderRole)) {
        const aRes = await pool.query(
          `SELECT name FROM admin WHERE id::varchar = $1::varchar`,
          [String(senderId)],
        );
        finalSenderName = aRes.rows[0]?.name || "Admin";
      } else {
        const uRes = await pool.query(
          `SELECT name FROM users WHERE id::varchar = $1::varchar`,
          [String(senderId)],
        );
        finalSenderName = uRes.rows[0]?.name || "Employee";
      }
    }

    const inserted = await pool.query(
      `INSERT INTO chat_group_messages (group_id, sender_id, sender_role, sender_name, message)
       VALUES ($1::uuid, $2, $3, $4, $5)
       RETURNING id, group_id AS conversation_id, sender_id, sender_role, sender_name, message, created_at, true AS is_read`,
      [conversationId, String(senderId), senderRole, finalSenderName, message.trim()],
    );

    return {
      success: true,
      status: 201,
      message: "Group message sent",
      data: inserted.rows[0],
    };
  }

  let accessQuery;
  let accessParams;
  const isSenderAdmin = isAdminRole(senderRole);

  if (isSenderAdmin) {
    accessQuery = `
      SELECT
        id,
        admin_id,
        employee_id
      FROM conversations
      WHERE id = $1::uuid
      AND admin_id = $2::uuid
    `;

    accessParams = [conversationId, senderId];
  } else if (senderRole === "employee") {
    accessQuery = `
      SELECT
        id,
        admin_id,
        employee_id
      FROM conversations
      WHERE id = $1::uuid
      AND employee_id = $2::uuid
    `;

    accessParams = [conversationId, senderId];
  } else {
    return {
      success: false,
      status: 403,
      message: "Access denied",
    };
  }

  const accessResult = await pool.query(accessQuery, accessParams);

  if (accessResult.rows.length === 0) {
    return {
      success: false,
      status: 403,
      message: "You do not have access to this conversation",
    };
  }

  const conversation = accessResult.rows[0];
  const trimmedMessage = message.trim();
  const dbSenderRole = isSenderAdmin ? "admin" : "employee";

  const result = await pool.query(
    `INSERT INTO messages
     (conversation_id, sender_id, sender_role, message)
     VALUES ($1::uuid, $2, $3, $4)
     RETURNING *`,
    [
      conversationId,
      senderId,
      dbSenderRole,
      trimmedMessage,
    ],
  );

  const senderResult = isSenderAdmin
    ? await pool.query(
        `SELECT name
         FROM admin
         WHERE id = $1::uuid`,
        [senderId],
      )
    : await pool.query(
        `SELECT name
         FROM users
         WHERE id = $1::uuid`,
        [senderId],
      );

  const resolvedSenderName =
    senderName || senderResult.rows[0]?.name || "User";

  try {
    if (isSenderAdmin) {
      await createEmployeeNotification(
        conversation.employee_id,
        "New Message",
        `${resolvedSenderName} sent you a new message: ${trimmedMessage}`,
        "chat_message",
      );
    } else {
      await createAdminNotification(
        conversation.admin_id,
        "New Message",
        `${resolvedSenderName} sent you a new message: ${trimmedMessage}`,
        "chat_message",
      );
    }
  } catch (notifErr) {
    console.error("Chat notification error:", notifErr);
  }

  return {
    success: true,
    status: 201,
    message: "Message sent successfully",
    data: result.rows[0],
  };
};

const markMessagesAsRead = async (
  conversationId,
  userId,
  role,
) => {
  const groupCheck = await pool.query(
    `SELECT id FROM chat_groups WHERE id = $1::uuid`,
    [conversationId],
  );

  if (groupCheck.rows.length > 0) {
    return {
      success: true,
      status: 200,
      message: "Group messages marked as read",
    };
  }

  let accessQuery;
  let accessParams;

  if (isAdminRole(role)) {
    accessQuery = `
      SELECT id
      FROM conversations
      WHERE id = $1::uuid
      AND admin_id = $2::uuid
    `;

    accessParams = [conversationId, userId];
  } else if (role === "employee") {
    accessQuery = `
      SELECT id
      FROM conversations
      WHERE id = $1::uuid
      AND employee_id = $2::uuid
    `;

    accessParams = [conversationId, userId];
  } else {
    return {
      success: false,
      status: 403,
      message: "Access denied",
    };
  }

  const accessResult = await pool.query(accessQuery, accessParams);

  if (accessResult.rows.length === 0) {
    return {
      success: false,
      status: 403,
      message: "You do not have access to this conversation",
    };
  }

  const otherRole = isAdminRole(role) ? "employee" : "admin";
  await pool.query(
    `UPDATE messages
     SET is_read = true
     WHERE conversation_id = $1::uuid
     AND (sender_id::varchar != $2::varchar OR sender_role = $3)
     AND is_read = false`,
    [conversationId, userId, otherRole],
  );

  return {
    success: true,
    status: 200,
    message: "Messages marked as read",
  };
};

const getChatEmployees = async () => {
  const result = await pool.query(
    `SELECT
       u.id,
       u.name,
       u.email,
       u.role,
       u.role_id,
       COALESCE(r.name, u.role, 'Employee') AS permission_role,
       COALESCE(r.name, u.role, 'Employee') AS role_name
     FROM users u
     LEFT JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = true
     ORDER BY u.name ASC`,
  );

  return result.rows;
};

const createGroup = async (
  name,
  description,
  memberIds,
  createdBy,
  createdByRole,
  createdByName,
) => {
  if (typeof name === "object" && name !== null) {
    const opts = name;
    name = opts.name;
    description = opts.description;
    memberIds = opts.memberIds || opts.members;
    createdBy = opts.createdBy;
    createdByRole = opts.createdByRole;
    createdByName = opts.createdByName;
  }

  if (!name || typeof name !== "string" || !name.trim()) {
    return {
      success: false,
      status: 400,
      message: "Group name is required",
    };
  }

  let memberObjects = [];
  try {
    if (Array.isArray(memberIds) && memberIds.length > 0) {
      const usersRes = await pool.query(
        `SELECT u.id, u.name, u.email, COALESCE(r.name, u.role, 'Employee') AS permission_role
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE u.id::varchar = ANY($1::varchar[])`,
        [memberIds.map(String)],
      );
      memberObjects = usersRes.rows.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.permission_role || "Employee",
      }));
    }
  } catch (err) {
    console.error("Error fetching group members:", err);
  }

  if (!memberObjects.some((m) => String(m.id) === String(createdBy))) {
    memberObjects.unshift({
      id: createdBy,
      name: createdByName || "Admin",
      role: createdByRole || "admin",
    });
  }

  const groupRes = await pool.query(
    `INSERT INTO chat_groups (name, description, created_by, created_by_role, members)
     VALUES ($1, $2, $3, $4, $5::jsonb)
     RETURNING *`,
    [
      name.trim(),
      description || "",
      String(createdBy),
      createdByRole || "admin",
      JSON.stringify(memberObjects),
    ],
  );

  const newGroup = groupRes.rows[0];

  await pool.query(
    `INSERT INTO chat_group_messages (group_id, sender_id, sender_role, sender_name, message)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      newGroup.id,
      String(createdBy),
      createdByRole || "admin",
      createdByName || "Admin",
      `${createdByName || "Admin"} created the group "${name.trim()}"`,
    ],
  );

  return {
    success: true,
    status: 201,
    message: "Group created successfully",
    data: {
      ...newGroup,
      is_group: true,
      last_message: `${createdByName || "Admin"} created the group "${name.trim()}"`,
      last_message_time: newGroup.created_at,
      member_count: memberObjects.length,
    },
  };
};

const getGroups = async (userId, role) => {
  try {
    const groupsRes = await pool.query(
      `SELECT
         g.*,
         (
           SELECT message
           FROM chat_group_messages
           WHERE group_id = g.id
           ORDER BY created_at DESC
           LIMIT 1
         ) AS last_message,
         (
           SELECT created_at
           FROM chat_group_messages
           WHERE group_id = g.id
           ORDER BY created_at DESC
           LIMIT 1
         ) AS last_message_time
       FROM chat_groups g
       ORDER BY COALESCE(
         (SELECT created_at FROM chat_group_messages WHERE group_id = g.id ORDER BY created_at DESC LIMIT 1),
         g.created_at
       ) DESC`,
    );

    return groupsRes.rows.map((row) => ({
      id: row.id,
      is_group: true,
      name: row.name,
      employee_name: row.name,
      admin_name: row.name,
      description: row.description,
      members: row.members || [],
      member_count: (row.members || []).length,
      created_by: row.created_by,
      created_at: row.created_at,
      last_message: row.last_message || `Group created`,
      last_message_time: row.last_message_time || row.created_at,
      unread_count: 0,
      is_online: true,
    }));
  } catch (err) {
    console.error("Error in getGroups:", err);
    return [];
  }
};

const editMessage = async (messageId, userId, newText) => {
  if (!newText || !newText.trim()) {
    return {
      success: false,
      status: 400,
      message: "Message cannot be empty",
    };
  }

  let result = await pool.query(
    `UPDATE messages
     SET message = $1
     WHERE id = $2::uuid
     RETURNING id, conversation_id, sender_id, sender_role, message, is_read, created_at`,
    [newText.trim(), messageId],
  );

  if (result.rows.length === 0) {
    result = await pool.query(
      `UPDATE chat_group_messages
       SET message = $1
       WHERE id = $2::uuid
       RETURNING id, group_id AS conversation_id, sender_id, sender_role, sender_name, message, created_at, true AS is_read`,
      [newText.trim(), messageId],
    );
  }

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Message not found",
    };
  }

  return {
    success: true,
    status: 200,
    message: "Message edited successfully",
    data: result.rows[0],
  };
};

const deleteMessage = async (messageId, userId) => {
  let result = await pool.query(
    `DELETE FROM messages
     WHERE id = $1::uuid
     RETURNING id, conversation_id`,
    [messageId],
  );

  if (result.rows.length === 0) {
    result = await pool.query(
      `DELETE FROM chat_group_messages
       WHERE id = $1::uuid
       RETURNING id, group_id AS conversation_id`,
      [messageId],
    );
  }

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Message not found",
    };
  }

  return {
    success: true,
    status: 200,
    message: "Message deleted successfully",
    data: result.rows[0],
  };
};

const getGroupDetails = async (groupId) => {
  const result = await pool.query(
    `SELECT * FROM chat_groups WHERE id = $1::uuid`,
    [groupId],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Group not found",
    };
  }

  const group = result.rows[0];
  let enrichedMembers = group.members || [];
  const memberIds = enrichedMembers.map((m) => String(m.id));
  if (memberIds.length > 0) {
    try {
      const uRes = await pool.query(
        `SELECT u.id, u.name, u.email, COALESCE(r.name, u.role, 'Employee') AS permission_role
         FROM users u
         LEFT JOIN roles r ON r.id = u.role_id
         WHERE u.id::varchar = ANY($1::varchar[])`,
        [memberIds],
      );
      const roleMap = {};
      uRes.rows.forEach((u) => {
        roleMap[String(u.id)] = u.permission_role;
      });
      enrichedMembers = enrichedMembers.map((m) => ({
        ...m,
        role: roleMap[String(m.id)] || m.role || "Employee",
      }));
    } catch (e) {
      console.error("Enrich group members error:", e);
    }
  }

  let creatorName = "Admin";
  try {
    if (group.created_by) {
      const creatorAdmin = await pool.query(
        `SELECT name FROM admin WHERE id::varchar = $1`,
        [String(group.created_by)],
      );
      if (creatorAdmin.rows.length > 0) {
        creatorName = creatorAdmin.rows[0].name;
      } else {
        const creatorUser = await pool.query(
          `SELECT name FROM users WHERE id::varchar = $1`,
          [String(group.created_by)],
        );
        if (creatorUser.rows.length > 0) {
          creatorName = creatorUser.rows[0].name;
        }
      }
    }
  } catch (err) {
    // fallback
  }

  return {
    success: true,
    status: 200,
    data: {
      ...group,
      is_group: true,
      created_by_name: creatorName,
      members: enrichedMembers,
      member_count: enrichedMembers.length,
    },
  };
};

const updateGroup = async (groupId, { name, description }, operatorName = "Admin") => {
  if (!name || !name.trim()) {
    return {
      success: false,
      status: 400,
      message: "Group name is required",
    };
  }

  const result = await pool.query(
    `UPDATE chat_groups
     SET name = $1, description = $2
     WHERE id = $3::uuid
     RETURNING *`,
    [name.trim(), description || "", groupId],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Group not found",
    };
  }

  const updated = result.rows[0];

  try {
    await pool.query(
      `INSERT INTO chat_group_messages (group_id, sender_id, sender_role, sender_name, message)
       VALUES ($1, 'system', 'system', $2, $3)`,
      [
        groupId,
        operatorName,
        `${operatorName} updated group name to "${name.trim()}"`,
      ],
    );
  } catch (err) {
    console.error("Error logging group update:", err);
  }

  return {
    success: true,
    status: 200,
    message: "Group updated successfully",
    data: {
      ...updated,
      is_group: true,
      members: updated.members || [],
    },
  };
};

const addGroupMembers = async (groupId, memberIds, operatorName = "Admin") => {
  const groupRes = await pool.query(
    `SELECT * FROM chat_groups WHERE id = $1::uuid`,
    [groupId],
  );

  if (groupRes.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Group not found",
    };
  }

  const group = groupRes.rows[0];
  let currentMembers = Array.isArray(group.members) ? [...group.members] : [];

  const idsToAdd = (Array.isArray(memberIds) ? memberIds : [memberIds]).filter(
    (id) => !currentMembers.some((m) => String(m.id) === String(id)),
  );

  if (idsToAdd.length === 0) {
    return {
      success: true,
      status: 200,
      message: "Members already in group",
      data: group,
    };
  }

  const addedUsers = [];
  try {
    const usersRes = await pool.query(
      `SELECT u.id, u.name, u.email, COALESCE(r.name, u.role, 'Employee') AS permission_role
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       WHERE u.id::varchar = ANY($1::varchar[])`,
      [idsToAdd.map(String)],
    );

    usersRes.rows.forEach((u) => {
      addedUsers.push({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.permission_role || "Employee",
      });
    });

    // Check if any admin was in idsToAdd
    const missingIds = idsToAdd.filter(
      (id) => !usersRes.rows.some((u) => String(u.id) === String(id)),
    );
    if (missingIds.length > 0) {
      const adminRes = await pool.query(
        `SELECT id, name, email, role FROM admin WHERE id::varchar = ANY($1::varchar[])`,
        [missingIds.map(String)],
      );
      adminRes.rows.forEach((a) => {
        addedUsers.push({ id: a.id, name: a.name, email: a.email, role: a.role || "admin" });
      });
    }
  } catch (err) {
    console.error("Error looking up users for group:", err);
  }

  const updatedMembers = [...currentMembers, ...addedUsers];

  const updateRes = await pool.query(
    `UPDATE chat_groups
     SET members = $1::jsonb
     WHERE id = $2::uuid
     RETURNING *`,
    [JSON.stringify(updatedMembers), groupId],
  );

  const namesStr = addedUsers.map((u) => u.name).join(", ");
  try {
    await pool.query(
      `INSERT INTO chat_group_messages (group_id, sender_id, sender_role, sender_name, message)
       VALUES ($1, 'system', 'system', $2, $3)`,
      [groupId, operatorName, `${operatorName} added ${namesStr || "new members"} to the group`],
    );
  } catch (err) {
    console.error("Error logging member addition:", err);
  }

  return {
    success: true,
    status: 200,
    message: "Members added successfully",
    data: {
      ...updateRes.rows[0],
      is_group: true,
      members: updatedMembers,
      member_count: updatedMembers.length,
    },
  };
};

const removeGroupMember = async (groupId, memberId, operatorName = "Admin") => {
  const groupRes = await pool.query(
    `SELECT * FROM chat_groups WHERE id = $1::uuid`,
    [groupId],
  );

  if (groupRes.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Group not found",
    };
  }

  const group = groupRes.rows[0];
  let currentMembers = Array.isArray(group.members) ? [...group.members] : [];

  const removedMember = currentMembers.find(
    (m) => String(m.id) === String(memberId),
  );

  if (!removedMember) {
    return {
      success: false,
      status: 404,
      message: "Member not found in group",
    };
  }

  const updatedMembers = currentMembers.filter(
    (m) => String(m.id) !== String(memberId),
  );

  const updateRes = await pool.query(
    `UPDATE chat_groups
     SET members = $1::jsonb
     WHERE id = $2::uuid
     RETURNING *`,
    [JSON.stringify(updatedMembers), groupId],
  );

  try {
    await pool.query(
      `INSERT INTO chat_group_messages (group_id, sender_id, sender_role, sender_name, message)
       VALUES ($1, 'system', 'system', $2, $3)`,
      [
        groupId,
        operatorName,
        `${operatorName} removed ${removedMember.name || "a member"} from the group`,
      ],
    );
  } catch (err) {
    console.error("Error logging member removal:", err);
  }

  return {
    success: true,
    status: 200,
    message: "Member removed successfully",
    data: {
      ...updateRes.rows[0],
      is_group: true,
      members: updatedMembers,
      member_count: updatedMembers.length,
    },
  };
};

const deleteGroup = async (groupId) => {
  await pool.query(
    `DELETE FROM chat_group_messages WHERE group_id = $1::uuid`,
    [groupId],
  );

  const res = await pool.query(
    `DELETE FROM chat_groups WHERE id = $1::uuid RETURNING id, name`,
    [groupId],
  );

  if (res.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Group not found",
    };
  }

  return {
    success: true,
    status: 200,
    message: `Group "${res.rows[0].name}" deleted successfully`,
    data: res.rows[0],
  };
};

const toggleReaction = async (messageId, userId, userName, emoji) => {
  if (!messageId || !emoji) {
    return { success: false, status: 400, message: "Missing required fields" };
  }

  let finalUserName = userName;
  if (!finalUserName || finalUserName === "User") {
    try {
      const uRes = await pool.query(
        `SELECT name FROM users WHERE id::varchar = $1::varchar
         UNION
         SELECT name FROM admin WHERE id::varchar = $1::varchar`,
        [String(userId)],
      );
      if (uRes.rows.length > 0) {
        finalUserName = uRes.rows[0].name;
      }
    } catch {}
  }

  // 1. Check in `messages` table
  let isGroup = false;
  let msgQuery = await pool.query(
    `SELECT id, COALESCE(reactions, '[]'::jsonb) AS reactions FROM messages WHERE id = $1::uuid`,
    [messageId],
  );

  if (msgQuery.rows.length === 0) {
    // 2. Check in `chat_group_messages` table
    msgQuery = await pool.query(
      `SELECT id, COALESCE(reactions, '[]'::jsonb) AS reactions FROM chat_group_messages WHERE id = $1::uuid`,
      [messageId],
    );
    if (msgQuery.rows.length > 0) {
      isGroup = true;
    } else {
      return { success: false, status: 404, message: "Message not found" };
    }
  }

  let reactions = msgQuery.rows[0].reactions;
  if (!Array.isArray(reactions)) {
    reactions = [];
  }

  const existingEmojiIndex = reactions.findIndex((r) => r.emoji === emoji);

  if (existingEmojiIndex !== -1) {
    const emojiObj = { ...reactions[existingEmojiIndex] };
    const userList = Array.isArray(emojiObj.users) ? [...emojiObj.users] : [];
    const userIndex = userList.findIndex((u) => String(u.id) === String(userId));

    if (userIndex !== -1) {
      // User already reacted -> remove reaction (toggle off)
      userList.splice(userIndex, 1);
    } else {
      // Add user reaction
      userList.push({ id: String(userId), name: finalUserName || "User" });
    }

    if (userList.length === 0) {
      reactions.splice(existingEmojiIndex, 1);
    } else {
      emojiObj.users = userList;
      emojiObj.count = userList.length;
      reactions[existingEmojiIndex] = emojiObj;
    }
  } else {
    // Add new reaction with this emoji
    reactions.push({
      emoji,
      count: 1,
      users: [{ id: String(userId), name: finalUserName || "User" }],
    });
  }

  const tableName = isGroup ? "chat_group_messages" : "messages";
  const updateRes = await pool.query(
    `UPDATE ${tableName} SET reactions = $1::jsonb WHERE id = $2::uuid RETURNING *`,
    [JSON.stringify(reactions), messageId],
  );

  return {
    success: true,
    status: 200,
    message: "Reaction updated",
    reactions: updateRes.rows[0]?.reactions || [],
  };
};

module.exports = {
  getOrCreateConversation,
  getConversations,
  getMessages,
  sendMessage,
  markMessagesAsRead,
  getChatEmployees,
  createGroup,
  getGroups,
  getGroupDetails,
  updateGroup,
  addGroupMembers,
  removeGroupMember,
  deleteGroup,
  editMessage,
  deleteMessage,
  toggleReaction,
};
