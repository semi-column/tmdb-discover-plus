import { describe, it, expect } from 'vitest';
import {
  imdbToStremioMeta,
  imdbToStremioFullMeta,
  imdbRankingToStremioMeta,
  imdbListItemToStremioMeta,
} from '../../src/services/imdb/stremioMeta.ts';

const mockImdbTitle = {
  id: 'tt0111161',
  type: 'movie',
  primaryTitle: 'The Shawshank Redemption',
  originalTitle: 'The Shawshank Redemption',
  primaryImage: { url: 'https://example.com/poster.jpg' },
  posterImages: [{ url: 'https://example.com/bg.jpg' }],
  description: 'Two imprisoned men bond over a number of years.',
  releaseDate: { year: 1994, date: '1994-09-23' },
  startYear: 1994,
  endYear: null,
  averageRating: 9.3,
  runtimeMinutes: 142,
  genres: ['Drama'],
  contentRating: 'R',
  countriesOfOrigin: ['US'],
  spokenLanguages: ['en'],
  cast: [
    { id: 'nm0000209', fullName: 'Tim Robbins', characters: ['Andy'], primaryImage: null },
    { id: 'nm0000151', fullName: 'Morgan Freeman', characters: ['Red'], primaryImage: null },
  ],
  directors: [{ id: 'nm0001104', fullName: 'Frank Darabont', primaryImage: null }],
  writers: [{ id: 'nm0000175', fullName: 'Stephen King', primaryImage: null }],
  trailer: 'dQw4w9WgXcQ',
};

describe('imdbToStremioMeta', () => {
  it('returns null for null input', () => {
    expect(imdbToStremioMeta(null as any, 'movie')).toBeNull();
  });

  it('returns null for item without id', () => {
    expect(imdbToStremioMeta({ type: 'movie' } as any, 'movie')).toBeNull();
  });

  it('transforms a full IMDb title to Stremio meta', () => {
    const result = imdbToStremioMeta(mockImdbTitle as any, 'movie');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('tt0111161');
    expect(result!.imdbId).toBe('tt0111161');
    expect(result!.type).toBe('movie');
    expect(result!.name).toBe('The Shawshank Redemption');
    expect(result!.poster).toBe('https://example.com/poster.jpg');
    expect(result!.background).toBe('https://example.com/bg.jpg');
    expect(result!.description).toBe('Two imprisoned men bond over a number of years.');
    expect(result!.year).toBe('1994');
    expect(result!.imdbRating).toBe('9.3');
    expect(result!.genres).toEqual(['Drama']);
    expect(result!.runtime).toBe('2h22min');
    expect(result!.cast).toEqual(['Tim Robbins', 'Morgan Freeman']);
    expect(result!.director).toBe('Frank Darabont');
    expect(result!.writer).toBe('Stephen King');
    expect(result!.contentRating).toBe('R');
    expect(result!.country).toBe('US');
    expect(result!.language).toBe('en');
  });

  it('uses originalTitle when primaryTitle is missing', () => {
    const item = { ...mockImdbTitle, primaryTitle: null };
    const result = imdbToStremioMeta(item as any, 'movie');
    expect(result!.name).toBe('The Shawshank Redemption');
  });

  it('maps TV series type correctly', () => {
    const tvItem = { ...mockImdbTitle, type: 'tvSeries' };
    const result = imdbToStremioMeta(tvItem as any, null as any);
    expect(result!.type).toBe('series');
  });

  it('generates slug', () => {
    const result = imdbToStremioMeta(mockImdbTitle as any, 'movie');
    expect(result!.slug).toBe('movie/the-shawshank-redemption-tt0111161');
  });

  it('handles missing optional fields', () => {
    const minimal = { id: 'tt1234567', type: 'movie' };
    const result = imdbToStremioMeta(minimal as any, 'movie');
    expect(result).not.toBeNull();
    expect(result!.name).toBe('');
    expect(result!.poster).toBe('https://images.metahub.space/poster/medium/tt1234567/img');
    expect(result!.background).toBe('https://images.metahub.space/background/medium/tt1234567/img');
    expect(result!.imdbRating).toBeUndefined();
    expect(result!.runtime).toBeUndefined();
  });

  it('handles runtime formatting edge cases', () => {
    const item45min = { ...mockImdbTitle, runtimeMinutes: 45 };
    expect(imdbToStremioMeta(item45min as any, 'movie')!.runtime).toBe('45min');

    const item2h = { ...mockImdbTitle, runtimeMinutes: 120 };
    expect(imdbToStremioMeta(item2h as any, 'movie')!.runtime).toBe('2h');

    const item0 = { ...mockImdbTitle, runtimeMinutes: 0 };
    expect(imdbToStremioMeta(item0 as any, 'movie')!.runtime).toBeUndefined();
  });
});

describe('imdbToStremioFullMeta', () => {
  it('returns null for null input', () => {
    expect(imdbToStremioFullMeta(null as any, 'movie')).toBeNull();
  });

  it('extends base meta with links and trailer', () => {
    const result = imdbToStremioFullMeta(mockImdbTitle as any, 'movie');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('tt0111161');

    const links = result!.links as Array<{ name: string; category: string }>;
    expect(links.some((l) => l.category === 'imdb')).toBe(true);
    expect(links.some((l) => l.category === 'Genres')).toBe(true);
    expect(links.some((l) => l.category === 'Cast')).toBe(true);
    expect(links.some((l) => l.category === 'Directors')).toBe(true);

    const trailers = result!.trailerStreams as Array<{ ytId: string }>;
    expect(trailers).toHaveLength(1);
    expect(trailers[0].ytId).toBe('dQw4w9WgXcQ');
  });

  it('includes character in cast links', () => {
    const result = imdbToStremioFullMeta(mockImdbTitle as any, 'movie');
    const links = result!.links as Array<{ name: string; category: string }>;
    const castLink = links.find((l) => l.category === 'Cast' && l.name.includes('Tim Robbins'));
    expect(castLink!.name).toContain('Andy');
  });

  it('includes app_extras', () => {
    const result = imdbToStremioFullMeta(mockImdbTitle as any, 'movie');
    const extras = result!.app_extras as Record<string, unknown>;
    expect(extras.cast).toHaveLength(2);
    expect(extras.directors).toHaveLength(1);
    expect(extras.writers).toHaveLength(1);
  });

  it('includes release date', () => {
    const result = imdbToStremioFullMeta(mockImdbTitle as any, 'movie');
    expect(result!.released).toBe('1994-09-23');
  });
});

describe('imdbRankingToStremioMeta', () => {
  it('delegates to imdbToStremioMeta', () => {
    const result = imdbRankingToStremioMeta(mockImdbTitle as any, 'movie');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('tt0111161');
  });
});

describe('imdbListItemToStremioMeta', () => {
  it('delegates to imdbToStremioMeta', () => {
    const result = imdbListItemToStremioMeta(mockImdbTitle as any, 'movie');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('tt0111161');
  });
});
