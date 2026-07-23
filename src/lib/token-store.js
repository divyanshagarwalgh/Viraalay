'use strict';

/**
 * Guesty allows only FIVE OAuth token requests per client id per 24 hours, and
 * each token lives 24 hours. Burning that quota takes the whole booking engine
 * offline until the window rolls, so tokens must survive process restarts.
 *
 * Resolution order:
 *   1. Upstash Redis REST  (set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
 *   2. A file in the OS temp dir  (works on any always-on host)
 *   3. Process memory  (fine for local dev, NOT safe on serverless)
 *
 * On a serverless host (Vercel/Netlify functions) every cold start gets a fresh
 * process AND a fresh /tmp, so option 1 is strongly recommended there.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const memory = new Map();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const filePath = (key) => path.join(os.tmpdir(), `viraalay-token-${key}.json`);

async function upstash(command) {
  const res = await fetch(`${UPSTASH_URL}/${command.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  return res.json();
}

async function get(key) {
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      const out = await upstash(['get', `viraalay:token:${key}`]);
      return out && out.result ? JSON.parse(out.result) : null;
    } catch (err) {
      console.warn('[token-store] upstash read failed, falling back:', err.message);
    }
  }
  try {
    const raw = fs.readFileSync(filePath(key), 'utf8');
    return JSON.parse(raw);
  } catch {
    /* fall through */
  }
  return memory.get(key) || null;
}

async function set(key, value, ttlSeconds) {
  memory.set(key, value);
  if (UPSTASH_URL && UPSTASH_TOKEN) {
    try {
      await upstash(['set', `viraalay:token:${key}`, JSON.stringify(value), 'EX', String(ttlSeconds)]);
      return;
    } catch (err) {
      console.warn('[token-store] upstash write failed, falling back:', err.message);
    }
  }
  try {
    fs.writeFileSync(filePath(key), JSON.stringify(value), { mode: 0o600 });
  } catch (err) {
    console.warn('[token-store] file write failed, using memory only:', err.message);
  }
}

module.exports = { get, set };
