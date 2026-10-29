export interface DocumentPreviewSource {
  filename: string;
  load: () => Promise<Blob>;
}

export const MAX_PREVIEW_BYTES = 5 * 1024 * 1024;
const MAX_TREE_CHARS = MAX_PREVIEW_BYTES;
const MAX_TREE_NODES = 10_000;
const MAX_TREE_DEPTH = 64;
const TEXT_EXTENSIONS = new Set([
  "json",
  "jsonl",
  "ndjson",
  "csv",
  "tsv",
  "xml",
  "tei",
  "jats",
  "nxml",
  "html",
  "htm",
  "txt",
  "md",
  "ris",
  "bib",
]);

export const canPreviewFile = (filename: string, contentType = "") => {
  const extension = filename.split(".").pop()?.toLowerCase() ?? "";
  if (extension === "pdf") return false;
  const mime = contentType.split(";")[0].trim().toLowerCase();
  return (
    TEXT_EXTENSIONS.has(extension) ||
    mime.startsWith("text/") ||
    [
      "application/json",
      "application/ld+json",
      "application/xml",
      "application/x-ndjson",
    ].includes(mime)
  );
};

export const decodePreviewText = (bytes: Uint8Array, isTruncated = false) => {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  let text: string;
  try {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes, {
      stream: isTruncated,
    });
  } catch {
    if (encoding !== "utf-8")
      throw new Error("Не удалось прочитать текст файла в UTF-16.");
    text = new TextDecoder("windows-1251").decode(bytes);
  }
  if (text.includes("\0"))
    throw new Error(
      "Файл содержит двоичные данные. Скачайте его для просмотра.",
    );
  return text;
};

export const getJsonPreview = (
  filename: string,
  text: string,
): { data?: object; notice?: string } => {
  if (!filename.toLowerCase().endsWith(".json") || !text.trim()) return {};
  if (text.length > MAX_TREE_CHARS)
    return {
      notice:
        "Для большого JSON открыт исходный текст. Скачивание сохраняет весь файл.",
    };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return {
      notice: "Не удалось разобрать JSON. Ниже доступен исходный текст.",
    };
  }
  if (data === null || typeof data !== "object") return {};
  const tokens = text.matchAll(
    /("(?:\\.|[^"\\])*")|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
  );
  for (const token of tokens) {
    if (!token[2]) continue;
    const number = Number(token[2]);
    if (
      !Number.isFinite(number) ||
      (Number.isInteger(number) && !Number.isSafeInteger(number))
    ) {
      return {
        notice:
          "JSON содержит большие числа. Для сохранения точности показан исходный текст.",
      };
    }
  }
  const pending = [{ value: data, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const entry = pending.pop()!;
    if (++count > MAX_TREE_NODES || entry.depth > MAX_TREE_DEPTH) {
      return {
        notice: "JSON содержит много вложенных полей. Показан исходный текст.",
      };
    }
    if (entry.value !== null && typeof entry.value === "object") {
      for (const value of Object.values(entry.value))
        pending.push({ value, depth: entry.depth + 1 });
    }
  }
  return { data };
};
