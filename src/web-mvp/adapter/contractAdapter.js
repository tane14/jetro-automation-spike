/**
 * Contract adapter: ControlPlaneDataSource → Contracts v0.5 → Authority Boundary.
 *
 * Uses json-schema-lite, correlation, authority, and binding (SHA-256
 * contract_hash verification) from src/contracts/. React components must not
 * import schemas. valid:true is never authorization. A matching copied hash
 * is not enough: the Task Contract digest must verify.
 */

import { validate } from "../../contracts/json-schema-lite.js";
import { validateCorrelation } from "../../contracts/correlation.js";
import { authorityErrors, roleErrors } from "../../contracts/authority.js";
import {
  verifyContractBinding,
  verifyCopiedBinding,
} from "../../contracts/binding.js";
import { projectContractView, NOT_AUTHORITY } from "./projectContractView.js";

import taskSchema from "../../../control-plane/contracts/v0.5/task.schema.json" with { type: "json" };
import handoffSchema from "../../../control-plane/contracts/v0.5/handoff-result.schema.json" with { type: "json" };
import reviewSchema from "../../../control-plane/contracts/v0.5/review.schema.json" with { type: "json" };
import gateSchema from "../../../control-plane/contracts/v0.5/human-approval-gate.schema.json" with { type: "json" };
import evidenceSchema from "../../../control-plane/contracts/v0.5/evidence-reference.schema.json" with { type: "json" };
import policySchema from "../../../control-plane/contracts/v0.5/policy-check-reference.schema.json" with { type: "json" };
import missionSchema from "../../../control-plane/contracts/v0.5/mission.schema.json" with { type: "json" };
import assignmentSchema from "../../../control-plane/contracts/v0.5/agent-assignment.schema.json" with { type: "json" };
import executionSchema from "../../../control-plane/contracts/v0.5/execution.schema.json" with { type: "json" };

const SCHEMAS = {
  task_contract: taskSchema,
  execution_handoff: handoffSchema,
  review_handoff: reviewSchema,
  human_approval_gate: gateSchema,
  evidence_reference: evidenceSchema,
  policy_check_reference: policySchema,
  mission: missionSchema,
  agent_assignment: assignmentSchema,
  execution: executionSchema,
};

const KIND_BY_KEY = {
  mission: "mission",
  task: "task_contract",
  assignment: "agent_assignment",
  execution: "execution",
  execution_handoff: "execution_handoff",
  review_handoff: "review_handoff",
  approval_gate: "human_approval_gate",
  evidence: "evidence_reference",
  policy: "policy_check_reference",
};

function unwrap(mod, name) {
  if (mod && typeof mod[name] === "function") return mod[name];
  if (mod && mod.default && typeof mod.default[name] === "function") {
    return mod.default[name];
  }
  return mod;
}

const validateFn = unwrap(validate, "validate") || validate;
const validateCorrelationFn =
  unwrap(validateCorrelation, "validateCorrelation") || validateCorrelation;
const authorityErrorsFn = unwrap(authorityErrors, "authorityErrors") || authorityErrors;
const roleErrorsFn = unwrap(roleErrors, "roleErrors") || roleErrors;
const verifyContractBindingFn =
  unwrap(verifyContractBinding, "verifyContractBinding") || verifyContractBinding;
const verifyCopiedBindingFn =
  unwrap(verifyCopiedBinding, "verifyCopiedBinding") || verifyCopiedBinding;

function validateOne(kind, doc) {
  if (doc === undefined || doc === null) {
    return { valid: false, errors: ["document missing"], ...NOT_AUTHORITY };
  }
  const schema = SCHEMAS[kind];
  if (!schema) {
    return { valid: false, errors: [`unknown kind ${kind}`], ...NOT_AUTHORITY };
  }
  const schemaResult = validateFn(schema, doc);
  const errors = [...(schemaResult.errors || [])];
  errors.push(...authorityErrorsFn(kind, doc));
  errors.push(...roleErrorsFn(kind, doc));
  if (kind === "task_contract") {
    const binding = verifyContractBindingFn(doc);
    errors.push(...(binding.errors || []));
  }
  return { valid: errors.length === 0, errors, ...NOT_AUTHORITY };
}

function copiedHashErrors(bundle) {
  const errors = [];
  if (!bundle.task) return errors;
  for (const key of [
    "execution_handoff",
    "review_handoff",
    "approval_gate",
    "evidence",
    "policy",
  ]) {
    if (bundle[key]) {
      const copied = verifyCopiedBindingFn(bundle[key], bundle.task);
      errors.push(...copied.errors.map((err) => `${key}: ${err}`));
    }
  }
  return errors;
}

export function validateBundleWithContractsLite(bundle) {
  const documentResults = {};
  for (const [key, kind] of Object.entries(KIND_BY_KEY)) {
    if (bundle[key]) {
      documentResults[key] = validateOne(kind, bundle[key]);
    }
  }

  const required = ["task", "execution_handoff", "review_handoff", "approval_gate"];
  const chainErrors = [];
  for (const key of required) {
    if (!bundle[key]) {
      chainErrors.push(`handoff chain missing ${key}`);
    } else if (documentResults[key] && !documentResults[key].valid) {
      chainErrors.push(
        ...documentResults[key].errors.map((err) => `${key}: ${err}`),
      );
    }
  }
  chainErrors.push(...copiedHashErrors(bundle));

  const correlation = validateCorrelationFn(bundle);
  chainErrors.push(...(correlation.errors || []));

  const chain = {
    valid: chainErrors.length === 0,
    errors: chainErrors,
    ...NOT_AUTHORITY,
  };

  return {
    documentResults,
    chain,
    correlation: { ...correlation, ...NOT_AUTHORITY },
  };
}

export function adaptContractBundle(entry) {
  const validation = validateBundleWithContractsLite(entry.bundle);
  return projectContractView({
    entry,
    bundle: entry.bundle,
    ...validation,
  });
}
