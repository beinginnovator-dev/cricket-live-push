# Cricket Live Push – Complete Package

Push-based real-time cricket scoring (Scorer + Live Viewer PWAs) on Cloudflare Workers + Durable Objects.

## Features
- **Push architecture** (WebSocket) – no constant polling
- One Durable Object per match
- Live score + animations
- Floating emojis
- Simple chat
- Separate installable PWAs for Scorer and Live
- Works on Cloudflare Free tier for dozens of concurrent viewers

## Quick Start (Local)

```bash
npm install
npx wrangler dev
```

Then open:
- Live:   http://localhost:8787/live/?match=demo1
- Scorer: http://localhost:8787/scorer/?match=demo1

## Deploy via GitHub → Cloudflare (Step-by-step)

See the detailed guide below in this conversation, or follow:

1. Push this folder to a GitHub repo
2. Cloudflare Dashboard → Workers & Pages → Create → Connect Git repo
3. Build settings: leave empty (no build command needed)
4. Deploy

After deploy your URLs will be:
- `https://<worker>.<account>.workers.dev/live/?match=MATCH_ID`
- `https://<worker>.<account>.workers.dev/scorer/?match=MATCH_ID`

## Capacity (Push-based)

| Concurrent Viewers | Free tier | Notes |
|--------------------|-----------|-------|
| 50–150             | Comfortable | Recommended |
| 200–400            | Possible  | Still fine |
| 500+               | Better on Paid ($5) | Very stable |

## Project Structure

```
src/
  index.ts          → Worker entry + routing
  match-do.ts       → Durable Object (state + WebSocket hub)
  types.ts
public/
  live/             → Viewer PWA
  scorer/           → Scorer PWA
wrangler.toml
package.json
```
