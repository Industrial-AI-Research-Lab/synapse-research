import scss from "./documentsWorkspace.module.scss";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, FormEvent } from "react";

import {
  deleteDocument,
  getDocumentAccessCode,
  getDocumentAccessCodeAvailability,
  getDocumentFile,
  getDocumentResearchProject,
  getDocuments,
  searchDocuments,
  startDocumentResearch,
  uploadDocument,
} from "../../api/documents";
import type {
  DocumentCitation,
  DocumentMetadata,
  DocumentResearchProject,
  DocumentSearchResponse,
} from "../../assets/types/documents";
import Button from "../../components/ui/Button/Button";
import Field from "../../components/ui/Field/Field";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import Input from "../../components/ui/Input/Input";
import Loader from "../../components/ui/Loader/Loader";
import Textarea from "../../components/ui/Textarea/Textarea";
import Toast from "../../components/ui/Toast/Toast";
import { getTeamAccessToken, setTeamAccessToken } from "../../api/teamAccess";

const SEARCH_LIMIT = 10;
const MAX_SELECTED_DOCUMENTS = 50;
const MIN_VISIBLE_LIST_ITEMS = 3;
const RESEARCH_POLLING_INTERVAL = 5_000;
const SUPPORTED_DOCUMENT_ACCEPT =
  ".pdf,.json,.jsonl,.ndjson,.csv,.tsv,.xml,.tei,.jats,.nxml,.html,.htm,.txt,.md,.ris,.bib";

type QuestionEditorState = "top" | "collapsed";

interface UploadNotification {
  title: string;
  description: string;
  variant: "success" | "error" | "info";
  documentIds?: string[];
}

const isFinalResearchStatus = (status: string) =>
  ["completed", "failed", "cancelled", "canceled"].includes(
    status.toLowerCase(),
  );

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

const formatFileSize = (sizeBytes: number) => {
  if (sizeBytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(sizeBytes / 1024))} КБ`;
  }

  return `${(sizeBytes / (1024 * 1024)).toLocaleString("ru-RU", {
    maximumFractionDigits: 1,
  })} МБ`;
};

const formatDate = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("ru-RU", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

const formatDocumentStatus = (status: DocumentMetadata["status"]) => {
  if (status === "ready") return "Готов к поиску";

  return status;
};

const formatDocumentCount = (count: number) => {
  const lastTwoDigits = count % 100;
  const lastDigit = count % 10;

  if (lastTwoDigits >= 11 && lastTwoDigits <= 14) {
    return `${count} документов`;
  }

  if (lastDigit === 1) return `${count} документ`;

  if (lastDigit >= 2 && lastDigit <= 4) {
    return `${count} документа`;
  }

  return `${count} документов`;
};

const getDocumentExtension = (filename: string) => {
  const dotIndex = filename.lastIndexOf(".");

  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
};

const isPdfFilename = (filename: string) =>
  getDocumentExtension(filename) === ".pdf";

const formatDocumentUnits = (document: DocumentMetadata) => {
  const extension = getDocumentExtension(document.filename);

  if (extension === ".pdf") return `${document.pageCount} стр.`;

  if ([".json", ".jsonl", ".ndjson", ".ris", ".bib"].includes(extension)) {
    return `${document.pageCount} записей`;
  }

  if ([".csv", ".tsv"].includes(extension)) {
    return `${document.pageCount} строк`;
  }

  return `${document.pageCount} фрагмент${document.pageCount === 1 ? "" : "ов"}`;
};

const copyText = async (value: string) => {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const temporaryInput = document.createElement("textarea");
  temporaryInput.value = value;
  temporaryInput.setAttribute("readonly", "");
  temporaryInput.style.position = "fixed";
  temporaryInput.style.opacity = "0";
  document.body.append(temporaryInput);
  temporaryInput.select();

  const isCopied = document.execCommand("copy");
  temporaryInput.remove();

  if (!isCopied) {
    throw new Error("Не удалось скопировать код. Скопируйте его вручную.");
  }
};

const DocumentsWorkspace = () => {
  const workspaceRef = useRef<HTMLElement>(null);
  const uploadDialogRef = useRef<HTMLDialogElement>(null);
  const isUploadInFlightRef = useRef(false);
  const documentSelectionPanelRef = useRef<HTMLElement>(null);
  const documentListRef = useRef<HTMLUListElement>(null);
  const questionPanelRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<HTMLElement>(null);
  const questionEditorRef = useRef<HTMLFormElement>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldFocusQuestionEditorRef = useRef(false);
  const documentsRef = useRef<DocumentMetadata[]>([]);
  const [documents, setDocuments] = useState<DocumentMetadata[]>();
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [uploadNotification, setUploadNotification] =
    useState<UploadNotification>();
  const [uploadProgress, setUploadProgress] = useState({
    completed: 0,
    total: 0,
  });
  const [accessToken, setAccessToken] = useState(getTeamAccessToken);
  const [canCopyAccessCode, setCanCopyAccessCode] = useState(false);
  const [isAccessCodeCopying, setIsAccessCodeCopying] = useState(false);
  const [accessCodeCopyStatus, setAccessCodeCopyStatus] = useState("");
  const [question, setQuestion] = useState("");
  const [searchResult, setSearchResult] = useState<DocumentSearchResponse>();
  const [synapseProject, setSynapseProject] =
    useState<DocumentResearchProject>();
  const [questionEditorState, setQuestionEditorState] =
    useState<QuestionEditorState>("top");
  const [documentsError, setDocumentsError] = useState<string>();
  const [uploadError, setUploadError] = useState<{
    title: string;
    description: string;
  }>();
  const [uploadSuccess, setUploadSuccess] = useState<string>();
  const [questionError, setQuestionError] = useState<string>();
  const [selectionError, setSelectionError] = useState<string>();
  const [searchError, setSearchError] = useState<string>();
  const [researchError, setResearchError] = useState<string>();
  const [sourceError, setSourceError] = useState<string>();
  const [deletionNotification, setDeletionNotification] = useState<string>();
  const [documentToDelete, setDocumentToDelete] = useState<DocumentMetadata>();
  const [isDocumentsLoading, setIsDocumentsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isResearchStarting, setIsResearchStarting] = useState(false);
  const [isResearchRefreshing, setIsResearchRefreshing] = useState(false);
  const [isOpeningSource, setIsOpeningSource] = useState(false);
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
  const [documentDeleteError, setDocumentDeleteError] = useState<string>();
  const hasSearchOutput =
    isSearching ||
    isResearchStarting ||
    Boolean(searchResult) ||
    Boolean(synapseProject);
  const contentClassNames = [
    scss.content,
    !hasSearchOutput && scss.searchContent,
    documentsError && scss.contentWithError,
  ]
    .filter(Boolean)
    .join(" ");

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
        if (current.length) {
          return current.filter((documentId) =>
            nextDocuments.some((document) => document.id === documentId),
          );
        }

        return nextDocuments
          .slice(0, MAX_SELECTED_DOCUMENTS)
          .map((document) => document.id);
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

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const panel = documentSelectionPanelRef.current;
    const list = documentListRef.current;
    const questionPanel = questionPanelRef.current;

    if (!workspace || !panel || !list || !list.children.length) return;

    const updateListHeight = () => {
      const firstItem = list.children[0];
      const lastVisibleItem =
        list.children[
          Math.min(MIN_VISIBLE_LIST_ITEMS, list.children.length) - 1
        ];
      const minimumHeight =
        lastVisibleItem.getBoundingClientRect().bottom -
        firstItem.getBoundingClientRect().top;
      const listBounds = list.getBoundingClientRect();
      const controlsHeight =
        panel.getBoundingClientRect().bottom - listBounds.bottom;
      const workspacePadding = parseFloat(
        getComputedStyle(workspace).paddingBottom,
      );
      const questionPanelHeight = questionPanel
        ? questionPanel.getBoundingClientRect().height +
          parseFloat(getComputedStyle(questionPanel.parentElement!).rowGap)
        : 0;
      const availableHeight =
        workspace.getBoundingClientRect().bottom -
        workspacePadding -
        listBounds.top -
        controlsHeight -
        questionPanelHeight;

      list.style.setProperty(
        "--list-max-height",
        `${Math.max(minimumHeight, availableHeight)}px`,
      );
    };

    const observer = new ResizeObserver(updateListHeight);
    observer.observe(workspace);
    observer.observe(panel);
    observer.observe(list);
    if (questionPanel) observer.observe(questionPanel);
    updateListHeight();

    return () => observer.disconnect();
  }, [
    documents,
    documentsError,
    hasSearchOutput,
    questionEditorState,
    isUploading,
  ]);

  useLayoutEffect(() => {
    const dialog = uploadDialogRef.current;

    if (!isUploadDialogOpen || !dialog) return;

    const trigger = document.activeElement;
    dialog.showModal();
    fileInputRef.current?.focus({ preventScroll: true });

    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus();
      } else {
        document.getElementById("add-documents")?.focus();
      }
    };
  }, [isUploadDialogOpen]);

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
    if (!searchResult || isSearching || !searchResult.items.length) return;

    const animationFrame = window.requestAnimationFrame(() => {
      searchResultsRef.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "auto"
          : "smooth",
        block: "start",
      });
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [isSearching, searchResult]);

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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFiles(Array.from(event.target.files ?? []));
    setUploadError(undefined);
    setUploadSuccess(undefined);
    setUploadNotification(undefined);
  };

  const handleSelectedFileRemove = (index: number) => {
    setSelectedFiles((current) =>
      current.filter((_, currentIndex) => currentIndex !== index),
    );
    setUploadError(undefined);
    setUploadSuccess(undefined);
    setUploadNotification(undefined);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isUploadInFlightRef.current) return;
    setUploadError(undefined);
    setUploadSuccess(undefined);

    if (!selectedFiles.length) {
      setUploadError({
        title: "Файл не выбран",
        description: "Выберите хотя бы один файл для загрузки.",
      });
      setUploadNotification({
        title: "Файл не выбран",
        description: "Выберите хотя бы один файл для загрузки.",
        variant: "error",
      });
      return;
    }

    isUploadInFlightRef.current = true;
    setIsUploading(true);
    setUploadProgress({ completed: 0, total: selectedFiles.length });
    setUploadNotification({
      title: "Загрузка началась",
      description: `Файлов в очереди: ${selectedFiles.length}. Можно закрыть диалог и продолжить работу на этом экране.`,
      variant: "info",
    });

    const uploadedDocuments: DocumentMetadata[] = [];
    const failedFiles: Array<{ file: File; message: string }> = [];

    for (const file of selectedFiles) {
      try {
        uploadedDocuments.push(await uploadDocument(file, accessToken));
      } catch (error) {
        failedFiles.push({
          file,
          message:
            error instanceof Error
              ? error.message
              : "Не удалось загрузить файл.",
        });
      }
      setUploadProgress({
        completed: uploadedDocuments.length + failedFiles.length,
        total: selectedFiles.length,
      });
    }

    const successMessage = uploadedDocuments.length
      ? uploadedDocuments.length === 1
        ? `Файл «${uploadedDocuments[0].filename}» добавлен.`
        : `Добавлено файлов: ${uploadedDocuments.length}.`
      : "";
    const uploadedById = new Map(
      uploadedDocuments.map((document) => [document.id, document]),
    );
    const uploadedDocumentIds = Array.from(uploadedById.keys());

    if (uploadedDocuments.length) {
      const nextDocuments = [
        ...uploadedById.values(),
        ...documentsRef.current.filter(
          (document) => !uploadedById.has(document.id),
        ),
      ];

      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      setSelectedDocumentIds((current) =>
        [...new Set([...current, ...uploadedDocumentIds])].slice(
          0,
          MAX_SELECTED_DOCUMENTS,
        ),
      );
      setUploadSuccess(successMessage);
    }

    if (failedFiles.length) {
      const errorMessage =
        failedFiles.length === 1
          ? {
              title: "Не удалось добавить файл",
              description: `«${failedFiles[0].file.name}»\n${failedFiles[0].message}`,
            }
          : {
              title: `Не удалось добавить ${failedFiles.length} из ${selectedFiles.length} файлов`,
              description: failedFiles
                .map(({ file, message }) => `«${file.name}»: ${message}`)
                .join("\n"),
            };
      setUploadError(errorMessage);
      setUploadNotification({
        title: uploadedDocuments.length
          ? `Добавлено файлов: ${uploadedDocuments.length} из ${selectedFiles.length}`
          : errorMessage.title,
        description: `${errorMessage.description}\nНеудачные файлы сохранены в очереди. Повторите загрузку.`,
        variant: "error",
        documentIds: uploadedDocumentIds,
      });
    } else {
      setIsUploadDialogOpen(false);
      setUploadNotification({
        title: "Документы загружены",
        description: successMessage,
        variant: "success",
        documentIds: uploadedDocumentIds,
      });
    }

    setSelectedFiles(failedFiles.map(({ file }) => file));
    if (fileInputRef.current) fileInputRef.current.value = "";
    isUploadInFlightRef.current = false;
    setIsUploading(false);
  };

  const handleDocumentSelectionChange = (
    documentId: string,
    isSelected: boolean,
  ) => {
    setSelectionError(undefined);
    setSelectedDocumentIds((current) => {
      if (!isSelected) {
        return current.filter((currentId) => currentId !== documentId);
      }

      if (current.includes(documentId)) return current;

      if (current.length >= MAX_SELECTED_DOCUMENTS) {
        setSelectionError(
          `Для одного поиска можно выбрать не более ${MAX_SELECTED_DOCUMENTS} документов.`,
        );
        return current;
      }

      return [...current, documentId];
    });
  };

  const handleDocumentDeleteRequest = (document: DocumentMetadata) => {
    setDeletionNotification(undefined);
    setDocumentDeleteError(undefined);
    setDocumentToDelete(document);
  };

  const handleDocumentDeleteCancel = () => {
    if (isDeletingDocument) return;

    setDocumentDeleteError(undefined);
    setDocumentToDelete(undefined);
  };

  const handleDocumentDelete = async () => {
    if (!documentToDelete) return;

    setDocumentDeleteError(undefined);
    setIsDeletingDocument(true);

    try {
      await deleteDocument(documentToDelete.id, accessToken);
      const nextDocuments = documentsRef.current.filter(
        (document) => document.id !== documentToDelete.id,
      );

      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      setSelectedDocumentIds((current) =>
        current.filter((documentId) => documentId !== documentToDelete.id),
      );
      setSearchResult(undefined);
      setQuestionEditorState("top");
      setDeletionNotification(`«${documentToDelete.filename}»`);
      setDocumentToDelete(undefined);
    } catch (error) {
      setDocumentDeleteError(
        error instanceof Error ? error.message : "Не удалось удалить документ.",
      );
    } finally {
      setIsDeletingDocument(false);
    }
  };

  const handleLocalSearch = async () => {
    const normalizedQuestion = question.trim();
    setQuestionError(undefined);
    setSearchError(undefined);

    if (normalizedQuestion.length < 3) {
      setQuestionError("Сформулируйте вопрос минимум из трёх символов.");
      return;
    }

    if (!documents?.length) {
      setSearchError("Сначала загрузите хотя бы один документ.");
      return;
    }

    if (!selectedDocumentIds.length) {
      setSearchError("Выберите хотя бы один документ для поиска.");
      return;
    }

    setIsSearching(true);

    try {
      const response = await searchDocuments(
        {
          query: normalizedQuestion,
          documentIds: selectedDocumentIds,
          limit: SEARCH_LIMIT,
        },
        accessToken,
      );
      setSearchResult(response);
      setQuestion(response.query);
      setQuestionEditorState(response.items.length ? "collapsed" : "top");
    } catch (error) {
      setSearchError(
        error instanceof Error
          ? error.message
          : "Не удалось выполнить поиск по документам.",
      );
    } finally {
      setIsSearching(false);
    }
  };

  const handleSynapseResearch = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const normalizedQuestion = question.trim();
    setQuestionError(undefined);
    setResearchError(undefined);

    if (normalizedQuestion.length < 3) {
      setQuestionError("Сформулируйте вопрос минимум из трёх символов.");
      return;
    }

    if (!documents?.length) {
      setResearchError("Сначала загрузите хотя бы один документ.");
      return;
    }

    if (!selectedDocumentIds.length) {
      setResearchError("Выберите хотя бы один документ для исследования.");
      return;
    }

    setIsResearchStarting(true);

    try {
      const project = await startDocumentResearch(
        {
          query: normalizedQuestion,
          documentIds: selectedDocumentIds,
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
      setSearchResult(undefined);
      setQuestion(normalizedQuestion);
      setQuestionEditorState("collapsed");
    } catch (error) {
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
    setAccessCodeCopyStatus("");
    setIsAccessCodeCopying(true);

    try {
      const accessCode = await getDocumentAccessCode();
      await copyText(accessCode);
      setAccessToken(accessCode);
      setAccessCodeCopyStatus("Код скопирован. Открываем документы…");
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

  const handleUploadDialogOpen = () => {
    setIsUploadDialogOpen(true);
  };

  const handleUploadDialogClose = () => {
    setIsUploadDialogOpen(false);
    if (isUploading) {
      setUploadNotification({
        title: "Загрузка продолжается",
        description:
          "Файлы продолжают загружаться. Результат появится на этом экране. Очередь можно открыть кнопкой «Добавить документы».",
        variant: "info",
      });
    } else if (selectedFiles.length && !uploadError) {
      setUploadNotification({
        title: "Файлы сохранены в очереди",
        description:
          "Откройте «Добавить документы», чтобы продолжить загрузку.",
        variant: "info",
      });
    }
  };

  const handleQuestionEditorOpen = () => {
    setQuestionError(undefined);
    setSearchError(undefined);
    setResearchError(undefined);
    shouldFocusQuestionEditorRef.current = true;
    setQuestionEditorState("top");
  };

  const handleOpenSource = async (citation: DocumentCitation) => {
    setSourceError(undefined);
    const isPdf = isPdfFilename(citation.document);
    const sourceWindow = isPdf ? window.open("", "_blank") : undefined;

    setIsOpeningSource(true);
    try {
      const file = await getDocumentFile(citation.url, accessToken);
      const fileUrl = URL.createObjectURL(file);

      if (sourceWindow) {
        sourceWindow.opener = null;
        sourceWindow.location.replace(fileUrl);
      } else {
        const link = document.createElement("a");
        link.href = fileUrl;
        link.download = citation.document;
        document.body.append(link);
        link.click();
        link.remove();
      }

      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
    } catch (error) {
      sourceWindow?.close();
      setSourceError(
        error instanceof Error
          ? error.message
          : "Не удалось открыть или скачать исходный файл.",
      );
    } finally {
      setIsOpeningSource(false);
    }
  };

  const renderQuestionForm = () => (
    <form
      ref={questionEditorRef}
      id="document-question-editor"
      className={scss.questionForm}
      onSubmit={handleSynapseResearch}
    >
      <Field
        label="Какой исследовательский вопрос нужно разобрать?"
        htmlFor="document-question"
        hint="Вопрос и выбранные файлы будут переданы в Synapse для исследовательского workflow."
        error={questionError}
        required
      >
        <Textarea
          ref={questionInputRef}
          id="document-question"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Сформулируйте вопрос для исследования по выбранным документам"
          rows={4}
          disabled={isSearching || isResearchStarting}
        />
      </Field>
      {searchError && (
        <p className={scss.selectionError} role="alert">
          {searchError}
        </p>
      )}
      {researchError && (
        <p className={scss.selectionError} role="alert">
          {researchError}
        </p>
      )}
      <div className={scss.questionActions}>
        <Button
          className={scss.synapseButton}
          type="submit"
          disabled={
            isSearching || isResearchStarting || !selectedDocumentIds.length
          }
        >
          {isResearchStarting
            ? "Передаём исследование в Synapse…"
            : "Запустить исследование в Synapse"}
          <span className={scss.synapseButtonIcon} aria-hidden="true">
            <IconRenderer icon="synapseResearch" />
          </span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void handleLocalSearch()}
          disabled={
            isSearching || isResearchStarting || !selectedDocumentIds.length
          }
        >
          {isSearching ? "Ищем фрагменты…" : "Найти фрагменты локально"}
        </Button>
        <span>
          В Synapse уйдут {selectedDocumentIds.length} выбранных файлов.
          Локальный поиск покажет до {SEARCH_LIMIT} фрагментов.
        </span>
      </div>
    </form>
  );

  const uploadProgressLabel = `Обработано файлов: ${uploadProgress.completed} из ${uploadProgress.total}.`;
  const unselectedUploadedCount =
    uploadNotification?.documentIds?.filter(
      (documentId) => !selectedDocumentIds.includes(documentId),
    ).length ?? 0;
  const uploadToast = uploadNotification && (
    <Toast
      title={uploadNotification.title}
      description={`${uploadNotification.description}${unselectedUploadedCount ? `\nНе выбрано для поиска: ${unselectedUploadedCount}. Можно выбрать до ${MAX_SELECTED_DOCUMENTS} документов.` : ""}`}
      variant={uploadNotification.variant}
      autoClose={
        isUploading || uploadNotification.variant === "error" ? false : 5_000
      }
      onClose={() => setUploadNotification(undefined)}
      action={
        !isUploadDialogOpen &&
        uploadNotification.variant === "error" &&
        selectedFiles.length ? (
          <Button
            type="button"
            variant="secondary"
            onClick={handleUploadDialogOpen}
          >
            Открыть загрузку
          </Button>
        ) : undefined
      }
    />
  );

  if (isDocumentsLoading && !documents) {
    return (
      <main className={scss.root}>
        <Loader variant="page" label="Загружаем документы…" />
      </main>
    );
  }

  if (documentsError && !documents) {
    return (
      <main className={scss.root}>
        <section className={scss.panel} aria-labelledby="documents-load-error">
          <p className={scss.eyebrow}>Документы</p>
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
                    disabled={isDocumentsLoading || isAccessCodeCopying}
                    aria-describedby="document-access-copy-status"
                  >
                    <IconRenderer
                      className={scss.copyAccessCodeIcon}
                      icon="copy"
                    />
                    {isAccessCodeCopying ? "Копируем…" : "Скопировать код"}
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
              disabled={isDocumentsLoading}
            >
              Повторить попытку
            </Button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main ref={workspaceRef} className={scss.root}>
      <header className={scss.header}>
        <h1>Поиск по документам</h1>
        <p className={scss.lead}>
          Загрузите документы, выберите, где искать, и задайте вопрос. Сервис
          найдёт подходящие фрагменты из первоисточников.
        </p>
      </header>

      <div className={scss.toastStack}>
        {!isUploadDialogOpen && uploadToast}
        {deletionNotification && (
          <Toast
            title="Документ удалён"
            description={deletionNotification}
            onClose={() => setDeletionNotification(undefined)}
          />
        )}
      </div>

      <nav
        className={scss.viewSwitcher}
        aria-label="Разделы работы с документами"
      >
        <button
          className={scss.viewButton}
          type="button"
          aria-pressed={false}
          disabled
        >
          Документы
        </button>
        <button className={scss.viewButton} type="button" aria-pressed={true}>
          Поиск
        </button>
      </nav>

      <div className={contentClassNames}>
        {documentsError && (
          <section className={scss.errorBanner} role="alert">
            <p>{documentsError}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadDocuments(accessToken)}
              disabled={isDocumentsLoading || isUploading}
            >
              Повторить
            </Button>
          </section>
        )}

        <section className={scss.searchWorkspace} aria-label="Поиск">
          {isUploading && (
            <div className={scss.uploadStatus}>
              <p role="status">Загружаем документы. {uploadProgressLabel}</p>
              <Button
                type="button"
                variant="secondary"
                onClick={handleUploadDialogOpen}
              >
                Открыть загрузку
              </Button>
            </div>
          )}
          {documents?.length ? (
            <>
              <article ref={documentSelectionPanelRef} className={scss.panel}>
                <div className={scss.sectionHeading}>
                  <div>
                    <h2>Выберите документы для поиска</h2>
                  </div>
                  <div className={scss.selectionActions}>
                    <span className={scss.count}>
                      {formatDocumentCount(documents.length)}
                    </span>
                    <Button
                      type="button"
                      variant="secondary"
                      id="add-documents"
                      onClick={handleUploadDialogOpen}
                    >
                      Добавить документы
                    </Button>
                  </div>
                </div>

                <fieldset className={scss.documentSelection}>
                  <legend>
                    Выбрано {selectedDocumentIds.length} из {documents.length}
                  </legend>
                  <p className={scss.muted}>
                    В поиск попадут отмеченные документы. За один запрос можно
                    выбрать до {MAX_SELECTED_DOCUMENTS} файлов.
                  </p>
                  {selectionError && (
                    <p className={scss.selectionError} role="alert">
                      {selectionError}
                    </p>
                  )}
                  <ul ref={documentListRef} className={scss.documentList}>
                    {documents.map((document) => {
                      const checkboxId = `document-${document.id}`;
                      const isSelected = selectedDocumentIds.includes(
                        document.id,
                      );

                      return (
                        <li key={document.id} className={scss.documentItem}>
                          <input
                            id={checkboxId}
                            className={scss.documentCheckbox}
                            type="checkbox"
                            checked={isSelected}
                            onChange={(event) =>
                              handleDocumentSelectionChange(
                                document.id,
                                event.target.checked,
                              )
                            }
                          />
                          <div className={scss.documentContent}>
                            <label
                              className={scss.documentLabel}
                              htmlFor={checkboxId}
                            >
                              <span className={scss.documentTopLine}>
                                <strong>{document.filename}</strong>
                              </span>
                              <span className={scss.documentMeta}>
                                <span>
                                  {formatFileSize(document.sizeBytes)}
                                </span>
                                <span>{formatDocumentUnits(document)}</span>
                                <span>{document.textPageCount} с текстом</span>
                                <span>{document.chunkCount} фрагментов</span>
                                <span className={scss.status}>
                                  <span
                                    className={scss.statusIndicator}
                                    aria-hidden="true"
                                  />
                                  {formatDocumentStatus(document.status)}
                                </span>
                              </span>
                              <span className={scss.documentDate}>
                                Добавлен: {formatDate(document.uploadedAt)}
                              </span>
                            </label>
                            <button
                              className={scss.documentDeleteButton}
                              type="button"
                              onClick={() =>
                                handleDocumentDeleteRequest(document)
                              }
                              aria-label={`Удалить документ «${document.filename}»`}
                              title="Удалить документ"
                            >
                              <span aria-hidden="true">
                                <IconRenderer icon="remove" />
                              </span>
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </fieldset>
              </article>

              {((!searchResult && !synapseProject) ||
                questionEditorState === "top") && (
                <section
                  ref={questionPanelRef}
                  className={scss.panel}
                  aria-labelledby="search-question"
                >
                  <div className={scss.sectionHeading}>
                    <div>
                      <h2 id="search-question">Задайте вопрос</h2>
                    </div>
                  </div>
                  {renderQuestionForm()}
                </section>
              )}
            </>
          ) : (
            <section className={scss.emptyState} aria-labelledby="search-empty">
              <h2 id="search-empty">Сначала загрузите документы</h2>
              <p>
                Добавьте статью, выгрузку библиографической базы или техническую
                документацию в поддерживаемом формате, чтобы начать поиск.
              </p>
              <Button
                type="button"
                id="add-documents"
                onClick={handleUploadDialogOpen}
              >
                Добавить документы
              </Button>
            </section>
          )}
        </section>

        {isSearching && (
          <section className={scss.searchLoading} aria-live="polite">
            <Loader
              variant="inline"
              label="Ищем фрагменты в выбранных документах…"
            />
          </section>
        )}

        {synapseProject && (
          <section
            className={scss.researchProject}
            aria-live="polite"
            aria-labelledby="synapse-research-title"
          >
            <div className={scss.resultsHeading}>
              <div>
                <p className={scss.eyebrow}>Исследование в Synapse</p>
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
                <dd>{selectedDocumentIds.length}</dd>
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
                disabled={isResearchRefreshing}
              >
                {isResearchRefreshing ? "Обновляем…" : "Обновить статус"}
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

        {searchResult && !isSearching && (
          <section
            ref={searchResultsRef}
            className={scss.searchResults}
            aria-live="polite"
          >
            <div className={scss.resultsHeading}>
              <div>
                <p className={scss.eyebrow}>Кандидаты на доказательства</p>
                <h2>Фрагменты по вопросу</h2>
                <p className={scss.muted}>«{searchResult.query}»</p>
              </div>
              <div className={scss.resultsActions}>
                <span className={scss.count}>
                  {searchResult.total}{" "}
                  {searchResult.total === 1 ? "результат" : "результатов"}
                </span>
                {questionEditorState === "collapsed" && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleQuestionEditorOpen}
                  >
                    Изменить вопрос
                  </Button>
                )}
              </div>
            </div>

            {searchResult.items.length ? (
              <ol className={scss.resultList}>
                {searchResult.items.map((item) => (
                  <li key={item.chunkId} className={scss.resultItem}>
                    <article>
                      <div className={scss.citationHeading}>
                        <div>
                          <p className={scss.citationDocument}>
                            {item.documentName}
                          </p>
                          <p className={scss.citationLocation}>
                            {item.citation.location}
                          </p>
                        </div>
                        <button
                          type="button"
                          className={scss.sourceLink}
                          aria-label={`Открыть источник: ${item.citation.document}, ${item.citation.location}`}
                          onClick={() => void handleOpenSource(item.citation)}
                          disabled={isOpeningSource}
                        >
                          {isOpeningSource ? (
                            "Открываем…"
                          ) : (
                            <>
                              Открыть источник
                              <span
                                className={scss.sourceLinkIcon}
                                aria-hidden="true"
                              >
                                <IconRenderer icon="externalLink" />
                              </span>
                            </>
                          )}
                        </button>
                      </div>
                      <blockquote>{item.excerpt}</blockquote>
                      <p className={scss.relevance}>
                        Соответствие запросу:{" "}
                        {item.score.toLocaleString("ru-RU", {
                          maximumFractionDigits: 2,
                        })}
                      </p>
                    </article>
                  </li>
                ))}
              </ol>
            ) : (
              <div className={scss.emptyState}>
                <h3>Подтверждающих фрагментов не найдено</h3>
                <p>
                  Попробуйте уточнить термины, условия эксперимента или выбрать
                  другие документы.
                </p>
              </div>
            )}
            <aside className={scss.retrievalNotice}>
              <strong>Это этап поиска, а не готовый научный вывод.</strong>
              <p>
                Найденные фрагменты нужно сверить с методикой и условиями опыта,
                а затем подтвердить как факты в{" "}
                <a href="/">доказательной базе</a>.
              </p>
            </aside>
            {sourceError && (
              <p className={scss.sourceError} role="alert">
                {sourceError}
              </p>
            )}
          </section>
        )}

        <dialog
          ref={uploadDialogRef}
          className={scss.uploadDialog}
          aria-labelledby="document-upload-title"
          onCancel={(event) => {
            event.preventDefault();
            handleUploadDialogClose();
          }}
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;

            const controls = event.currentTarget.querySelectorAll<HTMLElement>(
              "button:not(:disabled), input:not(:disabled)",
            );
            const firstControl = controls[0];
            const lastControl = controls[controls.length - 1];

            if (event.shiftKey && document.activeElement === firstControl) {
              event.preventDefault();
              lastControl?.focus();
            } else if (
              !event.shiftKey &&
              document.activeElement === lastControl
            ) {
              event.preventDefault();
              firstControl?.focus();
            }
          }}
          onClick={(event) => {
            if (event.target !== event.currentTarget) return;
            const bounds = event.currentTarget.getBoundingClientRect();
            if (
              event.clientX < bounds.left ||
              event.clientX > bounds.right ||
              event.clientY < bounds.top ||
              event.clientY > bounds.bottom
            ) {
              handleUploadDialogClose();
            }
          }}
        >
          <div className={scss.uploadDialogBody}>
            <div className={scss.sectionHeading}>
              <h2 id="document-upload-title">Добавить документы</h2>
              <button
                type="button"
                className={scss.dialogCloseButton}
                onClick={handleUploadDialogClose}
                aria-label="Закрыть загрузку документов"
              >
                <IconRenderer icon="close" />
              </button>
            </div>
            {isUploadDialogOpen && uploadToast && (
              <div className={scss.dialogToast}>{uploadToast}</div>
            )}
            <form className={scss.uploadForm} onSubmit={handleUpload}>
              <Field
                label="Выберите файлы"
                htmlFor="document-upload"
                hint="Поддерживаются PDF, JSON/JSONL, CSV/TSV, XML (JATS/TEI), HTML, TXT/MD, RIS и BibTeX. Можно выбрать несколько файлов. После загрузки текст будет доступен для поиска."
                required
              >
                <input
                  ref={fileInputRef}
                  id="document-upload"
                  className={scss.fileInput}
                  type="file"
                  accept={SUPPORTED_DOCUMENT_ACCEPT}
                  multiple
                  onChange={handleFileChange}
                  disabled={isUploading || isDocumentsLoading}
                />
              </Field>
              {selectedFiles.length > 0 && (
                <section
                  className={scss.selectedFiles}
                  aria-label="Выбранные файлы"
                  aria-live="polite"
                >
                  <div className={scss.selectedFilesHeading}>
                    <strong>Выбрано файлов: {selectedFiles.length}</strong>
                  </div>
                  <ul className={scss.selectedFilesList}>
                    {selectedFiles.map((file, index) => (
                      <li
                        key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                        className={scss.selectedFile}
                      >
                        <span
                          className={scss.selectedFileName}
                          title={file.name}
                        >
                          {file.name}
                        </span>
                        <span className={scss.selectedFileSize}>
                          {formatFileSize(file.size)}
                        </span>
                        <button
                          className={scss.removeSelectedFileButton}
                          type="button"
                          onClick={() => handleSelectedFileRemove(index)}
                          disabled={isUploading}
                          aria-label={`Убрать файл «${file.name}» из очереди загрузки`}
                        >
                          Убрать
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
              {uploadError && (
                <section
                  className={scss.uploadError}
                  aria-label="Ошибки загрузки"
                >
                  <strong>{uploadError.title}</strong>
                  <p>{uploadError.description}</p>
                </section>
              )}
              {isUploading && (
                <p role="status" className={scss.muted}>
                  {uploadProgressLabel}
                </p>
              )}
              <div className={scss.uploadActions}>
                <Button
                  className={scss.uploadButton}
                  type="submit"
                  disabled={isUploading || isDocumentsLoading}
                >
                  <IconRenderer className={scss.uploadIcon} icon="download" />
                  {isUploading
                    ? "Добавляем файлы…"
                    : `Загрузить файлы${selectedFiles.length > 1 ? ` (${selectedFiles.length})` : ""}`}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleUploadDialogClose}
                >
                  {isUploading ? "Продолжить в фоне" : "Закрыть"}
                </Button>
              </div>
              {uploadSuccess && (
                <p className={scss.successMessage} role="status">
                  {uploadSuccess}
                </p>
              )}
            </form>
          </div>
        </dialog>

        {documentToDelete && (
          <div className={scss.confirmationOverlay}>
            <section
              className={scss.confirmationDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-document-title"
              aria-describedby="delete-document-description"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;

                event.preventDefault();
                handleDocumentDeleteCancel();
              }}
            >
              <h2 id="delete-document-title">Удалить документ?</h2>
              <p id="delete-document-description">
                Файл «{documentToDelete.filename}» и найденные в нём фрагменты
                будут удалены без возможности восстановления.
              </p>
              {documentDeleteError && (
                <p className={scss.selectionError} role="alert">
                  {documentDeleteError}
                </p>
              )}
              <div className={scss.confirmationActions}>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleDocumentDeleteCancel}
                  disabled={isDeletingDocument}
                  autoFocus
                >
                  Отмена
                </Button>
                <Button
                  className={scss.confirmDeleteButton}
                  type="button"
                  onClick={() => void handleDocumentDelete()}
                  disabled={isDeletingDocument}
                >
                  {isDeletingDocument ? "Удаляем…" : "Удалить"}
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
};

export default DocumentsWorkspace;
