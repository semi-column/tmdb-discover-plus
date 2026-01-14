import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { log, getTestState } from './utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUITES_DIR = path.join(__dirname, 'suites');

async function main() {
    log('=== TMDB Discover+ Comprehensive Test Suite ===', 'suite');

    // Get all test files in suites/ directory
    const files = fs.readdirSync(SUITES_DIR)
        .filter(f => f.endsWith('.js'))
        .sort(); // Run in alphabetical order (01_..., 02_...)

    log(`Found ${files.length} test suites.`, 'info');

    for (const file of files) {
        log(`\nExecuting Suite: ${file}`, 'suite');
        const suitePath = `file://${path.join(SUITES_DIR, file).replace(/\\/g, '/')}`;
        try {
            const suiteModule = await import(suitePath);
            if (suiteModule.run) {
                await suiteModule.run();
            } else {
                log(`Suite ${file} does not export a run() function. Skipping.`, 'warn');
            }
        } catch (err) {
            log(`Error executing suite ${file}: ${err.message}`, 'error');
            console.error(err);
        }
    }

    const state = getTestState();
    log('\n=== Test Execution Summary ===', 'suite');
    log(`Total: ${state.passed + state.failed}`);
    log(`Passed: ${state.passed}`, 'success');

    if (state.failed > 0) {
        log(`Failed: ${state.failed}`, 'error');
        process.exit(1);
    } else {
        process.exit(0);
    }
}

main().catch(err => {
    console.error('Fatal Test Runner Error:', err);
    process.exit(1);
});
