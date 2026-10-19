import scss from "./researchStatus.module.scss";

import type { ReactNode } from "react";
import { formatResearchStatus } from "./researchPresentation";

const SYMBOLS = {
  send: <path d="m22 2-7 20-4-9-9-4 20-7ZM22 2 11 13" />,
  play: <path d="m8 5 11 7-11 7V5Z" />,
  prepare: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" />
      <circle cx="15" cy="17" r="3" />
    </>
  ),
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M8 15l3 3 5-5" />
    </>
  ),
  question: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1.5 1-1.5 1-1.5 2M12 16h.01" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  error: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6M12 17h.01" />
    </>
  ),
  cancel: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m6 6 12 12" />
    </>
  ),
  close: <path d="m6 6 12 12M6 18 18 6" />,
  stop: <rect x="5" y="5" width="14" height="14" rx="1" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
} satisfies Record<string, ReactNode>;

type StatusAppearance = {
  tone: "info" | "success" | "warning" | "danger" | "neutral";
  symbol: keyof typeof SYMBOLS | "dot";
};

const getStatusAppearance = (status: string): StatusAppearance => {
  switch (status) {
    case "starting":
      return { tone: "info", symbol: "send" };
    case "started":
      return { tone: "info", symbol: "play" };
    case "initialized":
      return { tone: "info", symbol: "prepare" };
    case "running":
    case "in_progress":
      return { tone: "info", symbol: "dot" };
    case "output":
      return { tone: "info", symbol: "file" };
    case "awaiting_approval":
    case "start_unknown":
      return { tone: "warning", symbol: "question" };
    case "completed":
    case "done":
      return { tone: "success", symbol: "check" };
    case "failed":
    case "error":
      return { tone: "danger", symbol: "dot" };
    case "start_failed":
      return { tone: "danger", symbol: "error" };
    case "cancelled":
    case "canceled":
      return { tone: "neutral", symbol: "cancel" };
    case "rejected":
      return { tone: "neutral", symbol: "close" };
    case "stopped":
      return { tone: "neutral", symbol: "stop" };
    case "queued":
    case "pending":
      return { tone: "neutral", symbol: "clock" };
    default:
      return { tone: "neutral", symbol: "question" };
  }
};

const ResearchStatus = ({
  status,
  variant = "badge",
}: {
  status: string;
  variant?: "badge" | "summary";
}) => {
  const { tone, symbol } = getStatusAppearance(status);
  const isSummary = variant === "summary";
  const isFailed = status === "failed" || status === "error";
  const statusSymbol = isSummary && isFailed ? "error" : symbol;

  return (
    <span
      className={[scss.root, isSummary && scss.summary].filter(Boolean).join(" ")}
      data-status={status}
      data-tone={tone}
      role="status"
    >
      <span className={scss.symbol} key={status} aria-hidden="true">
        {statusSymbol === "dot" ? (
          <span className={scss.dot} />
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            focusable="false"
          >
            {SYMBOLS[statusSymbol]}
          </svg>
        )}
      </span>
      <span className={scss.label}>
        {isSummary && isFailed
          ? "Исследование завершилось с ошибкой"
          : formatResearchStatus(status)}
      </span>
    </span>
  );
};

export default ResearchStatus;
