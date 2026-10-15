import type {
  DocumentMetadata,
  DocumentResearchParams,
  DocumentResearchProject,
  DocumentSearchItem,
  DocumentSearchParams,
  DocumentSearchResponse,
} from "../assets/types/documents";
import { getTeamAccessToken } from "./teamAccess";
import { createResearchRequestId } from "./research";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

interface IApiDocument {
  id: string;
  filename: string;
  uploaded_at: string;
  sha256: string;
  size_bytes: number;
  page_count: number;
  text_page_count: number;
  chunk_count: number;
  status: "ready";
}

interface IApiDocumentSearchItem {
  document_id: string;
  document_name: string;
  page: number;
  chunk_id: string;
  excerpt: string;
  score: number;
  citation: {
    document: string;
    location: string;
    url: string;
  };
}

interface IApiDocumentSearchResponse {
  query: string;
  items: IApiDocumentSearchItem[];
  total: number;
}

interface IApiDocumentAccessCodeAvailability {
  available: boolean;
}

interface IApiDocumentAccessCode {
  access_code: string;
}

interface IApiDocumentResearchProject {
  research_id?: string;
  project_id: string;
  status: string;
  phase: string;
  title: string;
  awaiting_approval: boolean;
  result_preview: string;
  result_url: string;
  synapse_url: string;
}

const getRequestHeaders = (
  headers: HeadersInit | undefined,
  accessToken?: string,
) => {
  const requestHeaders = new Headers(headers);
  const normalizedToken = (accessToken ?? getTeamAccessToken()).trim();

  if (normalizedToken) {
    requestHeaders.set("Authorization", `Bearer ${normalizedToken}`);
  }

  return requestHeaders;
};

const getErrorMessage = (payload: unknown, status: number) => {
  if (typeof payload === "object" && payload !== null && "detail" in payload) {
    const detail = payload.detail;

    if (typeof detail === "string") return detail;

    if (Array.isArray(detail)) {
      const messages = detail
        .map((item) =>
          typeof item === "object" && item !== null && "msg" in item
            ? item.msg
            : undefined,
        )
        .filter((message): message is string => typeof message === "string");

      if (messages.length) return messages.join(" ");
    }
  }

  return `Сервис вернул ошибку HTTP ${status}.`;
};

const readResponsePayload = async (response: Response): Promise<unknown> => {
  const responseText = await response.text();
  let payload: unknown = responseText;

  if (
    response.headers.get("content-type")?.includes("application/json") &&
    responseText
  ) {
    try {
      payload = JSON.parse(responseText);
    } catch {
      payload = responseText;
    }
  }

  return payload;
};

const request = async <T>(
  path: string,
  init?: RequestInit,
  accessToken?: string,
): Promise<T> => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: getRequestHeaders(init?.headers, accessToken),
  });
  const payload = await readResponsePayload(response);

  if (!response.ok) throw new Error(getErrorMessage(payload, response.status));

  if (typeof payload === "string") {
    throw new Error("Сервис вернул ответ в неподдерживаемом формате.");
  }

  return payload as T;
};

const mapDocument = (document: IApiDocument): DocumentMetadata => ({
  id: document.id,
  filename: document.filename,
  uploadedAt: document.uploaded_at,
  sha256: document.sha256,
  sizeBytes: document.size_bytes,
  pageCount: document.page_count,
  textPageCount: document.text_page_count,
  chunkCount: document.chunk_count,
  status: document.status,
});

const mapSearchItem = (item: IApiDocumentSearchItem): DocumentSearchItem => ({
  documentId: item.document_id,
  documentName: item.document_name,
  page: item.page,
  chunkId: item.chunk_id,
  excerpt: item.excerpt,
  score: item.score,
  citation: item.citation,
});

const mapResearchProject = (
  project: IApiDocumentResearchProject,
): DocumentResearchProject => ({
  researchId: project.research_id,
  projectId: project.project_id,
  status: project.status,
  phase: project.phase,
  title: project.title,
  awaitingApproval: project.awaiting_approval,
  resultPreview: project.result_preview,
  resultUrl: project.result_url,
  synapseUrl: project.synapse_url,
});

export const getDocuments = async (
  accessToken?: string,
): Promise<DocumentMetadata[]> => {
  const response = await request<{ items: IApiDocument[] }>(
    "/api/documents",
    undefined,
    accessToken,
  );
  return response.items.map(mapDocument);
};

export const getDocumentAccessCodeAvailability = async (): Promise<boolean> => {
  const response = await request<IApiDocumentAccessCodeAvailability>(
    "/api/documents/access-code/availability",
    { cache: "no-store" },
  );
  return response.available;
};

export const getDocumentAccessCode = async (): Promise<string> => {
  const response = await request<IApiDocumentAccessCode>(
    "/api/documents/access-code",
    { cache: "no-store" },
  );
  return response.access_code;
};

export const uploadDocument = async (
  file: File,
  accessToken?: string,
): Promise<DocumentMetadata> => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await request<IApiDocument>(
    "/api/documents",
    {
      method: "POST",
      body: formData,
    },
    accessToken,
  );
  return mapDocument(response);
};

export const deleteDocument = async (
  documentId: string,
  accessToken?: string,
): Promise<void> => {
  await request<IApiDocument>(
    `/api/documents/${encodeURIComponent(documentId)}`,
    { method: "DELETE" },
    accessToken,
  );
};

export const searchDocuments = async (
  params: DocumentSearchParams,
  accessToken?: string,
): Promise<DocumentSearchResponse> => {
  const response = await request<IApiDocumentSearchResponse>(
    "/api/documents/search",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: params.query,
        document_ids: params.documentIds,
        limit: params.limit,
      }),
    },
    accessToken,
  );

  return {
    query: response.query,
    items: response.items.map(mapSearchItem),
    total: response.total,
  };
};

export const startDocumentResearch = async (
  params: DocumentResearchParams,
  accessToken?: string,
): Promise<DocumentResearchProject> => {
  const response = await request<IApiDocumentResearchProject>(
    "/api/documents/research",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: params.query,
        document_ids: params.documentIds,
        request_id: createResearchRequestId(),
      }),
    },
    accessToken,
  );
  return mapResearchProject(response);
};

export const getDocumentResearchProject = async (
  projectId: string,
  accessToken?: string,
): Promise<DocumentResearchProject> => {
  const response = await request<IApiDocumentResearchProject>(
    `/api/documents/research/${encodeURIComponent(projectId)}`,
    undefined,
    accessToken,
  );
  return mapResearchProject(response);
};

export const getDocumentFile = async (path: string, accessToken?: string) => {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: getRequestHeaders(undefined, accessToken),
  });

  if (!response.ok) {
    const payload = await readResponsePayload(response);
    throw new Error(getErrorMessage(payload, response.status));
  }

  return response.blob();
};
