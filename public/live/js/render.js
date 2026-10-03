/**
 * UI update helpers
 */
export function updateScore(state) {
  const main = document.getElementById("score-main");
  const overs = document.getElementById("score-overs");
  const batting = document.getElementById("batting-team");
  const bowling = document.getElementById("bowling-team");
  const thisOver = document.getElementById("this-over");
  const chaseEl = document.getElementById("chase");

  if (!main) return;

  main.textContent = `${state.runs} / ${state.wickets}`;
  overs.textContent = `(${state.overs})`;

  if (batting) batting.textContent = state.battingTeam || "Batting";
  if (bowling) bowling.textContent = state.bowlingTeam || "Bowling";

  if (thisOver) {
    thisOver.textContent = "This over: " + (state.thisOver?.length ? state.thisOver.join(" ") : "–");
  }

  // Chase logic (last ~2 overs)
  if (chaseEl && state.target && state.innings === 2) {
    const need = state.target - state.runs;
    const [o, b] = (state.overs || "0.0").split(".").map(Number);
    const ballsBowled = (o * 6) + (b || 0);
    // assume 20-over match for demo – adjust as needed
    const totalBalls = 120;
    const ballsLeft = Math.max(0, totalBalls - ballsBowled);

    if (need > 0 && ballsLeft <= 12) {
      chaseEl.style.display = "block";
      chaseEl.textContent = `Need ${need} runs in ${ballsLeft} balls`;
    } else {
      chaseEl.style.display = "none";
    }
  }
}

export function playAnim(event) {
  const el = document.getElementById("anim-overlay");
  if (!el) return;

  let text = event;
  if (event === "FOUR" || event === "4") text = "FOUR";
  if (event === "SIX" || event === "6") text = "SIX";
  if (event === "WICKET" || event === "W") text = "WICKET";
  if (event === "1" || event === "2" || event === "3") text = event;

  el.textContent = text;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1400);
}

export function spawnEmoji(emoji) {
  const span = document.createElement("div");
  span.className = "emoji-float";
  span.textContent = emoji;
  span.style.left = 15 + Math.random() * 70 + "%";
  document.body.appendChild(span);
  setTimeout(() => span.remove(), 3000);
}

export function addChat(from, text) {
  const box = document.getElementById("chat-box");
  if (!box) return;
  const line = document.createElement("div");
  line.className = "chat-line";
  line.innerHTML = `<span class="from">${from}:</span> ${text}`;
  box.appendChild(line);
  box.scrollTop = box.scrollHeight;
}

export function setStatus(status) {
  const el = document.getElementById("conn-status");
  if (!el) return;
  el.className = "status " + status;
  el.textContent = status === "live" ? "● LIVE" : "Reconnecting…";
}

export function setViewers(n) {
  const el = document.getElementById("viewer-count");
  if (el) el.textContent = n + " watching";
}
