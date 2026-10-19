import scss from "./researchError.module.scss";

import { useRef, useState, type ReactNode } from "react";
import Button from "../../components/ui/Button/Button";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import { parseSynapseError } from "./researchError";

interface IResearchError {
  error: string;
  title: string;
  description?: string;
  researchId?: string;
  projectId?: string;
  isSynapseError?: boolean;
  children?: ReactNode;
}

const ResearchError = ({
  error,
  title,
  description,
  researchId,
  projectId,
  isSynapseError = false,
  children,
}: IResearchError) => {
  const details = parseSynapseError(error);
  const hasSynapseResponse = Boolean(details.httpStatus);
  const [copyStatus, setCopyStatus] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const diagnostics = [
    error,
    researchId ? `ID исследования: ${researchId}` : "",
    projectId ? `ID проекта Synapse: ${projectId}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const handleCopy = async () => {
    if (copyStatus === "copying") return;
    setCopyStatus("copying");
    try {
      await navigator.clipboard.writeText(diagnostics);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
      if (detailsRef.current) detailsRef.current.open = true;
    }
  };

  return (
    <section className={scss.root} aria-label={title} role="alert">
      <header className={scss.header}>
        <div className={scss.status}>
          <span className={scss.statusIcon} aria-hidden="true">
            <IconRenderer icon="error" />
          </span>
          <span>
            {hasSynapseResponse || isSynapseError
              ? "Ошибка сервиса Synapse"
              : "Ошибка действия"}
          </span>
          {details.httpStatus && (
            <span className={scss.httpStatus}>HTTP {details.httpStatus}</span>
          )}
        </div>
        <h2>{title}</h2>
        {description && <p className={scss.description}>{description}</p>}
      </header>
      <div className={scss.body}>
        <p className={scss.messageLabel}>
          {hasSynapseResponse || isSynapseError
            ? "Ответ Synapse"
            : "Сообщение об ошибке"}
        </p>
        <p className={scss.message}>
          {details.message || "Подробное сообщение отсутствует."}
        </p>
        <div className={scss.actions}>
          <Button
            type="button"
            variant={copyStatus === "copied" ? "primary" : "secondary"}
            isLoading={copyStatus === "copying"}
            loadingLabel="Копируем…"
            onClick={() => void handleCopy()}
          >
            <span className={scss.actionIcon} aria-hidden="true">
              <IconRenderer icon={copyStatus === "copied" ? "check" : "copy"} />
            </span>
            <span className={scss.copyLabel}>
              <span className={scss.copyLabelMeasure} aria-hidden="true">
                Скопировать ошибку
              </span>
              <span>
                {copyStatus === "copied" ? "Скопировано" : "Скопировать ошибку"}
              </span>
            </span>
          </Button>
          {children}
        </div>
        <p className={scss.copyStatus} role="status">
          {copyStatus === "copied"
            ? "Подробности ошибки скопированы."
            : copyStatus === "failed"
              ? "Не удалось скопировать автоматически. Выделите текст в технических подробностях и скопируйте его."
              : ""}
        </p>
        <details className={scss.details} ref={detailsRef}>
          <summary>Технические подробности</summary>
          <dl className={scss.metadata}>
            {details.path && (
              <div>
                <dt>Операция</dt>
                <dd>
                  <code>
                    {details.method} {details.path}
                  </code>
                </dd>
              </div>
            )}
            {details.httpStatus && (
              <div>
                <dt>HTTP-код</dt>
                <dd>
                  <code>{details.httpStatus}</code>
                </dd>
              </div>
            )}
            {details.code && (
              <div>
                <dt>Код ошибки</dt>
                <dd>
                  <code>{details.code}</code>
                </dd>
              </div>
            )}
            {researchId && (
              <div>
                <dt>ID исследования</dt>
                <dd>
                  <code>{researchId}</code>
                </dd>
              </div>
            )}
            {projectId && (
              <div>
                <dt>ID проекта Synapse</dt>
                <dd>
                  <code>{projectId}</code>
                </dd>
              </div>
            )}
          </dl>
          <p className={scss.messageLabel}>Полное сообщение</p>
          <pre className={scss.rawMessage}>{error}</pre>
        </details>
      </div>
    </section>
  );
};

export default ResearchError;
