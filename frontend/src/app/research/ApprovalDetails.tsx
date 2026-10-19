import scss from "./approvalDetails.module.scss";

import { useEffect, useRef, useState } from "react";
import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import Tooltip from "../../components/ui/Tooltip/Tooltip";

const formatDetails = (details: unknown) => {
  if (typeof details === "string") {
    try {
      return {
        text: JSON.stringify(JSON.parse(details), null, 2),
        isJson: true,
      };
    } catch {
      return { text: details, isJson: false };
    }
  }
  return { text: JSON.stringify(details, null, 2) ?? "", isJson: true };
};

const highlightJson = (text: string) => {
  const tokens = text.split(
    /("(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g,
  );
  return tokens.map((token, index) => {
    if (index % 2 === 0) return token;
    const isKey = token.startsWith('"') && /^\s*:/.test(tokens[index + 1]);
    return (
      <span className={isKey ? scss.key : scss.value} key={index}>
        {token}
      </span>
    );
  });
};

const ApprovalDetails = ({ details }: { details: unknown }) => {
  const { text, isJson } = formatDetails(details);
  const [copyStatus, setCopyStatus] = useState("");
  const [isCopying, setIsCopying] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const requestRef = useRef(0);
  const isCopyingRef = useRef(false);

  useEffect(() => {
    setCopyStatus("");
    setIsCopying(false);
    isCopyingRef.current = false;
    return () => {
      requestRef.current += 1;
      clearTimeout(timerRef.current);
    };
  }, [text]);

  const handleCopy = async () => {
    if (isCopyingRef.current) return;
    isCopyingRef.current = true;
    const request = ++requestRef.current;
    clearTimeout(timerRef.current);
    setIsCopying(true);
    setCopyStatus("");
    try {
      await navigator.clipboard.writeText(text);
      if (request !== requestRef.current) return;
      setCopyStatus("Скопировано");
    } catch {
      if (request !== requestRef.current) return;
      setCopyStatus("Не удалось скопировать");
    } finally {
      if (request === requestRef.current) {
        isCopyingRef.current = false;
        setIsCopying(false);
        timerRef.current = setTimeout(() => setCopyStatus(""), 2200);
      }
    }
  };

  const isCopied = copyStatus === "Скопировано";
  const copyLabel = isJson ? "Скопировать JSON" : "Скопировать текст";

  return (
    <div className={scss.root}>
      <div className={scss.toolbar}>
        <span>{isJson ? "JSON" : "Текст"}</span>
        <div className={scss.copyGroup}>
          <span
            className={
              copyStatus && !isCopied ? scss.copyError : scss.copyStatus
            }
            role="status"
            aria-live="polite"
          >
            {copyStatus}
          </span>
          <Tooltip
            target={
              <button
                type="button"
                className={scss.copyButton}
                aria-label={copyLabel}
                aria-busy={isCopying}
                onClick={(event) => {
                  event.preventDefault();
                  void handleCopy();
                }}
              >
                <IconRenderer icon={isCopied ? "check" : "copy"} />
              </button>
            }
          >
            {copyLabel}
          </Tooltip>
        </div>
      </div>
      <pre className={scss.code}>
        <code>{isJson ? highlightJson(text) : text}</code>
      </pre>
    </div>
  );
};

export default ApprovalDetails;
