"use strict";

/**
 * Fail-closed validator for Control Plane contracts v0.5.
 * Invalid, missing, or malformed documents are rejected.
 * This module does not grant authority and is not a GitHub integration runtime.
 */

const fs = require("node:fs");
const path = require("node:path");
const { validate } = require("./json-schema-lite");
const { verifyContractBinding, verifyCopiedBinding } = require("./binding");
const { validateLifecycleDocument } = require("./lifecycle");
const { authorityErrors, roleErrors } = require("./authority");
const { validateCorrelation } = require("./correlation");

const SCHEMA_DIR = path.resolve(
  __dirname,
  "..",
  "..",
  "control-plane",
  "contracts",
  "v0.5"
);

const SCHEMA_FILES = {
  task_contract: "task.schema.json",
  execution_handoff: "handoff-result.schema.json",
  review_handoff: "review.schema.json",
  human_approval_gate: "human-approval-gate.schema.json",
  evidence_reference: "evidence-reference.schema.json",
  policy_check_reference: "policy-check-reference.schema.json",
  lifecycle_transition: "lifecycle-transition.schema.json",
  mission: "mission.schema.json",
  agent_assignment: "agent-assignment.schema.json",
  execution: "execution.schema.json",
};

const BINDING_ORIGIN_KINDS = new Set(["task_contract"]);
const BINDING_CHILD_KINDS = new Set([
  "execution_handoff",
  "review_handoff",
  "human_approval_gate",
  "evidence_reference",
  "policy_check_reference",
  "lifecycle_transition",
]);

const schemaCache = new Map();

function fail(errors) {
  return { valid: false, errors };
}

function loadSchema(kind) {
  const fileName = SCHEMA_FILES[kind];
  if (!fileName) {
    return null;
  }
  if (!schemaCache.has(kind)) {
    const filePath = path.join(SCHEMA_DIR, fileName);
    schemaCache.set(kind, JSON.parse(fs.readFileSync(filePath, "utf8")));
  }
  return schemaCache.get(kind);
}

function validateDocument(kind, doc) {
  if (!kind || !SCHEMA_FILES[kind]) {
    return fail([`unknown document kind: ${kind}`]);
  }
  if (doc === undefined || doc === null) {
    return fail(["document missing"]);
  }
  if (typeof doc !== "object" || Array.isArray(doc)) {
    return fail(["document must be a JSON object"]);
  }

  const schema = loadSchema(kind);
  const schemaResult = validate(schema, doc);
  const errors = schemaResult.errors.slice();
  errors.push(...authorityErrors(kind, doc));
  errors.push(...roleErrors(kind, doc));

  if (BINDING_ORIGIN_KINDS.has(kind)) {
    const binding = verifyContractBinding(doc);
    errors.push(...binding.errors);
  }

  if (kind === "lifecycle_transition") {
    const lifecycle = validateLifecycleDocument(doc);
    errors.push(...lifecycle.errors);
  }

  return { valid: errors.length === 0, errors };
}

function validateHandoffChain(bundle) {
  if (!bundle || typeof bundle !== "object") {
    return fail(["handoff chain bundle missing"]);
  }

  const errors = [];
  const required = [
    ["task", "task_contract"],
    ["execution_handoff", "execution_handoff"],
    ["review_handoff", "review_handoff"],
    ["approval_gate", "human_approval_gate"],
  ];

  for (const [key, kind] of required) {
    if (!bundle[key]) {
      errors.push(`handoff chain missing ${key}`);
      continue;
    }
    const result = validateDocument(kind, bundle[key]);
    if (!result.valid) {
      errors.push(...result.errors.map((err) => `${key}: ${err}`));
    }
  }

  if (bundle.evidence) {
    const result = validateDocument("evidence_reference", bundle.evidence);
    if (!result.valid) {
      errors.push(...result.errors.map((err) => `evidence: ${err}`));
    }
  }

  if (bundle.policy) {
    const result = validateDocument("policy_check_reference", bundle.policy);
    if (!result.valid) {
      errors.push(...result.errors.map((err) => `policy: ${err}`));
    }
  }

  const correlation = validateCorrelation(bundle);
  errors.push(...correlation.errors);

  if (bundle.task) {
    for (const key of ["execution_handoff", "review_handoff", "approval_gate", "evidence", "policy"]) {
      if (bundle[key]) {
        const copied = verifyCopiedBinding(bundle[key], bundle.task);
        errors.push(...copied.errors.map((err) => `${key}: ${err}`));
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

module.exports = {
  SCHEMA_FILES,
  validateDocument,
  validateHandoffChain,
};
