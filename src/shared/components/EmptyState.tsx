import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

export function EmptyState({
  icon: Icon,
  title,
  children,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <Icon
        size={40}
        strokeWidth={1.5}
        aria-hidden="true"
        className="text-[var(--sb-text-soft)]"
      />
      <h2 className="text-base font-semibold">{title}</h2>
      {children && (
        <div className="text-sm text-[var(--sb-text-soft)]">{children}</div>
      )}
    </div>
  );
}
