"use strict";

/**
 * Canonical Mission/Task/Contract identifiers for Control Plane v0.5.
 * Format: PREFIX-YYYYMMDD-NNN. Allocation is fail-closed on collision
 * and on exhausted daily sequence. Not an authority source.
 */

const PATTERNS = {
  MISSION: /^MISSION-[0-9]{8}-[0-9]{3}$/,
  TASK: /^TASK-[0-9]{8}-[0-9]{3}$/,
  CONTRACT: /^CONTRACT-[0-9]{8}-[0-9]{3}$/,
  EXEC: /^EXEC-[0-9]{8}-[0-9]{3}$/,
};

function utcDateStamp(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) {
    throw new Error("invalid clock date for id allocation");
  }
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function assertCanonicalId(kind, id) {
  const pattern = PATTERNS[kind];
  if (!pattern) {
    throw new Error(`unknown id kind: ${kind}`);
  }
  if (typeof id !== "string" || !pattern.test(id)) {
    throw new Error(`invalid ${kind} id: ${JSON.stringify(id)}`);
  }
  return id;
}

function nextId(kind, dateStamp, existingIds) {
  const prefix = kind;
  if (!/^[0-9]{8}$/.test(dateStamp)) {
    throw new Error(`invalid date stamp: ${dateStamp}`);
  }
  const re = new RegExp(`^${prefix}-${dateStamp}-([0-9]{3})$`);
  let max = 0;
  for (const id of existingIds || []) {
    const match = typeof id === "string" ? id.match(re) : null;
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }
  const next = max + 1;
  if (next > 999) {
    throw new Error(`id sequence exhausted for ${prefix}-${dateStamp}`);
  }
  return `${prefix}-${dateStamp}-${String(next).padStart(3, "0")}`;
}

module.exports = {
  PATTERNS,
  utcDateStamp,
  assertCanonicalId,
  nextId,
};
