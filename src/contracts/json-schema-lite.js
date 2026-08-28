"use strict";

/**
 * Minimal JSON Schema validator for Control Plane contracts v0.5.
 * Supports: type, required, properties, additionalProperties false,
 * enum, const, minLength, pattern, minimum, maximum, minItems, items,
 * format date-time, $ref to #/$defs/*, if/then/else, allOf.
 * Not a full JSON Schema implementation. Not an authority source.
 */

const DATE_TIME_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function resolveRef(root, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new Error(`Unsupported $ref: ${ref}`);
  }
  const parts = ref.slice(2).split("/");
  let node = root;
  for (const part of parts) {
    if (!isObject(node) || !Object.prototype.hasOwnProperty.call(node, part)) {
      throw new Error(`Unresolved $ref: ${ref}`);
    }
    node = node[part];
  }
  return node;
}

function typeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(expected, value) {
  const actual = typeOf(value);
  if (expected === "number") {
    return actual === "number" || actual === "integer";
  }
  if (expected === "integer") {
    return actual === "integer";
  }
  return actual === expected;
}

function walk(schema, data, path, errors, root) {
  if (schema === true) return;
  if (schema === false) {
    errors.push(`${path}: false schema`);
    return;
  }
  if (!isObject(schema)) return;

  if (schema.$ref) {
    walk(resolveRef(root, schema.$ref), data, path, errors, root);
    const rest = { ...schema };
    delete rest.$ref;
    delete rest.description;
    const keys = Object.keys(rest).filter((k) => k !== "title");
    if (keys.length === 0) return;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, data))) {
      errors.push(`${path}: expected type ${types.join("|")}, got ${typeOf(data)}`);
      return;
    }
  }

  if (Object.prototype.hasOwnProperty.call(schema, "const")) {
    if (data !== schema.const) {
      errors.push(`${path}: expected const ${JSON.stringify(schema.const)}`);
    }
  }

  if (schema.enum) {
    if (!schema.enum.some((item) => Object.is(item, data) || item === data)) {
      errors.push(`${path}: value not in enum`);
    }
  }

  if (typeof data === "string") {
    if (schema.minLength !== undefined && data.length < schema.minLength) {
      errors.push(`${path}: shorter than minLength ${schema.minLength}`);
    }
    if (schema.maxLength !== undefined && data.length > schema.maxLength) {
      errors.push(`${path}: longer than maxLength ${schema.maxLength}`);
    }
    if (schema.pattern) {
      const re = new RegExp(schema.pattern);
      if (!re.test(data)) {
        errors.push(`${path}: does not match pattern ${schema.pattern}`);
      }
    }
    if (schema.format === "date-time" && !DATE_TIME_RE.test(data)) {
      errors.push(`${path}: invalid date-time`);
    }
  }

  if (typeof data === "number") {
    if (schema.minimum !== undefined && data < schema.minimum) {
      errors.push(`${path}: below minimum ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && data > schema.maximum) {
      errors.push(`${path}: above maximum ${schema.maximum}`);
    }
  }

  if (Array.isArray(data)) {
    if (schema.minItems !== undefined && data.length < schema.minItems) {
      errors.push(`${path}: fewer than minItems ${schema.minItems}`);
    }
    if (schema.maxItems !== undefined && data.length > schema.maxItems) {
      errors.push(`${path}: more than maxItems ${schema.maxItems}`);
    }
    if (schema.items) {
      data.forEach((item, index) => {
        walk(schema.items, item, `${path}/${index}`, errors, root);
      });
    }
  }

  if (isObject(data)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
          errors.push(`${path}: missing required property ${key}`);
        }
      }
    }

    if (schema.properties) {
      for (const [key, sub] of Object.entries(schema.properties)) {
        if (Object.prototype.hasOwnProperty.call(data, key)) {
          walk(sub, data[key], `${path}/${key}`, errors, root);
        }
      }
    }

    if (schema.additionalProperties === false && schema.properties) {
      for (const key of Object.keys(data)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
          errors.push(`${path}: additional property not allowed: ${key}`);
        }
      }
    } else if (isObject(schema.additionalProperties) && schema.properties) {
      for (const [key, value] of Object.entries(data)) {
        if (!Object.prototype.hasOwnProperty.call(schema.properties, key)) {
          walk(schema.additionalProperties, value, `${path}/${key}`, errors, root);
        }
      }
    }
  }

  if (schema.if) {
    const probe = [];
    walk(schema.if, data, path, probe, root);
    if (probe.length === 0) {
      if (schema.then) walk(schema.then, data, path, errors, root);
    } else if (schema.else) {
      walk(schema.else, data, path, errors, root);
    }
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) {
      walk(sub, data, path, errors, root);
    }
  }
}

function validate(schema, data) {
  const errors = [];
  walk(schema, data, "#", errors, schema);
  return { valid: errors.length === 0, errors };
}

module.exports = { validate };
