export type DocumentStatus = "ready";

export interface DocumentMetadata {
  id: string;
  filename: string;
  uploadedAt: string;
  sha256: string;
  sizeBytes: number;
  pageCount: number;
  textPageCount: number;
  chunkCount: number;
  status: DocumentStatus;
}

export interface DocumentSearchParams {
  query: string;
  documentIds?: string[];
  limit?: number;
}

export interface DocumentCitation {
  document: string;
  location: string;
  url: string;
}

export interface DocumentSearchItem {
  documentId: string;
  documentName: string;
  page: number;
  chunkId: string;
  excerpt: string;
  score: number;
  citation: DocumentCitation;
}

export interface DocumentSearchResponse {
  query: string;
  items: DocumentSearchItem[];
  total: number;
}

export interface DocumentResearchParams {
  query: string;
  documentIds: string[];
}

export interface DocumentResearchProject {
  projectId: string;
  status: string;
  phase: string;
  title: string;
  awaitingApproval: boolean;
  resultPreview: string;
  resultUrl: string;
  synapseUrl: string;
}
