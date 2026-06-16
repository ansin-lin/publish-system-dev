import type { ArtifactPaginationDto } from "../../types/artifact";
import { ARTIFACT_PAGE_SIZE } from "../../types/artifact";

type Props = {
  pagination?: ArtifactPaginationDto;
  page: number;
  onPageChange: (page: number) => void;
};

export function ListPagination({ pagination, page, onPageChange }: Props) {
  if (!pagination || pagination.total <= ARTIFACT_PAGE_SIZE) return null;

  const totalPages = Math.ceil(pagination.total / ARTIFACT_PAGE_SIZE);
  const currentPage = page + 1;

  return (
    <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-sm text-slate-600">
      <span>
        第 {currentPage} / {totalPages} 页 · 共 {pagination.total} 条
      </span>
      <div className="flex gap-2">
        <button
          type="button"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
          className="rounded border border-slate-300 px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          上一页
        </button>
        <button
          type="button"
          disabled={currentPage >= totalPages}
          onClick={() => onPageChange(page + 1)}
          className="rounded border border-slate-300 px-2 py-0.5 disabled:cursor-not-allowed disabled:opacity-40"
        >
          下一页
        </button>
      </div>
    </div>
  );
}
