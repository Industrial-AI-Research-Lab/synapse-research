import scss from "./toast.module.scss";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import Spinner from "../Spinner/Spinner";
import IconRenderer from "../IconRenderer/IconRenderer";

interface IToast {
  title: string;
  description: string;
  variant?: "success" | "error" | "info" | "warning";
  action?: ReactNode;
  layout?: "default" | "actionFooter";
  autoClose?: number | false;
  showProgress?: boolean;
  isLoading?: boolean;
  progress?: { completed: number; total: number };
  onClose: () => void;
}

interface IToastCountdown {
  duration: number;
  isPaused: boolean;
  showProgress: boolean;
  onClose: () => void;
}

const ToastCountdown = ({
  duration,
  isPaused,
  showProgress,
  onClose,
}: IToastCountdown) => {
  const remainingTime = useRef(duration);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isPaused) return;

    const startedAt = performance.now();
    const timeoutId = window.setTimeout(() => {
      onCloseRef.current();
    }, remainingTime.current);

    return () => {
      window.clearTimeout(timeoutId);
      remainingTime.current = Math.max(
        0,
        remainingTime.current - (performance.now() - startedAt),
      );
    };
  }, [isPaused]);

  if (!showProgress) return null;

  return (
    <div className={scss.progressTrack} aria-hidden="true">
      <div
        className={scss.progress}
        style={{
          animationDuration: `${duration}ms`,
          animationPlayState: isPaused ? "paused" : "running",
        }}
      />
    </div>
  );
};

const Toast = ({
  title,
  description,
  variant = "success",
  action,
  layout = "default",
  autoClose,
  showProgress = true,
  isLoading = false,
  progress,
  onClose,
}: IToast) => {
  const rootRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef(document.activeElement);
  const closeTimeoutRef = useRef<number>();
  const [isClosing, setIsClosing] = useState(false);
  const closeDelay = window.matchMedia("(prefers-reduced-motion: reduce)")
    .matches
    ? 0
    : 120;
  const timeout =
    autoClose ?? (variant === "success" && !action ? 5_000 : false);
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isPageHidden, setIsPageHidden] = useState(document.hidden);
  const hasAutoClose =
    !isLoading &&
    typeof timeout === "number" &&
    Number.isFinite(timeout) &&
    timeout > 0;
  const duration = hasAutoClose
    ? Math.min(timeout as number, 2_147_483_647)
    : 0;
  const lifetimeKey = JSON.stringify([
    title,
    variant,
    isLoading ? null : description,
  ]);

  useEffect(() => {
    const handleVisibilityChange = () => setIsPageHidden(document.hidden);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    setIsClosing(false);
    closeTimeoutRef.current = undefined;
    return () => window.clearTimeout(closeTimeoutRef.current);
  }, [lifetimeKey]);

  const handleClose = () => {
    if (closeTimeoutRef.current !== undefined) return;
    setIsClosing(true);
    closeTimeoutRef.current = window.setTimeout(() => {
      if (rootRef.current?.contains(document.activeElement)) {
        const previous = returnFocusRef.current;
        const dialog = rootRef.current.closest("dialog[open]");
        const target =
          previous instanceof HTMLElement &&
          previous.isConnected &&
          previous !== document.body &&
          previous.getClientRects().length > 0 &&
          !previous.matches(":disabled") &&
          (!dialog || dialog.contains(previous))
            ? previous
            : (dialog?.querySelector<HTMLElement>(
                "button:not(:disabled):not([aria-label^='Закрыть уведомление'])",
              ) ??
              document.querySelector<HTMLElement>("[data-toast-focus-return]"));
        target?.focus();
      }
      onClose();
      closeTimeoutRef.current = undefined;
    }, closeDelay);
  };

  return (
    <section
      ref={rootRef}
      className={`${scss.root} ${scss[variant]} ${layout === "actionFooter" ? scss.actionFooter : ""} ${isClosing ? scss.closing : ""}`}
      role={variant === "error" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocusCapture={() => setHasFocus(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setHasFocus(false);
        }
      }}
    >
      <span className={scss.statusIcon} aria-hidden="true">
        {isLoading ? (
          <Spinner />
        ) : variant === "success" ? (
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path
              d="m5 12 4 4 10-10"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <IconRenderer icon={variant} />
        )}
      </span>
      <div className={scss.content}>
        <p className={scss.title}>{title}</p>
        <p className={scss.description}>{description}</p>
        {action && layout === "default" && (
          <div className={scss.action}>{action}</div>
        )}
        {progress && progress.total > 0 && (
          <div className={scss.uploadProgress} aria-hidden="true">
            <span
              style={{
                transform: `scaleX(${Math.min(1, Math.max(0, progress.completed / progress.total))})`,
              }}
            />
          </div>
        )}
      </div>
      {action && layout === "actionFooter" && (
        <div className={scss.footerAction}>{action}</div>
      )}
      <button
        className={scss.closeButton}
        type="button"
        onClick={handleClose}
        aria-label={`Закрыть уведомление: ${title}`}
      >
        <IconRenderer icon="close" />
      </button>
      {hasAutoClose && (
        <ToastCountdown
          key={JSON.stringify([lifetimeKey, duration])}
          duration={duration}
          isPaused={isHovered || hasFocus || isPageHidden}
          showProgress={showProgress}
          onClose={handleClose}
        />
      )}
    </section>
  );
};

export default Toast;
