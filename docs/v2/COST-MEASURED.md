# Measured cost per request

Real calls on claude-haiku-4-5-20251001, on a well-filled account (tasks, habits, events, bills, a goal, eight notes to remember). Recorded 2026-09-20. `npm run measure` repeats it (about 6 cents).

| Request | Calls | Fresh input | Cache read | Cache write | Output | Average cost | Most expensive |
| --- | --- | --- | --- | --- | --- | --- | --- |
| chat | 10 | 786 | 8582 | 0 | 100 | $0.0021 | $0.0030 |
| weekly | 2 | 741 | 0 | 0 | 90 | $0.0012 | $0.0012 |
| opinion | 3 | 1327 | 0 | 0 | 84 | $0.0017 | $0.0018 |

A chat turn's whole prompt is 9364 to 9374 tokens. The prompt cache was read on 10 of 10 chat turns; the figures above are for those warm turns. The first turn after the cache went cold cost $0.0021 (it writes 0 tokens).
