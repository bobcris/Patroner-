/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Portable test runner for Patroner.
 * Discovers all *.test.ts files recursively under src/ without relying on shell glob expansion.
 * Works uniformly across Termux/Android, Linux, macOS, and Windows.
 */
function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist' && !entry.name.startsWith('.')) {
        results.push(...findTestFiles(fullPath));
      }
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      results.push(fullPath);
    }
  }
  return results;
}

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const testFiles = findTestFiles(srcDir);

if (testFiles.length === 0) {
  console.error('No test files found under src/');
  process.exit(1);
}

console.log(`Discovered ${testFiles.length} test files:`);
testFiles.forEach(f => console.log(`  - ${path.relative(rootDir, f)}`));

const testStream = run({
  files: testFiles
});

testStream.compose(new spec()).pipe(process.stdout);

testStream.on('test:fail', () => {
  process.exitCode = 1;
});
