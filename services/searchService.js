const pool = require("../config/databse");
const { decodeUUIDToId, encodeIdToUUID } = require("../utils/uuidUtils");
const chatService = require("./chatService");

const normalizeRole = (role) => String(role || "").toLowerCase().trim();

const isGeneralAdminRole = (role) => {
  const r = normalizeRole(role);
  return r === "general_admin" || r === "general admin" || r === "super_admin";
};

const isAdminRole = (role) => {
  const r = normalizeRole(role);
  return r === "admin" || isGeneralAdminRole(r);
};

const hasPermission = (user, prefix) => {
  if (isGeneralAdminRole(user.role) || isGeneralAdminRole(user.baseRole)) return true;
  if (normalizeRole(user.role) === "admin" && !user.roleId) return true;
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  return perms.some((p) => p === prefix || p.startsWith(prefix + "."));
};

const searchGlobalRecords = async (queryText, user) => {
  const cleanQuery = String(queryText || "").trim();
  if (!cleanQuery) {
    return {
      users: [],
      tasks: [],
      chats: [],
      notifications: [],
      totalCount: 0,
    };
  }

  const rawUserId = user.userId;
  const numericUserId = decodeUUIDToId(rawUserId);
  const userRole = normalizeRole(user.role || user.baseRole);
  const isGA = isGeneralAdminRole(userRole);
  const isAdmin = isAdminRole(userRole);

  const searchPattern = `%${cleanQuery}%`;

  // 1. SEARCH USERS / ADMINS
  const searchUsers = async () => {
    const canViewUsers = isGA || isAdmin || hasPermission(user, "users");
    if (!canViewUsers) return [];

    try {
      if (isGA) {
        const query = `
          SELECT 
            u.id, 
            u.name, 
            u.email, 
            u.role, 
            'user' AS user_type, 
            COALESCE(r.name, u.role) AS role_title
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          WHERE (u.name ILIKE $1 OR u.email ILIKE $1)
          
          UNION ALL
          
          SELECT 
            a.id, 
            a.name, 
            a.email, 
            a.role, 
            'admin' AS user_type, 
            COALESCE(r.name, a.role) AS role_title
          FROM admin a
          LEFT JOIN roles r ON r.id = a.role_id
          WHERE (a.name ILIKE $1 OR a.email ILIKE $1)
          LIMIT 8;
        `;
        const res = await pool.query(query, [searchPattern]);
        return res.rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: `${row.email} • ${row.role_title || row.role}`,
          category: "users",
          type: row.user_type,
          navigationPath: row.user_type === "admin" ? `/admins/${row.id}` : `/users/${row.id}`,
        }));
      }

      if (userRole === "admin") {
        const query = `
          SELECT 
            u.id, 
            u.name, 
            u.email, 
            u.role, 
            'user' AS user_type, 
            COALESCE(r.name, u.role) AS role_title
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          WHERE (u.name ILIKE $1 OR u.email ILIKE $1)
            AND (u.admin_id = $2 OR u.admin_id = (SELECT admin_id FROM users WHERE id = $2))
          LIMIT 8;
        `;
        const res = await pool.query(query, [searchPattern, numericUserId]);
        return res.rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: `${row.email} • ${row.role_title || row.role}`,
          category: "users",
          type: "user",
          navigationPath: `/users/${row.id}`,
        }));
      }

      if (userRole === "employee") {
        const query = `
          SELECT 
            u.id, 
            u.name, 
            u.email, 
            u.role, 
            'user' AS user_type, 
            COALESCE(r.name, u.role) AS role_title
          FROM users u
          LEFT JOIN roles r ON r.id = u.role_id
          WHERE (u.name ILIKE $1 OR u.email ILIKE $1)
            AND u.admin_id = (SELECT admin_id FROM users WHERE id = $2)
            AND u.is_active = true
          LIMIT 8;
        `;
        const res = await pool.query(query, [searchPattern, numericUserId]);
        return res.rows.map((row) => ({
          id: row.id,
          title: row.name,
          subtitle: `${row.email} • ${row.role_title || row.role}`,
          category: "users",
          type: "user",
          navigationPath: `/users/${row.id}`,
        }));
      }
    } catch (err) {
      console.error("Global search users error:", err);
    }
    return [];
  };

  // 2. SEARCH TASKS
  const searchTasks = async () => {
    const canViewTasks = isGA || hasPermission(user, "tasks") || hasPermission(user, "my_tasks") || userRole === "employee";
    if (!canViewTasks) return [];

    try {
      let query;
      let params;

      if (isGA) {
        query = `
          SELECT 
            t.id, 
            t.task_name, 
            t.status, 
            t.task_date, 
            t.due_date,
            u.name AS assigned_to_name,
            a.name AS assigned_by_name,
            cm_tt.name AS task_type_name
          FROM tasks t
          LEFT JOIN users u ON u.id = t.assigned_to
          LEFT JOIN admin a ON a.id = t.assigned_by
          LEFT JOIN common_master cm_tt ON cm_tt.id = t.task_type
          WHERE (t.task_name ILIKE $1 OR u.name ILIKE $1 OR t.status ILIKE $1)
          ORDER BY t.id DESC
          LIMIT 8;
        `;
        params = [searchPattern];
      } else if (userRole === "admin") {
        query = `
          SELECT 
            t.id, 
            t.task_name, 
            t.status, 
            t.task_date, 
            t.due_date,
            u.name AS assigned_to_name,
            a.name AS assigned_by_name,
            cm_tt.name AS task_type_name
          FROM tasks t
          LEFT JOIN users u ON u.id = t.assigned_to
          LEFT JOIN admin a ON a.id = t.assigned_by
          LEFT JOIN common_master cm_tt ON cm_tt.id = t.task_type
          WHERE (t.task_name ILIKE $1 OR u.name ILIKE $1 OR t.status ILIKE $1)
            AND (t.assigned_to IN (SELECT id FROM users WHERE admin_id = $2) OR t.assigned_by = $2)
          ORDER BY t.id DESC
          LIMIT 8;
        `;
        params = [searchPattern, numericUserId];
      } else {
        // Employee
        query = `
          SELECT 
            t.id, 
            t.task_name, 
            t.status, 
            t.task_date, 
            t.due_date,
            u.name AS assigned_to_name,
            a.name AS assigned_by_name,
            cm_tt.name AS task_type_name
          FROM tasks t
          LEFT JOIN users u ON u.id = t.assigned_to
          LEFT JOIN admin a ON a.id = t.assigned_by
          LEFT JOIN common_master cm_tt ON cm_tt.id = t.task_type
          WHERE (t.task_name ILIKE $1 OR t.status ILIKE $1)
            AND (t.assigned_to = $2 OR t.assigned_by = $2)
          ORDER BY t.id DESC
          LIMIT 8;
        `;
        params = [searchPattern, numericUserId];
      }

      const res = await pool.query(query, params);
      return res.rows.map((row) => ({
        id: row.id,
        title: row.task_name,
        subtitle: `Status: ${row.status} • Assigned to: ${row.assigned_to_name || "Unassigned"}`,
        category: "tasks",
        type: "task",
        status: row.status,
        navigationPath: userRole === "employee" ? "/employee-tasks" : `/tasks/${row.id}`,
      }));
    } catch (err) {
      console.error("Global search tasks error:", err);
    }
    return [];
  };

  // 3. SEARCH CHAT CONVERSATIONS & GROUPS
  const searchChats = async () => {
    try {
      // Re-use authorized chatService conversations to guarantee exact participation & group visibility
      const conversations = await chatService.getConversations(rawUserId, userRole);
      if (!Array.isArray(conversations) || conversations.length === 0) return [];

      const lowerQ = cleanQuery.toLowerCase();
      const filtered = conversations.filter((c) => {
        const contactName = c.is_group
          ? c.name
          : userRole === "employee"
          ? c.admin_name
          : c.employee_name;
        const contactEmail = c.is_group
          ? ""
          : userRole === "employee"
          ? c.admin_email
          : c.employee_email;
        const lastMsg = c.last_message || "";

        return (
          (contactName && contactName.toLowerCase().includes(lowerQ)) ||
          (contactEmail && contactEmail.toLowerCase().includes(lowerQ)) ||
          (lastMsg && lastMsg.toLowerCase().includes(lowerQ))
        );
      });

      return filtered.slice(0, 6).map((c) => {
        const title = c.is_group
          ? c.name
          : userRole === "employee"
          ? c.admin_name || "Admin"
          : c.employee_name || "Employee";

        const subtitle = c.last_message
          ? c.last_message.length > 55
            ? c.last_message.slice(0, 55) + "..."
            : c.last_message
          : c.is_group
          ? "Group conversation"
          : "Direct conversation";

        return {
          id: c.id,
          title,
          subtitle,
          category: "chats",
          type: c.is_group ? "group_chat" : "direct_chat",
          is_group: Boolean(c.is_group),
          navigationPath: "/chat",
          state: { conversationId: c.id },
        };
      });
    } catch (err) {
      console.error("Global search chats error:", err);
    }
    return [];
  };

  // 4. SEARCH NOTIFICATIONS
  const searchNotifications = async () => {
    try {
      let query;
      let params;

      if (isAdmin) {
        query = `
          SELECT id, title, message, type, is_read, created_at
          FROM admin_notifications
          WHERE admin_id = $1
            AND (title ILIKE $2 OR message ILIKE $2)
          ORDER BY created_at DESC
          LIMIT 6;
        `;
        params = [numericUserId, searchPattern];
      } else {
        query = `
          SELECT id, title, message, type, is_read, created_at
          FROM employee_notifications
          WHERE employee_id = $1
            AND (title ILIKE $2 OR message ILIKE $2)
          ORDER BY created_at DESC
          LIMIT 6;
        `;
        params = [numericUserId, searchPattern];
      }

      const res = await pool.query(query, params);
      return res.rows.map((row) => ({
        id: row.id,
        title: row.title,
        subtitle: row.message
          ? row.message.length > 60
            ? row.message.slice(0, 60) + "..."
            : row.message
          : "",
        category: "notifications",
        type: row.type || "notification",
        is_read: row.is_read,
        created_at: row.created_at,
        rawNotification: row,
      }));
    } catch (err) {
      console.error("Global search notifications error:", err);
    }
    return [];
  };

  // Execute all authorized queries concurrently
  const [users, tasks, chats, notifications] = await Promise.all([
    searchUsers(),
    searchTasks(),
    searchChats(),
    searchNotifications(),
  ]);

  const totalCount = users.length + tasks.length + chats.length + notifications.length;

  return {
    users,
    tasks,
    chats,
    notifications,
    totalCount,
  };
};

module.exports = {
  searchGlobalRecords,
};
