const pool = require("../config/databse");

/**
 * RazorpayX Payouts Service
 * Handles automated transfers via RazorpayX Payout API or Test/Sandbox Mode.
 */

const getRazorpayCredentials = () => {
  const keyId = process.env.RAZORPAYX_KEY_ID || "";
  const keySecret = process.env.RAZORPAYX_KEY_SECRET || "";
  const accountNumber = process.env.RAZORPAYX_ACCOUNT_NUMBER || "";
  const isConfigured = Boolean(
    keyId &&
    keySecret &&
    accountNumber &&
    !keyId.includes("YOUR_") &&
    !keySecret.includes("YOUR_")
  );

  return { keyId, keySecret, accountNumber, isConfigured };
};

/**
 * Helper to call RazorpayX API
 */
const razorpayRequest = async (endpoint, method = "GET", data = null) => {
  const { keyId, keySecret } = getRazorpayCredentials();
  const authHeader = "Basic " + Buffer.from(`${keyId}:${keySecret}`).toString("base64");

  const options = {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
    },
  };

  if (data && ["POST", "PUT", "PATCH"].includes(method)) {
    options.body = JSON.stringify(data);
  }

  const response = await fetch(`https://api.razorpay.com/v1${endpoint}`, options);
  const json = await response.json();

  if (!response.ok) {
    const errorMsg = json.error?.description || json.message || "RazorpayX API request failed";
    throw new Error(`RazorpayX Error: ${errorMsg}`);
  }

  return json;
};

/**
 * Get or Upsert Employee Bank Details
 */
const getEmployeeBankDetails = async (userId) => {
  const res = await pool.query(
    "SELECT * FROM employee_bank_details WHERE user_id = $1 LIMIT 1",
    [String(userId)]
  );
  return res.rows[0] || null;
};

const saveEmployeeBankDetails = async (userId, data) => {
  const {
    account_holder_name,
    account_number,
    ifsc_code,
    bank_name,
    upi_id,
    preferred_mode = "bank_account",
  } = data;

  if (!account_holder_name || !account_holder_name.trim()) {
    throw new Error("Beneficiary / Account holder name is required.");
  }

  const normalizedIfsc = ifsc_code ? ifsc_code.trim().toUpperCase() : null;
  const cleanAccNum = account_number ? account_number.trim() : null;
  const cleanUpi = upi_id ? upi_id.trim().toLowerCase() : null;

  if (preferred_mode === "upi" && !cleanUpi) {
    throw new Error("UPI ID is required when preferred payout mode is UPI.");
  }

  if (preferred_mode === "bank_account" && (!cleanAccNum || !normalizedIfsc)) {
    throw new Error("Account number and IFSC code are required for Bank Account transfers.");
  }

  const res = await pool.query(
    `INSERT INTO employee_bank_details (
      user_id,
      account_holder_name,
      account_number,
      ifsc_code,
      bank_name,
      upi_id,
      preferred_mode,
      is_verified,
      updated_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      account_holder_name = EXCLUDED.account_holder_name,
      account_number = EXCLUDED.account_number,
      ifsc_code = EXCLUDED.ifsc_code,
      bank_name = EXCLUDED.bank_name,
      upi_id = EXCLUDED.upi_id,
      preferred_mode = EXCLUDED.preferred_mode,
      is_verified = true,
      updated_at = NOW()
    RETURNING *`,
    [
      String(userId),
      account_holder_name.trim(),
      cleanAccNum,
      normalizedIfsc,
      bank_name ? bank_name.trim() : "",
      cleanUpi,
      preferred_mode,
    ]
  );

  return res.rows[0];
};

/**
 * Ensures Razorpay Contact and Fund Account exist
 */
const syncRazorpayRecipient = async (bankDetails, employeeInfo) => {
  const { isConfigured } = getRazorpayCredentials();

  if (!isConfigured) {
    return {
      contactId: `cont_sim_${Date.now().toString(36)}`,
      fundAccountId: `fa_sim_${Date.now().toString(36)}`,
      isSimulated: true,
    };
  }

  let contactId = bankDetails.razorpay_contact_id;
  if (!contactId) {
    const contactData = {
      name: bankDetails.account_holder_name || employeeInfo.name || "Employee",
      email: employeeInfo.email || `employee_${bankDetails.user_id}@pms.internal`,
      contact: employeeInfo.phone || "9999999999",
      type: "employee",
      reference_id: `EMP-${bankDetails.user_id}`,
    };
    const contactRes = await razorpayRequest("/contacts", "POST", contactData);
    contactId = contactRes.id;
    await pool.query(
      "UPDATE employee_bank_details SET razorpay_contact_id = $1 WHERE user_id = $2",
      [contactId, String(bankDetails.user_id)]
    );
  }

  let fundAccountId = bankDetails.razorpay_fund_account_id;
  if (!fundAccountId) {
    let fundData = null;
    if (bankDetails.preferred_mode === "upi" && bankDetails.upi_id) {
      fundData = {
        contact_id: contactId,
        account_type: "vpa",
        vpa: { address: bankDetails.upi_id },
      };
    } else {
      fundData = {
        contact_id: contactId,
        account_type: "bank_account",
        bank_account: {
          name: bankDetails.account_holder_name,
          ifsc: bankDetails.ifsc_code,
          account_number: bankDetails.account_number,
        },
      };
    }

    const fundRes = await razorpayRequest("/fund_accounts", "POST", fundData);
    fundAccountId = fundRes.id;
    await pool.query(
      "UPDATE employee_bank_details SET razorpay_fund_account_id = $1 WHERE user_id = $2",
      [fundAccountId, String(bankDetails.user_id)]
    );
  }

  return { contactId, fundAccountId, isSimulated: false };
};

/**
 * Execute Payout for an Approved Expense Claim
 */
const processExpensePayout = async ({
  claim,
  employeeInfo,
  bankDetails,
  payoutMode = "IMPS",
  adminUser,
  customNotes = "",
}) => {
  const { isConfigured, accountNumber } = getRazorpayCredentials();

  const amount = Number(claim.approved_amount || claim.claim_amount);
  if (!amount || isNaN(amount) || amount <= 0) {
    throw new Error("Invalid claim payout amount.");
  }

  // Determine Razorpay transfer mode: IMPS, NEFT, RTGS, or UPI
  let normalizedMode = payoutMode.toUpperCase();
  if (bankDetails.preferred_mode === "upi" || normalizedMode === "UPI TRANSFER") {
    normalizedMode = "UPI";
  } else if (!["IMPS", "NEFT", "RTGS", "UPI"].includes(normalizedMode)) {
    normalizedMode = "IMPS";
  }

  let payoutResponse = null;

  if (isConfigured) {
    // 1. Sync contact and fund account on Razorpay
    const { fundAccountId } = await syncRazorpayRecipient(bankDetails, employeeInfo);

    // 2. Call RazorpayX Payout API
    const payoutPayload = {
      account_number: accountNumber,
      fund_account_id: fundAccountId,
      amount: Math.round(amount * 100), // amount in paise
      currency: "INR",
      mode: normalizedMode,
      purpose: "reimbursement",
      queue_if_low_balance: true,
      reference_id: `${claim.claim_code}-${Date.now().toString().slice(-4)}`,
      narration: `EXP Reimburse ${claim.claim_code}`.slice(0, 30),
      notes: {
        claim_id: claim.id,
        claim_code: claim.claim_code,
        employee_id: String(claim.employee_id),
        admin_id: String(adminUser?.userId || adminUser?.id || ""),
      },
    };

    const rzpResult = await razorpayRequest("/payouts", "POST", payoutPayload);

    payoutResponse = {
      id: rzpResult.id,
      status: rzpResult.status || "processing",
      utr: rzpResult.utr || `RZP-${rzpResult.id.slice(-8)}`,
      mode: normalizedMode,
      amount,
      isSimulated: false,
      message: `Transferred ₹${amount.toLocaleString()} via RazorpayX (${normalizedMode}). Status: ${rzpResult.status}`,
    };
  } else {
    // 3. Fallback to RazorpayX Sandbox Simulation Mode
    const yymmdd = new Date().toISOString().slice(2, 10).replace(/-/g, "");
    const randomDigits = Math.floor(100000 + Math.random() * 900000);
    const mockUtr =
      normalizedMode === "UPI"
        ? `UPI-${Date.now().toString().slice(-8)}`
        : `UTR${yymmdd}${randomDigits}`;
    const mockPayoutId = `pout_${Date.now().toString(36)}${Math.random().toString(36).substring(2, 6)}`;

    payoutResponse = {
      id: mockPayoutId,
      status: "processed",
      utr: mockUtr,
      mode: normalizedMode,
      amount,
      isSimulated: true,
      message: `Transferred ₹${amount.toLocaleString()} via RazorpayX Sandbox (${normalizedMode}). UTR: ${mockUtr}`,
    };
  }

  return payoutResponse;
};

module.exports = {
  getRazorpayCredentials,
  getEmployeeBankDetails,
  saveEmployeeBankDetails,
  processExpensePayout,
};

