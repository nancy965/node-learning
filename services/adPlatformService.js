const pool = require("../config/databse");
const { createAdActivityLog } = require("./adActivityLogService");
const { createAdminNotification } = require("./notificationService");

const getAdPlatforms = async () => {
  const result = await pool.query(`
    SELECT
      ap.id,
      ap.name,
      ap.code,
      ap.description,
      ap.is_active,
      ap.created_by,
      a.name AS created_by_name,
      ap.created_at,
      ap.updated_at
    FROM ad_platforms ap
LEFT JOIN admin a ON a.id = ap.created_by
ORDER BY ap.id DESC
  `);

  return result.rows;
};

const getAdPlatformById = async (id) => {
  const result = await pool.query(
    `
      SELECT
        ap.id,
        ap.name,
        ap.code,
        ap.description,
        ap.is_active,
        ap.created_by,
        a.name AS created_by_name,
        ap.created_at,
        ap.updated_at
      FROM ad_platforms ap
      LEFT JOIN admin a ON a.id = ap.created_by
      WHERE ap.id = $1
    `,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
};

const addAdPlatform = async (data, userId) => {
  const { name, code, description } = data;

  const existingPlatform = await pool.query(
    `
      SELECT id
      FROM ad_platforms
      WHERE LOWER(name) = LOWER($1)
         OR LOWER(code) = LOWER($2)
    `,
    [name, code]
  );

  if (existingPlatform.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "Platform name or code already exists",
    };
  }

  const result = await pool.query(
    `
      INSERT INTO ad_platforms
      (name, code, description, created_by)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `,
    [name, code, description || null, userId]
  );

  const platform = result.rows[0];

  await createAdActivityLog({
    performedBy: userId,
    action: "PLATFORM_CREATED",
    entityType: "platform",
    entityId: platform.id,
    details: {
      name: platform.name,
      code: platform.code,
    },
  });

  await createAdminNotification(
  userId,
  "Ad Platform Created",
  `${platform.name} ad platform has been created.`,
  "platform_created",
);

  return {
    success: true,
    status: 201,
    message: "Ad platform created successfully",
    data: platform,
  };
};

const updateAdPlatform = async (id, data, userId) => {
  const { name, code, description, is_active } = data;

  const existingPlatform = await pool.query(
  `
    SELECT id
    FROM ad_platforms
    WHERE (LOWER(name) = LOWER($1)
       OR LOWER(code) = LOWER($2))
      AND id != $3
  `,
  [name, code, id]
);

const currentPlatform = await pool.query(
  `
    SELECT id, name, is_active, created_by
    FROM ad_platforms
    WHERE id = $1
  `,
  [id]
);

if (currentPlatform.rows.length === 0) {
  return {
    success: false,
    status: 404,
    message: "Ad platform not found",
  };
}

  if (existingPlatform.rows.length > 0) {
    return {
      success: false,
      status: 409,
      message: "Platform name or code already exists",
    };
  }

  const result = await pool.query(
    `
      UPDATE ad_platforms
      SET
        name = $1,
        code = $2,
        description = $3,
        is_active = $4,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $5
      RETURNING *
    `,
    [name, code, description || null, is_active, id]
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Ad platform not found",
    };
  }

  const platform = result.rows[0];

  await createAdActivityLog({
    performedBy: userId,
    action: "PLATFORM_UPDATED",
    entityType: "platform",
    entityId: platform.id,
    details: {
      name: platform.name,
      code: platform.code,
    },
  });

  if (
  currentPlatform.rows[0].is_active === true &&
  is_active === false
) {
  await createAdminNotification(
    userId,
    "Ad Platform Deactivated",
    `${platform.name} ad platform has been deactivated.`,
    "platform_deactivated",
  );
} else if (
  currentPlatform.rows[0].is_active === false &&
  is_active === true
) {
  await createAdminNotification(
    userId,
    "Ad Platform Activated",
    `${platform.name} ad platform has been activated.`,
    "platform_activated",
  );
} else {
  await createAdminNotification(
    userId,
    "Ad Platform Updated",
    `${platform.name} ad platform details have been updated.`,
    "platform_updated",
  );
}

  return {
    success: true,
    status: 200,
    message: "Ad platform updated successfully",
    data: platform,
  };
};

const deleteAdPlatform = async (id, userId) => {
  const result = await pool.query(
    `
      UPDATE ad_platforms
      SET
        is_active = FALSE,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `,
    [id]
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Ad platform not found",
    };
  }

  const platform = result.rows[0];

  await createAdActivityLog({
    performedBy: userId,
    action: "PLATFORM_DEACTIVATED",
    entityType: "platform",
    entityId: platform.id,
    details: {
      name: platform.name,
      code: platform.code,
    },
  });

  await createAdminNotification(
  userId,
  "Ad Platform Deactivated",
  `${platform.name} ad platform has been deactivated.`,
  "platform_deactivated",
);

  return {
    success: true,
    status: 200,
    message: "Ad platform deactivated successfully",
    data: platform,
  };
};

module.exports = {
  getAdPlatforms,
  getAdPlatformById,
  addAdPlatform,
  updateAdPlatform,
  deleteAdPlatform,
};