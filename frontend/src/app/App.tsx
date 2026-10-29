import scss from "./app.module.scss";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { getSynapseConfig } from "../api/evidence";
import type { SynapseConfig } from "../assets/types/evidence";
import Sidebar from "../components/Sidebar/Sidebar";
import SynapseStatus from "../components/SynapseStatus/SynapseStatus";
import DisabledPage from "./disabled/DisabledPage";
import DocumentLibrary from "./documents/DocumentLibrary";
import DocumentsWorkspace from "./documents/DocumentsWorkspace";
import ResearchHistory from "./research/ResearchHistory";
import ResearchDetail from "./research/ResearchDetail";

const App = () => {
  const [isNavExpanded, setIsNavExpanded] = useState(() => {
    try {
      return localStorage.getItem("folio.sidebar.expanded") === "true";
    } catch {
      return false;
    }
  });
  const [synapseConfig, setSynapseConfig] = useState<SynapseConfig>();
  const [isSynapseLoading, setIsSynapseLoading] = useState(true);
  const [hasSynapseError, setHasSynapseError] = useState(false);
  const researchMatch = window.location.pathname.match(
    /^\/researches\/([^/]+)$/,
  );
  let screen: ReactNode;

  const loadSynapseConfig = async () => {
    setIsSynapseLoading(true);
    setHasSynapseError(false);

    try {
      setSynapseConfig(await getSynapseConfig());
    } catch {
      setHasSynapseError(true);
    } finally {
      setIsSynapseLoading(false);
    }
  };

  useEffect(() => {
    void loadSynapseConfig();
  }, []);

  if (researchMatch) {
    screen = (
      <ResearchDetail researchId={decodeURIComponent(researchMatch[1])} />
    );
  } else if (window.location.pathname === "/researches") {
    screen = <ResearchHistory />;
  } else if (["/documents", "/"].includes(window.location.pathname)) {
    screen = <DocumentsWorkspace />;
  } else if (window.location.pathname === "/library") {
    screen = <DocumentLibrary />;
  } else {
    screen = <DisabledPage />;
  }

  const handleNavigationToggle = () => {
    setIsNavExpanded((current) => {
      const next = !current;
      try {
        localStorage.setItem("folio.sidebar.expanded", String(next));
      } catch {
        // Navigation remains usable when the browser blocks local storage.
      }
      return next;
    });
  };

  return (
    <div className={`${scss.root} ${isNavExpanded ? scss.expanded : ""}`}>
      <Sidebar isExpanded={isNavExpanded} onToggle={handleNavigationToggle} />
      <div className={scss.screen}>{screen}</div>
      <SynapseStatus
        config={synapseConfig}
        isLoading={isSynapseLoading}
        hasError={hasSynapseError}
        onRefresh={() => void loadSynapseConfig()}
      />
    </div>
  );
};

export default App;
