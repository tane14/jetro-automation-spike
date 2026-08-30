"use strict";

/**
 * Process executor for ControlledCursorRunner v0.1.
 * Captures the child process exit code (not a wrapping shell inference).
 * Does not retry. Not a security boundary.
 */

const { spawn } = require("node:child_process");

const FORBIDDEN_FLAGS = Object.freeze(["--force", "--yolo", "--approve-mcps"]);

function quoteWindowsCmdArg(value) {
  if (typeof value !== "string") {
    throw new Error("argument must be a string");
  }
  if (value.includes("\0")) {
    throw new Error("argument contains NUL");
  }
  if (value === "") {
    return '""';
  }
  if (!/[\s&<>|^()"]/.test(value)) {
    return value;
  }
  let out = '"';
  let backslashes = 0;
  for (const ch of value) {
    if (ch === "\\") {
      backslashes += 1;
      continue;
    }
    if (ch === '"') {
      out += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    out += "\\".repeat(backslashes) + ch;
    backslashes = 0;
  }
  out += "\\".repeat(backslashes * 2) + '"';
  return out;
}

function assertSafeArgv(args) {
  if (!Array.isArray(args)) {
    throw new Error("args must be an array");
  }
  for (const arg of args) {
    if (typeof arg !== "string") {
      throw new Error("args must be strings");
    }
    if (arg.includes("\0")) {
      throw new Error("argument contains NUL");
    }
  }
}

function collectStream(stream) {
  const chunks = [];
  stream.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  return chunks;
}

class NodeChildProcessExecutor {
  /**
   * @param {{ spawnFn?: typeof spawn, comspec?: string }} [options]
   */
  constructor(options = {}) {
    this.spawnFn = typeof options.spawnFn === "function" ? options.spawnFn : spawn;
    this.comspec = options.comspec || process.env.ComSpec || "cmd.exe";
  }

  /**
   * @param {{ file: string, args: string[], timeoutMs: number }} spec
   */
  spawn(spec) {
    const file = spec && spec.file;
    const args = spec && spec.args;
    const timeoutMs = spec && spec.timeoutMs;
    if (typeof file !== "string" || file.trim() === "" || file.includes("\0")) {
      return Promise.reject(new Error("spawn file is invalid"));
    }
    assertSafeArgv(args);
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error("timeoutMs must be a positive integer"));
    }
    const lowerArgs = args.map((a) => a.toLowerCase());
    for (const flag of FORBIDDEN_FLAGS) {
      if (lowerArgs.includes(flag)) {
        return Promise.reject(new Error(`forbidden CLI flag: ${flag}`));
      }
    }

    const isCmd = process.platform === "win32" && /\.(cmd|bat)$/i.test(file);
    let child;
    if (isCmd) {
      const commandLine = [quoteWindowsCmdArg(file), ...args.map(quoteWindowsCmdArg)].join(" ");
      child = this.spawnFn(this.comspec, ["/d", "/s", "/c", commandLine], {
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } else {
      child = this.spawnFn(file, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
        shell: false,
      });
    }

    return new Promise((resolve, reject) => {
      const stdoutChunks = collectStream(child.stdout);
      const stderrChunks = collectStream(child.stderr);
      let timedOut = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch (_err) {
          /* ignore */
        }
      }, timeoutMs);

      const finish = (exitCode, error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        const stdout = Buffer.concat(stdoutChunks);
        const stderr = Buffer.concat(stderrChunks);
        if (error && !timedOut && exitCode === null && stdout.length === 0 && stderr.length === 0) {
          reject(error);
          return;
        }
        resolve({
          pid: typeof child.pid === "number" ? child.pid : null,
          exitCode: typeof exitCode === "number" ? exitCode : null,
          timedOut,
          stdout,
          stderr,
          spawnAttempts: 1,
        });
      };

      child.once("error", (err) => {
        finish(null, err);
      });
      child.once("close", (code) => {
        finish(code, null);
      });
    });
  }
}

module.exports = {
  NodeChildProcessExecutor,
  quoteWindowsCmdArg,
  FORBIDDEN_FLAGS,
};
