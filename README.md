# Cricket PWA — fix v3 (deploy + live sync)

## Deploy error you hit

```
This Worker was last deployed using the declarative `exports` flow;
reverting to `migrations` is not supported. [code: 100403]
```

**Fix:** `wrangler.toml` / `wrangler.jsonc` now use `exports` (not `migrations`).

## Also fixed (live scores)

- `run_worker_first = true` so API is not blocked by static `live.html`
- Live API at `/api/live` and `/api/live-public`
- Scorer + viewer updated to those paths

## Replace on GitHub

| File | Repo path |
|------|-----------|
| `wrangler.toml` | `wrangler.toml` |
| `wrangler.jsonc` | `wrangler.jsonc` |
| `worker.js` | `worker.js` |
| `public/index.html` | `public/index.html` |
| `public/live.html` | `public/live.html` |
| `public/manifest.json` | `public/manifest.json` |
| `public/sw.js` | `public/sw.js` |
| `public/icon-*.png` | `public/icon-*.png` |

Commit + push `main` → redeploy.

## After green deploy

```bash
curl -s -X POST 'https://cricket-pwa-cloudflare.being-innovator.workers.dev/api/live?match=test1' \
  -H 'Content-Type: application/json' \
  -H 'X-Publisher-Key: PUBLISH_2026' \
  -d '{"ts":1,"runs":3,"wickets":0,"balls":2,"teamA":"A","teamB":"B"}'
# expect {"ok":true,"updatedAt":...}

curl -s 'https://cricket-pwa-cloudflare.being-innovator.workers.dev/api/live-public?match=test1'
# expect runs:3
```

Then hard-refresh scorer, score 1 ball, open a **new** Viewer link.
