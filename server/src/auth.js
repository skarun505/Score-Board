import jwt from 'jsonwebtoken';

const secret = () => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not set');
  return process.env.JWT_SECRET;
};

export const signToken = (user) =>
  jwt.sign({ id: user.id, role: user.role, name: user.name }, secret(), { expiresIn: '12h' });

export const verifyToken = (token) => jwt.verify(token, secret());

const bearer = (req) => {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  if (req.query?.token) return String(req.query.token);
  return null;
};

export function requireAuth(roles = []) {
  return (req, res, next) => {
    const token = bearer(req);
    if (!token) return res.status(401).json({ error: 'Login required' });
    try {
      const payload = verifyToken(token);
      if (roles.length && !roles.includes(payload.role)) {
        return res.status(403).json({ error: 'Not allowed' });
      }
      req.user = payload;
      next();
    } catch {
      res.status(401).json({ error: 'Session expired, please log in again' });
    }
  };
}

/** Allows either the secret TV key (?key=...), a valid login token, or open dashboard view if key not specified. */
export function tvOrAuth(req, res, next) {
  const key = req.query.key;
  if (key && process.env.TV_KEY && key === process.env.TV_KEY) return next();
  const token = bearer(req);
  if (token) {
    try {
      req.user = verifyToken(token);
      return next();
    } catch { /* fall through */ }
  }
  if (!key && !token) return next();
  return res.status(401).json({ error: 'Unauthorized TV key or session expired' });
}
