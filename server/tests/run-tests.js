/**
 * Test Runner - Manages server lifecycle and runs tests
 * 
 * This script:
 * 1. Starts the server as a child process
 * 2. Waits for it to be ready
 * 3. Runs the integration tests
 * 4. Cleans up the server
 * 
 * Usage: node tests/run-tests.js
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import http from 'http';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverPath = path.join(__dirname, '..', 'src', 'index.js');
const testPath = path.join(__dirname, 'stremio-client.test.js');

const PORT = process.env.PORT || 7000;
const MAX_WAIT_TIME = 30000; // 30 seconds

// ============================================
// Helper: Wait for server to be ready
// ============================================
async function waitForServer(port, maxWait = MAX_WAIT_TIME) {
  const start = Date.now();
  
  while (Date.now() - start < maxWait) {
    try {
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: 'localhost',
          port,
          path: '/health',
          method: 'GET',
          timeout: 2000,
        }, (res) => {
          if (res.statusCode === 200) {
            resolve();
          } else {
            reject(new Error(`Health check returned ${res.statusCode}`));
          }
        });
        
        req.on('error', reject);
        req.on('timeout', () => reject(new Error('Timeout')));
        req.end();
      });
      
      return true;
    } catch (e) {
      // Server not ready yet, wait and retry
      await new Promise(r => setTimeout(r, 500));
    }
  }
  
  return false;
}

// ============================================
// Main
// ============================================
async function main() {
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║               Test Runner - Server + Tests                      ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Integration tests require a real TMDB API key. If not provided, skip instead of failing.
  if (!process.env.TMDB_API_KEY) {
    console.warn('⚠️  TMDB_API_KEY not set; skipping integration tests');
    console.warn('   To run them: $env:TMDB_API_KEY="your-api-key"');
    process.exit(0);
  }

  // If the integration test file is not present (some deployments intentionally remove tests), skip.
  if (!fs.existsSync(testPath)) {
    console.warn(`⚠️  Integration test file not found: ${testPath}`);
    console.warn('   Skipping tests. If you want to run them, restore server/tests/stremio-client.test.js');
    process.exit(0);
  }

  let server = null;
  let exitCode = 0;

  try {
    // Start the server
    console.log('🚀 Starting server...');
    
    server = spawn('node', [serverPath], {
      env: {
        ...process.env,
        PORT: String(PORT),
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        DISABLE_TLS_VERIFY: 'true',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Log server output (optional, for debugging)
    server.stdout.on('data', (data) => {
      const lines = data.toString().trim().split('\n');
      for (const line of lines) {
        if (line.includes('[ERROR]')) {
          console.log(`   [SERVER] ${line}`);
        }
      }
    });

    server.stderr.on('data', (data) => {
      console.error(`   [SERVER ERROR] ${data}`);
    });

    server.on('error', (err) => {
      console.error(`❌ Failed to start server: ${err.message}`);
      process.exit(1);
    });

    // Wait for server to be ready
    console.log(`⏳ Waiting for server on port ${PORT}...`);
    const ready = await waitForServer(PORT);
    
    if (!ready) {
      throw new Error('Server did not start in time');
    }
    
    console.log('✅ Server is ready\n');

    // Run the tests
    console.log('🧪 Running integration tests...\n');
    
    const testProcess = spawn('node', [testPath], {
      env: {
        ...process.env,
        TEST_BASE_URL: `http://localhost:${PORT}`,
        NODE_TLS_REJECT_UNAUTHORIZED: '0',
        DISABLE_TLS_VERIFY: 'true',
      },
      stdio: 'inherit', // Pass through stdout/stderr
    });

    // Wait for tests to complete
    exitCode = await new Promise((resolve) => {
      testProcess.on('close', (code) => {
        resolve(code || 0);
      });
    });

  } catch (error) {
    console.error(`\n💥 Error: ${error.message}`);
    exitCode = 1;
  } finally {
    // Cleanup: Kill the server
    if (server) {
      console.log('\n🧹 Stopping server...');
      server.kill('SIGTERM');
      
      // Give it a moment to shut down gracefully
      await new Promise(r => setTimeout(r, 1000));
      
      // Force kill if still running
      if (!server.killed) {
        server.kill('SIGKILL');
      }
      
      console.log('✅ Server stopped');
    }
  }

  process.exit(exitCode);
}

main();
