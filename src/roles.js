/**
 * Senditto platform roles + default permission matrix (control plane / Database Studio).
 * Defaults are the factory baseline. Live values are loaded from the API and can be
 * edited on the Matrix page (owner + 2FA). Hard locks still apply on save/enforce.
 *
 * Workspace-team roles are separate — see WORKSPACE_* at the bottom.
 */

/** @typedef {'owner'|'admin'|'operator'|'developer'|'support'|'viewer'} PlatformRoleId */

/** Ordered platform roles (highest privilege first). */
export const PLATFORM_ROLES = [
  {
    id: "owner",
    label: "Owner",
    short: "Full control + exclusive role grants",
    description:
      "Platform owner. Full control of the control plane. Only role that can grant roles and edit this matrix — both require 2FA.",
    tone: "purple",
    rank: 100,
  },
  {
    id: "admin",
    label: "Admin",
    short: "Run the platform (no role grants)",
    description:
      "Platform administrator. Manage users (not roles), workspaces, keys, compliance, and ops. Cannot grant roles or edit the matrix.",
    tone: "blue",
    rank: 80,
  },
  {
    id: "operator",
    label: "Operator",
    short: "Day-to-day product operations",
    description:
      "Operational staff. Send/manage messages, domains, suppressions, and routine workspace tasks.",
    tone: "green",
    rank: 60,
  },
  {
    id: "developer",
    label: "Developer",
    short: "API keys, domains, technical access",
    description:
      "Engineering access. Manage API keys and domains, inspect tables and audit data. No user disable or role grants.",
    tone: "cyan",
    rank: 50,
  },
  {
    id: "support",
    label: "Support",
    short: "Help users, limited writes",
    description:
      "Customer support. Read users/workspaces/messages and handle rights requests. Cannot manage keys or grant roles.",
    tone: "amber",
    rank: 40,
  },
  {
    id: "viewer",
    label: "Viewer",
    short: "Read-only across the studio",
    description:
      "Read-only access for audit, compliance review, or shadowing. No create/update/delete on platform data.",
    tone: "slate",
    rank: 10,
  },
];

export const PLATFORM_ROLE_IDS = PLATFORM_ROLES.map((r) => r.id);

/** Roles that may be set when creating a user (without owner 2FA grant flow). */
export const CREATE_SAFE_ROLES = ["operator", "developer", "support", "viewer"];

/** Elevated roles — only via owner Grant role (2FA). */
export const ELEVATED_ROLES = ["owner", "admin"];

/**
 * Permission catalog (rows in the matrix).
 * id is stable — used by API enforcement when saved.
 */
export const PERMISSIONS = [
  // Studio / core
  { id: "studio.access", label: "Access Database Studio", group: "Studio" },
  { id: "overview.read", label: "View overview & health", group: "Studio" },
  { id: "tables.read", label: "Browse tables & schema", group: "Studio" },
  { id: "matrix.read", label: "View role matrix", group: "Studio" },
  { id: "matrix.write", label: "Edit role matrix (owner + 2FA)", group: "Studio" },
  // Users
  { id: "users.read", label: "View users directory", group: "Users" },
  { id: "users.create", label: "Create users", group: "Users" },
  { id: "users.update", label: "Edit users (profile / status)", group: "Users" },
  { id: "users.disable", label: "Disable / reset users", group: "Users" },
  { id: "roles.grant", label: "Grant roles (owner + 2FA only)", group: "Users" },
  // Workspaces
  { id: "workspaces.read", label: "View user workspaces", group: "Workspaces" },
  { id: "workspaces.create", label: "Create workspaces", group: "Workspaces" },
  { id: "workspaces.update", label: "Edit / reassign workspaces", group: "Workspaces" },
  { id: "workspaces.delete", label: "Archive / delete workspaces", group: "Workspaces" },
  // Platform product
  { id: "domains.read", label: "View domains", group: "Sending" },
  { id: "domains.write", label: "Manage domains", group: "Sending" },
  { id: "domains.delete", label: "Delete domains", group: "Sending" },
  { id: "keys.read", label: "View API keys", group: "Sending" },
  { id: "keys.write", label: "Create / revoke API keys", group: "Sending" },
  { id: "messages.read", label: "View messages", group: "Sending" },
  { id: "messages.write", label: "Send / update messages", group: "Sending" },
  { id: "suppressions.read", label: "View suppressions", group: "Compliance" },
  { id: "suppressions.write", label: "Add suppressions", group: "Compliance" },
  { id: "suppressions.delete", label: "Remove suppressions", group: "Compliance" },
  { id: "audit.read", label: "View audit log", group: "Compliance" },
  { id: "rights.read", label: "View rights requests", group: "Compliance" },
  { id: "rights.write", label: "Process rights requests", group: "Compliance" },
  // Ops
  { id: "sessions.read", label: "View sessions", group: "Ops" },
  { id: "sessions.revoke", label: "Revoke sessions", group: "Ops" },
  { id: "server.read", label: "View server health", group: "Ops" },
  { id: "settings.write", label: "Change studio settings", group: "Ops" },
  { id: "2fa.self", label: "Manage own 2FA", group: "Security" },
  { id: "internal.read", label: "Read internal messages", group: "Messaging" },
  { id: "internal.write", label: "Send internal messages", group: "Messaging" },
];

export const PERMISSION_IDS = PERMISSIONS.map((p) => p.id);

/** Permissions that only the owner may ever hold (cells locked for other roles). */
export const OWNER_ONLY_PERMS = ["roles.grant", "matrix.write"];

/** Owner cells that cannot be turned off (safety — never lock yourself out). */
export const OWNER_PROTECTED_PERMS = [
  "studio.access",
  "matrix.read",
  "matrix.write",
  "roles.grant",
  "2fa.self",
  "users.read",
  "overview.read",
];

/** @type {Record<string, boolean>} */
const ALL_TRUE = Object.fromEntries(PERMISSION_IDS.map((id) => [id, true]));

function pick(base, overrides) {
  return { ...base, ...overrides };
}

function fillRole(partial) {
  const out = {};
  for (const id of PERMISSION_IDS) out[id] = partial[id] === true;
  return out;
}

/**
 * Factory default matrix: role → permission id → allowed.
 * Owner has everything. Admin has everything except owner-only perms.
 */
export const DEFAULT_ROLE_MATRIX = {
  owner: { ...ALL_TRUE },
  admin: pick(ALL_TRUE, {
    "roles.grant": false,
    "matrix.write": false,
  }),
  operator: fillRole({
    "studio.access": true,
    "overview.read": true,
    "tables.read": true,
    "matrix.read": true,
    "users.read": true,
    "workspaces.read": true,
    "workspaces.create": true,
    "domains.read": true,
    "domains.write": true,
    "keys.read": true,
    "messages.read": true,
    "messages.write": true,
    "suppressions.read": true,
    "suppressions.write": true,
    "audit.read": true,
    "rights.read": true,
    "sessions.read": true,
    "server.read": true,
    "settings.write": true,
    "2fa.self": true,
    "internal.read": true,
    "internal.write": true,
  }),
  developer: fillRole({
    "studio.access": true,
    "overview.read": true,
    "tables.read": true,
    "matrix.read": true,
    "users.read": true,
    "workspaces.read": true,
    "workspaces.create": true,
    "domains.read": true,
    "domains.write": true,
    "keys.read": true,
    "keys.write": true,
    "messages.read": true,
    "suppressions.read": true,
    "audit.read": true,
    "rights.read": true,
    "sessions.read": true,
    "server.read": true,
    "settings.write": true,
    "2fa.self": true,
    "internal.read": true,
  }),
  support: fillRole({
    "studio.access": true,
    "overview.read": true,
    "matrix.read": true,
    "users.read": true,
    "users.update": true,
    "workspaces.read": true,
    "domains.read": true,
    "messages.read": true,
    "suppressions.read": true,
    "suppressions.write": true,
    "audit.read": true,
    "rights.read": true,
    "rights.write": true,
    "sessions.read": true,
    "server.read": true,
    "settings.write": true,
    "2fa.self": true,
    "internal.read": true,
  }),
  viewer: fillRole({
    "studio.access": true,
    "overview.read": true,
    "tables.read": true,
    "matrix.read": true,
    "users.read": true,
    "workspaces.read": true,
    "domains.read": true,
    "keys.read": true,
    "messages.read": true,
    "suppressions.read": true,
    "audit.read": true,
    "rights.read": true,
    "sessions.read": true,
    "server.read": true,
    "settings.write": true,
    "2fa.self": true,
    "internal.read": true,
  }),
};

/** @deprecated use DEFAULT_ROLE_MATRIX — kept for older imports */
export const ROLE_MATRIX = DEFAULT_ROLE_MATRIX;

export function cloneMatrix(matrix = DEFAULT_ROLE_MATRIX) {
  const out = {};
  for (const role of PLATFORM_ROLE_IDS) {
    out[role] = {};
    for (const pid of PERMISSION_IDS) {
      out[role][pid] = !!(matrix?.[role]?.[pid] ?? DEFAULT_ROLE_MATRIX[role]?.[pid]);
    }
  }
  return out;
}

/**
 * Apply hard security locks to a matrix (mutates clone, returns it).
 * - roles.grant / matrix.write: only owner
 * - owner protected perms: always true
 */
export function applyHardLocks(matrix) {
  const m = cloneMatrix(matrix);
  for (const role of PLATFORM_ROLE_IDS) {
    for (const pid of OWNER_ONLY_PERMS) {
      m[role][pid] = role === "owner";
    }
  }
  for (const pid of OWNER_PROTECTED_PERMS) {
    m.owner[pid] = true;
  }
  return m;
}

/** Why a cell cannot be toggled (or null if editable). */
export function cellLockReason(roleId, permId) {
  const role = String(roleId || "").toLowerCase();
  const perm = String(permId || "");
  if (OWNER_ONLY_PERMS.includes(perm) && role !== "owner") {
    return "Only the platform owner may hold this permission";
  }
  if (role === "owner" && OWNER_PROTECTED_PERMS.includes(perm)) {
    return "Owner safety lock — cannot remove this permission from owner";
  }
  return null;
}

export function isCellLocked(roleId, permId) {
  return !!cellLockReason(roleId, permId);
}

export function setMatrixCell(matrix, roleId, permId, allowed) {
  const m = cloneMatrix(matrix);
  const role = String(roleId || "").toLowerCase();
  const perm = String(permId || "");
  if (!PLATFORM_ROLE_IDS.includes(role) || !PERMISSION_IDS.includes(perm)) return m;
  if (isCellLocked(role, perm)) return m;
  m[role][perm] = !!allowed;
  return applyHardLocks(m);
}

export function setMatrixColumn(matrix, roleId, allowed, { onlyPermIds = null } = {}) {
  const m = cloneMatrix(matrix);
  const role = String(roleId || "").toLowerCase();
  if (!PLATFORM_ROLE_IDS.includes(role)) return m;
  for (const pid of PERMISSION_IDS) {
    if (onlyPermIds && !onlyPermIds.includes(pid)) continue;
    if (isCellLocked(role, pid)) continue;
    m[role][pid] = !!allowed;
  }
  return applyHardLocks(m);
}

export function copyMatrixRole(matrix, fromRole, toRole) {
  const m = cloneMatrix(matrix);
  const from = String(fromRole || "").toLowerCase();
  const to = String(toRole || "").toLowerCase();
  if (!PLATFORM_ROLE_IDS.includes(from) || !PLATFORM_ROLE_IDS.includes(to) || from === to) return m;
  for (const pid of PERMISSION_IDS) {
    if (isCellLocked(to, pid)) continue;
    m[to][pid] = !!m[from][pid];
  }
  return applyHardLocks(m);
}

export function matrixDiffCount(a, b) {
  let n = 0;
  for (const role of PLATFORM_ROLE_IDS) {
    for (const pid of PERMISSION_IDS) {
      if (!!a?.[role]?.[pid] !== !!b?.[role]?.[pid]) n += 1;
    }
  }
  return n;
}

export function matrixDiffList(a, b) {
  const changes = [];
  for (const role of PLATFORM_ROLE_IDS) {
    for (const pid of PERMISSION_IDS) {
      const before = !!a?.[role]?.[pid];
      const after = !!b?.[role]?.[pid];
      if (before !== after) {
        changes.push({ role, perm: pid, from: before, to: after });
      }
    }
  }
  return changes;
}

export function countRoleAllows(matrix, roleId) {
  const role = String(roleId || "").toLowerCase();
  return PERMISSION_IDS.filter((pid) => !!matrix?.[role]?.[pid]).length;
}

export function rolesForPermission(permId, matrix = DEFAULT_ROLE_MATRIX) {
  return PLATFORM_ROLE_IDS.filter((role) => matrix?.[role]?.[permId] === true);
}

export function roleMeta(roleId) {
  const id = String(roleId || "").toLowerCase();
  return PLATFORM_ROLES.find((r) => r.id === id) || null;
}

export function roleLabel(roleId) {
  return roleMeta(roleId)?.label || String(roleId || "—");
}

export function roleTone(roleId) {
  return roleMeta(roleId)?.tone || "slate";
}

/** Capability check against a matrix (defaults to factory defaults). */
export function can(roleId, permId, matrix = DEFAULT_ROLE_MATRIX) {
  const id = String(roleId || "").toLowerCase();
  const perm = String(permId || "");
  if (OWNER_ONLY_PERMS.includes(perm)) return id === "owner";
  if (id === "owner" && OWNER_PROTECTED_PERMS.includes(perm)) return true;
  return matrix?.[id]?.[perm] === true;
}

export function isPlatformRole(roleId) {
  return PLATFORM_ROLE_IDS.includes(String(roleId || "").toLowerCase());
}

export function isElevatedRole(roleId) {
  return ELEVATED_ROLES.includes(String(roleId || "").toLowerCase());
}

export function roleSelectOptions({ includeAll = false, safeOnly = false } = {}) {
  const list = safeOnly
    ? PLATFORM_ROLES.filter((r) => CREATE_SAFE_ROLES.includes(r.id))
    : PLATFORM_ROLES;
  const opts = list.map((r) => ({ value: r.id, label: r.label }));
  if (includeAll) return [{ value: "all", label: "All roles" }, ...opts];
  return opts;
}

/**
 * Workspace-scoped team roles (inside a user's workspace — not platform roles).
 */
export const WORKSPACE_ROLES = [
  {
    id: "ws_owner",
    label: "Workspace owner",
    description: "The user who owns the workspace (account holder).",
  },
  {
    id: "ws_admin",
    label: "Admin",
    description: "Manage members, keys, and workspace settings.",
  },
  {
    id: "ws_developer",
    label: "Developer",
    description: "API keys, transactional send, technical config.",
  },
  {
    id: "ws_marketer",
    label: "Marketer",
    description: "Campaigns, audiences, analytics — no keys or members.",
  },
  {
    id: "ws_viewer",
    label: "Viewer",
    description: "Read analytics and content — no write access.",
  },
];

export const WORKSPACE_PERMISSIONS = [
  { id: "ws.members", label: "Manage members" },
  { id: "ws.keys", label: "Manage API keys" },
  { id: "ws.send", label: "Send transactional email" },
  { id: "ws.campaigns", label: "Build campaigns" },
  { id: "ws.analytics", label: "View analytics" },
];

export const DEFAULT_WORKSPACE_MATRIX = {
  ws_admin: {
    "ws.members": true,
    "ws.keys": true,
    "ws.send": true,
    "ws.campaigns": true,
    "ws.analytics": true,
  },
  ws_developer: {
    "ws.members": false,
    "ws.keys": true,
    "ws.send": true,
    "ws.campaigns": false,
    "ws.analytics": true,
  },
  ws_marketer: {
    "ws.members": false,
    "ws.keys": false,
    "ws.send": false,
    "ws.campaigns": true,
    "ws.analytics": true,
  },
  ws_viewer: {
    "ws.members": false,
    "ws.keys": false,
    "ws.send": false,
    "ws.campaigns": false,
    "ws.analytics": true,
  },
};

/** @deprecated */
export const WORKSPACE_MATRIX = DEFAULT_WORKSPACE_MATRIX;

export function cloneWorkspaceMatrix(matrix = DEFAULT_WORKSPACE_MATRIX) {
  const roles = WORKSPACE_ROLES.filter((r) => r.id !== "ws_owner").map((r) => r.id);
  const out = {};
  for (const role of roles) {
    out[role] = {};
    for (const p of WORKSPACE_PERMISSIONS) {
      out[role][p.id] = !!(matrix?.[role]?.[p.id] ?? DEFAULT_WORKSPACE_MATRIX[role]?.[p.id]);
    }
  }
  return out;
}
