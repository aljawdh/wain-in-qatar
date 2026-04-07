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

const FIELD_TEST_ACCOUNTS = [
  { id: 'usr_super_001', username: 'Mohamed_Admin', password: 'SuperAdmin2026!', role: 'super_admin' },
  { id: 'usr_field_admin_001', username: 'field_admin', password: 'FieldAdmin2026!', role: 'admin' },
  { id: 'usr_field_member_a', username: 'field_member_a', password: 'FieldTestA2026!', role: 'member' },
  { id: 'usr_field_member_b', username: 'field_member_b', password: 'FieldTestB2026!', role: 'member' }
];

function getFieldAccountByUsername(username) {
  const safe = cleanString(username, 60).toLowerCase();
  return FIELD_TEST_ACCOUNTS.find((a) => a.username.toLowerCase() === safe) || null;
}

function getFieldAccountById(userId) {
  const safe = cleanString(userId, 80);
  return FIELD_TEST_ACCOUNTS.find((a) => a.id === safe) || null;
}

function hashPassword(password) {
  const salt = process.env.NAVIDUR_AUTH_SALT || 'navidur-static-salt';
  return crypto.createHash('sha256').update(String(password || '') + '|' + salt).digest('hex');
}

function signPayload(payload) {
  const secret = process.env.NAVIDUR_JWT_SECRET || 'navidur-dev-secret';
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return body + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const secret = process.env.NAVIDUR_JWT_SECRET || 'navidur-dev-secret';
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
  const users = await readJsonFile('users', []);
  const user = users.find((u) => String(u.username || '').toLowerCase() === safeUsername.toLowerCase());
  const passHash = hashPassword(password);

  let authUser = user;
  if (!authUser || authUser.active_status === false) {
    const field = getFieldAccountByUsername(safeUsername);
    if (!field) return null;
    if (passHash !== hashPassword(field.password)) return null;
    authUser = {
      id: field.id,
      username: field.username,
      role: field.role,
      active_status: true,
      assigned_stations: []
    };
  } else if (passHash !== authUser.hashed_password) {
    return null;
  }

  if (user) {
    user.last_login = nowIso();
    await writeJsonFile('users', users);
  }

  const token = signPayload({
    user_id: authUser.id,
    role: authUser.role,
    username: authUser.username,
    exp: Date.now() + (12 * 60 * 60 * 1000)
  });

  return {
    token,
    user: {
      id: authUser.id,
      username: authUser.username,
      role: authUser.role,
      assigned_stations: Array.isArray(authUser.assigned_stations) ? authUser.assigned_stations : []
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
