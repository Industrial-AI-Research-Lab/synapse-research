import { useEffect } from "react";
import type { RefObject } from "react";

export const useOutsideClick = <T extends HTMLElement>(
  ref: RefObject<T>,
  onOutsideClick: () => void,
  isEnabled = true,
) => {
  useEffect(() => {
    if (!isEnabled) return;

    let hasStartedOutside = false;

    const isOutside = (target: EventTarget | null) => {
      const element = ref.current;

      return Boolean(
        element && target instanceof Node && !element.contains(target),
      );
    };

    const handlePointerDown = (event: PointerEvent) => {
      hasStartedOutside = event.button === 0 && isOutside(event.target);
    };

    const handleClick = (event: MouseEvent) => {
      if (hasStartedOutside && isOutside(event.target)) {
        hasStartedOutside = false;
        onOutsideClick();
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("click", handleClick);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("click", handleClick);
    };
  }, [ref, onOutsideClick, isEnabled]);
};
