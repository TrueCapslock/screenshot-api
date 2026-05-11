export function admin(req, res, next) {
  if (!req.isAdmin) {
    return res.status(403).json({ error: 'forbidden', message: 'Admin access required' });
  }
  next();
}
