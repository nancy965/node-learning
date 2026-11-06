const PATHS = {
  BASE_PREFIX: "",

  AUTH: {
    BASE: "/auth",
    REGISTER: "/register",
    LOGIN: "/login",
    GET_CURRENT_USER: "/me",
    PROTECTED_TEST: "/protected",
    CHANGE_PASSWORD: "/change-password",
  },

  USERS: {
    BASE: "/users",
    GET_ALL_USERS: "/get-all",
    GET_USER_BY_ID: "/get/:id",
    CREATE_USER: "/create",
    BULK_IMPORT_USERS: "/bulk-create",
    UPDATE_USER: "/update/:id",
    DELETE_USER: "/delete/:id",
    GET_ALL_ADMINS: "/admins/get-all",
    GET_ADMIN_BY_ID: "/admins/get/:id",
    UPDATE_ADMIN: "/admins/update/:id",
    DELETE_ADMIN: "/admins/delete/:id",
  },

  ADMINS: {
    BASE: "/admins",
    GET_ALL_ADMINS: "/get-all",
    GET_ADMIN_BY_ID: "/get/:id",
    UPDATE_ADMIN: "/update/:id",
    DELETE_ADMIN: "/delete/:id",
  },

  TASKS: {
    BASE: "/tasks",
    GET_ALL_TASKS: "/get-all",
    GET_TASK_BY_ID: "/get/:id",
    CREATE_TASK: "/create",
    UPDATE_TASK: "/update/:id",
    DELETE_TASK: "/delete/:id",
    START_TASK: "/start/:id",
    END_TASK: "/end/:id",
    GET_TASK_EMPLOYEES: "/employees",
    GET_EMPLOYEE_TASKS: "/my-tasks",
    GET_TASK_LOGS: "/get/:id/logs",
  },

  NAVIGATION: {
    BASE: "/navigation",
    GET_ALL: "/get-all",
  },

  ACTIVITY_LOGS: {
    BASE: "/activity-logs",
    GET_ALL: "/get-all",
  },

  NOTIFICATIONS: {
    BASE: "/notifications",
    ADMIN: "/admin",
    ADMIN_BY_ID: "/admin/:id",
    EMPLOYEE: "/employee",
    EMPLOYEE_BY_ID: "/employee/:id",
    MARK_ALL_ADMIN_READ: "/admin/mark-all-read",
    MARK_ALL_EMPLOYEE_READ: "/employee/mark-all-read",
    MANAGEMENT: "/management",
    MANAGEMENT_BY_ID: "/management/:id",
    MANAGEMENT_RECIPIENTS: "/management/recipients",
    MANAGEMENT_SEND: "/management/:id/send",
  },

  COUNTRIES: {
    BASE: "/countries",
    GET_ALL_COUNTRIES: "/get-all",
    GET_ACTIVE_COUNTRIES: "/active",
    GET_COUNTRY_BY_ID: "/get/:id",
    CREATE_COUNTRY: "/create",
    UPDATE_COUNTRY: "/update/:id",
    DELETE_COUNTRY: "/delete/:id",
    ACTIVATE_COUNTRY: "/activate/:id",
  },

  STATES: {
    BASE: "/states",
    GET_ALL_STATES: "/get-all",
    GET_STATES_BY_COUNTRY: "/by-country/:countryId",
    LOOKUP_STATE: "/lookup/:state",
    GET_STATE_BY_ID: "/get/:id",
    CREATE_STATE: "/create",
    UPDATE_STATE: "/update/:id",
    DELETE_STATE: "/delete/:id",
    ACTIVATE_STATE: "/activate/:id",
  },

  CITIES: {
    BASE: "/cities",
    GET_ALL_CITIES: "/get-all",
    GET_CITIES_BY_STATE: "/by-state/:stateId",
    GET_CITIES_BY_COUNTRY: "/by-country/:countryId",
    LOOKUP_CITY: "/lookup/:city",
    GET_CITY_BY_ID: "/get/:id",
    CREATE_CITY: "/create",
    UPDATE_CITY: "/update/:id",
    DELETE_CITY: "/delete/:id",
    ACTIVATE_CITY: "/activate/:id",
  },

  PINCODES: {
    BASE: "/pincodes",
    GET_ALL_PINCODES: "/get-all",
    GET_PINCODES_BY_CITY: "/by-city/:cityId",
    GET_PINCODES_BY_STATE: "/by-state/:stateId",
    GET_PINCODES_BY_COUNTRY: "/by-country/:countryId",
    LOOKUP_PINCODE: "/lookup/:pincode",
    GET_PINCODE_BY_ID: "/get/:id",
    CREATE_PINCODE: "/create",
    UPDATE_PINCODE: "/update/:id",
    DELETE_PINCODE: "/delete/:id",
    ACTIVATE_PINCODE: "/activate/:id",
  },

  CHAT: {
    BASE: "/chat",
    CONVERSATIONS: "/conversations",
    CONVERSATION_MESSAGES: "/conversations/:id/messages",
    MARK_CONVERSATION_READ: "/conversations/:id/read",
    GET_CHAT_EMPLOYEES: "/employees",
    MESSAGE_BY_ID: "/messages/:id",
    REACT_MESSAGE: "/messages/:id/react",
  },

  ANALYTICS: {
    BASE: "/analytics",
    OVERVIEW: "/overview",
    OVERDUE_TASKS: "/overdue-tasks",
    TASK_EXPLORER: "/task-explorer",
    EXPORT: "/export",
  },

  DASHBOARD: {
  BASE: "/dashboard",
  STATS: "/stats",
  USERS: "/users",
  EXPORT_USERS: "/users/export",
  RECENT_ACTIVITY: "/recent-activity",
  NEEDS_ATTENTION: "/needs-attention",
  SYSTEM_HEALTH: "/system-health",
  PERMISSION_COVERAGE: "/permission-coverage",
  OVERVIEW: "/overview",
  SMART_INSIGHTS: "/smart-insights",
},

  AD_PLATFORMS: {
    BASE: "/ad-platforms",
    GET_ALL_PLATFORMS: "/get-all",
    GET_PLATFORM_BY_ID: "/get/:id",
    CREATE_PLATFORM: "/create",
    UPDATE_PLATFORM: "/update/:id",
    DELETE_PLATFORM: "/delete/:id",
  },

  AD_CAMPAIGNS: {
    BASE: "/ad-campaigns",
    GET_ALL_CAMPAIGNS: "/get-all",
    GET_CAMPAIGN_BY_ID: "/get/:id",
    CREATE_CAMPAIGN: "/create",
  },

  USER_PERMISSIONS: {
    BASE: "/user-permissions",
    MY_PERMISSIONS: "/my-permissions",
    GET_BY_USER_ID: "/:userId",
    UPDATE_BY_USER_ID: "/update/:userId",
  },

  ROLE_PERMISSIONS: {
    BASE: "/role-permissions",
    MENUS: "/menus",
    SUBMENU_PERMISSIONS: "/submenu-permissions",
    ROLES: "/roles",
    ROLES_BY_ACCESS: "/roles-by-access",
    GET_ROLE_PERMISSIONS: "/roles/:roleId/permissions",
    UPDATE_ROLE_PERMISSIONS: "/roles/:roleId/permissions",

    GET_ROLE: "/roles/:roleId",
    UPDATE_ROLE: "/roles/:roleId",
    DELETE_ROLE: "/roles/:roleId",
    SIMULATOR_META: "/simulator/meta",
    SIMULATOR_SIMULATE: "/simulator/simulate",
  },

  PROFILE: {
    BASE: "/profile",
    GET_PROFILE: "/",
    UPDATE_PROFILE: "/",
    CHANGE_PASSWORD: "/change-password",
  },

  COMMON_MASTER: {
    BASE: "/common-master",
    GET_ALL: "/get-all",
    GET_BY_TYPE: "/by-type/:type",
    CREATE: "/create",
    UPDATE: "/update/:id",
    DELETE: "/delete/:id",
    TOGGLE_STATUS: "/toggle/:id",
  },

  TICKETS: {
    BASE: "/tickets",
    GET_ALL: "/get-all",
    GET_MY: "/my-tickets",
    GET_BY_ID: "/get/:id",
    CREATE: "/create",
    UPDATE_STATUS: "/update-status/:id",
    ASSIGN: "/assign/:id",
    GET_AGENTS: "/agents",
    STATS: "/stats",
  },

  APPROVALS: {
    BASE: "/approvals",
    CREATE: "/create",
    GET_MY: "/my-requests",
    INBOX: "/inbox",
    GET_BY_ID: "/get/:id",
    DECIDE: "/decide/:id",
    CANCEL: "/cancel/:id",
    STATS: "/stats",
    RULES: "/rules",
  },

  LIFECYCLE: {
    BASE: "/lifecycle",
  },

  SEARCH: {
    BASE: "/search",
    GLOBAL: "/global",
  },

  DATABASE_APPROVALS: {
    BASE: "/database-approvals",
    ALL: "/all",
    GET_BY_ID: "/get/:id",
    CREATE: "/create",
    APPROVE: "/approve/:id",
    REJECT: "/reject/:id",
    ROLLBACK: "/rollback/:id",
    STATS: "/stats",
  },

  EMAILS: {
    BASE: "/emails",
  },

  EXPENSES: {
    BASE: "/expenses",
  },

  LEAVES: {
    BASE: "/leaves",
  },
};

module.exports = PATHS;
