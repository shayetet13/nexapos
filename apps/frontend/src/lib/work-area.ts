/**
 * Primary desk URL: retail uses /pos, full-service restaurants use /dining.
 * retail behavior must stay on /pos; restaurant default entry is /dining.
 */

export type ShopMode = 'retail' | 'full_service_restaurant';

/** Which path segment hosts the cashier / ordering UI for this shop mode. */
export function workAreaSegment(mode: ShopMode | null | undefined): 'pos' | 'dining' {
  return mode === 'full_service_restaurant' ? 'dining' : 'pos';
}

export function workAreaHref(params: {
  shopId: string;
  shopName: string;
  branchId: string;
  branchName: string;
  shopMode?: ShopMode | null;
}): string {
  const seg = workAreaSegment(params.shopMode ?? 'retail');
  const search = new URLSearchParams({
    shopId:     params.shopId,
    shopName:   params.shopName,
    branchId:   params.branchId,
    branchName: params.branchName,
  }).toString();
  return `/${seg}?${search}`;
}
