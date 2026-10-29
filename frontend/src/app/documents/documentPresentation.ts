import type { DocumentMetadata } from "../../assets/types/documents";

export const MAX_SELECTED_DOCUMENTS = 50;
export const MIN_VISIBLE_LIST_ITEMS = 3;
export const RESEARCH_POLLING_INTERVAL = 5_000;
export const DOCUMENT_SORTS = [
  { id: "uploaded-desc", label: "Сначала новые" },
  { id: "uploaded-asc", label: "Сначала старые" },
  { id: "name-asc", label: "Имя А–Я" },
  { id: "name-desc", label: "Имя Я–А" },
  { id: "type-asc", label: "Тип А–Я" },
  { id: "type-desc", label: "Тип Я–А" },
  { id: "size-desc", label: "Сначала большие" },
  { id: "size-asc", label: "Сначала маленькие" },
] as const;
export type DocumentSortId = (typeof DOCUMENT_SORTS)[number]["id"];
export type DocumentSortField = "name" | "type" | "size" | "uploaded";
export type DocumentSortDirection = "asc" | "desc";
export const DEFAULT_DOCUMENT_SORT: DocumentSortId = "name-asc";
export const DOCUMENT_SORT_COLUMNS = [
  { field: "type", label: "Тип" },
  { field: "name", label: "Название" },
  { field: "size", label: "Размер" },
  { field: "uploaded", label: "Добавлен" },
] as const;

export const isDocumentSortId = (value: string): value is DocumentSortId =>
  DOCUMENT_SORTS.some((item) => item.id === value);

export const getDocumentSortField = (sort: DocumentSortId): DocumentSortField =>
  sort.startsWith("name-")
    ? "name"
    : sort.startsWith("type-")
      ? "type"
      : sort.startsWith("size-")
        ? "size"
        : "uploaded";

export const getDocumentSortDirection = (
  sort: DocumentSortId,
): DocumentSortDirection => (sort.endsWith("-asc") ? "asc" : "desc");

export const toggleDocumentSort = (
  current: DocumentSortId,
  field: DocumentSortField,
): DocumentSortId => {
  if (getDocumentSortField(current) === field) {
    const nextDirection =
      getDocumentSortDirection(current) === "asc" ? "desc" : "asc";

    return `${field}-${nextDirection}` as DocumentSortId;
  }

  return (
    field === "name" || field === "type" ? `${field}-asc` : `${field}-desc`
  ) as DocumentSortId;
};
export const SUPPORTED_DOCUMENT_ACCEPT =
  ".pdf,.json,.jsonl,.ndjson,.csv,.tsv,.xml,.tei,.jats,.nxml,.html,.htm,.txt,.md,.ris,.bib";

export const isFinalResearchStatus = (status: string) =>
  ["completed", "failed", "cancelled", "canceled"].includes(
    status.toLowerCase(),
  );

const NBSP = "\u00a0";

const formatCountLabel = (
  count: number,
  forms: { one: string; few: string; other: string },
) => {
  const rule = new Intl.PluralRules("ru-RU").select(count);
  const label =
    rule === "one" || rule === "few" ? forms[rule] : forms.other;

  return `${count}${NBSP}${label}`;
};

const getFileSizeParts = (sizeBytes: number) => {
  if (sizeBytes < 1024 * 1024) {
    return {
      value: `${Math.max(1, Math.round(sizeBytes / 1024))}`,
      unit: "КБ",
    };
  }

  return {
    value: (sizeBytes / (1024 * 1024)).toLocaleString("ru-RU", {
      maximumFractionDigits: 1,
    }),
    unit: "МБ",
  };
};

export const formatFileSize = (sizeBytes: number) => {
  const { value, unit } = getFileSizeParts(sizeBytes);

  return `${value}${NBSP}${unit}`;
};

export const formatDate = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
};

export const formatDocumentStatus = (status: DocumentMetadata["status"]) => {
  if (status === "ready") return "Готов к поиску";

  return status;
};

export const getDocumentExtension = (filename: string) => {
  const dotIndex = filename.lastIndexOf(".");

  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
};

export const formatDocumentType = (filename: string) =>
  getDocumentExtension(filename).slice(1).toUpperCase();

export const isPdfFilename = (filename: string) =>
  getDocumentExtension(filename) === ".pdf";

export const getDocumentFileAction = (filename: string) => {
  if (isPdfFilename(filename)) {
    return {
      label: "Открыть PDF",
      loadingLabel: "Открываем…",
      icon: "externalLink" as const,
      description: "Открыть PDF в новой вкладке",
    };
  }

  const format = getDocumentExtension(filename).slice(1).toUpperCase();

  return {
    label: format ? `Скачать ${format}` : "Скачать файл",
    loadingLabel: "Скачиваем…",
    icon: "download" as const,
    description: "Скачать исходный файл на устройство",
  };
};

export const formatDocumentUnits = (document: DocumentMetadata) => {
  const extension = getDocumentExtension(document.filename);

  if (extension === ".pdf") {
    return `${document.pageCount}${NBSP}стр.`;
  }

  if ([".json", ".jsonl", ".ndjson", ".ris", ".bib"].includes(extension)) {
    return undefined;
  }

  if ([".csv", ".tsv"].includes(extension)) {
    return formatCountLabel(document.pageCount, {
      one: "строка",
      few: "строки",
      other: "строк",
    });
  }

  return formatCountLabel(document.pageCount, {
    one: "фрагмент",
    few: "фрагмента",
    other: "фрагментов",
  });
};

const compareText = (left: string, right: string) =>
  left.localeCompare(right, "ru-RU", { numeric: true, sensitivity: "base" });

export const filterDocuments = (
  documents: readonly DocumentMetadata[],
  query: string,
) => {
  const needle = query.trim().toLocaleLowerCase("ru-RU");

  if (!needle) return [...documents];

  return documents.filter((document) =>
    document.filename.toLocaleLowerCase("ru-RU").includes(needle),
  );
};

export const sortDocuments = (
  documents: readonly DocumentMetadata[],
  sort: DocumentSortId,
) => {
  const sorted = [...documents];

  sorted.sort((left, right) => {
    switch (sort) {
      case "uploaded-asc":
        return compareText(left.uploadedAt, right.uploadedAt);
      case "uploaded-desc":
        return compareText(right.uploadedAt, left.uploadedAt);
      case "name-asc":
        return compareText(left.filename, right.filename);
      case "name-desc":
        return compareText(right.filename, left.filename);
      case "type-asc":
        return compareText(
          formatDocumentType(left.filename),
          formatDocumentType(right.filename),
        );
      case "type-desc":
        return compareText(
          formatDocumentType(right.filename),
          formatDocumentType(left.filename),
        );
      case "size-asc":
        return left.sizeBytes - right.sizeBytes;
      case "size-desc":
        return right.sizeBytes - left.sizeBytes;
    }
  });

  return sorted;
};

export const getVisibleDocuments = (
  documents: readonly DocumentMetadata[],
  query: string,
  sort: DocumentSortId = DEFAULT_DOCUMENT_SORT,
) => sortDocuments(filterDocuments(documents, query), sort);

export const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const temporaryInput = document.createElement("textarea");
  temporaryInput.value = value;
  temporaryInput.setAttribute("readonly", "");
  temporaryInput.style.position = "fixed";
  temporaryInput.style.opacity = "0";
  document.body.append(temporaryInput);
  temporaryInput.select();

  const isCopied = document.execCommand("copy");
  temporaryInput.remove();

  if (!isCopied) {
    throw new Error("Не удалось скопировать код. Скопируйте его вручную.");
  }
};
