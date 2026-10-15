import {
  type ComponentType,
  type CSSProperties,
  type FC,
  memo,
} from "react";

import ArrowLeftIcon from "./icons/ArrowLeft";
import ArrowRightIcon from "./icons/ArrowRight";
import AnalyticsReportIcon from "./icons/AnalyticsReport";
import CheckIcon from "./icons/Check";
import CloseIcon from "./icons/Close";
import CopyIcon from "./icons/Copy";
import DownloadIcon from "./icons/Download";
import ErrorIcon from "./icons/Error";
import ExternalLinkIcon from "./icons/ExternalLink";
import PavLogoIcon from "./icons/PavLogo";
import QuestionIcon from "./icons/Question";
import ReloadIcon from "./icons/Reload";
import RemoveIcon from "./icons/Remove";
import SynapseResearchIcon from "./icons/SynapseResearch";

export type IIconRendererTypes =
  | "analyticsReport"
  | "arrowLeft"
  | "arrowRight"
  | "check"
  | "close"
  | "copy"
  | "download"
  | "error"
  | "externalLink"
  | "pavLogo"
  | "question"
  | "reload"
  | "remove"
  | "synapseResearch";

export const ICONS_ENUM: Record<
  IIconRendererTypes,
  ComponentType<{ className?: string; style: CSSProperties }>
> = {
  analyticsReport: AnalyticsReportIcon,
  arrowLeft: ArrowLeftIcon,
  arrowRight: ArrowRightIcon,
  check: CheckIcon,
  close: CloseIcon,
  copy: CopyIcon,
  download: DownloadIcon,
  error: ErrorIcon,
  externalLink: ExternalLinkIcon,
  pavLogo: PavLogoIcon,
  question: QuestionIcon,
  reload: ReloadIcon,
  remove: RemoveIcon,
  synapseResearch: SynapseResearchIcon,
} as const;

const IconRenderer: FC<{
  icon: IIconRendererTypes;
  className?: string;
  style?: CSSProperties;
}> = ({ icon, className, style }) => {
  const Icon = ICONS_ENUM[icon];

  return <Icon className={className} style={{ ...style }} />;
};

export default memo(IconRenderer);
