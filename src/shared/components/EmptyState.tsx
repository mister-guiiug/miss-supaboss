import type { ReactNode } from 'react';

export function EmptyState({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <span aria-hidden="true" className="text-4xl">
        {emoji}
      </span>
      <h2 className="text-base font-semibold">{title}</h2>
      {children && (
        <div className="text-sm text-[var(--sb-text-soft)]">{children}</div>
      )}
    </div>
  );
}
