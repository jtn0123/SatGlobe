#!/usr/bin/env npx tsx

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { performancePolicySchema } from './performance-contract';

const DIST_DIRECTORY = path.resolve('dist');

/** Returns the recursive byte size of one build output path. */
export async function sizeOf(target: string): Promise<number> {
  const metadata = await stat(target);

  if (metadata.isFile()) {
    return metadata.size;
  }
  const children = await readdir(target);

  return (await Promise.all(children.map((child) => sizeOf(path.join(target, child))))).reduce((sum, size) => sum + size, 0);
}

/** Returns all files below a build-output path. */
async function filesUnder(target: string): Promise<string[]> {
  const metadata = await stat(target);

  if (metadata.isFile()) {
    return [target];
  }
  const children = await readdir(target);

  return (await Promise.all(children.map((child) => filesUnder(path.join(target, child))))).flat();
}

/** Converts byte counts to a stable human-readable value. */
function mib(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1);
}

const policy = performancePolicySchema.parse(JSON.parse(await readFile('docs/performance/policy.json', 'utf8')) as unknown);
const allFiles = await filesUnder(DIST_DIRECTORY);
const totalBytes = (await Promise.all(allFiles.map(async (filePath) => (await stat(filePath)).size)))
  .reduce((sum, bytes) => sum + bytes, 0);
const javascriptFiles = allFiles.filter((filePath) => filePath.endsWith('.js'));
const javascriptAssets = await Promise.all(javascriptFiles.map(async (filePath) => ({
  filePath,
  bytes: (await stat(filePath)).size,
})));
const javascriptBytes = javascriptAssets.reduce((sum, { bytes }) => sum + bytes, 0);
const oversizedJavaScript = javascriptAssets
  .filter(({ bytes }) => bytes > policy.absoluteBudgets.maximumJavaScriptAssetBytes)
  .sort((left, right) => right.bytes - left.bytes);
const failures: string[] = [];

if (totalBytes > policy.absoluteBudgets.maximumDistBytes) {
  failures.push(`dist is ${mib(totalBytes)} MiB; budget is ${mib(policy.absoluteBudgets.maximumDistBytes)} MiB`);
}
if (javascriptBytes > policy.absoluteBudgets.maximumJavaScriptBytes) {
  failures.push(`JavaScript payload is ${mib(javascriptBytes)} MiB; budget is ${mib(policy.absoluteBudgets.maximumJavaScriptBytes)} MiB`);
}
for (const { filePath, bytes } of oversizedJavaScript) {
  failures.push(`${path.relative(DIST_DIRECTORY, filePath)} is ${mib(bytes)} MiB; per-JavaScript-asset budget is ${mib(policy.absoluteBudgets.maximumJavaScriptAssetBytes)} MiB`);
}
if (failures.length > 0) {
  throw new Error(`SatGlobe build budget failed:\n- ${failures.join('\n- ')}`);
}

process.stdout.write(`SatGlobe build budget passed: ${mib(totalBytes)} MiB dist, ${mib(javascriptBytes)} MiB JavaScript, ${javascriptAssets.length} JavaScript assets.\n`);
