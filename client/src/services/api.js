const API_BASE = '/api';

const TOKEN_KEY = 'tmdb-session-token';
const LEGACY_KEY = 'tmdb-stremio-apikey';
const REMEMBER_ME_KEY = 'tmdb-remember-me';

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
      const storage = rememberMe ? localStorage : sessionStorage;
      storage.setItem(TOKEN_KEY, token);
      localStorage.setItem(REMEMBER_ME_KEY, rememberMe ? 'true' : 'false');
      // Clear from the other storage
      if (rememberMe) {
        sessionStorage.removeItem(TOKEN_KEY);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    } catch {
      // Storage not available
    }
  }

  clearSession() {
    this._sessionToken = null;
    try {
      localStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REMEMBER_ME_KEY);
    } catch {
      // Storage not available
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
    } catch {
      // Storage not available
    }
  }

  isRememberMeEnabled() {
    try {
      return localStorage.getItem(REMEMBER_ME_KEY) !== 'false';
    } catch {
      return true;
    }
  }

  getAuthHeaders() {
    const token = this.getSessionToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const { headers: optionHeaders, ...restOptions } = options;
    const response = await fetch(url, {
      ...restOptions,
      headers: {
        'Content-Type': 'application/json',
        ...this.getAuthHeaders(),
        ...optionHeaders,
      },
    });

    if (response.status === 401) {
      // Token expired or invalid - clear it
      this.clearSession();
      const error = new Error('Session expired');
      error.status = 401;
      throw error;
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      const err = new Error(error.error || 'Request failed');
      err.status = response.status;
      throw err;
    }

    return response.json();
  }

  // Authentication methods
  async login(apiKey, userId = null, rememberMe = true) {
    const result = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey, userId, rememberMe }),
      headers: {}, // Don't send auth header for login
    });

    if (result.multipleConfigs) {
      // User has multiple configs, return list for selection
      return result;
    }

    if (result.token) {
      this.setSessionToken(result.token, rememberMe);
    }

    return result;
  }

  async selectConfig(apiKey, userId, rememberMe = true) {
    const result = await this.request('/auth/select-config', {
      method: 'POST',
      body: JSON.stringify({ apiKey, userId }),
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
    } catch {
      return { valid: false };
    }
  }

  async logout() {
    try {
      await this.request('/auth/logout', { method: 'POST' });
    } catch {
      // Ignore logout errors
    }
    this.clearSession();
  }

  // Validate TMDB API key (used during login flow)
  async validateApiKey(apiKey) {
    return this.request('/validate-key', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
      headers: {},
    });
  }

  // The following methods now use session authentication
  // Legacy apiKey parameter kept for backward compatibility during transition

  async getGenres(apiKey, type = 'movie') {
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/genres/${type}`);
    }
    return this.request(`/genres/${type}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async getLanguages(apiKey) {
    const token = this.getSessionToken();
    if (token) {
      return this.request('/languages');
    }
    return this.request(`/languages?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async getCountries(apiKey) {
    const token = this.getSessionToken();
    if (token) {
      return this.request('/countries');
    }
    return this.request(`/countries?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async getCertifications(apiKey, type = 'movie') {
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/certifications/${type}`);
    }
    return this.request(`/certifications/${type}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async getWatchProviders(apiKey, type = 'movie', region = 'US') {
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/watch-providers/${type}?region=${region}`);
    }
    return this.request(
      `/watch-providers/${type}?apiKey=${encodeURIComponent(apiKey)}&region=${region}`
    );
  }

  async getWatchRegions(apiKey) {
    const token = this.getSessionToken();
    if (token) {
      return this.request('/watch-regions');
    }
    return this.request(`/watch-regions?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async searchPerson(apiKey, query) {
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/search/person?query=${encodeURIComponent(query)}`);
    }
    return this.request(
      `/search/person?apiKey=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}`
    );
  }

  async searchCompany(apiKey, query) {
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/search/company?query=${encodeURIComponent(query)}`);
    }
    return this.request(
      `/search/company?apiKey=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}`
    );
  }

  async searchKeyword(apiKey, query) {
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/search/keyword?query=${encodeURIComponent(query)}`);
    }
    return this.request(
      `/search/keyword?apiKey=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}`
    );
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

  async getTVNetworks(apiKey = null, query = '') {
    const params = new URLSearchParams();
    if (query) params.set('query', query);
    const token = this.getSessionToken();
    if (!token && apiKey) params.set('apiKey', apiKey);
    const qs = params.toString();
    return this.request(`/tv-networks${qs ? `?${qs}` : ''}`);
  }

  async preview(apiKey, type, filters, page = 1) {
    // When authenticated via session, apiKey may be null/empty
    // Server gets API key from session; only include for legacy fallback
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
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/person/${encodeURIComponent(id)}`);
    }
    return this.request(`/person/${encodeURIComponent(id)}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async getCompanyById(apiKey, id) {
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/company/${encodeURIComponent(id)}`);
    }
    return this.request(`/company/${encodeURIComponent(id)}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async getKeywordById(apiKey, id) {
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/keyword/${encodeURIComponent(id)}`);
    }
    return this.request(`/keyword/${encodeURIComponent(id)}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async saveConfig(config) {
    return this.request('/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  async getConfig(userId, apiKey = null) {
    const token = this.getSessionToken();
    const params = !token && apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : '';
    return this.request(`/config/${userId}${params}`);
  }

  async updateConfig(userId, config) {
    return this.request(`/config/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  async deleteCatalog(userId, catalogId) {
    return this.request(`/config/${userId}/catalog/${catalogId}`, {
      method: 'DELETE',
    });
  }

  async getConfigsByApiKey(apiKey) {
    const token = this.getSessionToken();
    if (token) {
      return this.request('/configs');
    }
    return this.request(`/configs?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async deleteConfig(userId, apiKey) {
    const token = this.getSessionToken();
    if (token) {
      return this.request(`/config/${userId}`, { method: 'DELETE' });
    }
    return this.request(`/config/${userId}?apiKey=${encodeURIComponent(apiKey)}`, {
      method: 'DELETE',
    });
  }
}

export const api = new ApiService();
