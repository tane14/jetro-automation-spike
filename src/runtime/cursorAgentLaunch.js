"use strict";

/**
 * Resolve Cursor agent.cmd to node.exe + index.js without executing the Agent.
 * Read-only filesystem inspection. Fail closed. Not a security boundary.
 */

const fs = require("node:fs");
const path = require("node:path");

const VERSION_DIR_RE = /^\d{4}\.\d{1,2}\.\d{1,2}(-\d{2}-\d{2}-\d{2})?-[a-f0-9]+$/i;
const AGENT_CMD_NAMES = new Set(["agent.cmd", "cursor-agent.cmd"]);

function failLaunch(reason) {
  return { ok: false, reason, executable: null, prefixArgs: null, cursorInvokedAs: null };
}

function hasControlChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return false;
}

function isInsideDir(parentDir, childPath) {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function isRegularFile(filePath) {
  try {
    const st = fs.lstatSync(filePath);
    return st.isFile() && !st.isSymbolicLink();
  } catch (_err) {
    return false;
  }
}

function parseVersionRank(name) {
  const datePart = name.split("-")[0];
  const parts = datePart.split(".");
  if (parts.length !== 3) {
    return 0;
  }
  const year = parts[0];
  const month = parts[1].padStart(2, "0");
  const day = parts[2].padStart(2, "0");
  const rank = Number(year + month + day);
  return Number.isFinite(rank) ? rank : 0;
}

function nodeName() {
  return process.platform === "win32" ? "node.exe" : "node";
}

function launchFromDir(dir, invokedAs) {
  const executable = path.join(dir, nodeName());
  const indexJs = path.join(dir, "index.js");
  if (!isRegularFile(executable) || !isRegularFile(indexJs)) {
    return failLaunch("Cursor node.exe/index.js not found as regular files");
  }
  if (!isInsideDir(dir, executable) || !isInsideDir(dir, indexJs)) {
    return failLaunch("resolved Cursor launch files escape the launcher directory");
  }
  return {
    ok: true,
    reason: null,
    executable,
    prefixArgs: [indexJs],
    cursorInvokedAs: invokedAs,
  };
}

function latestVersionDir(versionsRoot) {
  let entries;
  try {
    entries = fs.readdirSync(versionsRoot, { withFileTypes: true });
  } catch (_err) {
    return null;
  }
  const matches = entries
    .filter((ent) => ent.isDirectory() && !ent.isSymbolicLink() && VERSION_DIR_RE.test(ent.name))
    .map((ent) => ({ name: ent.name, rank: parseVersionRank(ent.name) }))
    .sort((a, b) => b.rank - a.rank || b.name.localeCompare(a.name));
  if (!matches.length) {
    return null;
  }
  return path.join(versionsRoot, matches[0].name);
}

/**
 * Map a Cursor agent.cmd path to node.exe + index.js argv prefix.
 * Does not execute the Agent.
 *
 * @param {string} file
 */
function resolveCursorAgentLaunch(file) {
  if (typeof file !== "string" || file.trim() === "") {
    return failLaunch("launch file is required");
  }
  if (file.includes("\0") || hasControlChars(file)) {
    return failLaunch("launch file contains control characters");
  }
  const trimmed = file.trim();
  if (!path.isAbsolute(trimmed)) {
    return failLaunch("launch file must be absolute");
  }
  const normalized = path.normalize(trimmed);
  const base = path.basename(normalized).toLowerCase();
  if (!AGENT_CMD_NAMES.has(base)) {
    return failLaunch("not a Cursor agent.cmd launcher");
  }
  const dir = path.dirname(normalized);
  const sibling = launchFromDir(dir, path.basename(normalized));
  if (sibling.ok) {
    return sibling;
  }
  const versionDir = latestVersionDir(path.join(dir, "versions"));
  if (!versionDir) {
    return failLaunch("no Cursor version directory with node.exe/index.js");
  }
  if (!isInsideDir(dir, versionDir)) {
    return failLaunch("version directory escapes launcher root");
  }
  return launchFromDir(versionDir, path.basename(normalized));
}

/**
 * Resolve any spawn file to an argv-safe executable.
 * .cmd/.bat that is not a resolvable Cursor launcher is rejected.
 *
 * @param {string} file
 */
function resolveLaunchTarget(file) {
  if (typeof file !== "string" || file.trim() === "") {
    return failLaunch("spawn file is invalid");
  }
  if (file.includes("\0") || hasControlChars(file)) {
    return failLaunch("spawn file contains control characters");
  }
  const trimmed = file.trim();
  if (!path.isAbsolute(trimmed)) {
    return failLaunch("spawn file must be absolute");
  }
  const normalized = path.normalize(trimmed);
  const ext = path.extname(normalized).toLowerCase();
  if (ext === ".cmd" || ext === ".bat") {
    const resolved = resolveCursorAgentLaunch(normalized);
    if (resolved.ok) {
      return resolved;
    }
    return failLaunch(
      resolved.reason === "not a Cursor agent.cmd launcher"
        ? "cmd/bat execution boundary is not permitted"
        : resolved.reason,
    );
  }
  return {
    ok: true,
    reason: null,
    executable: normalized,
    prefixArgs: [],
    cursorInvokedAs: null,
  };
}

module.exports = {
  resolveCursorAgentLaunch,
  resolveLaunchTarget,
  AGENT_CMD_NAMES,
};
