'use client';

import { cn } from '@/lib/utils';

interface StatBarProps {
  label: string;
  value: number;
  max?: number;
  color?: string;
  compact?: boolean;
}

export function StatBar({ label, value, max = 100, color, compact }: StatBarProps) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className={cn('w-full', compact ? 'space-y-0.5' : 'space-y-1.5')}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground uppercase tracking-wider">{label}</span>
        <span className="font-semibold tabular-nums text-foreground">{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div
          className={cn('h-full rounded-full transition-all duration-700 ease-out', color || 'bg-primary')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

interface HpBarProps {
  value: number;
  max?: number;
  className?: string;
  animate?: boolean;
}

export function HpBar({ value, max = 100, className, animate }: HpBarProps) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  const color = pct > 60 ? 'bg-success' : pct > 30 ? 'bg-warning' : 'bg-destructive';
  return (
    <div className={cn('h-2.5 w-full overflow-hidden rounded-full bg-secondary', className)}>
      <div
        className={cn('h-full rounded-full transition-all duration-500', color, animate && 'animate-pulse')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
