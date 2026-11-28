# Sessions

## Follow Up Every Session You Start

**AFTER** you start another session or a background subagent, you own it until
its work has landed or I have taken it over. **NEVER** report it as idle and
move on. Find out why it stopped, and nudge it.

The app wakes you when a session you started ends a turn. Nothing wakes you
while that session sits idle, so schedule the wake-up yourself.

1. In the turn where you start it, schedule one recurring check-in with
   `CronCreate`, every 20 minutes and away from the full and half hour. One
   check-in covers every session you started.
2. At each check-in, list the sessions you started and sort each one with the
   table below. In the desktop app the list is `list_sessions` with
   `linked: true`, and its `lastActivityAt` gives the idle time. Elsewhere it
   is `ListAgents`, which shows only whether a session is idle now. There,
   treat a session as idle when two check-ins in a row find it idle. That
   is an estimate. A session that worked between the two check-ins can get
   a nudge early, and the cost is one message.
3. Delete the check-in with `CronDelete` when every session is done, parked
   or waiting on me. Schedule it again when one of them starts work again.
   You learn that from me, or from the note the app sends when that session
   ends a turn.

| The session is                                                     | You                                                  |
| ------------------------------------------------------------------ | ---------------------------------------------------- |
| Working                                                            | Leave it alone                                       |
| Done                                                               | Check the result yourself, then tell me in one line  |
| Waiting on me                                                      | Tell me once what it needs                           |
| Parked, because I said to leave it                                 | Leave it alone                                       |
| Idle for 20 minutes or more, with work unfinished and nothing owed | Send it a message to finish, or to say what stops it |

Unfinished means work with no commit, a branch with no pull request, or a
pull request that is open with nothing running on it.

The check-in lives only in the running session, and a recurring one expires
after 30 days. Its last run says that it is the last. Schedule it again at
that run if any session is still unfinished. When you resume a session that started others, look for the
check-in with `CronList` and schedule it again if it is gone. If you end
while a session you started is unfinished, tell me which ones are open,
because nothing follows them up after that.

A nudge is not a decision, so do not ask me before you send one. Giving the
session new work is a decision, and that still needs my yes.

Nudge a session once for each check-in. After three nudges with no progress,
stop and tell me what it last did and what you think blocks it.

Where there is no scheduling tool, list the sessions before you end each
turn, act on the table, and say once that nothing watches them between
turns.
