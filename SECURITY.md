# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Relay AI, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email: **hussain2000.rizvi@gmail.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and aim to release a fix within 7 days for critical issues.

## Supported Versions

| Version | Supported |
|---------|-----------|
| latest  | Yes       |

## Security Considerations

Relay AI handles sensitive data including API keys, OAuth tokens, and user files. Key security measures:

- All API routes require authentication via `requireRequestUser()`
- Request bodies are validated with Zod schemas
- MCP connector tokens are encrypted with AES-256-GCM
- GitHub OAuth tokens are encrypted at rest
- E2B sandboxes provide isolation for code execution
- File uploads are scoped to the owning user's conversation
