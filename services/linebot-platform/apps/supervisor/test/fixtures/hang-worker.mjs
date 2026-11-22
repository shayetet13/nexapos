// Test fixture: answers the fork "ready" handshake immediately but never
// responds to a "bootstrap" request, so the parent's bootstrap RPC times out
// while this process is still alive. Used to reproduce the race where a
// killed-but-not-yet-exited worker leaves a stale supervisor#workers entry.
process.send({ type: "ready" });
process.on("message", () => {});
