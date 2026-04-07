'use strict';

const { Redis } = require('@upstash/redis');

const memoryCache = new Map();
let redisClient = null;

function getRedisClient() {
  if (redisClient) return redisClient;
  const url = process.env.KV_URL || process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  redisClient = new Redis({ url, token });
  return redisClient;
}

function isExpired(item) {
  return !item || Date.now() > item.expiresAt;
}

async function get(key) {
  const redis = getRedisClient();
  if (redis) {
    try {
      const value = await redis.get(key);
      return value || null;
    } catch (_) {}
  }

  const item = memoryCache.get(key);
  if (isExpired(item)) {
    memoryCache.delete(key);
    return null;
  }
  return item.value;
}

async function set(key, value, ttlSeconds) {
  const redis = getRedisClient();
  if (redis) {
    try {
      await redis.set(key, value, { ex: ttlSeconds });
      return;
    } catch (_) {}
  }

  memoryCache.set(key, {
    value,
    expiresAt: Date.now() + (ttlSeconds * 1000)
  });
}

module.exports = {
  get,
  set
};
