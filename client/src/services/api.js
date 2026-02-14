const API_BASE = '/api';

const TOKEN_KEY = 'tmdb-session-token';
const LEGACY_KEY = 'tmdb-stremio-apikey';

class ApiService {
  constructor() {
    this._sessionToken = null;
  }

  getSessionToken() {
    if (this._sessionToken) return this._sessionToken;
    try {
      return localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY) || null;
    } catch {
      return null;
    }
  }

  setSessionToken(token, rememberMe = true) {
    this._sessionToken = token;
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem(TOKEN_KEY, token);
    } catch (e) {
      void e;
    }
  }

  clearSession() {
    this._sessionToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      void e;
    }
  }

  getLegacyApiKey() {
    try {
      return localStorage.getItem(LEGACY_KEY) || null;
    } catch {
      return null;
    }
  }

  clearLegacyApiKey() {
    try {
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) {
      void e;
    }
  }

  getAuthHeaders() {
    const token = this.getSessionToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  _buildAuthUrl(endpoint, apiKey, extraParams = {}) {
    const token = this.getSessionToken();
    const params = new URLSearchParams();
    if (!token && apiKey) params.set('apiKey', apiKey);
    Object.entries(extraParams).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== '') params.set(k, v);
    });
    const qs = params.toString();
    return qs ? `${endpoint}?${qs}` : endpoint;
  }

  async request(endpoint, options = {}, _retry = false) {
    const url = `${API_BASE}${endpoint}`;
    const { headers: optionHeaders, ...restOptions } = options;

    let response;
    try {
      response = await fetch(url, {
        ...restOptions,
        headers: {
          'Content-Type': 'application/json',
          ...this.getAuthHeaders(),
          ...optionHeaders,
        },
      });
    } catch (err) {
      if (!_retry && err instanceof TypeError) {
        await new Promise((r) => setTimeout(r, 2000));
        return this.request(endpoint, options, true);
      }
      throw err;
    }

    if (response.status === 401) {
      this.clearSession();
      const error = new Error('Session expired');
      error.status = 401;
      throw error;
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Request failed' }));
      const err = new Error(errorData.error || 'Request failed');
      err.status = response.status;
      err.code = errorData.code;
      throw err;
    }

    return response.json();
  }

  async login(apiKey, userId = null, rememberMe = true) {
    const result = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey, userId, rememberMe }),
      headers: {},
    });

    if (result.token) {
      this.setSessionToken(result.token, rememberMe);
    }

    return result;
  }

  async verifySession() {
    if (!this.getSessionToken()) {
      return { valid: false };
    }

    try {
      return await this.request('/auth/verify');
    } catch (e) {
      void e;
      return { valid: false };
    }
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } catch (e) {
      void e;
    }
    this.clearSession();
  }

  async validateApiKey(apiKey) {
    return this.request('/validate-key', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
      headers: {},
    });
  }

  async getStats() {
    return this.request('/stats', { method: 'GET' });
  }

  async getGenres(apiKey, type = 'movie') {
    return this.request(this._buildAuthUrl(`/genres/${type}`, apiKey));
  }

  async getLanguages(apiKey) {
    return this.request(this._buildAuthUrl('/languages', apiKey));
  }

  async getOriginalLanguages(apiKey) {
    return this.request(this._buildAuthUrl('/original-languages', apiKey));
  }

  async getCountries(apiKey) {
    return this.request(this._buildAuthUrl('/countries', apiKey));
  }

  async getCertifications(apiKey, type = 'movie') {
    return this.request(this._buildAuthUrl(`/certifications/${type}`, apiKey));
  }

  async getWatchProviders(apiKey, type = 'movie', region = 'US') {
    return this.request(this._buildAuthUrl(`/watch-providers/${type}`, apiKey, { region }));
  }

  async getWatchRegions(apiKey) {
    return this.request(this._buildAuthUrl('/watch-regions', apiKey));
  }

  async searchPerson(apiKey, query) {
    return this.request(this._buildAuthUrl('/search/person', apiKey, { query }));
  }

  async searchCompany(apiKey, query) {
    return this.request(this._buildAuthUrl('/search/company', apiKey, { query }));
  }

  async searchKeyword(apiKey, query) {
    return this.request(this._buildAuthUrl('/search/keyword', apiKey, { query }));
  }

  async getSortOptions() {
    return this.request('/sort-options');
  }

  async getListTypes() {
    return this.request('/list-types');
  }

  async getPresetCatalogs() {
    return this.request('/preset-catalogs');
  }

  async getReleaseTypes() {
    return this.request('/release-types');
  }

  async getTVStatuses() {
    return this.request('/tv-statuses');
  }

  async getTVTypes() {
    return this.request('/tv-types');
  }

  async getMonetizationTypes() {
    return this.request('/monetization-types');
  }

  async getReferenceData() {
    const cacheKey = 'tmdb-reference-data';
    try {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached);
    } catch {
      /* ignore */
    }
    const data = await this.request('/reference-data');
    try {
      sessionStorage.setItem(cacheKey, JSON.stringify(data));
    } catch {
      /* ignore */
    }
    return data;
  }

  async getTVNetworks(apiKey = null, query = '') {
    return this.request(this._buildAuthUrl('/tv-networks', apiKey, { query }));
  }

  async preview(apiKey, type, filters, page = 1) {
    const body = { type, filters, page };
    const token = this.getSessionToken();
    if (!token && apiKey) {
      body.apiKey = apiKey;
    }
    return this.request('/preview', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async getPersonById(apiKey, id) {
    return this.request(this._buildAuthUrl(`/person/${encodeURIComponent(id)}`, apiKey));
  }

  async getCompanyById(apiKey, id) {
    return this.request(this._buildAuthUrl(`/company/${encodeURIComponent(id)}`, apiKey));
  }

  async getKeywordById(apiKey, id) {
    return this.request(this._buildAuthUrl(`/keyword/${encodeURIComponent(id)}`, apiKey));
  }

  async getNetworkById(apiKey, id) {
    return this.request(this._buildAuthUrl(`/network/${encodeURIComponent(id)}`, apiKey));
  }

  async saveConfig(config) {
    return this.request('/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async getConfig(userId, apiKey = null) {
    return this.request(this._buildAuthUrl(`/config/${userId}`, apiKey));
  }

  async updateConfig(userId, config) {
    return this.request(`/config/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  async getConfigsByApiKey(apiKey) {
    return this.request(this._buildAuthUrl('/configs', apiKey));
  }

  async deleteConfig(userId, apiKey) {
    return this.request(this._buildAuthUrl(`/config/${userId}`, apiKey), { method: 'DELETE' });
  }
}

export const api = new ApiService();
