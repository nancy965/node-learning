const pool = require("../config/databse");
const { createAdminNotification } = require("./notificationService");

// Get countries
// If pagination arguments are provided, return paginated data.
// Otherwise, return all countries for dropdowns and other existing usages.
const getCountries = async (
  page = null,
  limit = null,
  search = "",
  status = "all",
) => {
  // Keep existing behavior for other parts of the project
  if (page === null || limit === null) {
    const result = await pool.query(
      `SELECT id, name, is_active, created_by, created_at
       FROM countries
       ORDER BY id DESC`,
    );

    return result.rows;
  }

  const offset = (page - 1) * limit;

  const values = [];
  const conditions = [];
  let paramIndex = 1;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`c.name ILIKE $${paramIndex}`);

    paramIndex++;
  }

  if (status === "active") {
    conditions.push(`c.is_active = true`);
  } else if (status === "inactive") {
    conditions.push(`c.is_active = false`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM countries c
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT
       c.id,
       c.name,
       c.is_active,
       c.created_by,
       c.created_at
     FROM countries c
     ${whereClause}
     ORDER BY c.id DESC
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

// Get country by id
const getCountryById = async (id) => {
  const result = await pool.query(
    `SELECT id, name, is_active, created_by, created_at
     FROM countries
     WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Country not found",
    };
  }

  return {
    success: true,
    country: result.rows[0],
  };
};

// Create country
const createCountry = async (name, is_active = true, created_by) => {
  const validCountry = await pool.query(
    `SELECT id
     FROM world_countries_import
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
     LIMIT 1`,
    [name],
  );

  if (validCountry.rows.length === 0) {
    return {
      success: false,
      status: 400,
      message: `"${name}" is not a valid country.`,
    };
  }

  const existingCountry = await pool.query(
    `SELECT id
     FROM countries
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))`,
    [name],
  );

  if (existingCountry.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "Country already exists",
    };
  }

  const result = await pool.query(
    `INSERT INTO countries
     (name, is_active, created_by)
     VALUES ($1, $2, $3)
     RETURNING id, name, is_active, created_by, created_at`,
    [name, is_active, created_by],
  );

  await createAdminNotification(
    created_by,
    "Country Created",
    `${name} country has been created.`,
    "country_created",
  );

  return {
    success: true,
    status: 201,
    message: "Country created successfully",
    country: result.rows[0],
  };
};

// Update country
const updateCountry = async (id, name, is_active = true, updated_by) => {
  const existingCountry = await pool.query(
    `SELECT *
     FROM countries
     WHERE id = $1`,
    [id],
  );

  if (existingCountry.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Country not found",
    };
  }

  const validCountry = await pool.query(
    `SELECT id
     FROM world_countries_import
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
     LIMIT 1`,
    [name],
  );

  if (validCountry.rows.length === 0) {
    return {
      success: false,
      status: 400,
      message: `"${name}" is not a valid country.`,
    };
  }

  const duplicateCountry = await pool.query(
    `SELECT id
     FROM countries
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
     AND id != $2`,
    [name, id],
  );

  if (duplicateCountry.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "Country already exists",
    };
  }

  const result = await pool.query(
    `UPDATE countries
     SET name = $1,
         is_active = $2
     WHERE id = $3
     RETURNING id, name, is_active, created_by, created_at`,
    [name, is_active, id],
  );

  if (updated_by) {
    if (existingCountry.rows[0].is_active === true && is_active === false) {
      await createAdminNotification(
        updated_by,
        "Country Deactivated",
        `${name} country has been deactivated.`,
        "country_deactivated",
      );
    } else {
      await createAdminNotification(
        updated_by,
        "Country Updated",
        `${name} country details have been updated.`,
        "country_updated",
      );
    }
  }

  return {
    success: true,
    status: 200,
    message: "Country updated successfully",
    country: result.rows[0],
  };
};

// Delete country
const deleteCountry = async (id) => {
  const result = await pool.query(
    `UPDATE countries
     SET is_active = false
     WHERE id = $1
     RETURNING id, name, is_active, created_by, created_at`,
    [id],
  );

  await createAdminNotification(
    result.rows[0].created_by,
    "Country Deactivated",
    `${result.rows[0].name} country has been deactivated.`,
    "country_deactivated",
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Country not found",
    };
  }

  return {
    success: true,
    status: 200,
    message: "Country deactivated successfully",
    country: result.rows[0],
  };
};

// Activate country
const activateCountry = async (id) => {
  const result = await pool.query(
    `UPDATE countries
     SET is_active = true
     WHERE id = $1
     RETURNING id, name, is_active, created_by, created_at`,
    [id],
  );

  await createAdminNotification(
    result.rows[0].created_by,
    "Country Activated",
    `${result.rows[0].name} country has been activated.`,
    "country_activated",
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Country not found",
    };
  }

  return {
    success: true,
    status: 200,
    message: "Country activated successfully",
    country: result.rows[0],
  };
};

const getActiveCountries = async (page = 1, limit = 50, search = "") => {
  const offset = (page - 1) * limit;

  const values = [];
  const conditions = ["is_active = true"];
  let paramIndex = 1;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`name ILIKE $${paramIndex}`);

    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM countries
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT id, name
     FROM countries
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

module.exports = {
  getCountries,
  getCountryById,
  createCountry,
  updateCountry,
  deleteCountry,
  activateCountry,
  getActiveCountries,
};
