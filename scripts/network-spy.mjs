/**
 * network-spy.mjs
 *
 * Preload that turns any network, DNS, listening-socket, subprocess or
 * worker-thread use into an immediate process exit: the enforcement half of
 * ADR-006 (no telemetry, pivot T2.3).
 *
 *   node --import ./scripts/network-spy.mjs <script>
 *   NODE_OPTIONS="--import=/abs/path/to/network-spy.mjs" gitmesh doctor
 *
 * The first trapped call writes `gitmesh network-spy: <api> called` and the
 * caller's stack to stderr, then exits 97. The call itself never runs, so
 * nothing leaves the machine. The spy exits instead of throwing because
 * telemetry code swallows its own errors: a spy that threw would let a
 * silent ping pass. Importing a network module is fine; only using one trips.
 *
 * It traps choke points rather than every client API. All TCP (http, https,
 * http2, tls, and fetch and WebSocket through Node's bundled undici) ends in
 * net.Socket#connect, every server in net.Server#listen, and all UDP in
 * dgram.Socket#bind, #connect or #send. DNS queries and the synchronous
 * spawners have no common choke point, so each function is trapped; DNS
 * functions are trapped by exclusion, so query methods a later Node adds are
 * caught too. Worker threads load their own copy of every builtin, out of
 * reach of these patches, so starting one trips as well.
 *
 * This is a regression test for honest code, not a sandbox: code that went
 * out of its way to reach Node's internal bindings could get past it.
 * scripts/__tests__/network-spy.test.ts proves every trap fires, and
 * scripts/smoke-gitmesh-cli.sh runs the packaged CLI under it.
 */

import childProcess from "node:child_process";
import dgram from "node:dgram";
import dns from "node:dns";
import { writeSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import net from "node:net";
import workerThreads from "node:worker_threads";

const EXIT_CODE = 97;

/** Reports `api` with the caller's stack, then exits; nothing can catch it. */
function trip(api) {
  // The default limit of 10 frames can end inside Node's http or undici
  // internals before reaching the caller; the process is exiting anyway.
  Error.stackTraceLimit = 50;
  // Drop the "Error" line and the trip() and trapped() frames.
  const stack = (new Error().stack ?? "").split("\n").slice(3).join("\n");
  writeSync(2, `gitmesh network-spy: ${api} called\n${stack}\n`);
  process.exit(EXIT_CODE);
}

/** Replaces the function at `owner[key]` with one that trips as `api`. */
function trap(owner, key, api) {
  if (typeof owner[key] !== "function") {
    // A renamed or mistyped target would otherwise leave that API unwatched.
    throw new Error(`network-spy: ${api} is not a function`);
  }
  Object.defineProperty(owner, key, {
    configurable: true,
    writable: true,
    value: function trapped() {
      trip(api);
    },
  });
}

trap(net.Socket.prototype, "connect", "net.Socket#connect");
trap(net.Server.prototype, "listen", "net.Server#listen");
for (const method of ["bind", "connect", "send"]) {
  trap(dgram.Socket.prototype, method, `dgram.Socket#${method}`);
}

/** DNS members that only read or change resolver settings. */
const DNS_SETTINGS = new Set([
  "Resolver",
  "constructor",
  "cancel",
  "getServers",
  "setServers",
  "setLocalAddress",
  "getDefaultResultOrder",
  "setDefaultResultOrder",
]);

/** Traps every function on `owner` that can send a DNS query. */
function trapQueries(owner, prefix) {
  for (const key of Object.getOwnPropertyNames(owner)) {
    const { value } = Object.getOwnPropertyDescriptor(owner, key) ?? {};
    if (typeof value === "function" && !DNS_SETTINGS.has(key)) trap(owner, key, `${prefix}${key}`);
  }
}

// The module-level functions are bound copies of the Resolver methods, so
// both need trapping.
trapQueries(dns, "dns.");
trapQueries(dns.Resolver.prototype, "dns.Resolver#");
trapQueries(dns.promises, "dns.promises.");
trapQueries(dns.promises.Resolver.prototype, "dns.promises.Resolver#");

// The async spawners also end in ChildProcess#spawn, which catches internal
// callers such as cluster; the synchronous ones each call into Node directly.
for (const key of ["exec", "execFile", "execFileSync", "execSync", "fork", "spawn", "spawnSync"]) {
  trap(childProcess, key, `child_process.${key}`);
}
trap(childProcess.ChildProcess.prototype, "spawn", "ChildProcess#spawn");

trap(workerThreads, "Worker", "worker_threads.Worker");

// Already covered by net.Socket#connect; trapped by name so a trip says what
// was called. EventSource only exists behind a flag.
for (const key of ["fetch", "WebSocket", "EventSource"]) {
  if (typeof globalThis[key] === "function") trap(globalThis, key, key);
}

// Named imports (`import { lookup } from "node:dns"`) read a builtin's ESM
// facade, which keeps its own copy of each export; resync it with the traps.
syncBuiltinESMExports();
