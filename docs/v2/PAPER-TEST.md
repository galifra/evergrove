# Paper test (TP0)

Twelve scenarios walked through the version 2 specs before any code. Each records what happens and any gap the walk found. Every gap is now written into the spec it belongs to and has a test in a later phase.

| # | Scenario | What the specs say happens | Gap found and fix |
| --- | --- | --- | --- |
| 1 | Open `/money` from a bookmark | The generator made `/money/index.html`; the shell loads only Money's screen; the service worker has it cached | A brand-new browser landing on `/money` has no data and is not onboarded. **Fix:** onboarding is part of the shared shell, so every entry shows it first (ARCHITECTURE, Build). Test in Phase 2 |
| 2 | Log a workout in `/body` while `/jarvis` is open in another window | Same address, same database, broadcast channel: Jarvis's copy of the log updates at once | Jarvis's home (Today list and notes) must recompute when the log changes, not only on load. **Fix:** the Jarvis home subscribes to the log. Test in Phase 4 |
| 3 | Tell Jarvis to add a task and see it in `/tasks` | The action appends an event to the shared log; `/tasks` derives from the same log | None |
| 4 | A bill goes overdue | `bill.overdue` fires (priority 1, private). The Today card also lists it | Duplicate information. **Fix:** Today lists facts, the note adds the offer ("Mark paid?" or "Move the due date?"); a note never repeats a Today line word for word (FEEDBACK-SPEC). Test in Phase 7 |
| 5 | Two things to say but the limit is one | Sort by priority, then time-sensitive before pattern, then oldest; show the first; only shown notes are recorded (`note.shown`), so the other is still eligible next time | None. Test in Phase 7 |
| 6 | You mark a note "not useful" | `feedback.given` mutes that observation id for 30 days, on every device | No way to undo a mute. **Fix:** a "Muted notes" list in Jarvis settings with an Unmute button (FEEDBACK-SPEC). Test in Phase 7 |
| 7 | "Remember I run best in the morning" | Local command saves a `memory.noted` directly | "Remember to call mom" means a task, not a fact. **Fix:** the local command handles only "remember that ...", "remember: ...", and "remember I/my/we/he/she/they ..." (MEMORY-SPEC). "Remember to ..." goes to the assistant as a task. Test in Phase 6 |
| 8 | "Forget that" | Needs something to point at | **Fix:** "that" means the note saved most recently in this chat; with no such note or with several matches, he lists them and asks which (MEMORY-SPEC). Test in Phase 6 |
| 9 | The AI cap reaches 80% | Optional AI (polish, opinions) stops; chat continues | The client's idea of the spend could be stale. **Fix:** requests carry `purpose: "chat" or "optional"` and the **server** refuses optional ones past 80% (COST-PLAN). Test in Phase 8 |
| 10 | The cap is reached | Server hard stop; local commands, templates, notes and all apps keep working | None (already true in version 1); test extended in Phase 8 |
| 11 | The old notification link `/#/jarvis/brief` is tapped | The device still runs the old worker, which opens `/#/jarvis/brief`; the shell redirects it to `/jarvis/brief` | None once the redirect exists. Test in Phase 2 |
| 12 | A deploy happens while a tab is open | Full page loads always get the new version. A screen loaded lazily inside an already-open app can hit a file that no longer exists | **Fix:** a global handler reloads the page when a lazy file fails to load, and the worker keeps old files until the new worker takes over. Test in Phase 2 |
