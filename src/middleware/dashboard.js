import config from '../config.js';

export function dashboardOnly(req, res, next) {
  const token = req.headers['x-dashboard-token'];
  if (!token || token !== config.dashboardSecret) {
    return res.status(404).json({ error: 'not_found', message: 'Not found' });
  }
  next();
}
