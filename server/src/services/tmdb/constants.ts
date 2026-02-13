import https from 'node:https';
import path from 'path';
import { fileURLToPath } from 'url';
import { config } from '../../config.ts';

export const __dirname: string = path.dirname(fileURLToPath(import.meta.url));

export const httpsAgent: https.Agent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: !config.tmdb.disableTlsVerify,
});

export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
export const TMDB_WEBSITE_BASE_URL = 'https://www.themoviedb.org';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

const TMDB_API_URL = new URL(TMDB_BASE_URL);
export const TMDB_API_ORIGIN: string = TMDB_API_URL.origin;
export const TMDB_API_BASE_PATH: string = TMDB_API_URL.pathname.replace(/\/$/, '');

const TMDB_SITE_URL = new URL(TMDB_WEBSITE_BASE_URL);
export const TMDB_SITE_ORIGIN: string = TMDB_SITE_URL.origin;

export const CINEMETA_API_ORIGIN = 'https://v3-cinemeta.strem.io';
export const CINEMETA_API_BASE_PATH = '/meta';
