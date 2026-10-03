import { MatchDO } from "./match-do";

export { MatchDO };

export interface Env {
  MATCH: DurableObjectNamespace;
  ASSETS: Fetcher;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // ---------- WebSocket endpoint ----------
    // /ws?match=MATCH_ID
    if (url.pathname === "/ws" || url.pathname === "/api/ws") {
      const matchId = url.searchParams.get("match") || "default";

      // One Durable Object per match
      const id = env.MATCH.idFromName(matchId);
      const stub = env.MATCH.get(id);

      return stub.fetch(request);
    }

    // ---------- Optional REST helpers ----------
    if (url.pathname === "/api/state") {
      const matchId = url.searchParams.get("match") || "default";
      const id = env.MATCH.idFromName(matchId);
      const stub = env.MATCH.get(id);
      return stub.fetch(new Request(new URL("/state", request.url), request));
    }

    // ---------- Static assets (Live + Scorer PWAs) ----------
    // Serve from /public
    try {
      return await env.ASSETS.fetch(request);
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  },
};
