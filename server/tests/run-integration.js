/**
 * Integration Test Runner
 *
 * This is the main entry point for running all integration tests.
 * It handles:
 * - Server lifecycle management (start, health check, stop)
 * - Test discovery and execution
 * - Result aggregation and reporting
 *
 * Usage:
 *   node tests/run-integration.js   # Start server and run tests
 *   SKIP_SERVER=1 node tests/run-integration.js  # Run against existing server
 *
 * Environment variables:
 *   TMDB_API_KEY - Required for most tests
 *   PORT - Server port (default: 7000)
 *   TEST_BASE_URL - Override server URL
 *   SKIP_SERVER - Set to skip server management
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import http from 'http';
import { config as dotenvConfig } from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load .env from server directory
dotenvConfig({ path: path.join(__dirname, '..', '.env') });

const SERVER_PATH = path.join(__dirname, '..', 'src', 'index.ts');
const INTEGRATION_DIR = path.join(__dirname, 'integration');

const PORT = parseInt(process.env.PORT, 10) || 7000;
const MAX_WAIT_TIME = 30000; // 30 seconds
const SKIP_SERVER = process.env.SKIP_SERVER === '1' || process.env.SKIP_SERVER === 'true';

// ANSI colors
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

// ============================================
// Server Health Check
// ============================================

async function waitForServer(port, maxWait = MAX_WAIT_TIME) {
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request(
          {
            hostname: '127.0.0.1',
            port,
            path: '/health',
            method: 'GET',
            timeout: 2000,
          },
          (res) => {
            if (res.statusCode === 200) {
              resolve();
            } else {
              reject(new Error(`Health check returned ${res.statusCode}`));
            }
          }
        );

        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Timeout')));
        req.end();
      });

      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  return false;
}

// ============================================
// Test Discovery
// ============================================

function discoverTests() {
  if (!fs.existsSync(INTEGRATION_DIR)) {
    console.error(
      `${COLORS.red}Integration test directory not found: ${INTEGRATION_DIR}${COLORS.reset}`
    );
    return [];
  }

  const files = fs
    .readdirSync(INTEGRATION_DIR)
    .filter((f) => f.endsWith('.test.js'))
    .sort(); // Alphabetical order for predictable execution

  return files.map((f) => ({
    name: f.replace('.test.js', ''),
    path: path.join(INTEGRATION_DIR, f),
  }));
}

// ============================================
// Test Execution
// ============================================

async function runTests(tests) {
  // Import utils to access test state
  const { getTestState, resetTestState } = await import('./helpers/utils.js');

  resetTestState();

  for (const test of tests) {
    console.log(`\n${COLORS.blue}${COLORS.bold}━━━ ${test.name} ━━━${COLORS.reset}`);

    try {
      const modulePath = `file://${test.path.replace(/\\/g, '/')}`;
      const testModule = await import(modulePath);

      if (typeof testModule.run === 'function') {
        await testModule.run();
      } else {
        console.log(`${COLORS.yellow}  ⚠ No run() function exported${COLORS.reset}`);
      }
    } catch (error) {
      console.error(`${COLORS.red}  ✗ Suite error: ${error.message}${COLORS.reset}`);
      console.error(`    ${error.stack?.split('\n').slice(1, 3).join('\n    ')}`);
    }
  }

  return getTestState();
}

// ============================================
// Main
// ============================================

async function main() {
  console.log(`
${COLORS.cyan}${COLORS.bold}╔══════════════════════════════════════════════════════════════════╗
║           TMDB Discover+ Integration Test Suite                  ║
╚══════════════════════════════════════════════════════════════════╝${COLORS.reset}
`);

  // Check for TMDB API key
  const apiKey = process.env.TMDB_API_KEY || process.env.TEST_TMDB_API_KEY;
  if (!apiKey) {
    console.log(
      `${COLORS.yellow}⚠ TMDB_API_KEY not set - some tests will be skipped${COLORS.reset}`
    );
    console.log(`  Set via: $env:TMDB_API_KEY="your-key" (PowerShell)`);
    console.log(`       or: export TMDB_API_KEY=your-key (Bash)\n`);
  }

  // Discover tests
  const tests = discoverTests();

  if (tests.length === 0) {
    console.error(`${COLORS.red}No tests found in ${INTEGRATION_DIR}${COLORS.reset}`);
    process.exit(1);
  }

  console.log(
    `${COLORS.dim}Found ${tests.length} test suites: ${tests.map((t) => t.name).join(', ')}${COLORS.reset}\n`
  );

  let server = null;
  let exitCode = 0;

  try {
    // Start server unless skipped
    if (!SKIP_SERVER) {
      console.log(`${COLORS.cyan}▸ Starting server on port ${PORT}...${COLORS.reset}`);

      server = spawn('node', [SERVER_PATH], {
        env: {
          ...process.env,
          PORT: String(PORT),
          NODE_ENV: 'test',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      // Capture server errors
      server.stderr.on('data', (data) => {
        const msg = data.toString().trim();
        if (msg.includes('[ERROR]') || msg.includes('Error')) {
          console.error(`  ${COLORS.dim}[server]${COLORS.reset} ${msg}`);
        }
      });

      server.on('error', (err) => {
        console.error(`${COLORS.red}Failed to start server: ${err.message}${COLORS.reset}`);
        process.exit(1);
      });

      // Wait for server to be ready
      console.log(`${COLORS.dim}  Waiting for /health endpoint...${COLORS.reset}`);
      const ready = await waitForServer(PORT);

      if (!ready) {
        throw new Error('Server did not become ready in time');
      }

      console.log(`${COLORS.green}✓ Server ready${COLORS.reset}\n`);
    } else {
      console.log(
        `${COLORS.yellow}⚠ SKIP_SERVER set - using existing server at port ${PORT}${COLORS.reset}\n`
      );

      // Verify existing server
      const ready = await waitForServer(PORT, 5000);
      if (!ready) {
        throw new Error(`No server responding on port ${PORT}`);
      }
    }

    // Run tests
    const state = await runTests(tests);

    // Print summary
    console.log(`
${COLORS.cyan}${COLORS.bold}════════════════════════════════════════════════════════════════════${COLORS.reset}
                           TEST RESULTS
${COLORS.cyan}════════════════════════════════════════════════════════════════════${COLORS.reset}

  ${COLORS.green}Passed:${COLORS.reset}  ${state.passed}
  ${COLORS.red}Failed:${COLORS.reset}  ${state.failed}
  ${COLORS.yellow}Skipped:${COLORS.reset} ${state.skipped}
  ${COLORS.dim}Total:${COLORS.reset}   ${state.passed + state.failed + state.skipped}

${COLORS.cyan}════════════════════════════════════════════════════════════════════${COLORS.reset}
`);

    if (state.failed > 0) {
      console.log(`${COLORS.red}${COLORS.bold}✗ ${state.failed} test(s) failed${COLORS.reset}\n`);

      // Show failed tests
      const failed = state.results.filter((r) => r.status === 'failed');
      for (const f of failed) {
        console.log(`  ${COLORS.red}• ${f.suite} > ${f.test}${COLORS.reset}`);
        console.log(`    ${COLORS.dim}${f.error}${COLORS.reset}`);
      }
      console.log();

      exitCode = 1;
    } else {
      console.log(`${COLORS.green}${COLORS.bold}✓ All tests passed!${COLORS.reset}\n`);
    }
  } catch (error) {
    console.error(`\n${COLORS.red}${COLORS.bold}💥 Fatal error: ${error.message}${COLORS.reset}`);
    console.error(error.stack);
    exitCode = 1;
  } finally {
    // Cleanup: delete test artifacts
    try {
      const { cleanupTestArtifacts } = await import('./helpers/utils.js');
      await cleanupTestArtifacts();
    } catch (cleanupError) {
      console.error(`${COLORS.yellow}⚠ Cleanup error: ${cleanupError.message}${COLORS.reset}`);
    }

    // Cleanup: stop server
    if (server) {
      console.log(`${COLORS.dim}Stopping server...${COLORS.reset}`);
      server.kill('SIGTERM');

      await new Promise((r) => setTimeout(r, 1000));

      if (!server.killed) {
        server.kill('SIGKILL');
      }
    }
  }

  process.exit(exitCode);
}

main();
