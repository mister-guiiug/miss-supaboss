import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { StatusBadge } from './StatusBadge.tsx';

describe('StatusBadge', () => {
  it.each([
    ['ACTIVE_HEALTHY', 'Actif', 'active'],
    ['INACTIVE', 'En pause', 'paused'],
    ['RESTORING', 'Restauration…', 'transition'],
    ['RESTORE_FAILED', 'Échec de restauration', 'error'],
  ] as const)('%s → « %s » (groupe %s)', (status, label, group) => {
    render(<StatusBadge status={status} />);
    const badge = screen.getByTestId('status-badge');
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveAttribute('data-group', group);
  });
});
