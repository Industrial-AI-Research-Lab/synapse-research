import scss from "./documentPreview.module.scss";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { JsonView as JsonViewComponent } from "react-json-view-lite";
import Button from "../ui/Button/Button";
import IconRenderer from "../ui/IconRenderer/IconRenderer";
import Loader from "../ui/Loader/Loader";
import {
  decodePreviewText,
  getJsonPreview,
  MAX_PREVIEW_BYTES,
} from "./documentPreview";
import type { DocumentPreviewSource } from "./documentPreview";

const shouldExpandNode = (level: number) => level === 0;

const JSON_STYLES = {
  container: scss.tree,
  basicChildStyle: scss.treeField,
  childFieldsContainer: scss.treeChildren,
  label: scss.treeLabel,
  clickableLabel: scss.treeLabel,
  nullValue: scss.treeLiteral,
  undefinedValue: scss.treeLiteral,
  numberValue: scss.treeLiteral,
  stringValue: scss.treeString,
  booleanValue: scss.treeLiteral,
  otherValue: scss.treeString,
  punctuation: scss.treePunctuation,
  expandIcon: scss.treeExpand,
  collapseIcon: scss.treeCollapse,
  collapsedContent: scss.treeCollapsed,
  ariaLables: { collapseJson: "Свернуть JSON", expandJson: "Развернуть JSON" },
};

const DocumentPreview = ({
  source,
  onClose,
}: {
  source: DocumentPreviewSource;
  onClose: () => void;
}) => {
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [revision, setRevision] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [blob, setBlob] = useState<Blob>();
  const [text, setText] = useState("");
  const [data, setData] = useState<object>();
  const [JsonView, setJsonView] = useState<typeof JsonViewComponent>();
  const [mode, setMode] = useState<"tree" | "raw">("raw");
  const [isTruncated, setIsTruncated] = useState(false);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const trigger = document.activeElement;
    const parentDialog = trigger?.closest("dialog");
    const overflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      dialog?.close();
      document.body.style.overflow = overflow;
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus({ preventScroll: true });
      else if (parentDialog?.open)
        parentDialog
          .querySelector<HTMLElement>(
            "button:not(:disabled), input:not(:disabled)",
          )
          ?.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setError("");
    setBlob(undefined);
    setData(undefined);
    setText("");
    setNotice("");
    setMode("raw");
    const load = async () => {
      try {
        const file = await source.load();
        if (!isActive) return;
        setBlob(file);
        const isPartial = file.size > MAX_PREVIEW_BYTES;
        const bytes = new Uint8Array(
          await file.slice(0, MAX_PREVIEW_BYTES).arrayBuffer(),
        );
        const content = decodePreviewText(bytes, isPartial);
        const parsed = isPartial
          ? {}
          : getJsonPreview(source.filename, content);
        let viewer: typeof JsonViewComponent | undefined;
        let viewerNotice = parsed.notice ?? "";
        if (parsed.data) {
          try {
            viewer = (await import("react-json-view-lite")).JsonView;
          } catch {
            viewerNotice =
              "Не удалось загрузить структуру JSON. Доступен исходный текст.";
          }
        }
        if (!isActive) return;
        setText(content);
        setData(viewer ? parsed.data : undefined);
        setJsonView(() => viewer);
        setIsTruncated(isPartial);
        setNotice(viewerNotice);
      } catch (failure) {
        if (isActive)
          setError(
            failure instanceof Error
              ? failure.message
              : "Не удалось открыть файл.",
          );
      } finally {
        if (isActive) setIsLoading(false);
      }
    };
    void load();
    return () => {
      isActive = false;
    };
  }, [source, revision]);

  const handleDownload = () => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = source.filename;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className={scss.root}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length);
        const first = controls[0],
          last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
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
        )
          onClose();
      }}
    >
      <div className={scss.layout}>
        <header className={scss.header}>
          <div className={scss.heading}>
            <h2 id={titleId}>{source.filename}</h2>
          </div>
          <Button
            className={scss.closeButton}
            variant="icon"
            type="button"
            aria-label="Закрыть просмотр"
            title="Закрыть просмотр"
            onClick={onClose}
          >
            <IconRenderer icon="close" />
          </Button>
        </header>
        {!isLoading && !error && data && (
          <div className={scss.toolbar}>
            <div className={scss.modes} aria-label="Представление JSON">
              <Button
                variant="text"
                type="button"
                aria-pressed={mode === "raw"}
                onClick={() => setMode("raw")}
              >
                Исходный текст
              </Button>
              <Button
                variant="text"
                type="button"
                aria-pressed={mode === "tree"}
                onClick={() => setMode("tree")}
              >
                Структура
              </Button>
            </div>
          </div>
        )}
        <div className={scss.content} aria-busy={isLoading}>
          {isLoading ? (
            <Loader variant="inline" label="Открываем файл…" />
          ) : error ? (
            <div className={scss.error} role="alert">
              <p>{error}</p>
              <Button
                variant="secondary"
                type="button"
                onClick={() => setRevision((value) => value + 1)}
              >
                Попробовать ещё раз
              </Button>
            </div>
          ) : (
            <>
              {notice && (
                <p className={scss.notice} role="status">
                  {notice}
                </p>
              )}
              {isTruncated && (
                <p className={scss.notice} role="status">
                  Показаны первые 5 МБ файла. Скачайте оригинал, чтобы прочитать
                  его целиком.
                </p>
              )}
              {!text ? (
                <p className={scss.notice}>Файл пуст.</p>
              ) : mode === "tree" && data && JsonView ? (
                <JsonView
                  data={data}
                  shouldExpandNode={shouldExpandNode}
                  style={JSON_STYLES}
                />
              ) : (
                <pre
                  className={scss.text}
                  tabIndex={0}
                  aria-label="Исходный текст файла"
                >
                  {text}
                </pre>
              )}
            </>
          )}
        </div>
        <footer className={scss.footer}>
          <span role="status" aria-live="polite">
            {blob
              ? `${new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(blob.size / 1024)} КБ`
              : ""}
          </span>
          <Button
            variant="secondary"
            type="button"
            disabled={!blob || isLoading}
            onClick={handleDownload}
          >
            <IconRenderer icon="download" />
            Скачать файл
          </Button>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
};

export default DocumentPreview;
