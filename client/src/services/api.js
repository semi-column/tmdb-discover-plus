const API_BASE = '/api';

class ApiService {
  async request(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // Validate TMDB API key
  async validateApiKey(apiKey) {
    return this.request('/validate-key', {
      method: 'POST',
      body: JSON.stringify({ apiKey }),
    });
  }

  // Get genres for a content type
  async getGenres(apiKey, type = 'movie') {
    return this.request(`/genres/${type}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  // Get available languages
  async getLanguages(apiKey) {
    return this.request(`/languages?apiKey=${encodeURIComponent(apiKey)}`);
  }

  // Get available countries
  async getCountries(apiKey) {
    return this.request(`/countries?apiKey=${encodeURIComponent(apiKey)}`);
  }

  // Get certifications (age ratings) for a type
  async getCertifications(apiKey, type = 'movie') {
    return this.request(`/certifications/${type}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  // Get watch providers for a region
  async getWatchProviders(apiKey, type = 'movie', region = 'US') {
    return this.request(`/watch-providers/${type}?apiKey=${encodeURIComponent(apiKey)}&region=${region}`);
  }

  // Get available watch regions
  async getWatchRegions(apiKey) {
    return this.request(`/watch-regions?apiKey=${encodeURIComponent(apiKey)}`);
  }

  // Search for people (actors, directors)
  async searchPerson(apiKey, query) {
    return this.request(`/search/person?apiKey=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}`);
  }

  // Search for companies
  async searchCompany(apiKey, query) {
    return this.request(`/search/company?apiKey=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}`);
  }

  // Search for keywords
  async searchKeyword(apiKey, query) {
    return this.request(`/search/keyword?apiKey=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(query)}`);
  }

  // Get sort options
  async getSortOptions() {
    return this.request('/sort-options');
  }

  // Get list types (trending, now playing, etc.)
  async getListTypes() {
    return this.request('/list-types');
  }

  // Get preset catalogs (for quick adding in sidebar)
  async getPresetCatalogs() {
    return this.request('/preset-catalogs');
  }

  // Get release types (for movies)
  async getReleaseTypes() {
    return this.request('/release-types');
  }

  // Get TV statuses
  async getTVStatuses() {
    return this.request('/tv-statuses');
  }

  // Get TV types
  async getTVTypes() {
    return this.request('/tv-types');
  }

  // Get monetization types
  async getMonetizationTypes() {
    return this.request('/monetization-types');
  }

  // Get TV networks
  async getTVNetworks(query = '') {
    const params = query ? `?query=${encodeURIComponent(query)}` : '';
    return this.request(`/tv-networks${params}`);
  }

  // Preview catalog with filters
  async preview(apiKey, type, filters, page = 1) {
    return this.request('/preview', {
      method: 'POST',
      body: JSON.stringify({ apiKey, type, filters, page }),
    });
  }

  // Resolve single person/company/keyword by ID
  async getPersonById(apiKey, id) {
    return this.request(`/person/${encodeURIComponent(id)}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async getCompanyById(apiKey, id) {
    return this.request(`/company/${encodeURIComponent(id)}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  async getKeywordById(apiKey, id) {
    return this.request(`/keyword/${encodeURIComponent(id)}?apiKey=${encodeURIComponent(apiKey)}`);
  }

  // Save configuration
  async saveConfig(config) {
    return this.request('/config', {
      method: 'POST',
      body: JSON.stringify(config),
    });
  }

  // Get existing configuration. If apiKey is provided (user entered it on the configure page),
  // include it as a query parameter so the server can resolve placeholders using it.
  async getConfig(userId, apiKey = null) {
    const params = apiKey ? `?apiKey=${encodeURIComponent(apiKey)}` : '';
    return this.request(`/config/${userId}${params}`);
  }

  // Update configuration
  async updateConfig(userId, config) {
    return this.request(`/config/${userId}`, {
      method: 'PUT',
      body: JSON.stringify(config),
    });
  }

  // Delete a catalog
  async deleteCatalog(userId, catalogId) {
    return this.request(`/config/${userId}/catalog/${catalogId}`, {
      method: 'DELETE',
    });
  }

  // Get all configurations for an API key
  async getConfigsByApiKey(apiKey) {
    return this.request(`/configs?apiKey=${encodeURIComponent(apiKey)}`);
  }

  // Delete entire configuration
  async deleteConfig(userId, apiKey) {
    return this.request(`/config/${userId}?apiKey=${encodeURIComponent(apiKey)}`, {
      method: 'DELETE',
    });
  }
}

export const api = new ApiService();
