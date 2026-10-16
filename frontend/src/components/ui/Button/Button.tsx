import scss from "./button.module.scss";

import type { ButtonHTMLAttributes, FC } from "react";
import Spinner from "../Spinner/Spinner";

interface IButton extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "text" | "icon" | "danger";
  isLoading?: boolean;
  loadingLabel?: string;
}

const Button: FC<IButton> = ({
  children,
  className,
  variant = "primary",
  isLoading = false,
  loadingLabel,
  disabled,
  ...props
}) => {
  const classNames = [scss.root, scss[variant], className]
    .filter(Boolean)
    .join(" ");
  const hasLoadingContent = isLoading || loadingLabel !== undefined;

  return (
    <button
      {...props}
      className={classNames}
      disabled={disabled || isLoading}
      aria-busy={isLoading || props["aria-busy"] || undefined}
      aria-label={
        isLoading && loadingLabel ? loadingLabel : props["aria-label"]
      }
    >
      {hasLoadingContent ? (
        <span className={scss.content}>
          <span className={scss.label} aria-hidden={isLoading}>
            {children}
          </span>
          <span className={scss.loading} aria-hidden={!isLoading}>
            <Spinner />
            {loadingLabel}
          </span>
        </span>
      ) : (
        children
      )}
    </button>
  );
};

export default Button;
