const pool = require("../config/databse");

// In-memory cache for fast, real-time presence checks
// Maps lowercase userId and lowercase email -> { isOnline: boolean, lastActive: number }
const onlineUsersMap = new Map();

// Initialize presence table in database if not exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS user_online_status (
        user_id VARCHAR(100) PRIMARY KEY,
        email VARCHAR(255),
        is_online BOOLEAN DEFAULT false,
        last_active TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Load any currently online users into memory on startup
    const result = await pool.query(
      "SELECT user_id, email, is_online, last_active FROM user_online_status WHERE is_online = true"
    );

    result.rows.forEach((row) => {
      const now = Date.now();
      if (row.user_id) {
        onlineUsersMap.set(String(row.user_id).toLowerCase(), {
          isOnline: true,
          lastActive: now,
        });
      }
      if (row.email) {
        onlineUsersMap.set(row.email.trim().toLowerCase(), {
          isOnline: true,
          lastActive: now,
        });
      }
    });

    console.log(`[PresenceService] Initialized with ${result.rows.length} online users`);
  } catch (err) {
    console.error("[PresenceService] Init DB error:", err.message);
  }
})();

const setUserOnline = async (userId, email) => {
  if (!userId && !email) return;
  const now = Date.now();

  const cleanId = userId ? String(userId).toLowerCase() : null;
  const cleanEmail = email ? email.trim().toLowerCase() : null;

  if (cleanId) {
    onlineUsersMap.set(cleanId, { isOnline: true, lastActive: now });
  }
  if (cleanEmail) {
    onlineUsersMap.set(cleanEmail, { isOnline: true, lastActive: now });
  }

  try {
    if (cleanId) {
      await pool.query(
        `INSERT INTO user_online_status (user_id, email, is_online, last_active)
         VALUES ($1, $2, true, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET is_online = true, last_active = NOW(), email = COALESCE(EXCLUDED.email, user_online_status.email)`,
        [cleanId, cleanEmail || ""]
      );
    }
  } catch (err) {
    console.error("[PresenceService] setUserOnline DB error:", err.message);
  }
};

const setUserOffline = async (userId, email) => {
  const now = Date.now();
  const cleanId = userId ? String(userId).toLowerCase() : null;
  const cleanEmail = email ? email.trim().toLowerCase() : null;

  if (cleanId) {
    onlineUsersMap.set(cleanId, { isOnline: false, lastActive: now });
  }
  if (cleanEmail) {
    onlineUsersMap.set(cleanEmail, { isOnline: false, lastActive: now });
  }

  try {
    if (cleanId || cleanEmail) {
      await pool.query(
        `UPDATE user_online_status
         SET is_online = false, last_active = NOW()
         WHERE (user_id = $1) OR (email IS NOT NULL AND email = $2)`,
        [cleanId || "", cleanEmail || ""]
      );
    }
  } catch (err) {
    console.error("[PresenceService] setUserOffline DB error:", err.message);
  }
};

const isUserOnline = (userId, email) => {
  if (userId) {
    const entry = onlineUsersMap.get(String(userId).toLowerCase());
    if (entry && entry.isOnline) return true;
  }
  if (email) {
    const entry = onlineUsersMap.get(email.trim().toLowerCase());
    if (entry && entry.isOnline) return true;
  }
  return false;
};

const getAllOnlineUsers = () => {
  const result = {};
  for (const [key, val] of onlineUsersMap.entries()) {
    if (val.isOnline) {
      result[key] = true;
    }
  }
  return result;
};

module.exports = {
  setUserOnline,
  setUserOffline,
  isUserOnline,
  getAllOnlineUsers,
};
