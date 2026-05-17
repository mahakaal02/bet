"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "@/lib/utils";

type Toast = { id: number; message: string; tone: "ok" | "err" | "info" };

const listeners = new Set<(t: Toast) => void>();

export function toast(message: string, tone: Toast["tone"] = "info") {
  const t: Toast = { id: Date.now() + Math.random(), message, tone };
  listeners.forEach((l) => l(t));
}

/**
 * Toast stack with proper enter / exit. Each toast slides up from below
 * the viewport on mount and slides back down on dismiss; the parent layout
 * animates the gap closed via `layout` so the remaining toasts settle
 * smoothly instead of jumping. AnimatePresence keeps exit animations alive
 * after React unmounts the element.
 */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const fn = (t: Toast) => {
      setToasts((cur) => [...cur, t]);
      setTimeout(() => {
        setToasts((cur) => cur.filter((x) => x.id !== t.id));
      }, 3500);
    };
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            layout
            initial={{ opacity: 0, y: 24, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.97 }}
            transition={{
              type: "spring",
              stiffness: 320,
              damping: 26,
              mass: 0.6,
            }}
            className={cn(
              "rounded-lg border px-4 py-2 text-sm shadow-lg backdrop-blur",
              t.tone === "ok" && "border-emerald-500/30 bg-emerald-500/10 text-emerald-200",
              t.tone === "err" && "border-rose-500/30 bg-rose-500/10 text-rose-200",
              t.tone === "info" && "border-cyan-500/30 bg-cyan-500/10 text-cyan-200",
            )}
          >
            {t.message}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
