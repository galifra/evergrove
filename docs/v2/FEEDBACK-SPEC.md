# Feedback spec (P0.8)

Jarvis gives feedback in three ways: a note when you open him (and one line in the evening briefing), the weekly review, and an honest opinion when you ask. The first two are built from rules and templates, so they cost nothing. Only the opinion (and an optional polish of the weekly review) calls the AI.

## What "necessary" means

A note is **necessary** when it is one of:

- **Time-sensitive:** a bill due or overdue, a deadline within 3 days, an event clash in the next 7 days, a task more than 3 days overdue, a review queue that has overflowed.
- **A meaningful pattern that crossed a threshold:** a streak about to break, an area silent for 14 days, a habit clearly dropping, a goal stalled for 10 days, sustained overspending.

Everything else (wins, balance across areas) is shared in the weekly review, or when you set Jarvis to "more often".

## Observation catalog

Each observation is a pure function of your data. Priority 1 is most urgent. Class: T = time-sensitive, P = pattern, W = win. Privacy: private observations never appear in notification text.

| Id | When it fires | Class | Priority | Privacy | Cooldown |
| --- | --- | --- | --- | --- | --- |
| `bill.overdue` | an unpaid bill is past its due date | T | 1 | private | 1 day per bill |
| `bill.soon` | an unpaid bill is due within 3 days | T | 2 | private | 1 day per bill |
| `deadline.soon` | an insurance, tax or other deadline is within 3 days | T | 2 | private | 1 day per item |
| `event.clash` | two timed events overlap in the next 7 days | T | 2 | public | 2 days per pair |
| `task.overdue` | a task is more than 3 days past its due date | T | 3 | public | 3 days per task |
| `streak.risk` | a daily habit with a streak of 5 or more is unchecked after 18:00 | P | 3 | public | 1 day per habit |
| `goal.stalled` | an active goal at least 10 days old has had no milestone or linked task done in 10 days | P | 3 | public | 10 days per goal |
| `budget.over` | a category is over its budget this month and was over last month too | P | 3 | private | 30 days per category |
| `review.overflow` | 10 or more spaced reviews are due | T | 4 | public | 3 days |
| `area.silent` | an unpaused area has had no growth for 14 days | P | 4 | public | 14 days per area |
| `habit.dip` | a habit's completions this week are under 30% of its rate over the previous 3 weeks (which was 70% or more) | P | 4 | public | 7 days per habit |
| `focus.skew` | one area has 70% or more of the last 30 days of growth and at least two areas are silent | P | 5 | public | 21 days |
| `win.level` | a skill reached level 5, 10, 15 ... in the last 2 days | W | 5 | public | per level |
| `win.streak` | a habit streak reached 7, 14, 30, 60 or 100 | W | 5 | public | per milestone |
| `win.goal` | a goal milestone or goal was completed in the last 2 days | W | 5 | public | per item |
| `win.first` | the first ever growth in an area | W | 6 | public | once per area |

Three wordings per observation, chosen by a stable rotation so he never repeats the same one twice in a row.

## Limits

| Setting | Only when necessary (default) | More often | Never |
| --- | --- | --- | --- |
| Observations shown | priority 1 to 4 | priority 1 to 6 | none |
| Per day in the app | 2 | 4 | 0 |
| In the evening notification | 1 line, generic if private | 1 line | none |
| Quiet hours (22:00 to 07:00) | only priority 1 | only priority 1 | none |

- A cooldown applies per observation key and is recorded in `note.shown` events, so it holds across devices.
- Paused areas and their habits, goals and trackers produce nothing.
- "Not useful" on a note silences that observation id for 30 days (`feedback.given`). A "Muted notes" list in Jarvis settings shows what is muted and lets you unmute.
- A note never repeats a Today line word for word: Today lists the fact, the note adds the offer ("Mark paid?", "Move the due date?").

## Goal coach

When `goal.stalled` fires, Jarvis offers "Want me to split it into smaller steps?" and, on yes, proposes tasks through `add_task` linked to the goal. Each is a normal action with its normal tier, and you approve the batch once.

## Weekly review

Built on the device from templates for the last full week (Monday to Sunday): what grew (top areas and skills), what stalled (silent areas, dropped habits), wins, one suggestion (the highest priority open observation), one question (from a fixed list, rotated). Available any time at `/jarvis/weekly`; on Sundays the evening briefing says it is ready. An optional single AI call polishes the wording; it is skipped past 80% of the monthly cap.

## Opinions

"What do you think?" is an AI call the user asked for. It receives the observation summary, the shared insights and the chosen memories (never private data unless shared), and follows the personality guide.

## Feedback events

- `note.shown`: `{ obsId, key, date }` written when a note is displayed.
- `feedback.given`: `{ targetKind: "note" | "reply", targetId, value: "up" | "down" | "not_useful", text? }`.

Both sync. `feedback.given` on replies can be exported as new routing and tone test cases.
