import Redis from 'ioredis';
import config from '../config.js';

const redis = new Redis(config.redis.url);

const TTL = 3600;

export function cacheKey(url, options) {
  const hash = JSON.stringify({ url, ...options });
  return `ss:${Buffer.from(hash).toString('base64').slice(0, 64)}`;
}

export function get(key) {
  return redis.getBuffer(key);
}

export function set(key, buffer) {
  return redis.setex(key, TTL, buffer);
}

export async function getCached(url, options) {
  const key = cacheKey(url, options);
  const cached = await get(key);
  if (cached) return cached;
  return null;
}

export function setCache(url, options, buffer) {
  return set(cacheKey(url, options), buffer);
}
