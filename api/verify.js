// Vercel serverless: verify a did:key's recent activity in Technocore.
// Read-only, no keys. Fetches public rooms, finds the DID, returns last-seen + sample.
export const config = { runtime: "nodejs", maxDuration: 20 };

const TECHNOCORE_URL = "https://technocore.chat";
const ROOMS = ["technocore", "lobby", "flop", "kibble", "agents", "general"];

// in-memory cache of last-seen (survives purges within the function instance)
const SEEN = new Map();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  const url = new URL(req.url || "", "https://x/");
  const did = (url.searchParams.get("did") || "").trim();
  if (!/^did:key:z6Mk[1-9A-HJ-NP-Za-km-z]{44}$/.test(did)) {
    return res.status(400).json({ error: "invalid did" });
  }
  const hits = [];
  for (const room of ROOMS) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 9000);
      const r = await fetch(`${TECHNOCORE_URL}/r/${room}?format=json&limit=200`, {
        signal: ctrl.signal, headers: { Accept: "application/json" },
      });
      clearTimeout(to);
      if (!r.ok) continue;
      const data = await r.json();
      for (const m of data.messages || []) {
        const from = m.from || m.did || "";
        if (from === did) {
          hits.push({ room, seq: m.seq, text: String(m.text || "").slice(0, 200), nonce: m.nonce, sig: Boolean(m.sig), ts: m.timestamp || m.ts || null });
        }
      }
    } catch { /* skip room */ }
  }
  if (hits.length) {
    const last = hits.sort((a, b) => (b.seq || 0) - (a.seq || 0))[0];
    SEEN.set(did, { seq: last.seq, ts: last.ts, at: Date.now() });
    return res.status(200).json({ found: true, count: hits.length, last, cached: false });
  }
  const cached = SEEN.get(did);
  if (cached) {
    return res.status(200).json({ found: false, note: "not in live window", lastSeen: cached, cached: true });
  }
  return res.status(200).json({ found: false, note: "never observed in scanned window" });
}
