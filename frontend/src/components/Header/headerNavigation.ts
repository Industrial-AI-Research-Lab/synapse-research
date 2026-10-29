export interface IHeaderNavigationItem {
  href: string;
  label: string;
}

export const HEADER_NAVIGATION_ITEMS: IHeaderNavigationItem[] = [
  {
    href: "/",
    label: "Доказательная база",
  },
  {
    href: "/documents",
    label: "Запрос",
  },
  {
    href: "/researches",
    label: "Исследования",
  },
  {
    href: "/sources",
    label: "Каталог источников",
  },
  {
    href: "/reviews",
    label: "Проверка опытов",
  },
  {
    href: "/quality",
    label: "Контроль ТЗ",
  },
];
