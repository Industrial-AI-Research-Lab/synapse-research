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
import DocumentPreview from "../../components/DocumentPreview/DocumentPreview";
import { canPreviewFile } from "../../components/DocumentPreview/documentPreview";
import type { DocumentPreviewSource } from "../../components/DocumentPreview/documentPreview";
import Field from "../../components/ui/Field/Field";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import Loader from "../../components/ui/Loader/Loader";
import Toast from "../../components/ui/Toast/Toast";
import ToastViewport from "../../components/ui/Toast/ToastViewport";
import Textarea from "../../components/ui/Textarea/Textarea";
import ResearchAccess from "./ResearchAccess";
import ApprovalDetails from "./ApprovalDetails";
import ApprovalSummary from "./ApprovalSummary";
import { getApprovalPresentation } from "./approvalPresentation";
import ResearchStatus from "./ResearchStatus";
import ResearchError from "./ResearchError";
import errorScss from "./researchError.module.scss";
import { parseSynapseError } from "./researchError";
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
  const [previewSource, setPreviewSource] = useState<DocumentPreviewSource>();
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
  const hasStartupError =
    Boolean(research) &&
    !research?.projectId &&
    ["start_failed", "start_unknown"].includes(researchStatus ?? "");
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
    const approval = research?.approvals.find((item) => item.id === approvalId);
    if (!approval) return;
    const view = getApprovalPresentation(approval);
    const comment = feedback[approvalId]?.trim() ?? "";
    if (!approved && !comment) {
      setDecisionError(
        view.returnsForRevision
          ? "Укажите в комментарии, что нужно доработать."
          : "Укажите причину отклонения в комментарии.",
      );
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
        approval.expectedData,
      );
      if (isMountedRef.current) {
        setResearch(updated);
        setFeedback((current) => ({ ...current, [approvalId]: "" }));
        setNotification({
          title: approved
            ? "Решение подтверждено"
            : view.returnsForRevision
              ? "Отправлено на доработку"
              : "Запрос отклонён",
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
            <ResearchError
              key={`refresh:${error}`}
              error={error}
              title={
                research
                  ? "Не удалось обновить состояние"
                  : "Не удалось открыть исследование"
              }
              researchId={researchId}
              projectId={research?.projectId}
            />
          )}
          {decisionError && (
            <ResearchError
              key={`decision:${decisionError}`}
              error={decisionError}
              title="Не удалось передать решение"
              researchId={researchId}
              projectId={research?.projectId}
            />
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
                    {formatResearchDate(research.createdAt)} ·{" "}
                    {research.kind === "documents"
                      ? "По документам"
                      : "По опытам"}
                  </p>
                </div>
              </header>
              {!hasStartupError && (
                <section
                  className={scss.statePanel}
                  data-status={research.status}
                  aria-label="Состояние исследования"
                >
                  <div className={scss.stateSummary}>
                    <ResearchStatus
                      status={research.status}
                      variant="summary"
                    />
                    <p className={scss.phase}>
                      {isResearchFinal(research.status)
                        ? "Последний этап: "
                        : "Текущий этап: "}
                      {formatResearchPhase(research.phase) ||
                        "Подготовка запуска"}
                    </p>
                    <div className={scss.stateControls}>
                      <div className={scss.freshness}>
                        {research.checkedAt ? (
                          <time
                            dateTime={research.checkedAt}
                            title={formatResearchDate(research.checkedAt)}
                          >
                            Проверено в{" "}
                            {new Intl.DateTimeFormat("ru-RU", {
                              timeStyle: "short",
                            }).format(new Date(research.checkedAt))}
                          </time>
                        ) : (
                          <span>Статус ещё не проверялся</span>
                        )}
                      </div>
                      <div className={scss.refreshGroup}>
                        {research.projectId &&
                          !isResearchFinal(research.status) && (
                            <span className={scss.autoRefresh}>
                              Автопроверка каждые 10 секунд
                            </span>
                          )}
                        <Button
                          className={scss.refreshButton}
                          variant="icon"
                          aria-label={
                            isRefreshing
                              ? "Проверяем статус"
                              : "Проверить статус вручную"
                          }
                          title="Проверить статус вручную"
                          aria-busy={isRefreshing}
                          disabled={
                            isRefreshing ||
                            Boolean(resolvingId) ||
                            !research.projectId
                          }
                          onClick={() => void handleRefresh()}
                        >
                          <span className={scss.refreshIcon} aria-hidden="true">
                            <IconRenderer icon="reload" />
                          </span>
                        </Button>
                      </div>
                    </div>
                  </div>
                </section>
              )}
              {(hasStartupError ||
                research.syncError ||
                research.failureReason) && (
                <div
                  className={scss.stateErrors}
                  data-startup={hasStartupError}
                >
                  {(hasStartupError || research.syncError) && (
                    <ResearchError
                      key={`sync:${research.syncError}`}
                      error={research.syncError}
                      title={
                        research.status === "start_unknown"
                          ? "Не удалось подтвердить запуск"
                          : hasStartupError
                            ? parseSynapseError(research.syncError).httpStatus
                              ? "Synapse отклонил запуск"
                              : "Не удалось запустить исследование"
                            : "Не удалось обновить состояние"
                      }
                      description={
                        research.status === "start_unknown"
                          ? "Synapse мог создать проект. Проверьте его историю перед новым запуском."
                          : hasStartupError
                            ? "Проект не создан. Исследование не запущено."
                            : undefined
                      }
                      researchId={research.id}
                      projectId={research.projectId}
                    >
                      <a
                        className={errorScss.documentsLink}
                        href="#selected-sources-heading"
                      >
                        {research.kind === "documents"
                          ? "Документы исследования"
                          : "Источники исследования"}
                      </a>
                    </ResearchError>
                  )}
                  {research.failureReason && (
                    <ResearchError
                      key={`failure:${research.failureReason}`}
                      error={research.failureReason}
                      title="Исследование завершилось с ошибкой"
                      researchId={research.id}
                      projectId={research.projectId}
                      isSynapseError
                    />
                  )}
                </div>
              )}
              <section className={`${scss.section} ${scss.sourcesSection}`}>
                <h2>Вопрос исследования</h2>
                <p className={scss.question}>{research.question}</p>
                <h3 id="selected-sources-heading">Выбранные источники</h3>
                <div
                  className={scss.sourcesViewport}
                  role="region"
                  aria-labelledby="selected-sources-heading"
                  tabIndex={0}
                >
                  <ul
                    className={`${scss.sources} ${research.sources.length > 36 ? scss.sourcesLarge : ""}`}
                  >
                    {research.sources.map((source) => (
                      <li key={source.id}>
                        {research.kind === "documents" ? (
                          <div className={scss.sourceFile}>
                            <span
                              className={scss.sourceFilename}
                              title={source.filename}
                            >
                              {source.filename}
                            </span>
                            {canPreviewFile(source.filename) && (
                              <Button
                                className={scss.sourceDownloadButton}
                                variant="icon"
                                type="button"
                                aria-label={`Просмотреть ${source.filename}`}
                                title="Просмотреть файл"
                                onClick={() =>
                                  setPreviewSource({
                                    filename: source.filename,
                                    load: () =>
                                      getDocumentFile(
                                        `/api/documents/${encodeURIComponent(source.id)}/file`,
                                      ),
                                  })
                                }
                              >
                                <IconRenderer icon="view" />
                              </Button>
                            )}
                            <Button
                              className={scss.sourceDownloadButton}
                              type="button"
                              variant="text"
                              isLoading={downloadingId === source.id}
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
                              <IconRenderer
                                icon="download"
                                aria-hidden="true"
                              />
                            </Button>
                          </div>
                        ) : (
                          <a
                            href={`/source/${encodeURIComponent(source.id)}`}
                            title={`${source.id} · ${source.filename}`}
                          >
                            {source.id} · {source.filename}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
              {research.approvals.map((approval) => {
                const view = getApprovalPresentation(approval);
                const details = approval.details ?? approval.expectedData;
                return (
                  <section
                    className={scss.section}
                    key={approval.id}
                    aria-labelledby={`approval-${approval.id}`}
                  >
                    <h2 id={`approval-${approval.id}`}>{view.title}</h2>
                    <p className={scss.approvalIntro}>{view.description}</p>
                    <ApprovalSummary
                      approval={approval}
                      research={research}
                      hasReport={Boolean(reportHtml || research.resultText)}
                    />
                    {details != null && (
                      <details
                        className={`${scss.details} ${scss.approvalDetails}`}
                        open
                      >
                        <summary>Данные для решения</summary>
                        <ApprovalDetails details={details} />
                      </details>
                    )}
                    <div className={scss.approvalDecision}>
                      <Field
                        label="Комментарий к решению"
                        htmlFor={`feedback-${approval.id}`}
                        hint={
                          view.returnsForRevision
                            ? "Для отправки на доработку укажите, что нужно изменить."
                            : "При отклонении укажите, что нужно исправить."
                        }
                      >
                        <Textarea
                          id={`feedback-${approval.id}`}
                          value={feedback[approval.id] ?? ""}
                          placeholder={
                            view.returnsForRevision
                              ? "Что нужно уточнить или изменить?"
                              : "Добавьте пояснение при необходимости"
                          }
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
                          {view.confirmLabel}
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
                          onClick={() =>
                            void handleDecision(approval.id, false)
                          }
                        >
                          {view.rejectLabel}
                        </Button>
                      </div>
                    </div>
                  </section>
                );
              })}
              <section className={scss.section} id="research-result">
                <h2>Результат исследования</h2>
                {reportError && (
                  <div>
                    <ResearchError
                      key={`report:${reportError}`}
                      error={reportError}
                      title="Не удалось открыть отчёт"
                      researchId={researchId}
                      projectId={research.projectId}
                    />
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
                <section className={scss.section} id="research-materials">
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
                        <div className={scss.fileActions}>
                          {canPreviewFile(file.filename, file.contentType) && (
                            <Button
                              className={scss.downloadButton}
                              variant="text"
                              type="button"
                              aria-label={`Просмотреть ${file.filename}`}
                              onClick={() =>
                                setPreviewSource({
                                  filename: file.filename,
                                  load: () =>
                                    getResearchFile(researchId, file.id),
                                })
                              }
                            >
                              <span
                                className={scss.downloadIcon}
                                aria-hidden="true"
                              >
                                <IconRenderer icon="view" />
                              </span>
                              Просмотреть
                            </Button>
                          )}
                          <Button
                            className={scss.downloadButton}
                            variant="text"
                            aria-label={`Скачать ${file.filename}`}
                            disabled={Boolean(downloadingId)}
                            isLoading={downloadingId === file.id}
                            loadingLabel="Скачиваем…"
                            onClick={() => void handleDownload(file)}
                          >
                            <span
                              className={scss.downloadIcon}
                              aria-hidden="true"
                            >
                              <IconRenderer icon="download" />
                            </span>
                            Скачать
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {fileError && (
                <ResearchError
                  key={`download:${fileError}`}
                  error={fileError}
                  title="Не удалось скачать файл"
                  researchId={researchId}
                  projectId={research.projectId}
                />
              )}
              <footer className={scss.actions}>
                {safeLink(research.synapseUrl) && (
                  <a
                    className={scss.synapseLink}
                    href={safeLink(research.synapseUrl)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className={scss.synapseLinkIcon} aria-hidden="true">
                      <IconRenderer icon="externalLink" />
                    </span>
                    Открыть в Synapse
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
      {previewSource && (
        <DocumentPreview
          source={previewSource}
          onClose={() => setPreviewSource(undefined)}
        />
      )}
    </main>
  );
};

export default ResearchDetail;
