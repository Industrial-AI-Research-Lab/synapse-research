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
import { usePagination } from "../../assets/hooks/usePagination";

import {
  deleteDocument,
  getDocumentAccessCode,
  getDocumentAccessCodeAvailability,
  getDocumentFile,
  getDocuments,
  uploadDocument,
} from "../../api/documents";
import type {
  DocumentCitation,
  DocumentMetadata,
} from "../../assets/types/documents";
import Button from "../../components/ui/Button/Button";
import DocumentPreview from "../../components/DocumentPreview/DocumentPreview";
import { canPreviewFile } from "../../components/DocumentPreview/documentPreviewContent";
import type { DocumentPreviewSource } from "../../components/DocumentPreview/documentPreviewContent";
import Field from "../../components/ui/Field/Field";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import Input from "../../components/ui/Input/Input";
import Loader from "../../components/ui/Loader/Loader";
import Toast from "../../components/ui/Toast/Toast";
import ToastViewport from "../../components/ui/Toast/ToastViewport";
import ResearchPagination from "../research/ResearchPagination";
import { getTeamAccessToken, setTeamAccessToken } from "../../api/teamAccess";
import {
  DEFAULT_DOCUMENT_SORT,
  DOCUMENT_SORT_COLUMNS,
  MAX_SELECTED_DOCUMENTS,
  MIN_VISIBLE_LIST_ITEMS,
  SUPPORTED_DOCUMENT_ACCEPT,
  copyText,
  formatDate,
  formatDocumentType,
  formatDocumentUnits,
  formatFileSize,
  getDocumentExtension,
  getDocumentFileAction,
  getDocumentSortDirection,
  getDocumentSortField,
  getVisibleDocuments,
  isPdfFilename,
  toggleDocumentSort,
} from "./documentPresentation";
import type { DocumentSortId } from "./documentPresentation";
import {
  persistSelectedDocumentIds,
  reconcileSelectedDocumentIds,
} from "./selectedDocuments";

interface UploadNotification {
  title: string;
  description: string;
  variant: "success" | "error" | "info" | "warning";
  documentIds?: string[];
  layout?: "actionFooter";
}

const DELETION_PREVIEW_LIMIT = 8;

const formatDeletionPreview = (documents: DocumentMetadata[]) => {
  const visible = documents.slice(0, DELETION_PREVIEW_LIMIT);
  const hiddenCount = documents.length - visible.length;

  return { visible, hiddenCount };
};

const DocumentLibrary = () => {
  const [previewSource, setPreviewSource] = useState<DocumentPreviewSource>();
  const workspaceRef = useRef<HTMLElement>(null);
  const uploadDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogRef = useRef<HTMLDialogElement>(null);
  const deleteDialogContentRef = useRef<HTMLElement>(null);
  const isUploadInFlightRef = useRef(false);
  const documentSelectionPanelRef = useRef<HTMLElement>(null);
  const documentListRef = useRef<HTMLDivElement>(null);
  const documentPaginationRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentsRef = useRef<DocumentMetadata[]>([]);
  const [documents, setDocuments] = useState<DocumentMetadata[]>();
  const [documentSearch, setDocumentSearch] = useState("");
  const [documentSort, setDocumentSort] =
    useState<DocumentSortId>(DEFAULT_DOCUMENT_SORT);
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
  const [documentsError, setDocumentsError] = useState<string>();
  const [uploadError, setUploadError] = useState<{
    title: string;
    description: string;
  }>();
  const [uploadSuccess, setUploadSuccess] = useState<string>();
  const [selectionError, setSelectionError] = useState<string>();
  const [sourceError, setSourceError] = useState<string>();
  const [deletionNotification, setDeletionNotification] = useState<{
    title: string;
    description: string;
  }>();
  const [documentsPendingDeletion, setDocumentsPendingDeletion] = useState<
    DocumentMetadata[]
  >([]);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [isDocumentsLoading, setIsDocumentsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [openingSourceUrl, setOpeningSourceUrl] = useState("");
  const isOpeningSource = Boolean(openingSourceUrl);
  const [feedbackNotification, setFeedbackNotification] =
    useState<UploadNotification>();
  const [isDeletingDocument, setIsDeletingDocument] = useState(false);
  const [documentDeleteError, setDocumentDeleteError] = useState<string>();
  const listedDocuments = getVisibleDocuments(
    documents ?? [],
    documentSearch,
    documentSort,
  );
  const pagination = usePagination({
    items: documents === undefined ? undefined : listedDocuments,
    resetKey: `${documentSearch}:${documentSort}`,
  });
  const selectableDocuments = listedDocuments.slice(0, MAX_SELECTED_DOCUMENTS);
  const deletionPreview = formatDeletionPreview(documentsPendingDeletion);
  const isBulkDeletion = documentsPendingDeletion.length > 1;
  const deletionDescription = isBulkDeletion
    ? `Выбранные файлы (${documentsPendingDeletion.length}) будут удалены без возможности восстановления.`
    : `Файл «${documentsPendingDeletion[0]?.filename ?? ""}» будет удалён без возможности восстановления.`;
  const sortField = getDocumentSortField(documentSort);
  const sortDirection = getDocumentSortDirection(documentSort);

  const updateSelectedDocumentIds = (
    next: string[] | ((current: string[]) => string[]),
  ) => {
    setSelectedDocumentIds((current) => {
      const resolved = typeof next === "function" ? next(current) : next;
      persistSelectedDocumentIds(resolved);
      return resolved;
    });
  };

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

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  useLayoutEffect(() => {
    const workspace = workspaceRef.current;
    const panel = documentSelectionPanelRef.current;
    const list = documentListRef.current;
    const paginationFooter = documentPaginationRef.current;
    const rows = list?.querySelectorAll("tbody tr");

    if (!workspace || !panel || !list || !rows?.length) {
      return;
    }

    const updateListHeight = () => {
      const screen = workspace.parentElement!;
      const header = list.querySelector("thead");
      const firstItem = rows[0];
      const lastVisibleItem =
        rows[Math.min(MIN_VISIBLE_LIST_ITEMS, rows.length) - 1];
      const minimumHeight =
        (header?.getBoundingClientRect().height ?? 0) +
        lastVisibleItem.getBoundingClientRect().bottom -
        firstItem.getBoundingClientRect().top;
      const listBounds = list.getBoundingClientRect();
      const workspacePadding = parseFloat(
        getComputedStyle(workspace).paddingBottom,
      );
      const paginationHeight = paginationFooter
        ? paginationFooter.getBoundingClientRect().height + 12
        : 0;
      const availableHeight =
        screen.clientHeight -
        (listBounds.top -
          screen.getBoundingClientRect().top +
          screen.scrollTop) -
        workspacePadding -
        paginationHeight;

      list.style.setProperty(
        "--list-max-height",
        `${Math.max(minimumHeight, availableHeight)}px`,
      );
    };

    const observer = new ResizeObserver(updateListHeight);
    observer.observe(workspace);
    observer.observe(panel);
    observer.observe(list);
    if (paginationFooter) observer.observe(paginationFooter);
    updateListHeight();

    return () => observer.disconnect();
  }, [
    documents,
    documentsError,
    isUploading,
    listedDocuments.length,
    pagination.page,
    pagination.pageSize,
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

  useLayoutEffect(() => {
    const dialog = deleteDialogRef.current;

    if (!isDeleteDialogOpen || !dialog) return;

    const trigger = document.activeElement;
    dialog.showModal();

    return () => {
      dialog.close();
      const canRestoreFocus =
        trigger instanceof HTMLElement &&
        trigger.isConnected &&
        !trigger.hasAttribute("disabled");

      if (canRestoreFocus) {
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
      updateSelectedDocumentIds((current) =>
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

  const handleDocumentSelectionChange = (
    documentId: string,
    isSelected: boolean,
  ) => {
    setSelectionError(undefined);
    updateSelectedDocumentIds((current) => {
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
    updateSelectedDocumentIds(
      getVisibleDocuments(
        documentsRef.current,
        documentSearch,
        documentSort,
      )
        .slice(0, MAX_SELECTED_DOCUMENTS)
        .map((document) => document.id),
    );
  };

  const handleClearDocumentSelection = () => {
    setSelectionError(undefined);
    updateSelectedDocumentIds([]);
  };

  const openDeletionDialog = (documentsToDelete: DocumentMetadata[]) => {
    if (!documentsToDelete.length) return;

    setDeletionNotification(undefined);
    setDocumentDeleteError(undefined);
    setDocumentsPendingDeletion(documentsToDelete);
    setIsDeleteDialogOpen(true);
  };

  const handleDocumentDeleteRequest = (document: DocumentMetadata) => {
    openDeletionDialog([document]);
  };

  const handleSelectedDocumentsDeleteRequest = () => {
    const selectedIds = new Set(selectedDocumentIds);
    openDeletionDialog(
      documentsRef.current.filter((document) => selectedIds.has(document.id)),
    );
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
    if (
      !isDeleteDialogOpen ||
      !documentsPendingDeletion.length ||
      isDeletingDocument
    ) {
      return;
    }

    setDocumentDeleteError(undefined);
    setIsDeletingDocument(true);

    const deletedIds: string[] = [];
    const failedDocuments: Array<{ filename: string; message: string }> = [];

    for (const document of documentsPendingDeletion) {
      try {
        await deleteDocument(document.id, accessToken);
        deletedIds.push(document.id);
      } catch (error) {
        failedDocuments.push({
          filename: document.filename,
          message:
            error instanceof Error
              ? error.message
              : "Не удалось удалить документ.",
        });
      }
    }

    if (deletedIds.length) {
      const deletedIdSet = new Set(deletedIds);
      const nextDocuments = documentsRef.current.filter(
        (document) => !deletedIdSet.has(document.id),
      );

      documentsRef.current = nextDocuments;
      setDocuments(nextDocuments);
      updateSelectedDocumentIds((current) =>
        current.filter((documentId) => !deletedIdSet.has(documentId)),
      );
      setDocumentsPendingDeletion((current) =>
        current.filter((document) => !deletedIdSet.has(document.id)),
      );
    }

    if (failedDocuments.length) {
      const failedSummary =
        failedDocuments.length === 1
          ? `«${failedDocuments[0].filename}»: ${failedDocuments[0].message}`
          : `Не удалось удалить ${failedDocuments.length} из ${documentsPendingDeletion.length}. ${failedDocuments[0].message}`;

      setDocumentDeleteError(
        deletedIds.length
          ? `Удалено ${deletedIds.length} из ${documentsPendingDeletion.length}. ${failedSummary}`
          : failedSummary,
      );
    } else if (documentsPendingDeletion.length === 1) {
      setDeletionNotification({
        title: "Документ удалён",
        description: `«${documentsPendingDeletion[0].filename}»`,
      });
      setIsDeleteDialogOpen(false);
    } else {
      setDeletionNotification({
        title: "Документы удалены",
        description: `Удалено документов: ${documentsPendingDeletion.length}.`,
      });
      setIsDeleteDialogOpen(false);
    }

    setIsDeletingDocument(false);
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
        layout: "actionFooter",
        description:
          "Откройте «Добавить документы», чтобы продолжить загрузку.",
        variant: "info",
      });
    }
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
      layout={uploadNotification.layout}
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
            className={
              uploadNotification.layout === "actionFooter"
                ? scss.queueToastButton
                : undefined
            }
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
        <h1>Источники</h1>
      </header>

      <ToastViewport>
        {!isUploadDialogOpen && uploadToast}
        {!isUploadDialogOpen && feedbackToast}
        {deletionNotification && (
          <Toast
            title={deletionNotification.title}
            description={deletionNotification.description}
            onClose={() => setDeletionNotification(undefined)}
          />
        )}
      </ToastViewport>

      <div className={`${scss.content} ${scss.libraryContent}`}>
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
          <article
            ref={documentSelectionPanelRef}
            id="document-sources-panel"
            className={`${scss.documentPanel} ${scss.libraryPanel}`}
          >
            <div className={scss.libraryFilters}>
              <Field
                className={scss.searchFilter}
                label="Поиск"
                htmlFor="document-search"
              >
                <Input
                  id="document-search"
                  type="search"
                  value={documentSearch}
                  placeholder="Название файла"
                  autoComplete="off"
                  onChange={(event) => setDocumentSearch(event.target.value)}
                />
              </Field>
              <Button
                type="button"
                className={scss.uploadButton}
                variant="secondary"
                id="add-documents"
                data-toast-focus-return
                aria-label="Добавить документы"
                onClick={handleUploadDialogOpen}
              >
                <IconRenderer className={scss.uploadIcon} icon="download" />
                <span className={scss.uploadLabelFull} aria-hidden="true">
                  Добавить документы
                </span>
                <span className={scss.uploadLabelShort} aria-hidden="true">
                  Добавить
                </span>
              </Button>
            </div>

            <fieldset className={scss.documentSelection}>
              <legend className={scss.selectionLegend}>
                Документы для исследования
              </legend>
              <div className={scss.selectionToolbar}>
                <div className={scss.bulkSelectionActions}>
                  <button
                    className={scss.selectionButton}
                    type="button"
                    onClick={handleSelectAllDocuments}
                    disabled={
                      selectableDocuments.length === 0 ||
                      selectableDocuments.every((document) =>
                        selectedDocumentIds.includes(document.id),
                      )
                    }
                  >
                    {listedDocuments.length > MAX_SELECTED_DOCUMENTS
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
                  <button
                    id="delete-selected-documents"
                    className={`${scss.selectionButton} ${scss.selectionButtonDanger}`}
                    type="button"
                    onClick={handleSelectedDocumentsDeleteRequest}
                    disabled={!selectedDocumentIds.length || isDeletingDocument}
                  >
                    Удалить выбранное
                  </button>
                </div>
                <span
                  className={scss.selectionSummary}
                  aria-live="polite"
                  title={`До ${MAX_SELECTED_DOCUMENTS} файлов на запрос`}
                >
                  Выбрано {selectedDocumentIds.length} из {documents.length}
                </span>
              </div>
              {selectionError && (
                <p className={scss.selectionError} role="alert">
                  {selectionError}
                </p>
              )}
            </fieldset>
              {listedDocuments.length === 0 ? (
                <p className={scss.emptyFilter}>
                  Нет источников с таким названием.
                </p>
              ) : (
                <div ref={documentListRef} className={scss.documentTableWrap}>
                  <table className={scss.documentTable}>
                    <thead>
                      <tr>
                        <th className={scss.selectColumn} scope="col">
                          <span className={scss.srOnly}>Выбор</span>
                        </th>
                        {DOCUMENT_SORT_COLUMNS.map((column) => {
                          const isActive = sortField === column.field;
                          const columnClass =
                            column.field === "name"
                              ? scss.nameColumn
                              : column.field === "type"
                                ? scss.typeColumn
                                : column.field === "size"
                                  ? scss.sizeColumn
                                  : scss.uploadedColumn;

                          return (
                            <th
                              key={column.field}
                              className={columnClass}
                              scope="col"
                              aria-sort={
                                isActive
                                  ? sortDirection === "asc"
                                    ? "ascending"
                                    : "descending"
                                  : "none"
                              }
                            >
                              <button
                                type="button"
                                className={scss.sortButton}
                                aria-label={
                                  isActive
                                    ? `Сортировка: ${column.label}, ${
                                        sortDirection === "asc"
                                          ? "по возрастанию"
                                          : "по убыванию"
                                      }. Нажмите, чтобы изменить направление`
                                    : `Сортировать по полю «${column.label}»`
                                }
                                onClick={() =>
                                  setDocumentSort(
                                    toggleDocumentSort(
                                      documentSort,
                                      column.field,
                                    ),
                                  )
                                }
                              >
                                {column.label}
                                <span
                                  className={scss.sortIcon}
                                  data-direction={
                                    isActive ? sortDirection : "desc"
                                  }
                                  data-inactive={isActive ? undefined : "true"}
                                  aria-hidden="true"
                                >
                                  <IconRenderer icon="chevronRight" />
                                </span>
                              </button>
                            </th>
                          );
                        })}
                        <th className={scss.actionsColumn} scope="col">
                          Действия
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagination.items.map((document) => {
                        const checkboxId = `document-${document.id}`;
                        const fileAction = getDocumentFileAction(
                          document.filename,
                        );
                        const isSelected = selectedDocumentIds.includes(
                          document.id,
                        );
                        const documentUnits = formatDocumentUnits(document);

                        return (
                          <tr key={document.id} className={scss.documentItem}>
                            <td className={scss.selectColumn}>
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
                            </td>
                            <td className={scss.typeColumn}>
                              <span
                                className={scss.fileType}
                                data-format={getDocumentExtension(
                                  document.filename,
                                )}
                                title={
                                  formatDocumentType(document.filename) ||
                                  "файл"
                                }
                                aria-label={
                                  formatDocumentType(document.filename) ||
                                  "файл"
                                }
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
                                    {formatDocumentType(
                                      document.filename,
                                    ).slice(0, 4) || "?"}
                                  </text>
                                </svg>
                              </span>
                            </td>
                            <td className={scss.nameColumn}>
                              <label
                                className={scss.documentLabel}
                                htmlFor={checkboxId}
                              >
                                <strong title={document.filename}>
                                  {document.filename}
                                </strong>
                                {documentUnits && (
                                  <span className={scss.documentMeta}>
                                    {documentUnits}
                                  </span>
                                )}
                              </label>
                            </td>
                            <td className={scss.sizeColumn}>
                              {formatFileSize(document.sizeBytes)}
                            </td>
                            <td className={scss.uploadedColumn}>
                              <time dateTime={document.uploadedAt}>
                                {formatDate(document.uploadedAt)}
                              </time>
                            </td>
                            <td className={scss.actionsColumn}>
                              <div className={scss.documentFileActions}>
                                {canPreviewFile(document.filename) && (
                                  <Button
                                    className={`${scss.documentOpenButton} ${scss.documentPreviewButton}`}
                                    type="button"
                                    variant="icon"
                                    aria-label={`Просмотреть ${document.filename}`}
                                    title="Просмотреть файл"
                                    onClick={() =>
                                      setPreviewSource({
                                        filename: document.filename,
                                        load: () =>
                                          getDocumentFile(
                                            `/api/documents/${encodeURIComponent(document.id)}/file`,
                                            accessToken,
                                          ),
                                      })
                                    }
                                  >
                                    <IconRenderer icon="view" />
                                  </Button>
                                )}
                                <Button
                                  className={scss.documentOpenButton}
                                  type="button"
                                  variant="icon"
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
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            <div ref={documentPaginationRef} className={scss.libraryFooter}>
              {pagination.total > 0 && (
                <p
                  className={scss.libraryRange}
                  role="status"
                  aria-atomic="true"
                >
                  <span className={scss.srOnly}>Показаны источники </span>
                  {pagination.start}–{pagination.end} из {pagination.total}
                </p>
              )}
              {pagination.pageCount > 1 && (
                <div className={scss.libraryPagination}>
                  <ResearchPagination
                    page={pagination.page}
                    pageCount={pagination.pageCount}
                    pages={pagination.pages}
                    start={pagination.start}
                    end={pagination.end}
                    total={pagination.total}
                    onPageChange={pagination.setPage}
                    itemLabel="источники"
                    navLabel="Страницы источников"
                    showRange={false}
                    className={scss.libraryPaginationBar}
                  />
                </div>
              )}
              <Field
                className={scss.pageSizeFilter}
                label="На странице"
                htmlFor="document-page-size"
              >
                <select
                  id="document-page-size"
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
          </article>
        ) : (
          <section
            className={`${scss.emptyState} ${scss.emptyDocuments}`}
            aria-labelledby="library-empty"
          >
            <h2 id="library-empty">Сначала загрузите документы</h2>
            <p>
              Добавьте статью, выгрузку библиографической базы или техническую
              документацию в поддерживаемом формате.
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

        {sourceError && (
          <p className={scss.sourceError} role="alert">
            {sourceError}
          </p>
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
                        <div className={scss.selectedFileActions}>
                          {canPreviewFile(file.name, file.type) && (
                            <Button
                              className={scss.queuePreviewButton}
                              variant="icon"
                              type="button"
                              aria-label={`Просмотреть ${file.name}`}
                              title="Просмотреть файл"
                              onClick={() =>
                                setPreviewSource({
                                  filename: file.name,
                                  load: async () => file,
                                })
                              }
                            >
                              <IconRenderer icon="view" />
                            </Button>
                          )}
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
                        </div>
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
            <h2 id="delete-document-title">
              {isBulkDeletion ? "Удалить выбранное?" : "Удалить документ?"}
            </h2>
            <div id="delete-document-description">
              <p>{deletionDescription}</p>
              {isBulkDeletion && (
                <ul className={scss.confirmationList}>
                  {deletionPreview.visible.map((document) => (
                    <li key={document.id}>{document.filename}</li>
                  ))}
                  {deletionPreview.hiddenCount > 0 && (
                    <li>и ещё {deletionPreview.hiddenCount}</li>
                  )}
                </ul>
              )}
            </div>
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
                {isBulkDeletion ? "Удалить выбранное" : "Удалить"}
              </Button>
            </div>
          </section>
        </dialog>
        {previewSource && (
          <DocumentPreview
            source={previewSource}
            onClose={() => setPreviewSource(undefined)}
          />
        )}
      </div>
    </main>
  );
};

export default DocumentLibrary;
