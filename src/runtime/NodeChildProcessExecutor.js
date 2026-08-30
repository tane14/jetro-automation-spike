"use strict";

/**
 * Process executor for ControlledCursorRunner v0.1.1.
 *
 * Windows .cmd command-line construction is prohibited.
 * Cursor agent.cmd is resolved read-only to node.exe + index.js and spawned
 * with shell=false + argv. Other .cmd/.bat files are rejected.
 *
 * WINDOWS_DESCENDANT_TERMINATION_GUARANTEE=NO
 * SECURITY_BOUNDARY=NO
 * LAB_ONLY=YES
 */

const { spawn } = require("node:child_process");
const { buildChildEnvironment } = require("./childEnvironment");
const { resolveLaunchTarget } = require("./cursorAgentLaunch");

const FORBIDDEN_FLAGS = Object.freeze(["--force", "--yolo", "--approve-mcps"]);

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
  if (!stream) {
    return chunks;
  }
  stream.on("data", (chunk) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  });
  return chunks;
}

class NodeChildProcessExecutor {
  /**
   * @param {{ spawnFn?: typeof spawn, env?: NodeJS.ProcessEnv }} [options]
   */
  constructor(options = {}) {
    this.spawnFn = typeof options.spawnFn === "function" ? options.spawnFn : spawn;
    this.parentEnv = options.env && typeof options.env === "object" ? options.env : process.env;
  }

  /**
   * @param {{ file: string, args: string[], timeoutMs: number }} spec
   */
  spawn(spec) {
    const file = spec && spec.file;
    const args = spec && spec.args;
    const timeoutMs = spec && spec.timeoutMs;
    const launched = resolveLaunchTarget(file);
    if (!launched.ok) {
      return Promise.reject(new Error(launched.reason));
    }
    try {
      assertSafeArgv(args);
    } catch (err) {
      return Promise.reject(err);
    }
    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      return Promise.reject(new Error("timeoutMs must be a positive integer"));
    }
    const lowerArgs = args.map((a) => a.toLowerCase());
    for (const flag of FORBIDDEN_FLAGS) {
      if (lowerArgs.includes(flag)) {
        return Promise.reject(new Error(`forbidden CLI flag: ${flag}`));
      }
    }

    const argv = launched.prefixArgs.concat(args);
    const childEnv = buildChildEnvironment(this.parentEnv, {
      cursorInvokedAs: launched.cursorInvokedAs || undefined,
    });

    let child;
    try {
      child = this.spawnFn(launched.executable, argv, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: childEnv,
        shell: false,
      });
    } catch (err) {
      return Promise.reject(err);
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
          resolvedFile: launched.executable,
          windowsDescendantTerminationGuarantee: false,
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
  FORBIDDEN_FLAGS,
};
