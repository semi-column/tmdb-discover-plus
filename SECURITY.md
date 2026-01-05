# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.5.x   | :white_check_mark: |
| < 1.5   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **DO NOT** open a public GitHub issue for security vulnerabilities
2. Email the maintainers directly or use GitHub's private vulnerability reporting
3. Include as much detail as possible:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Acknowledgment**: Within 48 hours
- **Initial Assessment**: Within 7 days
- **Resolution Timeline**: Depends on severity
  - Critical: 24-72 hours
  - High: 1-2 weeks
  - Medium: 2-4 weeks
  - Low: Next release

### After Reporting

1. We will investigate and validate the issue
2. We will work on a fix
3. We will release a patched version
4. We will credit you (unless you prefer anonymity)

## Security Best Practices for Users

### Self-Hosting

1. **Use HTTPS** - Always deploy behind a reverse proxy with TLS
2. **Set CORS** - Configure `CORS_ORIGIN` to your specific domain
3. **Use MongoDB Atlas** - Free tier includes encryption at rest
4. **Keep Updated** - Regularly update to the latest version
5. **Environment Variables** - Never commit `.env` files

### API Keys

- Your TMDB API key is stored securely in MongoDB
- Keys are never logged (sanitized automatically)
- Use separate keys for development and production

## Known Security Considerations

### Rate Limiting

API endpoints are rate-limited to 100 requests per minute per IP. This can be disabled via `DISABLE_RATE_LIMIT=true` for trusted environments.

### TLS Verification

TLS certificate verification is enabled by default. Only disable (`DISABLE_TLS_VERIFY=true`) if behind a corporate proxy with SSL inspection.

### Debug Endpoint

The `/api/debug/config/:userId` endpoint is disabled in production mode (`NODE_ENV=production`).

## Scope

### In Scope

- Authentication/authorization bypasses
- Data exposure vulnerabilities
- Injection attacks (SQL, NoSQL, XSS)
- Server-side request forgery (SSRF)
- Denial of service (within reason)

### Out of Scope

- Rate limiting effectiveness
- TMDB API security (report to TMDB)
- Social engineering
- Physical attacks
- Attacks requiring user interaction
