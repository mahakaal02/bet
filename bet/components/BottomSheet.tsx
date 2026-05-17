"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  children: React.ReactNode;
  /** Optional cap on sheet height in viewport units. Default 88vh. */
  maxHeightVh?: number;
}

/**
 * Mobile-style sheet that slides up from the bottom. Dismiss via:
 *
 *   - Tap the backdrop
 *   - Press Escape
 *   - Tap the close button
 *   - Drag the grab-handle down past a threshold (touch only)
 *
 * Portals into <body> so parent overflow / transform contexts don't clip
 * it. Locks body scroll while open so the user doesn't scroll the page
 * underneath when flicking the sheet.
 */
export function BottomSheet({
  open,
  onClose,
  title,
  children,
  maxHeightVh = 88,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const dragStartY = useRef<number | null>(null);
  const [dragDelta, setDragDelta] = useState(0);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  // Reset drag state whenever the sheet opens.
  useEffect(() => {
    if (open) setDragDelta(0);
  }, [open]);

  if (!mounted) return null;

  function onTouchStart(e: React.TouchEvent) {
    dragStartY.current = e.touches[0]?.clientY ?? null;
  }
  function onTouchMove(e: React.TouchEvent) {
    if (dragStartY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - dragStartY.current;
    setDragDelta(Math.max(0, dy)); // upward drag does nothing
  }
  function onTouchEnd() {
    if (dragDelta > 100) onClose();
    setDragDelta(0);
    dragStartY.current = null;
  }

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end"
        >
          {/* Backdrop. Fades in/out independently of the sheet so the
              user sees the blur kick in before the sheet finishes its
              spring landing. */}
          <motion.button
            aria-label="Close sheet"
            onClick={onClose}
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          />

          {/* Sheet. Spring up from 100% off-screen. While the user drags
              the handle, dragDelta overrides the animation translateY for
              a 1:1 touch response. */}
          <motion.div
            className="relative w-full overflow-hidden rounded-t-2xl border border-slate-800 bg-slate-950 shadow-2xl"
            style={{ maxHeight: `${maxHeightVh}vh` }}
            initial={{ y: "100%" }}
            animate={{ y: dragDelta }}
            exit={{ y: "100%" }}
            transition={{
              type: "spring",
              stiffness: 380,
              damping: 36,
              mass: 0.8,
            }}
          >
        {/* Drag handle. Hit area is generous so a thumb can grab it. */}
        <div
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          className="flex cursor-grab justify-center py-2 active:cursor-grabbing"
        >
          <div className="h-1 w-10 rounded-full bg-slate-700" />
        </div>

        {/* Header */}
        {(title || true) && (
          <div className="flex items-center justify-between border-b border-slate-800 px-4 pb-3">
            <div className="text-sm font-bold text-slate-100">{title}</div>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Body. overflow-y-auto so long content scrolls inside the sheet,
            keeping the header visible. */}
        <div
          className="overflow-y-auto p-4"
          style={{
            // Leave room for the handle + header (~80px) under the max
            // height — body gets the rest. Plus iOS safe-area inset.
            maxHeight: `calc(${maxHeightVh}vh - 80px - env(safe-area-inset-bottom))`,
            paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
          }}
        >
          {children}
        </div>
        </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
