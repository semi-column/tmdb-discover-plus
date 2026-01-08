# TMDB Discover+

A powerful Stremio addon that lets you create custom movie and TV show catalogs using TMDB's extensive filtering system.

![Stremio Addon](https://img.shields.io/badge/Stremio-Addon-purple)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node.js](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![Docker](https://img.shields.io/badge/docker-ready-blue)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/semi-column?style=social)](https://github.com/sponsors/semi-column)
[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-ffdd00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/semi.column)

> 💖 **Like this project?** [Become a sponsor](https://github.com/sponsors/semi-column) or [buy me a coffee](https://buymeacoffee.com/semi.column) to support development!

## ✨ Features

- 🎬 **Custom Catalogs** - Create multiple personalized movie and TV show catalogs
- � **Configuration Manager** - Save, switch between, and manage multiple addon configurations
- 🔥 **Preset Lists** - Quick access to Trending, Popular, Top Rated, Upcoming, and more
- 🔍 **Advanced Filters** - Filter by genre, year, rating, runtime, language, streaming service, and more
- ⏱️ **Runtime Filtering** - Filter by duration with interactive slider and presets (Short, Standard, Long, Epic)
- 🚫 **Exclusion Filters** - Exclude genres, keywords, and production companies from results
- 🎯 **Separate Include/Exclude Sections** - Clear, touch-friendly genre selection with dedicated include and exclude sections
- 🌍 **Region & First Air Date** - Filter by regional releases and TV premiere dates
- 📅 **Dynamic Date Presets** - "Last 30 days" always means 30 days from today, not when you created the catalog
- 📊 **Sorting Options** - Sort by popularity, rating, release date, revenue, or random
- 👀 **Live Preview** - See catalog results before installing with clickable links to TMDB
- 🔄 **Easy Updates** - Edit your catalogs anytime via the configuration URL
- 🆔 **IMDB Integration** - Full IMDB ID support for best Stremio compatibility
- 🐳 **Self-Hostable** - Docker support for easy self-hosting

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Self-Hosting](#-self-hosting)
  - [Docker (Recommended)](#docker-recommended)
  - [Manual Installation](#manual-installation)
  - [Cloud Deployment](#cloud-deployment)
- [Configuration](#-configuration)
- [Usage](#-usage)
- [API Reference](#-api-reference)
- [Development](#-development)
- [Contributing](#-contributing)
- [License](#-license)

## 🚀 Quick Start

### Prerequisites

- **TMDB API Key** - [Get a free key here](https://www.themoviedb.org/settings/api)
- **MongoDB** (optional) - For persistent storage. Without it, configs are stored in memory.

### Use the Public Instance

Visit the public instance at `https://tmdb-discover-plus.beamup.dev` and:
1. Enter your TMDB API key
2. Create catalogs with your preferred filters
3. Click "Install to Stremio"

## 🏠 Self-Hosting

### Docker (Recommended)

The easiest way to self-host TMDB Discover+:

```bash
# Clone the repository
git clone https://github.com/semi-column/tmdb-discover-plus.git
cd tmdb-discover-plus

# Copy environment file
cp .env.example .env

# Edit .env with your settings (optional - MongoDB URI for persistence)
nano .env

# Build and run with Docker Compose
docker-compose up -d
```

The addon will be available at `http://localhost:7000`

#### Docker Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `7000` |
| `MONGODB_URI` | MongoDB connection string | (none - uses in-memory) |
| `LOG_LEVEL` | Logging level (debug/info/warn/error) | `info` |
| `CORS_ORIGIN` | Allowed CORS origins | `*` |

### Manual Installation

#### Requirements

- Node.js 18+
- npm or yarn
- MongoDB (optional, for persistence)

#### Steps

```bash
# Clone the repository
git clone https://github.com/semi-column/tmdb-discover-plus.git
cd tmdb-discover-plus

# Install all dependencies
npm run install:all

# Copy and configure environment
cp .env.example .env
# Edit .env with your MongoDB URI if desired

# Build the frontend
npm run build

# Start the server
npm start
```

### Cloud Deployment

#### BeamUp (Free - Stremio's Official Hosting)

```bash
# Install BeamUp CLI
npm install -g beamup-cli
beamup config

# Build and deploy
npm run build
beamup
```

#### Render / Railway / Fly.io

1. Fork this repository
2. Connect to your cloud provider
3. Set environment variables:
   - `MONGODB_URI` (optional)
   - `PORT` (usually auto-set)
4. Deploy!

#### Reverse Proxy (nginx)

If running behind a reverse proxy:

```nginx
location / {
    proxy_pass http://localhost:7000;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## ⚙️ Configuration

### Environment Variables

Create a `.env` file from `.env.example`:

```bash
# Required for persistent storage
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/tmdb-discover-plus

# Optional settings
PORT=7000
LOG_LEVEL=info
CORS_ORIGIN=*

# Debug settings (development only)
# DEBUG_TMDB=1
# DISABLE_TLS_VERIFY=true
# DISABLE_RATE_LIMIT=true
```

### Filter Options

| Filter | Description |
|--------|-------------|
| **Genres** | Filter by one or more genres |
| **Exclude Genres** | Exclude specific genres from results |
| **Year Range** | Release year from/to |
| **Rating Range** | TMDB vote average (0-10) |
| **Runtime** | Filter by duration in minutes (with presets: Short, Standard, Long, Epic) |
| **Sort By** | Popularity, Rating, Release Date, Revenue, Random |
| **Language** | Original language filter |
| **Country** | Origin country filter |
| **Region** | Regional release filter (for theatrical releases) |
| **First Air Date** | TV show premiere date filter |
| **Date Presets** | Quick filters: Last 30/90 days, Last 6 months, This/Last Year |
| **Min Votes** | Minimum vote count for quality filtering |
| **Streaming Service** | Filter by watch provider |
| **People** | Filter by actors, directors |
| **Companies** | Filter by production company |
| **Exclude Companies** | Exclude specific production companies |
| **Keywords** | Filter by content keywords |
| **Exclude Keywords** | Exclude content with specific keywords |
| **IMDB Only** | Only show items with IMDB IDs |

## 📖 Usage

1. **Open the Configuration Page**
   - Visit your instance's URL (e.g., `http://localhost:7000`)

2. **Enter Your TMDB API Key**
   - Get a free key from [TMDB](https://www.themoviedb.org/settings/api)

3. **Create Catalogs**
   - Click "Add Catalog"
   - Choose a preset or create custom filters
   - Use "Preview" to see results

4. **Save & Install**
   - Click "Save Configuration"
   - Click "Install to Stremio" to add to your Stremio app

5. **Edit Anytime**
   - Return to your configuration URL to modify catalogs

## 📡 API Reference

### Health Check

```
GET /health
```

Returns server status, uptime, and database connection state.

### Stremio Addon Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /:userId/manifest.json` | Stremio addon manifest |
| `GET /:userId/catalog/:type/:id.json` | Catalog results |
| `GET /:userId/catalog/:type/:id/:extra.json` | Paginated catalog |

### Configuration API

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/config` | POST | Create new configuration |
| `/api/config/:userId` | GET | Get user configuration |
| `/api/config/:userId` | PUT | Update configuration |
| `/api/validate-key` | POST | Validate TMDB API key |
| `/api/preview` | POST | Preview catalog results |

### TMDB Data Endpoints

| Endpoint | Description |
|----------|-------------|
| `/api/genres/:type` | Get genres for movie/series |
| `/api/languages` | Get available languages |
| `/api/countries` | Get available countries |
| `/api/watch-providers/:type` | Get streaming providers |
| `/api/search/person` | Search for actors/directors |
| `/api/search/company` | Search for production companies |
| `/api/search/keyword` | Search for keywords |

## 🛠️ Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
# Clone and install
git clone https://github.com/semi-column/tmdb-discover-plus.git
cd tmdb-discover-plus
npm run install:all

# Start development servers (frontend + backend)
npm run dev
```

- Frontend: http://localhost:5173 (with hot reload)
- Backend: http://localhost:7000 (with watch mode)

### Project Structure

```
tmdb-discover-plus/
├── client/                 # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── hooks/          # Custom hooks
│   │   ├── services/       # API client
│   │   └── styles/         # CSS styles
│   └── public/             # Static assets
├── server/                 # Express backend
│   └── src/
│       ├── routes/         # API routes
│       ├── services/       # Business logic
│       ├── models/         # MongoDB models
│       └── utils/          # Helpers, logger, validation
├── Dockerfile              # Production Docker image
├── docker-compose.yml      # Docker Compose config
└── .env.example            # Environment template
```

### Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: React 19, Vite
- **Database**: MongoDB (optional)
- **Styling**: CSS with custom properties
- **Icons**: Lucide React

## 🤝 Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Credits

- [TMDB](https://www.themoviedb.org/) - The Movie Database API
- [Stremio](https://www.stremio.com/) - Media center application
- [Lucide](https://lucide.dev/) - Beautiful icons

---

**Note**: This product uses the TMDB API but is not endorsed or certified by TMDB.
