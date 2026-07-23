'use strict';

/**
 * One-off Guesty -> Webflow sync from the command line.
 *
 *   npm run sync                        report only, writes nothing
 *   npm run sync -- --confirm           full sync, creates missing Properties
 *   npm run sync -- --confirm --listing=abc123   a single listing
 *   npm run sync -- --confirm --no-create        update existing items only
 *
 * Dry by default, like every other script here. It used to write unless you
 * passed --dry-run, which is the wrong way round for a command that rewrites
 * every property on a live site — and PowerShell swallows the bare `--`
 * separator, so the flag silently never arrived and a "dry run" wrote for real.
 * Opting IN cannot fail that way.
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
  const write = flag('confirm');

  if (!write) console.log('DRY RUN — nothing will be written. Pass --confirm to apply.\n');

  const report = await sync.syncListings({
    dryRun: !write,
    createMissingProperties: !flag('no-create'),
    onlyListingIds: listing ? [listing] : null,
  });

  console.log(JSON.stringify(report, null, 2));
  if (!write) console.log('\nDRY RUN — nothing was written. Pass --confirm to apply.');
  if (report.errors.length) {
    console.error(`\n${report.errors.length} listing(s) had errors.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
