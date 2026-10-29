import scss from "./header.module.scss";

import { memo } from "react";

import IconRenderer from "../ui/IconRenderer/IconRenderer";
import HeaderNav from "./nav/HeaderNav";

const Header = () => (
  <header className={scss.root}>
    <a
      className={scss.logoLink}
      href="/documents"
      aria-label="Doc Research — к запросу"
    >
      <IconRenderer className={scss.logo} icon="synapseResearch" />
      <span className={scss.logoText}>
        <strong>Doc</strong>
        <span>Research</span>
      </span>
    </a>

    <HeaderNav />
  </header>
);

export default memo(Header);
