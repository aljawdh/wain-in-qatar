'use strict';

const crypto = require('crypto');
const { readJsonFile, writeJsonFile, nowIso, createId } = require('./data-store');
const { cleanString } = require('./security');

const ROLE_ORDER = {
  viewer: 0,
  member: 1,
  admin: 2,
  super_admin: 3
};

function getJwtSecret() {
  const secret = process.env.NAVIDUR_JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') throw new Error('NAVIDUR_JWT_SECRET is not set — cannot run in production without it');
    return 'navidur-dev-secret';
  }
  return secret;
}

function getAuthSalt() {
  const salt = process.env.NAVIDUR_AUTH_SALT;
  if (!salt) {
    if (process.env.NODE_ENV === 'production') throw new Error('NAVIDUR_AUTH_SALT is not set — cannot run in production without it');
    return 'navidur-static-salt';
  }
  return salt;
}

// Field accounts: disabled by default. Enable with NAVIDUR_ALLOW_FIELD_ACCOUNTS=true
// and supply NAVIDUR_FIELD_ACCOUNTS_JSON (array of { id, username, password, role }).
// Passwords must not appear in source code — env only.

var _fieldAccountsCache = null;
var _fieldAccountsCacheKey = null;

function isFieldAccountsEnabled() {
  return process.env.NAVIDUR_ALLOW_FIELD_ACCOUNTS === 'true';
}

function normalizeFieldRole(role) {
  const safe = cleanString(role, 30);
  if (safe === 'super_admin' || safe === 'admin' || safe === 'member' || safe === 'viewer') return safe;
  return 'member';
}

function loadFieldAccountsFromEnv() {
  if (!isFieldAccountsEnabled()) return [];
  const raw = String(process.env.NAVIDUR_FIELD_ACCOUNTS_JSON || '').trim();
  if (!raw) return [];
  const cacheKey = raw.length + ':' + raw.slice(0, 32);
  if (_fieldAccountsCache && _fieldAccountsCacheKey === cacheKey) {
    return _fieldAccountsCache;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_err) {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out = [];
  for (let i = 0; i < parsed.length && out.length < 50; i += 1) {
    const row = parsed[i];
    if (!row || typeof row !== 'object') continue;
    const id = cleanString(row.id, 80);
    const username = cleanString(row.username, 60);
    const password = cleanString(row.password, 200);
    const role = normalizeFieldRole(row.role);
    if (!id || !username || !password) continue;
    out.push({ id, username, password, role });
  }
  _fieldAccountsCache = out;
  _fieldAccountsCacheKey = cacheKey;
  return out;
}

function getFieldAccounts() {
  return loadFieldAccountsFromEnv();
}

function stripHiddenWhitespace(value) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f-\u009f\u00a0\u1680\u180e\u2000-\u200f\u2028\u2029\u202f\u205f\u2060\u3000\ufeff]/g, '');
}

function normalizeLoginIdentifier(value) {
  return cleanString(stripHiddenWhitespace(value), 60).toLowerCase();
}

function normalizeLoginPassword(value) {
  return cleanString(stripHiddenWhitespace(value), 200);
}

function getFieldAccountByUsername(username) {
  if (!isFieldAccountsEnabled()) return null;
  const safe = normalizeLoginIdentifier(username);
  return getFieldAccounts().find((a) => a.username.toLowerCase() === safe) || null;
}

function getFieldAccountById(userId) {
  if (!isFieldAccountsEnabled()) return null;
  const safe = cleanString(userId, 80);
  return getFieldAccounts().find((a) => a.id === safe) || null;
}

function normalizePermissions(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map((x) => cleanString(x, 60).toLowerCase())
    .filter(Boolean)
    .slice(0, 50);
}

function canUserAddStations(user) {
  if (!user) return false;
  if (user.can_add_stations === true) return true;
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'super_admin') return true;
  const perms = normalizePermissions(user.permissions);
  return perms.includes('station_add') || perms.includes('add_station') || perms.includes('manage_stations');
}

function hashPassword(password) {
  const salt = getAuthSalt();
  return crypto.createHash('sha256').update(String(password || '') + '|' + salt).digest('hex');
}

function signPayload(payload) {
  const secret = getJwtSecret();
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const secret = getJwtSecret();
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (_err) {
    return null;
  }
}

function getTokenFromReq(req) {
  const auth = String(req.headers.authorization || '');
  if (auth.startsWith('Bearer ')) return auth.slice(7).trim();
  const cookie = String(req.headers.cookie || '');
  const m = cookie.match(/(?:^|; )navidur_token=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

async function getAuthUser(req) {
  const token = getTokenFromReq(req);
  const payload = verifyToken(token);
  if (!payload || !payload.user_id) return null;
  const users = await readJsonFile('users', []);
  const user = users.find((u) => u.id === payload.user_id);
  if (!user || user.active_status === false) {
    const fieldUser = getFieldAccountById(payload.user_id);
    if (!fieldUser || fieldUser.role !== payload.role || fieldUser.username !== payload.username) return null;
    return {
      id: fieldUser.id,
      username: fieldUser.username,
      role: fieldUser.role,
      assigned_stations: [],
      can_add_stations: canUserAddStations(fieldUser),
      permissions: []
    };
  }
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    assigned_stations: Array.isArray(user.assigned_stations) ? user.assigned_stations : [],
    can_add_stations: canUserAddStations(user),
    permissions: normalizePermissions(user.permissions)
  };
}

function hasRole(user, minRole) {
  if (!user || !ROLE_ORDER[user.role]) return false;
  return ROLE_ORDER[user.role] >= (ROLE_ORDER[minRole] || 0);
}

function requireRole(minRole) {
  return async function (req, res) {
    const user = await getAuthUser(req);
    if (!user || !hasRole(user, minRole)) {
      res.status(401).json({ error: 'unauthorized' });
      return null;
    }
    return user;
  };
}

function isSecureRequest(req) {
  const forwardedProto = String(req && req.headers && req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  const forwardedSsl = String(req && req.headers && req.headers['x-forwarded-ssl'] || '').trim().toLowerCase();
  return forwardedProto === 'https' || forwardedSsl === 'on' || process.env.NODE_ENV === 'production';
}

function buildAuthCookie(token, maxAge, req) {
  const attrs = [
    'navidur_token=' + encodeURIComponent(token || ''),
    'Path=/',
    'HttpOnly',
    'Max-Age=' + String(maxAge)
  ];

  if (isSecureRequest(req)) {
    attrs.push('SameSite=None', 'Secure');
  } else {
    // Keep local non-HTTPS environments working while Safari production traffic gets a cross-site safe cookie.
    attrs.push('SameSite=Lax');
  }

  return attrs.join('; ');
}

function setAuthCookie(res, token, req) {
  res.setHeader('Set-Cookie', buildAuthCookie(token, 43200, req));
}

function clearAuthCookie(res, req) {
  res.setHeader('Set-Cookie', buildAuthCookie('', 0, req));
}

async function login(username, password) {
  const safeUsername = normalizeLoginIdentifier(username);
  const safePassword = normalizeLoginPassword(password);
  const passHash = hashPassword(safePassword);

  // Fixed accounts are checked FIRST — they always work regardless of DB state.
  const field = getFieldAccountByUsername(safeUsername);
  if (field) {
    if (passHash !== hashPassword(field.password)) return null;
    const token = signPayload({
      user_id: field.id,
      role: field.role,
      username: field.username,
      exp: Date.now() + (12 * 60 * 60 * 1000)
    });
    return {
      token,
      user: {
        id: field.id,
        username: field.username,
        role: field.role,
        assigned_stations: [],
        can_add_stations: canUserAddStations(field),
        permissions: []
      }
    };
  }

  // Regular DB users
  const users = await readJsonFile('users', []);
  const user = users.find((u) => String(u.username || '').toLowerCase() === safeUsername.toLowerCase());
  if (!user || user.active_status === false) return null;
  if (passHash !== user.hashed_password) return null;

  user.last_login = nowIso();
  await writeJsonFile('users', users);

  const token = signPayload({
    user_id: user.id,
    role: user.role,
    username: user.username,
    exp: Date.now() + (12 * 60 * 60 * 1000)
  });

  return {
    token,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      assigned_stations: Array.isArray(user.assigned_stations) ? user.assigned_stations : [],
      can_add_stations: canUserAddStations(user),
      permissions: normalizePermissions(user.permissions)
    }
  };
}

function normalizeRole(role) {
  const safe = cleanString(role, 30);
  if (safe === 'super_admin' || safe === 'admin' || safe === 'member' || safe === 'viewer') return safe;
  return 'member';
}

async function createUser(input, actor) {
  const users = await readJsonFile('users', []);
  const username = cleanString(input.username, 60);
  const password = cleanString(input.password, 200);
  const role = normalizeRole(input.role);

  if (!username || !password) throw new Error('username_password_required');
  if (users.some((u) => String(u.username || '').toLowerCase() === username.toLowerCase())) {
    throw new Error('username_already_exists');
  }

  if (role === 'super_admin' && (!actor || actor.role !== 'super_admin')) {
    throw new Error('only_super_admin_can_create_super_admin');
  }

  const user = {
    id: createId('usr'),
    username,
    hashed_password: hashPassword(password),
    role,
    active_status: input.active_status !== false,
    assigned_stations: Array.isArray(input.assigned_stations) ? input.assigned_stations.slice(0, 300) : [],
    permissions: normalizePermissions(input.permissions),
    can_add_stations: !!input.can_add_stations,
    created_at: nowIso(),
    last_login: null,
    trust_score: null
  };

  users.push(user);
  await writeJsonFile('users', users);
  return user;
}

module.exports = {
  ROLE_ORDER,
  hashPassword,
  getAuthUser,
  canUserAddStations,
  requireRole,
  setAuthCookie,
  clearAuthCookie,
  login,
  createUser,
  normalizeRole,
  isFieldAccountsEnabled,
  getFieldAccounts,
  normalizeFieldRole
};
