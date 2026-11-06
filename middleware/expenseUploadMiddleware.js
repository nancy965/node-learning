const multer = require("multer");
const path = require("path");
const fs = require("fs");

const uploadDir = path.join(__dirname, "../uploads/receipts");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const cleanBase = path
      .basename(file.originalname, ext)
      .replace(/[^a-zA-Z0-9_-]/g, "_")
      .slice(0, 40);
    const uniqueId = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `rcpt-${uniqueId}-${cleanBase}${ext}`);
  },
});

const allowedExtensions = [
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".pdf",
  ".doc",
  ".docx",
];

const expenseUpload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10 MB per receipt
    files: 5,
  },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `File type "${ext}" is not supported. Please upload a receipt image (JPG, PNG, WebP) or PDF/DOC.`
        )
      );
    }
  },
});

module.exports = expenseUpload;

