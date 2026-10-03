export interface MatchState {
  matchId: string;
  status: "live" | "completed" | "upcoming";
  battingTeam: string;
  bowlingTeam: string;
  runs: number;
  wickets: number;
  overs: string;          // e.g. "12.3"
  ballsInOver: number;
  thisOver: string[];     // ["1","0","4","W"]
  target: number | null;
  innings: 1 | 2;
  lastEvent: {
    event: string;        // "FOUR" | "SIX" | "WICKET" | "1" | "2" | "0" | etc
    runs: number;
    striker?: string;
    ts: number;
  } | null;
  result?: string;
  updatedAt: number;
}

export type ClientMessage =
  | { type: "join"; role: "viewer" | "scorer"; name?: string; viewerId?: string }
  | { type: "ball"; runs: number; event: string; striker?: string; extras?: any }
  | { type: "emoji"; emoji: string; from: string }
  | { type: "chat"; text: string; from: string }
  | { type: "heartbeat" };

export type ServerMessage =
  | { type: "score"; state: MatchState; viewers: number }
  | { type: "emoji"; emoji: string; from: string; ts: number }
  | { type: "chat"; text: string; from: string; ts: number }
  | { type: "viewers"; count: number }
  | { type: "error"; message: string }
  | { type: "welcome"; state: MatchState; viewers: number };
