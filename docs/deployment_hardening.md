# Deployment Hardening

## Overview
This document outlines the security best practices and deployment hardening strategies for Fathom, focusing on protecting environment variables, secure configurations in CI, and cloud deployment.

## Environment Variable Protection
- **Never Commit Secrets:** Do not commit `.env`, `.env.live`, or any file containing API keys, private keys, or wallet credentials to version control.
- **Environment Management:** Use secure secret management tools (e.g., GitHub Secrets, AWS Secrets Manager, Cloudflare Workers Secrets) to inject environment variables at runtime.
- **No Console Logging:** Sensitive environment variables must never be printed or logged in the console output.
- **Local Development:** Developers should use standard `.env` templates (with dummy values) to set up their local environments securely.

## CI/CD Security Best Practices
- **Least Privilege Access:** Ensure CI pipelines run with the minimum necessary permissions. Limit access to cloud deployment roles and artifact repositories.
- **Secret Masking:** Ensure that the CI environment masks secrets in the build and deployment logs.
- **Approval Workflows:** Require manual approvals for deploying to production environments to prevent unintended releases.
- **Dependency Scanning:** Use automated tools to scan for vulnerable dependencies before merging changes.

## Cloud Deployment Best Practices
- **Network Security:** Restrict inbound and outbound network access where possible. Use Web Application Firewalls (WAF) and DDoS protection services.
- **HTTPS Only:** Enforce TLS 1.2+ for all communication with API endpoints. Ensure that non-HTTPS traffic is redirected or rejected.
- **Rate Limiting:** Implement strict rate limiting on public-facing endpoints (e.g., health checks and external APIs) to prevent abuse and brute force attacks.
- **Monitoring and Alerts:** Set up alerts for unusual traffic patterns, multiple failed requests, and internal server errors. Monitor CI deployment logs securely.
