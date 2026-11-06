// Handles the request and response.

const userService = require("../services/userService");
const XLSX = require("xlsx");

const getUsers = async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = Number(req.query.limit) || 5;
    const status = req.query.status || "";
    const search = req.query.search || "";

    const result = await userService.getUsers(
      req.user.userId,
      req.user.baseRole,
      page,
      limit,
      status,
      search,
    );

    res.status(200).json({
      success: true,
      message: "Users fetched successfully",
      data: result.users,
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

//get users by id
const getUserById = async (req, res, next) => {
  try {
    const id = req.params.id;

    const result = await userService.getUserById(id);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: "User fetched successfully",
      data: result.user,
    });
  } catch (error) {
    next(error);
  }
};

//add user
const addUser = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      age,
      role = "employee",
      is_active = true,
      adminId: requestedAdminId,
      countryId,
      stateId,
      cityId,
      pincodeId,
      roleId,
    } = req.body;

    let adminId;

    if (req.user.baseRole === "general_admin") {
      // General Admin selects which admin should own the employee
      adminId = requestedAdminId;
    } else {
      // Normal Admin creates employee under themselves
      adminId = req.user.userId;
    }

    if (role === "employee" && !adminId) {
      return res.status(400).json({
        success: false,
        message: "Admin ID is required",
      });
    }

    if (role === "employee") {
      if (!countryId || !stateId || !cityId || !pincodeId) {
        return res.status(400).json({
          success: false,
          message: "Country, state, city and pincode are required",
        });
      }
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    if (!/^[A-Za-z ]+$/.test(name)) {
      return res.status(400).json({
        success: false,
        message: "Name should contain only letters",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const emailRegex = /^[A-Za-z0-9._%+-]+@gmail\.com$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Email must be a valid Gmail address",
      });
    }

    if (!password) {
      return res.status(400).json({
        success: false,
        message: "Password is required",
      });
    }

    if (age === undefined || age === null || age === "") {
      return res.status(400).json({
        success: false,
        message: "Age is required",
      });
    }

    if (isNaN(age)) {
      return res.status(400).json({
        success: false,
        message: "Age must be a number",
      });
    }

    if (age < 18 || age > 100) {
      return res.status(400).json({
        success: false,
        message: "Age must be between 18 and 100",
      });
    }

    if (role !== "general_admin" && role !== "admin" && role !== "employee") {
      return res.status(400).json({
        success: false,
        message: "Invalid role",
      });
    }

    const result = await userService.addUser(
      name,
      email,
      password,
      age,
      role,
      is_active,
      adminId,
      req.user.userId,
      countryId,
      stateId,
      cityId,
      pincodeId,
      roleId,
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
      data: result.user,
    });
  } catch (error) {
    next(error);
  }
};

//bulk users
const bulkAddUsers = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please upload an Excel file",
      });
    }

    const workbook = XLSX.read(req.file.buffer, {
      type: "buffer",
    });

    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const rawRows = XLSX.utils.sheet_to_json(worksheet, {
      defval: "",
    });

    const rows = rawRows.map((row) => {
      const normalizedRow = {};

      Object.keys(row).forEach((key) => {
        normalizedRow[key.trim().toLowerCase()] = row[key];
      });

      return normalizedRow;
    });

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "Excel file is empty",
      });
    }

    const users = [];
    const emailsInFile = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];

      const name = String(row.name || "").trim();
      const email = String(row.email || "")
        .trim()
        .toLowerCase();
      const password = String(row.password || "").trim();
      const age = Number(row.age);
      const role = String(row.role || "")
        .trim()
        .toLowerCase();

      const country = String(row.country || "").trim();
      const state = String(row.state || "").trim();
      const city = String(row.city || "").trim();
      const pincode = String(row.pincode || "").trim();

      const rowNumber = i + 2;

      if (!name) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Name is required`,
        });
      }

      if (!/^[A-Za-z ]+$/.test(name)) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Name should contain only letters`,
        });
      }

      if (!email) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Email is required`,
        });
      }

      const emailRegex = /^[A-Za-z0-9._%+-]+@gmail\.com$/;

      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Email must be a valid Gmail address`,
        });
      }

      if (emailsInFile.has(email)) {
        return res.status(409).json({
          success: false,
          message: `Row ${rowNumber}: Email ${email} is duplicated in the Excel file`,
        });
      }

      emailsInFile.add(email);

      if (!password) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Password is required`,
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Password must be at least 6 characters`,
        });
      }

      if (row.age === "" || row.age === undefined || row.age === null) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Age is required`,
        });
      }

      if (isNaN(age)) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Age must be a number`,
        });
      }

      if (age < 18 || age > 100) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Age must be between 18 and 100`,
        });
      }

      if (role !== "employee") {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Role must be employee`,
        });
      }

      if (!pincode) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Pincode is required`,
        });
      }

      if (!country && !state && !city) {
        users.push({
          name,
          email,
          age,
          password,
          role: "employee",
          country: "",
          state: "",
          city: "",
          pincode,
          rowNumber,
        });

        continue;
      }

      if (!country) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: Country is required when State or City is provided`,
        });
      }

      if (!state) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: State is required when City is provided`,
        });
      }

      if (!city) {
        return res.status(400).json({
          success: false,
          message: `Row ${rowNumber}: City is required when location details are provided`,
        });
      }

      users.push({
        name,
        email,
        age,
        password,
        role: "employee",
        country,
        state,
        city,
        pincode,
        rowNumber,
      });
    }

    let adminId;

    if (req.user.baseRole === "admin") {
      adminId = req.user.userId;
    } else if (req.user.baseRole === "general_admin") {
      return res.status(400).json({
        success: false,
        message: "Please select an admin before uploading employees",
      });
    }

    if (!adminId) {
      return res.status(400).json({
        success: false,
        message: "Admin ID is required",
      });
    }

    const result = await userService.bulkAddUsers(
      users,
      adminId,
      req.user.userId,
    );

    return res.status(result.status).json({
      success: result.success,
      message: result.message,
      createdCount: result.users.length,
      data: result.users,
    });
  } catch (error) {
    console.error("BULK UPLOAD CONTROLLER ERROR:", error);

    const status = error.status || 400;

    return res.status(status).json({
      success: false,
      message: error.message || "Unable to upload users",
    });
  }
};

//update user/ employee
const updateUser = async (req, res, next) => {
  try {
    const id = req.params.id;

    const {
      name,
      email,
      age,
      role = "employee",
      is_active = true,
      countryId,
      stateId,
      cityId,
      pincodeId,
      roleId,
      adminId,
      requireApproval,
      require_approval,
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    if (!/^[A-Za-z ]+$/.test(name)) {
      return res.status(400).json({
        success: false,
        message: "Name should contain only letters",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const emailRegex = /^[A-Za-z0-9._%+-]+@gmail\.com$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Email must be a valid Gmail address",
      });
    }

    if (age === undefined || age === null || age === "") {
      return res.status(400).json({
        success: false,
        message: "Age is required",
      });
    }

    if (isNaN(age)) {
      return res.status(400).json({
        success: false,
        message: "Age must be a number",
      });
    }

    if (age < 18 || age > 100) {
      return res.status(400).json({
        success: false,
        message: "Age must be between 18 and 100",
      });
    }

    const shouldRequireApproval = Boolean(requireApproval || require_approval);

    const result = await userService.updateUser(
      id,
      name,
      email,
      age,
      role,
      is_active,
      req.user.userId,
      countryId,
      stateId,
      cityId,
      pincodeId,
      roleId,
      adminId,
      shouldRequireApproval,
      req.user,
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
      data: result.user || result.data,
      requiresApproval: Boolean(result.requiresApproval),
      requestCode: result.requestCode || null,
      changeId: result.changeId || null,
    });
  } catch (error) {
    next(error);
  }
};

//delete user

const deleteUser = async (req, res, next) => {
  try {
    const id = req.params.id;
    const performedBy = req.user?.userId || req.user?.id || req.user?.registerId;

    const result = await userService.deleteUser(id, performedBy);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.user,
    });
  } catch (error) {
    next(error);
  }
};

//get admins

const getAdmins = async (req, res, next) => {
  try {
    const admins = await userService.getAdmins();

    res.status(200).json({
      success: true,
      message: "Admins fetched successfully",
      data: admins,
    });
  } catch (error) {
    next(error);
  }
};

//get admin by id

const getAdminById = async (req, res, next) => {
  try {
    const adminId = req.params.id;

    const result = await userService.getAdminById(adminId);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: "Admin details fetched successfully",
      data: {
        admin: result.admin,
        users: result.users,
      },
    });
  } catch (error) {
    next(error);
  }
};

//update menu

const updateAdmin = async (req, res, next) => {
  try {
    const id = req.params.id;

    const { name, email, age, is_active = true, countryId, stateId, cityId, pincodeId } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        message: "Name is required",
      });
    }

    if (!/^[A-Za-z ]+$/.test(name)) {
      return res.status(400).json({
        success: false,
        message: "Name should contain only letters",
      });
    }

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const emailRegex = /^[A-Za-z0-9._%+-]+@gmail\.com$/;

    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    if (age === undefined || age === null || age === "") {
      return res.status(400).json({
        success: false,
        message: "Age is required",
      });
    }

    if (isNaN(age)) {
      return res.status(400).json({
        success: false,
        message: "Age must be a number",
      });
    }

    if (age < 18 || age > 100) {
      return res.status(400).json({
        success: false,
        message: "Age must be between 18 and 100",
      });
    }

    const result = await userService.updateAdmin(
      id,
      name,
      email,
      age,
      is_active,
      countryId,
      stateId,
      cityId,
      pincodeId,
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
      data: result.admin,
    });
  } catch (error) {
    next(error);
  }
};

//dlete menu

const deleteAdmin = async (req, res, next) => {
  try {
    const id = req.params.id;

    const result = await userService.deleteAdmin(id, req.user.userId);

    if (!result.success) {
      return res.status(result.status).json({
        success: false,
        message: result.message,
      });
    }

    res.status(200).json({
      success: true,
      message: result.message,
      data: result.admin,
    });
  } catch (error) {
    next(error);
  }
};

//exports

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
