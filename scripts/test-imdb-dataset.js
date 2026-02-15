#!/usr/bin/env node

/**
 * IMDB Dataset Feasibility Test
 *
 * Downloads title.basics.tsv.gz + title.ratings.tsv.gz from the official
 * IMDB bulk dataset, joins them in memory, builds sorted indexes by
 * genre/type/year, and reports performance & accuracy metrics.
 *
 * Usage:  node scripts/test-imdb-dataset.js [--min-votes=100]
 *
 * This is a standalone test — no server dependencies needed.
 */

import { createGunzip } from 'zlib';
import { createInterface } from 'readline';
import { Readable } from 'stream';

const BASICS_URL = 'https://datasets.imdbws.com/title.basics.tsv.gz';
const RATINGS_URL = 'https://datasets.imdbws.com/title.ratings.tsv.gz';
const DOWNLOAD_TIMEOUT_MS = 180_000;

const MIN_VOTES = parseInt(
  process.argv.find((a) => a.startsWith('--min-votes='))?.split('=')[1] ?? '100',
  10
);

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return n.toLocaleString();
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

function heapUsed() {
  return process.memoryUsage().heapUsed;
}

function elapsed(start) {
  return ((performance.now() - start) / 1000).toFixed(2) + 's';
}

async function streamTsv(url, label) {
  console.log(`\n📥 Downloading ${label}...`);
  const t0 = performance.now();

  const resp = await fetch(url, {
    headers: { 'User-Agent': 'TMDB-Discover-Plus/dataset-test' },
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });

  if (!resp.ok) throw new Error(`${label}: HTTP ${resp.status}`);

  const gunzip = createGunzip();
  const nodeStream = Readable.fromWeb(resp.body);
  const rl = createInterface({ input: nodeStream.pipe(gunzip), crlfDelay: Infinity });

  let header = null;
  const rows = [];

  for await (const line of rl) {
    if (!header) {
      header = line.split('\t');
      continue;
    }
    rows.push(line);
  }

  console.log(`   Downloaded & parsed ${fmt(rows.length)} rows in ${elapsed(t0)}`);
  return { header, rows };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(70));
  console.log('  IMDB Dataset Feasibility Test');
  console.log(`  MIN_VOTES threshold: ${MIN_VOTES}`);
  console.log('='.repeat(70));

  const heapBefore = heapUsed();

  // ── Step 1: Download both datasets ───────────────────────────────────────

  const [ratingsData, basicsData] = await Promise.all([
    streamTsv(RATINGS_URL, 'title.ratings.tsv.gz'),
    streamTsv(BASICS_URL, 'title.basics.tsv.gz'),
  ]);

  const heapAfterDownload = heapUsed();
  console.log(
    `\n💾 Heap after download: ${mb(heapAfterDownload)} (+${mb(heapAfterDownload - heapBefore)} from raw rows)`
  );

  // ── Step 2: Parse ratings into a Map ─────────────────────────────────────

  console.log('\n⚙️  Parsing ratings...');
  const t1 = performance.now();

  /** @type {Map<string, {rating: number, votes: number}>} */
  const ratingsMap = new Map();
  let ratingsFiltered = 0;

  for (const line of ratingsData.rows) {
    const firstTab = line.indexOf('\t');
    const secondTab = line.indexOf('\t', firstTab + 1);
    if (firstTab === -1 || secondTab === -1) continue;

    const id = line.slice(0, firstTab);
    const rating = parseFloat(line.slice(firstTab + 1, secondTab));
    const votes = parseInt(line.slice(secondTab + 1), 10);

    if (Number.isNaN(rating) || Number.isNaN(votes)) continue;

    if (votes < MIN_VOTES) {
      ratingsFiltered++;
      continue;
    }

    ratingsMap.set(id, { rating, votes });
  }

  // Free raw rows
  ratingsData.rows.length = 0;

  console.log(
    `   ${fmt(ratingsMap.size)} ratings kept, ${fmt(ratingsFiltered)} filtered (< ${MIN_VOTES} votes)`
  );
  console.log(`   Parsed in ${elapsed(t1)}`);

  // ── Step 3: Parse basics & join with ratings ─────────────────────────────

  console.log('\n⚙️  Parsing basics & joining with ratings...');
  const t2 = performance.now();

  /**
   * @typedef {{
   *   id: string,
   *   type: string,
   *   title: string,
   *   year: number,
   *   endYear: number | null,
   *   runtime: number,
   *   genres: string[],
   *   isAdult: boolean,
   *   rating: number,
   *   votes: number,
   * }} JoinedTitle
   */

  /** @type {JoinedTitle[]} */
  const titles = [];

  // Type mapping from IMDB to Stremio-friendly types
  const TYPE_MAP = {
    movie: 'movie',
    tvMovie: 'movie',
    tvSpecial: 'movie',
    short: 'short',
    tvShort: 'short',
    tvSeries: 'series',
    tvMiniSeries: 'series',
    videoGame: 'game',
    video: 'movie',
  };

  const typeCounts = {};
  let joinHits = 0;
  let joinMisses = 0;
  let basicsParseErrors = 0;

  // basics columns: tconst titleType primaryTitle originalTitle isAdult startYear endYear runtimeMinutes genres
  for (const line of basicsData.rows) {
    const cols = line.split('\t');
    if (cols.length < 9) {
      basicsParseErrors++;
      continue;
    }

    const [
      id,
      titleType,
      primaryTitle,
      ,
      isAdultStr,
      startYearStr,
      endYearStr,
      runtimeStr,
      genresStr,
    ] = cols;

    const ratingData = ratingsMap.get(id);
    if (!ratingData) {
      joinMisses++;
      continue;
    }
    joinHits++;

    const mappedType = TYPE_MAP[titleType];
    if (!mappedType) {
      typeCounts[titleType] = (typeCounts[titleType] || 0) + 1;
      continue; // Skip types we don't care about (tvEpisode, etc.)
    }
    typeCounts[titleType] = (typeCounts[titleType] || 0) + 1;

    const year = parseInt(startYearStr, 10);
    if (Number.isNaN(year)) continue;

    const endYear = endYearStr !== '\\N' ? parseInt(endYearStr, 10) : null;
    const runtime = runtimeStr !== '\\N' ? parseInt(runtimeStr, 10) : 0;
    const genres = genresStr !== '\\N' ? genresStr.split(',') : [];
    const isAdult = isAdultStr === '1';

    titles.push({
      id,
      type: mappedType,
      title: primaryTitle,
      year,
      endYear: Number.isNaN(endYear) ? null : endYear,
      runtime,
      genres,
      isAdult,
      rating: ratingData.rating,
      votes: ratingData.votes,
    });
  }

  // Free raw rows
  basicsData.rows.length = 0;

  console.log(`   ${fmt(titles.length)} titles joined in ${elapsed(t2)}`);
  console.log(
    `   Join hits: ${fmt(joinHits)}, misses (no rating): ${fmt(joinMisses)}, parse errors: ${basicsParseErrors}`
  );

  const heapAfterJoin = heapUsed();
  console.log(
    `   Heap: ${mb(heapAfterJoin)} (+${mb(heapAfterJoin - heapAfterDownload)} for joined data)`
  );

  // ── Step 4: Breakdown by type ────────────────────────────────────────────

  console.log('\n📊 Title type breakdown (from basics, with ratings):');
  const sortedTypes = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  for (const [type, count] of sortedTypes) {
    const mapped = TYPE_MAP[type] || '(skipped)';
    console.log(`   ${type.padEnd(16)} → ${mapped.padEnd(8)} : ${fmt(count)}`);
  }

  // ── Step 5: Build sorted indexes ────────────────────────────────────────

  console.log('\n⚙️  Building sorted indexes...');
  const t3 = performance.now();

  const movies = titles.filter((t) => t.type === 'movie' && !t.isAdult);
  const series = titles.filter((t) => t.type === 'series' && !t.isAdult);

  // Sort by rating desc, then votes desc as tiebreaker
  const sortByRating = (a, b) => b.rating - a.rating || b.votes - a.votes;

  movies.sort(sortByRating);
  series.sort(sortByRating);

  // Genre indexes
  const moviesByGenre = new Map();
  const seriesByGenre = new Map();

  for (const m of movies) {
    for (const g of m.genres) {
      if (!moviesByGenre.has(g)) moviesByGenre.set(g, []);
      moviesByGenre.get(g).push(m);
    }
  }

  for (const s of series) {
    for (const g of s.genres) {
      if (!seriesByGenre.has(g)) seriesByGenre.set(g, []);
      seriesByGenre.get(g).push(s);
    }
  }

  // Decade indexes
  const moviesByDecade = new Map();
  for (const m of movies) {
    const decade = Math.floor(m.year / 10) * 10;
    if (!moviesByDecade.has(decade)) moviesByDecade.set(decade, []);
    moviesByDecade.get(decade).push(m);
  }

  console.log(`   Indexes built in ${elapsed(t3)}`);

  const heapAfterIndex = heapUsed();
  console.log(
    `   Heap: ${mb(heapAfterIndex)} (+${mb(heapAfterIndex - heapAfterJoin)} for indexes)`
  );

  // ── Step 6: Sample queries ───────────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('  SAMPLE CATALOG QUERIES');
  console.log('='.repeat(70));

  // 6a: Top 20 movies overall
  console.log('\n🏆 Top 20 Movies (all time):');
  for (const m of movies.slice(0, 20)) {
    console.log(
      `   ${m.rating.toFixed(1)} (${fmt(m.votes)} votes) | ${m.title} (${m.year}) [${m.genres.join(', ')}]`
    );
  }

  // 6b: Top 20 series overall
  console.log('\n🏆 Top 20 Series (all time):');
  for (const s of series.slice(0, 20)) {
    console.log(
      `   ${s.rating.toFixed(1)} (${fmt(s.votes)} votes) | ${s.title} (${s.year}) [${s.genres.join(', ')}]`
    );
  }

  // 6c: Top 10 Sci-Fi movies
  const scifiMovies = moviesByGenre.get('Sci-Fi') || [];
  console.log(`\n🚀 Top 10 Sci-Fi Movies (${fmt(scifiMovies.length)} total):`);
  for (const m of scifiMovies.slice(0, 10)) {
    console.log(`   ${m.rating.toFixed(1)} (${fmt(m.votes)} votes) | ${m.title} (${m.year})`);
  }

  // 6d: Top 10 Drama series
  const dramaSeries = seriesByGenre.get('Drama') || [];
  console.log(`\n🎭 Top 10 Drama Series (${fmt(dramaSeries.length)} total):`);
  for (const s of dramaSeries.slice(0, 10)) {
    console.log(`   ${s.rating.toFixed(1)} (${fmt(s.votes)} votes) | ${s.title} (${s.year})`);
  }

  // 6e: Top 10 Horror movies
  const horrorMovies = moviesByGenre.get('Horror') || [];
  console.log(`\n👻 Top 10 Horror Movies (${fmt(horrorMovies.length)} total):`);
  for (const m of horrorMovies.slice(0, 10)) {
    console.log(`   ${m.rating.toFixed(1)} (${fmt(m.votes)} votes) | ${m.title} (${m.year})`);
  }

  // 6f: Top 10 movies from the 2020s
  const movies2020s = moviesByDecade.get(2020) || [];
  console.log(`\n🆕 Top 10 Movies of the 2020s (${fmt(movies2020s.length)} total):`);
  for (const m of movies2020s.slice(0, 10)) {
    console.log(`   ${m.rating.toFixed(1)} (${fmt(m.votes)} votes) | ${m.title} (${m.year})`);
  }

  // 6g: Top 10 Animation movies
  const animMovies = moviesByGenre.get('Animation') || [];
  console.log(`\n🧸 Top 10 Animation Movies (${fmt(animMovies.length)} total):`);
  for (const m of animMovies.slice(0, 10)) {
    console.log(`   ${m.rating.toFixed(1)} (${fmt(m.votes)} votes) | ${m.title} (${m.year})`);
  }

  // ── Step 7: Query performance test ───────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('  QUERY PERFORMANCE');
  console.log('='.repeat(70));

  // Test: paginated catalog (simulating Stremio catalog with skip/limit)
  const PAGE_SIZE = 20;
  const pages = [0, 1, 2, 5, 10, 50, 100];

  console.log('\n⏱️  Paginated catalog query (Sci-Fi movies, 20/page):');
  for (const page of pages) {
    const skip = page * PAGE_SIZE;
    if (skip >= scifiMovies.length) break;
    const t = performance.now();
    // Simulate: slice + map to Stremio meta
    const items = scifiMovies.slice(skip, skip + PAGE_SIZE).map((m) => ({
      id: m.id,
      type: 'movie',
      name: m.title,
      imdbRating: m.rating.toFixed(1),
      year: m.year,
      genres: m.genres,
    }));
    const dur = (performance.now() - t).toFixed(3);
    console.log(
      `   Page ${String(page).padStart(3)} (skip=${String(skip).padStart(5)}) → ${items.length} items in ${dur}ms`
    );
  }

  // Test: genre filter + year range (complex query)
  console.log('\n⏱️  Complex query: Action movies from 2010-2019, rating >= 7.0:');
  const tc = performance.now();
  const actionMovies = moviesByGenre.get('Action') || [];
  const filtered = actionMovies.filter((m) => m.year >= 2010 && m.year <= 2019 && m.rating >= 7.0);
  const dur = (performance.now() - tc).toFixed(3);
  console.log(`   Found ${fmt(filtered.length)} results in ${dur}ms`);
  console.log('   Top 5:');
  for (const m of filtered.slice(0, 5)) {
    console.log(`     ${m.rating.toFixed(1)} | ${m.title} (${m.year})`);
  }

  // Test: minimum vote filter impact
  console.log('\n⏱️  Vote threshold analysis on top-rated movies:');
  const thresholds = [100, 500, 1000, 5000, 10000, 50000, 100000];
  for (const threshold of thresholds) {
    const above = movies.filter((m) => m.votes >= threshold);
    const top = above[0];
    console.log(
      `   Votes >= ${String(threshold).padStart(7)} → ${fmt(above.length).padStart(7)} movies | Top: ${top ? `${top.rating.toFixed(1)} - ${top.title} (${top.year})` : 'none'}`
    );
  }

  // ── Step 8: Genre distribution ───────────────────────────────────────────

  console.log('\n' + '='.repeat(70));
  console.log('  GENRE DISTRIBUTION');
  console.log('='.repeat(70));

  console.log('\n🎬 Movies by genre:');
  const movieGenres = [...moviesByGenre.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [genre, items] of movieGenres) {
    const avgRating = (items.reduce((sum, m) => sum + m.rating, 0) / items.length).toFixed(2);
    console.log(
      `   ${genre.padEnd(14)} : ${fmt(items.length).padStart(7)} titles | avg rating: ${avgRating}`
    );
  }

  console.log('\n📺 Series by genre:');
  const seriesGenres = [...seriesByGenre.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [genre, items] of seriesGenres) {
    const avgRating = (items.reduce((sum, m) => sum + m.rating, 0) / items.length).toFixed(2);
    console.log(
      `   ${genre.padEnd(14)} : ${fmt(items.length).padStart(7)} titles | avg rating: ${avgRating}`
    );
  }

  // ── Step 9: Decade distribution ──────────────────────────────────────────

  console.log('\n📅 Movies by decade:');
  const decades = [...moviesByDecade.entries()].sort((a, b) => b[0] - a[0]);
  for (const [decade, items] of decades) {
    if (items.length < 10) continue;
    const avgRating = (items.reduce((sum, m) => sum + m.rating, 0) / items.length).toFixed(2);
    console.log(
      `   ${decade}s : ${fmt(items.length).padStart(7)} titles | avg rating: ${avgRating}`
    );
  }

  // ── Step 10: Final memory summary ────────────────────────────────────────

  // Force GC if available
  if (global.gc) global.gc();

  const heapFinal = heapUsed();
  console.log('\n' + '='.repeat(70));
  console.log('  MEMORY SUMMARY');
  console.log('='.repeat(70));
  console.log(`   Heap at start:        ${mb(heapBefore)}`);
  console.log(`   Heap after download:  ${mb(heapAfterDownload)}`);
  console.log(`   Heap after join:      ${mb(heapAfterJoin)}`);
  console.log(`   Heap after indexes:   ${mb(heapAfterIndex)}`);
  console.log(`   Heap final:           ${mb(heapFinal)}`);
  console.log(`   Total heap delta:     ${mb(heapFinal - heapBefore)}`);
  console.log('');
  console.log(`   Joined titles:        ${fmt(titles.length)}`);
  console.log(`   Movies (non-adult):   ${fmt(movies.length)}`);
  console.log(`   Series (non-adult):   ${fmt(series.length)}`);
  console.log(`   Movie genres:         ${moviesByGenre.size}`);
  console.log(`   Series genres:        ${seriesByGenre.size}`);

  // ── Step 11: Accuracy check — compare with known IMDB Top 250 ───────────

  console.log('\n' + '='.repeat(70));
  console.log('  ACCURACY CHECK — IMDB Top 250 Known Titles');
  console.log('='.repeat(70));

  const knownTop10 = [
    { id: 'tt0111161', title: 'The Shawshank Redemption', expectedRating: 9.3 },
    { id: 'tt0068646', title: 'The Godfather', expectedRating: 9.2 },
    { id: 'tt0468569', title: 'The Dark Knight', expectedRating: 9.0 },
    { id: 'tt0071562', title: 'The Godfather Part II', expectedRating: 9.0 },
    { id: 'tt0050083', title: '12 Angry Men', expectedRating: 9.0 },
    { id: 'tt0108052', title: "Schindler's List", expectedRating: 9.0 },
    { id: 'tt0167260', title: 'LOTR: Return of the King', expectedRating: 9.0 },
    { id: 'tt0110912', title: 'Pulp Fiction', expectedRating: 8.9 },
    { id: 'tt0120737', title: 'LOTR: Fellowship of the Ring', expectedRating: 8.9 },
    { id: 'tt0109830', title: 'Forrest Gump', expectedRating: 8.8 },
  ];

  console.log('\n   Checking if IMDB Top 10 movies appear in our dataset:');
  let accuracyHits = 0;
  for (const known of knownTop10) {
    const found = titles.find((t) => t.id === known.id);
    if (found) {
      accuracyHits++;
      const diff = Math.abs(found.rating - known.expectedRating);
      const status = diff <= 0.1 ? '✅' : diff <= 0.3 ? '⚠️' : '❌';
      console.log(
        `   ${status} ${known.title.padEnd(35)} expected: ${known.expectedRating.toFixed(1)} | got: ${found.rating.toFixed(1)} | diff: ${diff.toFixed(1)}`
      );
    } else {
      console.log(`   ❌ ${known.title.padEnd(35)} NOT FOUND in dataset`);
    }
  }
  console.log(`\n   Accuracy: ${accuracyHits}/${knownTop10.length} found`);

  // Check position accuracy
  console.log('\n   Position check — where do these appear in our sorted list?');
  for (const known of knownTop10.slice(0, 5)) {
    // Find in movies with >= 25000 votes (IMDB Top 250 threshold is ~25K)
    const qualified = movies.filter((m) => m.votes >= 25000);
    const idx = qualified.findIndex((m) => m.id === known.id);
    console.log(
      `   ${known.title.padEnd(35)} → Position #${idx >= 0 ? idx + 1 : 'NOT FOUND'} (of ${fmt(qualified.length)})`
    );
  }

  console.log('\n' + '='.repeat(70));
  console.log('  TEST COMPLETE');
  console.log('='.repeat(70));
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
