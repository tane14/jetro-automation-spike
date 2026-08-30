"use strict";

/**
 * Exact workspace path binding for ControlledCursorRunner v0.1.1.
 * Parent-path approval never authorizes a child workspace.
 * Rejects control characters and shell-sensitive forms.
 * Not a security boundary.
 */

const path = require("node:path");

function failPath(reason) {
  return { ok: false, reason, canonical: null };
}

function hasUnsafeWorkspaceChars(value) {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code === 127) {
      return true;
    }
  }
  return /["&|<>^%!()*?;`]/.test(value);
}

function canonicalizeWorkspacePath(raw) {
  if (typeof raw !== "string" || raw.trim() === "") {
    return failPath("workspace path is required");
  }
  if (raw.includes("\0")) {
    return failPath("workspace path contains NUL");
  }
  if (hasUnsafeWorkspaceChars(raw)) {
    return failPath("workspace path contains control or shell-sensitive characters");
  }
  const trimmed = raw.trim();
  if (!path.isAbsolute(trimmed)) {
    return failPath("workspace path must be absolute");
  }
  if (process.platform === "win32" && /^[\\/]{2}/.test(trimmed)) {
    return failPath("UNC workspace paths are not permitted");
  }
  const normalized = path.normalize(trimmed);
  if (hasUnsafeWorkspaceChars(normalized)) {
    return failPath("workspace path contains control or shell-sensitive characters");
  }
  if (!path.isAbsolute(normalized)) {
    return failPath("workspace path did not remain absolute after normalize");
  }
  const { root } = path.parse(normalized);
  if (!root) {
    return failPath("workspace path has no root");
  }
  if (process.platform === "win32") {
    const afterRoot = normalized.slice(root.length);
    if (afterRoot.includes(":")) {
      return failPath("workspace path contains an alternate data stream or extra colon");
    }
  }
  let canonical = normalized;
  while (canonical.length > root.length && (canonical.endsWith("\\") || canonical.endsWith("/"))) {
    canonical = canonical.slice(0, -1);
  }
  const relative = path.relative(root, canonical);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return failPath("workspace path escapes its root");
  }
  if (normalized.split(path.sep).includes("..")) {
    return failPath("workspace path retains parent segments");
  }
  if (process.platform === "win32") {
    canonical = canonical.replace(/\//g, "\\");
  }
  return { ok: true, reason: null, canonical };
}

function pathsExactlyBound(authorizedPath, requestedPath) {
  const authorized = canonicalizeWorkspacePath(authorizedPath);
  const requested = canonicalizeWorkspacePath(requestedPath);
  if (!authorized.ok) {
    return { ok: false, reason: `authorized workspace: ${authorized.reason}` };
  }
  if (!requested.ok) {
    return { ok: false, reason: `requested workspace: ${requested.reason}` };
  }
  const left =
    process.platform === "win32" ? authorized.canonical.toLowerCase() : authorized.canonical;
  const right =
    process.platform === "win32" ? requested.canonical.toLowerCase() : requested.canonical;
  if (left !== right) {
    return { ok: false, reason: "workspace is not the exact authorized workspace" };
  }
  return { ok: true, reason: null, canonical: requested.canonical };
}

module.exports = {
  canonicalizeWorkspacePath,
  pathsExactlyBound,
};
