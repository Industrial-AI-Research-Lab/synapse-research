import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_DOCUMENT_SORT,
  filterDocuments,
  formatDate,
  formatDocumentUnits,
  formatFileSize,
  getVisibleDocuments,
  sortDocuments,
  toggleDocumentSort,
} from "../src/app/documents/documentPresentation.ts";

const documents = [
  {
    id: "new",
    filename: "zeta-report.json",
    uploadedAt: "2026-10-22T12:00:00Z",
    sha256: "a",
    sizeBytes: 1000,
    pageCount: 1,
    textPageCount: 1,
    chunkCount: 1,
    status: "ready",
  },
  {
    id: "old",
    filename: "alpha-notes.pdf",
    uploadedAt: "2026-01-02T08:00:00Z",
    sha256: "b",
    sizeBytes: 5000,
    pageCount: 2,
    textPageCount: 2,
    chunkCount: 2,
    status: "ready",
  },
  {
    id: "mid",
    filename: "Beta Handbook.JSON",
    uploadedAt: "2026-06-15T09:30:00Z",
    sha256: "c",
    sizeBytes: 2500,
    pageCount: 3,
    textPageCount: 3,
    chunkCount: 3,
    status: "ready",
  },
];

test("filters documents by filename regardless of case and surrounding spaces", () => {
  assert.deepEqual(
    filterDocuments(documents, "  JSON ").map((item) => item.id),
    ["new", "mid"],
  );
  assert.deepEqual(filterDocuments(documents, "alpha").map((item) => item.id), [
    "old",
  ]);
  assert.deepEqual(filterDocuments(documents, "   "), documents);
});

test("sorts documents by upload date, name, type and size", () => {
  assert.deepEqual(
    sortDocuments(documents, "uploaded-desc").map((item) => item.id),
    ["new", "mid", "old"],
  );
  assert.deepEqual(
    sortDocuments(documents, "uploaded-asc").map((item) => item.id),
    ["old", "mid", "new"],
  );
  assert.deepEqual(
    sortDocuments(documents, "name-asc").map((item) => item.id),
    ["old", "mid", "new"],
  );
  assert.deepEqual(
    sortDocuments(documents, "name-desc").map((item) => item.id),
    ["new", "mid", "old"],
  );
  assert.deepEqual(
    sortDocuments(documents, "type-asc").map((item) => item.id),
    ["new", "mid", "old"],
  );
  assert.deepEqual(
    sortDocuments(documents, "type-desc").map((item) => item.id),
    ["old", "new", "mid"],
  );
  assert.deepEqual(
    sortDocuments(documents, "size-desc").map((item) => item.id),
    ["old", "mid", "new"],
  );
  assert.deepEqual(
    sortDocuments(documents, "size-asc").map((item) => item.id),
    ["new", "mid", "old"],
  );
});

test("header clicks toggle the active column and start a new column in its default direction", () => {
  assert.equal(toggleDocumentSort("uploaded-desc", "uploaded"), "uploaded-asc");
  assert.equal(toggleDocumentSort("uploaded-asc", "uploaded"), "uploaded-desc");
  assert.equal(toggleDocumentSort("uploaded-desc", "name"), "name-asc");
  assert.equal(toggleDocumentSort("name-asc", "name"), "name-desc");
  assert.equal(toggleDocumentSort("name-desc", "type"), "type-asc");
  assert.equal(toggleDocumentSort("type-asc", "type"), "type-desc");
  assert.equal(toggleDocumentSort("name-desc", "size"), "size-desc");
  assert.equal(toggleDocumentSort("size-desc", "size"), "size-asc");
});

test("formats file size with a non-breaking space before the unit", () => {
  assert.equal(formatFileSize(500), "1\u00a0КБ");
  assert.equal(formatFileSize(2048), "2\u00a0КБ");
  assert.equal(formatFileSize(1024 * 1024), "1\u00a0МБ");
  assert.equal(formatFileSize(2.3 * 1024 * 1024), "2,3\u00a0МБ");
});

test("formats upload date as a compact numeric timestamp", () => {
  assert.match(formatDate("2026-10-22T12:00:00Z"), /^\d{2}\.\d{2}\.2026, \d{2}:\d{2}$/);
  assert.equal(formatDate("not-a-date"), "not-a-date");
});

test("declines document unit labels in Russian", () => {
  assert.equal(formatDocumentUnits(documents[0]), undefined);
  assert.equal(
    formatDocumentUnits({ ...documents[1], pageCount: 2 }),
    "2\u00a0стр.",
  );
  assert.equal(formatDocumentUnits(documents[2]), undefined);
  assert.equal(
    formatDocumentUnits({
      ...documents[0],
      filename: "notes.txt",
      pageCount: 2,
    }),
    "2\u00a0фрагмента",
  );
});

test("search then sort keeps only matching files in the requested order", () => {
  assert.equal(DEFAULT_DOCUMENT_SORT, "name-asc");
  assert.deepEqual(
    getVisibleDocuments(documents, "json", "name-asc").map((item) => item.id),
    ["mid", "new"],
  );
  assert.deepEqual(getVisibleDocuments(documents, "нет такого"), []);
});
