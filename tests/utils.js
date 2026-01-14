import { CONFIG } from './config.js';

// ANSI colors for console output
const COLORS = {
    reset: '\x1b[0m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    bold: '\x1b[1m'
};

// Global state for test execution
const state = {
    passed: 0,
    failed: 0,
    results: [],
    userId: null // Shared user ID across tests
};

export function getTestState() {
    return state;
}

export function setSharedUserId(id) {
    state.userId = id;
}

export function getSharedUserId() {
    return state.userId;
}

/**
 * Log a message with a timestamp
 */
export function log(msg, type = 'info') {
    const timestamp = new Date().toISOString().split('T')[1].split('.')[0];
    let color = COLORS.reset;
    if (type === 'success') color = COLORS.green;
    if (type === 'error') color = COLORS.red;
    if (type === 'warn') color = COLORS.yellow;
    if (type === 'suite') color = COLORS.blue + COLORS.bold;

    console.log(`${COLORS.reset}[${timestamp}] ${color}${msg}${COLORS.reset}`);
}

/**
 * Assert a condition is true
 */
export function assert(condition, message) {
    if (!condition) {
        throw new Error(message || 'Assertion failed');
    }
}

/**
 * Assert validation of array length
 */
export function assertArray(arr, minLength = 0, message) {
    assert(Array.isArray(arr), `${message}: Expected array`);
    assert(arr.length >= minLength, `${message}: Expected length >= ${minLength}, got ${arr.length}`);
}

/**
 * Run a named test case
 */
export async function runTest(suiteName, testName, testFn) {
    process.stdout.write(`   Running: ${testName}... `);
    try {
        await testFn();
        console.log(`${COLORS.green}PASSED${COLORS.reset}`);
        state.passed++;
        state.results.push({ suite: suiteName, test: testName, status: 'passed' });
    } catch (err) {
        console.log(`${COLORS.red}FAILED${COLORS.reset}`);
        console.error(`     Error: ${err.message}`);
        state.failed++;
        state.results.push({ suite: suiteName, test: testName, status: 'failed', error: err.message });
        // We don't stop execution on valid assertions, only unexpected errors?
        // Actually for E2E, usually we want to see all failures.
    }
    // Rate limit help
    await new Promise(r => setTimeout(r, CONFIG.requestDelay));
}

/**
 * Helper to make API requests
 */
export async function apiRequest(path, method = 'GET', body = null) {
    const url = `${CONFIG.baseUrl}${path}`;
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    const data = await res.json().catch(() => ({}));

    return {
        status: res.status,
        ok: res.ok,
        data
    };
}
