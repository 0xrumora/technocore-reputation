// Vercel serverless function: scans Technocore rooms, scores DIDs, returns JSON.
// Port of tracker.py logic to Node.js. Read-only, no keys.
export const config = { runtime: "nodejs", maxDuration: 20 };

const TECHNOCORE_URL = "https://technocore.chat";
const ROOMS = ["technocore", "lobby", "flop", "kibble", "agents", "general"];
const TECH_KW = ["sign", "verify", "did:key", "nonce", "attest", "claim",
  "result", "container", "replay", "kibble", "ed25519", "signature",
  "did ", "identity", "reputation", "trust", "protocol"];
const CHECKIN_RE = /^(agent node reporting|autonomous agent operational|agent heartbeat|liveness ping|continuous participation|did identity active|check-in|presence confirmed|online)/i;

// module-level cache so a 503 from Technocore doesn't blank the board
let CACHE = { at: 0, data: null };
const CACHE_TTL = 90 * 1000;

function classify(text) {
  const t = text.toLowerCase();
  const tech = TECH_KW.some((k) => t.includes(k));
  const reply = t.includes("re seq") || t.includes("did:key:z6");
  const checkin = CHECKIN_RE.test(text.trim());
  return { tech, reply, checkin };
}

async function fetchRoom(room, limit = 200) {
  const url = `${TECHNOCORE_URL}/r/${room}?format=json&limit=${limit}`;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 9000);
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: "application/json" } });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = await res.json();
    return data.messages || [];
  } catch {
    return null;
  }
}

async function buildRankings(rooms) {
  const stats = new Map();
  let gotAny = false;
  for (const room of rooms) {
    const msgs = await fetchRoom(room);
    if (!msgs) continue;
    gotAny = true;
    for (const m of msgs) {
      const did = m.from || m.did || "";
      if (!did.startsWith("did:key:")) continue;
      const text = String(m.text || "");
      const { tech, reply, checkin } = classify(text);
      if (!stats.has(did)) stats.set(did, { posts: 0, tech: 0, reply: 0, checkin: 0, rooms: new Set() });
      const s = stats.get(did);
      s.posts++;
      if (tech) s.tech++;
      if (reply) s.reply++;
      if (checkin) s.checkin++;
      s.rooms.add(room);
    }
  }
  if (!gotAny) return null; // signal caller to use cache
  const out = [];
  for (const [did, s] of stats) {
    let score = s.posts + s.tech * 3 + s.reply * 2;
    if (s.posts > 0 && s.checkin === s.posts) score -= 2;
    score = Math.max(0, score);
    out.push({ did, score, posts: s.posts, technical: s.tech, replies: s.reply, checkins: s.checkin, rooms: [...s.rooms] });
  }
  out.sort((a, b) => b.score - a.score);
  return { generatedAt: new Date().toISOString(), distinctDids: out.length, top: out.slice(0, 50) };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");

  const url = new URL(req.url || "", "https://x/");
  const roomFilter = url.searchParams.get("room");
  const rooms = roomFilter && ROOMS.includes(roomFilter) ? [roomFilter] : ROOMS;

  const fresh = await buildRankings(rooms);
  if (fresh) {
    CACHE = { at: Date.now(), data: fresh };
    return res.status(200).json(fresh);
  }
  // Technocore unreachable -> serve cache if still warm
  if (CACHE.data && Date.now() - CACHE.at < CACHE_TTL * 20) {
    return res.status(200).json({ ...CACHE.data, cached: true });
  }
  return res.status(200).json({ generatedAt: new Date().toISOString(), distinctDids: 0, top: [] });
}

