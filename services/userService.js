const pool = require("../config/databse");
const { decodeUUIDToId } = require("../utils/uuidUtils");
const bcrypt = require("bcrypt");
const { createActivityLog } = require("./activityLogService");
const {
  createAdminNotification,
  createEmployeeNotification,
} = require("./notificationService");
const databaseApprovalService = require("./databaseApprovalService");

// Get all users with pagination and filtering
const getUsers = async (
  userId,
  role,
  page = 1,
  limit = 5,
  status = "",
  search = "",
) => {
  const offset = (page - 1) * limit;

  let baseQuery = "";
  let baseParams = [];

  if (role === "admin" || role === "employee") {
    baseQuery = `
      SELECT
        u.id,
        u.name,
        u.email,
        u.age,
        u.role,
        u.is_active,
        u.created_at,
        u.admin_id,
        u.country_id,
        u.state_id,
        u.city_id,
        u.pincode_id,
        u.role_id,
        r.name AS permission_role,
        co.name AS country_name,
        s.name AS state_name,
        c.name AS city_name,
        p.pincode
      FROM users u
      LEFT JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN countries co
        ON co.id = u.country_id
      LEFT JOIN states s
        ON s.id = u.state_id
      LEFT JOIN cities c
        ON c.id = u.city_id
      LEFT JOIN pincodes p
        ON p.id = u.pincode_id
      WHERE (
        u.admin_id = $1
        OR u.admin_id = (SELECT admin_id FROM users WHERE id = $1)
      )

      UNION ALL

      SELECT
        a.id,
        a.name,
        a.email,
        a.age,
        a.role,
        a.is_active,
        a.created_at,
          NULL::uuid AS admin_id,
        NULL::uuid AS country_id,
        NULL::uuid AS state_id,
        NULL::uuid AS city_id,
        NULL::uuid AS pincode_id,
        a.role_id,
        r.name AS permission_role,
        NULL::varchar AS country_name,
        NULL::varchar AS state_name,
        NULL::varchar AS city_name,
        NULL::varchar AS pincode
      FROM admin a
      LEFT JOIN roles r
        ON r.id = a.role_id
      WHERE (
        a.id = $1
        OR a.id = (SELECT admin_id FROM users WHERE id = $1)
      )
    `;

    baseParams.push(userId);
  } else if (role === "general_admin") {
    baseQuery = `
      SELECT
        u.id,
        u.name,
        u.email,
        u.age,
        u.role,
        u.is_active,
        u.created_at,
        u.admin_id,
        u.country_id,
        u.state_id,
        u.city_id,
        u.pincode_id,
        u.role_id,
        r.name AS permission_role,
        co.name AS country_name,
        s.name AS state_name,
        c.name AS city_name,
        p.pincode
      FROM users u
      LEFT JOIN roles r
        ON r.id = u.role_id
      LEFT JOIN countries co
        ON co.id = u.country_id
      LEFT JOIN states s
        ON s.id = u.state_id
      LEFT JOIN cities c
        ON c.id = u.city_id
      LEFT JOIN pincodes p
        ON p.id = u.pincode_id

      UNION ALL

      SELECT
        a.id,
        a.name,
        a.email,
        a.age,
        a.role,
        a.is_active,
        a.created_at,
          NULL::uuid AS admin_id,
        NULL::uuid AS country_id,
        NULL::uuid AS state_id,
        NULL::uuid AS city_id,
        NULL::uuid AS pincode_id,
        a.role_id,
        r.name AS permission_role,
        NULL::varchar AS country_name,
        NULL::varchar AS state_name,
        NULL::varchar AS city_name,
        NULL::varchar AS pincode
      FROM admin a
      LEFT JOIN roles r
        ON r.id = a.role_id
    `;
  }

  let whereClauses = [];
  let queryParams = [...baseParams];

  const statusNormalized = (status || "").toLowerCase().trim();

  if (statusNormalized === "active") {
    whereClauses.push(`sub.is_active = true`);
  } else if (statusNormalized === "inactive") {
    whereClauses.push(`sub.is_active = false`);
  } else if (statusNormalized === "admin") {
    whereClauses.push(`sub.role = 'admin'`);
  } else if (statusNormalized === "employee") {
    whereClauses.push(`sub.role = 'employee'`);
  }

  if (search && search.trim()) {
    queryParams.push(`%${search.trim().toLowerCase()}%`);

    const pIndex = queryParams.length;

    whereClauses.push(`(
      LOWER(sub.name) LIKE $${pIndex} OR
      LOWER(sub.email) LIKE $${pIndex} OR
      CAST(sub.age AS TEXT) LIKE $${pIndex} OR
      LOWER(COALESCE(sub.country_name, '')) LIKE $${pIndex} OR
      LOWER(COALESCE(sub.state_name, '')) LIKE $${pIndex} OR
      LOWER(COALESCE(sub.city_name, '')) LIKE $${pIndex} OR
      LOWER(COALESCE(sub.pincode, '')) LIKE $${pIndex} OR
      LOWER(sub.role) LIKE $${pIndex} OR
      LOWER(COALESCE(sub.permission_role, '')) LIKE $${pIndex}
    )`);
  }

  const whereSql =
    whereClauses.length > 0
      ? `WHERE ${whereClauses.join(" AND ")}`
      : "";

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM (${baseQuery}) sub
    ${whereSql}
  `;

  const countResult = await pool.query(
    countQuery,
    queryParams,
  );

  queryParams.push(limit);

  const limitParam = queryParams.length;

  queryParams.push(offset);

  const offsetParam = queryParams.length;

  const dataQuery = `
    SELECT *
    FROM (${baseQuery}) sub
    ${whereSql}
    ORDER BY sub.id DESC
    LIMIT $${limitParam}
    OFFSET $${offsetParam}
  `;

  const result = await pool.query(
    dataQuery,
    queryParams,
  );

  const totalRecords = parseInt(
    countResult.rows[0]?.total || 0,
    10,
  );

  const totalPages = Math.ceil(
    totalRecords / limit,
  );

  const rangeStart =
    totalRecords === 0
      ? 0
      : offset + 1;

  const rangeEnd = Math.min(
    offset + limit,
    totalRecords,
  );

  return {
    users: result.rows,
    page,
    limit,
    totalRecords,
    totalPages,
    range: `${rangeStart}-${rangeEnd}`,
  };
};

// Get user by id
const getUserById = async (id) => {
  const result = await pool.query(
    `SELECT
      u.id,
      u.name,
      u.email,
      u.age,
      u.role,
      u.is_active,
      u.created_at,
        u.admin_id,
      u.admin_id,
      adm.name AS admin_name,
      u.register_id,
      u.country_id,
      u.state_id,
      u.city_id,
      u.pincode_id,
      u.role_id,
      co.name AS country_name,
      s.name AS state_name,
      c.name AS city_name,
      p.pincode
    FROM users u
    LEFT JOIN admin adm
      ON adm.id = u.admin_id
    LEFT JOIN countries co
      ON co.id = u.country_id
    LEFT JOIN states s
      ON s.id = u.state_id
    LEFT JOIN cities c
      ON c.id = u.city_id
    LEFT JOIN pincodes p
      ON p.id = u.pincode_id
    WHERE u.id = $1
    UNION ALL
    SELECT
      a.id,
      a.name,
      a.email,
      a.age,
      a.role,
      a.is_active,
      a.created_at,
          NULL::uuid AS admin_id,
      a.general_admin_id AS admin_id,
      ga.name AS admin_name,
      a.register_id,
      a.country_id,
      a.state_id,
      a.city_id,
      a.pincode_id,
      a.role_id,
      co.name AS country_name,
      s.name AS state_name,
      c.name AS city_name,
      p.pincode
    FROM admin a
    LEFT JOIN admin ga
      ON ga.id = a.general_admin_id
    LEFT JOIN countries co
      ON co.id = a.country_id
    LEFT JOIN states s
      ON s.id = a.state_id
    LEFT JOIN cities c
      ON c.id = a.city_id
    LEFT JOIN pincodes p
      ON p.id = a.pincode_id
    WHERE a.id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "User not found",
    };
  }

  return {
    success: true,
    user: result.rows[0],
  };
};

// Add user
// Add user
const addUser = async (
  name,
  email,
  password,
  age,
  role = "employee",
  is_active = true,
  adminId,
  performedBy,
  countryId,
  stateId,
  cityId,
  pincodeId,
  roleId,
) => {
  const existingUser = await pool.query(
    "SELECT * FROM register WHERE email = $1",
    [email],
  );

  if (existingUser.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "Email already exists",
    };
  }

  if (!password) {
    return {
      success: false,
      status: 400,
      message: "Password is required",
    };
  }

  if (roleId) {
  const roleResult = await pool.query(
    `SELECT id
     FROM roles
     WHERE id = $1`,
    [roleId],
  );

  if (roleResult.rows.length === 0) {
    return {
      success: false,
      status: 400,
      message: "Invalid permissions role",
    };
  }
} else {
  const normalizedRole = (role || "employee").replace(/_/g, " ").toLowerCase();
  let roleResult = await pool.query(
    `SELECT id
     FROM roles
     WHERE LOWER(name) = $1
     LIMIT 1`,
    [normalizedRole],
  );

  if (roleResult.rows.length === 0) {
    roleResult = await pool.query(
      `SELECT id
       FROM roles
       WHERE LOWER(name) LIKE $1
       LIMIT 1`,
      [`%${normalizedRole}%`],
    );
  }

  if (roleResult.rows.length === 0) {
    return {
      success: false,
      status: 400,
      message: `Invalid role: ${role}`,
    };
  }

  roleId = roleResult.rows[0].id;
}

  const hashedPassword = await bcrypt.hash(password, 10);

  if (role === "admin") {
    const registerResult = await pool.query(
      `INSERT INTO register
      (
        name,
        email,
        age,
        role,
        password,
        is_active,
        role_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING id`,
      [
        name,
        email,
        age,
        "admin",
        hashedPassword,
        is_active,
        roleId,
      ],
    );

    const registerId = registerResult.rows[0].id;

    const adminResult = await pool.query(
      `INSERT INTO admin
      (
        name,
        email,
        age,
        role,
        password,
        is_active,
        general_admin_id,
        register_id,
        country_id,
        state_id,
        city_id,
        pincode_id,
        role_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        name,
        email,
        age,
        "admin",
        hashedPassword,
        is_active,
        adminId,
        registerId,
        countryId || null,
        stateId || null,
        cityId || null,
        pincodeId || null,
        roleId,
      ],
    );

    if (adminId) {
      await createAdminNotification(
        adminId,
        "Admin Created",
        `${name} has been created as a new admin.`,
        "admin_created",
      );
    }

    await createAdminNotification(
      adminResult.rows[0].id,
      "Admin Account Created",
      `Welcome ${name}! Your admin account has been created.`,
      "admin_created",
    );

    return {
      success: true,
      status: 201,
      message: "Admin created successfully",
      user: adminResult.rows[0],
    };
  }

  if (role === "employee" && !adminId) {
    return {
      success: false,
      status: 400,
      message: "Admin ID is required",
    };
  }

  if (role === "employee") {
    if (!countryId || !stateId || !cityId || !pincodeId) {
      return {
        success: false,
        status: 400,
        message: "Country, state, city and pincode are required",
      };
    }

    const countryResult = await pool.query(
      `SELECT id
       FROM countries
       WHERE id = $1
       AND is_active = true`,
      [countryId],
    );

    if (countryResult.rows.length === 0) {
      return {
        success: false,
        status: 400,
        message: "Invalid or inactive country",
      };
    }

    const stateResult = await pool.query(
      `SELECT id
       FROM states
       WHERE id = $1
       AND country_id = $2
       AND is_active = true`,
      [stateId, countryId],
    );

    if (stateResult.rows.length === 0) {
      return {
        success: false,
        status: 400,
        message: "State does not belong to the selected country",
      };
    }

    const cityResult = await pool.query(
      `SELECT id
       FROM cities
       WHERE id = $1
       AND state_id = $2
       AND is_active = true`,
      [cityId, stateId],
    );

    if (cityResult.rows.length === 0) {
      return {
        success: false,
        status: 400,
        message: "City does not belong to the selected state",
      };
    }

    const pincodeResult = await pool.query(
      `SELECT id
       FROM pincodes
       WHERE id = $1
       AND city_id = $2
       AND is_active = true`,
      [pincodeId, cityId],
    );

    if (pincodeResult.rows.length === 0) {
      return {
        success: false,
        status: 400,
        message: "Pincode does not belong to the selected city",
      };
    }
  }

  const registerResult = await pool.query(
    `INSERT INTO register
    (
      name,
      email,
      age,
      role,
      password,
      is_active,
      country_id,
      state_id,
      city_id,
      pincode_id,
      role_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING id`,
    [
      name,
      email,
      age,
      role,
      hashedPassword,
      is_active,
      countryId,
      stateId,
      cityId,
      pincodeId,
      roleId,
    ],
  );

  const registerId = registerResult.rows[0].id;

  const userResult = await pool.query(
    `INSERT INTO users
    (
      name,
      email,
      password,
      age,
      role,
      is_active,
      admin_id,
      register_id,
      country_id,
      state_id,
      city_id,
      pincode_id,
      role_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *`,
    [
      name,
      email,
      hashedPassword,
      age,
      role,
      is_active,
      adminId,
      registerId,
      countryId,
      stateId,
      cityId,
      pincodeId,
      roleId,
    ],
  );

  await createActivityLog(
    performedBy,
    "CREATE_EMPLOYEE",
    userResult.rows[0].id,
    {
      name: userResult.rows[0].name,
      email: userResult.rows[0].email,
      age: userResult.rows[0].age,
      adminId: adminId,
      countryId: countryId,
      stateId: stateId,
      cityId: cityId,
      pincodeId: pincodeId,
      roleId: roleId,
    },
  );

  await pool.query(
    `UPDATE admin
     SET employee_count = employee_count + 1
     WHERE id = $1`,
    [adminId],
  );

  await createAdminNotification(
    adminId,
    "User Created",
    `${name} has been added as a new employee.`,
    "user_created",
  );

  await createEmployeeNotification(
    userResult.rows[0].id,
    "Account Created",
    `Welcome ${name}! Your employee account has been created.`,
    "user_created",
  );

  return {
    success: true,
    status: 201,
    message: "Employee created successfully",
    user: userResult.rows[0],
  };
};

// Update employee
const updateUser = async (
  id,
  name,
  email,
  age,
  role,
  is_active,
  performedBy,
  countryId,
  stateId,
  cityId,
  pincodeId,
  roleId,
  adminId,
  requireApproval = false,
  currentUser = null,
) => {
  const isUUID = (val) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      String(val || "").trim()
    );

  const parseSafeId = (val) => {
    if (val === undefined || val === null || val === "") return null;
    const trimmed = typeof val === "string" ? val.trim() : val;
    if (isUUID(trimmed)) return trimmed;
    const decoded = decodeUUIDToId(trimmed);
    if (typeof decoded === "number") return decoded;
    if (isUUID(decoded)) return decoded;
    if (typeof decoded === "string" && /^\d+$/.test(decoded.trim())) {
      const parsed = parseInt(decoded.trim(), 10);
      return !isNaN(parsed) ? parsed : decoded;
    }
    return decoded;
  };

  id = parseSafeId(id);
  countryId = parseSafeId(countryId);
  stateId = parseSafeId(stateId);
  cityId = parseSafeId(cityId);
  pincodeId = parseSafeId(pincodeId);
  roleId = parseSafeId(roleId);
  adminId = parseSafeId(adminId);

  const existingUser = await pool.query(
    "SELECT * FROM users WHERE id = $1",
    [id],
  );

  if (existingUser.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "User not found",
    };
  }

  const duplicateEmail = await pool.query(
    "SELECT * FROM users WHERE email = $1 AND id != $2",
    [email, id],
  );

  if (duplicateEmail.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "Email already exists",
    };
  }

  if (role === "employee") {
    if (!countryId || !stateId || !cityId || !pincodeId) {
      return {
        success: false,
        status: 400,
        message: "Country, state, city and pincode are required",
      };
    }

    const countryResult = await pool.query(
      `SELECT id
       FROM countries
       WHERE id = $1
       AND is_active = true`,
      [countryId],
    );

    if (countryResult.rows.length === 0) {
      return {
        success: false,
        status: 400,
        message: "Invalid or inactive country",
      };
    }

    const stateResult = await pool.query(
      `SELECT id
       FROM states
       WHERE id = $1
       AND country_id = $2
       AND is_active = true`,
      [stateId, countryId],
    );

    if (stateResult.rows.length === 0) {
      return {
        success: false,
        status: 400,
        message: "State does not belong to the selected country",
      };
    }

    const cityResult = await pool.query(
      `SELECT id
       FROM cities
       WHERE id = $1
       AND state_id = $2
       AND is_active = true`,
      [cityId, stateId],
    );

    if (cityResult.rows.length === 0) {
      return {
        success: false,
        status: 400,
        message: "City does not belong to the selected state",
      };
    }

    const pincodeResult = await pool.query(
      `SELECT id
       FROM pincodes
       WHERE id = $1
       AND city_id = $2
       AND is_active = true`,
      [pincodeId, cityId],
    );

    if (pincodeResult.rows.length === 0) {
      return {
        success: false,
        status: 400,
        message: "Pincode does not belong to the selected city",
      };
    }
  }

  const oldUser = existingUser.rows[0];
  const oldStatus = oldUser.is_active;
  const currentAdminId = oldUser.admin_id;

  const targetAdminId =
    role === "employee"
      ? (adminId !== undefined && adminId !== "" ? adminId : currentAdminId)
      : null;

  // Maker-Checker approval workflow (Bytebase): If requireApproval is requested, save old/new data and hold live change
  if (requireApproval) {
    const diffFields = [];

    // Helper to get admin names
    let oldAdminName = "None";
    let newAdminName = "None";
    if (oldUser.admin_id) {
      try {
        const oldAdm = await pool.query("SELECT name FROM admin WHERE id = $1", [oldUser.admin_id]);
        if (oldAdm.rows.length > 0) oldAdminName = oldAdm.rows[0].name;
      } catch {}
    }
    if (targetAdminId) {
      try {
        const newAdm = await pool.query("SELECT name FROM admin WHERE id = $1", [targetAdminId]);
        if (newAdm.rows.length > 0) newAdminName = newAdm.rows[0].name;
      } catch {}
    }

    // Helper to get role names
    let oldRoleName = oldUser.role || "employee";
    let newRoleName = role || "employee";
    if (oldUser.role_id) {
      try {
        const rOld = await pool.query("SELECT name FROM roles WHERE id = $1", [oldUser.role_id]);
        if (rOld.rows.length > 0) oldRoleName = rOld.rows[0].name;
      } catch {}
    }
    if (roleId) {
      try {
        const rNew = await pool.query("SELECT name FROM roles WHERE id = $1", [roleId]);
        if (rNew.rows.length > 0) newRoleName = rNew.rows[0].name;
      } catch {}
    }

    if (String(targetAdminId || "") !== String(oldUser.admin_id || "")) {
      diffFields.push({
        field: "Assigned Admin",
        fieldKey: "admin_id",
        oldValue: oldAdminName,
        newValue: newAdminName,
      });
    }

    if (String(roleId || "") !== String(oldUser.role_id || "")) {
      diffFields.push({
        field: "Role",
        fieldKey: "role_id",
        oldValue: oldRoleName,
        newValue: newRoleName,
      });
    }

    if (Boolean(is_active) !== Boolean(oldUser.is_active)) {
      diffFields.push({
        field: "Account Status",
        fieldKey: "is_active",
        oldValue: oldUser.is_active ? "Active" : "Inactive",
        newValue: is_active ? "Active" : "Inactive",
      });
    }

    if (name && name !== oldUser.name) {
      diffFields.push({
        field: "Name",
        fieldKey: "name",
        oldValue: oldUser.name,
        newValue: name,
      });
    }

    if (email && email !== oldUser.email) {
      diffFields.push({
        field: "Email",
        fieldKey: "email",
        oldValue: oldUser.email,
        newValue: email,
      });
    }

    if (age && Number(age) !== Number(oldUser.age)) {
      diffFields.push({
        field: "Age",
        fieldKey: "age",
        oldValue: String(oldUser.age),
        newValue: String(age),
      });
    }

    const changeSummary =
      diffFields.map((d) => `${d.field}: '${d.oldValue}' ➔ '${d.newValue}'`).join(", ") ||
      "User profile details update";

    const changeRecord = await databaseApprovalService.createChangeRequest({
      moduleName: "USER_MANAGEMENT",
      tableName: "users",
      recordId: String(id),
      recordIdentifier: `${oldUser.name} (${oldUser.email})`,
      changeType: "UPDATE",
      changeSummary,
      oldData: {
        name: oldUser.name,
        email: oldUser.email,
        age: oldUser.age,
        role: oldUser.role,
        is_active: oldUser.is_active,
        admin_id: oldUser.admin_id,
        admin_name: oldAdminName,
        role_id: oldUser.role_id,
        role_name: oldRoleName,
        country_id: oldUser.country_id,
        state_id: oldUser.state_id,
        city_id: oldUser.city_id,
        pincode_id: oldUser.pincode_id,
      },
      newData: {
        name,
        email,
        age,
        role: role || "employee",
        is_active: is_active ?? true,
        admin_id: targetAdminId,
        admin_name: newAdminName,
        role_id: roleId,
        role_name: newRoleName,
        country_id: countryId,
        state_id: stateId,
        city_id: cityId,
        pincode_id: pincodeId,
      },
      diffFields,
      user: currentUser || {
        userId: performedBy,
        name: "Admin User",
        role: "admin",
      },
    });

    return {
      success: true,
      status: 200,
      requiresApproval: true,
      message: "Change request submitted for Database Approval (Bytebase Workflow). Pending reviewer approval before taking effect.",
      requestCode: changeRecord.request_code,
      changeId: changeRecord.id,
      data: changeRecord,
    };
  }

  const result = await pool.query(
    `UPDATE users
     SET name = $1,
         email = $2,
         age = $3,
         role = $4,
         is_active = $5,
         country_id = $6,
         state_id = $7,
         city_id = $8,
         pincode_id = $9,
         role_id = $10,
         admin_id = $11
     WHERE id = $12
     RETURNING *`,
    [
      name,
      email,
      age,
      role || "employee",
      is_active ?? true,
      countryId,
      stateId,
      cityId,
      pincodeId,
      roleId,
      targetAdminId,
      id,
    ],
  );

  await pool.query(
    `UPDATE register
     SET name = $1,
         email = $2,
         age = $3,
         is_active = $4,
         country_id = $5,
         state_id = $6,
         city_id = $7,
         pincode_id = $8,
         role_id = $9
     WHERE id = $10`,
    [
      name,
      email,
      age,
      is_active ?? true,
      countryId,
      stateId,
      cityId,
      pincodeId,
      roleId,
      oldUser.register_id,
    ],
  );

  if (targetAdminId && currentAdminId && String(targetAdminId) !== String(currentAdminId)) {
    if (is_active) {
      await pool.query(
        `UPDATE admin
         SET employee_count = employee_count - 1
         WHERE id = $1
         AND employee_count > 0`,
        [currentAdminId],
      );
      await pool.query(
        `UPDATE admin
         SET employee_count = employee_count + 1
         WHERE id = $1`,
        [targetAdminId],
      );
    }
  } else if (targetAdminId) {
    if (oldStatus === true && is_active === false) {
      await pool.query(
        `UPDATE admin
         SET employee_count = employee_count - 1
         WHERE id = $1
         AND employee_count > 0`,
        [targetAdminId],
      );
    }

    if (oldStatus === false && is_active === true) {
      await pool.query(
        `UPDATE admin
         SET employee_count = employee_count + 1
         WHERE id = $1`,
        [targetAdminId],
      );
    }
  }

  await createActivityLog(
    performedBy,
    "UPDATE_EMPLOYEE",
    id,
    {
      oldData: {
        name: oldUser.name,
        email: oldUser.email,
        age: oldUser.age,
        is_active: oldUser.is_active,
        country_id: oldUser.country_id,
        state_id: oldUser.state_id,
        city_id: oldUser.city_id,
        pincode_id: oldUser.pincode_id,
        role_id: oldUser.role_id,
      },
      newData: {
        name,
        email,
        age,
        is_active,
        country_id: countryId,
        state_id: stateId,
        city_id: cityId,
        pincode_id: pincodeId,
        role_id: roleId,
      },
      adminId,
    },
  );

  if (roleId && String(oldUser.role_id) !== String(roleId)) {
    if (targetAdminId) {
      await createAdminNotification(
        targetAdminId,
        "Role Assigned",
        `Role for ${name} has been updated.`,
        "role_assigned",
      );
    }
    await createEmployeeNotification(
      id,
      "Role Assigned",
      `Your role has been updated.`,
      "role_assigned",
    );
  }

  if (targetAdminId) {
    if (oldStatus === true && is_active === false) {
      await createAdminNotification(
        targetAdminId,
        "User Deactivated",
        `${name} has been deactivated.`,
        "user_deactivated",
      );
    } else {
      await createAdminNotification(
        targetAdminId,
        "User Updated",
        `${name}'s user details have been updated.`,
        "user_updated",
      );
    }
  }

  if (oldStatus === true && is_active === false) {
    await createEmployeeNotification(
      id,
      "Account Deactivated",
      `Your account has been deactivated.`,
      "user_deactivated",
    );
  } else {
    await createEmployeeNotification(
      id,
      "Profile Updated",
      `Your user details have been updated.`,
      "user_updated",
    );
  }

  return {
    success: true,
    status: 200,
    message: "User updated successfully",
    user: result.rows[0],
  };
};

// Delete employee
const deleteUser = async (id, performedBy) => {
  const result = await pool.query(
    `UPDATE users
     SET is_active = false
     WHERE id = $1
     RETURNING *`,
    [id],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "User not found",
    };
  }

  await pool.query(
    `UPDATE admin
     SET employee_count = employee_count - 1
     WHERE id = $1
     AND employee_count > 0`,
    [result.rows[0].admin_id],
  );

  const actorId = performedBy || result.rows[0].admin_id;

  if (actorId) {
    try {
      await createActivityLog(
        actorId,
        "DEACTIVATE_EMPLOYEE",
        id,
        {
          name: result.rows[0].name,
          email: result.rows[0].email,
          age: result.rows[0].age,
          adminId: result.rows[0].admin_id,
        },
      );
    } catch (logErr) {
      console.error("Activity log error:", logErr);
    }
  }

  await createAdminNotification(
    result.rows[0].admin_id,
    "User Deactivated",
    `${result.rows[0].name} has been deactivated.`,
    "user_deactivated",
  );

  await createEmployeeNotification(
    id,
    "Account Deactivated",
    `Your account has been deactivated.`,
    "user_deactivated",
  );

  return {
    success: true,
    status: 200,
    message: "User deactivated successfully",
    user: result.rows[0],
  };
};

// Get admin
const getAdmins = async () => {
  const result = await pool.query(`
    SELECT
      a.*,
      COUNT(CASE WHEN u.is_active = true THEN 1 END) AS employee_count
    FROM admin a
    LEFT JOIN users u
      ON u.admin_id = a.id
      AND u.role = 'employee'
    WHERE a.role = 'admin'
    GROUP BY a.id
    ORDER BY a.id
  `);

  return result.rows;
};

// Get admin by id
const getAdminById = async (adminId) => {
  const adminResult = await pool.query(
    `SELECT
      id,
      name,
      email,
      age,
      role,
      is_active,
      created_at,
      general_admin_id,
      register_id
    FROM admin
    WHERE id = $1
    AND role = 'admin'`,
    [adminId],
  );

  if (adminResult.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Admin not found",
    };
  }

  const usersResult = await pool.query(
    `SELECT
      id,
      name,
      email,
      age,
      role,
      is_active,
      created_at,
      admin_id,
      register_id
    FROM users
    WHERE admin_id = $1
    ORDER BY id`,
    [adminId],
  );

  return {
    success: true,
    admin: adminResult.rows[0],
    users: usersResult.rows,
  };
};

// Update admin
const updateAdmin = async (
  id,
  name,
  email,
  age,
  is_active,
  countryId,
  stateId,
  cityId,
  pincodeId,
) => {
  const existingAdmin = await pool.query(
    `SELECT *
     FROM admin
     WHERE id = $1
     AND role = 'admin'`,
    [id],
  );

  if (existingAdmin.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Admin not found",
    };
  }

  const duplicateEmail = await pool.query(
    `SELECT id
     FROM admin
     WHERE email = $1
     AND id != $2`,
    [email, id],
  );

  if (duplicateEmail.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "Email already exists",
    };
  }

  const oldAdmin = existingAdmin.rows[0];

  const result = await pool.query(
    `UPDATE admin
     SET name = $1,
         email = $2,
         age = $3,
         is_active = $4,
         country_id = $6,
         state_id = $7,
         city_id = $8,
         pincode_id = $9
     WHERE id = $5
     AND role = 'admin'
     RETURNING *`,
    [
      name,
      email,
      age,
      is_active ?? true,
      id,
      countryId || null,
      stateId || null,
      cityId || null,
      pincodeId || null,
    ],
  );

  await pool.query(
    `UPDATE register
     SET name = $1,
         email = $2,
         age = $3,
         is_active = $4
     WHERE id = $5`,
    [
      name,
      email,
      age,
      is_active ?? true,
      oldAdmin.register_id,
    ],
  );

  if (oldAdmin.general_admin_id) {
    if (oldAdmin.is_active === true && is_active === false) {
      await createAdminNotification(
        oldAdmin.general_admin_id,
        "Admin Deactivated",
        `${name} has been deactivated.`,
        "admin_deactivated",
      );
    } else {
      await createAdminNotification(
        oldAdmin.general_admin_id,
        "Admin Updated",
        `${name}'s admin details have been updated.`,
        "admin_updated",
      );
    }
  }

  await createAdminNotification(
    id,
    "Admin Account Updated",
    `Your admin details have been updated.`,
    "admin_updated",
  );

  return {
    success: true,
    status: 200,
    message: "Admin updated successfully",
    admin: result.rows[0],
  };
};

// Delete admin
const deleteAdmin = async (id) => {
  const result = await pool.query(
    `UPDATE admin
     SET is_active = false
     WHERE id = $1
     AND role = 'admin'
     RETURNING *`,
    [id],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Admin not found",
    };
  }

  await pool.query(
    `UPDATE register
     SET is_active = false
     WHERE id = $1`,
    [result.rows[0].register_id],
  );

  if (result.rows[0].general_admin_id) {
    await createAdminNotification(
      result.rows[0].general_admin_id,
      "Admin Deactivated",
      `${result.rows[0].name} has been deactivated.`,
      "admin_deactivated",
    );
  }

  await createAdminNotification(
    id,
    "Admin Account Deactivated",
    `Your admin account has been deactivated.`,
    "admin_deactivated",
  );

  return {
    success: true,
    status: 200,
    message: "Admin deactivated successfully",
    admin: result.rows[0],
  };
};

// Bulk create employees
const bulkAddUsers = async (users, adminId, performedBy) => {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const createdUsers = [];

    for (const user of users) {
      const {
        name,
        email,
        age,
        password,
        country,
        state,
        city,
        pincode,
        rowNumber,
      } = user;

      const existingUser = await client.query(
        `SELECT id
         FROM register
         WHERE LOWER(email) = LOWER($1)`,
        [email],
      );

      if (existingUser.rows.length > 0) {
        const error = new Error(
          `Row ${rowNumber}: Email ${email} already exists. No users were added.`,
        );

        error.status = 409;

        throw error;
      }

      let countryId;
      let stateId;
      let cityId;
      let pincodeId;

      const pincodeResult = await client.query(
        `SELECT
          p.id AS pincode_id,
          p.pincode,
          p.city_id,
          c.state_id,
          s.country_id
        FROM pincodes p
        JOIN cities c
          ON c.id = p.city_id
        JOIN states s
          ON s.id = c.state_id
        JOIN countries co
          ON co.id = s.country_id
        WHERE LOWER(TRIM(p.pincode::text)) = LOWER(TRIM($1::text))
        AND p.is_active = true
        AND c.is_active = true
        AND s.is_active = true
        AND co.is_active = true`,
        [pincode],
      );

      if (pincodeResult.rows.length === 0) {
        const error = new Error(
          `Row ${rowNumber}: Pincode/Postal code "${pincode}" does not exist.`,
        );

        error.status = 400;

        throw error;
      }

      const pincodeLocation = pincodeResult.rows[0];

      pincodeId = pincodeLocation.pincode_id;
      cityId = pincodeLocation.city_id;
      stateId = pincodeLocation.state_id;
      countryId = pincodeLocation.country_id;

      if (country || state || city) {
        const countryResult = await client.query(
          `SELECT id
           FROM countries
           WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
           AND is_active = true`,
          [country],
        );

        if (countryResult.rows.length === 0) {
          const error = new Error(
            `Row ${rowNumber}: Country "${country}" not found or inactive`,
          );

          error.status = 400;

          throw error;
        }

        if (
          String(countryResult.rows[0].id) !==
          String(countryId)
        ) {
          const error = new Error(
            `Row ${rowNumber}: Pincode ${pincode} does not belong to country "${country}"`,
          );

          error.status = 400;

          throw error;
        }
      }

      if (state) {
        const stateResult = await client.query(
          `SELECT id
           FROM states
           WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
           AND country_id = $2
           AND is_active = true`,
          [state, countryId],
        );

        if (stateResult.rows.length === 0) {
          const error = new Error(
            `Row ${rowNumber}: State "${state}" does not belong to the selected country`,
          );

          error.status = 400;

          throw error;
        }

        if (
          String(stateResult.rows[0].id) !==
          String(stateId)
        ) {
          const error = new Error(
            `Row ${rowNumber}: Pincode ${pincode} does not belong to state "${state}"`,
          );

          error.status = 400;

          throw error;
        }
      }

      if (city) {
        const cityResult = await client.query(
          `SELECT id
           FROM cities
           WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
           AND state_id = $2
           AND is_active = true`,
          [city, stateId],
        );

        if (cityResult.rows.length === 0) {
          const error = new Error(
            `Row ${rowNumber}: City "${city}" does not belong to the selected state`,
          );

          error.status = 400;

          throw error;
        }

        if (
          String(cityResult.rows[0].id) !==
          String(cityId)
        ) {
          const error = new Error(
            `Row ${rowNumber}: Pincode ${pincode} does not belong to city "${city}"`,
          );

          error.status = 400;

          throw error;
        }
      }

      const hashedPassword = await bcrypt.hash(password, 10);

      const registerResult = await client.query(
        `INSERT INTO register
        (
          name,
          email,
          age,
          role,
          password,
          is_active,
          country_id,
          state_id,
          city_id,
          pincode_id
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10
        )
        RETURNING id`,
        [
          name,
          email,
          age,
          "employee",
          hashedPassword,
          true,
          countryId,
          stateId,
          cityId,
          pincodeId,
        ],
      );

      const registerId = registerResult.rows[0].id;

      const userResult = await client.query(
        `INSERT INTO users
        (
          name,
          email,
          password,
          age,
          role,
          is_active,
          admin_id,
          register_id,
          country_id,
          state_id,
          city_id,
          pincode_id
        )
        VALUES
        (
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9,
          $10,
          $11,
          $12
        )
        RETURNING *`,
        [
          name,
          email,
          hashedPassword,
          age,
          "employee",
          true,
          adminId,
          registerId,
          countryId,
          stateId,
          cityId,
          pincodeId,
        ],
      );

      const createdUser = userResult.rows[0];

      await createActivityLog(
        performedBy,
        "CREATE_EMPLOYEE",
        createdUser.id,
        {
          name: createdUser.name,
          email: createdUser.email,
          age: createdUser.age,
          adminId,
          countryId,
          stateId,
          cityId,
          pincodeId,
          roleId: createdUser.role_id,
          bulkCreated: true,
        },
      );

      createdUsers.push(createdUser);
    }

    await client.query(
      `UPDATE admin
       SET employee_count = employee_count + $1
       WHERE id = $2`,
      [createdUsers.length, adminId],
    );

    await client.query("COMMIT");

    if (createdUsers.length > 0) {
      await createAdminNotification(
        adminId,
        "Users Created",
        `${createdUsers.length} employees were added successfully.`,
        "user_bulk_created",
      );

      for (const cu of createdUsers) {
        await createEmployeeNotification(
          cu.id,
          "Account Created",
          `Welcome ${cu.name}! Your employee account has been created.`,
          "user_created",
        );
      }
    }

    return {
      success: true,
      status: 201,
      message: `${createdUsers.length} employees created successfully`,
      users: createdUsers,
    };
  } catch (error) {
    await client.query("ROLLBACK");

    console.error("BULK CREATE USERS ERROR:", error);

    throw error;
  } finally {
    client.release();
  }
};

// Exports
module.exports = {
  getUsers,
  getUserById,
  addUser,
  bulkAddUsers,
  updateUser,
  deleteUser,
  getAdmins,
  getAdminById,
  updateAdmin,
  deleteAdmin,
};