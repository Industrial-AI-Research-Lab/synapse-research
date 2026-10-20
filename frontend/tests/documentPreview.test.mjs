import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canPreviewFile,
  decodePreviewText,
  getJsonPreview,
} from "../src/components/DocumentPreview/documentPreview.ts";

test("offers preview for corpus text formats and text research materials, preserving PDF", () => {
  for (const extension of [
    "JSON",
    "jsonl",
    "ndjson",
    "txt",
    "md",
    "csv",
    "tsv",
    "xml",
    "tei",
    "jats",
    "nxml",
    "html",
    "htm",
    "ris",
    "bib",
  ]) {
    assert.equal(canPreviewFile(`источник.${extension}`), true, extension);
  }
  assert.equal(canPreviewFile("output.log", "text/plain; charset=UTF-8"), true);
  assert.equal(canPreviewFile("output", "application/json"), true);
  for (const name of [
    "report.pdf",
    "photo.png",
    "book.docx",
    "sheet.xlsx",
    "archive.zip",
    "unknown",
  ]) {
    assert.equal(canPreviewFile(name), false, name);
  }
  assert.equal(canPreviewFile("report.PDF", "text/plain"), false);
});

test("decodes UTF-8, UTF-8 BOM, UTF-16 in both byte orders and Windows-1251", () => {
  const encoder = new TextEncoder();
  assert.equal(decodePreviewText(encoder.encode("Привет")), "Привет");
  assert.equal(
    decodePreviewText(
      new Uint8Array([239, 187, 191, ...encoder.encode("Привет")]),
    ),
    "Привет",
  );
  assert.equal(
    decodePreviewText(new Uint8Array([255, 254, 31, 4, 64, 4])),
    "Пр",
  );
  assert.equal(
    decodePreviewText(new Uint8Array([254, 255, 4, 31, 4, 64])),
    "Пр",
  );
  assert.equal(
    decodePreviewText(new Uint8Array([207, 240, 232, 226, 229, 242])),
    "Привет",
  );
  assert.equal(decodePreviewText(new Uint8Array()), "");
  assert.throws(() => decodePreviewText(new Uint8Array([0, 1, 2])), /двоичные/);
});

test("a preview cut inside a UTF-8 or UTF-16 character does not corrupt the text", () => {
  assert.equal(decodePreviewText(new Uint8Array([65, 208]), true), "A");
  assert.equal(
    decodePreviewText(new Uint8Array([255, 254, 65, 0, 31]), true),
    "A",
  );
  assert.throws(
    () => decodePreviewText(new Uint8Array([255, 254, 65, 0, 31])),
    /UTF-16/,
  );
});

test("handles objects, arrays, empty JSON, primitives and line-delimited JSON separately", () => {
  for (const value of [
    {},
    [],
    { title: "Привет", children: [1, null, true] },
  ]) {
    assert.deepEqual(
      getJsonPreview("test.JSON", JSON.stringify(value)).data,
      value,
    );
  }
  for (const value of ["", "  ", "null", "42", '"text"']) {
    assert.deepEqual(getJsonPreview("test.json", value), {});
  }
  assert.deepEqual(getJsonPreview("test.jsonl", '{"a":1}\n{"a":2}'), {});
  assert.deepEqual(
    getJsonPreview("test.html", "<script>alert(1)</script>"),
    {},
  );
  assert.match(
    getJsonPreview("test.json", '{"broken":}').notice,
    /Не удалось разобрать/,
  );
});

test("does not silently round unsafe JSON numbers or mistake quoted numbers for them", () => {
  for (const value of [
    '{"id":9007199254740993}',
    '{"id":-9007199254740993}',
    '{"id":1e400}',
  ]) {
    const result = getJsonPreview("test.json", value);
    assert.equal(result.data, undefined);
    assert.match(result.notice, /точности/);
  }
  const text =
    '{"id":"9007199254740993", "escaped":"\\\"9007199254740993", "value":9007199254740991}';
  assert.deepEqual(getJsonPreview("test.json", text).data, JSON.parse(text));
});

test("limits tree size and nesting while keeping the source available to the caller", () => {
  const long = JSON.stringify({ text: "a".repeat(5 * 1024 * 1024) });
  const dense = JSON.stringify(Array.from({ length: 10000 }, () => 0));
  let nested = {};
  for (let i = 0; i < 65; i++) nested = { child: nested };
  for (const text of [long, dense, JSON.stringify(nested)]) {
    assert.equal(getJsonPreview("test.json", text).data, undefined);
    assert.ok(getJsonPreview("test.json", text).notice);
  }
  assert.ok(
    getJsonPreview("test.json", JSON.stringify(Array(9999).fill(0))).data,
  );
});
