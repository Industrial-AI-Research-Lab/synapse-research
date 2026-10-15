import { memo, type FC, type SVGAttributes } from "react";

const CloseIcon: FC<SVGAttributes<SVGElement>> = (props) => (
  <svg
    fill="none"
    height="100%"
    viewBox="0 0 24 24"
    width="100%"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    {...props}
  >
    <path
      d="m6 6 12 12M18 6 6 18"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
  </svg>
);

export default memo(CloseIcon);
