import { MAX_SELECTED_DOCUMENTS } from "./documentPresentation";

const SELECTED_DOCUMENTS_KEY = "folio.selectedDocumentIds";

export const persistSelectedDocumentIds = (ids: string[]) => {
  try {
    sessionStorage.setItem(SELECTED_DOCUMENTS_KEY, JSON.stringify(ids));
  } catch {
    // Selection still works in memory for this visit.
  }
};

export const readPersistedDocumentIds = (): string[] | undefined => {
  try {
    const raw = sessionStorage.getItem(SELECTED_DOCUMENTS_KEY);

    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) return undefined;

    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return undefined;
  }
};

export const reconcileSelectedDocumentIds = (
  availableIds: string[],
  current: string[],
) => {
  const stored = readPersistedDocumentIds();

  if (stored !== undefined) {
    return stored
      .filter((id) => availableIds.includes(id))
      .slice(0, MAX_SELECTED_DOCUMENTS);
  }

  if (current.length) {
    return current
      .filter((id) => availableIds.includes(id))
      .slice(0, MAX_SELECTED_DOCUMENTS);
  }

  return availableIds.slice(0, MAX_SELECTED_DOCUMENTS);
};
