import type { ReactNode } from "react";

export type SidebarIconName =
  "document" | "research" | "database" | "catalog" | "flask" | "clipboard";

const PATHS: Record<SidebarIconName, ReactNode> = {
  document: <path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6M9 16h6" />,
  research: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m16.2 7.8-2.4 6-6 2.4 2.4-6 6-2.4Z" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v7c0 4 16 4 16 0V5M4 12v7c0 4 16 4 16 0v-7" />
    </>
  ),
  catalog: (
    <path d="M12 5C9 3 5 3 3 4v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1v15" />
  ),
  flask: (
    <path d="M9 3h6M10 3v7l-6 9c-1 2 1 2 2 2h12c2 0 3 0 2-2l-6-9V3M7 16h10" />
  ),
  clipboard: (
    <>
      <path d="M9 5H5v16h14V5h-4M8 11h8M8 15h5" />
      <rect x="9" y="2" width="6" height="5" rx="1" />
    </>
  ),
};

const SidebarIcon = ({ name }: { name: SidebarIconName }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    {PATHS[name]}
  </svg>
);

export default SidebarIcon;
