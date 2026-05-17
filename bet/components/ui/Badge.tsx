import { cn } from "@/lib/utils";

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "yes" | "no" | "warn" | "info";
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: "bg-slate-800 text-slate-300 border-slate-700",
    yes: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    no: "bg-rose-500/15 text-rose-300 border-rose-500/30",
    warn: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    info: "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}
