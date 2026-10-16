import scss from "./toastViewport.module.scss";

import type { ReactNode } from "react";

const ToastViewport = ({ children }: { children: ReactNode }) => (
  <div className={scss.root}>{children}</div>
);

export default ToastViewport;
