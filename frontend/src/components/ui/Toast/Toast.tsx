import scss from "./toast.module.scss";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import IconRenderer from "../IconRenderer/IconRenderer";

interface IToast {
  title: string;
  description: string;
  variant?: "success" | "error" | "info";
  action?: ReactNode;
  autoClose?: number | false;
  showProgress?: boolean;
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
  autoClose = 5_000,
  showProgress = true,
  onClose,
}: IToast) => {
  const [isHovered, setIsHovered] = useState(false);
  const [hasFocus, setHasFocus] = useState(false);
  const [isPageHidden, setIsPageHidden] = useState(document.hidden);
  const hasAutoClose =
    typeof autoClose === "number" &&
    Number.isFinite(autoClose) &&
    autoClose > 0;
  const duration = hasAutoClose ? Math.min(autoClose, 2_147_483_647) : 0;

  useEffect(() => {
    const handleVisibilityChange = () => setIsPageHidden(document.hidden);

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <section
      className={`${scss.root} ${scss[variant]}`}
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
        <IconRenderer
          icon={
            variant === "error"
              ? "error"
              : variant === "info"
                ? "info"
                : "check"
          }
        />
      </span>
      <div className={scss.content}>
        <p className={scss.title}>{title}</p>
        <p className={scss.description}>{description}</p>
        {action && <div className={scss.action}>{action}</div>}
      </div>
      <button
        className={scss.closeButton}
        type="button"
        onClick={onClose}
        aria-label={`Закрыть уведомление: ${title}`}
      >
        <IconRenderer icon="close" />
      </button>
      {hasAutoClose && (
        <ToastCountdown
          key={JSON.stringify([title, description, duration, showProgress])}
          duration={duration}
          isPaused={isHovered || hasFocus || isPageHidden}
          showProgress={showProgress}
          onClose={onClose}
        />
      )}
    </section>
  );
};

export default Toast;
