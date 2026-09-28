import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3001);
const jwtSecret = process.env.JWT_SECRET || 'ahorraya-development-secret';

app.use(cors());
app.use(express.json());

function createToken(user) {
  return jwt.sign({ sub: user.id, username: user.username }, jwtSecret, { expiresIn: '7d' });
}

function auth(req, res, next) {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ message: 'Token requerido.' });

  try {
    req.userId = Number(jwt.verify(token, jwtSecret).sub);
    next();
  } catch {
    return res.status(401).json({ message: 'Token inválido o vencido.' });
  }
}

function publicUser(user) {
  return { id: user.id, fullName: user.full_name, username: user.username, email: user.email };
}

app.get('/api/health', (_req, res) => res.json({ status: 'ok', service: 'ahorraya-api' }));

app.post('/api/auth/register', async (req, res) => {
  const { fullName, username, email, password } = req.body;
  if (!fullName || !username || !email || !password || password.length < 6) {
    return res.status(400).json({ message: 'Nombre, usuario, correo y contraseña de al menos 6 caracteres son obligatorios.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const result = db.prepare('INSERT INTO users (full_name, username, email, password_hash) VALUES (?, ?, ?, ?)').run(fullName.trim(), username.trim().toLowerCase(), email.trim().toLowerCase(), passwordHash);
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
    return res.status(201).json({ token: createToken(user), user: publicUser(user) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'El usuario o correo ya está registrado.' });
    return res.status(500).json({ message: 'No fue posible crear la cuenta.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !(await bcrypt.compare(String(req.body.password || ''), user.password_hash))) {
    return res.status(401).json({ message: 'Correo o contraseña incorrectos.' });
  }
  return res.json({ token: createToken(user), user: publicUser(user) });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  return user ? res.json({ user: publicUser(user) }) : res.status(404).json({ message: 'Usuario no encontrado.' });
});

app.patch('/api/auth/me', auth, async (req, res) => {
  const currentUser = db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId);
  if (!currentUser) return res.status(404).json({ message: 'Usuario no encontrado.' });

  const fullName = String(req.body.fullName || currentUser.full_name).trim();
  const username = String(req.body.username || currentUser.username).trim().toLowerCase();
  const email = String(req.body.email || currentUser.email).trim().toLowerCase();
  const passwordHash = req.body.password ? await bcrypt.hash(String(req.body.password), 12) : currentUser.password_hash;

  if (!fullName || !/^[a-z0-9_]{3,20}$/.test(username) || !email) return res.status(400).json({ message: 'Los datos del perfil no son válidos.' });

  try {
    db.prepare('UPDATE users SET full_name = ?, username = ?, email = ?, password_hash = ? WHERE id = ?').run(fullName, username, email, passwordHash, req.userId);
    return res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(req.userId)) });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ message: 'El usuario o correo ya está registrado.' });
    return res.status(500).json({ message: 'No fue posible actualizar el perfil.' });
  }
});

app.get('/api/users/accepted', auth, (req, res) => {
  const users = db.prepare(`
    SELECT DISTINCT u.id, u.full_name, u.username, u.email
    FROM invitations i
    JOIN users u ON u.id = CASE WHEN i.inviter_id = ? THEN i.invitee_id ELSE i.inviter_id END
    WHERE (i.inviter_id = ? OR i.invitee_id = ?) AND i.status = 'accepted'
    ORDER BY u.full_name COLLATE NOCASE
  `).all(req.userId, req.userId, req.userId);
  res.json({ users });
});

app.get('/api/users', auth, (req, res) => {
  const users = db.prepare('SELECT id, full_name, username, email FROM users WHERE id != ? ORDER BY full_name COLLATE NOCASE').all(req.userId);
  res.json({ users });
});

app.get('/api/users/:username', auth, (req, res) => {
  const user = db.prepare('SELECT id, full_name, username FROM users WHERE username = ?').get(req.params.username.toLowerCase());
  return user ? res.json({ user }) : res.status(404).json({ message: 'Usuario no encontrado.' });
});

app.get('/api/goals', auth, (req, res) => {
  const goals = db.prepare(`
    SELECT g.*, COALESCE(SUM(c.amount), 0) AS saved_amount
    FROM goals g
    JOIN goal_members gm ON gm.goal_id = g.id AND gm.user_id = ?
    LEFT JOIN contributions c ON c.goal_id = g.id
    GROUP BY g.id ORDER BY g.created_at DESC
  `).all(req.userId).map((goal) => ({
    ...goal,
    shared: Boolean(goal.shared),
    contributors: db.prepare(`
      SELECT gm.user_id AS id, u.full_name AS name, gm.monthly_amount AS monthlyAmount
      FROM goal_members gm JOIN users u ON u.id = gm.user_id WHERE gm.goal_id = ?
    `).all(goal.id),
    monthlyEntries: [],
  }));
  res.json({ goals });
});

app.post('/api/goals', auth, (req, res) => {
  const { name, targetAmount, deadline, shared = false, members = [] } = req.body;
  if (!name || !Number.isFinite(Number(targetAmount)) || Number(targetAmount) <= 0) return res.status(400).json({ message: 'Nombre y monto objetivo válidos son obligatorios.' });

  const createGoal = db.transaction(() => {
    const goalResult = db.prepare('INSERT INTO goals (owner_id, name, target_amount, deadline, shared) VALUES (?, ?, ?, ?, ?)').run(req.userId, name.trim(), Number(targetAmount), deadline || null, shared ? 1 : 0);
    db.prepare('INSERT INTO goal_members (goal_id, user_id, monthly_amount, role) VALUES (?, ?, ?, ?)').run(goalResult.lastInsertRowid, req.userId, 0, 'owner');
    for (const username of Array.isArray(members) ? members : []) {
      const member = db.prepare(`
        SELECT u.id FROM users u
        WHERE u.username = ? AND EXISTS (
          SELECT 1 FROM invitations i
          WHERE i.status = 'accepted'
            AND ((i.inviter_id = ? AND i.invitee_id = u.id) OR (i.invitee_id = ? AND i.inviter_id = u.id))
        )
      `).get(String(username).trim().toLowerCase(), req.userId, req.userId);
      if (member) db.prepare('INSERT OR IGNORE INTO goal_members (goal_id, user_id, monthly_amount, role) VALUES (?, ?, ?, ?)').run(goalResult.lastInsertRowid, member.id, 0, 'member');
    }
    return Number(goalResult.lastInsertRowid);
  });

  const goalId = createGoal();
  const goal = db.prepare('SELECT * FROM goals WHERE id = ?').get(goalId);
  res.status(201).json({ goal: { ...goal, shared: Boolean(goal.shared), contributors: [], monthlyEntries: [] } });
});

app.post('/api/goals/:goalId/invitations', auth, (req, res) => {
  const goal = db.prepare('SELECT * FROM goals WHERE id = ? AND owner_id = ?').get(req.params.goalId, req.userId);
  const invitee = db.prepare('SELECT * FROM users WHERE username = ?').get(String(req.body.username || '').trim().toLowerCase());
  if (!goal) return res.status(404).json({ message: 'Meta no encontrada o no eres su propietario.' });
  if (!invitee) return res.status(404).json({ message: 'Usuario invitado no encontrado.' });
  if (invitee.id === req.userId) return res.status(400).json({ message: 'No puedes invitarte a ti mismo.' });

  try {
    const result = db.prepare('INSERT INTO invitations (goal_id, inviter_id, invitee_id) VALUES (?, ?, ?)').run(goal.id, req.userId, invitee.id);
    res.status(201).json({ invitation: db.prepare('SELECT * FROM invitations WHERE id = ?').get(result.lastInsertRowid) });
  } catch (error) {
    res.status(error.code === 'SQLITE_CONSTRAINT_UNIQUE' ? 409 : 500).json({ message: 'La invitación ya existe o no pudo crearse.' });
  }
});

app.delete('/api/goals/:goalId', auth, (req, res) => {
  const goal = db.prepare('SELECT id FROM goals WHERE id = ? AND owner_id = ?').get(req.params.goalId, req.userId);
  if (!goal) return res.status(404).json({ message: 'Meta no encontrada o no eres su propietario.' });
  db.prepare('DELETE FROM goals WHERE id = ?').run(goal.id);
  res.status(204).end();
});

app.delete('/api/goals/:goalId/membership', auth, (req, res) => {
  const membership = db.prepare(`
    SELECT gm.user_id, g.owner_id FROM goal_members gm JOIN goals g ON g.id = gm.goal_id
    WHERE gm.goal_id = ? AND gm.user_id = ?
  `).get(req.params.goalId, req.userId);
  if (!membership) return res.status(404).json({ message: 'No perteneces a esta meta.' });
  if (membership.owner_id === req.userId) return res.status(400).json({ message: 'El propietario debe eliminar la meta completa.' });
  db.prepare('DELETE FROM goal_members WHERE goal_id = ? AND user_id = ?').run(req.params.goalId, req.userId);
  res.status(204).end();
});

app.get('/api/invitations', auth, (req, res) => {
  const invitations = db.prepare(`
    SELECT i.*, g.name AS goal_name, u.full_name AS inviter_name
    FROM invitations i JOIN goals g ON g.id = i.goal_id JOIN users u ON u.id = i.inviter_id
    WHERE i.invitee_id = ? ORDER BY i.created_at DESC
  `).all(req.userId);
  res.json({ invitations });
});

app.patch('/api/invitations/:invitationId', auth, (req, res) => {
  const status = ['accepted', 'declined'].includes(req.body.status) ? req.body.status : null;
  const invitation = db.prepare('SELECT * FROM invitations WHERE id = ? AND invitee_id = ?').get(req.params.invitationId, req.userId);
  if (!invitation || !status) return res.status(400).json({ message: 'Invitación o estado inválido.' });

  db.transaction(() => {
    db.prepare('UPDATE invitations SET status = ? WHERE id = ?').run(status, invitation.id);
    if (status === 'accepted') db.prepare('INSERT OR IGNORE INTO goal_members (goal_id, user_id) VALUES (?, ?)').run(invitation.goal_id, req.userId);
  })();
  res.json({ status });
});

app.delete('/api/invitations/:invitationId', auth, (req, res) => {
  const invitation = db.prepare(`
    SELECT id FROM invitations
    WHERE id = ? AND (invitee_id = ? OR inviter_id = ?)
      AND status IN ('accepted', 'declined')
  `).get(req.params.invitationId, req.userId, req.userId);
  if (!invitation) return res.status(404).json({ message: 'Invitación no encontrada o todavía está pendiente.' });
  db.prepare('DELETE FROM invitations WHERE id = ?').run(invitation.id);
  res.status(204).end();
});

app.post('/api/goals/:goalId/contributions', auth, (req, res) => {
  const amount = Number(req.body.amount);
  const member = db.prepare('SELECT 1 FROM goal_members WHERE goal_id = ? AND user_id = ?').get(req.params.goalId, req.userId);
  if (!member || !Number.isFinite(amount) || amount <= 0) return res.status(400).json({ message: 'Aporte inválido o usuario no pertenece a la meta.' });
  const result = db.prepare('INSERT INTO contributions (goal_id, user_id, amount, note) VALUES (?, ?, ?, ?)').run(req.params.goalId, req.userId, amount, req.body.note || null);
  res.status(201).json({ contribution: db.prepare('SELECT * FROM contributions WHERE id = ?').get(result.lastInsertRowid) });
});

app.listen(port, '0.0.0.0', () => console.log(`AhorraYa API disponible en http://localhost:${port}`));
