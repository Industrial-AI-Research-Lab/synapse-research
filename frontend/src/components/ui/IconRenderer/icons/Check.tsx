import { memo, type FC, type SVGAttributes } from "react";

const CheckIcon: FC<SVGAttributes<SVGElement>> = (props) => (
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
      d="m7.5 12 3 3 6-6"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    />
    <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
  </svg>
);

export default memo(CheckIcon);
