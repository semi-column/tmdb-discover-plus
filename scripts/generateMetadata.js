/**
 * Generate build metadata for the application
 * This script is run during CI/CD to embed version info into the build
 *
 * Usage:
 *   node scripts/generateMetadata.js              # Stable build
 *   node scripts/generateMetadata.js --channel=nightly  # Nightly build
 */

import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Parse command line arguments
const channel = process.argv.find((arg) => arg.startsWith('--channel='));
const isNightly = channel === '--channel=nightly';

// Get version from package.json
const packageJsonPath = resolve(__dirname, '../package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
const { version, description } = packageJson;

// Determine tag based on channel
let tag;
if (isNightly) {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  const hours = String(now.getUTCHours()).padStart(2, '0');
  const minutes = String(now.getUTCMinutes()).padStart(2, '0');
  tag = `${year}.${month}.${day}.${hours}${minutes}-nightly`;
} else {
  try {
    // Try to get the latest tag
    tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
  } catch {
    // Fall back to version from package.json
    tag = `v${version}`;
  }
}

// Get git commit info
let commitHash = 'unknown';
let commitTime = new Date().toISOString();

try {
  commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  const commitTimeRaw = execSync('git log -1 --format=%cd --date=iso', { encoding: 'utf8' }).trim();
  commitTime = new Date(commitTimeRaw).toISOString();
} catch (error) {
  console.warn('Could not get git info, using defaults');
}

// Create metadata object
const metadata = {
  version,
  description,
  tag,
  channel: isNightly ? 'nightly' : 'stable',
  commitHash,
  buildTime: new Date().toISOString(),
  commitTime,
};

// Write to server directory
const outputPath = resolve(__dirname, '../server/src/metadata.json');
const outputDir = dirname(outputPath);

try {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, JSON.stringify(metadata, null, 2), 'utf8');
  console.log('Build metadata generated successfully:');
  console.log(JSON.stringify(metadata, null, 2));
} catch (error) {
  console.error('Failed to write metadata file:', error);
  process.exit(1);
}
