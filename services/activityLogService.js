
const pool = require("../config/databse");

// Create activity log
const createActivityLog = async (
  performedBy,
  action,
  targetUser,
  details = {}
) => {
  const result = await pool.query(
    `INSERT INTO activity_log
     (performed_by, action, target_user, details)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [performedBy, action, targetUser, details]
  );

  return result.rows[0];
};

const { decodeUUIDToId } = require("../utils/uuidUtils");

const isUUID = (val) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    String(val || "").trim()
  );

const parseSafeId = (val) => {
  if (val === undefined || val === null || val === "") return null;
  if (typeof val === "number") return val;
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (isUUID(trimmed)) return trimmed;
    if (trimmed.includes("-") && trimmed.length > 20) {
      const decoded = decodeUUIDToId(trimmed);
      const parsed = parseInt(decoded, 10);
      return !isNaN(parsed) ? parsed : null;
    }
    const parsed = parseInt(trimmed, 10);
    return !isNaN(parsed) ? parsed : null;
  }
  return null;
};

const resolveLogNames = async (pool, logs) => {
  if (!Array.isArray(logs) || logs.length === 0) return logs;

  const countryIds = new Set();
  const stateIds = new Set();
  const cityIds = new Set();
  const pincodeIds = new Set();
  const roleIds = new Set();
  const targetUserIds = new Set();

  const collectIds = (obj) => {
    if (!obj || typeof obj !== "object") return;

    // Country
    const cId = parseSafeId(obj.country_id ?? obj.countryId ?? obj.country);
    if (cId) countryIds.add(cId);

    // State
    const sId = parseSafeId(obj.state_id ?? obj.stateId ?? obj.state);
    if (sId) stateIds.add(sId);

    // City
    const ctId = parseSafeId(obj.city_id ?? obj.cityId ?? obj.city);
    if (ctId) cityIds.add(ctId);

    // Pincode
    const pId = parseSafeId(obj.pincode_id ?? obj.pincodeId ?? obj.pincode);
    if (pId) pincodeIds.add(pId);

    // Role
    const rId = parseSafeId(obj.role_id ?? obj.roleId ?? obj.role);
    if (rId) roleIds.add(rId);
  };

  logs.forEach((log) => {
    let detailsObj = log.details;
    if (typeof detailsObj === "string") {
      try {
        detailsObj = JSON.parse(detailsObj);
      } catch (e) {}
    }
    if (detailsObj && typeof detailsObj === "object") {
      let oldData = detailsObj.oldData || detailsObj.olddata;
      let newData = detailsObj.newData || detailsObj.newdata;
      if (typeof oldData === "string") {
        try {
          oldData = JSON.parse(oldData);
        } catch (e) {}
      }
      if (typeof newData === "string") {
        try {
          newData = JSON.parse(newData);
        } catch (e) {}
      }

      collectIds(oldData);
      collectIds(newData);
      collectIds(detailsObj);

      detailsObj.oldData = oldData;
      detailsObj.newData = newData;

      if (log.target_user && (!oldData?.role_id && !oldData?.roleId && !oldData?.role_name)) {
        targetUserIds.add(log.target_user);
      }
    }
    log._parsedDetails = detailsObj;
  });

  const namesMap = {
    countries: {},
    states: {},
    cities: {},
    pincodes: {},
    roles: {},
    userRoles: {},
  };

  try {
    const queries = [];

    if (countryIds.size > 0) {
      queries.push(
        pool
          .query("SELECT id, name FROM countries WHERE id = ANY($1::uuid[])", [
            Array.from(countryIds),
          ])
          .then((res) =>
            res.rows.forEach((r) => (namesMap.countries[r.id] = r.name))
          )
      );
    }
    if (stateIds.size > 0) {
      queries.push(
        pool
          .query("SELECT id, name FROM states WHERE id = ANY($1::uuid[])", [
            Array.from(stateIds),
          ])
          .then((res) =>
            res.rows.forEach((r) => (namesMap.states[r.id] = r.name))
          )
      );
    }
    if (cityIds.size > 0) {
      queries.push(
        pool
          .query("SELECT id, name FROM cities WHERE id = ANY($1::uuid[])", [
            Array.from(cityIds),
          ])
          .then((res) =>
            res.rows.forEach((r) => (namesMap.cities[r.id] = r.name))
          )
      );
    }
    if (pincodeIds.size > 0) {
      queries.push(
        pool
          .query(
            "SELECT id, pincode AS name FROM pincodes WHERE id = ANY($1::uuid[])",
            [Array.from(pincodeIds)]
          )
          .then((res) =>
            res.rows.forEach((r) => (namesMap.pincodes[r.id] = r.name))
          )
      );
    }
    if (roleIds.size > 0) {
      queries.push(
        pool
          .query("SELECT id, name FROM roles WHERE id = ANY($1)", [
            Array.from(roleIds),
          ])
          .then((res) =>
            res.rows.forEach((r) => (namesMap.roles[r.id] = r.name))
          )
      );
    }
    if (targetUserIds.size > 0) {
      queries.push(
        pool
          .query(
            `SELECT u.id, r.name AS role_name
             FROM users u
             LEFT JOIN roles r ON r.id = u.role_id
             WHERE u.id = ANY($1)`,
            [Array.from(targetUserIds)]
          )
          .then((res) =>
            res.rows.forEach((r) => (namesMap.userRoles[r.id] = r.role_name))
          )
      );
    }

    await Promise.all(queries);
  } catch (err) {
    console.error("Error resolving names for activity log:", err);
  }

  const transformObject = (obj, fallbackRole) => {
    if (!obj || typeof obj !== "object") return obj;

    // City Name
    const ctId = parseSafeId(
      obj.city_id ?? obj.cityId ?? obj.city_name ?? obj.city
    );
    if (ctId && namesMap.cities[ctId]) {
      obj.city_name = namesMap.cities[ctId];
    } else if (obj.city && typeof obj.city === "string" && !obj.city_name) {
      obj.city_name = obj.city;
    }
    delete obj.city_id;
    delete obj.cityId;
    delete obj.city;

    // State Name
    const sId = parseSafeId(
      obj.state_id ?? obj.stateId ?? obj.state_name ?? obj.state
    );
    if (sId && namesMap.states[sId]) {
      obj.state_name = namesMap.states[sId];
    } else if (obj.state && typeof obj.state === "string" && !obj.state_name) {
      obj.state_name = obj.state;
    }
    delete obj.state_id;
    delete obj.stateId;
    delete obj.state;

    // Country Name
    const cId = parseSafeId(
      obj.country_id ?? obj.countryId ?? obj.country_name ?? obj.country
    );
    if (cId && namesMap.countries[cId]) {
      obj.country_name = namesMap.countries[cId];
    } else if (
      obj.country &&
      typeof obj.country === "string" &&
      !obj.country_name
    ) {
      obj.country_name = obj.country;
    }
    delete obj.country_id;
    delete obj.countryId;
    delete obj.country;

    // Pincode Name
    const pId = parseSafeId(
      obj.pincode_id ?? obj.pincodeId ?? obj.pincode_name ?? obj.pincode
    );
    if (pId && namesMap.pincodes[pId]) {
      obj.pincode_name = namesMap.pincodes[pId];
    } else if (
      obj.pincode &&
      typeof obj.pincode === "string" &&
      !obj.pincode_name
    ) {
      obj.pincode_name = obj.pincode;
    }
    delete obj.pincode_id;
    delete obj.pincodeId;
    delete obj.pincode;

    // Role Name
    const rId = parseSafeId(
      obj.role_id ?? obj.roleId ?? obj.role_name ?? obj.role
    );
    if (rId && namesMap.roles[rId]) {
      obj.role_name = namesMap.roles[rId];
    } else if (fallbackRole && !obj.role_name) {
      obj.role_name = fallbackRole;
    } else if (obj.role && typeof obj.role === "string" && !obj.role_name) {
      obj.role_name = obj.role;
    }
    delete obj.role_id;
    delete obj.roleId;
    delete obj.role;

    return obj;
  };

  logs.forEach((log) => {
    if (log._parsedDetails) {
      const fallbackRole =
        namesMap.userRoles[log.target_user] ||
        (log._parsedDetails.newData &&
          namesMap.roles[
            parseSafeId(
              log._parsedDetails.newData.role_id ??
                log._parsedDetails.newData.roleId
            )
          ]);

      if (log._parsedDetails.oldData) {
        transformObject(log._parsedDetails.oldData, fallbackRole);
      }
      if (log._parsedDetails.newData) {
        transformObject(log._parsedDetails.newData, fallbackRole);
      }
      transformObject(log._parsedDetails, fallbackRole);
      log.details = log._parsedDetails;
    }
    delete log._parsedDetails;
  });

  return logs;
};

// Get activity logs
const getActivityLogs = async (userId, role) => {
  let query = `
    SELECT
      al.id,
      al.performed_by,
      al.action,
      al.target_user,
      al.details,
      al.created_at,
      COALESCE(a.name, u.name) AS performed_by_name,
      COALESCE(
        CASE 
          WHEN a.role = 'general_admin' THEN 'General Admin'
          WHEN a.role = 'admin' THEN 'Admin'
          ELSE NULL
        END,
        r.name,
        'General Admin'
      ) AS performed_by_role,
      target.name AS target_user_name
    FROM activity_log al
    LEFT JOIN admin a
      ON al.performed_by = a.id
    LEFT JOIN users u
      ON al.performed_by = u.id
    LEFT JOIN roles r
      ON u.role_id = r.id
    LEFT JOIN users target
      ON al.target_user = target.id
  `;

  const params = [];

  if (userId && role) {
    params.push(userId);

    query += `
      WHERE (
        u.id = $1
        OR a.id = $1
      )
    `;
  }

  query += ` ORDER BY al.created_at DESC`;

  const result = await pool.query(query, params);

  return await resolveLogNames(pool, result.rows);
};

// Get activity history for a selected user in User 360
const getUserActivityHistory = async (
  targetUserId,
  requesterId,
  role
) => {
  const query = `
    SELECT
      al.id,
      al.performed_by,
      al.action,
      al.target_user,
      al.details,
      al.created_at,
      COALESCE(performer_admin.name, performer_user.name)
        AS performed_by_name,
      target.name AS target_user_name
    FROM activity_log al
    LEFT JOIN admin performer_admin
      ON al.performed_by = performer_admin.id
    LEFT JOIN users performer_user
      ON al.performed_by = performer_user.id
    LEFT JOIN users target
      ON al.target_user = target.id
    WHERE al.target_user = $1
      AND EXISTS (
        SELECT 1
        FROM users scoped_user
        WHERE scoped_user.id = al.target_user
          AND (
            $3 = 'general_admin'
            OR (
              $3 = 'admin'
              AND (
                scoped_user.admin_id = $2
                OR scoped_user.admin_id = (
                  SELECT requester.admin_id
                  FROM users requester
                  WHERE requester.id = $2
                )
              )
            )
            OR (
              $3 = 'employee'
              AND scoped_user.id = $2
            )
          )
      )
    ORDER BY al.created_at DESC
  `;

  const result = await pool.query(query, [
    targetUserId,
    requesterId,
    role,
  ]);

  return await resolveLogNames(pool, result.rows);
};

module.exports = {
  createActivityLog,
  getActivityLogs,
  getUserActivityHistory,
};