import scss from "./sidebar.module.scss";

import Tooltip from "../ui/Tooltip/Tooltip";
import SidebarIcon from "./SidebarIcon";
import type { SidebarIconName } from "./SidebarIcon";

const ACTIVE_ITEMS: { href: string; label: string; icon: SidebarIconName }[] = [
  { href: "/documents", label: "Запрос", icon: "document" },
  { href: "/researches", label: "Исследования", icon: "research" },
  { href: "/library", label: "Источники", icon: "catalog" },
];

interface ISidebar {
  isExpanded: boolean;
  onToggle: () => void;
}

const Sidebar = ({ isExpanded, onToggle }: ISidebar) => {
  const pathname = window.location.pathname;
  const toggleLabel = isExpanded ? "Свернуть меню" : "Развернуть меню";

  return (
    <aside
      className={`${scss.root} ${isExpanded ? scss.expanded : ""}`}
      aria-label="Меню Doc Research"
    >
      <a
        className={scss.brand}
        href="/documents"
        aria-label="Doc Research — запрос"
      >
        <span className={scss.monogram} aria-hidden="true">
          D.R
        </span>
        <span className={scss.brandText} aria-hidden="true">
          <strong className={scss.brandTitle}>
            <span className={scss.brandName}>Doc</span>
            <span className={scss.brandDot}>.</span>
          </strong>
          <span className={scss.brandResearch}>Research</span>
        </span>
      </a>
      <button
        className={scss.toggle}
        type="button"
        onClick={onToggle}
        aria-label={toggleLabel}
        title={toggleLabel}
        aria-expanded={isExpanded}
        aria-controls="research-navigation"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M9 3v18" />
        </svg>
      </button>
      <nav
        id="research-navigation"
        aria-label="Основная навигация"
        className={scss.navigation}
      >
        <ul className={scss.list}>
          {ACTIVE_ITEMS.map((item) => {
            const isCurrentPage =
              pathname === item.href ||
              (item.href === "/documents" && pathname === "/");
            const isActive =
              item.href === "/documents"
                ? ["/", "/documents"].includes(pathname)
                : pathname === item.href ||
                  pathname.startsWith(`${item.href}/`);
            const link = (
              <a
                className={`${scss.item} ${isActive ? scss.active : ""}`}
                href={isCurrentPage ? undefined : item.href}
                role={isCurrentPage ? "link" : undefined}
                aria-disabled={isCurrentPage ? true : undefined}
                tabIndex={isCurrentPage ? -1 : undefined}
                aria-label={item.label}
                aria-current={isActive ? "page" : undefined}
              >
                <SidebarIcon name={item.icon} />
                <span className={scss.label}>{item.label}</span>
              </a>
            );
            return (
              <li key={item.href}>
                {isExpanded ? (
                  link
                ) : (
                  <Tooltip target={link} contentProps={{ side: "right" }}>
                    {item.label}
                  </Tooltip>
                )}
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
};

export default Sidebar;
