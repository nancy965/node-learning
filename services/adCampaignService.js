const pool = require("../config/databse");
const { createAdActivityLog } = require("./adActivityLogService");
const { createAdminNotification } = require("./notificationService");

const getAdCampaigns = async () => {
  const result = await pool.query(`
    SELECT
      ac.id,
      ac.name,
      ac.description,
      ac.objective,
      ac.platform_id,
      ap.name AS platform_name,
      ap.code AS platform_code,
      ac.start_date,
      ac.end_date,
      ac.status,
      ac.is_active,
      ac.created_by,
      u.name AS created_by_name,
      ac.created_at,
      ac.updated_at
    FROM ad_campaigns ac
    LEFT JOIN ad_platforms ap ON ap.id = ac.platform_id
    LEFT JOIN users u ON u.id = ac.created_by
    ORDER BY ac.id DESC
  `);

  return result.rows;
};

const getAdCampaignById = async (id) => {
  const result = await pool.query(
    `
      SELECT
        ac.id,
        ac.name,
        ac.description,
        ac.objective,
        ac.platform_id,
        ap.name AS platform_name,
        ap.code AS platform_code,
        ac.start_date,
        ac.end_date,
        ac.status,
        ac.is_active,
        ac.created_by,
        u.name AS created_by_name,
        ac.created_at,
        ac.updated_at
      FROM ad_campaigns ac
      LEFT JOIN ad_platforms ap ON ap.id = ac.platform_id
      LEFT JOIN users u ON u.id = ac.created_by
      WHERE ac.id = $1
    `,
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return result.rows[0];
};

const addAdCampaign = async (data, userId) => {
  const {
    name,
    description,
    objective,
    platform_id,
    start_date,
    end_date,
  } = data;

  const platformResult = await pool.query(
    `
      SELECT id, name, is_active
      FROM ad_platforms
      WHERE id = $1
    `,
    [platform_id]
  );

  if (platformResult.rows.length === 0) {
    return {
      success: false,
      status: 404,
      message: "Ad platform not found",
    };
  }

  if (!platformResult.rows[0].is_active) {
    return {
      success: false,
      status: 400,
      message: "Selected ad platform is inactive",
    };
  }

  const result = await pool.query(
    `
      INSERT INTO ad_campaigns
      (
        name,
        description,
        objective,
        platform_id,
        start_date,
        end_date,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *
    `,
    [
      name,
      description || null,
      objective,
      platform_id,
      start_date,
      end_date || null,
      userId,
    ]
  );

  const campaign = result.rows[0];

  await createAdActivityLog({
    performedBy: userId,
    action: "CAMPAIGN_CREATED",
    entityType: "campaign",
    entityId: campaign.id,
    details: {
      name: campaign.name,
      objective: campaign.objective,
      platform_id: campaign.platform_id,
    },
  });

  await createAdminNotification(
  userId,
  "Ad Campaign Created",
  `${campaign.name} ad campaign has been created.`,
  "campaign_created",
);

  return {
    success: true,
    status: 201,
    message: "Ad campaign created successfully",
    data: campaign,
  };
};

module.exports = {
  getAdCampaigns,
  getAdCampaignById,
  addAdCampaign,
};