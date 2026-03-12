/**
 * End-to-end test script for IMDB API integration.
 * Tests local imdb-api (wrangler dev on port 8788) through the addon's service layer.
 *
 * Usage: cd .. && node --experimental-strip-types server/test-imdb-integration.ts
 * (Must run from project root so dotenv picks up .env)
 */

import { search, basicSearch, getSuggestions } from './src/services/imdb/search.ts';
import { isImdbApiEnabled } from './src/services/imdb/index.ts';

const PASS = '\x1b[32m✓\x1b[0m';
const FAIL = '\x1b[31m✗\x1b[0m';
let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ${PASS} ${name}`);
    passed++;
  } catch (err: any) {
    console.log(`  ${FAIL} ${name}`);
    console.log(`    Error: ${err.message}`);
    failed++;
  }
}

function assert(condition: boolean, msg: string) {
  if (!condition) throw new Error(msg);
}

async function main() {
  console.log('\n=== IMDB Integration Tests ===\n');

  // Check config
  console.log('Config check:');
  await test('IMDB API is enabled', async () => {
    assert(isImdbApiEnabled(), 'isImdbApiEnabled() should return true');
  });

  // 1. Basic Search - People (NAME)
  console.log('\n1. Basic Search - People:');
  await test('Search for "Christopher Nolan" returns NAME results', async () => {
    const result = await basicSearch('Christopher Nolan', 'NAME', 5);
    assert(result && result.results, 'Should have results');
    assert(result.results.length > 0, 'Should have at least 1 result');
    const names = result.results.filter((r) => r.type === 'Name');
    assert(names.length > 0, 'Should have Name type results');
    const nolan = names[0] as any;
    assert(nolan.fullName, `Should have fullName, got: ${JSON.stringify(nolan)}`);
    assert(nolan.id.startsWith('nm'), `ID should start with nm, got: ${nolan.id}`);
    console.log(`    → Found: ${nolan.fullName} (${nolan.id})`);
  });

  await test('Search for "Tom Hanks" returns person with image', async () => {
    const result = await basicSearch('Tom Hanks', 'NAME', 3);
    const names = result.results.filter((r) => r.type === 'Name') as any[];
    assert(names.length > 0, 'Should find Tom Hanks');
    console.log(
      `    → Found: ${names[0].fullName}, image: ${names[0].primaryImage?.url ? 'yes' : 'no'}`
    );
  });

  // 2. Basic Search - Companies (COMPANY)
  console.log('\n2. Basic Search - Companies:');
  await test('Search for "Warner" returns COMPANY results', async () => {
    const result = await basicSearch('Warner', 'COMPANY', 5);
    assert(result && result.results, 'Should have results');
    const companies = result.results.filter((r) => r.type === 'Company');
    assert(companies.length > 0, 'Should have Company results');
    const co = companies[0] as any;
    assert(co.name, `Should have name, got: ${JSON.stringify(co)}`);
    assert(co.id.startsWith('co'), `ID should start with co, got: ${co.id}`);
    console.log(`    → Found: ${co.name} (${co.id}), country: ${co.country}`);
  });

  // 3. Advanced Search - Basic query
  console.log('\n3. Advanced Search - Title queries:');
  await test('Search for action movies', async () => {
    const result = await search('action', undefined, 5);
    assert(result && result.titles, 'Should have titles');
    assert(result.titles.length > 0, 'Should have at least 1 title');
    const first = result.titles[0];
    assert(first.id.startsWith('tt'), `Title ID should start with tt, got: ${first.id}`);
    console.log(
      `    → Found ${result.titles.length} titles, first: ${first.primaryTitle} (${first.id})`
    );
  });

  // 4. Advanced Search with filters (via advancedSearch/discover)
  console.log('\n4. Advanced Search - With filters:');
  await test('Search movies with genre filter', async () => {
    const result = await search('', ['movie'], 10);
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Found ${result.titles.length} movie titles`);
  });

  // 5. Suggestions
  console.log('\n5. Suggestions:');
  await test('Get suggestions for "inception"', async () => {
    const result = await getSuggestions('inception');
    assert(result && result.suggestions, 'Should have suggestions');
    assert(result.suggestions.length > 0, 'Should have at least 1 suggestion');
    console.log(
      `    → Got ${result.suggestions.length} suggestions, first: ${result.suggestions[0].title} (${result.suggestions[0].id})`
    );
  });

  // 6. Direct fetch tests for specific filter params
  console.log('\n6. Direct IMDB fetch tests:');

  // Import imdbFetch directly for raw endpoint testing
  const { imdbFetch } = await import('./src/services/imdb/client.ts');

  await test('Advanced search with creditedNames filter', async () => {
    const result = (await imdbFetch(
      '/api/imdb/search/advanced',
      {
        creditedNames: ['nm0634240'], // Christopher Nolan
        types: ['movie'],
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      60
    )) as any;
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Found ${result.titles.length} movies with Christopher Nolan`);
    if (result.titles.length > 0) {
      console.log(`    → First: ${result.titles[0].primaryTitle}`);
    }
  });

  await test('Advanced search with companies filter', async () => {
    const result = (await imdbFetch(
      '/api/imdb/search/advanced',
      {
        companies: ['co0005073'], // Warner Bros
        types: ['movie'],
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      60
    )) as any;
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Found ${result.titles.length} Warner Bros movies`);
    if (result.titles.length > 0) {
      console.log(`    → First: ${result.titles[0].primaryTitle}`);
    }
  });

  await test('Advanced search with plot filter', async () => {
    const result = (await imdbFetch(
      '/api/imdb/search/advanced',
      {
        plot: ['dream'],
        types: ['movie'],
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      60
    )) as any;
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Found ${result.titles.length} movies with "dream" in plot`);
    if (result.titles.length > 0) {
      console.log(`    → First: ${result.titles[0].primaryTitle}`);
    }
  });

  await test('Advanced search with certificates filter', async () => {
    const result = (await imdbFetch(
      '/api/imdb/search/advanced',
      {
        certificates: ['US:PG-13'],
        types: ['movie'],
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      60
    )) as any;
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Found ${result.titles.length} PG-13 movies`);
    if (result.titles.length > 0) {
      console.log(`    → First: ${result.titles[0].primaryTitle}`);
    }
  });

  await test('Advanced search with rankedList filter (TOP_250)', async () => {
    const result = (await imdbFetch(
      '/api/imdb/search/advanced',
      {
        rankedList: 'TOP_250',
        types: ['movie'],
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      60
    )) as any;
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Found ${result.titles.length} titles from Top 250`);
    if (result.titles.length > 0) {
      console.log(`    → First: ${result.titles[0].primaryTitle}`);
    }
  });

  await test('Advanced search with explicitContent filter', async () => {
    const result = (await imdbFetch(
      '/api/imdb/search/advanced',
      {
        explicitContent: 'false',
        types: ['movie'],
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      60
    )) as any;
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Found ${result.titles.length} non-explicit movies`);
  });

  await test('Advanced search with filmingLocations filter', async () => {
    const result = (await imdbFetch(
      '/api/imdb/search/advanced',
      {
        filmingLocations: ['New York'],
        types: ['movie'],
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      60
    )) as any;
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Found ${result.titles.length} movies filmed in New York`);
    if (result.titles.length > 0) {
      console.log(`    → First: ${result.titles[0].primaryTitle}`);
    }
  });

  await test('Advanced search with withData filter', async () => {
    const result = (await imdbFetch(
      '/api/imdb/search/advanced',
      {
        withData: ['TRIVIA', 'SOUNDTRACK'],
        types: ['movie'],
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      60
    )) as any;
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Found ${result.titles.length} movies with trivia & soundtrack data`);
  });

  // 7. Test the discover function through service layer
  console.log('\n7. Discover service layer:');
  const { advancedSearch: discover } = await import('./src/services/imdb/discover.ts');

  await test('Discover with creditedNames + companies filters', async () => {
    const result = await discover(
      {
        types: ['movie'],
        creditedNames: ['nm0634240'],
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      'movie',
      0
    );
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Discover found ${result.titles.length} Nolan movies`);
  });

  await test('Discover with explicitContent=EXCLUDE maps to false', async () => {
    const result = await discover(
      {
        types: ['movie'],
        explicitContent: 'EXCLUDE',
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      'movie',
      0
    );
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Discover found ${result.titles.length} non-explicit movies`);
  });

  await test('Discover with plot string converts to array', async () => {
    const result = await discover(
      {
        types: ['movie'],
        plot: 'space',
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      'movie',
      0
    );
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Discover found ${result.titles.length} movies with "space" in plot`);
  });

  await test('Discover with filmingLocations string converts to array', async () => {
    const result = await discover(
      {
        types: ['movie'],
        filmingLocations: 'London',
        limit: 5,
        sortBy: 'POPULARITY',
        sortOrder: 'DESC',
      },
      'movie',
      0
    );
    assert(result && result.titles, 'Should have titles');
    console.log(`    → Discover found ${result.titles.length} movies filmed in London`);
  });

  // Summary
  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
