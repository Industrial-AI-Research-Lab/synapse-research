import { type ComponentType, type CSSProperties, type FC, memo } from "react";

import ArrowLeftIcon from "./icons/ArrowLeft";
import ArrowRightIcon from "./icons/ArrowRight";
import AnalyticsReportIcon from "./icons/AnalyticsReport";
import CheckIcon from "./icons/Check";
import CloseIcon from "./icons/Close";
import CopyIcon from "./icons/Copy";
import DownloadIcon from "./icons/Download";
import ErrorIcon from "./icons/Error";
import ExternalLinkIcon from "./icons/ExternalLink";
import InfoIcon from "./icons/Info";
import PavLogoIcon from "./icons/PavLogo";
import QuestionIcon from "./icons/Question";
import ReloadIcon from "./icons/Reload";
import RemoveIcon from "./icons/Remove";
import SynapseResearchIcon from "./icons/SynapseResearch";
import UploadIcon from "./icons/Upload";
import WarningIcon from "./icons/Warning";

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
  | "info"
  | "pavLogo"
  | "question"
  | "reload"
  | "remove"
  | "synapseResearch"
  | "upload"
  | "warning";

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
  info: InfoIcon,
  pavLogo: PavLogoIcon,
  question: QuestionIcon,
  reload: ReloadIcon,
  remove: RemoveIcon,
  synapseResearch: SynapseResearchIcon,
  upload: UploadIcon,
  warning: WarningIcon,
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
