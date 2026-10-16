import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Guards the ADR-006 network spy (scripts/network-spy.mjs) against rot. The
 * clean-install smoke test runs every gitmesh command under it and passes
 * when nothing trips, so a trap that stopped firing would turn that check
 * into a silent pass. Each case starts a fresh `node --import <spy>` that
 * reaches for the network, a subprocess or a worker thread by one route;
 * each must exit 97 naming the trapped API. Targets are a closed local port
 * and the reserved `.invalid` TLD, so even a broken trap sends nothing
 * anywhere.
 */

const SPY = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), "../network-spy.mjs"),
).href;
// Not on the fetch spec's blocked-port list, so fetch really tries to connect.
const URL_HTTP = "http://127.0.0.1:59999/";
const HOST = "gitmesh.invalid";

/** Runs an ES module body under the spy in a fresh process. */
function underSpy(code: string) {
  const result = spawnSync(
    process.execPath,
    ["--import", SPY, "--input-type=module", "--eval", code],
    // Under vitest's 5s test timeout, so a broken trap that leaves a server
    // listening fails the case instead of hanging it.
    { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "" }, timeout: 4_000 },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const TRIPS: ReadonlyArray<[route: string, api: string, code: string]> = [
  ["fetch", "fetch", `await fetch("${URL_HTTP}");`],
  ["WebSocket", "WebSocket", `new WebSocket("ws://127.0.0.1:59999/");`],
  ["http.get", "net.Socket#connect", `import http from "node:http"; http.get("${URL_HTTP}");`],
  ["https.get", "net.Socket#connect", `import https from "node:https"; https.get("https://127.0.0.1:59999/");`],
  ["http2.connect", "net.Socket#connect", `import http2 from "node:http2"; http2.connect("${URL_HTTP}");`],
  ["tls.connect", "net.Socket#connect", `import tls from "node:tls"; tls.connect(59999, "127.0.0.1");`],
  ["net.connect", "net.Socket#connect", `import { connect } from "node:net"; connect(59999, "127.0.0.1");`],
  ["a local server", "net.Server#listen", `import http from "node:http"; http.createServer().listen(0);`],
  ["a UDP send", "dgram.Socket#send", `import dgram from "node:dgram"; dgram.createSocket("udp4").send("x", 59999, "127.0.0.1");`],
  ["a UDP bind", "dgram.Socket#bind", `import dgram from "node:dgram"; dgram.createSocket("udp4").bind(0);`],
  ["a named dns import", "dns.lookup", `import { lookup } from "node:dns"; lookup("${HOST}", () => {});`],
  ["dns.resolveTxt", "dns.resolveTxt", `import dns from "node:dns"; dns.resolveTxt("${HOST}", () => {});`],
  ["a dns Resolver", "dns.Resolver#resolve4", `import { Resolver } from "node:dns"; new Resolver().resolve4("${HOST}", () => {});`],
  ["dns.promises", "dns.promises.lookup", `import dns from "node:dns"; await dns.promises.lookup("${HOST}");`],
  ["a dns/promises Resolver", "dns.promises.Resolver#resolveAny", `import { Resolver } from "node:dns/promises"; await new Resolver().resolveAny("${HOST}");`],
  ["spawn", "child_process.spawn", `import { spawn } from "node:child_process"; spawn(process.execPath, ["--version"]);`],
  ["spawnSync", "child_process.spawnSync", `import { spawnSync } from "node:child_process"; spawnSync(process.execPath, ["--version"]);`],
  ["exec", "child_process.exec", `import { exec } from "node:child_process"; exec("exit 0");`],
  ["execSync", "child_process.execSync", `import { execSync } from "node:child_process"; execSync("exit 0");`],
  ["execFile", "child_process.execFile", `import { execFile } from "node:child_process"; execFile(process.execPath, ["--version"]);`],
  ["execFileSync", "child_process.execFileSync", `import { execFileSync } from "node:child_process"; execFileSync(process.execPath, ["--version"]);`],
  ["fork", "child_process.fork", `import { fork } from "node:child_process"; fork("/nonexistent/gitmesh-spy-probe.mjs");`],
  ["cluster.fork", "child_process.fork", `import cluster from "node:cluster"; cluster.fork();`],
  ["a bare ChildProcess", "ChildProcess#spawn", `import { ChildProcess } from "node:child_process"; new ChildProcess().spawn({ file: process.execPath, args: [process.execPath, "--version"], stdio: "ignore" });`],
  ["a worker thread", "worker_threads.Worker", `import { Worker } from "node:worker_threads"; new Worker("", { eval: true });`],
];

describe("network spy", () => {
  it.each(TRIPS)("traps %s as %s", (_route, api, code) => {
    const { status, stderr } = underSpy(code);
    expect(stderr).toContain(`gitmesh network-spy: ${api} called\n`);
    expect(status).toBe(97);
  });

  it("exits even when the caller swallows the failure, as telemetry code does", () => {
    const { status, stdout, stderr } = underSpy(
      `try { await fetch("${URL_HTTP}"); } catch {} console.log("swallowed");`,
    );
    expect(stderr).toContain("gitmesh network-spy: fetch called\n");
    expect(status).toBe(97);
    expect(stdout).toBe("");
  });

  it("catches a synchronous send from an exit handler", () => {
    const { status, stderr } = underSpy(
      'import { execFileSync } from "node:child_process";' +
        'process.on("exit", () => execFileSync(process.execPath, ["--version"]));',
    );
    expect(stderr).toContain("gitmesh network-spy: child_process.execFileSync called\n");
    expect(status).toBe(97);
  });

  it("reports the caller's frame, below Node's own", () => {
    const { stderr } = underSpy(
      `import https from "node:https"; function phoneHome() { https.get("https://127.0.0.1:59999/"); } phoneHome();`,
    );
    expect(stderr).toMatch(/gitmesh network-spy: net\.Socket#connect called\n(.*\n)*\s+at phoneHome /);
  });

  it("lets everything else run: importing network modules, files, crypto, timers, resolver settings", () => {
    const { status, stdout, stderr } = underSpy(
      [
        'import "node:http"; import "node:https"; import "node:http2"; import "node:net";',
        'import "node:tls"; import "node:dgram"; import "node:child_process";',
        'import "node:worker_threads"; import "node:cluster";',
        'import dns, { Resolver } from "node:dns";',
        'import { readFileSync } from "node:fs";',
        'import { createHash } from "node:crypto";',
        'import { setTimeout as sleep } from "node:timers/promises";',
        "dns.getServers(); new Resolver().getServers(); dns.setDefaultResultOrder('ipv4first');",
        "readFileSync(process.execPath);",
        "await sleep(1);",
        'console.log(createHash("sha256").update("ok").digest("hex"));',
      ].join("\n"),
    );
    expect(stderr).toBe("");
    expect(status).toBe(0);
    expect(stdout).toMatch(/^[0-9a-f]{64}\n$/);
  });
});
