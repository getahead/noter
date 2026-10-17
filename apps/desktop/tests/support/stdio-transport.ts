// A `Transport` that talks to a core process over JSON Lines on stdin/stdout.
//
// It lets the conformance suite and the E2E flows run against the real Rust core
// (`noter-core-harness`, built in M0) without Tauri or a WebView. The wire format
// is specified in docs/HARNESS.md › "noter-core-harness wire format":
//
//   → {"id": 1, "window": "main", "cmd": "app_snapshot", "args": {}, "channel": false}
//   ← {"id": 1, "ok": <result>}            or  {"id": 1, "error": <CoreError>}
//   ← {"id": 1, "message": <channel msg>}  (subscribing commands, after the result)
//   ← {"event": "capture:state", "payload": <whole state>}
//
// Node only; never imported by the app bundle.

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

import type { CommandName, EventName, Transport, WindowLabel } from "../../src/core/bindings";

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void };

export interface StdioCoreOptions {
  /** Command line of the core harness, e.g. "target/debug/noter-core-harness --fixture world". */
  command: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

/** One core process shared by every window of a test. */
export class StdioCore {
  private child: ChildProcessWithoutNullStreams;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private channels = new Map<number, (m: unknown) => void>();
  private listeners = new Map<string, Set<(p: unknown) => void>>();
  private stderr = "";
  private exited: Error | null = null;

  constructor(opts: StdioCoreOptions) {
    const [bin, ...args] = splitCommand(opts.command);
    this.child = spawn(bin, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, stdio: "pipe" });
    this.child.stderr.on("data", (d: Buffer) => {
      this.stderr = (this.stderr + d.toString()).slice(-4000);
    });
    this.child.on("exit", (code, signal) => {
      this.exited = new Error(`core harness exited (code ${code}, signal ${signal}). stderr:\n${this.stderr}`);
      for (const p of this.pending.values()) p.reject(this.exited);
      this.pending.clear();
    });
    createInterface({ input: this.child.stdout }).on("line", (line) => this.onLine(line));
  }

  private onLine(line: string): void {
    if (!line.trim()) return;
    let msg: { id?: number; ok?: unknown; error?: unknown; message?: unknown; event?: string; payload?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      this.stderr += `\n[unparsable stdout] ${line}`;
      return;
    }
    if (msg.event !== undefined) {
      this.listeners.get(msg.event)?.forEach((h) => h(msg.payload));
      return;
    }
    if (msg.id === undefined) return;
    if ("message" in msg) {
      this.channels.get(msg.id)?.(msg.message);
      return;
    }
    const p = this.pending.get(msg.id);
    if (!p) return;
    this.pending.delete(msg.id);
    if ("error" in msg) p.reject(msg.error);
    else p.resolve(msg.ok);
  }

  invoke(window: WindowLabel, cmd: CommandName, args: unknown, onMessage?: (m: unknown) => void): Promise<unknown> {
    if (this.exited) return Promise.reject(this.exited);
    const id = this.nextId++;
    if (onMessage) this.channels.set(id, onMessage);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, window, cmd, args, channel: Boolean(onMessage) }) + "\n");
    });
  }

  listen(event: EventName, handler: (p: unknown) => void): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler);
    this.listeners.set(event, set);
    return () => set.delete(handler);
  }

  /** A per-window `Transport` view of this process. */
  transport(window: WindowLabel): Transport {
    return {
      invoke: (cmd, args, onMessage) => this.invoke(window, cmd, args, onMessage),
      listen: async (event, handler) => this.listen(event, handler),
    };
  }

  async close(): Promise<void> {
    if (this.exited) return;
    const done = new Promise((r) => this.child.once("exit", r));
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill("SIGKILL"), 3000);
    await done;
    clearTimeout(timer);
  }
}

/** Split a command line on spaces, honouring double quotes. */
export function splitCommand(command: string): string[] {
  const parts = command.match(/"[^"]*"|\S+/g) ?? [];
  if (parts.length === 0) throw new Error("empty core command");
  return parts.map((p) => p.replace(/^"(.*)"$/, "$1"));
}
