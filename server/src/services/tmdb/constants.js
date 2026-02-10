import https from 'node:https';
import path from 'path';
import { fileURLToPath } from 'url';

export const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const httpsAgent = new https.Agent({
  keepAlive: true,
  rejectUnauthorized: process.env.DISABLE_TLS_VERIFY !== 'true',
});

export const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
export const TMDB_WEBSITE_BASE_URL = 'https://www.themoviedb.org';
export const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

const TMDB_API_URL = new URL(TMDB_BASE_URL);
export const TMDB_API_ORIGIN = TMDB_API_URL.origin; // https://api.themoviedb.org
export const TMDB_API_BASE_PATH = TMDB_API_URL.pathname.replace(/\/$/, ''); // /3

const TMDB_SITE_URL = new URL(TMDB_WEBSITE_BASE_URL);
export const TMDB_SITE_ORIGIN = TMDB_SITE_URL.origin; // https://www.themoviedb.org

export const CINEMETA_API_ORIGIN = 'https://v3-cinemeta.strem.io';
export const CINEMETA_API_BASE_PATH = '/meta';
