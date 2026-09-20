// What he says when the month's AI allowance runs short. The same words as the server's, so the notice
// in the chat and the refusal from the server never disagree (a test holds them together).
export const RATION_TEXT = {
  ration: "I'm on a short ration this month, so I'm keeping what's left for our chats. The weekly write-up and opinions pause until next month.",
  stopped: "I've used this month's AI allowance, so I can only do the quick commands until it resets on the 1st: undo, brief me, today, remember, forget and the weekly review. Everything in your apps still works.",
}

// The typed commands that need the AI. Everything else Jarvis understands on the device works with the allowance spent.
export const NEEDS_AI = ['opinion']
