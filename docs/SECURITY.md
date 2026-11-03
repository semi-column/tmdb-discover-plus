# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 2.x     | :white_check_mark: |
| 1.5.x   | :white_check_mark: |
| < 1.5   | :x:                |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability, please report it responsibly.

### How to Report

1. **DO NOT** open a public GitHub issue for security vulnerabilities
2. **Preferred**: Use [GitHub's private vulnerability reporting](https://github.com/semicolumn/tmdb-discover-plus/security/advisories/new)
3. **Alternative**: Email the maintainers directly
4. Include as much detail as possible:
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

API/general routes are limited to 300 requests per minute per IP, with stricter
60/min limits on sensitive endpoints. Configured addon resources instead use
1,000/min per existing configuration and a 3,000/min IP ceiling; invalid IDs
have a separate 30/min IP budget. Uncached addon work uses bounded per-user and
global admission while cached responses remain available. With Redis configured,
active work leases and TMDB outbound rate/pause budgets are shared across replicas;
without Redis, these budgets are process-local. Shared admission failures stop new
expensive work rather than falling back to independent replica budgets.

`DISABLE_RATE_LIMIT=true` is honored only in development/test, not production;
work admission remains enabled. These application controls do not replace
edge-level DDoS protection. Restrict origin access and trust only your actual
proxies. See [request protection](self-hosting.md#request-protection-and-monitoring).

### TLS Verification

TLS certificate verification is always enabled. Configure trusted corporate proxy certificates with Node's `NODE_EXTRA_CA_CERTS` when needed.

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
