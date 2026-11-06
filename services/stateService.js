const pool = require("../config/databse");
const { createAdminNotification } = require("./notificationService");

const getStates = async (
  page = null,
  limit = null,
  search = "",
  status = "all",
  countryId = "all",
) => {
  // Keep existing behavior for dropdowns
  if (page === null || limit === null) {
    const result = await pool.query(
      `SELECT
         s.id,
         s.country_id,
         c.name AS country_name,
         s.name,
         s.is_active,
         s.created_by,
         s.created_at
       FROM states s
       LEFT JOIN countries c
         ON s.country_id = c.id
       ORDER BY s.id ASC`,
    );

    return result.rows;
  }

  const offset = (page - 1) * limit;

  const values = [];
  const conditions = [];
  let paramIndex = 1;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`(
      s.name ILIKE $${paramIndex}
      OR c.name ILIKE $${paramIndex}
    )`);

    paramIndex++;
  }

  if (status === "active") {
    conditions.push(`s.is_active = true`);
  } else if (status === "inactive") {
    conditions.push(`s.is_active = false`);
  }

  if (countryId !== "all" && countryId !== "") {
    values.push(countryId);

    conditions.push(`s.country_id = $${paramIndex}`);

    paramIndex++;
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM states s
     LEFT JOIN countries c
       ON s.country_id = c.id
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT
       s.id,
       s.country_id,
       c.name AS country_name,
       s.name,
       s.is_active,
       s.created_by,
       s.created_at
     FROM states s
     LEFT JOIN countries c
       ON s.country_id = c.id
     ${whereClause}
     ORDER BY s.id ASC
     LIMIT $${paramIndex}
     OFFSET $${paramIndex + 1}`,
    dataValues,
  );

  return {
    rows: result.rows,
    totalRecords,
    totalPages: Math.ceil(totalRecords / limit),
    page,
    limit,
  };
};

const getStateById = async (id) => {
  const result = await pool.query(
    `SELECT
       s.id,
       s.country_id,
       c.name AS country_name,
       s.name,
       s.is_active,
       s.created_by,
       s.created_at
     FROM states s
     LEFT JOIN countries c ON s.country_id = c.id
     WHERE s.id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "State not found",
    };
  }

  return {
    success: true,
    state: result.rows[0],
  };
};

//validate state belong to country
const validateStateBelongsToCountry = async (countryId, stateName) => {
  const result = await pool.query(
    `SELECT DISTINCT
       wc.id AS country_id,
       wc.name AS country_name
     FROM world_states_import ws
     JOIN world_countries_import wc
       ON wc.id = ws.country_id
     WHERE LOWER(TRIM(ws.name)) = LOWER(TRIM($1))`,
    [stateName],
  );

  if (result.rows.length === 0) {
    return {
      valid: false,
      message: `"${stateName}" is not a valid state.`,
    };
  }

  const selectedCountry = await pool.query(
    `SELECT id, name
     FROM countries
     WHERE id = $1`,
    [countryId],
  );

  if (selectedCountry.rows.length === 0) {
    return {
      valid: false,
      message: "Country not found.",
    };
  }

  const selectedCountryName = selectedCountry.rows[0].name;

  const belongsToCountry = result.rows.some(
    (row) =>
      row.country_name.trim().toLowerCase() ===
      selectedCountryName.trim().toLowerCase(),
  );

  if (!belongsToCountry) {
    const validCountries = [
      ...new Set(result.rows.map((row) => row.country_name)),
    ];

    return {
      valid: false,
      message: `"${stateName}" doesn't belong to ${selectedCountryName}. It belongs to ${validCountries.join(", ")}.`,
    };
  }

  return {
    valid: true,
  };
};

const createState = async (country_id, name, is_active = true, created_by) => {
  if (!country_id || !name || !name.trim()) {
    return {
      success: false,
      status: 400,
      message: "Country and state name are required.",
    };
  }

  if (!created_by) {
    return {
      success: false,
      status: 401,
      message: "Admin information is required.",
    };
  }

  const country = await pool.query(
    `SELECT id, name
     FROM countries
     WHERE id = $1`,
    [country_id],
  );

  if (country.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Country not found.",
    };
  }

  const validation = await validateStateBelongsToCountry(country_id, name);

  if (!validation.valid) {
    return {
      success: false,
      status: 400,
      message: validation.message,
    };
  }

  const existingState = await pool.query(
    `SELECT id
     FROM states
     WHERE country_id = $1
     AND LOWER(TRIM(name)) = LOWER(TRIM($2))`,
    [country_id, name],
  );

  if (existingState.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "State already exists in this country.",
    };
  }

  const result = await pool.query(
    `INSERT INTO states
     (country_id, name, is_active, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, country_id, name, is_active, created_by, created_at`,
    [country_id, name.trim(), is_active, created_by],
  );

  await createAdminNotification(
    created_by,
    "State Created",
    `${name.trim()} state has been created.`,
    "state_created",
  );

  return {
    success: true,
    status: 201,
    message: "State created successfully.",
    state: result.rows[0],
  };
};

const updateState = async (id, country_id, name, is_active = true) => {
  if (!country_id || !name || !name.trim()) {
    return {
      success: false,
      status: 400,
      message: "Country and state name are required.",
    };
  }

  const existingState = await pool.query(
    `SELECT id, name, created_by, is_active
   FROM states
   WHERE id = $1`,
    [id],
  );

  if (existingState.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "State not found.",
    };
  }

  const country = await pool.query(
    `SELECT id, name
     FROM countries
     WHERE id = $1`,
    [country_id],
  );

  if (country.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Country not found.",
    };
  }

  const validation = await validateStateBelongsToCountry(country_id, name);

  if (!validation.valid) {
    return {
      success: false,
      status: 400,
      message: validation.message,
    };
  }

  const duplicateState = await pool.query(
    `SELECT id
     FROM states
     WHERE country_id = $1
     AND LOWER(TRIM(name)) = LOWER(TRIM($2))
     AND id != $3`,
    [country_id, name, id],
  );

  if (duplicateState.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "State already exists in this country.",
    };
  }

  const result = await pool.query(
    `UPDATE states
     SET country_id = $1,
         name = $2,
         is_active = $3
     WHERE id = $4
     RETURNING id, country_id, name, is_active, created_by, created_at`,
    [country_id, name.trim(), is_active, id],
  );

  if (existingState.rows[0].is_active === true && is_active === false) {
    await createAdminNotification(
      existingState.rows[0].created_by,
      "State Deactivated",
      `${name.trim()} state has been deactivated.`,
      "state_deactivated",
    );
  } else if (existingState.rows[0].is_active === false && is_active === true) {
    await createAdminNotification(
      existingState.rows[0].created_by,
      "State Activated",
      `${name.trim()} state has been activated.`,
      "state_activated",
    );
  } else {
    await createAdminNotification(
      existingState.rows[0].created_by,
      "State Updated",
      `${name.trim()} state details have been updated.`,
      "state_updated",
    );
  }

  return {
    success: true,
    status: 200,
    message: "State updated successfully.",
    state: result.rows[0],
  };
};

const deleteState = async (id) => {
  const result = await pool.query(
    `UPDATE states
     SET is_active = false
     WHERE id = $1
     RETURNING id, country_id, name, is_active, created_by, created_at`,
    [id],
  );

  await createAdminNotification(
    result.rows[0].created_by,
    "State Deactivated",
    `${result.rows[0].name} state has been deactivated.`,
    "state_deactivated",
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "State not found.",
    };
  }

  return {
    success: true,
    status: 200,
    message: "State deactivated successfully.",
    state: result.rows[0],
  };
};

const activateState = async (id) => {
  const result = await pool.query(
    `UPDATE states
     SET is_active = true
     WHERE id = $1
     RETURNING id, country_id, name, is_active, created_by, created_at`,
    [id],
  );

  await createAdminNotification(
    result.rows[0].created_by,
    "State Activated",
    `${result.rows[0].name} state has been activated.`,
    "state_activated",
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "State not found.",
    };
  }

  return {
    success: true,
    status: 200,
    message: "State activated successfully.",
    state: result.rows[0],
  };
};

const getStatesByCountry = async (
  countryId,
  page = 1,
  limit = 50,
  search = "",
) => {
  const offset = (page - 1) * limit;

  const values = [countryId];
  const conditions = [`country_id = $1`, `is_active = true`];

  let paramIndex = 2;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`name ILIKE $${paramIndex}`);

    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM states
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT id, name
     FROM states
     ${whereClause}
     ORDER BY name
     LIMIT $${paramIndex}
     OFFSET $${paramIndex + 1}`,
    dataValues,
  );

  return {
    rows: result.rows,
    totalRecords,
    totalPages: Math.ceil(totalRecords / limit),
    page,
    limit,
  };
};

const getStateLocation = async (stateName) => {
  const cleanStateName = String(stateName || "").trim();

  if (!cleanStateName) {
    return {
      success: false,
      status: 400,
      message: "State is required",
    };
  }

  const result = await pool.query(
    `SELECT
       s.id AS state_id,
       s.name AS state_name,
       c.id AS country_id,
       c.name AS country_name
     FROM states s
     JOIN countries c
       ON c.id = s.country_id
     WHERE LOWER(TRIM(s.name)) = LOWER(TRIM($1))
       AND s.is_active = true
       AND c.is_active = true
     ORDER BY s.id
     LIMIT 1`,
    [cleanStateName],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "State not found",
    };
  }

  return {
    success: true,
    location: result.rows[0],
  };
};

module.exports = {
  getStates,
  getStateById,
  createState,
  updateState,
  deleteState,
  activateState,
  getStatesByCountry,
  getStateLocation,
};
