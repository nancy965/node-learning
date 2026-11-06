const pool = require("../config/databse");

async function initEmailCenterSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    console.log("=== Initializing Email Center (Webmail Suite) Schema ===");

    // 1. Mail Messages Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS mail_messages (
        id SERIAL PRIMARY KEY,
        sender_id UUID,
        sender_email VARCHAR(255) NOT NULL,
        sender_name VARCHAR(255),
        subject VARCHAR(500) NOT NULL DEFAULT '',
        body_html TEXT DEFAULT '',
        body_text TEXT DEFAULT '',
        is_draft BOOLEAN DEFAULT FALSE,
        is_starred BOOLEAN DEFAULT FALSE,
        is_sent BOOLEAN DEFAULT TRUE,
        is_trashed BOOLEAN DEFAULT FALSE,
        is_archived BOOLEAN DEFAULT FALSE,
        delivery_status VARCHAR(50) DEFAULT 'sent',
        smtp_message_id VARCHAR(255),
        smtp_preview_url TEXT,
        error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Ensure legacy users(id) foreign key is dropped if table pre-existed
    await client.query(`
      ALTER TABLE mail_messages DROP CONSTRAINT IF EXISTS mail_messages_sender_id_fkey;
      ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
      ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS is_scheduled BOOLEAN DEFAULT FALSE;
      ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
      ALTER TABLE mail_messages ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_mail_messages_scheduled ON mail_messages(is_scheduled, scheduled_at);
      CREATE INDEX IF NOT EXISTS idx_mail_messages_snoozed ON mail_messages(snoozed_until);
    `);

    // 2. Mail Recipients Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS mail_recipients (
        id SERIAL PRIMARY KEY,
        message_id INT REFERENCES mail_messages(id) ON DELETE CASCADE,
        recipient_email VARCHAR(255) NOT NULL,
        recipient_name VARCHAR(255),
        recipient_user_id UUID,
        recipient_type VARCHAR(10) NOT NULL DEFAULT 'to',
        is_read BOOLEAN DEFAULT FALSE,
        is_starred BOOLEAN DEFAULT FALSE,
        is_trashed BOOLEAN DEFAULT FALSE,
        is_archived BOOLEAN DEFAULT FALSE,
        read_at TIMESTAMPTZ
      );
    `);

    await client.query(`
      ALTER TABLE mail_recipients DROP CONSTRAINT IF EXISTS mail_recipients_recipient_user_id_fkey;
      ALTER TABLE mail_recipients ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
      ALTER TABLE mail_recipients ADD COLUMN IF NOT EXISTS snoozed_until TIMESTAMPTZ;
      CREATE INDEX IF NOT EXISTS idx_mail_recipients_snoozed ON mail_recipients(snoozed_until);
    `);

    // 3. Mail Attachments Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS mail_attachments (
        id SERIAL PRIMARY KEY,
        message_id INT REFERENCES mail_messages(id) ON DELETE CASCADE,
        file_name VARCHAR(255) NOT NULL,
        original_name VARCHAR(255) NOT NULL,
        file_path VARCHAR(500) NOT NULL,
        file_size INT DEFAULT 0,
        mime_type VARCHAR(100),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 4. Mail Templates Table
    await client.query(`
      CREATE TABLE IF NOT EXISTS mail_templates (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(500) NOT NULL,
        body_html TEXT NOT NULL,
        category VARCHAR(100) DEFAULT 'general',
        created_by UUID,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    await client.query(`
      ALTER TABLE mail_templates DROP CONSTRAINT IF EXISTS mail_templates_created_by_fkey;
    `);

    // 5. Indexes for fast folder querying & search
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_mail_messages_sender ON mail_messages(sender_id);
      CREATE INDEX IF NOT EXISTS idx_mail_messages_is_draft ON mail_messages(is_draft);
      CREATE INDEX IF NOT EXISTS idx_mail_messages_is_trashed ON mail_messages(is_trashed);
      CREATE INDEX IF NOT EXISTS idx_mail_messages_created_at ON mail_messages(created_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_mail_recipients_message ON mail_recipients(message_id);
      CREATE INDEX IF NOT EXISTS idx_mail_recipients_user ON mail_recipients(recipient_user_id);
      CREATE INDEX IF NOT EXISTS idx_mail_recipients_email ON mail_recipients(recipient_email);
      CREATE INDEX IF NOT EXISTS idx_mail_recipients_is_read ON mail_recipients(is_read);
      CREATE INDEX IF NOT EXISTS idx_mail_recipients_is_trashed ON mail_recipients(is_trashed);

      CREATE INDEX IF NOT EXISTS idx_mail_attachments_message ON mail_attachments(message_id);
    `);

    // 6. Seed default templates if empty
    const templatesCountRes = await client.query(`SELECT COUNT(*) FROM mail_templates;`);
    if (parseInt(templatesCountRes.rows[0].count, 10) === 0) {
      await client.query(`
        INSERT INTO mail_templates (title, subject, body_html, category)
        VALUES
          (
            'Welcome to the Team',
            'Welcome to our Organization! Getting Started with your Journey',
            '<p>Hi there,</p><p>We are absolutely thrilled to welcome you to the team! 🎉</p><p>Please find attached our employee handbook and initial orientation schedule. If you have any questions, feel free to reply directly to this email or reach out via our internal chat.</p><p>Best regards,<br/><strong>Human Resources & Operations Team</strong></p>',
            'Onboarding'
          ),
          (
            'Task & Project Briefing',
            'Important: Project Brief and Deliverables Instructions',
            '<p>Hello,</p><p>Please find the briefing and deliverables schedule for the assigned project tasks. Review the specifications carefully and ensure progress is updated in the Task Portal.</p><p>Let us know if you need any resources or approvals.</p><p>Regards,<br/><strong>Project Management Office</strong></p>',
            'Tasks'
          ),
          (
            'Document Submission Request',
            'Request for Official Documentation and Verification',
            '<p>Dear Colleague,</p><p>This is a formal request to submit the required identification and verification documents at your earliest convenience.</p><p>You can reply to this email with the requested files securely attached.</p><p>Thank you for your prompt cooperation.<br/><strong>Compliance & Admin Team</strong></p>',
            'Admin'
          ),
          (
            'Meeting Invitation & Agenda',
            'Invitation: Team Strategy & Operations Review Meeting',
            '<p>Dear Team,</p><p>You are invited to attend our upcoming review meeting. Please find the proposed agenda attached.</p><p>Please review the discussion points prior to the call.</p><p>Warm regards,<br/><strong>Management Team</strong></p>',
            'General'
          );
      `);
      console.log("Seeded default email templates.");
    }

    await client.query("COMMIT");
    console.log("=== Email Center Schema Initialized Successfully ===");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error initializing email center schema:", error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  initEmailCenterSchema()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}

module.exports = initEmailCenterSchema;
