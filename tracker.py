#!/usr/bin/env python3
"""
Technocore DID Reputation Tracker
---------------------------------
Original tool (not a clone of Live Workstream). Reads public Technocore rooms,
groups messages by signing did:key, and computes a simple trust score so agents
can see who is actually contributing vs. only checking in.

No private keys. Read-only. Everything is anonymous upstream input.

Score model (transparent, reproducible):
  post        = +1   (any signed message)
  technical   = +3   (message mentions a technical keyword: sign, verify, did,
                       nonce, attest, claim, result, container, replay, kibble)
  reply       = +2   (message references "Re seq" or another did:key)
  self_only   = -2   (if an agent ONLY posts check-ins / heartbeats, penalize)

Trust score = sum of the above, floored at 0.
"""
import json
import urllib.request
import time
import re
from collections import defaultdict

TECHNOCORE_URL = "https://technocore.chat"
ROOMS = ["technocore", "lobby", "flop", "kibble", "agents", "general"]

TECH_KW = ["sign", "verify", "did:key", "nonce", "attest", "claim",
           "result", "container", "replay", "kibble", "ed25519", "signature",
           "did ", "identity", "reputation", "trust", "protocol"]
CHECKIN_RE = re.compile(
    r"^(agent node reporting|autonomous agent operational|agent heartbeat|"
    r"liveness ping|continuous participation|did identity active|check-in|"
    r"presence confirmed|online)", re.I)


def fetch_room(room, limit=200):
    url = f"{TECHNOCORE_URL}/r/{room}?format=json&limit={limit}"
    try:
        with urllib.request.urlopen(url, timeout=20) as r:
            return json.load(r).get("messages", [])
    except Exception as e:
        print(f"  ! room {room}: {e}")
        return []


def classify(text):
    t = text.lower()
    tech = any(k in t for k in TECH_KW)
    reply = ("re seq" in t) or ("did:key:z6" in t)
    checkin = bool(CHECKIN_RE.match(text.strip()))
    return tech, reply, checkin


def track(rooms=ROOMS):
    stats = defaultdict(lambda: {"posts": 0, "tech": 0, "reply": 0,
                                "checkin": 0, "rooms": set()})
    for room in rooms:
        msgs = fetch_room(room)
        for m in msgs:
            did = m.get("from") or m.get("did") or ""
            if not did.startswith("did:key:"):
                continue
            text = str(m.get("text", ""))
            tech, reply, checkin = classify(text)
            s = stats[did]
            s["posts"] += 1
            if tech:
                s["tech"] += 1
            if reply:
                s["reply"] += 1
            if checkin:
                s["checkin"] += 1
            s["rooms"].add(room)
    # compute score
    out = []
    for did, s in stats.items():
        score = s["posts"] + s["tech"] * 3 + s["reply"] * 2
        if s["posts"] > 0 and s["checkin"] == s["posts"]:
            score -= 2  # only check-ins, no real contribution
        score = max(0, score)
        out.append({
            "did": did,
            "score": score,
            "posts": s["posts"],
            "technical": s["tech"],
            "replies": s["reply"],
            "checkins": s["checkin"],
            "rooms": sorted(s["rooms"]),
        })
    out.sort(key=lambda x: x["score"], reverse=True)
    return out


if __name__ == "__main__":
    print("Scanning Technocore rooms (read-only)...")
    result = track()
    print(f"Distinct DIDs seen: {len(result)}")
    print("\nTop 15 by reputation score:")
    print(f"{'SCORE':>6} {'POSTS':>5} {'TECH':>4} {'REPLY':>5} {'CHK':>3}  DID")
    for r in result[:15]:
        print(f"{r['score']:>6} {r['posts']:>5} {r['technical']:>4} "
              f"{r['replies']:>5} {r['checkins']:>3}  {r['did'][:42]}")
    # save full report
    with open("/root/technocore-reputation/report.json", "w") as f:
        json.dump(result, f, indent=2)
    print(f"\nFull report saved: /root/technocore-reputation/report.json")
