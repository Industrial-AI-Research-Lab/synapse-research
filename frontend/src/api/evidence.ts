import type {
  AnalysisResponse,
  EvidenceFiltersValue,
  EvidenceItem,
  EvidenceReview,
  EvidenceReviewsResponse,
  EvidenceReviewSubmission,
  EvidenceResponse,
  QualityReport,
  PublicSourcesResponse,
  SynapseConfig,
  SynapseProject,
} from "../assets/types/evidence";
import { createResearchRequestId, ResearchApiError } from "./research";
import { getTeamAccessToken } from "./teamAccess";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, "") ?? "";

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const headers = new Headers(init?.headers);
  const token = getTeamAccessToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
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

  if (!response.ok) {
    const detail =
      typeof payload === "object" && payload !== null && "detail" in payload
        ? payload.detail
        : undefined;
    throw new ResearchApiError(
      typeof detail === "string"
        ? detail
        : `Сервис вернул ошибку HTTP ${response.status}.`,
      response.status,
    );
  }

  if (typeof payload === "string") {
    throw new Error("Сервис вернул ответ в неподдерживаемом формате.");
  }

  return payload as T;
};

export const getEvidence = (filters: EvidenceFiltersValue) => {
  const query = new URLSearchParams();
  if (filters.minTemperature)
    query.set("min_temperature", filters.minTemperature);
  if (filters.maxTemperature)
    query.set("max_temperature", filters.maxTemperature);
  if (filters.maxSalinity) query.set("max_salinity", filters.maxSalinity);
  if (filters.comparableOnly) query.set("comparable_only", "true");
  const suffix = query.size ? `?${query}` : "";
  return request<EvidenceResponse>(`/api/evidence${suffix}`);
};

export const getEvidenceItem = (evidenceId: string) =>
  request<EvidenceItem>(`/api/evidence/${encodeURIComponent(evidenceId)}`);

export const getSynapseConfig = () =>
  request<SynapseConfig>("/api/synapse/config");

export const getQualityReport = () =>
  request<QualityReport>("/api/quality/report");

export const getPublicSources = () =>
  request<PublicSourcesResponse>("/api/public-sources");

export const getEvidenceReviews = () =>
  request<EvidenceReviewsResponse>("/api/evidence-reviews");

export const createEvidenceReview = (submission: EvidenceReviewSubmission) =>
  request<EvidenceReview>("/api/evidence-reviews", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });

export const approveEvidenceReview = (reviewId: string) =>
  request<EvidenceReview>(
    `/api/evidence-reviews/${encodeURIComponent(reviewId)}/approve`,
    { method: "POST" },
  );

export const createAnalysis = (question: string, experimentIds: string[]) =>
  request<AnalysisResponse>("/api/analysis", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, experiment_ids: experimentIds }),
  });

export const createSynapseProject = (
  question: string,
  experimentIds: string[],
  autoMode = false,
) =>
  request<SynapseProject>("/api/synapse/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      experiment_ids: experimentIds,
      request_id: createResearchRequestId(),
      auto_mode: autoMode,
    }),
  });
