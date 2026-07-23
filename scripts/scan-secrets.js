'use strict';

/**
 * Pre-commit safety net: fails if any live secret appears in a file that is not
 * .env, or if .env is not ignored by git.
 *
 *   npm run scan-secrets
 *
 * Run this before every commit and in CI. A secret reaching a repo is not
 * fixable by rewriting history — it has to be rotated.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

require('dotenv').config();

const ROOT = path.join(__dirname, '..');

const SECRETS = [
  ['PAYU_MERCHANT_SALT', process.env.PAYU_MERCHANT_SALT],
  ['PAYU_MERCHANT_SALT_V2', process.env.PAYU_MERCHANT_SALT_V2],
  ['PAYU_CLIENT_SECRET', process.env.PAYU_CLIENT_SECRET],
  ['GUESTY_OA_CLIENT_SECRET', process.env.GUESTY_OA_CLIENT_SECRET],
  ['GUESTY_BE_CLIENT_SECRET', process.env.GUESTY_BE_CLIENT_SECRET],
  ['WEBFLOW_API_TOKEN', process.env.WEBFLOW_API_TOKEN],
  ['GUESTY_WEBHOOK_TOKEN', process.env.GUESTY_WEBHOOK_TOKEN],
  ['WEBFLOW_WEBHOOK_TOKEN', process.env.WEBFLOW_WEBHOOK_TOKEN],
  ['SYNC_SECRET', process.env.SYNC_SECRET],
].filter(([, v]) => typeof v === 'string' && v.length >= 12);

const SKIP_DIRS = new Set(['node_modules', '.git', '.vercel', 'coverage']);
const SKIP_FILES = new Set(['.env']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(path.join(dir, entry.name), out);
    } else {
      if (SKIP_FILES.has(entry.name)) continue;
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

let failures = 0;

console.log(`Scanning for ${SECRETS.length} live secret value(s)...\n`);

for (const file of walk(ROOT)) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch {
    continue; // binary or unreadable
  }
  for (const [name, value] of SECRETS) {
    if (content.includes(value)) {
      console.error(`  LEAK  ${name} found in ${path.relative(ROOT, file)}`);
      failures += 1;
    }
  }
}

// .env must be git-ignored, if this is a repo at all.
try {
  execSync('git rev-parse --is-inside-work-tree', { cwd: ROOT, stdio: 'ignore' });
  const ignored = execSync('git check-ignore .env || true', { cwd: ROOT }).toString().trim();
  if (ignored !== '.env') {
    console.error('  LEAK  .env is NOT git-ignored');
    failures += 1;
  } else {
    console.log('  OK    .env is git-ignored');
  }
  const tracked = execSync('git ls-files', { cwd: ROOT }).toString().split('\n');
  if (tracked.includes('.env')) {
    console.error('  LEAK  .env is TRACKED by git — rotate every credential immediately');
    failures += 1;
  }
} catch {
  console.log('  note  not a git repository yet; .gitignore is in place for when it is');
}

console.log('');
if (failures) {
  console.error(`FAILED: ${failures} problem(s). Do not commit.`);
  process.exit(1);
}
console.log('PASS: no live secret found outside .env');
