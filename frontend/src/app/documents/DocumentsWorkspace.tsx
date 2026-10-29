import scss from "./documentsWorkspace.module.scss";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { FormEvent } from "react";

import {
  DocumentApiError,
  getDocumentAccessCode,
  getDocumentAccessCodeAvailability,
  getDocumentResearchProject,
  getDocuments,
  startDocumentResearch,
} from "../../api/documents";
import type {
  DocumentMetadata,
  DocumentResearchProject,
} from "../../assets/types/documents";
import Button from "../../components/ui/Button/Button";
import Field from "../../components/ui/Field/Field";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import Input from "../../components/ui/Input/Input";
import Loader from "../../components/ui/Loader/Loader";
import Textarea from "../../components/ui/Textarea/Textarea";
import Toast from "../../components/ui/Toast/Toast";
import ToastViewport from "../../components/ui/Toast/ToastViewport";
import { getTeamAccessToken, setTeamAccessToken } from "../../api/teamAccess";
import ApprovalModeToggle from "../research/ApprovalModeToggle";
import {
  MAX_SELECTED_DOCUMENTS,
  RESEARCH_POLLING_INTERVAL,
  copyText,
  isFinalResearchStatus,
} from "./documentPresentation";
import {
  persistSelectedDocumentIds,
  reconcileSelectedDocumentIds,
} from "./selectedDocuments";

type QuestionEditorState = "top" | "collapsed";
type SourceScope = "all" | "selected";

interface UploadNotification {
  title: string;
  description: string;
  variant: "success" | "error" | "info" | "warning";
}

const formatResearchStatus = (project: DocumentResearchProject) => {
  if (project.awaitingApproval) return "Ожидает решения в Synapse";

  switch (project.status.toLowerCase()) {
    case "completed":
      return "Исследование завершено";
    case "failed":
      return "Исследование завершилось с ошибкой";
    case "cancelled":
    case "canceled":
      return "Исследование отменено";
    case "queued":
    case "pending":
      return "Исследование ожидает запуска";
    default:
      return "Synapse обрабатывает исследование";
  }
};

const DocumentsWorkspace = () => {
  const questionEditorRef = useRef<HTMLFormElement>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldFocusQuestionEditorRef = useRef(false);
  const documentsRef = useRef<DocumentMetadata[]>([]);
  const [documents, setDocuments] = useState<DocumentMetadata[]>();
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [sourceScope, setSourceScope] = useState<SourceScope>("all");
  const [accessToken, setAccessToken] = useState(getTeamAccessToken);
  const [canCopyAccessCode, setCanCopyAccessCode] = useState(false);
  const [isAccessCodeCopying, setIsAccessCodeCopying] = useState(false);
  const [accessCodeCopyStatus, setAccessCodeCopyStatus] = useState("");
  const [question, setQuestion] = useState("");
  const [isAutoMode, setIsAutoMode] = useState(false);
  const [synapseProject, setSynapseProject] =
    useState<DocumentResearchProject>();
  const [questionEditorState, setQuestionEditorState] =
    useState<QuestionEditorState>("top");
  const [documentsError, setDocumentsError] = useState<string>();
  const [hasQuestionValidationAttempted, setHasQuestionValidationAttempted] =
    useState(false);
  const questionError =
    hasQuestionValidationAttempted && question.trim().length < 3
      ? "Сформулируйте вопрос минимум из трёх символов."
      : undefined;
  const [researchError, setResearchError] = useState<string>();
  const [isDocumentsLoading, setIsDocumentsLoading] = useState(true);
  const [isResearchStarting, setIsResearchStarting] = useState(false);
  const [isResearchRefreshing, setIsResearchRefreshing] = useState(false);
  const [isResearchStartUncertain, setIsResearchStartUncertain] =
    useState(false);
  const [feedbackNotification, setFeedbackNotification] =
    useState<UploadNotification>();
  const hasSearchOutput = isResearchStarting || Boolean(synapseProject);
  const contentClassNames = [
    scss.content,
    !hasSearchOutput && scss.searchContent,
    documentsError && scss.contentWithError,
  ]
    .filter(Boolean)
    .join(" ");
  const allResearchDocumentIds = (documents ?? [])
    .slice(0, MAX_SELECTED_DOCUMENTS)
    .map((document) => document.id);
  const researchDocumentIds =
    sourceScope === "all" ? allResearchDocumentIds : selectedDocumentIds;

  const loadDocuments = useCallback(async (nextAccessToken?: string) => {
    setIsDocumentsLoading(true);
    setDocumentsError(undefined);

    try {
      const loadedDocuments = await getDocuments(nextAccessToken);
      const documentsById = new Map(
        documentsRef.current.map((document) => [document.id, document]),
      );

      loadedDocuments.forEach((document) => {
        documentsById.set(document.id, document);
      });

      const nextDocuments = Array.from(documentsById.values()).sort(
        (left, right) => right.uploadedAt.localeCompare(left.uploadedAt),
      );

      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      setSelectedDocumentIds((current) => {
        const nextIds = reconcileSelectedDocumentIds(
          nextDocuments.map((document) => document.id),
          current,
        );
        persistSelectedDocumentIds(nextIds);
        return nextIds;
      });
    } catch (error) {
      setDocumentsError(
        error instanceof Error
          ? error.message
          : "Не удалось загрузить документы.",
      );
    } finally {
      setIsDocumentsLoading(false);
    }
  }, []);

  const refreshDocumentResearch = useCallback(
    async (projectId: string, showLoadingState: boolean) => {
      if (showLoadingState) setIsResearchRefreshing(true);
      setResearchError(undefined);

      try {
        const project = await getDocumentResearchProject(
          projectId,
          accessToken,
        );
        setSynapseProject(project);
      } catch (error) {
        setResearchError(
          error instanceof Error
            ? error.message
            : "Не удалось обновить состояние исследования в Synapse.",
        );
      } finally {
        if (showLoadingState) setIsResearchRefreshing(false);
      }
    },
    [accessToken],
  );

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useEffect(() => {
    if (!documentsError || documents) return;

    let isCancelled = false;

    const loadAccessCodeAvailability = async () => {
      try {
        const isAvailable = await getDocumentAccessCodeAvailability();

        if (!isCancelled) setCanCopyAccessCode(isAvailable);
      } catch {
        if (!isCancelled) setCanCopyAccessCode(false);
      }
    };

    void loadAccessCodeAvailability();

    return () => {
      isCancelled = true;
    };
  }, [documents, documentsError]);

  useEffect(() => {
    if (!synapseProject || isFinalResearchStatus(synapseProject.status)) {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      void refreshDocumentResearch(synapseProject.projectId, false);
    }, RESEARCH_POLLING_INTERVAL);

    return () => window.clearInterval(intervalId);
  }, [refreshDocumentResearch, synapseProject]);

  useEffect(() => {
    if (!shouldFocusQuestionEditorRef.current) return;

    const animationFrame = window.requestAnimationFrame(() => {
      shouldFocusQuestionEditorRef.current = false;
      questionEditorRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "nearest",
      });
      questionInputRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [questionEditorState]);

  const handleSynapseResearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isResearchStarting || isResearchStartUncertain) return;
    const normalizedQuestion = question.trim();
    setHasQuestionValidationAttempted(true);
    setResearchError(undefined);

    if (normalizedQuestion.length < 3) {
      questionInputRef.current?.focus();
      return;
    }

    if (!documents?.length) {
      setResearchError("Сначала добавьте документы в разделе «Источники».");
      return;
    }

    if (!researchDocumentIds.length) {
      setResearchError(
        sourceScope === "all"
          ? "Сначала добавьте документы в разделе «Источники»."
          : "Отметьте хотя бы один документ в разделе «Источники».",
      );
      return;
    }

    setIsResearchStarting(true);

    try {
      const project = await startDocumentResearch(
        {
          query: normalizedQuestion,
          documentIds: researchDocumentIds,
          autoMode: isAutoMode,
        },
        accessToken,
      );
      if (project.researchId) {
        setTeamAccessToken(accessToken);
        window.location.assign(
          `/researches/${encodeURIComponent(project.researchId)}`,
        );
        return;
      }
      setSynapseProject(project);
      setQuestion(normalizedQuestion);
      setQuestionEditorState("collapsed");
    } catch (error) {
      const isUncertain =
        !(error instanceof DocumentApiError) ||
        error.status >= 500 ||
        error.status === 408;
      setIsResearchStartUncertain(isUncertain);
      if (isUncertain) {
        setFeedbackNotification({
          title: "Результат запуска пока неизвестен",
          description:
            "Synapse мог принять запрос. Проверьте историю исследований перед повторным запуском.",
          variant: "warning",
        });
      }
      setResearchError(
        error instanceof Error
          ? error.message
          : "Не удалось запустить исследование в Synapse.",
      );
    } finally {
      setIsResearchStarting(false);
    }
  };

  const handleAccessSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTeamAccessToken(accessToken);
    setAccessCodeCopyStatus("");
    void loadDocuments(accessToken);
  };

  const handleAccessCodeCopy = async () => {
    if (isAccessCodeCopying) return;
    setAccessCodeCopyStatus("");
    setIsAccessCodeCopying(true);

    try {
      const accessCode = await getDocumentAccessCode();
      await copyText(accessCode);
      setAccessToken(accessCode);
      setAccessCodeCopyStatus("Код скопирован. Открываем документы…");
      setFeedbackNotification({
        title: "Код скопирован",
        description: "Код команды скопирован в буфер обмена.",
        variant: "success",
      });
      await loadDocuments(accessCode);
    } catch (error) {
      setAccessCodeCopyStatus(
        error instanceof Error
          ? error.message
          : "Не удалось получить и скопировать код.",
      );
    } finally {
      setIsAccessCodeCopying(false);
    }
  };

  const handleQuestionEditorOpen = () => {
    setHasQuestionValidationAttempted(false);
    setResearchError(undefined);
    shouldFocusQuestionEditorRef.current = true;
    setQuestionEditorState("top");
  };

  const renderSourcesSummary = () => (
    <section
      className={scss.sourcesSummary}
      aria-labelledby="selected-library-heading"
    >
      <h2 id="selected-library-heading">Источники</h2>
      <fieldset className={scss.sourceScope} disabled={!documents?.length}>
        <legend className={scss.srOnly}>
          Какие источники использовать
        </legend>
        <label className={scss.sourceScopeOption}>
          <input
            type="radio"
            name="document-source-scope"
            value="selected"
            checked={sourceScope === "selected"}
            onChange={() => setSourceScope("selected")}
          />
          {`Выбрано: ${selectedDocumentIds.length} из ${documents?.length ?? 0}`}
        </label>
        <label className={scss.sourceScopeOption}>
          <input
            type="radio"
            name="document-source-scope"
            value="all"
            checked={sourceScope === "all"}
            onChange={() => setSourceScope("all")}
          />
          Все
        </label>
      </fieldset>
      <a className={scss.libraryLink} href="/library">
        {documents?.length ? "Управлять источниками" : "Добавить источники"}
      </a>
    </section>
  );

  const isQuestionFormVisible =
    Boolean(documents?.length) &&
    (!synapseProject || questionEditorState === "top");

  const renderQuestionForm = () => (
    <form
      ref={questionEditorRef}
      id="document-question-editor"
      className={scss.questionForm}
      onSubmit={handleSynapseResearch}
    >
      <Field
        className={scss.questionField}
        label="Вопрос по выбранным документам"
        htmlFor="document-question"
        error={questionError}
        required
      >
        <Textarea
          className={scss.questionInput}
          ref={questionInputRef}
          id="document-question"
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
          placeholder="Сформулируйте вопрос для исследования по выбранным документам"
          rows={4}
          disabled={isResearchStarting}
        />
      </Field>
      <div className={scss.questionAside}>
        {renderSourcesSummary()}
        <ApprovalModeToggle
          id="document-research-auto-mode"
          checked={isAutoMode}
          disabled={isResearchStarting}
          onChange={setIsAutoMode}
        />
        {researchError && (
          <p className={scss.selectionError} role="alert">
            {researchError}
          </p>
        )}
        <div className={scss.questionLaunch}>
          <p className={scss.questionActionHint} id="document-research-hint">
            Исследование подготовит ответ по выбранным источникам.
          </p>
          <Button
            className={scss.synapseButton}
            type="submit"
            aria-describedby="document-research-hint"
            isLoading={isResearchStarting}
            loadingLabel="Передаём в Synapse…"
            disabled={
              isResearchStarting ||
              isResearchStartUncertain ||
              Boolean(questionError) ||
              !researchDocumentIds.length
            }
          >
            Запустить
            <span className={scss.synapseButtonIcon} aria-hidden="true">
              <IconRenderer icon="arrowRight" />
            </span>
          </Button>
        </div>
        {isResearchStartUncertain && (
          <p className={scss.uncertainStart}>
            Synapse мог принять запрос.{" "}
            <a href="/researches">Проверить состояние</a> перед повторным
            запуском.
          </p>
        )}
      </div>
    </form>
  );

  const feedbackToast = feedbackNotification && (
    <Toast
      title={feedbackNotification.title}
      description={feedbackNotification.description}
      variant={feedbackNotification.variant}
      onClose={() => setFeedbackNotification(undefined)}
      action={
        feedbackNotification.variant === "warning" &&
        isResearchStartUncertain ? (
          <a href="/researches">Проверить состояние</a>
        ) : undefined
      }
    />
  );

  if (isDocumentsLoading && !documents) {
    return (
      <main className={scss.root}>
        <Loader variant="page" label="Загружаем документы…" />
        <ToastViewport>{feedbackToast}</ToastViewport>
      </main>
    );
  }

  if (documentsError && !documents) {
    return (
      <main className={scss.root}>
        <section className={scss.panel} aria-labelledby="documents-load-error">
          <ToastViewport>{feedbackToast}</ToastViewport>
          <h1 id="documents-load-error">Документы пока недоступны</h1>
          <p className={scss.muted}>{documentsError}</p>
          <form className={scss.accessForm} onSubmit={handleAccessSubmit}>
            <Field
              label="Код доступа команды"
              htmlFor="document-access-token"
              action={
                canCopyAccessCode ? (
                  <Button
                    className={scss.copyAccessCodeButton}
                    type="button"
                    variant="secondary"
                    onClick={() => void handleAccessCodeCopy()}
                    disabled={isDocumentsLoading}
                    isLoading={isAccessCodeCopying}
                    loadingLabel="Копируем…"
                    aria-describedby="document-access-copy-status"
                  >
                    <IconRenderer
                      className={scss.copyAccessCodeIcon}
                      icon="copy"
                    />
                    Скопировать код
                  </Button>
                ) : undefined
              }
              hint="Нужен только в защищённом развёртывании. Локально поле можно оставить пустым."
            >
              <Input
                id="document-access-token"
                type="password"
                value={accessToken}
                onChange={(event) => setAccessToken(event.target.value)}
                autoComplete="off"
              />
            </Field>
            <p
              id="document-access-copy-status"
              className={scss.accessCodeCopyStatus}
              role="status"
            >
              {accessCodeCopyStatus}
            </p>
            <Button
              type="submit"
              variant="secondary"
              isLoading={isDocumentsLoading}
              loadingLabel="Загружаем…"
            >
              Повторить попытку
            </Button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className={scss.root}>
      <header className={scss.header}>
        <h1>Запрос</h1>
      </header>

      <ToastViewport>{feedbackToast}</ToastViewport>

      <div className={contentClassNames}>
        {documentsError && (
          <section className={scss.errorBanner} role="alert">
            <p>{documentsError}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadDocuments(accessToken)}
              isLoading={isDocumentsLoading}
              loadingLabel="Загружаем…"
            >
              Повторить
            </Button>
          </section>
        )}

        <section className={scss.researchWorkspace} aria-label="Поиск">
          {!isQuestionFormVisible && renderSourcesSummary()}
          {documents?.length ? (
            isQuestionFormVisible && (
              <section
                className={scss.questionPanel}
                aria-label="Исследование"
              >
                {renderQuestionForm()}
              </section>
            )
          ) : (
            <section
              className={`${scss.emptyState} ${scss.emptyDocuments}`}
              aria-labelledby="search-empty"
            >
              <h2 id="search-empty">Сначала добавьте источники</h2>
              <p>
                Загрузите статью, выгрузку библиографической базы или техническую
                документацию, затем вернитесь к вопросу.
              </p>
              <a className={scss.libraryLink} href="/library">
                Перейти к источникам
              </a>
            </section>
          )}
        </section>

        {synapseProject && (
          <section
            className={scss.researchProject}
            aria-live="polite"
            aria-labelledby="synapse-research-title"
          >
            <div className={scss.resultsHeading}>
              <div>
                <h2 id="synapse-research-title">{synapseProject.title}</h2>
                <p className={scss.muted}>«{question}»</p>
              </div>
              <p
                className={scss.researchStatus}
                data-final={isFinalResearchStatus(synapseProject.status)}
              >
                {formatResearchStatus(synapseProject)}
              </p>
            </div>

            <dl className={scss.researchMeta}>
              <div>
                <dt>Этап</dt>
                <dd>{synapseProject.phase || "Подготавливается"}</dd>
              </div>
              <div>
                <dt>Документов передано</dt>
                <dd>{researchDocumentIds.length}</dd>
              </div>
            </dl>

            {synapseProject.resultPreview && (
              <article className={scss.researchPreview}>
                <h3>Ответ из Synapse</h3>
                <p>{synapseProject.resultPreview}</p>
              </article>
            )}

            {researchError && (
              <p className={scss.selectionError} role="alert">
                {researchError}
              </p>
            )}

            <div className={scss.researchActions}>
              {synapseProject.resultUrl && (
                <a
                  className={scss.researchLink}
                  href={synapseProject.resultUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть готовый ответ
                  <span aria-hidden="true">
                    <IconRenderer icon="externalLink" />
                  </span>
                </a>
              )}
              {synapseProject.synapseUrl && (
                <a
                  className={scss.researchLink}
                  href={synapseProject.synapseUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть мониторинг Synapse
                  <span aria-hidden="true">
                    <IconRenderer icon="externalLink" />
                  </span>
                </a>
              )}
              <Button
                type="button"
                variant="secondary"
                onClick={() =>
                  void refreshDocumentResearch(synapseProject.projectId, true)
                }
                isLoading={isResearchRefreshing}
                loadingLabel="Обновляем…"
              >
                Обновить статус
              </Button>
              {questionEditorState === "collapsed" && (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleQuestionEditorOpen}
                >
                  Новый вопрос
                </Button>
              )}
            </div>
          </section>
        )}

      </div>
    </main>
  );
};

export default DocumentsWorkspace;
