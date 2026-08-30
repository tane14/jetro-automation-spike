"use strict";

/**
 * Defensive parser for Cursor Agent CLI --print --output-format json.
 * SUCCEEDED requires type === "result", subtype === "success", is_error === false.
 * Malformed input fails closed. Not an authority source.
 */

const RESULT_CLASS = {
  SUCCEEDED: "SUCCEEDED",
  CLI_ERROR: "CLI_ERROR",
  INVALID_STRUCTURED_OUTPUT: "INVALID_STRUCTURED_OUTPUT",
};

function asFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value) {
  return typeof value === "string" ? value : null;
}

function parseUsage(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const usage = {};
  if (typeof raw.inputTokens === "number" && Number.isFinite(raw.inputTokens)) {
    usage.inputTokens = raw.inputTokens;
  }
  if (typeof raw.outputTokens === "number" && Number.isFinite(raw.outputTokens)) {
    usage.outputTokens = raw.outputTokens;
  }
  if (typeof raw.cacheReadTokens === "number" && Number.isFinite(raw.cacheReadTokens)) {
    usage.cacheReadTokens = raw.cacheReadTokens;
  }
  if (typeof raw.cacheWriteTokens === "number" && Number.isFinite(raw.cacheWriteTokens)) {
    usage.cacheWriteTokens = raw.cacheWriteTokens;
  }
  return Object.keys(usage).length ? usage : null;
}

function invalid(envelope, parseError) {
  return {
    structuredOutputValid: false,
    protocolStatus: RESULT_CLASS.INVALID_STRUCTURED_OUTPUT,
    envelope,
    agentResult: envelope ? envelope.result : null,
    sessionId: envelope ? envelope.session_id : null,
    requestId: envelope ? envelope.request_id : null,
    usage: envelope ? envelope.usage : null,
    parseError,
  };
}

function parseCursorCliEnvelope(stdoutText) {
  if (typeof stdoutText !== "string" || stdoutText.trim() === "") {
    return invalid(null, "stdout is empty or not text");
  }
  const trimmed = stdoutText.trim();
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    return invalid(null, err instanceof Error ? err.message : "JSON parse failed");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid(null, "JSON root is not an object");
  }
  const envelope = {
    type: asString(parsed.type),
    subtype: asString(parsed.subtype),
    is_error: typeof parsed.is_error === "boolean" ? parsed.is_error : null,
    duration_ms: asFiniteNumber(parsed.duration_ms),
    duration_api_ms: asFiniteNumber(parsed.duration_api_ms),
    result: typeof parsed.result === "string" ? parsed.result : null,
    session_id: asString(parsed.session_id),
    request_id: asString(parsed.request_id),
    usage: parseUsage(parsed.usage),
  };
  if (parsed.type !== "result") {
    return invalid(envelope, "envelope type is not result");
  }
  if (typeof parsed.is_error === "boolean" && parsed.is_error === true) {
    return {
      structuredOutputValid: true,
      protocolStatus: RESULT_CLASS.CLI_ERROR,
      envelope,
      agentResult: envelope.result,
      sessionId: envelope.session_id,
      requestId: envelope.request_id,
      usage: envelope.usage,
      parseError: null,
    };
  }
  if (typeof parsed.subtype === "string" && parsed.subtype === "error") {
    return {
      structuredOutputValid: true,
      protocolStatus: RESULT_CLASS.CLI_ERROR,
      envelope,
      agentResult: envelope.result,
      sessionId: envelope.session_id,
      requestId: envelope.request_id,
      usage: envelope.usage,
      parseError: null,
    };
  }
  if (typeof parsed.subtype !== "string") {
    return invalid(envelope, "envelope subtype is missing or not a string");
  }
  if (typeof parsed.is_error !== "boolean") {
    return invalid(envelope, "envelope is_error is missing or not a boolean");
  }
  if (parsed.subtype === "success" && parsed.is_error === false) {
    return {
      structuredOutputValid: true,
      protocolStatus: RESULT_CLASS.SUCCEEDED,
      envelope,
      agentResult: envelope.result,
      sessionId: envelope.session_id,
      requestId: envelope.request_id,
      usage: envelope.usage,
      parseError: null,
    };
  }
  return {
    structuredOutputValid: true,
    protocolStatus: RESULT_CLASS.CLI_ERROR,
    envelope,
    agentResult: envelope.result,
    sessionId: envelope.session_id,
    requestId: envelope.request_id,
    usage: envelope.usage,
    parseError: null,
  };
}

module.exports = {
  RESULT_CLASS,
  parseCursorCliEnvelope,
};
