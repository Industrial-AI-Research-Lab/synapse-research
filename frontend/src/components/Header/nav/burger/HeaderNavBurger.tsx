import scss from "./headerNavBurger.module.scss";

import { memo, useCallback, useState } from "react";

import type { IHeaderNavigationItem } from "../../headerNavigation";
import HeaderItem from "../../item/HeaderItem";

interface IHeaderNavBurger {
  items: IHeaderNavigationItem[];
}

const HeaderNavBurger = ({ items }: IHeaderNavBurger) => {
  const [isOpen, setIsOpen] = useState(false);
  const handleToggle = useCallback(() => setIsOpen((current) => !current), []);
  const handleClose = useCallback(() => setIsOpen(false), []);

  return (
    <div className={scss.root}>
      <button
        className={scss.trigger}
        type="button"
        aria-expanded={isOpen}
        aria-controls="header-navigation-menu"
        aria-label={isOpen ? "Закрыть меню" : "Открыть меню"}
        onClick={handleToggle}
      >
        <span />
        <span />
        <span />
      </button>

      {isOpen && (
        <nav
          id="header-navigation-menu"
          className={scss.menuContent}
          aria-label="Основная навигация"
        >
          <ul className={scss.list}>
            {items.map((item) => (
              <li key={item.href}>
                <HeaderItem
                  item={item}
                  isActive={
                    window.location.pathname === item.href ||
                    (item.href === "/researches" &&
                      window.location.pathname.startsWith("/researches/"))
                  }
                  onClick={handleClose}
                />
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  );
};

export default memo(HeaderNavBurger);
