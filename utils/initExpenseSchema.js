const pool = require("../config/databse");

async function initExpenseSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("=== Initializing Expense Reimbursement Management Schema ===");

    // 1. Categories Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS expense_categories (
        id SERIAL PRIMARY KEY,
        category_code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        max_limit_per_claim NUMERIC(12,2) DEFAULT 5000.00,
        monthly_limit NUMERIC(12,2) DEFAULT 25000.00,
        requires_receipt BOOLEAN DEFAULT TRUE,
        icon VARCHAR(50) DEFAULT 'receipt',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Claims Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS expense_claims (
        id SERIAL PRIMARY KEY,
        claim_code VARCHAR(50) UNIQUE NOT NULL,
        employee_id VARCHAR(100) NOT NULL,
        employee_role VARCHAR(50) DEFAULT 'employee',
        category_id INT REFERENCES expense_categories(id) ON DELETE RESTRICT,
        title VARCHAR(255) NOT NULL,
        merchant_name VARCHAR(150),
        expense_date DATE NOT NULL,
        claim_amount NUMERIC(12,2) NOT NULL,
        approved_amount NUMERIC(12,2) NULL,
        payment_method VARCHAR(50) DEFAULT 'UPI',
        status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Reimbursed')),
        description TEXT,
        is_over_limit BOOLEAN DEFAULT FALSE,
        approved_by VARCHAR(100) NULL,
        approved_at TIMESTAMPTZ NULL,
        approval_notes TEXT NULL,
        rejected_by VARCHAR(100) NULL,
        rejected_at TIMESTAMPTZ NULL,
        rejection_reason TEXT NULL,
        reimbursed_by VARCHAR(100) NULL,
        reimbursed_at TIMESTAMPTZ NULL,
        settlement_mode VARCHAR(50) NULL,
        transaction_ref VARCHAR(100) NULL,
        settlement_notes TEXT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_expense_claims_emp ON expense_claims(employee_id);
      CREATE INDEX IF NOT EXISTS idx_expense_claims_status ON expense_claims(status);
      CREATE INDEX IF NOT EXISTS idx_expense_claims_date ON expense_claims(expense_date);
    `);

    // 3. Attachments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS expense_attachments (
        id SERIAL PRIMARY KEY,
        claim_id INT REFERENCES expense_claims(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path TEXT NOT NULL,
        file_type VARCHAR(100),
        file_size BIGINT,
        uploaded_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_expense_attachments_claim ON expense_attachments(claim_id);
    `);

    // 4. Seed Standard Categories if empty
    const catCheck = await client.query("SELECT COUNT(*) FROM expense_categories");
    if (parseInt(catCheck.rows[0].count, 10) === 0) {
      console.log("Seeding default expense categories...");
      const defaultCategories = [
        {
          code: "TRAVEL",
          name: "Travel & Transportation",
          desc: "Flights, train tickets, cab fares, and vehicle mileage for official travel.",
          limit: 15000.0,
          monthly: 40000.0,
          icon: "flight",
        },
        {
          code: "MEALS",
          name: "Client Meals & Entertainment",
          desc: "Business lunches, dinner with clients, and authorized refreshments.",
          limit: 2500.0,
          monthly: 10000.0,
          icon: "restaurant",
        },
        {
          code: "OFFICE_SUPPLIES",
          name: "Office Supplies & Stationery",
          desc: "Paper, printing ink, notebooks, office accessories, and pantry items.",
          limit: 5000.0,
          monthly: 15000.0,
          icon: "inventory",
        },
        {
          code: "INTERNET_PHONE",
          name: "Mobile & Internet Allowance",
          desc: "Monthly work-from-home broadband, cellular bills, and connectivity.",
          limit: 1500.0,
          monthly: 3000.0,
          icon: "wifi",
        },
        {
          code: "SOFTWARE_SAAS",
          name: "Software & SaaS Subscriptions",
          desc: "Official tools, software licenses, domain registrations, and cloud services.",
          limit: 10000.0,
          monthly: 30000.0,
          icon: "devices",
        },
        {
          code: "MISC",
          name: "General & Miscellaneous",
          desc: "Emergency company purchases, courier fees, and other authorized expenses.",
          limit: 3000.0,
          monthly: 10000.0,
          icon: "receipt_long",
        },
      ];

      for (const cat of defaultCategories) {
        await client.query(
          `INSERT INTO expense_categories (category_code, name, description, max_limit_per_claim, monthly_limit, icon)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [cat.code, cat.name, cat.desc, cat.limit, cat.monthly, cat.icon]
        );
      }
    }

    await client.query("COMMIT");
    console.log("=== Expense Reimbursement Management Schema Initialized Successfully ===");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to initialize Expense schema:", err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = initExpenseSchema;

