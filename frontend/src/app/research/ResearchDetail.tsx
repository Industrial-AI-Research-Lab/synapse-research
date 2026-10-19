import scss from "./researchDetail.module.scss";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  getResearch,
  getResearchFile,
  refreshResearch,
  ResearchApiError,
  resolveResearchApproval,
} from "../../api/research";
import { getDocumentFile } from "../../api/documents";
import type { Research, ResearchFile } from "../../assets/types/research";
import Button from "../../components/ui/Button/Button";
import Field from "../../components/ui/Field/Field";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import Loader from "../../components/ui/Loader/Loader";
import Toast from "../../components/ui/Toast/Toast";
import ToastViewport from "../../components/ui/Toast/ToastViewport";
import Textarea from "../../components/ui/Textarea/Textarea";
import ResearchAccess from "./ResearchAccess";
import ResearchStatus from "./ResearchStatus";
import {
  formatResearchDate,
  formatResearchPhase,
  formatResearchResultHint,
  isResearchFinal,
} from "./researchPresentation";

const safeLink = (value: string) => {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? value : "";
  } catch {
    return "";
  }
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const ResearchDetail = ({ researchId }: { researchId: string }) => {
  const [research, setResearch] = useState<Research>();
  const [error, setError] = useState("");
  const [decisionError, setDecisionError] = useState("");
  const [hasAccessError, setHasAccessError] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [resolvingId, setResolvingId] = useState("");
  const [resolvingDecision, setResolvingDecision] = useState<boolean>();
  const [notification, setNotification] = useState<{
    title: string;
    description: string;
    variant: "success" | "error";
  }>();
  const isDownloadingRef = useRef(false);
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState("");
  const [downloadingId, setDownloadingId] = useState("");
  const [reportHtml, setReportHtml] = useState("");
  const [reportError, setReportError] = useState("");
  const [reportRevision, setReportRevision] = useState(0);
  const [loadRevision, setLoadRevision] = useState(0);
  const isMountedRef = useRef(true);
  const isRefreshingRef = useRef(false);

  const handleRefresh = useCallback(async () => {
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsRefreshing(true);
    try {
      const updated = await refreshResearch(researchId);
      if (isMountedRef.current) {
        setResearch(updated);
        setError("");
      }
    } catch (failure) {
      if (isMountedRef.current) {
        setHasAccessError(
          failure instanceof ResearchApiError && failure.status === 401,
        );
        setError(
          failure instanceof Error
            ? failure.message
            : "Не удалось обновить состояние.",
        );
      }
    } finally {
      isRefreshingRef.current = false;
      if (isMountedRef.current) setIsRefreshing(false);
    }
  }, [researchId]);

  useEffect(() => {
    isMountedRef.current = true;
    let isCancelled = false;
    const load = async () => {
      setError("");
      try {
        const stored = await getResearch(researchId);
        if (isCancelled) return;
        setResearch(stored);
        setHasAccessError(false);
        if (stored.projectId) void handleRefresh();
      } catch (failure) {
        if (!isCancelled) {
          setHasAccessError(
            failure instanceof ResearchApiError && failure.status === 401,
          );
          setError(
            failure instanceof Error
              ? failure.message
              : "Не удалось открыть исследование.",
          );
        }
      }
    };
    void load();
    return () => {
      isCancelled = true;
      isMountedRef.current = false;
    };
  }, [researchId, loadRevision, handleRefresh]);

  const researchStatus = research?.status;
  useEffect(() => {
    if (!researchStatus || isResearchFinal(researchStatus)) return;
    const interval = window.setInterval(() => void handleRefresh(), 10_000);
    return () => window.clearInterval(interval);
  }, [researchStatus, handleRefresh]);

  const report = research?.files.find(
    (file) => file.isReport && file.contentType === "text/html",
  );
  const reportId = report?.id;
  useEffect(() => {
    if (!reportId) return;
    let isCancelled = false;
    setReportError("");
    setReportHtml("");
    void getResearchFile(researchId, reportId)
      .then((blob) => blob.text())
      .then((html) => {
        if (!isCancelled) setReportHtml(html);
      })
      .catch((failure) => {
        if (!isCancelled)
          setReportError(
            failure instanceof Error
              ? failure.message
              : "Не удалось открыть отчёт.",
          );
      });
    return () => {
      isCancelled = true;
    };
  }, [researchId, reportId, reportRevision]);

  const handleDecision = async (approvalId: string, approved: boolean) => {
    if (resolvingId) return;
    const comment = feedback[approvalId]?.trim() ?? "";
    if (!approved && !comment) {
      setDecisionError("Укажите причину отклонения в комментарии.");
      return;
    }
    setResolvingId(approvalId);
    setResolvingDecision(approved);
    setDecisionError("");
    try {
      const updated = await resolveResearchApproval(
        researchId,
        approvalId,
        approved,
        comment,
        research?.approvals.find((approval) => approval.id === approvalId)
          ?.expectedData,
      );
      if (isMountedRef.current) {
        setResearch(updated);
        setFeedback((current) => ({ ...current, [approvalId]: "" }));
        setNotification({
          title: approved ? "Решение подтверждено" : "Запрос отклонён",
          description:
            "Решение передано в Synapse. Состояние исследования обновлено.",
          variant: "success",
        });
      }
    } catch (failure) {
      if (isMountedRef.current)
        setDecisionError(
          failure instanceof Error
            ? failure.message
            : "Не удалось передать решение. Обновите состояние перед повторной попыткой.",
        );
    } finally {
      if (isMountedRef.current) setResolvingId("");
    }
  };

  const handleDownload = async (file: ResearchFile) => {
    if (isDownloadingRef.current) return;
    isDownloadingRef.current = true;
    setDownloadingId(file.id);
    setFileError("");
    try {
      downloadBlob(await getResearchFile(researchId, file.id), file.filename);
      setNotification({
        title: "Файл передан браузеру",
        description: `«${file.filename}»`,
        variant: "success",
      });
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "Не удалось скачать файл.";
      setFileError(message);
      setNotification({
        title: "Не удалось скачать файл",
        description: message,
        variant: "error",
      });
    } finally {
      isDownloadingRef.current = false;
      setDownloadingId("");
    }
  };

  const handleSourceDownload = async (id: string, filename: string) => {
    if (isDownloadingRef.current) return;
    isDownloadingRef.current = true;
    setDownloadingId(id);
    setFileError("");
    try {
      downloadBlob(
        await getDocumentFile(`/api/documents/${encodeURIComponent(id)}/file`),
        filename,
      );
      setNotification({
        title: "Файл передан браузеру",
        description: `«${filename}»`,
        variant: "success",
      });
    } catch (failure) {
      const message =
        failure instanceof Error
          ? failure.message
          : "Исходный документ больше недоступен.";
      setFileError(message);
      setNotification({
        title: "Не удалось скачать документ",
        description: message,
        variant: "error",
      });
    } finally {
      isDownloadingRef.current = false;
      setDownloadingId("");
    }
  };

  return (
    <main className={scss.root}>
      <ToastViewport>
        {notification && (
          <Toast
            title={notification.title}
            description={notification.description}
            variant={notification.variant}
            onClose={() => setNotification(undefined)}
          />
        )}
      </ToastViewport>
      <a
        className={scss.backLink}
        href={`/researches${window.location.search}`}
        data-toast-focus-return
      >
        <span aria-hidden="true">
          <IconRenderer icon="arrowLeft" />
        </span>
        Все исследования
      </a>
      {hasAccessError ? (
        <ResearchAccess
          onAccess={() => setLoadRevision((value) => value + 1)}
        />
      ) : (
        <>
          {error && (
            <p className={scss.error} role="alert">
              {error}
            </p>
          )}
          {decisionError && (
            <p className={scss.error} role="alert">
              {decisionError}
            </p>
          )}
          {!research && !error && (
            <Loader variant="page" label="Открываем исследование…" />
          )}
          {!research && error && (
            <Button
              variant="secondary"
              onClick={() => setLoadRevision((value) => value + 1)}
            >
              Повторить загрузку
            </Button>
          )}
          {research && (
            <>
              <header className={scss.header}>
                <div>
                  <h1>
                    {research.title === research.question
                      ? research.kind === "documents"
                        ? "Исследование по документам"
                        : "Исследование по опытам"
                      : research.title}
                  </h1>
                  <p>
                    Запущено {formatResearchDate(research.createdAt)} ·{" "}
                    {research.kind === "documents"
                      ? "По документам"
                      : "По опытам"}
                  </p>
                </div>
              </header>
              <section
                className={scss.statePanel}
                data-status={research.status}
                aria-label="Состояние исследования"
              >
                <div className={scss.stateSummary}>
                  <ResearchStatus status={research.status} variant="summary" />
                  <p className={scss.phase}>
                    {isResearchFinal(research.status)
                      ? "Последний этап: "
                      : "Текущий этап: "}
                    {formatResearchPhase(research.phase) ||
                      "Подготовка запуска"}
                  </p>
                  <div className={scss.stateControls}>
                    <div className={scss.freshness}>
                      <span>
                        {research.checkedAt
                          ? `Проверено ${formatResearchDate(research.checkedAt)}`
                          : "Статус ещё не проверялся"}
                      </span>
                      {research.projectId &&
                        !isResearchFinal(research.status) && (
                          <span className={scss.autoRefresh}>
                            Обновляется автоматически каждые 10 секунд
                          </span>
                        )}
                    </div>
                    <Button
                      className={scss.refreshButton}
                      variant="text"
                      aria-busy={isRefreshing}
                      disabled={
                        isRefreshing || Boolean(resolvingId) || !research.projectId
                      }
                      onClick={() => void handleRefresh()}
                    >
                      <span className={scss.refreshIcon} aria-hidden="true">
                        <IconRenderer icon="reload" />
                      </span>
                      {isRefreshing ? "Проверяем…" : "Проверить статус"}
                    </Button>
                  </div>
                </div>
                {research.syncError && (
                  <div className={scss.syncWarning} role="alert">
                    <strong>Не удалось проверить статус</strong>
                    <p>{research.syncError}</p>
                    <p>
                      {research.status === "start_unknown"
                        ? "Synapse мог принять запрос. Не запускайте его повторно, пока не проверите историю в Synapse."
                        : "Показываем сохранённые данные. Повторите проверку статуса."}
                    </p>
                  </div>
                )}
                {research.failureReason && (
                  <div className={scss.failureReason} role="alert">
                    <strong>Причина остановки</strong>
                    <p>{research.failureReason}</p>
                  </div>
                )}
              </section>
              <section className={scss.section}>
                <h2>Вопрос исследования</h2>
                <p className={scss.question}>{research.question}</p>
                <h3>Выбранные источники</h3>
                <ul className={scss.sources}>
                  {research.sources.map((source) => (
                    <li key={source.id}>
                      {research.kind === "documents" ? (
                        <div className={scss.sourceFile}>
                          <span className={scss.sourceFilename}>
                            {source.filename}
                          </span>
                          <Button
                            className={scss.downloadButton}
                            type="button"
                            variant="text"
                            isLoading={downloadingId === source.id}
                            loadingLabel="Скачиваем…"
                            aria-label={
                              downloadingId === source.id
                                ? `Скачиваем ${source.filename}`
                                : `Скачать ${source.filename}`
                            }
                            title={`Скачать ${source.filename}`}
                            aria-busy={downloadingId === source.id}
                            disabled={Boolean(downloadingId)}
                            onClick={() =>
                              void handleSourceDownload(
                                source.id,
                                source.filename,
                              )
                            }
                          >
                            <span className={scss.downloadIcon} aria-hidden="true">
                              <IconRenderer icon="download" />
                            </span>
                            Скачать
                          </Button>
                        </div>
                      ) : (
                        <a href={`/source/${encodeURIComponent(source.id)}`}>
                          {source.id} · {source.filename}
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
              {research.approvals.map((approval) => (
                <section
                  className={scss.section}
                  key={approval.id}
                  aria-labelledby={`approval-${approval.id}`}
                >
                  <h2 id={`approval-${approval.id}`}>{approval.title}</h2>
                  {approval.content && (
                    <p className={scss.prose}>{approval.content}</p>
                  )}
                  {approval.details != null && (
                    <details className={scss.details} open>
                      <summary>Данные для решения</summary>
                      <pre>
                        {typeof approval.details === "string"
                          ? approval.details
                          : JSON.stringify(approval.details, null, 2)}
                      </pre>
                    </details>
                  )}
                  <Field
                    label="Комментарий к решению"
                    htmlFor={`feedback-${approval.id}`}
                    hint="При отклонении укажите, что нужно исправить."
                  >
                    <Textarea
                      id={`feedback-${approval.id}`}
                      value={feedback[approval.id] ?? ""}
                      onChange={(event) =>
                        setFeedback((current) => ({
                          ...current,
                          [approval.id]: event.target.value,
                        }))
                      }
                      maxLength={5000}
                    />
                  </Field>
                  <div className={scss.actions}>
                    <Button
                      isLoading={
                        resolvingId === approval.id &&
                        resolvingDecision === true
                      }
                      loadingLabel="Передаём решение…"
                      disabled={
                        Boolean(resolvingId) ||
                        isRefreshing ||
                        Boolean(research.syncError)
                      }
                      onClick={() => void handleDecision(approval.id, true)}
                    >
                      Подтвердить
                    </Button>
                    <Button
                      variant="secondary"
                      isLoading={
                        resolvingId === approval.id &&
                        resolvingDecision === false
                      }
                      loadingLabel="Передаём решение…"
                      disabled={
                        Boolean(resolvingId) ||
                        isRefreshing ||
                        Boolean(research.syncError)
                      }
                      onClick={() => void handleDecision(approval.id, false)}
                    >
                      Отклонить
                    </Button>
                  </div>
                </section>
              ))}
              <section className={scss.section}>
                <h2>Результат исследования</h2>
                {reportError && (
                  <div>
                    <p className={scss.error} role="alert">
                      {reportError}
                    </p>
                    <Button
                      variant="secondary"
                      onClick={() => setReportRevision((value) => value + 1)}
                    >
                      Повторить загрузку отчёта
                    </Button>
                  </div>
                )}
                {reportId && !reportHtml && !reportError && (
                  <Loader variant="inline" label="Открываем полный отчёт…" />
                )}
                {reportHtml && (
                  <iframe
                    className={scss.report}
                    title="Полный отчёт исследования"
                    sandbox=""
                    referrerPolicy="no-referrer"
                    srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; form-action 'none'; base-uri 'none'">${reportHtml}`}
                  />
                )}
                {research.resultText &&
                  (reportHtml ? (
                    <details className={scss.details}>
                      <summary>Текстовая версия ответа</summary>
                      <div className={scss.prose}>{research.resultText}</div>
                    </details>
                  ) : (
                    <div className={scss.prose}>{research.resultText}</div>
                  ))}
                {!research.resultText && !reportId && (
                  <div>
                    <p className={scss.muted}>
                      {formatResearchResultHint(research.status)}
                    </p>
                    {isResearchFinal(research.status) &&
                      !["completed", "done", "start_unknown"].includes(
                        research.status,
                      ) && (
                        <a
                          href={
                            research.kind === "documents"
                              ? "/documents"
                              : "/completeness"
                          }
                        >
                          Подготовить новое исследование
                        </a>
                      )}
                  </div>
                )}
              </section>
              {research.files.length > 0 && (
                <section className={scss.section}>
                  <h2>Созданные материалы</h2>
                  <ul className={scss.files}>
                    {research.files.map((file) => (
                      <li key={file.id}>
                        <span>
                          {file.filename}
                          <small>
                            {new Intl.NumberFormat("ru-RU", {
                              maximumFractionDigits: 1,
                            }).format(file.sizeBytes / 1024)}{" "}
                            КБ
                          </small>
                        </span>
                        <Button
                          className={scss.downloadButton}
                          variant="text"
                          aria-label={`Скачать ${file.filename}`}
                          disabled={Boolean(downloadingId)}
                          isLoading={downloadingId === file.id}
                          loadingLabel="Скачиваем…"
                          onClick={() => void handleDownload(file)}
                        >
                          <span className={scss.downloadIcon} aria-hidden="true">
                            <IconRenderer icon="download" />
                          </span>
                          Скачать
                        </Button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {fileError && (
                <p className={scss.error} role="alert">
                  {fileError}
                </p>
              )}
              <footer className={scss.actions}>
                {safeLink(research.synapseUrl) && (
                  <a
                    href={safeLink(research.synapseUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть подробности в Synapse
                  </a>
                )}
                {safeLink(research.resultUrl) && (
                  <a
                    href={safeLink(research.resultUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Открыть опубликованный отчёт
                  </a>
                )}
              </footer>
            </>
          )}
        </>
      )}
    </main>
  );
};

export default ResearchDetail;
