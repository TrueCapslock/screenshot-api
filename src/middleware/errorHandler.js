export function errorHandler(err, req, res, _next) {
  console.error('Unhandled error:', err);
  const status = err.status || 500;
  res.status(status).json({
    error: err.code || 'internal_error',
    message: err.message || 'Internal server error',
  });
}
