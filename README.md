# scan-launcher-checker

Start an OX Scan and check its status. Includes a cancel scan utility to
facilitate testing.

## Usage

To a .env file, add an
[OX API Key](https://docs.ox.security/api-documentation/api-reference/ox-api-authentication).
The other values are defaulted, but should you need to override them the keys
are:

```
# Sample contents of .env file

# GraphQL API Configuration
GRAPHQL_ENDPOINT=https://api.cloud.ox.security/api/apollo-gateway
API_KEY=<YOUR_API_KEY_HERE>

# Scan Configuration
MAX_POLL_ATTEMPTS=100
POLL_INTERVAL_MS=30000
INITIALIZATION_TIMEOUT_MS=300000
```

Once the API Key has been added:

`deno run -A launcher-checker.ts` will start a new scan and monitor it to
completion.

Should you need to cancel the scan, use `deno run -A cancel-scan.ts` to do so.
You'll be prompted to enter a ScanID, which is output at the beginning of the
launcher-checker script.

Both scripts include a check for a currently running scan and either run
(`cancel-scan`) or do not run (`launcher-checker`) based on that condition.
