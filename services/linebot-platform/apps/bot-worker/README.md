# @linebot/bot-worker

Isolated runtime for one LINE bot. Production callers should start
`src/process-entry.ts` with an IPC channel through `@linebot/supervisor`; it
does not accept bot configuration or secrets on command-line arguments.

Adapters:

- `official`: real LINE Messaging API sender; signed webhook handlers normalize and
  inject events through the supervisor.
- `linejs`: dynamically imports `@evex/linejs` (or `moduleSpecifier`), supports
  token/QR login, Talk and OpenChat listeners and sends. It fails explicitly when
  the installed package cannot run in the current Node environment.

The runtime processes only its bootstrapped `botId`. Outgoing work is sequential,
priority ordered (`reply`, `join`, `api`, `scheduled`) and token-bucket limited.
The parent receives status, auth, inbound, delivery, first-response and heartbeat
events over IPC.
