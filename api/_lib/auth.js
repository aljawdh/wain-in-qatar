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

// Field test accounts are DISABLED by default.
// Set NAVIDUR_ALLOW_FIELD_ACCOUNTS=true in Vercel env to enable them for controlled deployments.
const FIELD_TEST_ACCOUNTS = [
  { id: 'usr_super_001', username: 'Mohamed_Admin', password: 'SuperAdmin2026!', role: 'super_admin' },
  { id: 'usr_field_admin_001', username: 'field_admin', password: 'FieldAdmin2026!', role: 'admin' },
  { id: 'usr_field_member_a', username: 'field_member_a', password: 'FieldTestA2026!', role: 'member' },
  { id: 'usr_field_member_b', username: 'field_member_b', password: 'FieldTestB2026!', role: 'member' }
];

function isFieldAccountsEnabled() {
  return process.env.NAVIDUR_ALLOW_FIELD_ACCOUNTS === 'true';
}

function getFieldAccountByUsername(username) {
  if (!isFieldAccountsEnabled()) return null;
  const safe = cleanString(username, 60).toLowerCase();
  return FIELD_TEST_ACCOUNTS.find((a) => a.username.toLowerCase() === safe) || null;
}

function getFieldAccountById(userId) {
  if (!isFieldAccountsEnabled()) return null;
  const safe = cleanString(userId, 80);
  return FIELD_TEST_ACCOUNTS.find((a) => a.id === safe) || null;
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
      assigned_stations: []
    };
  }
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    assigned_stations: Array.isArray(user.assigned_stations) ? user.assigned_stations : []
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

function setAuthCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  const cookie = 'navidur_token=' + encodeURIComponent(token) + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200' + (secure ? '; Secure' : '');
  res.setHeader('Set-Cookie', cookie);
}

function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', 'navidur_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}

async function login(username, password) {
  const safeUsername = cleanString(username, 60);
  const passHash = hashPassword(password);

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
      user: { id: field.id, username: field.username, role: field.role, assigned_stations: [] }
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
      assigned_stations: Array.isArray(user.assigned_stations) ? user.assigned_stations : []
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
  requireRole,
  setAuthCookie,
  clearAuthCookie,
  login,
  createUser,
  normalizeRole
};
