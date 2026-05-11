import Redis from 'ioredis';
import config from '../config.js';

let client;

export function getRedis() {
  if (!client) {
    client = new Redis(config.redis.url, { lazyConnect: true });
  }
  return client;
}

export async function pingRedis() {
  const r = getRedis();
  try {
    const result = await r.ping();
    return result === 'PONG';
  } catch {
    return false;
  }
}
