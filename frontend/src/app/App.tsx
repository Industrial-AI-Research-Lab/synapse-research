import scss from "./app.module.scss";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { getSynapseConfig } from "../api/evidence";
import type { SynapseConfig } from "../assets/types/evidence";
import Header from "../components/Header/Header";
import SynapseStatus from "../components/SynapseStatus/SynapseStatus";
import EvidenceNavigator from "./evidence/EvidenceNavigator";
import DataCompleteness from "./evidence/DataCompleteness";
import SourceViewer from "./source/SourceViewer";
import QualityDashboard from "./quality/QualityDashboard";
import EvidenceReviewQueue from "./reviews/EvidenceReviewQueue";
import EvidenceExtractionForm from "./sources/EvidenceExtractionForm";
import SourcesCatalog from "./sources/SourcesCatalog";
import DocumentsWorkspace from "./documents/DocumentsWorkspace";
import ResearchHistory from "./research/ResearchHistory";
import ResearchDetail from "./research/ResearchDetail";

const App = () => {
  const [synapseConfig, setSynapseConfig] = useState<SynapseConfig>();
  const [isSynapseLoading, setIsSynapseLoading] = useState(true);
  const [hasSynapseError, setHasSynapseError] = useState(false);
  const sourceMatch = window.location.pathname.match(/^\/source\/([^/]+)$/);
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

  if (sourceMatch) {
    screen = <SourceViewer evidenceId={decodeURIComponent(sourceMatch[1])} />;
  } else if (researchMatch) {
    screen = (
      <ResearchDetail researchId={decodeURIComponent(researchMatch[1])} />
    );
  } else if (window.location.pathname === "/researches") {
    screen = <ResearchHistory />;
  } else if (window.location.pathname === "/documents") {
    screen = <DocumentsWorkspace />;
  } else if (window.location.pathname === "/completeness") {
    screen = <DataCompleteness />;
  } else if (window.location.pathname === "/quality") {
    screen = <QualityDashboard />;
  } else if (window.location.pathname === "/reviews") {
    screen = <EvidenceReviewQueue />;
  } else if (window.location.pathname === "/sources/extract") {
    screen = <EvidenceExtractionForm />;
  } else if (window.location.pathname === "/sources") {
    screen = <SourcesCatalog />;
  } else {
    screen = <EvidenceNavigator />;
  }

  return (
    <div className={scss.root}>
      <Header />
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
