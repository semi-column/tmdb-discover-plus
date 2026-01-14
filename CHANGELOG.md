# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.0] - 2026-01-05

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
