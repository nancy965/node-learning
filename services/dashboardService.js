const pool = require("../config/databse");

const getDashboardScope = (userId, role) => {
  let userScope = "";
  let adminScope = "";
  const params = [];

  if (role === "admin") {
    params.push(userId);

    userScope = `
      WHERE (
        u.admin_id = $1
        OR u.admin_id = (
          SELECT admin_id
          FROM users
          WHERE id = $1
        )
      )
    `;

    adminScope = `
      WHERE (
        a.id = $1
        OR a.id = (
          SELECT admin_id
          FROM users
          WHERE id = $1
        )
      )
    `;
  } else if (role === "general_admin") {
    userScope = "";
    adminScope = "";
  } else {
    params.push(userId);

    userScope = `WHERE u.id = $1`;
    adminScope = `WHERE false`;
  }

  return {
    userScope,
    adminScope,
    params,
  };
};

const getDashboardUsers = async (
  userId,
  role,
  page = 1,
  limit = 8,
  status = "all",
  search = "",
  roleFilter = "all",
  permissionRole = "all",
  fromDate = "",
  toDate = "",
  newThisMonth = false,
  adminId = "",
  employeeId = "",
) => {
  const offset = (page - 1) * limit;

  const { userScope, adminScope, params } = getDashboardScope(
    userId,
    role,
  );

  const baseQuery = `
    SELECT
      u.id,
      u.name,
      u.email,
      u.age,
      u.role,
      u.is_active,
      u.created_at,
      u.country_id,
      u.state_id,
      u.city_id,
      u.pincode_id,
      u.role_id,
      u.admin_id,
      r.name AS permission_role,
      co.name AS country_name,
      s.name AS state_name,
      c.name AS city_name,
      p.pincode
    FROM users u
    LEFT JOIN roles r ON r.id = u.role_id
    LEFT JOIN countries co ON co.id = u.country_id
    LEFT JOIN states s ON s.id = u.state_id
    LEFT JOIN cities c ON c.id = u.city_id
    LEFT JOIN pincodes p ON p.id = u.pincode_id
    ${userScope}

    UNION ALL

    SELECT
      a.id,
      a.name,
      a.email,
      a.age,
      a.role,
      a.is_active,
      a.created_at,
      a.country_id,
      a.state_id,
      a.city_id,
      a.pincode_id,
      a.role_id,
      a.id AS admin_id,
      r.name AS permission_role,
      co.name AS country_name,
      s.name AS state_name,
      c.name AS city_name,
      p.pincode
    FROM admin a
    LEFT JOIN roles r ON r.id = a.role_id
    LEFT JOIN countries co ON co.id = a.country_id
    LEFT JOIN states s ON s.id = a.state_id
    LEFT JOIN cities c ON c.id = a.city_id
    LEFT JOIN pincodes p ON p.id = a.pincode_id
    ${adminScope}
  `;

  const filters = [];
  const filterParams = [...params];

  if (adminId) {
    filterParams.push(adminId);
    filters.push(`dashboard_users.admin_id::text = $${filterParams.length}::text AND dashboard_users.role = 'employee'`);
  }
  if (employeeId) {
    filterParams.push(employeeId);
    filters.push(`dashboard_users.id::text = $${filterParams.length}::text`);
  }

  if (status && status !== "all") {
    filterParams.push(status === "active");

    filters.push(
      `dashboard_users.is_active = $${filterParams.length}`,
    );
  }

  if (roleFilter && roleFilter !== "all") {
    filterParams.push(roleFilter);

    filters.push(
      `LOWER(dashboard_users.role) = LOWER($${filterParams.length})`,
    );
  }

  if (permissionRole && permissionRole !== "all") {
    filterParams.push(permissionRole);

    filters.push(
      `dashboard_users.role_id = $${filterParams.length}`,
    );
  }

  if (fromDate) {
    filterParams.push(fromDate);

    filters.push(
      `dashboard_users.created_at >= $${filterParams.length}::date`,
    );
  }

  if (toDate) {
    filterParams.push(toDate);

    filters.push(
      `dashboard_users.created_at < ($${filterParams.length}::date + INTERVAL '1 day')`,
    );
  }

  if (newThisMonth) {
    filters.push(
      `dashboard_users.created_at >= date_trunc('month', CURRENT_DATE)`,
    );
  }


  if (search.trim()) {
    filterParams.push(`%${search.trim()}%`);

    const searchIndex = filterParams.length;

    filters.push(`
      (
        dashboard_users.name ILIKE $${searchIndex}
        OR dashboard_users.email ILIKE $${searchIndex}
        OR dashboard_users.role ILIKE $${searchIndex}
        OR dashboard_users.permission_role ILIKE $${searchIndex}
        OR dashboard_users.country_name ILIKE $${searchIndex}
        OR dashboard_users.state_name ILIKE $${searchIndex}
        OR dashboard_users.city_name ILIKE $${searchIndex}
        OR dashboard_users.pincode::text ILIKE $${searchIndex}
      )
    `);
  }

  const whereClause = filters.length
    ? `WHERE ${filters.join(" AND ")}`
    : "";

  const countQuery = `
    WITH dashboard_users AS (
      ${baseQuery}
    )
    SELECT COUNT(*)::int AS total
    FROM dashboard_users
    ${whereClause}
  `;

  const countResult = await pool.query(countQuery, filterParams);

  const totalRecords = countResult.rows[0]?.total || 0;

  const dataParams = [...filterParams];

  dataParams.push(limit);
  const limitIndex = dataParams.length;

  dataParams.push(offset);
  const offsetIndex = dataParams.length;

  const dataQuery = `
    WITH dashboard_users AS (
      ${baseQuery}
    )
    SELECT *
    FROM dashboard_users
    ${whereClause}
    ORDER BY created_at DESC, id DESC
    LIMIT $${limitIndex}
    OFFSET $${offsetIndex}
  `;

  const dataResult = await pool.query(dataQuery, dataParams);

  return {
    users: dataResult.rows,
    page,
    limit,
    totalRecords,
    totalPages: Math.ceil(totalRecords / limit),
  };
};

const getDashboardStats = async (
  userId,
  role,
  status = "all",
  search = "",
  roleFilter = "all",
  permissionRole = "all",
  fromDate = "",
  toDate = "",
  newThisMonth = false,
    adminId = "",
  employeeId = "",
) => {
  const { userScope, adminScope, params } = getDashboardScope(
    userId,
    role,
  );

  const filters = [];
  const filterParams = [...params];

  if (adminId) {
    filterParams.push(adminId);
    filters.push(`dashboard_users.admin_id::text = $${filterParams.length}::text AND dashboard_users.role = 'employee'`);
  }
  if (employeeId) {
    filterParams.push(employeeId);
    filters.push(`dashboard_users.id::text = $${filterParams.length}::text`);
  }

  if (status && status !== "all") {
    filterParams.push(status === "active");

    filters.push(
      `dashboard_users.is_active = $${filterParams.length}`,
    );
  }

  if (roleFilter && roleFilter !== "all") {
    filterParams.push(roleFilter);

    filters.push(
      `LOWER(dashboard_users.role) = LOWER($${filterParams.length})`,
    );
  }

  if (permissionRole && permissionRole !== "all") {
    filterParams.push(permissionRole);

    filters.push(
      `dashboard_users.role_id = $${filterParams.length}`,
    );
  }

  if (fromDate) {
    filterParams.push(fromDate);

    filters.push(
      `dashboard_users.created_at >= $${filterParams.length}::date`,
    );
  }

  if (toDate) {
    filterParams.push(toDate);

    filters.push(
      `dashboard_users.created_at < ($${filterParams.length}::date + INTERVAL '1 day')`,
    );
  }

  if (newThisMonth) {
    filters.push(
      `dashboard_users.created_at >= date_trunc('month', CURRENT_DATE)`,
    );
  }

  if (search.trim()) {
    filterParams.push(`%${search.trim()}%`);

    const searchIndex = filterParams.length;

    filters.push(`
      (
        dashboard_users.name ILIKE $${searchIndex}
        OR dashboard_users.email ILIKE $${searchIndex}
        OR dashboard_users.role ILIKE $${searchIndex}
        OR dashboard_users.permission_role ILIKE $${searchIndex}
      )
    `);
  }

  const whereClause = filters.length
    ? `WHERE ${filters.join(" AND ")}`
    : "";

  const query = `
    WITH dashboard_users AS (
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.is_active,
        u.created_at,
        u.role_id,
      u.admin_id,
        r.name AS permission_role
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      ${userScope}

      UNION ALL

      SELECT
        a.id,
        a.name,
        a.email,
        a.role,
        a.is_active,
        a.created_at,
        a.role_id,
      a.id AS admin_id,
        r.name AS permission_role
      FROM admin a
      LEFT JOIN roles r ON r.id = a.role_id
      ${adminScope}
    )
    SELECT
      COUNT(*)::int AS total_users,
      COUNT(*) FILTER (
        WHERE is_active = true
      )::int AS active_users,
      COUNT(*) FILTER (
        WHERE is_active = false
      )::int AS inactive_users,
      COUNT(*) FILTER (
        WHERE created_at >= date_trunc('month', CURRENT_DATE)
      )::int AS new_users
    FROM dashboard_users
    ${whereClause}
  `;

  const statsResult = await pool.query(query, filterParams);

  const stats = statsResult.rows[0] || {
    total_users: 0,
    active_users: 0,
    inactive_users: 0,
    new_users: 0,
  };

  const distributionQuery = `
    WITH dashboard_users AS (
      SELECT
        u.id,
        u.is_active,
        u.role,
        u.role_id,
      u.admin_id,
        u.created_at,
        u.name,
        u.email,
        r.name AS permission_role
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      ${userScope}

      UNION ALL

      SELECT
        a.id,
        a.is_active,
        a.role,
        a.role_id,
      a.id AS admin_id,
        a.created_at,
        a.name,
        a.email,
        r.name AS permission_role
      FROM admin a
      LEFT JOIN roles r ON r.id = a.role_id
      ${adminScope}
    )
    SELECT
      COUNT(*) FILTER (
        WHERE is_active = true
      )::int AS active_users,
      COUNT(*) FILTER (
        WHERE is_active = false
      )::int AS inactive_users
    FROM dashboard_users
    ${whereClause}
  `;

  const distributionResult = await pool.query(
    distributionQuery,
    filterParams,
  );

  const distribution = distributionResult.rows[0] || {
    active_users: 0,
    inactive_users: 0,
  };

  const roleQuery = `
    WITH dashboard_users AS (
      SELECT
        u.id,
        u.role,
        u.is_active,
        u.role_id,
      u.admin_id,
        u.created_at,
        u.name,
        u.email,
        r.name AS permission_role
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      ${userScope}

      UNION ALL

      SELECT
        a.id,
        a.role,
        a.is_active,
        a.role_id,
      a.id AS admin_id,
        a.created_at,
        a.name,
        a.email,
        r.name AS permission_role
      FROM admin a
      LEFT JOIN roles r ON r.id = a.role_id
      ${adminScope}
    )
    SELECT
      COALESCE(role, 'Unknown') AS name,
      COUNT(*)::int AS value
    FROM dashboard_users
    ${whereClause}
    GROUP BY COALESCE(role, 'Unknown')
    ORDER BY value DESC, name ASC
  `;

  const roleResult = await pool.query(
    roleQuery,
    filterParams,
  );

  const permissionRoleQuery = `
    WITH dashboard_users AS (
      SELECT
        u.id,
        u.role,
        u.is_active,
        u.role_id,
      u.admin_id,
        u.created_at,
        u.name,
        u.email,
        r.name AS permission_role
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      ${userScope}

      UNION ALL

      SELECT
        a.id,
        a.role,
        a.is_active,
        a.role_id,
      a.id AS admin_id,
        a.created_at,
        a.name,
        a.email,
        r.name AS permission_role
      FROM admin a
      LEFT JOIN roles r ON r.id = a.role_id
      ${adminScope}
    )
    SELECT
      COALESCE(permission_role, 'No Permission Role') AS name,
      COUNT(*)::int AS value
    FROM dashboard_users
    ${whereClause}
    GROUP BY COALESCE(permission_role, 'No Permission Role')
    ORDER BY value DESC, name ASC
  `;

  const permissionRoleResult = await pool.query(
    permissionRoleQuery,
    filterParams,
  );

  const trendQuery = `
    WITH months AS (
      SELECT
        generate_series(
          date_trunc('month', CURRENT_DATE) - INTERVAL '5 months',
          date_trunc('month', CURRENT_DATE),
          INTERVAL '1 month'
        ) AS month
    ),
    dashboard_users AS (
      SELECT
        u.id,
        u.created_at,
        u.role,
        u.is_active,
        u.role_id,
      u.admin_id,
        u.name,
        u.email,
        r.name AS permission_role
      FROM users u
      LEFT JOIN roles r ON r.id = u.role_id
      ${userScope}

      UNION ALL

      SELECT
        a.id,
        a.created_at,
        a.role,
        a.is_active,
        a.role_id,
      a.id AS admin_id,
        a.name,
        a.email,
        r.name AS permission_role
      FROM admin a
      LEFT JOIN roles r ON r.id = a.role_id
      ${adminScope}
    )
    SELECT
      TO_CHAR(months.month, 'Mon') AS month,
      COUNT(dashboard_users.created_at)::int AS count
    FROM months
    LEFT JOIN dashboard_users
      ON dashboard_users.created_at >= months.month
      AND dashboard_users.created_at < months.month + INTERVAL '1 month'
    ${whereClause.replace(
      "WHERE dashboard_users.",
      "WHERE dashboard_users.",
    )}
    GROUP BY months.month
    ORDER BY months.month
  `;

  const trendResult = await pool.query(
    trendQuery,
    filterParams,
  );

  const roleOptionsQuery = `
    SELECT DISTINCT role
    FROM (
      SELECT role
      FROM users
      ${role === "admin" ? "WHERE admin_id = $1 OR admin_id = (SELECT admin_id FROM users WHERE id = $1)" : role === "general_admin" ? "" : "WHERE id = $1"}

      UNION

      SELECT role
      FROM admin
      ${role === "admin" ? "WHERE id = $1 OR id = (SELECT admin_id FROM users WHERE id = $1)" : role === "general_admin" ? "" : "WHERE false"}
    ) role_data
    WHERE role IS NOT NULL
    ORDER BY role
  `;

  const roleOptionsResult = await pool.query(
    roleOptionsQuery,
    params,
  );

  const permissionRoleOptionsQuery = `
    SELECT DISTINCT
      r.id,
      r.name
    FROM roles r
    INNER JOIN (
      SELECT DISTINCT role_id
      FROM users u
      ${userScope}

      UNION

      SELECT DISTINCT role_id
      FROM admin a
      ${adminScope}
    ) assigned_roles
      ON assigned_roles.role_id = r.id
    WHERE r.name IS NOT NULL
    ORDER BY r.name
  `;

  const permissionRoleOptionsResult = await pool.query(
    permissionRoleOptionsQuery,
    params,
  );

  return {
    stats: {
      totalUsers: Number(stats.total_users),
      activeUsers: Number(stats.active_users),
      inactiveUsers: Number(stats.inactive_users),
      newUsers: Number(stats.new_users),
    },

    statusDistribution: [
      {
        name: "Active",
        value: Number(distribution.active_users),
      },
      {
        name: "Inactive",
        value: Number(distribution.inactive_users),
      },
    ],

    roleDistribution: roleResult.rows.map((item) => ({
      name: item.name,
      value: Number(item.value),
    })),

    permissionRoleDistribution: permissionRoleResult.rows.map(
      (item) => ({
        name: item.name,
        value: Number(item.value),
      }),
    ),

    roleOptions: roleOptionsResult.rows.map(
      (item) => item.role,
    ),

    permissionRoleOptions: permissionRoleOptionsResult.rows.map(
      (item) => ({
        id: item.id,
        name: item.name,
      }),
    ),

    registrationTrend: trendResult.rows.map((item) => ({
      month: item.month,
      count: Number(item.count),
    })),
  };
};

const getRecentActivity = async (
  limit = 8,
  filters = {},
  userId = null,
  role = null,
) => {
  const {
    status = "all",
    search = "",
    role: roleFilter = "all",
    permissionRole = "all",
    fromDate = "",
    toDate = "",
    newThisMonth = false,
    adminId = "",
    employeeId = "",
  } = filters;

  const params = [];
  const conditions = [];

  const addParam = (value) => {
    params.push(value);
    return `$${params.length}`;
  };

  if (adminId) {
    const adminParam = addParam(adminId);
    conditions.push(
      `(target_user.admin_id::text = ${adminParam}::text AND target_user.role = 'employee')`,
    );
  }

  if (employeeId) {
    const employeeParam = addParam(employeeId);
    conditions.push(`target_user.id::text = ${employeeParam}::text`);
  }

  if (status && status !== "all") {
    const statusParam = addParam(status === "active");

    conditions.push(
      `(
        target_user.is_active = ${statusParam}
        OR target_admin.is_active = ${statusParam}
      )`,
    );
  }

  if (roleFilter && roleFilter !== "all") {
    const roleParam = addParam(roleFilter);

    conditions.push(
      `(
        LOWER(target_user.role) = LOWER(${roleParam})
        OR LOWER(target_admin.role) = LOWER(${roleParam})
      )`,
    );
  }

  if (permissionRole && permissionRole !== "all") {
    const permissionRoleParam = addParam(permissionRole);

    conditions.push(
      `(
        target_user.role_id = ${permissionRoleParam}
        OR target_admin.role_id = ${permissionRoleParam}
      )`,
    );
  }

  if (fromDate) {
    const fromDateParam = addParam(fromDate);

    conditions.push(
      `al.created_at >= ${fromDateParam}::date`,
    );
  }

  if (toDate) {
    const toDateParam = addParam(toDate);

    conditions.push(
      `al.created_at < (${toDateParam}::date + INTERVAL '1 day')`,
    );
  }

  if (newThisMonth) {
    conditions.push(
      `al.created_at >= date_trunc('month', CURRENT_DATE)`,
    );
  }

  if (search.trim()) {
    const searchParam = addParam(`%${search.trim()}%`);

    conditions.push(`
      (
        target_user.name ILIKE ${searchParam}
        OR target_user.email ILIKE ${searchParam}
        OR target_user.role ILIKE ${searchParam}
        OR target_admin.name ILIKE ${searchParam}
        OR target_admin.email ILIKE ${searchParam}
        OR target_admin.role ILIKE ${searchParam}
        OR al.action ILIKE ${searchParam}
        OR al.details::text ILIKE ${searchParam}
      )
    `);
  }

  if (userId && role && role !== "general_admin") {
    if (role === "admin") {
      const scopeParam = addParam(userId);

      conditions.push(`
        (
          target_user.admin_id = ${scopeParam}
          OR target_user.admin_id = (
            SELECT admin_id
            FROM users
            WHERE id = ${scopeParam}
          )
          OR target_admin.id = ${scopeParam}
          OR target_admin.id = (
            SELECT admin_id
            FROM users
            WHERE id = ${scopeParam}
          )
        )
      `);
    } else {
      const scopeParam = addParam(userId);

      conditions.push(`
        (
          target_user.id = ${scopeParam}
          OR target_admin.id = ${scopeParam}
        )
      `);
    }
  }

  // Admins can only see activity performed by General Admins.
  if (role === "admin") {
    conditions.push(`
      performer_user.role = 'general_admin'
    `);
  }

  // Other non-General Admin roles cannot see activity logs.
  if (role && role !== "general_admin" && role !== "admin") {
    conditions.push(`false`);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const limitParam = addParam(limit);

  const result = await pool.query(
    `
      SELECT
        al.id,
        al.performed_by,
        al.action,
        al.target_user,
        al.details,
        al.created_at,
        COALESCE(
          performer_admin.name,
          performer_user.name
        ) AS performed_by_name,
        COALESCE(
          target_user.name,
          target_admin.name
        ) AS target_user_name
      FROM activity_log al

      LEFT JOIN admin performer_admin
        ON al.performed_by = performer_admin.id

      LEFT JOIN users performer_user
        ON al.performed_by = performer_user.id

      LEFT JOIN users target_user
        ON al.target_user = target_user.id

      LEFT JOIN admin target_admin
        ON al.target_user = target_admin.id

      ${whereClause}

      ORDER BY al.created_at DESC
      LIMIT ${limitParam}
    `,
    params,
  );

  const logs = result.rows;
  
  const ids = new Set();
  const extractIds = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    ['country_id', 'state_id', 'city_id', 'pincode_id', 'role_id'].forEach(k => {
      if (obj[k] && typeof obj[k] === 'string' && obj[k].length > 10) ids.add(obj[k]);
    });
  };

  logs.forEach(log => {
    let detailsObj = log.details;
    if (typeof detailsObj === 'string') {
      try { detailsObj = JSON.parse(detailsObj); } catch(e) {}
    }
    if (detailsObj && typeof detailsObj === 'object') {
      let oldData = detailsObj.oldData || detailsObj.olddata;
      let newData = detailsObj.newData || detailsObj.newdata;
      if (typeof oldData === 'string') { try { oldData = JSON.parse(oldData); } catch(e) {} }
      if (typeof newData === 'string') { try { newData = JSON.parse(newData); } catch(e) {} }
      extractIds(oldData);
      extractIds(newData);
      detailsObj.oldData = oldData;
      detailsObj.newData = newData;
    }
    log._parsedDetails = detailsObj;
  });

  if (ids.size > 0) {
    const idsArray = Array.from(ids);
    const namesMap = {};
    
    try {
      const queries = [
        pool.query('SELECT id, name FROM countries WHERE id = ANY($1)', [idsArray]),
        pool.query('SELECT id, name FROM states WHERE id = ANY($1)', [idsArray]),
        pool.query('SELECT id, name FROM cities WHERE id = ANY($1)', [idsArray]),
        pool.query('SELECT id, name FROM roles WHERE id = ANY($1)', [idsArray]),
        pool.query('SELECT id, pincode AS name FROM pincodes WHERE id = ANY($1)', [idsArray])
      ];

      const results = await Promise.all(queries);
      results.forEach(res => {
        if (res && res.rows) {
          res.rows.forEach(r => namesMap[r.id] = r.name);
        }
      });
    } catch(err) {
      console.error("Error resolving names for activity log:", err);
    }

    const replaceIds = (obj) => {
      if (!obj || typeof obj !== 'object') return;
      ['country_id', 'state_id', 'city_id', 'pincode_id', 'role_id'].forEach(k => {
        if (obj[k] && namesMap[obj[k]]) {
          obj[k] = namesMap[obj[k]];
        }
      });
    };

    logs.forEach(log => {
      if (log._parsedDetails) {
        replaceIds(log._parsedDetails.oldData);
        replaceIds(log._parsedDetails.newData);
        log.details = log._parsedDetails;
      }
    });
  }

  logs.forEach(l => delete l._parsedDetails);

  return logs;
};  

const getNeedsAttention = async (
  userId,
  role,
  filters = {},
) => {
  const {
    status = "all",
    search = "",
    role: roleFilter = "all",
    permissionRole = "all",
    fromDate = "",
    toDate = "",
    newThisMonth = false,
  } = filters;

  const buildUserFilters = (alias, params) => {
    const conditions = [];

    const addParam = (value) => {
      params.push(value);
      return `$${params.length}`;
    };

    if (status && status !== "all") {
      const statusParam = addParam(status === "active");

      conditions.push(`${alias}.is_active = ${statusParam}`);
    }

    if (roleFilter && roleFilter !== "all") {
      const roleParam = addParam(roleFilter);

      conditions.push(
        `LOWER(${alias}.role) = LOWER(${roleParam})`,
      );
    }

    if (permissionRole && permissionRole !== "all") {
      const permissionRoleParam = addParam(permissionRole);

      conditions.push(
        `${alias}.role_id = ${permissionRoleParam}`,
      );
    }

    if (fromDate) {
      const fromDateParam = addParam(fromDate);

      conditions.push(
        `${alias}.created_at >= ${fromDateParam}::date`,
      );
    }

    if (toDate) {
      const toDateParam = addParam(toDate);

      conditions.push(
        `${alias}.created_at < (${toDateParam}::date + INTERVAL '1 day')`,
      );
    }

    if (newThisMonth) {
      conditions.push(
        `${alias}.created_at >= date_trunc('month', CURRENT_DATE)`,
      );
    }
    if (filters.adminId) {
      if (alias === "u") {
        const adminParam = addParam(filters.adminId);
        conditions.push(`${alias}.admin_id = ${adminParam} AND ${alias}.role = 'employee'`);
      } else {
        conditions.push(`1=0`);
      }
    }
    if (filters.employeeId) {
      if (alias === "u") {
        const employeeParam = addParam(filters.employeeId);
        conditions.push(`${alias}.id = ${employeeParam}`);
      } else {
        conditions.push(`1=0`);
      }
    }

    if (search.trim()) {
      const searchParam = addParam(`%${search.trim()}%`);

      conditions.push(`
        (
          ${alias}.name ILIKE ${searchParam}
          OR ${alias}.email ILIKE ${searchParam}
          OR ${alias}.role ILIKE ${searchParam}
        )
      `);
    }

    return conditions;
  };

  const buildScopeCondition = (alias, params) => {
    if (role === "general_admin") {
      return "";
    }

    const scopeParam = params.length + 1;
    params.push(userId);

    if (role === "admin") {
      return `
        AND (
          ${alias}.admin_id = $${scopeParam}
          OR ${alias}.admin_id = (
            SELECT admin_id
            FROM users
            WHERE id = $${scopeParam}
          )
        )
      `;
    }

    return `AND ${alias}.id = $${scopeParam}`;
  };

  const overdueParams = [];

  const overdueUserConditions = buildUserFilters(
    "u",
    overdueParams,
  );

  let overdueScopeCondition = "";

  if (role === "employee") {
    const scopeParam = overdueParams.length + 1;
    overdueParams.push(userId);

    overdueScopeCondition = `
      AND u.id = $${scopeParam}
    `;
  } else if (role === "admin") {
    const scopeParam = overdueParams.length + 1;
    overdueParams.push(userId);

    overdueScopeCondition = `
      AND (
        u.admin_id = $${scopeParam}
        OR u.admin_id = (
          SELECT admin_id
          FROM users
          WHERE id = $${scopeParam}
        )
      )
    `;
  }

  const overdueTasksQuery = `
    SELECT COUNT(*)::int AS count
    FROM tasks t
    INNER JOIN users u
      ON u.id = t.assigned_to
    WHERE t.due_date < CURRENT_DATE
      AND LOWER(COALESCE(t.status, '')) NOT IN (
        'completed',
        'complete',
        'cancelled',
        'canceled'
      )
      ${overdueUserConditions.length
        ? `AND ${overdueUserConditions.join(" AND ")}`
        : ""}
      ${overdueScopeCondition}
  `;

  const dueTodayParams = [];

  const dueTodayUserConditions = buildUserFilters(
    "u",
    dueTodayParams,
  );

  let dueTodayScopeCondition = "";

  if (role === "employee") {
    const scopeParam = dueTodayParams.length + 1;
    dueTodayParams.push(userId);

    dueTodayScopeCondition = `
      AND u.id = $${scopeParam}
    `;
  } else if (role === "admin") {
    const scopeParam = dueTodayParams.length + 1;
    dueTodayParams.push(userId);

    dueTodayScopeCondition = `
      AND (
        u.admin_id = $${scopeParam}
        OR u.admin_id = (
          SELECT admin_id
          FROM users
          WHERE id = $${scopeParam}
        )
      )
    `;
  }

  const dueTodayTasksQuery = `
    SELECT COUNT(*)::int AS count
    FROM tasks t
    INNER JOIN users u
      ON u.id = t.assigned_to
    WHERE t.due_date = CURRENT_DATE
      AND LOWER(COALESCE(t.status, '')) NOT IN (
        'completed',
        'complete',
        'cancelled',
        'canceled'
      )
      ${dueTodayUserConditions.length
        ? `AND ${dueTodayUserConditions.join(" AND ")}`
        : ""}
      ${dueTodayScopeCondition}
  `;

  const inactiveAdminsParams = [];

  const inactiveAdminConditions = buildUserFilters(
    "a",
    inactiveAdminsParams,
  );

  let inactiveAdminScopeCondition = "";

  if (role === "admin") {
    const scopeParam = inactiveAdminsParams.length + 1;
    inactiveAdminsParams.push(userId);

    inactiveAdminScopeCondition = `
      AND (
        a.id = $${scopeParam}
        OR a.id = (
          SELECT admin_id
          FROM users
          WHERE id = $${scopeParam}
        )
      )
    `;
  } else if (role === "employee") {
    inactiveAdminScopeCondition = `AND false`;
  }

  const inactiveAdminsQuery = `
    SELECT COUNT(*)::int AS count
    FROM admin a
    WHERE a.is_active = false
      ${inactiveAdminConditions.length
        ? `AND ${inactiveAdminConditions.join(" AND ")}`
        : ""}
      ${inactiveAdminScopeCondition}
  `;

  const missingRoleParams = [];

  const missingRoleConditions = buildUserFilters(
    "u",
    missingRoleParams,
  );

  let missingRoleScopeCondition = "";

  if (role === "admin") {
    const scopeParam = missingRoleParams.length + 1;
    missingRoleParams.push(userId);

    missingRoleScopeCondition = `
      AND (
        u.admin_id = $${scopeParam}
        OR u.admin_id = (
          SELECT admin_id
          FROM users
          WHERE id = $${scopeParam}
        )
      )
    `;
  } else if (role === "employee") {
    const scopeParam = missingRoleParams.length + 1;
    missingRoleParams.push(userId);

    missingRoleScopeCondition = `
      AND u.id = $${scopeParam}
    `;
  }

  const usersWithoutPermissionRoleQuery = `
    SELECT COUNT(*)::int AS count
    FROM users u
    WHERE u.role_id IS NULL
      ${missingRoleConditions.length
        ? `AND ${missingRoleConditions.join(" AND ")}`
        : ""}
      ${missingRoleScopeCondition}
  `;

  const [
    overdueTasksResult,
    dueTodayTasksResult,
    inactiveAdminsResult,
    usersWithoutPermissionRoleResult,
  ] = await Promise.all([
    pool.query(
      overdueTasksQuery,
      overdueParams,
    ),

    pool.query(
      dueTodayTasksQuery,
      dueTodayParams,
    ),

    pool.query(
      inactiveAdminsQuery,
      inactiveAdminsParams,
    ),

    pool.query(
      usersWithoutPermissionRoleQuery,
      missingRoleParams,
    ),
  ]);

  return {
    overdueTasks:
      overdueTasksResult.rows[0]?.count || 0,

    dueTodayTasks:
      dueTodayTasksResult.rows[0]?.count || 0,

    inactiveAdmins:
      inactiveAdminsResult.rows[0]?.count || 0,

    usersWithoutPermissionRole:
      usersWithoutPermissionRoleResult.rows[0]?.count || 0,
  };
};

const getSystemHealth = async (userId, role) => {
  const health = {
    database: {
      status: "healthy",
      details: "Connected",
    },

    api: {
      status: "healthy",
      details: "All services responding",
      services: [],
    },

    pendingTasks: {
      status: "healthy",
      count: 0,
      details: "No overdue tasks",
    },

    failedActions: {
      status: "healthy",
      count: 0,
      details: "No failed operations",
      breakdown: [],
    },

    permissionIssues: {
      status: "healthy",
      count: 0,
      details: "No issues",
    },

    notifications: {
      status: "healthy",
      count: 0,
      details: "Queue normal",
    },
  };

  try {
    await pool.query("SELECT 1");

    health.database = {
      status: "healthy",
      details: "Connected",
    };
  } catch (error) {
    console.error(
      "System health database check failed:",
      error,
    );

    health.database = {
      status: "warning",
      details: "Database connection unavailable",
    };

    health.api = {
      status: "warning",
      details: "API services cannot access the database",
      services: [
        {
          name: "Dashboard Stats",
          status: "warning",
          details: "Database unavailable",
        },
        {
          name: "Dashboard Users",
          status: "warning",
          details: "Database unavailable",
        },
        {
          name: "Recent Activity",
          status: "warning",
          details: "Database unavailable",
        },
        {
          name: "Needs Attention",
          status: "warning",
          details: "Database unavailable",
        },
        {
          name: "Permission Coverage",
          status: "warning",
          details: "Database unavailable",
        },
      ],
    };

    return health;
  }

  const apiChecks = [
    {
      name: "Dashboard Stats",
      check: () =>
        getDashboardStats(
          userId,
          role,
          "all",
          "",
          "all",
          "all",
          "",
          "",
          false,
        ),
    },
    {
      name: "Dashboard Users",
      check: () =>
        getDashboardUsers(
          userId,
          role,
          1,
          1,
          "all",
          "",
          "all",
          "all",
          "",
          "",
          false,
        ),
    },
    {
      name: "Recent Activity",
      check: () =>
        getRecentActivity(1),
    },
    {
      name: "Needs Attention",
      check: () =>
        getNeedsAttention(
          userId,
          role,
          {},
        ),
    },
    {
      name: "Permission Coverage",
      check: () =>
        getPermissionCoverage({}),
    },
  ];

  const apiResults = await Promise.all(
    apiChecks.map(async (service) => {
      try {
        await service.check();

        return {
          name: service.name,
          status: "healthy",
          details: "Service responding",
        };
      } catch (error) {
        console.error(
          `System health API check failed: ${service.name}`,
          error,
        );

        return {
          name: service.name,
          status: "warning",
          details: "Service check failed",
        };
      }
    }),
  );

  const failedApiServices = apiResults.filter(
    (service) => service.status !== "healthy",
  );

  health.api = {
    status:
      failedApiServices.length > 0
        ? "warning"
        : "healthy",

    details:
      failedApiServices.length > 0
        ? `${failedApiServices.length} service${
            failedApiServices.length === 1 ? "" : "s"
          } need attention`
        : "All services responding",

    services: apiResults,
  };

  let taskParams = [];
  let taskScope = "";

  if (role === "admin") {
    taskParams.push(userId);

    taskScope = `
      AND (
        t.assigned_by = $1
        OR t.assigned_by = (
          SELECT admin_id
          FROM users
          WHERE id = $1
        )
      )
    `;
  } else if (role === "employee") {
    taskParams.push(userId);

    taskScope = `
      AND t.assigned_to = $1
    `;
  }

  try {
    const pendingTasksResult = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM tasks t
        WHERE t.due_date < CURRENT_DATE
          AND LOWER(COALESCE(t.status, '')) NOT IN (
            'completed',
            'complete',
            'cancelled',
            'canceled'
          )
          ${taskScope}
      `,
      taskParams,
    );

    const count =
      pendingTasksResult.rows[0]?.count || 0;

    health.pendingTasks = {
      status: count > 0 ? "attention" : "healthy",
      count,
      details:
        count > 0
          ? `${count} overdue task${count === 1 ? "" : "s"}`
          : "No overdue tasks",
    };
  } catch (error) {
    console.error(
      "System health task check failed:",
      error,
    );

    health.pendingTasks = {
      status: "warning",
      count: 0,
      details: "Unable to check pending tasks",
    };
  }

  try {
    const failedActionsResult = await pool.query(
      `
        SELECT
          COALESCE(NULLIF(TRIM(action), ''), 'Unknown') AS action,
          COUNT(*)::int AS count
        FROM activity_log
        WHERE
          LOWER(COALESCE(action, '')) LIKE '%fail%'
          OR LOWER(COALESCE(action, '')) LIKE '%error%'
          OR LOWER(COALESCE(details::text, '')) LIKE '%fail%'
          OR LOWER(COALESCE(details::text, '')) LIKE '%error%'
        GROUP BY COALESCE(NULLIF(TRIM(action), ''), 'Unknown')
        ORDER BY count DESC, action ASC
      `,
    );

    const breakdown = failedActionsResult.rows.map(
      (row) => ({
        action: row.action,
        count: Number(row.count || 0),
      }),
    );

    const count = breakdown.reduce(
      (total, item) => total + item.count,
      0,
    );

    health.failedActions = {
      status: count > 0 ? "warning" : "healthy",
      count,
      details:
        count > 0
          ? `${count} failed operation${
              count === 1 ? "" : "s"
            }`
          : "No failed operations",
      breakdown,
    };
  } catch (error) {
    console.error(
      "System health failed actions check failed:",
      error,
    );

    health.failedActions = {
      status: "warning",
      count: 0,
      details: "Unable to check failed operations",
      breakdown: [],
    };
  }

  try {
    const permissionParams = [];
    let permissionScope = "";

    if (role === "admin") {
      permissionParams.push(userId);

      permissionScope = `
        AND (
          u.admin_id = $1
          OR u.admin_id = (
            SELECT admin_id
            FROM users
            WHERE id = $1
          )
        )
      `;
    } else if (role === "employee") {
      permissionParams.push(userId);

      permissionScope = `
        AND u.id = $1
      `;
    }

    const permissionIssuesResult = await pool.query(
      `
        SELECT COUNT(*)::int AS count
        FROM users u
        WHERE u.role_id IS NULL
          ${permissionScope}
      `,
      permissionParams,
    );

    const count =
      permissionIssuesResult.rows[0]?.count || 0;

    health.permissionIssues = {
      status: count > 0 ? "warning" : "healthy",
      count,
      details:
        count > 0
          ? `${count} user${
              count === 1 ? "" : "s"
            } without permission role`
          : "No issues",
    };
  } catch (error) {
    console.error(
      "System health permission check failed:",
      error,
    );

    health.permissionIssues = {
      status: "warning",
      count: 0,
      details: "Unable to check permission issues",
    };
  }

  try {
    const notificationParams = [];
    const notificationQueries = [];

    if (role === "general_admin") {
      notificationQueries.push(`
        SELECT COUNT(*)::int AS count
        FROM admin_notifications
        WHERE is_read = false
      `);

      notificationQueries.push(`
        SELECT COUNT(*)::int AS count
        FROM employee_notifications
        WHERE is_read = false
      `);
    } else if (role === "admin") {
      notificationParams.push(userId);

      notificationQueries.push(`
        SELECT COUNT(*)::int AS count
        FROM admin_notifications
        WHERE admin_id = $1
          AND is_read = false
      `);

      notificationQueries.push(`
        SELECT COUNT(*)::int AS count
        FROM employee_notifications en
        INNER JOIN users u
          ON u.id = en.employee_id
        WHERE en.is_read = false
          AND (
            u.admin_id = $1
            OR u.admin_id = (
              SELECT admin_id
              FROM users
              WHERE id = $1
            )
          )
      `);
    } else {
      notificationParams.push(userId);

      notificationQueries.push(`
        SELECT COUNT(*)::int AS count
        FROM employee_notifications
        WHERE employee_id = $1
          AND is_read = false
      `);
    }

    const notificationResults = await Promise.all(
      notificationQueries.map((query) =>
        pool.query(query, notificationParams),
      ),
    );

    const count = notificationResults.reduce(
      (total, result) =>
        total + Number(result.rows[0]?.count || 0),
      0,
    );

    health.notifications = {
      status: "healthy",
      count,
      details:
        count > 0
          ? `${count} unread notification${
              count === 1 ? "" : "s"
            }`
          : "Queue normal",
    };
  } catch (error) {
    console.error(
      "System health notification check failed:",
      error,
    );

    health.notifications = {
      status: "warning",
      count: 0,
      details: "Unable to check notifications",
    };
  }

  return health;
};

const getPermissionCoverage = async (
  filters = {},
  userId = null,
  role = null,
) => {
  const {
    status = "all",
    search = "",
    role: roleFilter = "all",
    permissionRole = "all",
    fromDate = "",
    toDate = "",
    newThisMonth = false,
  } = filters;

  const { userScope, adminScope, params } =
    userId && role
      ? getDashboardScope(userId, role)
      : {
          userScope: "",
          adminScope: "",
          params: [],
        };

  const conditions = [];
  const filterParams = [...params];

  const addParam = (value) => {
    filterParams.push(value);
    return `$${filterParams.length}`;
  };

  if (status && status !== "all") {
    const statusParam = addParam(status === "active");

    conditions.push(`
      filtered_users.is_active = ${statusParam}
    `);
  }

  if (roleFilter && roleFilter !== "all") {
    const roleParam = addParam(roleFilter);

    conditions.push(`
      LOWER(filtered_users.role) = LOWER(${roleParam})
    `);
  }

  if (permissionRole && permissionRole !== "all") {
    const permissionRoleParam = addParam(permissionRole);

    conditions.push(`
      filtered_users.role_id = ${permissionRoleParam}
    `);
  }

  if (fromDate) {
    const fromDateParam = addParam(fromDate);

    conditions.push(`
      filtered_users.created_at >= ${fromDateParam}::date
    `);
  }

  if (toDate) {
    const toDateParam = addParam(toDate);

    conditions.push(`
      filtered_users.created_at < (
        ${toDateParam}::date + INTERVAL '1 day'
      )
    `);
  }

  if (newThisMonth) {
    conditions.push(`
      filtered_users.created_at >= date_trunc('month', CURRENT_DATE)
    `);
  }

  if (search.trim()) {
    const searchParam = addParam(`%${search.trim()}%`);

    conditions.push(`
      (
        filtered_users.name ILIKE ${searchParam}
        OR filtered_users.email ILIKE ${searchParam}
        OR filtered_users.role ILIKE ${searchParam}
        OR filtered_users.permission_role ILIKE ${searchParam}
      )
    `);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const result = await pool.query(
    `
      WITH filtered_users AS (
        SELECT
          u.id,
          u.name,
          u.email,
          u.role,
          u.is_active,
          u.created_at,
          u.role_id,
      u.admin_id,
          r.name AS permission_role
        FROM users u
        LEFT JOIN roles r
          ON r.id = u.role_id
        ${userScope}

        UNION ALL

        SELECT
          a.id,
          a.name,
          a.email,
          a.role,
          a.is_active,
          a.created_at,
          a.role_id,
      a.id AS admin_id,
          r.name AS permission_role
        FROM admin a
        LEFT JOIN roles r
          ON r.id = a.role_id
        ${adminScope}
      ),

      matching_roles AS (
        SELECT DISTINCT role_id
        FROM filtered_users
        ${whereClause}
          ${whereClause ? "AND" : "WHERE"} role_id IS NOT NULL
      ),

      active_identifiers AS (
        SELECT
          id,
          operations
        FROM identifiers
        WHERE is_active = true
          AND is_deleted = false
      ),

      identifier_totals AS (
        SELECT
          COUNT(*)::int AS total_identifiers,
          COALESCE(
            SUM(jsonb_array_length(operations)),
            0
          )::int AS total_operations
        FROM active_identifiers
      )

      SELECT
        r.id AS role_id,
        r.name AS role_name,
        it.total_identifiers,
        it.total_operations,

        COUNT(
          DISTINCT CASE
            WHEN i.id IS NOT NULL
            THEN ria.identifier_id
          END
        )::int AS accessible_identifiers,

        COALESCE(
          SUM(
            CASE
              WHEN i.id IS NOT NULL
              THEN (
                SELECT COUNT(*)
                FROM jsonb_array_elements_text(
                  COALESCE(
                    ria.operations,
                    '[]'::jsonb
                  )
                ) AS granted_operation
                WHERE granted_operation.value = ANY(
                  ARRAY(
                    SELECT jsonb_array_elements_text(
                      i.operations
                    )
                  )
                )
              )
              ELSE 0
            END
          ),
          0
        )::int AS granted_operations

      FROM roles r

      INNER JOIN matching_roles mr
        ON mr.role_id = r.id

      CROSS JOIN identifier_totals it

      LEFT JOIN role_identifier_access ria
        ON ria.role_id = r.id

      LEFT JOIN active_identifiers i
        ON i.id = ria.identifier_id

      GROUP BY
        r.id,
        r.name,
        it.total_identifiers,
        it.total_operations

      ORDER BY r.id;
    `,
    filterParams,
  );

  return result.rows.map((row) => {
    const totalIdentifiers =
      Number(row.total_identifiers || 0);

    const accessibleIdentifiers =
      Number(row.accessible_identifiers || 0);

    const totalOperations =
      Number(row.total_operations || 0);

    const grantedOperations =
      Number(row.granted_operations || 0);

    return {
      roleId: row.role_id,
      roleName: row.role_name,
      totalIdentifiers,
      accessibleIdentifiers,

      identifierCoverage:
        totalIdentifiers > 0
          ? Math.round(
              (accessibleIdentifiers /
                totalIdentifiers) *
                100,
            )
          : 0,

      totalOperations,
      grantedOperations,

      operationCoverage:
        totalOperations > 0
          ? Math.round(
              (grantedOperations /
                totalOperations) *
                100,
            )
          : 0,
    };
  });
};


const getSmartUserInsights = async (
  userId,
  role,
  filters = {},
  findingLimit = 5,
) => {
  const {
    status = "all",
    search = "",
    role: roleFilter = "all",
    permissionRole = "all",
    fromDate = "",
    toDate = "",
    newThisMonth = false,
    adminId = "",
    employeeId = "",
  } = filters;

  const { userScope, adminScope, params } =
    getDashboardScope(userId, role);

  const filterParams = [...params];
  const conditions = [];

  const addParam = (value) => {
    filterParams.push(value);
    return `$${filterParams.length}`;
  };

  if (adminId) {
    const adminParam = addParam(adminId);
    conditions.push(
      `du.admin_id::text = ${adminParam}::text AND du.role = 'employee'`,
    );
  }

  if (employeeId) {
    const employeeParam = addParam(employeeId);
    conditions.push(`du.id::text = ${employeeParam}::text`);
  }

  if (status && status !== "all") {
    const statusParam = addParam(status === "active");
    conditions.push(`du.is_active = ${statusParam}`);
  }

  if (roleFilter && roleFilter !== "all") {
    const roleParam = addParam(roleFilter);
    conditions.push(
      `LOWER(du.role) = LOWER(${roleParam})`,
    );
  }

  if (permissionRole && permissionRole !== "all") {
    const permissionParam = addParam(permissionRole);
    conditions.push(`du.role_id = ${permissionParam}`);
  }

  if (fromDate) {
    const fromParam = addParam(fromDate);
    conditions.push(
      `du.created_at >= ${fromParam}::date`,
    );
  }

  if (toDate) {
    const toParam = addParam(toDate);
    conditions.push(
      `du.created_at < (${toParam}::date + INTERVAL '1 day')`,
    );
  }

  if (newThisMonth) {
    conditions.push(
      `du.created_at >= date_trunc('month', CURRENT_DATE)`,
    );
  }

  if (search.trim()) {
    const searchParam = addParam(`%${search.trim()}%`);
    conditions.push(`
      (
        du.name ILIKE ${searchParam}
        OR du.email ILIKE ${searchParam}
        OR du.role ILIKE ${searchParam}
        OR du.permission_role ILIKE ${searchParam}
        OR du.country_name ILIKE ${searchParam}
        OR du.state_name ILIKE ${searchParam}
        OR du.city_name ILIKE ${searchParam}
        OR du.pincode::text ILIKE ${searchParam}
      )
    `);
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  const result = await pool.query(
    `
      WITH dashboard_users AS (
        SELECT
          u.id,
          u.name,
          u.email,
          u.role,
          u.is_active,
          u.created_at,
          u.role_id,
          u.admin_id,
          u.country_id,
          u.state_id,
          u.city_id,
          u.pincode_id,
          r.name AS permission_role,
          co.name AS country_name,
          s.name AS state_name,
          c.name AS city_name,
          p.pincode,
          'user' AS record_type
        FROM users u
        LEFT JOIN roles r ON r.id = u.role_id
        LEFT JOIN countries co ON co.id = u.country_id
        LEFT JOIN states s ON s.id = u.state_id
        LEFT JOIN cities c ON c.id = u.city_id
        LEFT JOIN pincodes p ON p.id = u.pincode_id
        ${userScope}

        UNION ALL

        SELECT
          a.id,
          a.name,
          a.email,
          a.role,
          a.is_active,
          a.created_at,
          a.role_id,
          a.id AS admin_id,
          a.country_id,
          a.state_id,
          a.city_id,
          a.pincode_id,
          r.name AS permission_role,
          co.name AS country_name,
          s.name AS state_name,
          c.name AS city_name,
          p.pincode,
          'admin' AS record_type
        FROM admin a
        LEFT JOIN roles r ON r.id = a.role_id
        LEFT JOIN countries co ON co.id = a.country_id
        LEFT JOIN states s ON s.id = a.state_id
        LEFT JOIN cities c ON c.id = a.city_id
        LEFT JOIN pincodes p ON p.id = a.pincode_id
        ${adminScope}
      )
      SELECT du.*
      FROM dashboard_users du
      ${whereClause}
      ORDER BY du.created_at DESC, du.id DESC
    `,
    filterParams,
  );

  const findings = [];

  const addFinding = (user, issue, severity, reason, action) => {
    findings.push({
      id: `${user.record_type}-${user.id}-${issue}`,
      userId: user.id,
      userName: user.name,
      email: user.email,
      role: user.role,
      recordType: user.record_type,
      issue,
      severity,
      reason,
      recommendedAction: action,
      createdAt: user.created_at,
    });
  };

  for (const user of result.rows) {
    if (!user.is_active) {
      addFinding(
        user,
        "Inactive account",
        "medium",
        "This account is currently inactive.",
        "Review the account status and confirm whether it should remain inactive.",
      );
    }

    if (!user.role_id || !user.permission_role) {
      addFinding(
        user,
        "Missing permission role",
        "high",
        "No valid permission role is assigned to this account.",
        "Review the account and assign the appropriate permission role if required.",
      );
    }

    if (
      !user.country_id ||
      !user.state_id ||
      !user.city_id ||
      !user.pincode_id
    ) {
      addFinding(
        user,
        "Incomplete location details",
        "low",
        "One or more location fields are missing.",
        "Review and complete the account's location details if required.",
      );
    }
  }

  const severityOrder = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
  };

  findings.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      new Date(b.createdAt || 0) - new Date(a.createdAt || 0) ||
      a.userName.localeCompare(b.userName),
  );

  const distribution = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const finding of findings) {
    distribution[finding.severity] += 1;
  }

  return {
    summary: {
      usersToReview: new Set(findings.map((item) => item.userId)).size,
      highPriority: distribution.critical + distribution.high,
      taskRisks: 0,
      accountIssues: findings.length,
    },
    distribution,
    totalFindings: findings.length,
    findings: findings.slice(0, Math.max(1, findingLimit)),
  };
};

const getDashboardOverview = async (
  userId,
  role,
  page = 1,
  limit = 5,
  filters = {},
) => {
  const {
    status = "all",
    search = "",
    role: roleFilter = "all",
    permissionRole = "all",
    fromDate = "",
    toDate = "",
    newThisMonth = false,
    adminId = "",
    employeeId = "",
  } = filters;

  const [
    dashboardStats,
    dashboardUsers,
    recentActivity,
    smartInsights,
    adminsResult,
    employeesResult,
  ] = await Promise.all([
    getDashboardStats(
      userId,
      role,
      status,
      search,
      roleFilter,
      permissionRole,
      fromDate,
      toDate,
      newThisMonth,
      filters.adminId || adminId,
      filters.employeeId || employeeId,
    ),

    getDashboardUsers(
      userId,
      role,
      page,
      limit,
      status,
      search,
      roleFilter,
      permissionRole,
      fromDate,
      toDate,
      newThisMonth,
      filters.adminId || adminId,
      filters.employeeId || employeeId,
    ),

    getRecentActivity(
      5,
      filters,
      userId,
      role,
    ).catch((err) => {
      console.error("Dashboard overview recent activity error:", err);
      return [];
    }),

    getSmartUserInsights(
      userId,
      role,
      filters,
      1000,
    ).catch((err) => {
      console.error("Dashboard overview smart insights error:", err);
      return null;
    }),

    pool.query(`
      SELECT
        a.id,
        a.name,
        a.email,
        a.role,
        COUNT(CASE WHEN u.is_active = true THEN 1 END) AS employee_count
      FROM admin a
      LEFT JOIN users u
        ON u.admin_id = a.id
        AND u.role = 'employee'
      WHERE a.role = 'admin'
      GROUP BY a.id
      ORDER BY a.id
    `).catch((err) => {
      console.error("Dashboard overview admins query error:", err);
      return { rows: [] };
    }),

    pool.query(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.role,
        u.admin_id,
        u.is_active
      FROM users u
      WHERE u.role = 'employee'
      ORDER BY u.name ASC
    `).catch((err) => {
      console.error("Dashboard overview employees query error:", err);
      return { rows: [] };
    }),
  ]);

  return {
    stats: dashboardStats?.stats || {
      totalUsers: 0,
      activeUsers: 0,
      inactiveUsers: 0,
      newUsers: 0,
    },
    users: dashboardUsers?.users || [],
    totalRecords: dashboardUsers?.totalRecords || 0,
    totalPages: dashboardUsers?.totalPages || 0,
    pagination: {
      page: dashboardUsers?.page || page,
      limit: dashboardUsers?.limit || limit,
      totalRecords: dashboardUsers?.totalRecords || 0,
      totalPages: dashboardUsers?.totalPages || 0,
    },
    smartInsights: smartInsights || null,
    recentActivity: recentActivity || [],
    admins: adminsResult?.rows || [],
    employees: employeesResult?.rows || [],
  };
};

module.exports = {
  getDashboardStats,
  getDashboardUsers,
  getRecentActivity,
  getNeedsAttention,
  getSystemHealth,
  getPermissionCoverage,
  getDashboardOverview,
  getSmartUserInsights,
};