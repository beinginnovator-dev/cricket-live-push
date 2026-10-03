/**
 * Simple robust WebSocket client with auto-reconnect
 */
export class LiveSocket {
  constructor({ matchId, onMessage, onStatus }) {
    this.matchId = matchId || "default";
    this.onMessage = onMessage || (() => {});
    this.onStatus = onStatus || (() => {});
    this.ws = null;
    this.reconnectDelay = 1000;
    this.shouldReconnect = true;
    this.viewerId = localStorage.getItem("viewerId") || crypto.randomUUID().slice(0, 10);
    localStorage.setItem("viewerId", this.viewerId);
    this.name = localStorage.getItem("viewerName") || "";
  }

  connect() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const url = `${proto}://${location.host}/ws?match=${encodeURIComponent(this.matchId)}`;

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      this.reconnectDelay = 1000;
      this.onStatus("live");
      this.send({
        type: "join",
        role: "viewer",
        name: this.name || "Fan",
        viewerId: this.viewerId,
      });
    };

    this.ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);
        this.onMessage(msg);
      } catch (e) {
        console.warn("Bad message", e);
      }
    };

    this.ws.onclose = () => {
      this.onStatus("reconnect");
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
        this.reconnectDelay = Math.min(this.reconnectDelay * 1.6, 12000);
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendEmoji(emoji) {
    this.send({ type: "emoji", emoji, from: this.name || "Fan" });
  }

  sendChat(text) {
    this.send({ type: "chat", text, from: this.name || "Fan" });
  }

  close() {
    this.shouldReconnect = false;
    if (this.ws) this.ws.close();
  }
}
