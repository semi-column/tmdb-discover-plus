# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.0] - 2026-01-10

### Added
- Display language selection (localize titles/metadata via TMDB `language=`) while preserving original-language filtering
- Improved filter UX: tooltips, active-filters summary chips, per-section filter-count badges
- Genre improvements: tri-state include/exclude/neutral selection and optional match mode (ANY vs ALL)
- Desktop split layout with a dedicated preview panel
- Drag & drop catalog reordering is added

### Changed
- Filters accordion behavior improved (collapsed by default, single-section open)
- Responsive layout improved across breakpoints

### Fixed
- Preview header alignment and padding consistency
- Streaming providers list now shows all available services for the selected region (previously capped) and includes a quick search
- TV network search improved to discover networks via TMDB TV results

## [2.0.0] - 2026-01-05

### Added
- **Configuration Manager** - New dropdown to list, switch between, edit, and delete saved configurations
- **Multi-Config Support** - Easily manage multiple addon configurations with different API keys
- **API Key Switching** - Seamlessly switch between different TMDB API keys with automatic config loading
- **Long-Press Genre Exclusion** - Long-press (or right-click) on genre chips to toggle exclusion - works on desktop and mobile
- **Runtime Filtering** - Filter movies/TV by runtime with interactive range slider and quick presets (Short, Standard, Long, Epic)
- **Exclude Keywords Filter** - Exclude content containing specific keywords (e.g., "remake", "sequel")
- **Exclude Companies Filter** - Exclude content from specific production companies
- **Region Filter** - Filter movies by regional release dates (theatrical releases in specific countries)
- **First Air Date Filter** - Filter TV shows by premiere date (when the show first aired vs episode air dates)
- **Dynamic Date Presets** - Date presets (Last 30/90 days, This Year, etc.) now calculate dates at request time, ensuring catalogs always show fresh content relative to the current date
- **Clickable Preview Cards** - Preview tiles now link directly to TMDB pages, making it easy to explore content details and keywords
- **CI/CD Pipeline** - GitHub Actions workflow for automated linting, testing, and deployment to BeamUp

### Changed
- Date presets now store preset type instead of static dates, resolving dynamically when catalog is fetched
- Improved date preset UI with active state indicator
- Enhanced filter architecture for better extensibility
- Improved config retrieval and deletion logic for better reliability
- Added cache control headers to prevent stale config responses

### Fixed
- iOS/Safari compatibility for touch events on genre chips
- Long-press detection on mobile devices with proper touch event handling
- Config deletion now properly handles fallback scenarios

### Technical
- Added `ConfigDropdown` component for configuration management
- Added `resolveDynamicDatePreset()` helper in addon routes and preview endpoint
- Extended TMDB service with `region`, `firstAirDateFrom/To`, and `excludeCompanies` parameters
- Runtime slider component with dual-handle range selection
- Improved touch event management for cross-browser compatibility

## [1.5.0] - 2026-01-04

### Added
- Docker support with multi-stage build for easy self-hosting
- Docker Compose configuration for quick deployment
- Health check endpoint (`/health`) for monitoring and container orchestration
- Graceful shutdown handling for clean container stops
- Structured logging with configurable log levels
- Rate limiting on API endpoints (100 req/min)
- Input validation for all API endpoints
- `.env.example` template for easy configuration

### Changed
- Consolidated utility functions into shared modules
- Replaced all `console.log` statements with structured logger
- TLS verification now configurable via environment variable
- Improved error handling throughout the codebase

### Removed
- Unused `stremio-addon-sdk` dependency (addon uses raw Express routes)
- Unused `uuid` dependency (replaced with `nanoid`)
- Unused `react-router-dom` dependency
- Test files and development scripts from production

### Security
- Added API key format validation before external requests
- Protected debug endpoint in production mode
- Sensitive data sanitization in logs
- Rate limiting to prevent abuse

## [1.4.0] - Previous Release

### Added
- Exclude genres filter
- Random sort option
- Watch provider filtering
- People, companies, and keywords search

### Changed
- Improved pagination with proper `pageSize` in manifest
- Better IMDB ID resolution

## [1.3.0] - Previous Release

### Added
- Preset catalog support (Trending, Popular, Top Rated, etc.)
- Multiple catalog support per user
- Live preview functionality

### Changed
- Redesigned configuration UI
- Improved mobile responsiveness

## [1.2.0] - Previous Release

### Added
- MongoDB support for persistent configuration storage
- In-memory fallback when MongoDB is unavailable

### Changed
- Improved error handling
- Better CORS configuration

## [1.1.0] - Previous Release

### Added
- Basic filtering (genres, year, rating)
- Sorting options
- IMDB ID integration

## [1.0.0] - Initial Release

### Added
- Basic Stremio addon functionality
- TMDB API integration
- Simple configuration UI
