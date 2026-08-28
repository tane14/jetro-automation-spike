"use strict";

/**
 * Lifecycle state machine for Control Plane contracts v0.5.
 * Impossible or missing transitions fail closed.
 * Recorded states (AUTHORIZED, APPROVED, MERGE_READY, MERGED) are not
 * GitHub approval or merge authority.
 */

const TASK_STATES = [
  "PLANNED",
  "READY",
  "AUTHORIZED",
  "IN_PROGRESS",
  "REVIEW_READY",
  "REVIEWED",
  "CHANGES_REQUESTED",
  "APPROVED",
  "MERGE_READY",
  "MERGED",
  "BLOCKED",
  "FAILED",
  "CANCELLED",
];

const EXECUTION_STATES = [
  "LEASED",
  "RUNNING",
  "RESULT_SUBMITTED",
  "TIMED_OUT",
  "FAILED",
  "BLOCKED",
];

const REVIEW_STATES = ["REQUESTED", "IN_PROGRESS", "PUBLISHED"];

const ALLOWED_TASK_TRANSITIONS = {
  PLANNED: ["READY", "CANCELLED"],
  READY: ["AUTHORIZED", "BLOCKED", "CANCELLED"],
  AUTHORIZED: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
  IN_PROGRESS: ["REVIEW_READY", "BLOCKED", "FAILED", "CANCELLED"],
  REVIEW_READY: ["REVIEWED", "CHANGES_REQUESTED", "BLOCKED"],
  REVIEWED: ["APPROVED", "CHANGES_REQUESTED", "BLOCKED"],
  CHANGES_REQUESTED: ["IN_PROGRESS", "BLOCKED", "CANCELLED"],
  APPROVED: ["MERGE_READY", "CANCELLED"],
  MERGE_READY: ["MERGED", "CANCELLED"],
  MERGED: [],
  BLOCKED: ["READY", "AUTHORIZED", "IN_PROGRESS", "CANCELLED"],
  FAILED: ["IN_PROGRESS", "CANCELLED"],
  CANCELLED: [],
};

const ALLOWED_EXECUTION_TRANSITIONS = {
  LEASED: ["RUNNING", "TIMED_OUT", "FAILED", "BLOCKED"],
  RUNNING: ["RESULT_SUBMITTED", "TIMED_OUT", "FAILED", "BLOCKED"],
  RESULT_SUBMITTED: [],
  TIMED_OUT: [],
  FAILED: [],
  BLOCKED: [],
};

const ALLOWED_REVIEW_TRANSITIONS = {
  REQUESTED: ["IN_PROGRESS", "PUBLISHED"],
  IN_PROGRESS: ["PUBLISHED"],
  PUBLISHED: [],
};

const MACHINES = {
  task: { states: TASK_STATES, allowed: ALLOWED_TASK_TRANSITIONS },
  execution: { states: EXECUTION_STATES, allowed: ALLOWED_EXECUTION_TRANSITIONS },
  review: { states: REVIEW_STATES, allowed: ALLOWED_REVIEW_TRANSITIONS },
};

function validateTransition(machineName, fromState, toState) {
  const errors = [];
  const machine = MACHINES[machineName];
  if (!machine) {
    return { valid: false, errors: [`unknown lifecycle machine: ${machineName}`] };
  }
  if (fromState === undefined || fromState === null || fromState === "") {
    errors.push("lifecycle transition missing from_state");
  }
  if (toState === undefined || toState === null || toState === "") {
    errors.push("lifecycle transition missing to_state");
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  if (!machine.states.includes(fromState)) {
    errors.push(`unknown from_state: ${fromState}`);
  }
  if (!machine.states.includes(toState)) {
    errors.push(`unknown to_state: ${toState}`);
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  const allowed = machine.allowed[fromState] || [];
  if (!allowed.includes(toState)) {
    errors.push(`invalid lifecycle transition: ${fromState} -> ${toState}`);
  }
  return { valid: errors.length === 0, errors };
}

function validateLifecycleDocument(doc) {
  if (!doc || typeof doc !== "object") {
    return { valid: false, errors: ["lifecycle document missing"] };
  }
  return validateTransition(doc.machine || "task", doc.from_state, doc.to_state);
}

module.exports = {
  TASK_STATES,
  EXECUTION_STATES,
  REVIEW_STATES,
  ALLOWED_TASK_TRANSITIONS,
  ALLOWED_EXECUTION_TRANSITIONS,
  ALLOWED_REVIEW_TRANSITIONS,
  validateTransition,
  validateLifecycleDocument,
};
