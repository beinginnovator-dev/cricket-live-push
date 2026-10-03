import { DurableObject } from "cloudflare:workers";
import type { MatchState, ClientMessage, ServerMessage } from "./types";

interface Session {
  ws: WebSocket;
  role: "viewer" | "scorer";
  name: string;
  viewerId: string;
  joinedAt: number;
}

export class MatchDO extends DurableObject {
  private sessions: Map<WebSocket, Session> = new Map();
  private state: MatchState;

  constructor(ctx: DurableObjectState, env: any) {
    super(ctx, env);

    // Default empty state – will be overwritten by first scorer update
    this.state = {
      matchId: "unknown",
      status: "upcoming",
      battingTeam: "Team A",
      bowlingTeam: "Team B",
      runs: 0,
      wickets: 0,
      overs: "0.0",
      ballsInOver: 0,
      thisOver: [],
      target: null,
      innings: 1,
      lastEvent: null,
      updatedAt: Date.now(),
    };

    // Restore from storage if available
    this.ctx.blockConcurrencyWhile(async () => {
      const saved = await this.ctx.storage.get<MatchState>("match");
      if (saved) this.state = saved;
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // WebSocket upgrade
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);

      // Temporary session until "join" message arrives
      this.sessions.set(server, {
        ws: server,
        role: "viewer",
        name: "Anonymous",
        viewerId: crypto.randomUUID().slice(0, 8),
        joinedAt: Date.now(),
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    // Simple HTTP health / current state (optional)
    if (url.pathname.endsWith("/state")) {
      return Response.json({
        ok: true,
        state: this.state,
        viewers: this.viewerCount(),
      });
    }

    return new Response("Expected WebSocket", { status: 400 });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const data = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message)) as ClientMessage;
      const session = this.sessions.get(ws);
      if (!session) return;

      switch (data.type) {
        case "join":
          session.role = data.role || "viewer";
          session.name = (data.name || "Anonymous").slice(0, 24);
          if (data.viewerId) session.viewerId = data.viewerId;

          // Send current state immediately
          this.send(ws, {
            type: "welcome",
            state: this.state,
            viewers: this.viewerCount(),
          });
          this.broadcastViewers();
          break;

        case "ball":
          if (session.role !== "scorer") {
            this.send(ws, { type: "error", message: "Only scorer can send balls" });
            return;
          }
          this.applyBall(data);
          await this.ctx.storage.put("match", this.state);
          this.broadcastScore();
          break;

        case "emoji":
          this.broadcast({
            type: "emoji",
            emoji: data.emoji,
            from: data.from || session.name,
            ts: Date.now(),
          });
          break;

        case "chat":
          this.broadcast({
            type: "chat",
            text: (data.text || "").slice(0, 120),
            from: data.from || session.name,
            ts: Date.now(),
          });
          break;

        case "heartbeat":
          // ignore – just keeps connection warm
          break;
      }
    } catch (err) {
      console.error("WS message error", err);
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.sessions.delete(ws);
    this.broadcastViewers();
  }

  async webSocketError(ws: WebSocket) {
    this.sessions.delete(ws);
    this.broadcastViewers();
  }

  // ---------- Helpers ----------

  private viewerCount() {
    let n = 0;
    for (const s of this.sessions.values()) {
      if (s.role === "viewer") n++;
    }
    return n;
  }

  private send(ws: WebSocket, msg: ServerMessage) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {}
  }

  private broadcast(msg: ServerMessage) {
    const raw = JSON.stringify(msg);
    for (const [ws] of this.sessions) {
      try {
        ws.send(raw);
      } catch {}
    }
  }

  private broadcastScore() {
    this.broadcast({
      type: "score",
      state: this.state,
      viewers: this.viewerCount(),
    });
  }

  private broadcastViewers() {
    this.broadcast({ type: "viewers", count: this.viewerCount() });
  }

  private applyBall(data: { runs: number; event: string; striker?: string }) {
    const runs = Number(data.runs) || 0;
    const event = (data.event || String(runs)).toUpperCase();

    this.state.runs += runs;
    this.state.lastEvent = {
      event,
      runs,
      striker: data.striker,
      ts: Date.now(),
    };

    // Simple over tracking
    const isLegal = !["WD", "NB", "WIDE", "NOBALL"].includes(event);
    if (isLegal) {
      this.state.ballsInOver += 1;
      this.state.thisOver.push(event === "WICKET" || event === "W" ? "W" : String(runs));

      if (this.state.ballsInOver >= 6) {
        this.state.ballsInOver = 0;
        this.state.thisOver = [];
        // increment overs
        const [o, b] = this.state.overs.split(".").map(Number);
        this.state.overs = `${(o || 0) + 1}.0`;
      } else {
        const [o] = this.state.overs.split(".").map(Number);
        this.state.overs = `${o || 0}.${this.state.ballsInOver}`;
      }
    } else {
      this.state.thisOver.push(event);
    }

    if (event === "WICKET" || event === "W") {
      this.state.wickets += 1;
    }

    this.state.updatedAt = Date.now();
    this.state.status = "live";
  }
}
