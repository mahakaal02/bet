import { forwardRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Standard input. Mobile-tax note: iOS Safari auto-zooms the entire
 * page when an input below 16px gains focus, and the zoom only releases
 * when the input is blurred or the page navigates. We therefore use
 * `text-base` (16px) on mobile and `sm:text-sm` (14px) at the tablet
 * breakpoint up — desktops are immune to the zoom behaviour so they can
 * keep the denser look.
 *
 * Wrapped in `forwardRef` so callers (notably the BidPanel) can `.blur()`
 * the input after a successful submit to release iOS's focus-zoom state.
 */
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          "h-10 w-full rounded-lg border border-slate-700 bg-slate-900/60 px-3 text-base sm:text-sm text-slate-100 placeholder:text-slate-500 outline-none focus-visible:border-cyan-400/60 focus-visible:ring-2 focus-visible:ring-cyan-400/30",
          className,
        )}
        {...props}
      />
    );
  },
);
