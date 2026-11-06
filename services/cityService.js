const pool = require("../config/databse");
const { createAdminNotification } = require("./notificationService");

const getCities = async (page = 1, limit = 50, search = "", status = "all") => {
  const offset = (page - 1) * limit;

  const values = [];
  const conditions = [];
  let paramIndex = 1;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`(
      ci.name ILIKE $${paramIndex}
      OR s.name ILIKE $${paramIndex}
      OR c.name ILIKE $${paramIndex}
    )`);

    paramIndex++;
  }

  if (status === "active") {
    conditions.push(`ci.is_active = true`);
  } else if (status === "inactive") {
    conditions.push(`ci.is_active = false`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  // Get total records
  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM cities ci
     LEFT JOIN states s ON ci.state_id = s.id
     LEFT JOIN countries c ON s.country_id = c.id
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  // Get only required page
  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT
       ci.id,
       ci.state_id,
       s.name AS state_name,
       c.id AS country_id,
       c.name AS country_name,
       ci.name,
       ci.is_active,
       ci.created_by,
       ci.created_at
     FROM cities ci
     LEFT JOIN states s ON ci.state_id = s.id
     LEFT JOIN countries c ON s.country_id = c.id
     ${whereClause}
     ORDER BY ci.id ASC
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

const getCityById = async (id) => {
  const result = await pool.query(
    `SELECT
       ci.id,
       ci.state_id,
       s.name AS state_name,
       c.id AS country_id,
       c.name AS country_name,
       ci.name,
       ci.is_active,
       ci.created_by,
       ci.created_at
     FROM cities ci
     LEFT JOIN states s ON ci.state_id = s.id
     LEFT JOIN countries c ON s.country_id = c.id
     WHERE ci.id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "City not found",
    };
  }

  return {
    success: true,
    city: result.rows[0],
  };
};

const createCity = async (state_id, name, is_active = true, created_by) => {
  if (!state_id || !name || !name.trim()) {
    return {
      success: false,
      status: 400,
      message: "State and city name are required.",
    };
  }

  if (!created_by) {
    return {
      success: false,
      status: 401,
      message: "Admin information is required.",
    };
  }

  const state = await pool.query(
    `SELECT
       s.id,
       s.name,
       s.is_active,
       c.id AS country_id,
       c.name AS country_name
     FROM states s
     LEFT JOIN countries c ON s.country_id = c.id
     WHERE s.id = $1`,
    [state_id],
  );

  if (state.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "State not found.",
    };
  }

  if (!state.rows[0].is_active) {
    return {
      success: false,
      status: 400,
      message: "Cannot create city under an inactive state.",
    };
  }

  const stateName = state.rows[0].name;
  const countryName = state.rows[0].country_name;

  const validCity = await pool.query(
    `SELECT wc.id
     FROM world_cities_import wc
     JOIN world_states_import ws
       ON wc.state_id = ws.id
     JOIN world_countries_import wco
       ON ws.country_id = wco.id
     WHERE LOWER(TRIM(wco.name)) = LOWER(TRIM($1))
       AND LOWER(TRIM(ws.name)) = LOWER(TRIM($2))
       AND LOWER(TRIM(wc.name)) = LOWER(TRIM($3))
     LIMIT 1`,
    [countryName, stateName, name],
  );

  if (validCity.rows.length === 0) {
    return {
      success: false,
      status: 400,
      message: `City "${name.trim()}" does not belong to state "${stateName}".`,
    };
  }

  const existingCity = await pool.query(
    `SELECT id
     FROM cities
     WHERE state_id = $1
     AND LOWER(TRIM(name)) = LOWER(TRIM($2))`,
    [state_id, name],
  );

  if (existingCity.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "City already exists in this state.",
    };
  }

  const result = await pool.query(
    `INSERT INTO cities
     (state_id, name, is_active, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, state_id, name, is_active, created_by, created_at`,
    [state_id, name.trim(), is_active, created_by],
  );

  await createAdminNotification(
    created_by,
    "City Created",
    `${name.trim()} city has been created.`,
    "city_created",
  );

  return {
    success: true,
    status: 201,
    message: "City created successfully.",
    city: result.rows[0],
  };
};

const updateCity = async (id, state_id, name, is_active = true) => {
  if (!state_id || !name || !name.trim()) {
    return {
      success: false,
      status: 400,
      message: "State and city name are required.",
    };
  }

  const existingCity = await pool.query(
    `SELECT id, state_id, name, created_by, is_active
   FROM cities
   WHERE id = $1`,
    [id],
  );

  if (existingCity.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "City not found.",
    };
  }

  const existingStateId = existingCity.rows[0].state_id;
  const existingName = existingCity.rows[0].name;

  const cityChanged =
    String(existingStateId) !== String(state_id) ||
    existingName.trim().toLowerCase() !== name.trim().toLowerCase();

  const state = await pool.query(
    `SELECT
       s.id,
       s.name,
       s.is_active,
       c.id AS country_id,
       c.name AS country_name
     FROM states s
     LEFT JOIN countries c ON s.country_id = c.id
     WHERE s.id = $1`,
    [state_id],
  );

  if (state.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "State not found.",
    };
  }

  if (!state.rows[0].is_active) {
    return {
      success: false,
      status: 400,
      message: "Cannot assign city to an inactive state.",
    };
  }

  const stateName = state.rows[0].name;
  const countryName = state.rows[0].country_name;

  if (cityChanged) {
    const validCity = await pool.query(
      `SELECT wc.id
     FROM world_cities_import wc
     JOIN world_states_import ws
       ON wc.state_id = ws.id
     JOIN world_countries_import wco
       ON ws.country_id = wco.id
     WHERE LOWER(TRIM(wco.name)) = LOWER(TRIM($1))
       AND LOWER(TRIM(ws.name)) = LOWER(TRIM($2))
       AND LOWER(TRIM(wc.name)) = LOWER(TRIM($3))
     LIMIT 1`,
      [countryName, stateName, name],
    );

    if (validCity.rows.length === 0) {
      return {
        success: false,
        status: 400,
        message: `City "${name.trim()}" does not belong to state "${stateName}".`,
      };
    }
  }

  console.log("UPDATE CITY DATA:", {
    id,
    state_id,
    name,
    is_active,
  });

  const duplicateCity = await pool.query(
    `SELECT id
     FROM cities
     WHERE state_id = $1
     AND LOWER(TRIM(name)) = LOWER(TRIM($2))
     AND id != $3`,
    [state_id, name, id],
  );

  console.log("DUPLICATE CITY RESULT:", duplicateCity.rows);

  if (duplicateCity.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "City already exists in this state.",
    };
  }

  const result = await pool.query(
    `UPDATE cities
     SET state_id = $1,
         name = $2,
         is_active = $3
     WHERE id = $4
     RETURNING id, state_id, name, is_active, created_by, created_at`,
    [state_id, name.trim(), is_active, id],
  );

  if (existingCity.rows[0].is_active === true && is_active === false) {
    await createAdminNotification(
      existingCity.rows[0].created_by,
      "City Deactivated",
      `${name.trim()} city has been deactivated.`,
      "city_deactivated",
    );
  } else if (existingCity.rows[0].is_active === false && is_active === true) {
    await createAdminNotification(
      existingCity.rows[0].created_by,
      "City Activated",
      `${name.trim()} city has been activated.`,
      "city_activated",
    );
  } else {
    await createAdminNotification(
      existingCity.rows[0].created_by,
      "City Updated",
      `${name.trim()} city details have been updated.`,
      "city_updated",
    );
  }

  return {
    success: true,
    status: 200,
    message: "City updated successfully.",
    city: result.rows[0],
  };
};

const deleteCity = async (id) => {
  const result = await pool.query(
    `UPDATE cities
     SET is_active = false
     WHERE id = $1
     RETURNING id, state_id, name, is_active, created_by, created_at`,
    [id],
  );

  await createAdminNotification(
    result.rows[0].created_by,
    "City Deactivated",
    `${result.rows[0].name} city has been deactivated.`,
    "city_deactivated",
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "City not found.",
    };
  }

  return {
    success: true,
    status: 200,
    message: "City deactivated successfully.",
    city: result.rows[0],
  };
};

const activateCity = async (id) => {
  const city = await pool.query(
    `SELECT id, state_id, name, created_by
   FROM cities
   WHERE id = $1`,
    [id],
  );

  if (city.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "City not found.",
    };
  }

  const { state_id, name } = city.rows[0];

  const state = await pool.query(
    `SELECT id, is_active
     FROM states
     WHERE id = $1`,
    [state_id],
  );

  if (state.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "State not found.",
    };
  }

  if (!state.rows[0].is_active) {
    return {
      success: false,
      status: 400,
      message: "Cannot activate city under an inactive state.",
    };
  }

  const duplicateCity = await pool.query(
    `SELECT id
     FROM cities
     WHERE state_id = $1
     AND LOWER(TRIM(name)) = LOWER(TRIM($2))
     AND id != $3`,
    [state_id, name, id],
  );

  if (duplicateCity.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "City already exists in this state.",
    };
  }

  const result = await pool.query(
    `UPDATE cities
     SET is_active = true
     WHERE id = $1
     RETURNING id, state_id, name, is_active, created_by, created_at`,
    [id],
  );

  await createAdminNotification(
    city.rows[0].created_by,
    "City Activated",
    `${result.rows[0].name} city has been activated.`,
    "city_activated",
  );

  return {
    success: true,
    status: 200,
    message: "City activated successfully.",
    city: result.rows[0],
  };
};

const getCitiesByState = async (stateId, page = 1, limit = 50, search = "") => {
  const offset = (page - 1) * limit;

  const values = [stateId];
  const conditions = [`state_id = $1`, `is_active = true`];

  let paramIndex = 2;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`name ILIKE $${paramIndex}`);

    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM cities
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT id, name
     FROM cities
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

const getCitiesByCountry = async (
  countryId,
  page = 1,
  limit = 50,
  search = "",
) => {
  const offset = (page - 1) * limit;

  const values = [countryId];
  const conditions = [
    `c.id = $1`,
    `ci.is_active = true`,
    `s.is_active = true`,
    `c.is_active = true`,
  ];

  let paramIndex = 2;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`ci.name ILIKE $${paramIndex}`);

    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM cities ci
     JOIN states s
       ON s.id = ci.state_id
     JOIN countries c
       ON c.id = s.country_id
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT
       ci.id,
       ci.state_id,
       ci.name,
       s.name AS state_name,
       c.id AS country_id,
       c.name AS country_name
     FROM cities ci
     JOIN states s
       ON s.id = ci.state_id
     JOIN countries c
       ON c.id = s.country_id
     ${whereClause}
     ORDER BY ci.name
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

const getCityLocation = async (cityName) => {
  const cleanCityName = String(cityName || "").trim();

  if (!cleanCityName) {
    return {
      success: false,
      status: 400,
      message: "City is required",
    };
  }

  const result = await pool.query(
    `SELECT
       ci.id AS city_id,
       ci.name AS city_name,
       s.id AS state_id,
       s.name AS state_name,
       c.id AS country_id,
       c.name AS country_name
     FROM cities ci
     JOIN states s
       ON s.id = ci.state_id
     JOIN countries c
       ON c.id = s.country_id
     WHERE LOWER(TRIM(ci.name)) = LOWER(TRIM($1))
       AND ci.is_active = true
       AND s.is_active = true
       AND c.is_active = true
     ORDER BY ci.id
     LIMIT 1`,
    [cleanCityName],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "City not found",
    };
  }

  return {
    success: true,
    location: result.rows[0],
  };
};

module.exports = {
  getCities,
  getCityById,
  createCity,
  updateCity,
  deleteCity,
  activateCity,
  getCitiesByState,
  getCitiesByCountry,
  getCityLocation,
};
