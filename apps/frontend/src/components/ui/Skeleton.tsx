import { cn } from '@/lib/utils';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn('skeleton', className)}
      role="status"
      aria-label="กำลังโหลด"
    />
  );
}
