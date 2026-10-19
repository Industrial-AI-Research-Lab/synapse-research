import scss from "./documentsWorkspace.module.scss";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import type { ChangeEvent, FormEvent } from "react";
import { useOutsideClick } from "../../assets/hooks/useOutsideClick";

import {
  deleteDocument,
  DocumentApiError,
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
import ToastViewport from "../../components/ui/Toast/ToastViewport";
import Tooltip from "../../components/ui/Tooltip/Tooltip";
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
  variant: "success" | "error" | "info" | "warning";
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

const getDocumentExtension = (filename: string) => {
  const dotIndex = filename.lastIndexOf(".");

  return dotIndex >= 0 ? filename.slice(dotIndex).toLowerCase() : "";
};

const isPdfFilename = (filename: string) =>
  getDocumentExtension(filename) === ".pdf";

const getDocumentFileAction = (filename: string) => {
  if (isPdfFilename(filename)) {
    return {
      label: "Открыть PDF",
      loadingLabel: "Открываем…",
      icon: "externalLink" as const,
      description: "Открыть PDF в новой вкладке",
    };
  }

  const format = getDocumentExtension(filename).slice(1).toUpperCase();

  return {
    label: format ? `Скачать ${format}` : "Скачать файл",
    loadingLabel: "Скачиваем…",
    icon: "download" as const,
    description: "Скачать исходный файл на устройство",
  };
};

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
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogContentRef = useRef<HTMLElement>(null);
  const isUploadInFlightRef = useRef(false);
  const documentSelectionPanelRef = useRef<HTMLElement>(null);
  const documentListRef = useRef<HTMLUListElement>(null);
  const documentListScrollTopRef = useRef(0);
  const shouldRestoreDocumentListScrollRef = useRef(false);
  const sourcesCollapseButtonRef = useRef<HTMLButtonElement>(null);
  const sourcesExpandButtonRef = useRef<HTMLButtonElement>(null);
  const shouldFocusSourcesToggleRef = useRef(false);
  const questionPanelRef = useRef<HTMLElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchResultsRef = useRef<HTMLElement>(null);
  const questionEditorRef = useRef<HTMLFormElement>(null);
  const questionInputRef = useRef<HTMLTextAreaElement>(null);
  const shouldFocusQuestionEditorRef = useRef(false);
  const documentsRef = useRef<DocumentMetadata[]>([]);
  const [documents, setDocuments] = useState<DocumentMetadata[]>();
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<string[]>([]);
  const [isSourcesCollapsed, setIsSourcesCollapsed] = useState(false);
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
  const [hasQuestionValidationAttempted, setHasQuestionValidationAttempted] =
    useState(false);
  const questionError =
    hasQuestionValidationAttempted && question.trim().length < 3
      ? "Сформулируйте вопрос минимум из трёх символов."
      : undefined;
  const [selectionError, setSelectionError] = useState<string>();
  const [searchError, setSearchError] = useState<string>();
  const [researchError, setResearchError] = useState<string>();
  const [sourceError, setSourceError] = useState<string>();
  const [deletionNotification, setDeletionNotification] = useState<string>();
  const [documentToDelete, setDocumentToDelete] = useState<DocumentMetadata>();
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDocumentsLoading, setIsDocumentsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isResearchStarting, setIsResearchStarting] = useState(false);
  const [isResearchRefreshing, setIsResearchRefreshing] = useState(false);
  const [openingSourceUrl, setOpeningSourceUrl] = useState("");
  const isOpeningSource = Boolean(openingSourceUrl);
  const [isResearchStartUncertain, setIsResearchStartUncertain] =
    useState(false);
  const [feedbackNotification, setFeedbackNotification] =
    useState<UploadNotification>();
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

    if (
      isSourcesCollapsed ||
      !workspace ||
      !panel ||
      !list ||
      !list.children.length
    ) {
      return;
    }

    const updateListHeight = () => {
      const screen = workspace.parentElement!;
      const firstItem = list.children[0];
      const lastVisibleItem =
        list.children[
          Math.min(MIN_VISIBLE_LIST_ITEMS, list.children.length) - 1
        ];
      const minimumHeight =
        lastVisibleItem.getBoundingClientRect().bottom -
        firstItem.getBoundingClientRect().top;
      const listBounds = list.getBoundingClientRect();
      const workspacePadding = parseFloat(
        getComputedStyle(workspace).paddingBottom,
      );
      const isQuestionBelow = questionPanel
        ? questionPanel.getBoundingClientRect().left <
          panel.getBoundingClientRect().right - 1
        : false;
      const questionPanelHeight =
        questionPanel && isQuestionBelow
          ? questionPanel.getBoundingClientRect().height +
            parseFloat(getComputedStyle(questionPanel.parentElement!).rowGap)
          : 0;
      const availableHeight =
        screen.clientHeight -
        (listBounds.top -
          screen.getBoundingClientRect().top +
          screen.scrollTop) -
        workspacePadding -
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
    if (shouldRestoreDocumentListScrollRef.current) {
      list.scrollTop = documentListScrollTopRef.current;
      shouldRestoreDocumentListScrollRef.current = false;
    }

    return () => observer.disconnect();
  }, [
    documents,
    documentsError,
    hasSearchOutput,
    questionEditorState,
    isUploading,
    isSourcesCollapsed,
  ]);

  useLayoutEffect(() => {
    if (!shouldFocusSourcesToggleRef.current) return;

    shouldFocusSourcesToggleRef.current = false;
    const button = isSourcesCollapsed
      ? sourcesExpandButtonRef.current
      : sourcesCollapseButtonRef.current;
    button?.focus({ preventScroll: true });
  }, [isSourcesCollapsed]);

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

  useLayoutEffect(() => {
    const dialog = deleteDialogRef.current;

    if (!isDeleteDialogOpen || !dialog) return;

    const trigger = document.activeElement;
    dialog.showModal();

    return () => {
      dialog.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      } else {
        document
          .getElementById("add-documents")
          ?.focus({ preventScroll: true });
      }
    };
  }, [isDeleteDialogOpen]);

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

  const handleSelectedFilesClear = () => {
    if (isUploadInFlightRef.current) return;

    setSelectedFiles([]);
    setUploadError(undefined);
    setUploadSuccess(undefined);
    setUploadNotification(undefined);

    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.focus({ preventScroll: true });
    }
  };

  const handleUpload = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isUploadInFlightRef.current) return;
    setUploadError(undefined);
    setUploadSuccess(undefined);

    if (!selectedFiles.length) {
      fileInputRef.current?.focus();
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
        description: `${failedFiles.length === 1 ? errorMessage.description : `Не удалось добавить файлов: ${failedFiles.length}. Подробности — в окне загрузки.`}\nНеудачные файлы сохранены в очереди. Повторите загрузку.`,
        variant: uploadedDocuments.length ? "warning" : "error",
        documentIds: uploadedDocumentIds,
      });
    } else {
      setIsUploadDialogOpen(false);
      setUploadNotification({
        title: "Документы добавлены",
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

  const handleSourcesToggle = () => {
    if (!isSourcesCollapsed) {
      documentListScrollTopRef.current =
        documentListRef.current?.scrollTop ?? 0;
    } else {
      shouldRestoreDocumentListScrollRef.current = true;
    }
    shouldFocusSourcesToggleRef.current = true;
    setIsSourcesCollapsed((current) => !current);
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

  const handleSelectAllDocuments = () => {
    setSelectionError(undefined);
    setSelectedDocumentIds(
      documentsRef.current
        .slice(0, MAX_SELECTED_DOCUMENTS)
        .map((document) => document.id),
    );
  };

  const handleClearDocumentSelection = () => {
    setSelectionError(undefined);
    setSelectedDocumentIds([]);
  };

  const handleDocumentDeleteRequest = (document: DocumentMetadata) => {
    setDeletionNotification(undefined);
    setDocumentDeleteError(undefined);
    setDocumentToDelete(document);
    setIsDeleteDialogOpen(true);
  };

  const handleDocumentDeleteCancel = () => {
    if (isDeletingDocument) return;

    setDocumentDeleteError(undefined);
    setIsDeleteDialogOpen(false);
  };

  useOutsideClick(
    deleteDialogContentRef,
    handleDocumentDeleteCancel,
    isDeleteDialogOpen && !isDeletingDocument,
  );

  const handleDocumentDelete = async () => {
    if (!isDeleteDialogOpen || !documentToDelete || isDeletingDocument) return;

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
      setIsDeleteDialogOpen(false);
    } catch (error) {
      setDocumentDeleteError(
        error instanceof Error ? error.message : "Не удалось удалить документ.",
      );
    } finally {
      setIsDeletingDocument(false);
    }
  };

  const handleLocalSearch = async () => {
    if (isSearching || isResearchStarting) return;
    const normalizedQuestion = question.trim();
    setHasQuestionValidationAttempted(true);
    setSearchError(undefined);

    if (normalizedQuestion.length < 3) {
      questionInputRef.current?.focus();
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
    if (isSearching || isResearchStarting || isResearchStartUncertain) return;
    const normalizedQuestion = question.trim();
    setHasQuestionValidationAttempted(true);
    setResearchError(undefined);

    if (normalizedQuestion.length < 3) {
      questionInputRef.current?.focus();
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
    setHasQuestionValidationAttempted(false);
    setSearchError(undefined);
    setResearchError(undefined);
    shouldFocusQuestionEditorRef.current = true;
    setQuestionEditorState("top");
  };

  const handleOpenSource = async (
    citation: Pick<DocumentCitation, "document" | "url">,
  ) => {
    if (isOpeningSource) return;
    setSourceError(undefined);
    const isPdf = isPdfFilename(citation.document);
    const sourceWindow = isPdf ? window.open("", "_blank") : undefined;

    setOpeningSourceUrl(citation.url);
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

      if (!sourceWindow) {
        setFeedbackNotification({
          title: "Файл передан браузеру",
          description: `«${citation.document}»`,
          variant: "success",
        });
      }
      window.setTimeout(() => URL.revokeObjectURL(fileUrl), 60_000);
    } catch (error) {
      sourceWindow?.close();
      setSourceError(
        error instanceof Error
          ? error.message
          : isPdf
            ? "Не удалось открыть PDF. Попробуйте ещё раз."
            : "Не удалось скачать файл. Попробуйте ещё раз.",
      );
    } finally {
      setOpeningSourceUrl("");
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
          disabled={isSearching || isResearchStarting}
        />
      </Field>
      <p
        id="document-selection-hint"
        className={scss.questionContext}
        aria-live="polite"
      >
        {selectedDocumentIds.length
          ? `Выбрано ${selectedDocumentIds.length} из ${documents?.length ?? 0}`
          : isSourcesCollapsed
            ? "Разверните источники и выберите хотя бы один документ, чтобы запустить исследование или найти фрагменты."
            : "Выберите хотя бы один документ в списке источников, чтобы запустить исследование или найти фрагменты."}
      </p>
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
          aria-describedby="document-research-hint document-selection-hint"
          isLoading={isResearchStarting}
          loadingLabel="Передаём в Synapse…"
          disabled={
            isSearching ||
            isResearchStarting ||
            isResearchStartUncertain ||
            Boolean(questionError) ||
            !selectedDocumentIds.length
          }
        >
          Запустить исследование
          <span className={scss.synapseButtonIcon} aria-hidden="true">
            <IconRenderer icon="arrowRight" />
          </span>
        </Button>
        <Button
          type="button"
          variant="secondary"
          aria-describedby="document-fragments-hint document-selection-hint"
          isLoading={isSearching}
          loadingLabel="Ищем фрагменты…"
          onClick={() => void handleLocalSearch()}
          disabled={
            isSearching ||
            isResearchStarting ||
            Boolean(questionError) ||
            !selectedDocumentIds.length
          }
        >
          Найти фрагменты
        </Button>
      </div>
      {isResearchStartUncertain && (
        <p className={scss.uncertainStart}>
          Synapse мог принять запрос.{" "}
          <a href="/researches">Проверить состояние</a> перед повторным
          запуском.
        </p>
      )}
      <p className={scss.questionActionHint}>
        <span id="document-research-hint">
          Исследование подготовит ответ по выбранным источникам.
        </span>{" "}
        <span id="document-fragments-hint">
          Поиск покажет до {SEARCH_LIMIT} фрагментов документов.
        </span>
      </p>
      <p className={scss.resultNote}>
        Результат и материалы сохранятся в разделе «Исследования».
      </p>
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
      description={`${isUploading ? `Обработано файлов: ${uploadProgress.completed} из ${uploadProgress.total}. Можно продолжить работу.` : uploadNotification.description}${unselectedUploadedCount ? `\nНе выбрано для поиска: ${unselectedUploadedCount}. Можно выбрать до ${MAX_SELECTED_DOCUMENTS} документов.` : ""}`}
      variant={uploadNotification.variant}
      isLoading={isUploading}
      progress={isUploading ? uploadProgress : undefined}
      autoClose={
        uploadNotification.variant === "success" && !isUploading ? 5_000 : false
      }
      onClose={() => setUploadNotification(undefined)}
      action={
        !isUploadDialogOpen && selectedFiles.length ? (
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
    <main ref={workspaceRef} className={scss.root}>
      <header className={scss.header}>
        <h1>Исследование по документам</h1>
        <p className={scss.lead}>
          Выберите источники и задайте исследовательский вопрос.
        </p>
      </header>

      <ToastViewport>
        {!isUploadDialogOpen && uploadToast}
        {!isUploadDialogOpen && feedbackToast}
        {deletionNotification && (
          <Toast
            title="Документ удалён"
            description={deletionNotification}
            onClose={() => setDeletionNotification(undefined)}
          />
        )}
      </ToastViewport>

      <div className={contentClassNames}>
        {documentsError && (
          <section className={scss.errorBanner} role="alert">
            <p>{documentsError}</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadDocuments(accessToken)}
              disabled={isUploading}
              isLoading={isDocumentsLoading}
              loadingLabel="Загружаем…"
            >
              Повторить
            </Button>
          </section>
        )}

        <section
          className={`${scss.searchWorkspace} ${isSourcesCollapsed ? scss.sourcesCollapsed : ""}`}
          aria-label="Поиск"
        >
          {documents?.length ? (
            <div className={scss.sourcesSummary} hidden={!isSourcesCollapsed}>
              <div className={scss.sourcesSummaryText}>
                <h2>Источники</h2>
                <span>
                  Выбрано {selectedDocumentIds.length} из {documents.length}
                </span>
              </div>
              <button
                ref={sourcesExpandButtonRef}
                type="button"
                className={scss.sourcesExpandButton}
                onClick={handleSourcesToggle}
                aria-label="Развернуть источники"
                aria-expanded={false}
                aria-controls="document-sources-panel"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <path d="M9 3v18m5-12 3 3-3 3" />
                </svg>
                Развернуть
              </button>
            </div>
          ) : null}
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
              <article
                ref={documentSelectionPanelRef}
                id="document-sources-panel"
                className={scss.documentPanel}
                hidden={isSourcesCollapsed}
              >
                <div className={scss.sectionHeading}>
                  <div>
                    <h2>Источники</h2>
                  </div>
                  <div className={scss.selectionActions}>
                    <button
                      ref={sourcesCollapseButtonRef}
                      type="button"
                      className={scss.sourcesCollapseButton}
                      onClick={handleSourcesToggle}
                      aria-label="Свернуть источники"
                      aria-expanded={true}
                      aria-controls="document-sources-panel"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <path d="M9 3v18m7-12-3 3 3 3" />
                      </svg>
                      Свернуть
                    </button>
                    <Button
                      type="button"
                      className={scss.uploadButton}
                      variant="secondary"
                      id="add-documents"
                      data-toast-focus-return
                      aria-label="Добавить документы"
                      onClick={handleUploadDialogOpen}
                    >
                      <IconRenderer
                        className={scss.uploadIcon}
                        icon="download"
                      />
                      <span className={scss.uploadLabelFull} aria-hidden="true">
                        Добавить документы
                      </span>
                      <span
                        className={scss.uploadLabelShort}
                        aria-hidden="true"
                      >
                        Добавить
                      </span>
                    </Button>
                  </div>
                </div>

                <fieldset className={scss.documentSelection}>
                  <legend className={scss.selectionLegend}>
                    Документы для этого запроса
                  </legend>
                  <div className={scss.selectionToolbar}>
                    <span
                      className={scss.selectionSummary}
                      aria-live="polite"
                      title={`До ${MAX_SELECTED_DOCUMENTS} файлов на запрос`}
                    >
                      Выбрано {selectedDocumentIds.length} из {documents.length}
                    </span>
                    <div className={scss.bulkSelectionActions}>
                      <button
                        className={scss.selectionButton}
                        type="button"
                        onClick={handleSelectAllDocuments}
                        disabled={documents
                          .slice(0, MAX_SELECTED_DOCUMENTS)
                          .every((document) =>
                            selectedDocumentIds.includes(document.id),
                          )}
                      >
                        {documents.length > MAX_SELECTED_DOCUMENTS
                          ? `Выбрать первые ${MAX_SELECTED_DOCUMENTS}`
                          : "Выбрать все"}
                      </button>
                      <button
                        className={scss.selectionButton}
                        type="button"
                        onClick={handleClearDocumentSelection}
                        disabled={!selectedDocumentIds.length}
                      >
                        Снять выбор
                      </button>
                    </div>
                  </div>
                  {selectionError && (
                    <p className={scss.selectionError} role="alert">
                      {selectionError}
                    </p>
                  )}
                  <ul ref={documentListRef} className={scss.documentList}>
                    {documents.map((document) => {
                      const checkboxId = `document-${document.id}`;
                      const fileAction = getDocumentFileAction(
                        document.filename,
                      );
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
                          <Tooltip
                            target={
                              <span
                                className={scss.fileType}
                                tabIndex={0}
                                aria-label={`Сведения о документе «${document.filename}»`}
                                data-format={getDocumentExtension(
                                  document.filename,
                                )}
                              >
                                <svg
                                  viewBox="0 0 28 32"
                                  aria-hidden="true"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="1.5"
                                >
                                  <path d="M5 2h12l6 6v22H5zM17 2v7h6" />
                                  <text
                                    x="14"
                                    y="24"
                                    textAnchor="middle"
                                    fill="currentColor"
                                    stroke="none"
                                    fontSize="7"
                                    fontFamily="sans-serif"
                                  >
                                    {getDocumentExtension(document.filename)
                                      .slice(1, 4)
                                      .toUpperCase()}
                                  </text>
                                </svg>
                              </span>
                            }
                          >
                            {document.textPageCount} страниц или записей с
                            текстом · {document.chunkCount} фрагментов ·{" "}
                            {formatDocumentStatus(document.status)}. Добавлен:{" "}
                            {formatDate(document.uploadedAt)}
                          </Tooltip>
                          <div className={scss.documentContent}>
                            <label
                              className={scss.documentLabel}
                              htmlFor={checkboxId}
                            >
                              <span className={scss.documentTopLine}>
                                <strong title={document.filename}>
                                  {document.filename}
                                </strong>
                              </span>
                              <span className={scss.documentMeta}>
                                <span className={scss.documentFormat}>
                                  {getDocumentExtension(document.filename)
                                    .slice(1)
                                    .toUpperCase()}
                                </span>
                                <span>{formatDocumentUnits(document)}</span>
                                <span>
                                  {formatFileSize(document.sizeBytes)}
                                </span>
                              </span>
                            </label>
                            <Button
                              className={scss.documentOpenButton}
                              type="button"
                              variant="text"
                              isLoading={
                                openingSourceUrl ===
                                `/api/documents/${encodeURIComponent(document.id)}/file`
                              }
                              aria-label={
                                openingSourceUrl ===
                                `/api/documents/${encodeURIComponent(document.id)}/file`
                                  ? fileAction.loadingLabel
                                  : `${fileAction.label}: ${document.filename}`
                              }
                              title={`${fileAction.label}. ${fileAction.description}`}
                              disabled={isOpeningSource}
                              onClick={() =>
                                void handleOpenSource({
                                  document: document.filename,
                                  url: `/api/documents/${encodeURIComponent(document.id)}/file`,
                                })
                              }
                            >
                              <IconRenderer icon={fileAction.icon} />
                            </Button>
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
                  className={scss.questionPanel}
                  aria-labelledby="search-question"
                >
                  <div className={scss.sectionHeading}>
                    <div>
                      <h2 id="search-question">Исследовательский вопрос</h2>
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
                className={scss.uploadButton}
                variant="secondary"
                id="add-documents"
                data-toast-focus-return
                onClick={handleUploadDialogOpen}
              >
                <IconRenderer className={scss.uploadIcon} icon="download" />
                Добавить документы
              </Button>
            </section>
          )}
        </section>

        {sourceError && (
          <p className={scss.sourceError} role="alert">
            {sourceError}
          </p>
        )}

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

        {searchResult && !isSearching && (
          <section
            ref={searchResultsRef}
            className={scss.searchResults}
            aria-live="polite"
          >
            <div className={scss.resultsHeading}>
              <div>
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
                {searchResult.items.map((item) => {
                  const fileAction = getDocumentFileAction(
                    item.citation.document,
                  );

                  return (
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
                          <Button
                            type="button"
                            variant="text"
                            className={scss.sourceLink}
                            isLoading={openingSourceUrl === item.citation.url}
                            loadingLabel={fileAction.loadingLabel}
                            aria-label={`${fileAction.label}: ${item.citation.document}, ${item.citation.location}`}
                            title={fileAction.description}
                            onClick={() => void handleOpenSource(item.citation)}
                            disabled={isOpeningSource}
                          >
                            <span
                              className={scss.sourceLinkIcon}
                              aria-hidden="true"
                            >
                              <IconRenderer icon={fileAction.icon} />
                            </span>
                            {fileAction.label}
                          </Button>
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
                  );
                })}
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
                Сверьте найденные фрагменты с первоисточниками и учитывайте
                ограничения документов при подготовке выводов.
              </p>
            </aside>
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
                aria-label={
                  isUploading
                    ? "Продолжить загрузку в фоне и закрыть окно"
                    : "Закрыть загрузку документов"
                }
                title={isUploading ? "Загрузка продолжится в фоне" : "Закрыть"}
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
                    <button
                      className={scss.clearSelectedFilesButton}
                      type="button"
                      onClick={handleSelectedFilesClear}
                      disabled={isUploading}
                      aria-label="Очистить все выбранные файлы из очереди загрузки"
                    >
                      Очистить всё
                    </button>
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
                          title="Убрать файл"
                        >
                          <IconRenderer icon="close" />
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
                  disabled={isDocumentsLoading}
                  isLoading={isUploading}
                  loadingLabel="Добавляем файлы…"
                >
                  <IconRenderer className={scss.uploadIcon} icon="download" />
                  {`Загрузить файлы${selectedFiles.length > 1 ? ` (${selectedFiles.length})` : ""}`}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className={scss.uploadCloseButton}
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

        <dialog
          ref={deleteDialogRef}
          className={scss.confirmationModal}
          aria-labelledby="delete-document-title"
          aria-describedby="delete-document-description"
          onCancel={(event) => {
            event.preventDefault();
            handleDocumentDeleteCancel();
          }}
        >
          <section
            ref={deleteDialogContentRef}
            className={scss.confirmationDialog}
          >
            <h2 id="delete-document-title">Удалить документ?</h2>
            <p id="delete-document-description">
              Файл «{documentToDelete?.filename}» и найденные в нём фрагменты
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
                variant="danger"
                isLoading={isDeletingDocument}
                loadingLabel="Удаляем…"
                type="button"
                onClick={() => void handleDocumentDelete()}
                disabled={isDeletingDocument}
              >
                Удалить
              </Button>
            </div>
          </section>
        </dialog>
      </div>
    </main>
  );
};

export default DocumentsWorkspace;
