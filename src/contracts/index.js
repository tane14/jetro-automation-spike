"use strict";

/**
 * Public surface for Control Plane contracts v0.5.
 * Prepared for a future API / Web Control Plane. This is not an HTTP API,
 * database, runner, or authority source.
 *
 * validateDocument() is shape/boundary validation of one document.
 * It is never sufficient for authority decisions.
 * Review/approval chains MUST use validateHandoffChain() and/or
 * validateCorrelation(). Those still do not grant human authority:
 * live GitHub PR review APPROVED + approval-provenance v0.4 remains
 * the only human authority source.
 */

const { validate } = require("./json-schema-lite");
const {
  canonicalJson,
  computeContractHash,
  stampContractHash,
  verifyContractBinding,
  verifyCopiedBinding,
} = require("./binding");
const {
  TASK_STATES,
  EXECUTION_STATES,
  REVIEW_STATES,
  ALLOWED_TASK_TRANSITIONS,
  validateTransition,
  validateLifecycleDocument,
} = require("./lifecycle");
const { ROLES, ALLOWED_HANDOFF_PAIRS, authorityErrors, roleErrors } = require("./authority");
const { validateCorrelation } = require("./correlation");
const { validateDocument, validateHandoffChain, SCHEMA_FILES, NOT_AUTHORITY } = require("./validate");

module.exports = {
  SCHEMA_FILES,
  NOT_AUTHORITY,
  ROLES,
  ALLOWED_HANDOFF_PAIRS,
  TASK_STATES,
  EXECUTION_STATES,
  REVIEW_STATES,
  ALLOWED_TASK_TRANSITIONS,
  validate,
  validateDocument,
  validateHandoffChain,
  validateCorrelation,
  validateTransition,
  validateLifecycleDocument,
  canonicalJson,
  computeContractHash,
  stampContractHash,
  verifyContractBinding,
  verifyCopiedBinding,
  authorityErrors,
  roleErrors,
};
