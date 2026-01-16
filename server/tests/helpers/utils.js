/**
 * Test Utilities
 *
 * Shared utilities for integration testing including:
 * - Assertions
 * - HTTP request helpers
 * - Logging with colors
 * - Test state management
 */

import { CONFIG } from './config.js';

// ============================================
// ANSI Colors for Console Output
// ============================================
const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

// ============================================
// Global Test State
// ============================================
const state = {
  passed: 0,
  failed: 0,
  skipped: 0,
  results: [],
  sharedData: {}, // For sharing data between tests (e.g., userId)
};

export function getTestState() {
  return { ...state };
}

export function resetTestState() {
  state.passed = 0;
  state.failed = 0;
  state.skipped = 0;
  state.results = [];
  state.sharedData = {};
}

export function setSharedData(key, value) {
  state.sharedData[key] = value;
}

export function getSharedData(key) {
  return state.sharedData[key];
}

// ============================================
// Logging
// ============================================

/**
 * Log a message with timestamp and color
 * @param {string} msg - Message to log
 * @param {'info'|'success'|'error'|'warn'|'suite'|'test'} type - Log type
 */
export function log(msg, type = 'info') {
  const timestamp = new Date().toISOString().split('T')[1].split('.')[0];

  const colorMap = {
    info: COLORS.reset,
    success: COLORS.green,
    error: COLORS.red,
    warn: COLORS.yellow,
    suite: COLORS.blue + COLORS.bold,
    test: COLORS.cyan,
  };

  const color = colorMap[type] || COLORS.reset;
  console.log(`${COLORS.dim}[${timestamp}]${COLORS.reset} ${color}${msg}${COLORS.reset}`);
}

// ============================================
// Assertions
// ============================================

/**
 * Assert a condition is true
 * @param {boolean} condition - Condition to check
 * @param {string} message - Error message if assertion fails
 */
export function assert(condition, message = 'Assertion failed') {
  if (!condition) {
    throw new Error(message);
  }
}

/**
 * Assert two values are equal
 * @param {*} actual - Actual value
 * @param {*} expected - Expected value
 * @param {string} message - Context message
 */
export function assertEqual(actual, expected, message = '') {
  const prefix = message ? `${message}: ` : '';
  if (actual !== expected) {
    throw new Error(`${prefix}Expected '${expected}', got '${actual}'`);
  }
}

/**
 * Assert value is an array with minimum length
 * @param {*} arr - Value to check
 * @param {number} minLength - Minimum required length
 * @param {string} message - Context message
 */
export function assertArray(arr, minLength = 0, message = '') {
  const prefix = message ? `${message}: ` : '';
  assert(Array.isArray(arr), `${prefix}Expected array, got ${typeof arr}`);
  assert(arr.length >= minLength, `${prefix}Expected length >= ${minLength}, got ${arr.length}`);
}

/**
 * Assert value is a non-empty string
 * @param {*} value - Value to check
 * @param {string} message - Context message
 */
export function assertString(value, message = '') {
  const prefix = message ? `${message}: ` : '';
  assert(typeof value === 'string', `${prefix}Expected string, got ${typeof value}`);
  assert(value.length > 0, `${prefix}Expected non-empty string`);
}

/**
 * Assert object has required properties
 * @param {Object} obj - Object to check
 * @param {string[]} properties - Required property names
 * @param {string} message - Context message
 */
export function assertHasProperties(obj, properties, message = '') {
  const prefix = message ? `${message}: ` : '';
  assert(obj && typeof obj === 'object', `${prefix}Expected object`);

  for (const prop of properties) {
    assert(prop in obj, `${prefix}Missing required property '${prop}'`);
  }
}

/**
 * Assert HTTP response is successful
 * @param {Object} response - Response from apiRequest
 * @param {string} context - Context for error message
 */
export function assertOk(response, context = 'Request') {
  assert(
    response.ok,
    `${context} failed with status ${response.status}: ${response.data?.error || 'Unknown error'}`
  );
}

// ============================================
// Test Runner Helpers
// ============================================

/**
 * Run a single test case with proper error handling and reporting
 * @param {string} suiteName - Name of the test suite
 * @param {string} testName - Name of the test
 * @param {Function} testFn - Async test function
 */
export async function runTest(suiteName, testName, testFn) {
  const fullName = `${suiteName} > ${testName}`;
  process.stdout.write(`  ${COLORS.dim}○${COLORS.reset} ${testName}... `);

  const startTime = Date.now();

  try {
    await testFn();
    const duration = Date.now() - startTime;
    console.log(`${COLORS.green}✓${COLORS.reset} ${COLORS.dim}(${duration}ms)${COLORS.reset}`);
    state.passed++;
    state.results.push({ suite: suiteName, test: testName, status: 'passed', duration });
  } catch (err) {
    const duration = Date.now() - startTime;
    console.log(`${COLORS.red}✗${COLORS.reset}`);
    console.log(`    ${COLORS.red}Error: ${err.message}${COLORS.reset}`);
    state.failed++;
    state.results.push({
      suite: suiteName,
      test: testName,
      status: 'failed',
      duration,
      error: err.message,
    });
  }

  // Rate limiting protection
  if (CONFIG.requestDelay > 0) {
    await sleep(CONFIG.requestDelay);
  }
}

/**
 * Skip a test with reason
 * @param {string} suiteName - Name of the test suite
 * @param {string} testName - Name of the test
 * @param {string} reason - Reason for skipping
 */
export function skipTest(suiteName, testName, reason = '') {
  const reasonText = reason ? ` (${reason})` : '';
  console.log(
    `  ${COLORS.yellow}⊘${COLORS.reset} ${testName}${COLORS.dim}${reasonText}${COLORS.reset}`
  );
  state.skipped++;
  state.results.push({ suite: suiteName, test: testName, status: 'skipped', reason });
}

// ============================================
// HTTP Request Helpers
// ============================================

/**
 * Make an API request to the test server
 * @param {string} path - Request path (e.g., '/api/config')
 * @param {Object} options - Fetch options
 * @returns {Promise<{status: number, ok: boolean, data: Object, headers: Object}>}
 */
export async function apiRequest(path, options = {}) {
  const url = `${CONFIG.baseUrl}${path}`;

  const fetchOptions = {
    method: options.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  if (options.body) {
    fetchOptions.body =
      typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    const data = await response.json().catch(() => ({}));

    return {
      status: response.status,
      ok: response.ok,
      data,
      headers: Object.fromEntries(response.headers.entries()),
    };
  } catch (error) {
    return {
      status: 0,
      ok: false,
      data: { error: error.message },
      headers: {},
    };
  }
}

/**
 * Shorthand for GET request
 * @param {string} path - Request path
 * @param {Object} options - Options object with headers property
 */
export function get(path, options = {}) {
  return apiRequest(path, { method: 'GET', headers: options.headers || options });
}

/**
 * Shorthand for POST request
 * @param {string} path - Request path
 * @param {Object} body - Request body
 * @param {Object} options - Options object with headers property
 */
export function post(path, body, options = {}) {
  return apiRequest(path, { method: 'POST', body, headers: options.headers || options });
}

/**
 * Shorthand for PUT request
 */
export function put(path, body, options = {}) {
  return apiRequest(path, { method: 'PUT', body, headers: options.headers || options });
}

/**
 * Shorthand for DELETE request
 */
export function del(path, options = {}) {
  return apiRequest(path, { method: 'DELETE', headers: options.headers || options });
}

// ============================================
// Utility Functions
// ============================================

/**
 * Sleep for specified milliseconds
 * @param {number} ms - Milliseconds to sleep
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generate a random string for test data
 * @param {number} length - String length
 */
export function randomString(length = 8) {
  return Math.random()
    .toString(36)
    .substring(2, 2 + length);
}

/**
 * Create test catalog data
 * @param {Object} overrides - Override default values
 */
export function createTestCatalog(overrides = {}) {
  return {
    id: `test-catalog-${randomString()}`,
    name: `Test Catalog ${randomString(4)}`,
    type: 'movie',
    enabled: true,
    filters: {
      genres: ['28'], // Action
      sortBy: 'popularity.desc',
      voteCountMin: 100,
    },
    ...overrides,
  };
}

/**
 * Create test config data
 * @param {Object} overrides - Override default values
 */
export function createTestConfig(overrides = {}) {
  return {
    tmdbApiKey: CONFIG.tmdbApiKey,
    catalogs: [createTestCatalog()],
    preferences: {
      language: CONFIG.defaults.language,
    },
    ...overrides,
  };
}
