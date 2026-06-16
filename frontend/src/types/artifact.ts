export type ArtifactStep = "collect" | "tidy" | "approve" | "generate" | "publish";

export type ArtifactSection = "selected" | "research" | "copy" | "image";

export const ARTIFACT_PAGE_SIZE = 60;

export type ArtifactPaginationDto = {
  total: number;
  limit: number;
  offset: number;
};

export type ArtifactSummaryDto = {
  step: ArtifactStep;
  schema_version: string | null;
  artifact_path: string | null;
  artifact_paths?: string[];
  summary: Record<string, unknown>;
  file_urls?: Array<{ path: string; url: string }>;
  pagination?: ArtifactPaginationDto;
};

export type ArtifactFetchParams = {
  limit?: number;
  offset?: number;
  section?: ArtifactSection;
};
