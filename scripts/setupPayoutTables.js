const pool = require("../config/databse");

async function setup() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS employee_bank_details (
        id SERIAL PRIMARY KEY,
        user_id VARCHAR(255) NOT NULL UNIQUE,
        account_holder_name VARCHAR(255),
        account_number VARCHAR(100),
        ifsc_code VARCHAR(50),
        bank_name VARCHAR(255),
        upi_id VARCHAR(100),
        preferred_mode VARCHAR(50) DEFAULT 'bank_account',
        razorpay_contact_id VARCHAR(100),
        razorpay_fund_account_id VARCHAR(100),
        is_verified BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    console.log("SUCCESS: employee_bank_details table verified/created.");

    // Also check if expense_claims has payout-specific tracking columns if needed
    await pool.query(`
      ALTER TABLE expense_claims 
      ADD COLUMN IF NOT EXISTS payout_id VARCHAR(100),
      ADD COLUMN IF NOT EXISTS payout_status VARCHAR(50),
      ADD COLUMN IF NOT EXISTS payout_utr VARCHAR(100),
      ADD COLUMN IF NOT EXISTS payout_mode VARCHAR(50),
      ADD COLUMN IF NOT EXISTS payout_failure_reason TEXT;
    `);
    console.log("SUCCESS: expense_claims payout columns verified/added.");

    process.exit(0);
  } catch (err) {
    console.error("SETUP ERROR:", err);
    process.exit(1);
  }
}

setup();

