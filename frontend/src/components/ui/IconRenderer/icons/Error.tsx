import { memo, type FC, type SVGAttributes } from "react";

const ErrorIcon: FC<SVGAttributes<SVGElement>> = (props) => (
  <svg
    fill="none"
    height="100%"
    viewBox="0 0 24 24"
    width="100%"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
    <path
      d="M12 7.5v5M12 16h.01"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth="1.8"
    />
  </svg>
);

export default memo(ErrorIcon);
