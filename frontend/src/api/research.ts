import type { Research, ResearchSummary } from "../assets/types/research";
import { getTeamAccessToken } from "./teamAccess";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

interface ApiResearch {
  id: string;
  kind: "documents" | "evidence";
  question: string;
  title: string;
  sources: Research["sources"];
  created_at: string;
  checked_at: string | null;
  project_id: string;
  status: string;
  phase: string;
  synapse_url: string;
  result_url: string;
  sync_error: string;
  file_count?: number;
  approval_count?: number;
  auto_mode?: boolean;
  result_text?: string;
  failure_reason?: string;
  files?: Array<{
    id: string;
    filename: string;
    content_type: string;
    size_bytes: number;
    is_report: boolean;
  }>;
  approvals?: Array<{
    id: string;
    title: string;
    content: string;
    details: unknown;
    interaction_schema?: unknown;
    expected_data?: Record<string, unknown>;
  }>;
}

export class ResearchApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

const request = async (path: string, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  const token = getTeamAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store",
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new ResearchApiError(
      typeof payload?.detail === "string"
        ? payload.detail
        : `Не удалось выполнить запрос (HTTP ${response.status}).`,
      response.status,
    );
  }
  return response;
};

const mapResearch = (item: ApiResearch): Research => ({
  id: item.id,
  kind: item.kind,
  question: item.question,
  title: item.title,
  sources: item.sources,
  createdAt: item.created_at,
  checkedAt: item.checked_at,
  projectId: item.project_id,
  status: item.status,
  phase: item.phase,
  synapseUrl: item.synapse_url,
  resultUrl: item.result_url,
  syncError: item.sync_error,
  resultText: item.result_text ?? "",
  failureReason: item.failure_reason ?? "",
  fileCount: item.file_count ?? item.files?.length ?? 0,
  approvalCount: item.approval_count ?? item.approvals?.length ?? 0,
  autoMode: Boolean(item.auto_mode),
  files: (item.files ?? []).map((file) => ({
    id: file.id,
    filename: file.filename,
    contentType: file.content_type,
    sizeBytes: file.size_bytes,
    isReport: file.is_report,
  })),
  approvals: (item.approvals ?? []).map((approval) => ({
    id: approval.id,
    title: approval.title,
    content: approval.content,
    details: approval.details,
    interactionSchema: approval.interaction_schema,
    expectedData: approval.expected_data,
  })),
});

export const getResearches = async (): Promise<ResearchSummary[]> => {
  const response = await request("/api/researches");
  const payload: { items: ApiResearch[] } = await response.json();
  return payload.items.map(mapResearch);
};

export const getResearch = async (id: string) =>
  mapResearch(
    await (await request(`/api/researches/${encodeURIComponent(id)}`)).json(),
  );

export const refreshResearch = async (id: string) =>
  mapResearch(
    await (
      await request(`/api/researches/${encodeURIComponent(id)}/refresh`, {
        method: "POST",
      })
    ).json(),
  );

export const setResearchAutoMode = async (id: string, autoMode: boolean) =>
  mapResearch(
    await (
      await request(`/api/researches/${encodeURIComponent(id)}/auto-mode`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auto_mode: autoMode }),
      })
    ).json(),
  );

export const resolveResearchApproval = async (
  id: string,
  approvalId: string,
  approved: boolean,
  feedback: string,
  expectedData?: Record<string, unknown>,
) =>
  mapResearch(
    await (
      await request(
        `/api/researches/${encodeURIComponent(id)}/approvals/${encodeURIComponent(approvalId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            approved,
            feedback,
            expected_data: expectedData,
          }),
        },
      )
    ).json(),
  );

export const getResearchFile = async (id: string, fileId: string) =>
  (
    await request(
      `/api/researches/${encodeURIComponent(id)}/files/${encodeURIComponent(fileId)}`,
    )
  ).blob();

export const createResearchRequestId = () => {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};
