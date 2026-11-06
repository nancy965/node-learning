const bcrypt = require("bcrypt");
const pool = require("../config/databse");
const {
  createAdminNotification,
  createEmployeeNotification,
} = require("./notificationService");

const getProfile = async (
  userId,
  role,
  registerId
) => {
  let result;

  if (
    role === "general_admin" ||
    role === "admin"
  ) {
    result = await pool.query(
      `
        SELECT
          a.id,
          a.register_id,
          a.name,
          a.email,
          a.age,
          a.role,
          a.role_id,
          r.name AS role_name,
          a.is_active,
          a.created_at
        FROM admin a
        LEFT JOIN roles r
          ON r.id = a.role_id
        WHERE a.id = $1
          AND a.register_id = $2
      `,
      [userId, registerId]
    );
  } else {
    result = await pool.query(
      `
        SELECT
          u.id,
          u.register_id,
          u.name,
          u.email,
          u.age,
          u.role,
          u.role_id,
          r.name AS role_name,
          u.country_id,
          u.state_id,
          u.city_id,
          u.pincode_id,
          c.name AS country_name,
          s.name AS state_name,
          ci.name AS city_name,
          p.pincode,
          u.is_active,
          u.created_at
        FROM users u
        LEFT JOIN roles r
          ON r.id = u.role_id
        LEFT JOIN countries c
          ON c.id = u.country_id
        LEFT JOIN states s
          ON s.id = u.state_id
        LEFT JOIN cities ci
          ON ci.id = u.city_id
        LEFT JOIN pincodes p
          ON p.id = u.pincode_id
        WHERE u.id = $1
          AND u.register_id = $2
      `,
      [userId, registerId]
    );
  }

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Profile not found",
    };
  }

  const user = result.rows[0];

  if (!user.is_active) {
    return {
      success: false,
      status: 403,
      message: "Account is inactive",
    };
  }

  return {
    success: true,
    status: 200,
    message: "Profile fetched successfully",
    user,
  };
};

const updateProfile = async (
  userId,
  role,
  registerId,
  data
) => {
  const {
    name,
    age,
    country_id,
    state_id,
    city_id,
    pincode_id,
  } = data;

  if (
    role === "general_admin" ||
    role === "admin"
  ) {
    const result = await pool.query(
      `
        UPDATE admin
        SET
          name = $1,
          age = $2
        WHERE id = $3
          AND register_id = $4
        RETURNING
          id,
          register_id,
          name,
          email,
          age,
          role,
          role_id,
          is_active,
          created_at
      `,
      [
        name,
        age || null,
        userId,
        registerId,
      ]
    );

    if (result.rows.length === 0) {
      return {
        success: false,
        status: 404,
        message: "Profile not found",
      };
    }

    try {
      await createAdminNotification(
        userId,
        "Profile Updated",
        "Your profile details have been updated.",
        "user_updated"
      );
    } catch (e) {
      console.error("Profile notification error:", e);
    }

    try {
      await createEmployeeNotification(
        userId,
        "Profile Updated",
        "Your profile details have been updated.",
        "user_updated"
      );
    } catch (e) {
      console.error("Profile notification error:", e);
    }

    return {
      success: true,
      status: 200,
      message: "Profile updated successfully",
      user: result.rows[0],
    };
  }

  const result = await pool.query(
    `
      UPDATE users
      SET
        name = $1,
        age = $2,
        country_id = $3,
        state_id = $4,
        city_id = $5,
        pincode_id = $6
      WHERE id = $7
        AND register_id = $8
      RETURNING
        id,
        register_id,
        name,
        email,
        age,
        role,
        role_id,
        country_id,
        state_id,
        city_id,
        pincode_id,
        is_active,
        created_at
    `,
    [
      name,
      age || null,
      country_id || null,
      state_id || null,
      city_id || null,
      pincode_id || null,
      userId,
      registerId,
    ]
  );

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Profile not found",
    };
  }

  return {
    success: true,
    status: 200,
    message: "Profile updated successfully",
    user: result.rows[0],
  };
};

const changeProfilePassword = async (
  userId,
  role,
  registerId,
  currentPassword,
  newPassword
) => {
  let result;

  if (
    role === "general_admin" ||
    role === "admin"
  ) {
    result = await pool.query(
      `
        SELECT password
        FROM admin
        WHERE id = $1
          AND register_id = $2
      `,
      [userId, registerId]
    );
  } else {
    result = await pool.query(
      `
        SELECT password
        FROM users
        WHERE id = $1
          AND register_id = $2
      `,
      [userId, registerId]
    );
  }

  if (result.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "User not found",
    };
  }

  const user = result.rows[0];

  const passwordMatch = await bcrypt.compare(
    currentPassword,
    user.password
  );

  if (!passwordMatch) {
    return {
      success: false,
      status: 401,
      message: "Current password is incorrect",
    };
  }

  const hashedPassword = await bcrypt.hash(
    newPassword,
    10
  );

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    await client.query(
      `
        UPDATE register
        SET password = $1
        WHERE id = $2
      `,
      [hashedPassword, registerId]
    );

    if (
      role === "general_admin" ||
      role === "admin"
    ) {
      await client.query(
        `
          UPDATE admin
          SET password = $1
          WHERE id = $2
            AND register_id = $3
        `,
        [
          hashedPassword,
          userId,
          registerId,
        ]
      );
    } else {
      await client.query(
        `
          UPDATE users
          SET password = $1
          WHERE id = $2
            AND register_id = $3
        `,
        [
          hashedPassword,
          userId,
          registerId,
        ]
      );
    }

    await client.query("COMMIT");

    try {
      if (role === "general_admin" || role === "admin") {
        await createAdminNotification(
          userId,
          "Password Changed",
          "Your account password has been changed successfully.",
          "security"
        );
      } else {
        await createEmployeeNotification(
          userId,
          "Password Changed",
          "Your account password has been changed successfully.",
          "security"
        );
      }
    } catch (e) {
      console.error("Password change notification error:", e);
    }

    return {
      success: true,
      status: 200,
      message: "Password changed successfully",
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  getProfile,
  updateProfile,
  changeProfilePassword,
};