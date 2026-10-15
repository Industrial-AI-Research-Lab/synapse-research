import scss from "./headerNav.module.scss";

import { memo } from "react";

import { HEADER_NAVIGATION_ITEMS } from "../headerNavigation";
import HeaderItem from "../item/HeaderItem";
import HeaderNavBurger from "./burger/HeaderNavBurger";

const getIsActive = (href: string) =>
  window.location.pathname === href ||
  (href === "/researches" &&
    window.location.pathname.startsWith("/researches/"));

const HeaderNav = () => (
  <>
    <div className={scss.wrapNav}>
      <nav className={scss.nav} aria-label="Основная навигация">
        <ul className={scss.list}>
          {HEADER_NAVIGATION_ITEMS.map((item) => (
            <li key={item.href}>
              <HeaderItem item={item} isActive={getIsActive(item.href)} />
            </li>
          ))}
        </ul>
      </nav>
    </div>

    <HeaderNavBurger items={HEADER_NAVIGATION_ITEMS} />
  </>
);

export default memo(HeaderNav);
