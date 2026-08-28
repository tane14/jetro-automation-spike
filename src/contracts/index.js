"use strict";

/**
 * Public surface for Control Plane contracts v0.5.
 * Prepared for a future API / Web Control Plane. This is not an HTTP API,
 * database, runner, or authority source.
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
const { validateDocument, validateHandoffChain, SCHEMA_FILES } = require("./validate");

module.exports = {
  SCHEMA_FILES,
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
