import scss from "./researchPagination.module.scss";

import type { PaginationPage } from "../../assets/hooks/usePagination";
import Button from "../../components/ui/Button/Button";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";

interface ResearchPaginationProps {
  page: number;
  pageCount: number;
  pages: PaginationPage[];
  start: number;
  end: number;
  total: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
  navLabel?: string;
  showRange?: boolean;
  className?: string;
}

const ResearchPagination = ({
  page,
  pageCount,
  pages,
  start,
  end,
  total,
  onPageChange,
  itemLabel = "исследования",
  navLabel = "Страницы исследований",
  showRange = true,
  className,
}: ResearchPaginationProps) => (
  <footer className={[scss.root, className].filter(Boolean).join(" ")}>
    {showRange && (
      <p className={scss.range} role="status" aria-atomic="true">
        <span className={scss.srOnly}>Показаны {itemLabel} </span>
        {start}–{end} из {total}
      </p>
    )}
    {pageCount > 1 && (
      <nav className={scss.navigation} aria-label={navLabel}>
        <Button
          type="button"
          variant="icon"
          className={scss.arrow}
          aria-label="Предыдущая страница"
          title="Предыдущая страница"
          disabled={page === 1}
          onClick={() => onPageChange(page - 1)}
        >
          <span className={scss.icon} aria-hidden="true">
            <IconRenderer icon="chevronLeft" />
          </span>
        </Button>
        {pages.map((item) =>
          typeof item === "number" ? (
            <Button
              key={item}
              type="button"
              variant="text"
              className={scss.page}
              aria-label={`Страница ${item}`}
              aria-current={item === page ? "page" : undefined}
              onClick={() => onPageChange(item)}
            >
              {item}
            </Button>
          ) : (
            <span key={item} className={scss.ellipsis} aria-hidden="true">
              …
            </span>
          ),
        )}
        <span className={scss.mobilePage}>
          <span className={scss.srOnly}>Страница </span>
          {page} / {pageCount}
        </span>
        <Button
          type="button"
          variant="icon"
          className={scss.arrow}
          aria-label="Следующая страница"
          title="Следующая страница"
          disabled={page === pageCount}
          onClick={() => onPageChange(page + 1)}
        >
          <span className={scss.icon} aria-hidden="true">
            <IconRenderer icon="chevronRight" />
          </span>
        </Button>
      </nav>
    )}
  </footer>
);

export default ResearchPagination;
