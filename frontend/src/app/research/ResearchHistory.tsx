import scss from "./researchHistory.module.scss";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getResearches,
  refreshResearch,
  ResearchApiError,
} from "../../api/research";
import type { ResearchSummary } from "../../assets/types/research";
import Button from "../../components/ui/Button/Button";
import Field from "../../components/ui/Field/Field";
import Loader from "../../components/ui/Loader/Loader";
import ResearchAccess from "./ResearchAccess";
import {
  formatResearchDate,
  formatResearchStatus,
  isResearchFinal,
} from "./researchPresentation";

const STATUS_FILTERS = [
  {
    id: "active",
    label: "В работе",
    states: [
      "starting",
      "started",
      "initialized",
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

const ResearchHistory = () => {
  const [researches, setResearches] = useState<ResearchSummary[]>();
  const [kind, setKind] = useState("");
  const [status, setStatus] = useState("");
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
          variant="secondary"
          disabled={isRefreshing}
          onClick={() => void loadResearches()}
        >
          {isRefreshing ? "Обновляем…" : "Обновить историю"}
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
                Задайте вопрос по документам или выбранным опытам и запустите
                исследование. Здесь сохранятся его статус, ответ и материалы.
              </p>
              <div className={scss.links}>
                <a href="/documents">Исследовать документы</a>
                <a href="/">Выбрать опыты</a>
              </div>
            </section>
          )}
          {researches && researches.length > 0 && (
            <>
              <div className={scss.filters}>
                <Field label="Тип исследования" htmlFor="research-kind">
                  <select
                    id="research-kind"
                    value={kind}
                    onChange={(event) => setKind(event.target.value)}
                  >
                    <option value="">Все исследования</option>
                    <option value="documents">По документам</option>
                    <option value="evidence">По опытам</option>
                  </select>
                </Field>
                <Field label="Состояние" htmlFor="research-status">
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
                <p className={scss.count} aria-live="polite">
                  Найдено: {filtered?.length}
                </p>
              </div>
              <section className={scss.list} aria-label="История исследований">
                {filtered?.map((record) => (
                  <article className={scss.row} key={record.id}>
                    <div className={scss.rowMain}>
                      <div className={scss.meta}>
                        <span>
                          {record.kind === "documents"
                            ? "По документам"
                            : "По опытам"}
                        </span>
                        <time dateTime={record.createdAt}>
                          {formatResearchDate(record.createdAt)}
                        </time>
                      </div>
                      <h2>
                        <a
                          href={`/researches/${encodeURIComponent(record.id)}`}
                        >
                          {record.question}
                        </a>
                      </h2>
                      <p className={scss.sources}>
                        {record.sources
                          .slice(0, 2)
                          .map((source) => source.filename)
                          .join(" · ")}
                        {record.sources.length > 2 &&
                          ` · ещё ${record.sources.length - 2}`}
                      </p>
                    </div>
                    <div className={scss.rowState}>
                      <span className={scss.status} data-status={record.status}>
                        {formatResearchStatus(record.status)}
                      </span>
                      {record.approvalCount > 0 && (
                        <span>Ожидает решения команды</span>
                      )}
                      {record.syncError && (
                        <span className={scss.warning}>
                          Не удалось обновить состояние
                        </span>
                      )}
                      <span>
                        Проверено: {formatResearchDate(record.checkedAt)}
                      </span>
                      <a href={`/researches/${encodeURIComponent(record.id)}`}>
                        Открыть исследование
                      </a>
                    </div>
                  </article>
                ))}
                {filtered?.length === 0 && (
                  <p className={scss.emptyFilter}>
                    Нет исследований с выбранными фильтрами.
                  </p>
                )}
              </section>
            </>
          )}
        </>
      )}
    </main>
  );
};

export default ResearchHistory;
