import { useQuery } from "@tanstack/react-query";
import { fetchArtifact } from "../client";
import type { ArtifactFetchParams, ArtifactStep } from "../../types/artifact";
import { ARTIFACT_PAGE_SIZE } from "../../types/artifact";

export function useArtifact(
  taskId: string | undefined,
  step: ArtifactStep | null,
  options?: { page?: number; section?: ArtifactFetchParams["section"]; enabled?: boolean },
) {
  const page = options?.page ?? 0;
  const limit = ARTIFACT_PAGE_SIZE;
  const offset = page * limit;

  return useQuery({
    queryKey: ["artifact", taskId, step, page, options?.section ?? null],
    queryFn: () =>
      fetchArtifact(taskId!, step!, {
        limit,
        offset,
        ...(options?.section ? { section: options.section } : {}),
      }),
    enabled: options?.enabled !== false && Boolean(taskId && step),
    staleTime: 30_000,
  });
}
