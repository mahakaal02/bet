import { cn } from "@/lib/utils";

type Tone = "default" | "live" | "upcoming" | "ended" | "winning" | "outbid";

const TONE_CLASS: Record<Tone, string> = {
  default:
    "bg-slate-800 text-slate-300 border-slate-700",
  live:
    "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  upcoming:
    "bg-cyan-500/15 text-cyan-300 border-cyan-500/30",
  ended:
    "bg-slate-800 text-slate-400 border-slate-700",
  winning:
    "bg-emerald-500/20 text-emerald-200 border-emerald-500/40",
  outbid:
    "bg-rose-500/15 text-rose-300 border-rose-500/30",
};

export function Badge({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        TONE_CLASS[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
