# Cricket PWA – Full package with Push (WebSocket)

This is your **original** Scorer + Live app, with Push upgrades applied.

## What’s included

| Path | Description |
|------|-------------|
| `public/index.html` | Your full **Scorer** app |
| `public/live.html` | Your full **Live** viewer + WebSocket score push |
| `worker.js` | LiveRoom DO + score broadcast on every ball |
| manifests, icons, sw, `_headers` | Same as your project |
| `wrangler.toml` / `wrangler.jsonc` | Uses `exports` (no migrations) |

## URLs after deploy

- Scorer: `https://YOUR-WORKER.workers.dev/` or `/index.html`
- Live:   `https://YOUR-WORKER.workers.dev/live.html?match=MATCH_ID`

## Push behaviour

- Scorer posts a ball → worker stores it and **broadcasts** to all Live WebSockets for that match
- Live page connects to `/ws?match=...` and updates instantly
- Polling remains as slow backup (8s) if WebSocket drops

## Deploy (phone / GitHub)

1. Upload **all files** from this zip into your GitHub repo (replace existing)
2. Commit + push `main`
3. Cloudflare Workers/Pages linked to the repo will redeploy automatically  
   **or** run `npx wrangler deploy` from a computer

## Important

- Use the **same** match id on Scorer and Live
- Hard-refresh Live after first deploy (clear cache once)
- Do **not** deploy the small “cricket-live-push” demo package — that was only a minimal example
