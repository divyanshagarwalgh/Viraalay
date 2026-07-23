'use strict';

/**
 * One-off Guesty -> Webflow sync from the command line.
 *
 *   npm run sync                      full sync, creates missing Properties
 *   npm run sync -- --dry-run         report only, writes nothing
 *   npm run sync -- --listing=abc123  a single listing
 *   npm run sync -- --no-create       update existing items only
 */

const sync = require('../src/lib/sync');

const args = process.argv.slice(2);
const flag = (name) => args.some((a) => a === `--${name}`);
const value = (name) => {
  const hit = args.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : null;
};

async function main() {
  const listing = value('listing');
  const report = await sync.syncListings({
    dryRun: flag('dry-run'),
    createMissingProperties: !flag('no-create'),
    onlyListingIds: listing ? [listing] : null,
  });

  console.log(JSON.stringify(report, null, 2));
  if (report.errors.length) {
    console.error(`\n${report.errors.length} listing(s) had errors.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
