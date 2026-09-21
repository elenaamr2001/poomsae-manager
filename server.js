'use strict';

const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { Pool } = require('pg');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const util = require('util');

const scrypt = util.promisify(crypto.scrypt);
const app = express();
const PORT = Number(process.env.PORT || 8080);
const NODE_ENV = process.env.NODE_ENV || 'development';
const PROD = NODE_ENV === 'production';
const SESSION_DAYS = Math.max(1, Number(process.env.SESSION_DAYS || 14));
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Falta DATABASE_URL. Consulta .env.example o README.md.');
  process.exit(1);
}

const pool = new Pool({ connectionString: DATABASE_URL });

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(express.json({ limit: '10mb' }));
app.use((req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex, nofollow'); next(); });

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 500,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos antes de volver a intentarlo.' }
});
app.use('/api', apiLimiter);

function norm(s = '') {
  return String(s)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
function nowRevision(previous = 0) {
  const n = Date.now();
  return n > Number(previous || 0) ? n : Number(previous || 0) + 1;
}
function deep(value) { return JSON.parse(JSON.stringify(value)); }
function drawScopeKey(compId, catId) { return `${compId}::${catId}`; }
function categoryMap(state) { return new Map((state.categories || []).map(c => [c.id, c])); }
function competitionMap(state) { return new Map((state.competitions || []).map(c => [c.id, c])); }
function feeFor(comp, catId) {
  const specific = comp?.categoryFees?.[catId];
  return Number(specific !== undefined && specific !== null && specific !== '' ? specific : comp?.defaultFee || 0);
}
function entryLabel(e) {
  return e.kind === 'Individual' ? `${e.firstName || ''} ${e.lastName || ''}`.trim() : String(e.name || '').trim();
}
function cookieMap(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const key = await scrypt(String(password), salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$32768$8$1$${salt}$${Buffer.from(key).toString('hex')}`;
}
async function verifyPassword(password, stored) {
  try {
    const [kind, n, r, p, salt, expectedHex] = String(stored || '').split('$');
    if (kind !== 'scrypt' || !salt || !expectedHex) return false;
    const key = await scrypt(String(password), salt, Buffer.from(expectedHex, 'hex').length, {
      N: Number(n), r: Number(r), p: Number(p), maxmem: 64 * 1024 * 1024
    });
    const expected = Buffer.from(expectedHex, 'hex');
    const actual = Buffer.from(key);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function ensureStateSchema(input) {
  const state = deep(input || {});
  state.version = state.version || 2;
  state.categories = Array.isArray(state.categories) ? state.categories : [];
  state.competitions = Array.isArray(state.competitions) ? state.competitions : [];
  state.clubs = Array.isArray(state.clubs) ? state.clubs : [];
  state.entries = Array.isArray(state.entries) ? state.entries : [];
  state.history = Array.isArray(state.history) ? state.history : [];
  state.currentDraws = state.currentDraws && typeof state.currentDraws === 'object' ? state.currentDraws : {};
  state.settings = state.settings || { eventName: 'Gestión de Poomsae', thirdPlace: false };
  state.auth = state.auth || { admin: null };

  const needsLegacy = state.entries.some(e => !e.competitionId) ||
    Object.values(state.currentDraws).some(d => !d.competitionId) ||
    state.history.some(h => !h.competitionId);
  let legacy = state.competitions[0];
  if (needsLegacy) {
    if (!legacy) {
      legacy = {
        id: 'comp_legacy', name: state.settings.eventName || 'Campeonato migrado', date: '', location: '',
        registrationOpen: true, defaultFee: 0, categoryIds: state.categories.map(c => c.id), categoryFees: {},
        createdAt: state.createdAt || Date.now()
      };
      state.competitions.push(legacy);
    }
    state.entries = state.entries.map(e => ({ ...e, competitionId: e.competitionId || legacy.id, fee: Number(e.fee || 0) }));
    const remapped = {};
    for (const d0 of Object.values(state.currentDraws)) {
      const d = { ...d0 };
      d.competitionId = d.competitionId || legacy.id;
      d.competitionName = d.competitionName || legacy.name;
      d.drawKey = d.drawKey || drawScopeKey(d.competitionId, d.categoryId);
      remapped[d.drawKey] = d;
    }
    state.currentDraws = remapped;
    state.history = state.history.map(h => ({
      ...h,
      competitionId: h.competitionId || legacy.id,
      competitionName: h.competitionName || legacy.name,
      drawKey: h.drawKey || drawScopeKey(h.competitionId || legacy.id, h.categoryId)
    }));
  }

  state.competitions = state.competitions.map(c => ({
    ...c,
    date: c.date || '',
    location: c.location || '',
    registrationOpen: c.registrationOpen !== false,
    defaultFee: Number(c.defaultFee || 0),
    categoryIds: Array.isArray(c.categoryIds) ? c.categoryIds : state.categories.map(x => x.id),
    categoryFees: c.categoryFees || {}
  }));
  state.entries = state.entries.map(e => ({ ...e, fee: Number(e.fee || 0) }));
  state.clubs = state.clubs.map(c => {
    const clean = { ...c };
    delete clean.passwordHash;
    delete clean.passwordSalt;
    return { ...clean, loginUsername: clean.loginUsername || '', active: clean.active !== false };
  });
  if (!state.createdAt) state.createdAt = Date.now();
  return state;
}

async function initSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.query('DELETE FROM sessions WHERE expires_at <= NOW()');
}

async function getAppState(client = pool) {
  const r = await client.query('SELECT data, revision FROM app_state WHERE id=1');
  if (!r.rowCount) return null;
  const state = ensureStateSchema(r.rows[0].data);
  state.updatedAt = Number(r.rows[0].revision);
  return { state, revision: Number(r.rows[0].revision) };
}

async function getCredentialMetadata(client = pool) {
  const r = await client.query('SELECT id, role, club_id, username, active FROM users');
  const admin = r.rows.find(x => x.role === 'admin') || null;
  const clubs = new Map(r.rows.filter(x => x.role === 'club').map(x => [x.club_id, x]));
  return { admin, clubs };
}

function applyCredentialMetadata(state, meta) {
  const out = ensureStateSchema(state);
  out.auth = { admin: meta.admin ? { username: meta.admin.username } : null };
  out.clubs = out.clubs.map(c => {
    const u = meta.clubs.get(c.id);
    return {
      ...c,
      loginUsername: u?.username || '',
      active: u ? !!u.active : false,
      passwordHash: '',
      passwordSalt: ''
    };
  });
  return out;
}

function safeClubState(state, clubId) {
  const club = (state.clubs || []).find(c => c.id === clubId);
  if (!club) return null;
  const entries = (state.entries || []).filter(e => e.clubId === clubId);
  const scopes = new Set(entries.map(e => drawScopeKey(e.competitionId, e.categoryId)));
  const currentDraws = {};
  for (const [key, d] of Object.entries(state.currentDraws || {})) {
    if (scopes.has(key) || scopes.has(drawScopeKey(d.competitionId, d.categoryId))) {
      currentDraws[key] = {
        id: d.id, drawKey: key, competitionId: d.competitionId, categoryId: d.categoryId,
        confirmed: !!d.confirmed, createdAt: d.createdAt
      };
    }
  }
  return {
    version: state.version,
    categories: state.categories || [],
    competitions: state.competitions || [],
    clubs: [club],
    entries,
    currentDraws,
    history: [],
    settings: state.settings || { eventName: 'Gestión de Poomsae', thirdPlace: false },
    auth: { admin: null },
    createdAt: state.createdAt,
    updatedAt: state.updatedAt
  };
}

async function createSession(res, user) {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await pool.query(
    'INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)',
    [tokenHash, user.id, expiresAt]
  );
  res.cookie('poomsae_sid', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: PROD,
    path: '/',
    expires: expiresAt
  });
  return { role: user.role, clubId: user.club_id || undefined };
}
async function destroySession(req, res) {
  const token = cookieMap(req).poomsae_sid;
  if (token) await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)]);
  res.clearCookie('poomsae_sid', { httpOnly: true, sameSite: 'strict', secure: PROD, path: '/' });
}
async function loadSession(req) {
  const token = cookieMap(req).poomsae_sid;
  if (!token) return null;
  const r = await pool.query(`
    SELECT u.id, u.role, u.club_id, u.username, u.active, s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1
  `, [hashToken(token)]);
  if (!r.rowCount) return null;
  const user = r.rows[0];
  if (!user.active || new Date(user.expires_at).getTime() <= Date.now()) {
    await pool.query('DELETE FROM sessions WHERE token_hash=$1', [hashToken(token)]);
    return null;
  }
  pool.query('UPDATE sessions SET last_seen_at=NOW() WHERE token_hash=$1', [hashToken(token)]).catch(() => {});
  return { userId: user.id, role: user.role, clubId: user.club_id || undefined, username: user.username };
}

async function requireSession(req, res, next) {
  try {
    req.sessionUser = await loadSession(req);
    if (!req.sessionUser) return res.status(401).json({ error: 'Sesión no iniciada o caducada.' });
    next();
  } catch (e) { next(e); }
}
function requireAdmin(req, res, next) {
  if (req.sessionUser?.role !== 'admin') return res.status(403).json({ error: 'Solo la organización puede realizar esta acción.' });
  next();
}

function snapshotByScope(entries) {
  const m = new Map();
  for (const e of entries) {
    const k = drawScopeKey(e.competitionId, e.categoryId);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(e);
  }
  for (const v of m.values()) v.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return m;
}
function changedScopes(oldEntries, newEntries) {
  const a = snapshotByScope(oldEntries), b = snapshotByScope(newEntries);
  const ids = new Set([...a.keys(), ...b.keys()]);
  return [...ids].filter(id => JSON.stringify(a.get(id) || []) !== JSON.stringify(b.get(id) || []));
}
function normalizeClubEntries(state, clubId, submitted, oldOwn) {
  const cats = categoryMap(state), comps = competitionMap(state), oldMap = new Map((oldOwn || []).map(e => [e.id, e]));
  if (!Array.isArray(submitted)) throw new Error('Formato de inscripciones no válido.');
  const normalized = [];
  const dup = new Set();
  for (const raw of submitted) {
    if (!raw || raw.clubId !== clubId) throw new Error('Una cuenta de club solo puede guardar inscripciones de su propio club.');
    const comp = comps.get(raw.competitionId);
    if (!comp) throw new Error('La competición de una inscripción ya no existe.');
    const cat = cats.get(raw.categoryId);
    if (!cat) throw new Error('La categoría de una inscripción ya no existe.');
    if (!(comp.categoryIds || []).includes(cat.id)) throw new Error(`La categoría ${cat.name} no está habilitada en ${comp.name}.`);
    if (cat.type !== raw.kind) throw new Error(`La inscripción ${raw.id || ''} no coincide con el tipo de su categoría.`);
    const previous = oldMap.get(raw.id);
    const changed = !previous || JSON.stringify({ ...previous, fee: undefined, updatedAt: undefined }) !== JSON.stringify({ ...raw, fee: undefined, updatedAt: undefined });
    if (changed && comp.registrationOpen === false) throw new Error(`Las inscripciones de ${comp.name} están cerradas.`);
    if (raw.kind === 'Individual') {
      if (!String(raw.firstName || '').trim()) throw new Error('Hay un participante individual sin nombre.');
    } else {
      const expected = raw.kind === 'Pareja' ? 2 : 3;
      if (!String(raw.name || '').trim() || !Array.isArray(raw.members) || raw.members.length !== expected || raw.members.some(x => !String(x || '').trim())) {
        throw new Error(`Hay un ${raw.kind.toLowerCase()} incompleto.`);
      }
    }
    const duplicateKey = [raw.competitionId, raw.categoryId, clubId, norm(entryLabel(raw))].join('|');
    if (dup.has(duplicateKey)) throw new Error('Hay una inscripción duplicada dentro de la misma competición y categoría.');
    dup.add(duplicateKey);
    const fee = previous && previous.competitionId === raw.competitionId && previous.categoryId === raw.categoryId
      ? Number(previous.fee || 0)
      : feeFor(comp, raw.categoryId);
    normalized.push({ ...raw, clubId, fee });
  }
  return normalized;
}

app.get('/health', async (req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/bootstrap', async (req, res, next) => {
  try {
    const admin = await pool.query("SELECT id FROM users WHERE role='admin' LIMIT 1");
    const session = await loadSession(req);
    res.set('Cache-Control', 'no-store').json({
      configured: admin.rowCount > 0,
      session: session ? { role: session.role, clubId: session.clubId } : null
    });
  } catch (e) { next(e); }
});

app.post('/api/init', loginLimiter, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { username = '', password = '', state: rawState } = req.body || {};
    if (!String(username).trim()) return res.status(400).json({ error: 'Introduce un usuario administrador.' });
    if (String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    if (!rawState?.categories) return res.status(400).json({ error: 'Configuración inicial no válida.' });

    await client.query('BEGIN');
    const exists = await client.query("SELECT id FROM users WHERE role='admin' LIMIT 1 FOR UPDATE");
    if (exists.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'La organización ya está configurada.' });
    }
    const revision = nowRevision();
    const state = ensureStateSchema(rawState);
    state.auth = { admin: { username: String(username).trim() } };
    state.clubs = [];
    state.updatedAt = revision;
    await client.query(`
      INSERT INTO app_state(id,data,revision,updated_at) VALUES(1,$1,$2,NOW())
      ON CONFLICT(id) DO UPDATE SET data=EXCLUDED.data, revision=EXCLUDED.revision, updated_at=NOW()
    `, [state, revision]);
    const user = {
      id: crypto.randomUUID(), role: 'admin', club_id: null,
      username: String(username).trim(), username_norm: norm(username),
      password_hash: await hashPassword(password), active: true
    };
    await client.query(`
      INSERT INTO users(id,role,club_id,username,username_norm,password_hash,active)
      VALUES($1,$2,$3,$4,$5,$6,$7)
    `, [user.id, user.role, user.club_id, user.username, user.username_norm, user.password_hash, user.active]);
    await client.query('COMMIT');
    const session = await createSession(res, user);
    res.json({ ok: true, session, updatedAt: revision });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'Ese usuario ya existe.' });
    next(e);
  } finally { client.release(); }
});

app.post('/api/login', loginLimiter, async (req, res, next) => {
  try {
    const { username = '', password = '' } = req.body || {};
    const r = await pool.query('SELECT * FROM users WHERE username_norm=$1 LIMIT 1', [norm(username)]);
    if (!r.rowCount || !r.rows[0].active || !(await verifyPassword(password, r.rows[0].password_hash))) {
      return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
    }
    const session = await createSession(res, r.rows[0]);
    res.json({ ok: true, session });
  } catch (e) { next(e); }
});

app.post('/api/logout', async (req, res, next) => {
  try {
    await destroySession(req, res);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

app.get('/api/state', requireSession, async (req, res, next) => {
  try {
    const stored = await getAppState();
    if (!stored) return res.status(404).json({ error: 'No existe un campeonato configurado.' });
    const meta = await getCredentialMetadata();
    let state = applyCredentialMetadata(stored.state, meta);
    state.updatedAt = stored.revision;
    if (req.sessionUser.role === 'club') {
      const filtered = safeClubState(state, req.sessionUser.clubId);
      if (!filtered) return res.status(403).json({ error: 'El club ya no existe.' });
      state = filtered;
    }
    res.set('Cache-Control', 'no-store').json({
      state,
      session: { role: req.sessionUser.role, clubId: req.sessionUser.clubId }
    });
  } catch (e) { next(e); }
});

app.put('/api/state', requireSession, requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const incomingRaw = req.body?.state;
    if (!incomingRaw?.categories || !incomingRaw?.competitions || !incomingRaw?.clubs || !incomingRaw?.entries) {
      return res.status(400).json({ error: 'Estado del campeonato no válido.' });
    }
    await client.query('BEGIN');
    const currentRow = await client.query('SELECT data,revision FROM app_state WHERE id=1 FOR UPDATE');
    if (!currentRow.rowCount) throw new Error('No existe estado de aplicación.');
    const currentRevision = Number(currentRow.rows[0].revision);
    if (req.body.baseUpdatedAt !== undefined && Number(req.body.baseUpdatedAt) !== currentRevision) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Hay cambios más recientes realizados por otro usuario. Actualiza los datos antes de guardar.' });
    }

    let state = ensureStateSchema(incomingRaw);
    const meta = await getCredentialMetadata(client);
    const incomingClubIds = new Set(state.clubs.map(c => c.id));

    // Si el administrador elimina clubes desde un reinicio/importación, elimina también sus cuentas.
    for (const [clubId, u] of meta.clubs.entries()) {
      if (!incomingClubIds.has(clubId)) await client.query('DELETE FROM users WHERE id=$1', [u.id]);
    }
    const meta2 = await getCredentialMetadata(client);
    state = applyCredentialMetadata(state, meta2);
    const revision = nowRevision(currentRevision);
    state.updatedAt = revision;
    await client.query('UPDATE app_state SET data=$1, revision=$2, updated_at=NOW() WHERE id=1', [state, revision]);
    await client.query('COMMIT');
    res.json({ ok: true, updatedAt: revision });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally { client.release(); }
});

app.put('/api/club-entries', requireSession, async (req, res, next) => {
  if (req.sessionUser.role !== 'club') return res.status(403).json({ error: 'Solo una cuenta de club puede usar este endpoint.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query('SELECT data,revision FROM app_state WHERE id=1 FOR UPDATE');
    if (!row.rowCount) throw new Error('No existe estado de aplicación.');
    const state = ensureStateSchema(row.rows[0].data);
    const oldOwn = (state.entries || []).filter(e => e.clubId === req.sessionUser.clubId);
    let entries;
    try { entries = normalizeClubEntries(state, req.sessionUser.clubId, req.body?.entries, oldOwn); }
    catch (e) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: e.message });
    }
    const changed = changedScopes(oldOwn, entries);
    const comps = competitionMap(state);
    for (const key of changed) {
      const [compId] = key.split('::');
      const comp = comps.get(compId);
      if (comp?.registrationOpen === false) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: `Las inscripciones de ${comp.name} están cerradas.` });
      }
      if (state.currentDraws?.[key]?.confirmed) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'No se pueden modificar inscripciones de una categoría con el sorteo confirmado.' });
      }
    }
    const other = (state.entries || []).filter(e => e.clubId !== req.sessionUser.clubId);
    state.entries = [...other, ...entries];
    for (const key of changed) if (state.currentDraws?.[key]) delete state.currentDraws[key];
    const revision = nowRevision(row.rows[0].revision);
    state.updatedAt = revision;
    await client.query('UPDATE app_state SET data=$1, revision=$2, updated_at=NOW() WHERE id=1', [state, revision]);
    await client.query('COMMIT');
    res.json({ ok: true, updatedAt: revision, entries });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally { client.release(); }
});

app.post('/api/admin/clubs', requireSession, requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { id = '', name = '', username = '', password = '', active = true } = req.body || {};
    const cleanName = String(name).trim();
    const cleanUser = String(username).trim();
    if (!cleanName) return res.status(400).json({ error: 'Introduce el nombre del club.' });
    if (!cleanUser) return res.status(400).json({ error: 'Asigna un usuario de acceso.' });
    if (password && String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });

    await client.query('BEGIN');
    const row = await client.query('SELECT data,revision FROM app_state WHERE id=1 FOR UPDATE');
    if (!row.rowCount) throw new Error('No existe estado de aplicación.');
    const state = ensureStateSchema(row.rows[0].data);
    let club = id ? state.clubs.find(c => c.id === id) : null;
    if (!id && !password) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Asigna una contraseña al nuevo club.' });
    }
    if (state.clubs.some(c => c.id !== id && norm(c.name) === norm(cleanName))) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ya existe un club con un nombre equivalente.' });
    }
    const conflict = await client.query('SELECT id FROM users WHERE username_norm=$1 AND club_id IS DISTINCT FROM $2 LIMIT 1', [norm(cleanUser), id || null]);
    if (conflict.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Ese usuario ya está asignado a otra cuenta.' });
    }

    const clubId = id || `club_${crypto.randomUUID()}`;
    const existingUser = await client.query("SELECT * FROM users WHERE role='club' AND club_id=$1 LIMIT 1", [clubId]);
    if (!club) {
      club = { id: clubId, name: cleanName, loginUsername: cleanUser, active: !!active, createdAt: Date.now() };
      state.clubs.push(club);
    } else {
      Object.assign(club, { name: cleanName, loginUsername: cleanUser, active: !!active, updatedAt: Date.now() });
    }
    delete club.passwordHash;
    delete club.passwordSalt;

    if (existingUser.rowCount) {
      const u = existingUser.rows[0];
      const passwordHash = password ? await hashPassword(password) : u.password_hash;
      await client.query(`
        UPDATE users SET username=$1, username_norm=$2, password_hash=$3, active=$4, updated_at=NOW()
        WHERE id=$5
      `, [cleanUser, norm(cleanUser), passwordHash, !!active, u.id]);
    } else {
      const passwordHash = await hashPassword(password);
      await client.query(`
        INSERT INTO users(id,role,club_id,username,username_norm,password_hash,active)
        VALUES($1,'club',$2,$3,$4,$5,$6)
      `, [crypto.randomUUID(), clubId, cleanUser, norm(cleanUser), passwordHash, !!active]);
    }

    const revision = nowRevision(row.rows[0].revision);
    state.updatedAt = revision;
    await client.query('UPDATE app_state SET data=$1, revision=$2, updated_at=NOW() WHERE id=1', [state, revision]);
    await client.query('COMMIT');
    res.json({ ok: true, club: { ...club, passwordHash: '', passwordSalt: '' }, updatedAt: revision });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    if (e.code === '23505') return res.status(409).json({ error: 'Ese usuario ya está en uso.' });
    next(e);
  } finally { client.release(); }
});

app.delete('/api/admin/clubs/:id', requireSession, requireAdmin, async (req, res, next) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const row = await client.query('SELECT data,revision FROM app_state WHERE id=1 FOR UPDATE');
    if (!row.rowCount) throw new Error('No existe estado de aplicación.');
    const state = ensureStateSchema(row.rows[0].data);
    const id = req.params.id;
    const used = state.entries.filter(e => e.clubId === id).length;
    if (used) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: `No se puede eliminar: tiene ${used} inscripciones asociadas. Reasígnalas o elimínalas primero.` });
    }
    state.clubs = state.clubs.filter(c => c.id !== id);
    await client.query("DELETE FROM users WHERE role='club' AND club_id=$1", [id]);
    const revision = nowRevision(row.rows[0].revision);
    state.updatedAt = revision;
    await client.query('UPDATE app_state SET data=$1, revision=$2, updated_at=NOW() WHERE id=1', [state, revision]);
    await client.query('COMMIT');
    res.json({ ok: true, updatedAt: revision });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    next(e);
  } finally { client.release(); }
});

app.post('/api/admin/credentials', requireSession, requireAdmin, async (req, res, next) => {
  try {
    const { username = '', password = '' } = req.body || {};
    const cleanUser = String(username).trim();
    if (!cleanUser) return res.status(400).json({ error: 'Introduce un usuario.' });
    if (password && String(password).length < 8) return res.status(400).json({ error: 'La contraseña debe tener al menos 8 caracteres.' });
    const conflict = await pool.query('SELECT id FROM users WHERE username_norm=$1 AND id<>$2 LIMIT 1', [norm(cleanUser), req.sessionUser.userId]);
    if (conflict.rowCount) return res.status(409).json({ error: 'Ese usuario ya pertenece a otra cuenta.' });
    if (password) {
      await pool.query('UPDATE users SET username=$1, username_norm=$2, password_hash=$3, updated_at=NOW() WHERE id=$4',
        [cleanUser, norm(cleanUser), await hashPassword(password), req.sessionUser.userId]);
    } else {
      await pool.query('UPDATE users SET username=$1, username_norm=$2, updated_at=NOW() WHERE id=$3',
        [cleanUser, norm(cleanUser), req.sessionUser.userId]);
    }
    res.json({ ok: true, username: cleanUser });
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Ese usuario ya está en uso.' });
    next(e);
  }
});

app.get('/api/admin/security-status', requireSession, requireAdmin, async (req, res, next) => {
  try {
    const r = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE role='club') AS clubs,
        (SELECT COUNT(*)::int FROM users WHERE role='club' AND active) AS active_clubs,
        (SELECT COUNT(*)::int FROM sessions WHERE expires_at>NOW()) AS active_sessions
    `);
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

app.use('/api', (req, res) => res.status(404).json({ error: 'API no encontrada.' }));

app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  etag: true,
  maxAge: PROD ? '5m' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-store');
  }
}));
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'Error interno del servidor.' });
});

(async () => {
  try {
    await initSchema();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Poomsae Manager Web escuchando en puerto ${PORT}`);
      console.log(`Entorno: ${NODE_ENV}`);
    });
  } catch (e) {
    console.error('No se pudo iniciar la aplicación:', e);
    process.exit(1);
  }
})();
