import { useState } from "react";

export type PaginationPage = number | "start-ellipsis" | "end-ellipsis";

interface PaginationOptions<T> {
  items: readonly T[] | undefined;
  initialPage?: number;
  initialPageSize?: number;
  resetKey?: string;
}

const positiveInteger = (value: number, fallback: number) =>
  Number.isSafeInteger(value) && value > 0 ? value : fallback;

const getPages = (page: number, pageCount: number): PaginationPage[] => {
  if (pageCount <= 5) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }

  const adjacentPage = page < pageCount ? page + 1 : page - 1;
  const visible = [...new Set([1, page, adjacentPage, pageCount])].sort(
    (left, right) => left - right,
  );
  const pages: PaginationPage[] = [];

  visible.forEach((number, index) => {
    if (index > 0 && number - visible[index - 1] > 1) {
      pages.push(index === 1 ? "start-ellipsis" : "end-ellipsis");
    }
    pages.push(number);
  });

  return pages;
};

export const usePagination = <T,>({
  items,
  initialPage = 1,
  initialPageSize = 10,
  resetKey = "",
}: PaginationOptions<T>) => {
  const [state, setState] = useState(() => ({
    page: positiveInteger(initialPage, 1),
    pageSize: positiveInteger(initialPageSize, 10),
    resetKey,
  }));
  const total = items?.length ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / state.pageSize));
  const page =
    state.resetKey !== resetKey
      ? 1
      : items === undefined
        ? state.page
        : Math.min(state.page, pageCount);

  if (state.page !== page || state.resetKey !== resetKey) {
    setState({ ...state, page, resetKey });
  }

  const setPage = (value: number) => {
    setState((current) => ({
      ...current,
      page: Math.min(positiveInteger(value, 1), pageCount),
    }));
  };

  const setPageSize = (value: number) => {
    setState((current) => ({
      ...current,
      page: 1,
      pageSize: positiveInteger(value, current.pageSize),
    }));
  };

  const startIndex = (page - 1) * state.pageSize;

  return {
    page,
    pageSize: state.pageSize,
    pageCount,
    pages: getPages(page, items === undefined ? page : pageCount),
    items: items?.slice(startIndex, startIndex + state.pageSize) ?? [],
    total,
    start: total === 0 ? 0 : startIndex + 1,
    end: Math.min(startIndex + state.pageSize, total),
    setPage,
    setPageSize,
  };
};
