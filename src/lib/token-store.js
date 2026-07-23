'use strict';

/**
 * Guesty allows only FIVE OAuth token requests per client id per 24 hours, and
 * each token lives 24 hours. Burning that quota takes the whole booking engine
 * offline until the window rolls, so tokens must survive process restarts.
 *
 * Resolution order:
 *   0. A token seeded via env  (GUESTY_<KEY>_ACCESS_TOKEN, read-only)
 *   1. Upstash Redis REST  (set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)
 *   2. A file in TOKEN_CACHE_DIR, else the OS temp dir
 *   3. Process memory  (fine for local dev, NOT safe on serverless)
 *
 * On a serverless host (Vercel/Netlify functions) every cold start gets a fresh
 * process AND a fresh /tmp, so option 1 is strongly recommended there.
 *
 * **A container filesystem is not persistence.** On Railway the temp dir is
 * wiped by every deploy, so each deploy costs one of the five daily tokens —
 * three deploys in an hour on 2026-07-23 exhausted the quota and took live
 * pricing down until the window rolled. Point TOKEN_CACHE_DIR at a mounted
 * volume (or configure Upstash) so restarts reuse the token they already have.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const memory = new Map();

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

const cacheDir = () => process.env.TOKEN_CACHE_DIR || os.tmpdir();
const filePath = (key) => path.join(cacheDir(), `viraalay-token-${key}.json`);

/**
 * Escape hatch for a spent quota: paste a token you already hold into
 * GUESTY_OPENAPI_ACCESS_TOKEN (+ _EXPIRES_AT, epoch ms) and the service uses it
 * instead of asking Guesty for another. Read-only — nothing ever writes back
 * here, so clearing the vars returns to the normal flow.
 */
const warnedStale = new Set();

function seeded(key) {
  const prefix = `GUESTY_${key.replace(/[^a-z0-9]/gi, '').toUpperCase()}`;
  const accessToken = process.env[`${prefix}_ACCESS_TOKEN`];
  if (!accessToken) return null;
  const expiresAt = Number(process.env[`${prefix}_EXPIRES_AT`] || 0);
  if (!expiresAt || expiresAt <= Date.now()) {
    // Once a seed lapses the service goes back to fetching normally, so a stale
    // variable is harmless and nobody has to remember to remove it. Say so once
    // per process rather than on every token read.
    if (!warnedStale.has(prefix)) {
      warnedStale.add(prefix);
      console.warn(
        `[token-store] ${prefix}_ACCESS_TOKEN has expired; fetching tokens normally. The variable can be deleted.`
      );
    }
    return null;
  }
  return { accessToken, expiresAt };
}

async function upstash(command) {
  const res = await fetch(`${UPSTASH_URL}/${command.map(encodeURIComponent).join('/')}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Upstash ${res.status}`);
  return res.json();
}

async function get(key) {
  const fromEnv = seeded(key);
  if (fromEnv) return fromEnv;

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
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(filePath(key), JSON.stringify(value), { mode: 0o600 });
  } catch (err) {
    console.warn('[token-store] file write failed, using memory only:', err.message);
  }
}

module.exports = { get, set };
