export type ComparabilityStatus = "comparable" | "limited" | "not_comparable";

export interface EvidenceItem {
  id: string;
  formulation: {
    name: string;
    surfactant_class: string;
    concentration_wt_pct: number;
  };
  conditions: {
    temperature_c: number | null;
    salinity_g_l: number | null;
    rock_type: string;
    permeability_md: number | null;
  };
  result: { label: string; value: number; unit: string };
  comparability: { status: ComparabilityStatus; reason: string };
  missing_fields: string[];
  source: {
    document: string;
    location: string;
    excerpt: string;
    url?: string;
  };
}

export interface EvidenceSummary {
  total: number;
  comparable: number;
  limited: number;
  not_comparable: number;
  missing_fields: string[];
  warning: string;
}

export interface EvidenceResponse {
  items: EvidenceItem[];
  summary: EvidenceSummary;
}

export interface AnalysisComparison {
  direct_pairs: string[][];
  restricted_pairs: Array<{
    left: string;
    right: string;
    reason: string;
  }>;
  direct_comparison_allowed: boolean;
}

export interface AnalysisAnswer {
  confirmed_facts: Array<{
    experiment_id: string;
    metric: string;
    value: number;
    unit: string;
    conditions: Record<string, string | number | null>;
    citation: { document: string; location: string; url: string };
  }>;
  limitations: Array<{ experiment_id: string; reason: string }>;
  comparison: AnalysisComparison;
  external_escalation: boolean;
  retry_policy: string;
}

export interface AnalysisResponse {
  question: string;
  items: EvidenceItem[];
  summary: EvidenceSummary;
  answer: AnalysisAnswer;
  synapse_prompt: string;
}

export interface QualityGate {
  value?: boolean;
  value_pct?: number;
  threshold_pct?: number;
  passed: boolean;
  description?: string;
  released_records?: number;
  audited_records?: number;
  checked_questions?: number;
}

export interface QualityReport {
  acceptance_gates: {
    all_released_numeric_facts_traceable: QualityGate;
    extraction_completeness: QualityGate;
    control_answer_accuracy: QualityGate;
    repeat_without_escalation: QualityGate;
  };
  quarantined_records: Array<{
    id: string;
    gaps: string[];
    reason: string;
  }>;
  production_ready: boolean;
  production_blocker: string;
}

export interface PublicSource {
  id: string;
  title: string;
  publisher: string;
  source_type: string;
  access_level: "open" | "partial" | "metadata_only" | "request";
  url: string;
  relevance: string;
  review_status:
    | "context_only"
    | "candidate_for_extraction"
    | "needs_full_text"
    | "needs_review";
  origin_type: string;
  source_scope: "general_evidence" | "tatneft_case";
  evidence_role:
    | "laboratory_data"
    | "methodology"
    | "review"
    | "case_context"
    | "needs_classification";
  availability?: "available" | "unavailable" | "unknown";
  published?: string;
  checked_at?: string;
}

export interface PublicSourcesResponse {
  items: PublicSource[];
  refreshed_at: string;
  discovery_mode: string;
  safety_notice: string;
}

export interface EvidenceReviewSubmission {
  source: {
    id: string;
    title: string;
    url: string;
  };
  formulation: EvidenceItem["formulation"];
  conditions: EvidenceItem["conditions"];
  method: string;
  result: EvidenceItem["result"];
  citation: {
    location: string;
    excerpt: string;
  };
}

export interface EvidenceReview extends EvidenceItem {
  method: string;
  review: {
    status: "pending_review" | "released";
    submitted_at: string;
    approved_at?: string;
  };
}

export interface EvidenceReviewsResponse {
  items: EvidenceReview[];
}

export interface SynapseConfig {
  configured: boolean;
  approval_mode: string;
}
export interface SynapseProject {
  research_id?: string;
  status: string;
  awaiting_approval: boolean;
  synapse_url: string;
  result_preview: string;
}

export interface EvidenceFiltersValue {
  minTemperature: string;
  maxTemperature: string;
  maxSalinity: string;
  comparableOnly: boolean;
}
