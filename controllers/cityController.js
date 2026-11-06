const cityService = require("../services/cityService");
const { decodeUUIDToId } = require("../utils/uuidUtils");

const getCities = async (req, res, next) => {
  try {
    const page = Math.max(
      parseInt(req.query.page, 10) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit, 10) || 50,
        1
      ),
      500
    );

    const search = String(
      req.query.search || ""
    );

    const allowedStatuses = [
      "all",
      "active",
      "inactive",
    ];

    const status =
      allowedStatuses.includes(req.query.status)
        ? req.query.status
        : "all";

    const result =
      await cityService.getCities(
        page,
        limit,
        search,
        status
      );

    res.status(200).json({
      success: true,
      message: "Cities fetched successfully",
      data: result.rows,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getCityById = async (req, res, next) => {
  try {
    const id = req.params.id;

    const result = await cityService.getCityById(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: "City fetched successfully",
      data: result.city,
    });
  } catch (error) {
    next(error);
  }
};

const createCity = async (req, res, next) => {
  try {
    let { state_id, stateId, name, is_active = true } = req.body;
    let targetStateId = state_id || stateId;
    if (typeof targetStateId === "string" && targetStateId.includes("-")) {
      targetStateId = decodeUUIDToId(targetStateId);
    }

    if (!targetStateId) {
      return res.status(400).json({
        success: false,
        message: "State is required",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "City name is required",
      });
    }

    const cityName = String(name).trim();

    if (!cityName) {
      return res.status(400).json({
        success: false,
        message: "City name is required",
      });
    }

    if (!/^[A-Za-z ]+$/.test(cityName)) {
      return res.status(400).json({
        success: false,
        message: "City name should contain only letters",
      });
    }

    const result = await cityService.createCity(
      targetStateId,
      cityName,
      is_active,
      req.user.userId
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(201).json({
      success: true,
      message: result.message,
      data: result.city,
    });
  } catch (error) {
    next(error);
  }
};

const updateCity = async (req, res, next) => {
  try {
    let id = req.params.id;
    if (typeof id === "string" && id.includes("-")) {
      id = decodeUUIDToId(id);
    }

    let { state_id, stateId, name, is_active = true } = req.body;
    let targetStateId = state_id || stateId;
    if (typeof targetStateId === "string" && targetStateId.includes("-")) {
      targetStateId = decodeUUIDToId(targetStateId);
    }

    if (!targetStateId) {
      return res.status(400).json({
        success: false,
        message: "State is required",
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "City name is required",
      });
    }

    const cityName = String(name).trim();

    if (!cityName) {
      return res.status(400).json({
        success: false,
        message: "City name is required",
      });
    }

    if (!/^[A-Za-z ]+$/.test(cityName)) {
      return res.status(400).json({
        success: false,
        message: "City name should contain only letters",
      });
    }

    const result = await cityService.updateCity(
      id,
      targetStateId,
      cityName,
      is_active
    );

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.city,
    });
  } catch (error) {
    next(error);
  }
};

const deleteCity = async (req, res, next) => {
  try {
    

    const id = req.params.id;

    const result = await cityService.deleteCity(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.city,
    });
  } catch (error) {
    next(error);
  }
};

const activateCity = async (id) => {
  const city = await pool.query(
    `SELECT id, state_id, name
     FROM cities
     WHERE id = $1`,
    [id]
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
    [state_id]
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
    [state_id, name, id]
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
    [id]
  );

  return {
    success: true,
    status: 200,
    message: "City activated successfully.",
    city: result.rows[0],
  };
};

const getCitiesByState = async (req, res, next) => {
  try {
    const { stateId } = req.params;

    const page = Math.max(
      parseInt(req.query.page) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit) || 50,
        1
      ),
      500
    );

    const search = req.query.search || "";

    const result =
      await cityService.getCitiesByState(
        stateId,
        page,
        limit,
        search
      );

    res.status(200).json({
      success: true,
      cities: result.rows,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getCitiesByCountry = async (req, res, next) => {
  try {
    const { countryId } = req.params;

    const page = Math.max(
      parseInt(req.query.page) || 1,
      1
    );

    const limit = Math.min(
      Math.max(
        parseInt(req.query.limit) || 50,
        1
      ),
      500
    );

    const search = req.query.search || "";

    const result =
      await cityService.getCitiesByCountry(
        countryId,
        page,
        limit,
        search
      );

    res.status(200).json({
      success: true,
      cities: result.rows,
      pagination: {
        page: result.page,
        limit: result.limit,
        totalRecords: result.totalRecords,
        totalPages: result.totalPages,
      },
    });
  } catch (error) {
    next(error);
  }
};

const getCityLocation = async (req, res) => {
  try {
    const { city } = req.params;

    const result =
      await cityService.getCityLocation(city);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      location: result.location,
    });
  } catch (error) {
    console.error(
      "Get city location error:",
      error
    );

    res.status(500).json({
      success: false,
      message: "Failed to find city location.",
    });
  }
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