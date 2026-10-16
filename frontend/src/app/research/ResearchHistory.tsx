import scss from "./researchHistory.module.scss";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getResearches,
  refreshResearch,
  ResearchApiError,
} from "../../api/research";
import type { ResearchSummary } from "../../assets/types/research";
import { usePagination } from "../../assets/hooks/usePagination";
import Button from "../../components/ui/Button/Button";
import Field from "../../components/ui/Field/Field";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import Loader from "../../components/ui/Loader/Loader";
import ResearchAccess from "./ResearchAccess";
import ResearchStatus from "./ResearchStatus";
import ResearchPagination from "./ResearchPagination";
import { formatResearchDate, isResearchFinal } from "./researchPresentation";

const STATUS_FILTERS = [
  {
    id: "active",
    label: "В работе",
    states: [
      "starting",
      "started",
      "initialized",
      "queued",
      "pending",
      "running",
      "in_progress",
      "output",
    ],
  },
  { id: "approval", label: "Требуется решение", states: ["awaiting_approval"] },
  { id: "completed", label: "Завершено", states: ["completed", "done"] },
  {
    id: "failed",
    label: "Ошибки и неизвестный запуск",
    states: ["failed", "error", "start_failed", "start_unknown"],
  },
  {
    id: "cancelled",
    label: "Отменено или отклонено",
    states: ["cancelled", "canceled", "rejected", "stopped"],
  },
];

const formatSourceCount = (record: ResearchSummary) => {
  const count = record.sources.length;
  const forms =
    record.kind === "documents"
      ? { one: "документ", few: "документа", other: "документов" }
      : { one: "опыт", few: "опыта", other: "опытов" };
  const plural = new Intl.PluralRules("ru-RU").select(count);
  const label =
    plural === "one" || plural === "few" ? forms[plural] : forms.other;

  return `${count} ${label}`;
};

const ResearchHistory = () => {
  const [researches, setResearches] = useState<ResearchSummary[]>();
  const [initialParams] = useState(
    () => new URLSearchParams(window.location.search),
  );
  const [kind, setKind] = useState(() => {
    const value = initialParams.get("kind") ?? "";
    return ["documents", "evidence"].includes(value) ? value : "";
  });
  const [status, setStatus] = useState(() => {
    const value = initialParams.get("status") ?? "";
    return STATUS_FILTERS.some((filter) => filter.id === value) ? value : "";
  });
  const [error, setError] = useState("");
  const [hasAccessError, setHasAccessError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const isLoadingRef = useRef(false);
  const isMountedRef = useRef(true);

  const loadResearches = useCallback(async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setIsRefreshing(true);
    setError("");
    try {
      const records = await getResearches();
      if (!isMountedRef.current) return;
      setResearches(records);
      setHasAccessError(false);
      const active = records.filter(
        (record) => record.projectId && !isResearchFinal(record.status),
      );
      for (let index = 0; index < active.length; index += 4) {
        const outcomes = await Promise.allSettled(
          active
            .slice(index, index + 4)
            .map((record) => refreshResearch(record.id)),
        );
        if (!isMountedRef.current) return;
        const updated = outcomes.flatMap((outcome) =>
          outcome.status === "fulfilled" ? [outcome.value] : [],
        );
        setResearches((current) =>
          current?.map(
            (record) => updated.find((item) => item.id === record.id) ?? record,
          ),
        );
      }
    } catch (failure) {
      if (isMountedRef.current) {
        setHasAccessError(
          failure instanceof ResearchApiError && failure.status === 401,
        );
        setError(
          failure instanceof Error
            ? failure.message
            : "Не удалось загрузить историю.",
        );
      }
    } finally {
      isLoadingRef.current = false;
      if (isMountedRef.current) setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    void loadResearches();
    const interval = window.setInterval(() => void loadResearches(), 30_000);
    return () => {
      isMountedRef.current = false;
      window.clearInterval(interval);
    };
  }, [loadResearches]);

  const filtered = researches?.filter(
    (record) =>
      (!kind || record.kind === kind) &&
      (!status ||
        STATUS_FILTERS.find((filter) => filter.id === status)?.states.includes(
          record.status,
        )),
  );
  const pagination = usePagination({
    items: filtered,
    initialPage: Number(initialParams.get("page") ?? 1),
    initialPageSize: initialParams.get("pageSize") === "5" ? 5 : 10,
    resetKey: `${kind}:${status}`,
  });
  const historyParams = new URLSearchParams();
  if (kind) historyParams.set("kind", kind);
  if (status) historyParams.set("status", status);
  if (pagination.page > 1) historyParams.set("page", String(pagination.page));
  if (pagination.pageSize !== 10) {
    historyParams.set("pageSize", String(pagination.pageSize));
  }
  const historySearch = historyParams.size > 0 ? `?${historyParams}` : "";

  useEffect(() => {
    const url = new URL(window.location.href);
    url.search = historySearch;
    window.history.replaceState(window.history.state, "", url);
  }, [historySearch]);

  return (
    <main className={scss.root}>
      <header className={scss.header}>
        <div>
          <h1>Исследования</h1>
          <p>
            Общая история команды: вопросы, источники и результаты исследований
            в Synapse.
          </p>
        </div>
        <Button
          className={scss.refreshButton}
          variant="secondary"
          disabled={isRefreshing}
          isLoading={isRefreshing}
          loadingLabel="Обновляем…"
          onClick={() => void loadResearches()}
        >
          <span className={scss.refreshIcon} aria-hidden="true">
            <IconRenderer icon="reload" />
          </span>
          Обновить историю
        </Button>
      </header>
      {hasAccessError ? (
        <ResearchAccess onAccess={() => void loadResearches()} />
      ) : (
        <>
          {error && (
            <p className={scss.error} role="alert">
              {error}
            </p>
          )}
          {!researches && !error && (
            <Loader variant="page" label="Загружаем исследования…" />
          )}
          {researches && researches.length === 0 && (
            <section className={scss.empty}>
              <h2>История начнётся с первого запуска</h2>
              <p>
                Задайте вопрос по выбранным документам и запустите исследование.
                Здесь сохранятся его статус, ответ и материалы.
              </p>
              <div className={scss.links}>
                <a href="/documents">Исследовать документы</a>
              </div>
            </section>
          )}
          {researches && researches.length > 0 && (
            <>
              <div className={scss.filters}>
                <Field
                  className={scss.kindFilter}
                  label="Тип исследования"
                  htmlFor="research-kind"
                >
                  <select
                    id="research-kind"
                    value={kind}
                    onChange={(event) => setKind(event.target.value)}
                  >
                    <option value="">Все исследования</option>
                    <option value="documents">По документам</option>
                    <option value="evidence" disabled>
                      По опытам
                    </option>
                  </select>
                </Field>
                <Field
                  className={scss.statusFilter}
                  label="Состояние"
                  htmlFor="research-status"
                >
                  <select
                    id="research-status"
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="">Все состояния</option>
                    {STATUS_FILTERS.map((filter) => (
                      <option value={filter.id} key={filter.id}>
                        {filter.label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  className={scss.pageSizeFilter}
                  label="На странице"
                  htmlFor="research-page-size"
                >
                  <select
                    id="research-page-size"
                    value={pagination.pageSize}
                    onChange={(event) =>
                      pagination.setPageSize(Number(event.target.value))
                    }
                  >
                    <option value={5}>5</option>
                    <option value={10}>10</option>
                  </select>
                </Field>
              </div>
              <section className={scss.list} aria-label="История исследований">
                {pagination.items.map((record) => (
                  <article className={scss.row} key={record.id}>
                    <div className={scss.rowMain}>
                      <h2>
                        <a
                          className={scss.titleLink}
                          href={`/researches/${encodeURIComponent(record.id)}${historySearch}`}
                          title={record.question}
                        >
                          <span className={scss.titleText}>
                            {record.question}
                          </span>
                        </a>
                      </h2>
                      <div className={scss.meta}>
                        <time dateTime={record.createdAt}>
                          {formatResearchDate(record.createdAt)}
                        </time>
                        <span>{formatSourceCount(record)}</span>
                      </div>
                    </div>
                    <div className={scss.rowState}>
                      <ResearchStatus status={record.status} />
                      {record.approvalCount > 0 && (
                        <span>Ожидает решения команды</span>
                      )}
                      {record.syncError && (
                        <span className={scss.warning}>
                          Не удалось обновить состояние
                        </span>
                      )}
                    </div>
                  </article>
                ))}
                {filtered?.length === 0 && (
                  <p className={scss.emptyFilter}>
                    Нет исследований с выбранными фильтрами.
                  </p>
                )}
              </section>
              {pagination.total > 0 && (
                <ResearchPagination
                  page={pagination.page}
                  pageCount={pagination.pageCount}
                  pages={pagination.pages}
                  start={pagination.start}
                  end={pagination.end}
                  total={pagination.total}
                  onPageChange={pagination.setPage}
                />
              )}
            </>
          )}
        </>
      )}
    </main>
  );
};

export default ResearchHistory;
