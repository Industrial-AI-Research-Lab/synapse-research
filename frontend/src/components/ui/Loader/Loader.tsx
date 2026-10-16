import scss from "./loader.module.scss";

interface ILoader {
  label?: string;
  variant?: "page" | "inline" | "overlay";
}

const Loader = ({
  label = "Загружаем данные…",
  variant = "inline",
}: ILoader) => (
  <div
    className={`${scss.root} ${scss[variant]}`}
    role="status"
    aria-live="polite"
  >
    <div className={scss.synthesis} aria-hidden="true">
      <span className={scss.fragment} />
      <span className={`${scss.fragment} ${scss.fragmentMiddle}`} />
      <span className={`${scss.fragment} ${scss.fragmentLast}`} />
      <span className={scss.channel} />
      <span className={scss.answer}>
        <span />
        <span />
        <span />
        <span />
      </span>
    </div>
    <p>{label}</p>
  </div>
);

export default Loader;
