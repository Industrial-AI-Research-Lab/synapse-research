export type ResearchKind = "documents" | "evidence";

export interface ResearchSource {
  id: string;
  filename: string;
  evidence?: unknown;
}

export interface ResearchFile {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  isReport: boolean;
}

export interface ResearchApproval {
  id: string;
  title: string;
  content: string;
  details: unknown;
  interactionSchema?: unknown;
}

export interface ResearchSummary {
  id: string;
  kind: ResearchKind;
  question: string;
  title: string;
  sources: ResearchSource[];
  createdAt: string;
  checkedAt: string | null;
  projectId: string;
  status: string;
  phase: string;
  synapseUrl: string;
  resultUrl: string;
  syncError: string;
  fileCount: number;
  approvalCount: number;
}

export interface Research extends ResearchSummary {
  resultText: string;
  files: ResearchFile[];
  approvals: ResearchApproval[];
}
