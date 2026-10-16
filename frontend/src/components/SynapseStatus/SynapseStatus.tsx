import scss from "./synapseStatus.module.scss";

import { useEffect, useId, useRef, useState } from "react";
import Button from "../ui/Button/Button";
import IconRenderer from "../ui/IconRenderer/IconRenderer";

import type { SynapseConfig } from "../../assets/types/evidence";

interface ISynapseStatus {
  config?: SynapseConfig;
  isLoading: boolean;
  hasError: boolean;
  onRefresh: () => void;
}

const getApprovalModeLabel = (approvalMode: string) => {
  if (approvalMode === "human") return "С подтверждением оператора";
  if (approvalMode === "auto") return "Автоматический режим";
  return approvalMode || "Режим запуска не указан";
};

const SynapseStatus = ({
  config,
  isLoading,
  hasError,
  onRefresh,
}: ISynapseStatus) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const detailsId = useId();
  const headingId = useId();
  const isConfigured = Boolean(config?.configured);
  const state = isLoading
    ? "loading"
    : hasError
      ? "error"
      : isConfigured
        ? "ready"
        : "warning";
  const title = isLoading
    ? "Проверяем Synapse"
    : hasError
      ? "Статус Synapse неизвестен"
      : isConfigured
        ? "Synapse настроен"
        : "Synapse не настроен";
  const description = isLoading
    ? "Запрашиваем состояние интеграции."
    : hasError
      ? "Не удалось получить состояние интеграции."
      : isConfigured
        ? "Выберите документы, задайте вопрос и запустите исследование."
        : "Внешнее исследование пока недоступно.";
  const detailsTitle =
    state === "ready"
      ? getApprovalModeLabel(config?.approval_mode ?? "")
      : title;
  const detailsDescription =
    state === "ready" && config?.approval_mode === "human"
      ? "Если исследованию потребуется подтверждение, запрос появится в разделе «Исследования». Там можно посмотреть детали и принять решение."
      : state === "ready" && config?.approval_mode === "auto"
        ? "Исследование выполняется автоматически. Результат и материалы появятся в разделе «Исследования»."
        : state === "warning"
          ? "Для подключения Synapse обратитесь к администратору команды."
          : description;

  const handleClose = () => {
    setIsExpanded(false);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (!isExpanded) return;

    const handleOutside = (event: PointerEvent | FocusEvent) => {
      if (
        event.target instanceof Node &&
        !rootRef.current?.contains(event.target)
      ) {
        setIsExpanded(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setIsExpanded(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("pointerdown", handleOutside);
    document.addEventListener("focusin", handleOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handleOutside);
      document.removeEventListener("focusin", handleOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isExpanded]);

  return (
    <aside
      ref={rootRef}
      className={`${scss.root} ${scss[state]}`}
      aria-label="Статус интеграции Synapse"
    >
      <div className={scss.summary}>
        <span className={scss.statusTitle}>
          <span className={scss.indicator} aria-hidden="true" />
          {title}
        </span>
        <span className={scss.description}>
          {state === "ready"
            ? getApprovalModeLabel(config?.approval_mode ?? "")
            : description}
        </span>
      </div>
      <button
        ref={triggerRef}
        className={scss.trigger}
        type="button"
        aria-expanded={isExpanded}
        aria-controls={detailsId}
        onClick={() => setIsExpanded((current) => !current)}
      >
        {state === "ready" ? "Как это работает?" : "Подробнее"}
      </button>
      <section
        className={scss.details}
        id={detailsId}
        aria-labelledby={headingId}
        hidden={!isExpanded}
      >
        <div className={scss.detailsHeader}>
          <h2 id={headingId}>{detailsTitle}</h2>
          <Button
            variant="icon"
            type="button"
            aria-label="Закрыть пояснение"
            onClick={handleClose}
          >
            <IconRenderer icon="close" />
          </Button>
        </div>
        <p>{detailsDescription}</p>
        {hasError && !isLoading && (
          <Button
            variant="secondary"
            className={scss.refreshButton}
            type="button"
            onClick={onRefresh}
          >
            Проверить ещё раз
          </Button>
        )}
      </section>
    </aside>
  );
};

export default SynapseStatus;
