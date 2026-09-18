# Company Nexus contract probe

These are sanitized responses and contract findings recorded on 2026-09-18 for the company
Nexus instance at `https://pkg.in.wezhuiyi.com`. No credential values are recorded.

Observed product information:

- Product: Sonatype Nexus Repository Manager
- Version: `3.47.1-01`
- Edition: OSS
- Source: frontend static asset query (`_v=3.47.1-01&_e=OSS`)

Observed probes:

- `GET /service/rest/v1/status`: HTTP 200, empty body
- `GET /service/rest/v1/status/writable`: HTTP 200, empty body
- `GET /service/rest/v1/repositories/codew-extensions`: HTTP 200, `repository.json`
- `GET /service/rest/v1/search?repository=codew-extensions&format=npm&q=monitor`:
  HTTP 200, `search-monitor.json`; Nexus 3.47 returns npm component group as
  `codew-ext` without the leading `@`, while asset metadata uses `@codew-ext/monitor`.
- `GET /repository/codew-extensions/@codew-ext%2Fexample-extension`: HTTP 404, `packument-not-found.json`

Anonymous read and Search are enabled for this repository. A subsequent controlled
authentication smoke test, performed by an authorized user, confirmed that npm login writes a
URL-scoped `_authToken` and therefore uses the bearer token mode. The user also completed the
packument, Search, streaming download, Store import, provenance, and sanitized-secret checks.
