# Cost plan (P0.9)

The AI cap stays at **$2 a month** (decision D4). Hosting, storage and notifications stay on free tiers.

## Budget by feature

Measured on the 135-phrase routing eval: about **$0.0034 per request** (small model, prompt caching on). Memory and observation context add roughly 400 tokens per request, so the plan assumes $0.004.

| Feature | AI? | Cost |
| --- | --- | --- |
| Chat turn | yes | about $0.004 each |
| Local commands (undo, today, brief, remember, forget, help, clear) | no | $0 |
| Reply templates | no | $0 |
| Observations and notes | no | $0 |
| Evening briefing and Jarvis's note | no | $0 |
| Weekly review (built from templates) | no | $0 |
| Weekly review polish (optional) | yes, 1 per week | about $0.01 a week |
| "What do you think?" | yes, on request | about $0.005 each |
| Spoken replies | no (browser voice) | $0 |
| Log viewer | no | $0 |

At $0.004 a turn, $2 buys about 500 turns a month, roughly 16 a day.

## Ration rules

1. Optional and proactive AI use (weekly polish and any future extras) may use at most 10% of the cap ($0.20).
2. At **80%** of the cap ($1.60) Jarvis stops all optional AI (polish, opinions), says so once ("I'm on a short ration this month"), and keeps answering chat turns and everything that is rule-based.
   Requests carry `purpose: "chat"` or `"optional"`, and the **server** refuses `optional` ones past 80%, so a stale client cannot overspend.
3. At **100%** the existing hard stop applies on the server. Local commands, templates, observations, the briefing and every app keep working.
4. The counter is one shared number for the whole address, so every app and the server agree.

## Simulation (checked by a test)

A heavy month is 15 chat turns a day plus 4 weekly polishes and 8 opinions. At $0.004 a turn that is about $1.88 ($1.80 of chat, $0.04 of polish, $0.04 of opinions), inside the cap. The test fails if the recorded costs change enough to break this.

## Monthly review

The Jarvis settings show spend so far, the cap, the split by feature and the last months, from the usage record. Requests are counted per feature.
