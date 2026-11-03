# Contributing to TMDB Discover+

Thank you for your interest in contributing to TMDB Discover+! This document provides guidelines and information for contributors.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [How to Contribute](#how-to-contribute)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

This project adheres to a code of conduct. By participating, you are expected to:

- Be respectful and inclusive
- Welcome newcomers and help them get started
- Focus on constructive feedback
- Accept responsibility for mistakes and learn from them

## Getting Started

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/tmdb-discover-plus.git
   cd tmdb-discover-plus
   ```
3. **Add the upstream remote**:
   ```bash
   git remote add upstream https://github.com/semi-column/tmdb-discover-plus.git
   ```

## Development Setup

### Prerequisites

- Node.js 22.16+ (Node.js 24 recommended, as used in CI)
- npm
- A TMDB API key (free from [TMDB](https://www.themoviedb.org/settings/api))

### Installation

```bash
# Install locked dependencies
npm ci
npm --prefix server ci
npm --prefix client ci

# Copy environment file
cp .env.example .env

```

Edit `.env`: set `NODE_ENV=development`, generate separate valid
`JWT_SECRET` and `ENCRYPTION_KEY`, and
configure your database/cache. For a disposable local test use
`DATABASE_DRIVER=memory`, `CACHE_DRIVER=memory`, `REDIS_URL=`, `OBS_REDIS_URL=`,
`TRUST_PROXY=0`, and `BASE_URL=http://localhost:5173`.

From the repository root, start the backend:

```bash
node --env-file=.env --experimental-strip-types --watch server/src/index.ts
```

In another terminal:

```bash
npm run dev:client
```

This provides:

- Frontend at http://localhost:5173 (with hot reload)
- Backend at http://localhost:7000 (with watch mode)
- Admin UI at http://localhost:5173/admin.html when admin credentials are configured

`npm run dev` also exists, but changes the backend's working directory to
`server/`, so the root `.env` is not read by default. On POSIX, use
`DOTENV_CONFIG_PATH=../.env npm run dev`, or export settings before launch.
See [self-hosting](self-hosting.md) and [environment settings](environment.md).

### Running Tests

```bash
# Run from repository root
npm --prefix server test
npm --prefix server run typecheck
npm --prefix client test
npm --prefix client run lint
npm --prefix client run build
```

History backend contract tests always cover memory. Set
`OBS_HISTORY_TEST_POSTGRES` and/or `OBS_HISTORY_TEST_MONGO` to dedicated test
services for the real adapters; the test suite creates/deletes its own schema or
database. Never point it at production.

`npm run test:integration` starts a backend and runs live checks (default
`http://localhost:7000`, with test URL overrides via `TEST_BASE_URL`). It loads
`server/.env` and needs the credentials required by the tests. Use
`SKIP_SERVER=1` only to target an existing **test** server. Do not point these
checks at production or your normal development data. They are not a replacement
for the Vitest suites.

## How to Contribute

### Types of Contributions

- 🐛 **Bug fixes** - Fix issues and improve stability
- ✨ **Features** - Add new functionality
- 📝 **Documentation** - Improve docs, fix typos, add examples
- 🎨 **UI/UX** - Improve the user interface
- ⚡ **Performance** - Optimize code and reduce resource usage
- 🔒 **Security** - Fix vulnerabilities and improve security

### Contribution Workflow

1. **Create a branch** for your changes:

   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/issue-description
   ```

2. **Make your changes** following our [coding standards](#coding-standards)

3. **Test your changes** locally

4. **Commit your changes** with a clear message:

   ```bash
   git commit -m "feat: add new filter option for runtime"
   # or
   git commit -m "fix: resolve pagination issue in catalog"
   ```

5. **Push to your fork**:

   ```bash
   git push origin feature/your-feature-name
   ```

6. **Open a Pull Request** against the `main` branch

## 🚀 Automated Releases

This project uses [release-please](https://github.com/googleapis/release-please) to automate releases.

- **Pull Requests**: Use [Conventional Commits](https://www.conventionalcommits.org/) (e.g., `feat:`, `fix:`) in your PR titles.
- **Release PR**: When changes are merged to `main`, an automated "Release PR" will be created/updated.
- **Deployment**: Merging the Release PR will automatically:
  - Tag the release (e.g., `v2.4.0`)
  - Update `CHANGELOG.md`
  - Update versions in root, `client/`, and `server/` `package.json` files
  - Create a GitHub Release with compiled release notes

Please **do not** manually update version numbers or create tags.

## Pull Request Process

1. **Fill out the PR template** completely
2. **Link any related issues** using keywords (e.g., "Fixes #123")
3. **Ensure all relevant checks pass** (server/client tests, typecheck, lint, and client build)
4. **Request a review** from maintainers
5. **Address feedback** promptly and respectfully
6. **Squash commits** if requested before merging

### PR Title Format

Use conventional commit format:

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation only
- `style:` Code style (formatting, semicolons, etc.)
- `refactor:` Code refactoring
- `perf:` Performance improvement
- `test:` Adding tests
- `chore:` Maintenance tasks

## Coding Standards

### JavaScript/TypeScript

- Use ES modules (`import`/`export`)
- The backend runs TypeScript directly with Node's type stripping; preserve explicit `.ts` imports and erasable syntax
- Use `const` by default, `let` when reassignment is needed
- Avoid `var`
- Use async/await over raw promises
- Add JSDoc comments for functions

### React

- Use functional components with hooks
- Keep components small and focused
- Use descriptive prop names
- Extract reusable logic into custom hooks

### CSS

- Use CSS custom properties (variables) for theming
- Follow BEM-like naming for class names
- Keep specificity low

### General

- Keep functions small and focused (single responsibility)
- Add meaningful comments for complex logic
- Handle errors gracefully
- Log appropriately (use the logger, not console.log)

### File Structure

```
server/src/
├── routes/      # Express route handlers
├── services/    # Business logic
├── models/      # Database models
└── utils/       # Utility functions

client/src/
├── components/  # React components
├── hooks/       # Custom React hooks
├── services/    # API client
└── styles/      # CSS files
```

## Reporting Bugs

When reporting bugs, please include:

1. **Description** - Clear description of the bug
2. **Steps to Reproduce** - How to trigger the bug
3. **Expected Behavior** - What should happen
4. **Actual Behavior** - What actually happens
5. **Environment** - OS, Node.js version, browser
6. **Screenshots** - If applicable
7. **Logs** - Relevant error messages or logs

Use the bug report issue template when available.

## Suggesting Features

When suggesting features:

1. **Check existing issues** - Avoid duplicates
2. **Describe the problem** - What need does this address?
3. **Propose a solution** - How would it work?
4. **Consider alternatives** - Other ways to solve it?
5. **Additional context** - Mockups, examples, etc.

Use the feature request issue template when available.

## Questions?

Feel free to:

- Open a GitHub Discussion for questions
- Comment on relevant issues
- Reach out to maintainers

Thank you for contributing! 🎉
