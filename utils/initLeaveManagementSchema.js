const pool = require("../config/databse");

async function initLeaveManagementSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("=== Initializing Leave Management Schema ===");

    // 1. Leave Types Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_types (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        annual_days NUMERIC(5,1) DEFAULT 12.0,
        is_carry_forward BOOLEAN DEFAULT FALSE,
        requires_attachment BOOLEAN DEFAULT FALSE,
        color VARCHAR(30) DEFAULT '#2563eb',
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Company Holidays Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS company_holidays (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        holiday_date DATE UNIQUE NOT NULL,
        is_optional BOOLEAN DEFAULT FALSE,
        description TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_holidays_date ON company_holidays(holiday_date);
    `);

    // 3. Leave Balances Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_balances (
        id SERIAL PRIMARY KEY,
        employee_id VARCHAR(100) NOT NULL,
        employee_role VARCHAR(50) DEFAULT 'employee',
        leave_type_id INT REFERENCES leave_types(id) ON DELETE CASCADE,
        year INT NOT NULL DEFAULT EXTRACT(YEAR FROM CURRENT_DATE),
        total_allocated NUMERIC(5,1) NOT NULL DEFAULT 0.0,
        used_days NUMERIC(5,1) NOT NULL DEFAULT 0.0,
        pending_days NUMERIC(5,1) NOT NULL DEFAULT 0.0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT unique_emp_leave_year UNIQUE(employee_id, leave_type_id, year)
      );
      CREATE INDEX IF NOT EXISTS idx_leave_balances_emp ON leave_balances(employee_id);
      CREATE INDEX IF NOT EXISTS idx_leave_balances_year ON leave_balances(year);
    `);

    // 4. Leave Requests Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_requests (
        id SERIAL PRIMARY KEY,
        request_code VARCHAR(50) UNIQUE NOT NULL,
        employee_id VARCHAR(100) NOT NULL,
        employee_name VARCHAR(150) NOT NULL,
        employee_email VARCHAR(150) NOT NULL,
        employee_role VARCHAR(50) DEFAULT 'employee',
        leave_type_id INT REFERENCES leave_types(id) ON DELETE RESTRICT,
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        total_days NUMERIC(5,1) NOT NULL,
        reason TEXT NOT NULL,
        attachment_path TEXT NULL,
        status VARCHAR(50) DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Cancelled')),
        approver_id VARCHAR(100) NULL,
        approver_name VARCHAR(150) NULL,
        decision_date TIMESTAMPTZ NULL,
        approver_remarks TEXT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_leave_requests_emp ON leave_requests(employee_id);
      CREATE INDEX IF NOT EXISTS idx_leave_requests_status ON leave_requests(status);
      CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON leave_requests(start_date, end_date);
    `);

    // 5. Leave Transactions (Ledger) Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS leave_transactions (
        id SERIAL PRIMARY KEY,
        employee_id VARCHAR(100) NOT NULL,
        leave_type_id INT REFERENCES leave_types(id) ON DELETE CASCADE,
        leave_request_id INT NULL REFERENCES leave_requests(id) ON DELETE SET NULL,
        transaction_type VARCHAR(50) NOT NULL CHECK (transaction_type IN ('ALLOCATION', 'DEBIT', 'CREDIT_REVERSAL', 'ADJUSTMENT')),
        days NUMERIC(5,1) NOT NULL,
        balance_before NUMERIC(5,1) NOT NULL,
        balance_after NUMERIC(5,1) NOT NULL,
        notes TEXT,
        created_by VARCHAR(100) NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_leave_tx_emp ON leave_transactions(employee_id);
    `);

    // 6. Seed Default Leave Types if empty
    const typeCount = await client.query("SELECT COUNT(*) FROM leave_types");
    if (parseInt(typeCount.rows[0].count, 10) === 0) {
      console.log("Seeding default leave types...");
      const defaultTypes = [
        {
          code: "PAID",
          name: "Paid Leave (PL)",
          desc: "Annual vacation and earned leave with full pay.",
          annual_days: 15.0,
          color: "#2563eb",
          carry_forward: true,
          req_attach: false,
        },
        {
          code: "SICK",
          name: "Sick Leave (SL)",
          desc: "Medical leave for illness, surgery, or medical appointments.",
          annual_days: 10.0,
          color: "#ef4444",
          carry_forward: false,
          req_attach: true,
        },
        {
          code: "CASUAL",
          name: "Casual Leave (CL)",
          desc: "Short duration leaves for personal or urgent unforeseen work.",
          annual_days: 7.0,
          color: "#f59e0b",
          carry_forward: false,
          req_attach: false,
        },
        {
          code: "UNPAID",
          name: "Leave Without Pay (LWP)",
          desc: "Absence granted without pay when quota is exhausted or for personal sabbatical.",
          annual_days: 30.0,
          color: "#64748b",
          carry_forward: false,
          req_attach: false,
        },
      ];

      for (const t of defaultTypes) {
        await client.query(
          `INSERT INTO leave_types (code, name, description, annual_days, color, is_carry_forward, requires_attachment)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [t.code, t.name, t.desc, t.annual_days, t.color, t.carry_forward, t.req_attach]
        );
      }
    }

    // 7. Seed 2026 Company Holidays if empty
    const holidayCount = await client.query("SELECT COUNT(*) FROM company_holidays");
    if (parseInt(holidayCount.rows[0].count, 10) === 0) {
      console.log("Seeding 2026 company holidays...");
      const holidays = [
        { name: "New Year's Day", date: "2026-01-01", desc: "First day of the year" },
        { name: "Republic Day", date: "2026-01-26", desc: "National holiday of India" },
        { name: "Holi", date: "2026-03-04", desc: "Festival of colors" },
        { name: "Good Friday", date: "2026-04-03", desc: "Christian holy day" },
        { name: "Dr. Ambedkar Jayanti", date: "2026-04-14", desc: "Birth anniversary of B. R. Ambedkar" },
        { name: "Labour / Gujarat Day", date: "2026-05-01", desc: "International Workers Day" },
        { name: "Independence Day", date: "2026-08-15", desc: "National independence celebration" },
        { name: "Raksha Bandhan", date: "2026-08-27", desc: "Festival of siblings" },
        { name: "Gandhi Jayanti", date: "2026-10-02", desc: "Birth anniversary of Mahatma Gandhi" },
        { name: "Dussehra", date: "2026-10-20", desc: "Vijayadashami celebration" },
        { name: "Diwali", date: "2026-11-08", desc: "Deepavali festival of lights" },
        { name: "Christmas Day", date: "2026-12-25", desc: "Christmas celebration" },
      ];

      for (const h of holidays) {
        await client.query(
          `INSERT INTO company_holidays (name, holiday_date, description)
           VALUES ($1, $2, $3)
           ON CONFLICT (holiday_date) DO NOTHING`,
          [h.name, h.date, h.desc]
        );
      }
    }

    // 8. Seed Initial Leave Balances for all active employees/admins (Year 2026)
    const currentYear = 2026;
    const leaveTypesRes = await client.query("SELECT id, annual_days FROM leave_types WHERE is_active = true");
    const activeLeaveTypes = leaveTypesRes.rows;

    const usersRes = await client.query("SELECT id, role FROM users WHERE is_active = true");
    const adminRes = await client.query("SELECT id, role FROM admin WHERE is_active = true");

    const allPeople = [
      ...usersRes.rows.map((u) => ({ id: u.id, role: u.role || "employee" })),
      ...adminRes.rows.map((a) => ({ id: a.id, role: a.role || "admin" })),
    ];

    for (const person of allPeople) {
      for (const lt of activeLeaveTypes) {
        const balCheck = await client.query(
          `SELECT id FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
          [person.id, lt.id, currentYear]
        );

        if (balCheck.rows.length === 0) {
          const insertRes = await client.query(
            `INSERT INTO leave_balances (employee_id, employee_role, leave_type_id, year, total_allocated, used_days, pending_days)
             VALUES ($1, $2, $3, $4, $5, 0.0, 0.0)
             RETURNING id`,
            [person.id, person.role, lt.id, currentYear, lt.annual_days]
          );

          // Log opening allocation in transactions
          await client.query(
            `INSERT INTO leave_transactions (employee_id, leave_type_id, transaction_type, days, balance_before, balance_after, notes, created_by)
             VALUES ($1, $2, 'ALLOCATION', $3, 0.0, $3, 'Annual opening balance allocation', 'system')`,
            [person.id, lt.id, lt.annual_days]
          );
        }
      }
    }

    // 9. Leave Management is accessed via the direct header action icon next to Email in the header

    await client.query("COMMIT");
    console.log("=== Leave Management Schema Initialized Successfully ===");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Failed to initialize Leave Management schema:", err);
    throw err;
  } finally {
    client.release();
  }
}

module.exports = initLeaveManagementSchema;

