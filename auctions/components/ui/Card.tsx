import { cn } from "@/lib/utils";

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--color-divider)] bg-[var(--color-surface)]/60 p-4",
        className,
      )}
      {...props}
    />
  );
}
