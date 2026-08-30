"use strict";

/**
 * Explicit child-process environment allowlist for ControlledCursorRunner.
 * Not a security boundary. Never copy the parent environment wholesale.
 * Never return this object as RunnerResult/Evidence.
 */

const path = require("node:path");

const WINDOWS_PROCESS_KEYS = Object.freeze([
  "SystemRoot",
  "WINDIR",
  "windir",
  "SystemDrive",
  "OS",
  "PATHEXT",
  "TEMP",
  "TMP",
  "TMPDIR",
  "PATH",
  "Path",
  "USERNAME",
  "USERDOMAIN",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "APPDATA",
  "PUBLIC",
  "ProgramData",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramW6432",
  "CommonProgramFiles",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "ComSpec",
]);

const POSIX_PROCESS_KEYS = Object.freeze(["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "USER", "LOGNAME"]);

const DENIED_EXACT = Object.freeze([
  "CURSOR_API_KEY",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_REPL_EXTERNAL_MODULE",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
]);

const DENIED_PREFIX = Object.freeze([
  "AWS_",
  "AZURE_",
  "GCP_",
  "GOOGLE_",
  "DATABASE_",
  "DB_",
  "MYSQL_",
  "POSTGRES_",
  "MONGO_",
  "REDIS_",
  "OPENAI_",
  "ANTHROPIC_",
  "JETRO_",
]);

const DENIED_SUBSTRING = Object.freeze(["SECRET", "PASSWORD", "CREDENTIAL", "PRIVATE_KEY"]);

function isDeniedKey(key) {
  if (typeof key !== "string" || key === "") {
    return true;
  }
  const upper = key.toUpperCase();
  if (DENIED_EXACT.some((name) => name.toUpperCase() === upper)) {
    return true;
  }
  if (DENIED_PREFIX.some((prefix) => upper.startsWith(prefix))) {
    return true;
  }
  if (upper.includes("TOKEN") && upper !== "PATHEXT") {
    return true;
  }
  return DENIED_SUBSTRING.some((part) => upper.includes(part));
}

function copyIfAllowed(child, parent, key) {
  if (isDeniedKey(key)) {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(parent, key)) {
    return;
  }
  const value = parent[key];
  if (typeof value !== "string") {
    return;
  }
  child[key] = value;
}

/**
 * @param {NodeJS.ProcessEnv} [parentEnv]
 * @param {{ cursorInvokedAs?: string }} [options]
 * @returns {NodeJS.ProcessEnv}
 */
function buildChildEnvironment(parentEnv = {}, options = {}) {
  const child = Object.create(null);
  const keys = process.platform === "win32" ? WINDOWS_PROCESS_KEYS : POSIX_PROCESS_KEYS;
  for (const key of keys) {
    copyIfAllowed(child, parentEnv, key);
  }
  if (typeof options.cursorInvokedAs === "string" && options.cursorInvokedAs.trim() !== "") {
    child.CURSOR_INVOKED_AS = options.cursorInvokedAs;
  }
  const localAppData = child.LOCALAPPDATA;
  if (typeof localAppData === "string" && localAppData.trim() !== "") {
    child.NODE_COMPILE_CACHE = path.join(localAppData, "cursor-compile-cache");
  }
  return child;
}

module.exports = {
  WINDOWS_PROCESS_KEYS,
  POSIX_PROCESS_KEYS,
  DENIED_EXACT,
  buildChildEnvironment,
  isDeniedKey,
};
