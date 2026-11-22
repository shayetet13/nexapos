# @linebot/supervisor

`Supervisor` is the backend integration boundary for local bot processes. It
keeps credentials in memory, sends bootstrap config over private IPC, starts one
child process per bot and rejects any worker event whose `botId` does not match
the owning process.

```ts
import { Supervisor } from "@linebot/supervisor";

const supervisor = new Supervisor();
supervisor.register({ botId: "shop-bot", adapter: { kind: "official", channelAccessToken } });
await supervisor.start("shop-bot");
await supervisor.sendText("shop-bot", { targetId: "group-1", text: "hello" });
await supervisor.stop("shop-bot", "graceful");
```

Public control methods: `register`/`create`, `updateConfig`, `start`, `pause`,
`resume`, `stop`, `status`/`list`, `metrics`, `refresh`, `sendText`,
`enqueueText` (HTTP 202-style acknowledgement), `ingestEvent`, `listTargets`,
and `shutdown`.

Events: `status`, `heartbeat`, `metrics`, `bot-event`, `delivery`, `auth`,
`first-response`, `crash`, and `log`. API code should forward these through SSE
after applying authorization and should encrypt QR-issued auth tokens before
persistence.
