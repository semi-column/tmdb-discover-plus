<p align="center">
  <img src="client/public/logo.png" alt="TMDB Discover+ Logo" width="150" />
</p>

<h1 align="center">TMDB Discover+</h1>

<p align="center">
  <strong>🎬 Create Custom Movie & TV Show Catalogs for Stremio</strong><br/>
  <em>Unlock the full power of TMDB's discover API with advanced filtering and personalized catalogs</em>
</p>

<p align="center">
  <a href="https://github.com/semi-column/tmdb-discover-plus/releases/latest">
    <img src="https://img.shields.io/github/v/release/semi-column/tmdb-discover-plus?style=flat-square&logo=github&label=stable" alt="GitHub Release" />
  </a>
  <a href="https://discord.gg/X2N3btmEG2">
    <img src="https://img.shields.io/discord/1466384279717285961?style=flat-square&logo=discord&logoColor=white&label=Discord&color=5865F2" alt="Discord" />
  </a>
</p>

<p align="center">
  <a href="https://nodejs.org/">
    <img src="https://img.shields.io/badge/node-%3E%3D22-brightgreen?style=flat-square&logo=node.js&logoColor=white" alt="Node.js" />
  </a>
  <a href="https://hub.docker.com/">
    <img src="https://img.shields.io/badge/docker-ready-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker" />
  </a>
  <a href="https://stremio.com/">
    <img src="https://img.shields.io/badge/Stremio-Addon-8A2BE2?style=flat-square" alt="Stremio Addon" />
  </a>
  <a href="https://www.themoviedb.org/">
    <img src="https://img.shields.io/badge/TMDB-API-01D277?style=flat-square&logo=themoviedatabase&logoColor=white" alt="TMDB API" />
  </a>
</p>

<p align="center">
  <a href="https://ko-fi.com/semicolumn">
    <img src="https://img.shields.io/badge/Ko--fi-Support%20Development-FF5E5B?style=for-the-badge&logo=ko-fi&logoColor=white" alt="Ko-Fi" />
  </a>
  <a href="https://buymeacoffee.com/semi.column">
    <img src="https://img.shields.io/badge/Buy%20Me%20A%20Coffee-Support-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me A Coffee" />
  </a>
</p>

---

## 🤔 Why TMDB Discover+?

### vs. Default Stremio Catalogs

- 🎯 **Precise Filtering** - Go beyond basic genre filters
- 🔄 **Dynamic Updates** - Date presets stay current automatically
- 📊 **Quality Control** - Filter by vote count and ratings
- 🎬 **Production Insight** - Filter by studios and companies

### vs. Other TMDB Addons

- 🔧 **Unlimited Catalogs** - Not just predefined lists
- 💾 **Persistent Configs** - Save and manage multiple setups
- 👁️ **Live Preview** - See results before installing
- 🚀 **Modern Tech Stack** - Fast, reliable, and actively maintained

### For Power Users

- 🐳 **Docker Ready** - Self-host with full control
- 🔌 **Multiple Databases** - Postgres, MongoDB, or memory
- ⚡ **Redis Caching** - Optimized performance
- 📊 **Status API** - Monitor your instance

---

## ✨ What is TMDB Discover+?

TMDB Discover+ is a **powerful Stremio addon** that unlocks the full potential of The Movie Database's discover API. Create unlimited personalized catalogs with advanced filters like genre, year, rating, runtime, streaming providers, and much more.

Whether you're hunting for:

- 🎞️ Hidden gems from the 90s
- 🆕 Upcoming releases on your favorite streaming services
- 🌍 Critically acclaimed foreign films
- 🏆 Award-winning documentaries
- 🎭 Indie films from specific production companies

**TMDB Discover+ has you covered!**

<p align="center">
  <img src="docs/screenshot.png" alt="TMDB Discover+ Configuration Interface" width="800" />
</p>

---

## 🌐 Public Instances

Choose the instance that best fits your needs:

| Instance                                                                | Channel    | Status      | Description                                                                     |
| ----------------------------------------------------------------------- | ---------- | ----------- | ------------------------------------------------------------------------------- |
| **[ElfHosted](https://tmdb-discover-plus.elfhosted.com/)**              | 🟢 Stable  | Production  | ✅ **Recommended for daily use**<br/>PostgreSQL + Redis for optimal performance |
| **[BeamUp](https://84f50d1c22e7-tmdb-discover-plus.baby-beamup.club/)** | 🟡 Nightly | Development | ⚠️ Latest features, may be unstable<br/>MongoDB + Memory cache                  |

> **💡 Tip:** Both instances are free to use! The stable instance is recommended for most users.

---

## 🚀 Key Features

### 🎬 Unlimited Custom Catalogs

Create as many personalized movie and TV show catalogs as you want with different filter combinations.

### 🔍 Advanced Filtering Engine

- **🎭 Genres** - Filter by one or more genres (with exclude support)
- **📅 Year Range** - Release year from/to
- **⭐ Rating Range** - TMDB vote average (0-10)
- **⏱️ Runtime** - Filter by duration with presets (Short, Standard, Long, Epic)
- **🌐 Language & Country** - Filter by original language and origin country
- **📺 Streaming Services** - Filter by watch provider (Netflix, Disney+, Prime Video, etc.)
- **👥 People** - Filter by actors, directors, crew
- **🏷️ Keywords** - Include or exclude specific keywords
- **🏢 Companies** - Filter or exclude production companies
- **🗳️ Vote Count** - Minimum votes for quality filtering

### 📅 Dynamic Date Presets

"Last 30 days" always means 30 days from **today**, not when you created the catalog—smart and up-to-date!

### 🎲 Smart Randomization

Dedicated randomization toggle that works seamlessly with any sort order for discovering unexpected favorites.

### ⚙️ Configuration Manager

Save, switch between, and manage multiple addon configurations effortlessly.

### 👀 Live Preview

See your catalog results before installing with clickable links to TMDB—no surprises!

### 🆔 IMDB Integration

Full IMDB ID support ensures maximum compatibility with Stremio and other addons.

### 🐳 Self-Hostable

Complete Docker support with PostgreSQL/MongoDB and Redis/Memory cache options for full control.

---

## 📋 Table of Contents

- [Quick Start](#-quick-start)
- [Self-Hosting](#-self-hosting)
  - [Docker (Recommended)](#docker-recommended)
  - [Manual Installation](#manual-installation)
  - [Cloud Deployment](#cloud-deployment)
- [Configuration](#%EF%B8%8F-configuration)
- [Usage](#-usage)
- [API Reference](#-api-reference)
- [Development](#%EF%B8%8F-development)
- [Contributing](#-contributing)
- [License](#-license)

---

## 🚀 Quick Start

### 🌟 Use a Public Instance

The easiest way to get started—no installation required!

**Visit [tmdb-discover-plus.elfhosted.com](https://tmdb-discover-plus.elfhosted.com/)** and:

1. 🔑 Enter your free TMDB API key ([Get one here](https://www.themoviedb.org/settings/api))
2. 🎨 Create catalogs with your preferred filters
3. 📥 Click "Install to Stremio"
4. ✨ Start discovering!

### Prerequisites

- **TMDB API Key** - [Get a free key here](https://www.themoviedb.org/settings/api) (takes 2 minutes)
- **Stremio** - [Download here](https://www.stremio.com/) if you don't have it

---

## 🏠 Self-Hosting

### Docker (Recommended)

The easiest way to self-host TMDB Discover+ with full persistence and caching:

```bash
# Clone the repository
git clone https://github.com/semi-column/tmdb-discover-plus.git
cd tmdb-discover-plus

# Copy environment file
cp .env.example .env

# Edit .env to choose your database (Postgres/Mongo) and cache (Redis/Memory)
nano .env

# Build and run with Docker Compose
docker-compose up -d
```

The addon will be available at `http://localhost:7000`

#### Docker Environment Variables

| Variable          | Description                                     | Default               |
| ----------------- | ----------------------------------------------- | --------------------- |
| `PORT`            | Server port                                     | `7000`                |
| `DATABASE_DRIVER` | Storage backend (`postgres`, `mongo`, `memory`) | `postgres`            |
| `POSTGRES_URI`    | Postgres connection URL                         | (internal docker url) |
| `MONGODB_URI`     | MongoDB connection URL                          | (internal docker url) |
| `CACHE_DRIVER`    | Cache backend (`redis`, `memory`)               | `redis`               |
| `REDIS_URL`       | Redis connection URL                            | `redis://redis:6379`  |
| `LOG_LEVEL`       | Logging level (debug/info/warn/error)           | `info`                |

### Manual Installation

#### Requirements

- Node.js 22+
- npm or yarn
- Postgres or MongoDB (Recommended for persistence)
- Redis (Optional for caching)

#### Steps

```bash
# Clone the repository
git clone https://github.com/semi-column/tmdb-discover-plus.git
cd tmdb-discover-plus

# Install all dependencies
npm run install:all

# Copy and configure environment
cp .env.example .env
# Edit .env to configure your DB and Cache connections

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

---

## ⚙️ Configuration

### Environment Variables

See [docs/environment.md](docs/environment.md) for a complete reference of all 28 environment variables.

Create a `.env` file from `.env.example`:

```bash
# Database Configuration
DATABASE_DRIVER=postgres
POSTGRES_URI=postgres://user:pass@localhost:5432/tmdb_discover
# MONGODB_URI=mongodb+srv://...

# Cache Configuration
CACHE_DRIVER=redis
REDIS_URL=redis://localhost:6379

# Server Settings
PORT=7000
LOG_LEVEL=info
CORS_ORIGIN=*
```

### Filter Options

| Filter                | Description                                                               |
| --------------------- | ------------------------------------------------------------------------- |
| **Genres**            | Filter by one or more genres                                              |
| **Exclude Genres**    | Exclude specific genres from results                                      |
| **Year Range**        | Release year from/to                                                      |
| **Rating Range**      | TMDB vote average (0-10)                                                  |
| **Runtime**           | Filter by duration in minutes (with presets: Short, Standard, Long, Epic) |
| **Sort By**           | Popularity, Rating, Release Date, Revenue                                 |
| **Randomize**         | Fetch a random page from results and shuffle them locally                 |
| **Language**          | Original language filter                                                  |
| **Country**           | Origin country filter                                                     |
| **Region**            | Regional release filter (for theatrical releases)                         |
| **First Air Date**    | TV show premiere date filter                                              |
| **Date Presets**      | Quick filters: Last 30/90 days, Last 6 months, This/Last Year             |
| **Min Votes**         | Minimum vote count for quality filtering                                  |
| **Streaming Service** | Filter by watch provider                                                  |
| **People**            | Filter by actors, directors                                               |
| **Companies**         | Filter by production company                                              |
| **Exclude Companies** | Exclude specific production companies                                     |
| **Keywords**          | Filter by content keywords                                                |
| **Exclude Keywords**  | Exclude content with specific keywords                                    |
| **IMDB Only**         | Only show items with IMDB IDs                                             |

---

## 📖 Usage

### Getting Started Guide

1. **🌐 Open the Configuration Page**
   - Visit your instance URL (e.g., `http://localhost:7000` or public instance)

2. **🔑 Enter Your TMDB API Key**
   - Get a free key from [TMDB](https://www.themoviedb.org/settings/api)
   - Only takes 2 minutes to sign up!

3. **🎨 Create Your First Catalog**
   - Click "Add Catalog"
   - Choose from preset templates or create custom filters
   - Use "Preview" to see results in real-time

4. **💾 Save & Install**
   - Click "Save Configuration"
   - Click "Install to Stremio" to add the addon
   - Your catalogs will appear in Stremio!

5. **✏️ Edit Anytime**
   - Return to your configuration URL to modify catalogs
   - Changes sync automatically

### 💡 Pro Tips

- **🎲 Randomize** - Enable randomization to discover hidden gems
- **📅 Use Date Presets** - "Last 30 days" automatically updates daily
- **⭐ Filter by Votes** - Set minimum vote count to avoid obscure titles
- **🏢 Exclude Studios** - Filter out specific production companies
- **🔍 Preview First** - Always preview before installing to verify results

---

## ❓ FAQ & Troubleshooting

<details>
<summary><b>How do I get a TMDB API key?</b></summary>

1. Go to [themoviedb.org](https://www.themoviedb.org/)
2. Create a free account
3. Go to Settings → API
4. Request an API key (choose "Developer" option)
5. Fill in basic details—it's approved instantly!

</details>

<details>
<summary><b>My catalogs aren't showing up in Stremio</b></summary>

Try these steps:

1. Make sure you clicked "Install to Stremio"
2. Restart the Stremio app
3. Check if the addon appears in Settings → Addons
4. Verify your configuration URL is correct
5. Check browser console for errors (F12)

</details>

<details>
<summary><b>Can I use this without self-hosting?</b></summary>

Yes! Use one of our public instances:

- **Stable:** [tmdb-discover-plus.elfhosted.com](https://tmdb-discover-plus.elfhosted.com/)
- **Nightly:** [BeamUp instance](https://84f50d1c22e7-tmdb-discover-plus.baby-beamup.club/)

No installation required!

</details>

<details>
<summary><b>How many catalogs can I create?</b></summary>

There's no hard limit! However, for performance:

- Keep it under 20 catalogs for best experience
- Each catalog is loaded separately by Stremio
- Consider using meaningful filters to avoid overlaps

</details>

<details>
<summary><b>Does this addon provide streams?</b></summary>

**No.** TMDB Discover+ is a **catalog addon** that helps you discover movies and TV shows. You need other Stremio addons (like Torrentio, The Movie Database +, etc.) to actually stream content.

</details>

<details>
<summary><b>Is my TMDB API key secure?</b></summary>

Yes! Your API key is:

- Encrypted at rest using AES-256
- Never logged or exposed in responses
- Only used for TMDB API calls
- Stored securely in the database

For self-hosted instances, you have full control!

</details>

<details>
<summary><b>Why do some filters not work together?</b></summary>

TMDB's API has some limitations:

- Some filter combinations may return no results
- "With people" filter works best with fewer other filters
- Try using preview to verify filter combinations work

</details>

<details>
<summary><b>Can I export/import my configuration?</b></summary>

Currently, configurations are tied to your user ID. We're considering adding export/import in future versions!

Follow the project for updates or contribute this feature!

</details>

---

## 📖 Usage

> **Note:** This section has been moved above. See the [Getting Started Guide](#-usage) for detailed usage instructions.

---

## 📡 API Reference

See [docs/api.md](docs/api.md) for comprehensive API documentation with request/response shapes, auth requirements, and rate limits. See [docs/architecture.md](docs/architecture.md) for system architecture.

### Health & Status

| Endpoint          | Description                                      |
| ----------------- | ------------------------------------------------ |
| `GET /health`     | Basic health check                               |
| `GET /api/status` | Version, build info, uptime, database/cache type |

The `/api/status` endpoint returns:

```json
{
  "version": "2.6.7",
  "tag": "v2.6.7",
  "channel": "stable",
  "commitHash": "abc1234",
  "buildTime": "2026-02-02T12:00:00.000Z",
  "uptime": 3600,
  "environment": "production",
  "database": "postgres",
  "cache": "redis",
  "stats": { "users": 100, "catalogs": 250 }
}
```

### Stremio Addon Endpoints

| Endpoint                                     | Description            |
| -------------------------------------------- | ---------------------- |
| `GET /:userId/manifest.json`                 | Stremio addon manifest |
| `GET /:userId/catalog/:type/:id.json`        | Catalog results        |
| `GET /:userId/catalog/:type/:id/:extra.json` | Paginated catalog      |

### Configuration API

| Endpoint              | Method | Description              |
| --------------------- | ------ | ------------------------ |
| `/api/config`         | POST   | Create new configuration |
| `/api/config/:userId` | GET    | Get user configuration   |
| `/api/config/:userId` | PUT    | Update configuration     |
| `/api/validate-key`   | POST   | Validate TMDB API key    |
| `/api/preview`        | POST   | Preview catalog results  |

### TMDB Data Endpoints

| Endpoint                     | Description                     |
| ---------------------------- | ------------------------------- |
| `/api/genres/:type`          | Get genres for movie/series     |
| `/api/languages`             | Get available languages         |
| `/api/countries`             | Get available countries         |
| `/api/watch-providers/:type` | Get streaming providers         |
| `/api/search/person`         | Search for actors/directors     |
| `/api/search/company`        | Search for production companies |
| `/api/search/keyword`        | Search for keywords             |

---

## 🛠️ Development

### Prerequisites

- Node.js 22+
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
│       ├── models/         # Database models
│       └── utils/          # Helpers, logger, validation
├── Dockerfile              # Production Docker image
├── docker-compose.yml      # Docker Compose config
└── .env.example            # Environment template
```

### Tech Stack

**Backend:**

- **Runtime:** Node.js 22+ with ES Modules
- **Framework:** Express.js
- **Databases:** PostgreSQL / MongoDB (with in-memory fallback)
- **Caching:** Redis / Memory
- **HTTP Client:** node-fetch

**Frontend:**

- **Framework:** React 19 with Hooks
- **Build Tool:** Vite (lightning fast ⚡)
- **Styling:** CSS with custom properties (CSS Variables)
- **Icons:** Lucide React
- **State Management:** React Hooks (useState, useEffect, custom hooks)

**DevOps:**

- **Containerization:** Docker & Docker Compose
- **CI/CD:** GitHub Actions
- **Release Management:** Release Please (automated versioning)
- **Code Quality:** Prettier, ESLint, Husky (pre-commit hooks)

---

## 🗺️ Roadmap

We're constantly improving TMDB Discover+! Here's what's on the horizon:

### 🚧 Planned Features

- [ ] **Import/Export Configurations** - Share catalog setups with friends
- [ ] **Template Library** - Pre-made catalog templates for common use cases
- [ ] **Enhanced Analytics** - View your catalog usage statistics
- [ ] **Multi-language UI** - Support for multiple interface languages
- [ ] **Advanced Sorting** - More sorting options and combinations
- [ ] **Watched History Integration** - Filter out already-watched content
- [ ] **Collections Support** - Create catalogs from TMDB collections

### 💭 Under Consideration

- GraphQL API for advanced integrations
- Mobile app for configuration management
- Collaborative catalogs (share with family/friends)
- Integration with Trakt.tv
- Custom poster/artwork selection

**Want to contribute?** Check out our [Contributing Guide](docs/CONTRIBUTING.md) or [open a discussion](https://github.com/semi-column/tmdb-discover-plus/discussions)!

---

## 🤝 Contributing

We welcome contributions from everyone! Whether you're fixing bugs, adding features, improving docs, or suggesting ideas—your help is appreciated! 🎉

**Quick Links:**

- 📖 [Contributing Guidelines](docs/CONTRIBUTING.md)
- 🐛 [Report a Bug](https://github.com/semi-column/tmdb-discover-plus/issues/new?template=bug_report.yml)
- ✨ [Request a Feature](https://github.com/semi-column/tmdb-discover-plus/issues/new?template=feature_request.yml)
- 💬 [Join Discussions](https://github.com/semi-column/tmdb-discover-plus/discussions)
- 🔒 [Security Policy](docs/SECURITY.md)

### How to Contribute

1. 🍴 Fork the repository
2. 🔧 Create your feature branch (`git checkout -b feature/amazing-feature`)
3. 💻 Make your changes and test them
4. 📝 Commit using [Conventional Commits](https://conventionalcommits.org/) (`git commit -m 'feat: add amazing feature'`)
5. 🚀 Push to your branch (`git push origin feature/amazing-feature`)
6. 🎉 Open a Pull Request

**First-time contributor?** Look for issues labeled [`good first issue`](https://github.com/semi-column/tmdb-discover-plus/labels/good%20first%20issue)!

---

## 💬 Community & Support

### Get Help

- 💬 **[Discord Server](https://discord.gg/X2N3btmEG2)** - Real-time chat and support
- 🗣️ **[GitHub Discussions](https://github.com/semi-column/tmdb-discover-plus/discussions)** - Q&A and ideas
- 🐛 **[Issue Tracker](https://github.com/semi-column/tmdb-discover-plus/issues)** - Bug reports
- 📖 **[Documentation](https://github.com/semi-column/tmdb-discover-plus#readme)** - This README

### Stay Updated

- ⭐ **Star the repo** to get notifications for new releases
- 👀 **Watch releases** on GitHub
- 🐦 Follow development progress in [GitHub Projects](https://github.com/semi-column/tmdb-discover-plus/projects)

### Community Guidelines

We're committed to providing a welcoming and inspiring community for all. Please review our:

- 📜 [Code of Conduct](docs/CODE_OF_CONDUCT.md)
- 🛡️ [Security Policy](docs/SECURITY.md)
- 🤝 [Contributing Guidelines](docs/CONTRIBUTING.md)

---

## ⭐ Star History

[![Star History Chart](https://api.star-history.com/svg?repos=semi-column/tmdb-discover-plus&type=Date)](https://star-history.com/#semi-column/tmdb-discover-plus&Date)

<p align="center">
  <em>Help us grow by starring the repository! ⭐</em>
</p>

---

## 🔗 Related Projects & Ecosystem

### Recommended Stremio Addons

These addons work great with TMDB Discover+:

- **[Torrentio](https://torrentio.strem.fun/)** - Torrent streams
- **[The Movie Database +](https://94c8cb9f702d-tmdb.baby-beamup.club/)** - TMDB metadata addon
- **[Comet](https://github.com/g0ldyy/comet)** - Debrid streams
- **[MediaFusion](https://mediafusion.elfhosted.com/)** - Multiple streaming sources

### Useful Tools

- **[TMDB](https://www.themoviedb.org/)** - Browse and discover content
- **[RPDB](https://ratingposterdb.com/)** - High-quality posters
- **[Stremio Community](https://www.reddit.com/r/StremioAddons/)** - Reddit community

> **Note:** TMDB Discover+ is a catalog addon. You need stream addons (like Torrentio) to actually watch content!

---

## 📊 Project Stats

<p align="center">
  <img src="https://img.shields.io/github/repo-size/semi-column/tmdb-discover-plus?style=flat-square&label=Repo%20Size" alt="Repo Size" />
  <img src="https://img.shields.io/github/languages/top/semi-column/tmdb-discover-plus?style=flat-square" alt="Top Language" />
  <img src="https://img.shields.io/github/commit-activity/m/semi-column/tmdb-discover-plus?style=flat-square&label=Commit%20Activity" alt="Commit Activity" />
  <img src="https://img.shields.io/github/last-commit/semi-column/tmdb-discover-plus?style=flat-square&label=Last%20Commit" alt="Last Commit" />
</p>

---

## 📄 License

This project is licensed under the **MIT License** - see the [LICENSE](LICENSE) file for details.

---

## ⚠️ Disclaimer

This project is **not affiliated with, endorsed by, or sponsored by** The Movie Database (TMDB) or Stremio.

- All product names, logos, and brands are property of their respective owners
- This addon uses the TMDB API for metadata but is an independent, community-driven project
- Users are responsible for complying with TMDB's Terms of Service and API usage guidelines
- The developers assume no responsibility for any misuse of this software or violation of third-party terms of service
- This addon provides catalog discovery only—streaming content depends on your other Stremio addons

**Use responsibly and respect content creators!**

---

## 🙏 Credits & Acknowledgments

Built with amazing open-source technologies and services:

- **[TMDB](https://www.themoviedb.org/)** - The Movie Database API for comprehensive metadata
- **[Stremio](https://www.stremio.com/)** - The media center platform that makes it all possible
- **[Lucide](https://lucide.dev/)** - Beautiful, consistent icons
- **[ElfHosted](https://elfhosted.com/)** - Reliable hosting for the stable instance
- **[BeamUp](https://beamup.dev/)** - Stremio's official hosting platform for the nightly instance
- **[RPDB](https://ratingposterdb.com/)** - High-quality posters and ratings

Special thanks to:

- All our [contributors](https://github.com/semi-column/tmdb-discover-plus/graphs/contributors) who help improve this project
- The Stremio community for their support and feedback
- Everyone who has starred, shared, or sponsored this project

Made possible by the open-source community! ❤️

---

<p align="center">
  Made with ❤️ by the TMDB Discover+ community
</p>
