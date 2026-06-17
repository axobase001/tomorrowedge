import { createElement, type MouseEvent, type ReactNode, useEffect, useRef } from "react";

type ModalSurfaceProps = {
  backdropClassName: string;
  surfaceClassName: string;
  labelledBy: string;
  children: ReactNode;
  onDismiss: () => void;
  backdropTestId?: string;
  describedBy?: string;
  dismissOnBackdrop?: boolean;
  separateSurface?: boolean;
  surface?: "aside" | "section";
  surfaceTestId?: string;
};

export function ModalSurface({
  backdropClassName,
  surfaceClassName,
  labelledBy,
  children,
  onDismiss,
  backdropTestId,
  describedBy,
  dismissOnBackdrop = true,
  separateSurface = false,
  surface = "section",
  surfaceTestId
}: ModalSurfaceProps) {
  const surfaceRef = useRef<HTMLElement>(null);
  useModalFocus(surfaceRef, onDismiss);

  const surfaceProps = {
    "aria-describedby": describedBy,
    "aria-labelledby": labelledBy,
    "aria-modal": "true",
    className: surfaceClassName,
    "data-testid": surfaceTestId,
    onMouseDown: (event: MouseEvent<HTMLElement>) => event.stopPropagation(),
    ref: surfaceRef,
    role: "dialog",
    tabIndex: -1
  };

  const surfaceElement = createElement(surface, surfaceProps, children);
  const backdrop = (
    <div
      className={backdropClassName}
      data-testid={backdropTestId}
      onMouseDown={dismissOnBackdrop ? onDismiss : undefined}
      role="presentation"
    >
      {separateSurface ? null : surfaceElement}
    </div>
  );

  return separateSurface ? <>{backdrop}{surfaceElement}</> : backdrop;
}

function useModalFocus(containerRef: React.RefObject<HTMLElement>, onDismiss: () => void) {
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;

    const focusInitial = () => {
      const focusable = focusableElements(container);
      (focusable[0] ?? container).focus({ preventScroll: true });
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onDismissRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = focusableElements(container);
      if (!focusable.length) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (!container.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus({ preventScroll: true });
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus({ preventScroll: true });
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus({ preventScroll: true });
      }
    };

    focusInitial();
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      if (opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [containerRef]);
}

function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>([
    "a[href]",
    "button:not([disabled])",
    "textarea:not([disabled])",
    "input:not([disabled])",
    "select:not([disabled])",
    "[tabindex]:not([tabindex='-1'])"
  ].join(","))).filter((element) => !element.hasAttribute("hidden") && element.getAttribute("aria-hidden") !== "true");
}
