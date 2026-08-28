"use strict";

/**
 * Deterministic contract hash / binding for Control Plane contracts v0.5.
 * Canonical JSON is key-sorted, whitespace-free UTF-8. contract_hash is
 * SHA-256 of those bytes (isomorphic digest; bit-identical to node:crypto).
 * The field is excluded from the digest so it can store the binding.
 * Not an authority source.
 */

const { sha256Hex } = require("./sha256");

function canonicalJson(value) {
  if (value === null) return "null";
  const t = typeof value;
  if (t === "boolean") return value ? "true" : "false";
  if (t === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("canonical JSON rejects non-finite numbers");
    }
    return JSON.stringify(value);
  }
  if (t === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (t === "object") {
    const keys = Object.keys(value).sort();
    const parts = keys.map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    );
    return `{${parts.join(",")}}`;
  }
  throw new Error(`canonical JSON rejects type ${t}`);
}

function cloneWithoutHash(doc) {
  const copy = JSON.parse(JSON.stringify(doc));
  delete copy.contract_hash;
  return copy;
}

function computeContractHash(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    throw new Error("contract hash requires an object document");
  }
  const canonical = canonicalJson(cloneWithoutHash(doc));
  return sha256Hex(canonical);
}

function stampContractHash(doc) {
  const stamped = JSON.parse(JSON.stringify(doc));
  delete stamped.contract_hash;
  stamped.contract_hash = computeContractHash(stamped);
  return stamped;
}

function verifyContractBinding(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { valid: false, errors: ["contract binding: document missing"] };
  }
  if (typeof doc.contract_hash !== "string" || !/^[a-f0-9]{64}$/.test(doc.contract_hash)) {
    return { valid: false, errors: ["contract binding: missing or invalid contract_hash"] };
  }
  const expected = computeContractHash(doc);
  if (doc.contract_hash !== expected) {
    return {
      valid: false,
      errors: ["contract binding: contract_hash does not match canonical digest"],
    };
  }
  return { valid: true, errors: [] };
}

function verifyCopiedBinding(child, task) {
  if (!child || typeof child.contract_hash !== "string") {
    return { valid: false, errors: ["child document missing contract_hash binding"] };
  }
  if (!task || typeof task.contract_hash !== "string") {
    return { valid: false, errors: ["task contract missing contract_hash binding"] };
  }
  if (child.contract_hash !== task.contract_hash) {
    return {
      valid: false,
      errors: ["child contract_hash does not match task contract binding"],
    };
  }
  return { valid: true, errors: [] };
}

module.exports = {
  canonicalJson,
  computeContractHash,
  stampContractHash,
  verifyContractBinding,
  verifyCopiedBinding,
};
