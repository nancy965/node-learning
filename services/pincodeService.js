const pool = require("../config/databse");
const { createAdminNotification } = require("./notificationService");
const { decodeUUIDToId } = require("../utils/uuidUtils");

const getPincodes = async (
  page = null,
  limit = null,
  search = "",
  status = "all",
) => {
  // Keep existing behavior when pagination is not requested
  if (page === null || limit === null) {
    const result = await pool.query(
      `SELECT
         p.id,
         p.city_id,
         ci.name AS city_name,
         s.id AS state_id,
         s.name AS state_name,
         c.id AS country_id,
         c.name AS country_name,
         p.pincode,
         p.is_active,
         p.created_by,
         p.created_at
       FROM pincodes p
       LEFT JOIN cities ci ON p.city_id = ci.id
       LEFT JOIN states s ON ci.state_id = s.id
       LEFT JOIN countries c ON s.country_id = c.id
       ORDER BY p.id ASC`,
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
      p.pincode ILIKE $${paramIndex}
      OR ci.name ILIKE $${paramIndex}
      OR s.name ILIKE $${paramIndex}
      OR c.name ILIKE $${paramIndex}
    )`);

    paramIndex++;
  }

  if (status === "active") {
    conditions.push(`p.is_active = true`);
  } else if (status === "inactive") {
    conditions.push(`p.is_active = false`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM pincodes p
     LEFT JOIN cities ci ON p.city_id = ci.id
     LEFT JOIN states s ON ci.state_id = s.id
     LEFT JOIN countries c ON s.country_id = c.id
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT
       p.id,
       p.city_id,
       ci.name AS city_name,
       s.id AS state_id,
       s.name AS state_name,
       c.id AS country_id,
       c.name AS country_name,
       p.pincode,
       p.is_active,
       p.created_by,
       p.created_at
     FROM pincodes p
     LEFT JOIN cities ci ON p.city_id = ci.id
     LEFT JOIN states s ON ci.state_id = s.id
     LEFT JOIN countries c ON s.country_id = c.id
     ${whereClause}
     ORDER BY p.id ASC
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

const getPincodeById = async (id) => {
  const result = await pool.query(
    `SELECT
       p.id,
       p.city_id,
       ci.name AS city_name,
       s.id AS state_id,
       s.name AS state_name,
       c.id AS country_id,
       c.name AS country_name,
       p.pincode,
       p.is_active,
       p.created_by,
       p.created_at
     FROM pincodes p
     LEFT JOIN cities ci ON p.city_id = ci.id
     LEFT JOIN states s ON ci.state_id = s.id
     LEFT JOIN countries c ON s.country_id = c.id
     WHERE p.id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Pincode not found.",
    };
  }

  return {
    success: true,
    pincode: result.rows[0],
  };
};

const validatePincode = async (city_id, pincode) => {
  pincode = String(pincode).trim();

  const cityResult = await pool.query(
    `SELECT
       ci.id AS city_id,
       ci.name AS city_name,
       ci.is_active AS city_is_active,
       s.id AS state_id,
       s.name AS state_name,
       s.is_active AS state_is_active,
       c.id AS country_id,
       c.name AS country_name,
       c.is_active AS country_is_active
     FROM cities ci
     JOIN states s ON ci.state_id = s.id
     JOIN countries c ON s.country_id = c.id
     WHERE ci.id = $1`,
    [city_id],
  );

  if (cityResult.rows.length === 0) {
    return {
      valid: false,
      message: "City not found.",
    };
  }

  const location = cityResult.rows[0];

  if (!location.country_is_active) {
    return {
      valid: false,
      message: "Cannot create pincode under an inactive country.",
    };
  }

  if (!location.state_is_active) {
    return {
      valid: false,
      message: "Cannot create pincode under an inactive state.",
    };
  }

  if (!location.city_is_active) {
    return {
      valid: false,
      message: "Cannot create pincode under an inactive city.",
    };
  }

  const countryCodeResult = await pool.query(
    `SELECT country_code
     FROM world_countries_import
     WHERE LOWER(TRIM(name)) = LOWER(TRIM($1))
       AND country_code IS NOT NULL
     LIMIT 1`,
    [location.country_name],
  );

  if (countryCodeResult.rows.length === 0) {
    return {
      valid: false,
      message: `Country "${location.country_name}" does not have a valid country code.`,
    };
  }

  const countryCode = countryCodeResult.rows[0].country_code;

  const validPincode = await pool.query(
    `SELECT id
     FROM world_pincodes_import
     WHERE LOWER(TRIM(country_code)) = LOWER(TRIM($1))
       AND LOWER(TRIM(postal_code)) = LOWER(TRIM($2))
       AND LOWER(TRIM(state_name)) = LOWER(TRIM($3))
     LIMIT 1`,
    [countryCode, pincode, location.state_name],
  );

  if (validPincode.rows.length === 0) {
    return {
      valid: false,
      message: `Pincode "${pincode}" does not belong to state "${location.state_name}" in ${location.country_name}.`,
    };
  }

  return {
    valid: true,
    location,
    countryCode,
  };
};

const createPincode = async (
  city_id,
  pincode,
  is_active = true,
  created_by,
) => {
  if (typeof city_id === "string" && city_id.includes("-")) {
    city_id = decodeUUIDToId(city_id);
  }

  if (
    !city_id ||
    pincode === undefined ||
    pincode === null ||
    !String(pincode).trim()
  ) {
    return {
      success: false,
      status: 400,
      message: "City and pincode are required.",
    };
  }

  pincode = String(pincode).trim();

  if (!created_by) {
    return {
      success: false,
      status: 401,
      message: "Admin information is required.",
    };
  }

  const validation = await validatePincode(city_id, pincode);

  if (!validation.valid) {
    return {
      success: false,
      status: 400,
      message: validation.message,
    };
  }

  const existingPincode = await pool.query(
    `SELECT id
     FROM pincodes
     WHERE city_id = $1
       AND LOWER(TRIM(pincode)) = LOWER(TRIM($2))`,
    [city_id, pincode],
  );

  if (existingPincode.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "Pincode already exists for this city.",
    };
  }

  const result = await pool.query(
    `INSERT INTO pincodes
     (city_id, pincode, is_active, created_by)
     VALUES ($1, $2, $3, $4)
     RETURNING id, city_id, pincode, is_active, created_by, created_at`,
    [city_id, pincode, is_active, created_by],
  );

  await createAdminNotification(
    created_by,
    "Pincode Created",
    `${pincode} pincode has been created.`,
    "pincode_created",
  );

  return {
    success: true,
    status: 201,
    message: "Pincode created successfully.",
    pincode: result.rows[0],
  };
};

const updatePincode = async (id, city_id, pincode, is_active = true) => {
  if (typeof id === "string" && id.includes("-")) {
    id = decodeUUIDToId(id);
  }
  if (typeof city_id === "string" && city_id.includes("-")) {
    city_id = decodeUUIDToId(city_id);
  }

  if (
    !city_id ||
    pincode === undefined ||
    pincode === null ||
    !String(pincode).trim()
  ) {
    return {
      success: false,
      status: 400,
      message: "City and pincode are required.",
    };
  }

  pincode = String(pincode).trim();

  const existingPincode = await pool.query(
  `SELECT id, pincode, created_by, is_active
   FROM pincodes
   WHERE id = $1`,
  [id],
);

  if (existingPincode.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Pincode not found.",
    };
  }

  const validation = await validatePincode(city_id, pincode);

  if (!validation.valid) {
    return {
      success: false,
      status: 400,
      message: validation.message,
    };
  }

  const duplicatePincode = await pool.query(
    `SELECT id
     FROM pincodes
     WHERE city_id = $1
       AND LOWER(TRIM(pincode)) = LOWER(TRIM($2))
       AND id != $3`,
    [city_id, pincode, id],
  );

  if (duplicatePincode.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "Pincode already exists for this city.",
    };
  }

  const result = await pool.query(
    `UPDATE pincodes
     SET city_id = $1,
         pincode = $2,
         is_active = $3
     WHERE id = $4
     RETURNING id, city_id, pincode, is_active, created_by, created_at`,
    [city_id, pincode, is_active, id],
  );

  if (existingPincode.rows[0].is_active === true && is_active === false) {
    await createAdminNotification(
      existingPincode.rows[0].created_by,
      "Pincode Deactivated",
      `${pincode} pincode has been deactivated.`,
      "pincode_deactivated",
    );
  } else if (
    existingPincode.rows[0].is_active === false &&
    is_active === true
  ) {
    await createAdminNotification(
      existingPincode.rows[0].created_by,
      "Pincode Activated",
      `${pincode} pincode has been activated.`,
      "pincode_activated",
    );
  } else {
    await createAdminNotification(
      existingPincode.rows[0].created_by,
      "Pincode Updated",
      `${pincode} pincode details have been updated.`,
      "pincode_updated",
    );
  }

  return {
    success: true,
    status: 200,
    message: "Pincode updated successfully.",
    pincode: result.rows[0],
  };
};

const deletePincode = async (id) => {
  const result = await pool.query(
    `UPDATE pincodes
     SET is_active = false
     WHERE id = $1
     RETURNING id, city_id, pincode, is_active, created_by, created_at`,
    [id],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Pincode not found.",
    };
  }

  await createAdminNotification(
    result.rows[0].created_by,
    "Pincode Deactivated",
    `${result.rows[0].pincode} pincode has been deactivated.`,
    "pincode_deactivated",
  );

  return {
    success: true,
    status: 200,
    message: "Pincode deactivated successfully.",
    pincode: result.rows[0],
  };
};

const activatePincode = async (id) => {
  const result = await pool.query(
    `UPDATE pincodes
     SET is_active = true
     WHERE id = $1
     RETURNING id, city_id, pincode, is_active, created_by, created_at`,
    [id],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Pincode not found.",
    };
  }

  await createAdminNotification(
    result.rows[0].created_by,
    "Pincode Activated",
    `${result.rows[0].pincode} pincode has been activated.`,
    "pincode_activated",
  );

  return {
    success: true,
    status: 200,
    message: "Pincode activated successfully.",
    pincode: result.rows[0],
  };
};

const getPincodesByCity = async (cityId, page = 1, limit = 50, search = "") => {
  const offset = (page - 1) * limit;

  const values = [cityId];
  const conditions = [`city_id = $1`, `is_active = true`];

  let paramIndex = 2;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`pincode::text ILIKE $${paramIndex}`);

    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM pincodes
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT id, pincode
     FROM pincodes
     ${whereClause}
     ORDER BY pincode
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

const getPincodeLocation = async (pincode) => {
  const cleanPincode = String(pincode || "").trim();

  if (!cleanPincode) {
    return {
      success: false,
      status: 400,
      message: "Pincode is required",
    };
  }

  const result = await pool.query(
    `SELECT
       p.id AS pincode_id,
       p.pincode,
       c.id AS city_id,
       c.name AS city_name,
       s.id AS state_id,
       s.name AS state_name,
       co.id AS country_id,
       co.name AS country_name
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
       AND co.is_active = true
     LIMIT 1`,
    [cleanPincode],
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Pincode not found",
    };
  }

  return {
    success: true,
    location: result.rows[0],
  };
};

const getPincodesByState = async (
  stateId,
  page = 1,
  limit = 50,
  search = "",
) => {
  const offset = (page - 1) * limit;

  const values = [stateId];
  const conditions = [
    `s.id = $1`,
    `p.is_active = true`,
    `ci.is_active = true`,
    `s.is_active = true`,
  ];

  let paramIndex = 2;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`p.pincode::text ILIKE $${paramIndex}`);

    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM pincodes p
     JOIN cities ci
       ON ci.id = p.city_id
     JOIN states s
       ON s.id = ci.state_id
     ${whereClause}`,
    values,
  );

  const totalRecords = Number(countResult.rows[0].total);

  const dataValues = [...values, limit, offset];

  const result = await pool.query(
    `SELECT
       p.id,
       p.city_id,
       ci.name AS city_name,
       p.pincode
     FROM pincodes p
     JOIN cities ci
       ON ci.id = p.city_id
     JOIN states s
       ON s.id = ci.state_id
     ${whereClause}
     ORDER BY p.pincode
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

const getPincodesByCountry = async (
  countryId,
  page = 1,
  limit = 50,
  search = "",
) => {
  const offset = (page - 1) * limit;

  const values = [countryId];
  const conditions = [
    `c.id = $1`,
    `p.is_active = true`,
    `ci.is_active = true`,
    `s.is_active = true`,
    `c.is_active = true`,
  ];

  let paramIndex = 2;

  if (search.trim()) {
    values.push(`%${search.trim()}%`);

    conditions.push(`p.pincode::text ILIKE $${paramIndex}`);

    paramIndex++;
  }

  const whereClause = `WHERE ${conditions.join(" AND ")}`;

  const countResult = await pool.query(
    `SELECT COUNT(*) AS total
     FROM pincodes p
     JOIN cities ci
       ON ci.id = p.city_id
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
       p.id,
       p.city_id,
       ci.name AS city_name,
       s.id AS state_id,
       s.name AS state_name,
       p.pincode
     FROM pincodes p
     JOIN cities ci
       ON ci.id = p.city_id
     JOIN states s
       ON s.id = ci.state_id
     JOIN countries c
       ON c.id = s.country_id
     ${whereClause}
     ORDER BY p.pincode
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
  getPincodes,
  getPincodeById,
  createPincode,
  updatePincode,
  deletePincode,
  activatePincode,
  getPincodesByCity,
  getPincodeLocation,
  getPincodesByState,
  getPincodesByCountry,
};
