import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSynapseError } from "../src/app/research/parseSynapseError.ts";

test("separates the HTTP context from the original multiline response", () => {
  assert.deepEqual(
    parseSynapseError(
      "Synapse POST /api/projects: HTTP 400.\nfile type not allowed\nExtra details",
    ),
    {
      method: "POST",
      path: "/api/projects",
      httpStatus: "400",
      message: "file type not allowed\nExtra details",
      code: "",
    },
  );
});

test("does not invent a reason for older errors without a stored response", () => {
  const details = parseSynapseError("Synapse POST /api/projects: HTTP 400.");
  assert.equal(details.httpStatus, "400");
  assert.equal(details.message, "");
});

test("keeps local and connection errors separate from HTTP responses", () => {
  for (const error of [
    "",
    "Synapse не ответил вовремя.",
    "Не удалось подготовить документы для отправки в Synapse.",
    "HTTP 400",
    "Unrelated error\nSynapse POST /api/projects: HTTP 400.",
  ]) {
    const details = parseSynapseError(error);
    assert.equal(details.message, error);
    assert.equal(details.httpStatus, "");
    assert.equal(details.path, "");
  }
});

test("reads original workflow messages without replacing the provider's code", () => {
  for (const [field, code] of [
    ["code", "FACT_BATCHES_MIN_ITEMS_CONFLICT"],
    ["error_type", "task_report_failed"],
  ]) {
    const details = parseSynapseError(
      JSON.stringify({
        message: "Original message",
        [field]: code,
      }),
    );
    assert.equal(details.message, "Original message");
    assert.equal(details.code, code);
    assert.equal(details.httpStatus, "");
  }
  assert.equal(
    parseSynapseError(
      '{"detail":"Original detail","error_type":"upstream_failed"}',
    ).message,
    "Original detail",
  );
});

test("unknown structured responses and invalid JSON remain intact", () => {
  for (const response of [
    "null",
    "[]",
    "{}",
    "false",
    "0",
    '{"detail": {"nested": "failure"}}',
    '[{"loc":["body","files",0],"msg":"Unsupported file"}]',
    '{"detail":',
    '<script>alert("unsafe")</script>',
    "Ошибка ".repeat(10_000),
  ]) {
    assert.equal(parseSynapseError(response).message, response);
  }
});

test("preserves encoded identifiers, Unicode, and Windows newlines", () => {
  assert.deepEqual(
    parseSynapseError(
      "Synapse GET /api/projects/p/attachments/%D1%84%D0%B0%D0%B9%D0%BB: HTTP 404.\r\nФайл не найден",
    ),
    {
      method: "GET",
      path: "/api/projects/p/attachments/%D1%84%D0%B0%D0%B9%D0%BB",
      httpStatus: "404",
      message: "Файл не найден",
      code: "",
    },
  );
});
