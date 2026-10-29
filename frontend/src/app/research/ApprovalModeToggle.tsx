import scss from "./approvalModeToggle.module.scss";

import IconRenderer from "../../components/ui/IconRenderer/IconRenderer";
import Tooltip from "../../components/ui/Tooltip/Tooltip";

interface IApprovalModeToggle {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

const AUTO_MODE_HINT =
  "Подтверждать шаги согласования без нажатия «Подтвердить и продолжить».";

const ApprovalModeToggle = ({
  id,
  checked,
  disabled = false,
  onChange,
}: IApprovalModeToggle) => {
  const hintId = `${id}-hint`;

  return (
    <div className={scss.root}>
      <Tooltip
        contentProps={{ side: "top", align: "start", sideOffset: 8 }}
        target={
          <button
            className={scss.hintButton}
            type="button"
            aria-label="Пояснение: Авторежим"
          >
            <IconRenderer icon="question" />
          </button>
        }
      >
        {AUTO_MODE_HINT}
      </Tooltip>
      <label className={scss.label} htmlFor={id}>
        Авторежим
      </label>
      <button
        id={id}
        className={scss.switch}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-describedby={hintId}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span className={scss.thumb} aria-hidden="true" />
      </button>
      <span id={hintId} className={scss.hint}>
        {AUTO_MODE_HINT}
      </span>
    </div>
  );
};

export default ApprovalModeToggle;
