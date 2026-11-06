const multer = require("multer");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5 MB
  },
  fileFilter: (req, file, cb) => {
    const allowedExtensions = [".xlsx", ".xls"];
    const extension = file.originalname
      .toLowerCase()
      .slice(file.originalname.lastIndexOf("."));

    if (!allowedExtensions.includes(extension)) {
      return cb(new Error("Only Excel files (.xlsx or .xls) are allowed"));
    }

    cb(null, true);
  },
});

module.exports = upload;