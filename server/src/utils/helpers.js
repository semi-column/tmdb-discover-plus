export function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function getBaseUrl(req) {
  if (process.env.BASE_URL) {
    return process.env.BASE_URL;
  }

  const protocol = req.get('x-forwarded-proto') || req.protocol || 'http';
  let host = req.get('x-forwarded-host') || req.get('host') || 'localhost';

  const beamupDomain = process.env.BEAMUP_DOMAIN || 'baby-beamup.club';
  const appName = process.env.BEAMUP_APP_NAME || 'tmdb-discover-plus';

  // Beamup/Dokku sometimes sends partial hostnames; append domain if needed
  if (host.includes(appName) && !host.includes(beamupDomain)) {
    host = `${host}.${beamupDomain}`;
  }

  return `${protocol}://${host}`;
}

export function normalizeGenreName(name) {
  if (!name) return '';
  return String(name)
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[\u2013\u2014]/g, ' ')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseIdArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map(String).filter(Boolean);
  return String(val)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
