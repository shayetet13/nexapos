import { Skeleton } from '@/components/ui/Skeleton';
import { AuthHeader } from '@/components/layout/AuthHeader';

export default function AdminLoading() {
  return (
    <main className="page-admin">
      <div className="page-admin__header-wrap">
        <AuthHeader title="จัดการร้าน" />
      </div>
      <div className="page-admin__content">
        <Skeleton className="h-8 w-48 mb-4" />
        <Skeleton className="h-10 w-full mb-2" />
        <Skeleton className="h-40 w-full" />
      </div>
    </main>
  );
}
