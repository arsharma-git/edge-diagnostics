# Edge Diagnostics Backend

A Node.js/Express backend service for Akamai edge diagnostics, error translation, and failover page delivery with integrated diagnostic testing capabilities.

## Overview

This service provides:
- **Error Translation**: Converts Akamai error reference IDs into detailed diagnostics via the Edge Diagnostics API [5]
- **Geolocation Lookup**: Enriches IP addresses with geographic data [5]
- **Diagnostic Tests**: Executes dig, curl, mtr, and DNS resolve commands with SSRF protection [6]
- **Session Management**: Tracks error sessions and diagnostic test results in SQLite [1]
- **Failover Pages**: Injects custom error pages on 5xx responses [18][19]
- **Reporting**: Generates summaries and exports diagnostic data [14]

## Architecture

### Core Components

| Component | Purpose | Reference |
|-----------|---------|-----------|
| **Database** | SQLite with WAL mode for sessions, tests, and webhooks [1] |
| **Server** | Express.js HTTP server with trust proxy and rate limiting [4] |
| **Akamai API** | Edge Diagnostics error-translator and geo-location services [5] |
| **Diagnostics** | Network diagnostic tools (dig, curl, mtr, resolve) [6] |
| **Auth** | API key validation via x-api-key header [8] |
| **Logging** | Pino logger with pretty-printing [10] |

### Database Schema [1]

```sql
sessions (id, reference_error_id, http_status, error_class, 
          origin_hostname, edge_ip, edge_location, client_ip, outcome, ...)

tests (id, session_id, test_type, target, success, duration_ms, result_json, ...)

webhooks (id, source, payload_json, session_id, ...)