import { Suspense } from 'react';
import { POSContent, POSPageSkeleton } from '@/components/pos/POSContent';

export default function POSPage() {
  return (
    <Suspense fallback={<POSPageSkeleton variant="retail" />}>
      <POSContent experience="retail" />
    </Suspense>
  );
}
