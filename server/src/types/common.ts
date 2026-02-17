export type ContentType = 'movie' | 'series';

export type TmdbMediaType = 'movie' | 'tv';

export type PosterShape = 'poster' | 'landscape' | 'square';

export type GenreMatchMode = 'any' | 'all';

export interface Logger {
  debug(message: string, data?: Record<string, unknown> | null): void;
  info(message: string, data?: Record<string, unknown> | null): void;
  warn(message: string, data?: Record<string, unknown> | null): void;
  error(message: string, data?: Record<string, unknown> | null): void;
}
