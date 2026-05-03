'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

export interface Shop   { id: string; name: string; }
export interface Branch { id: string; name: string; is_active?: boolean; }

interface UseShopBranchOptions {
  /** If true, also fetches branches whenever shopId changes */
  fetchBranches?: boolean;
  /** Run on mount to load shops list automatically */
  autoLoad?: boolean;
}

interface UseShopBranchReturn {
  shops:       Shop[];
  shopId:      string;
  setShopId:   (id: string) => void;
  branches:    Branch[];
  branchId:    string;
  setBranchId: (id: string) => void;
  isLoading:   boolean;
  error:       string | null;
  reload:      () => void;
}

/**
 * Shared hook for shop + branch selection used across dashboard, reports, stock, admin, pos.
 * Eliminates the repeated "fetch /me/shops → select → fetch /shops/:id/branches" pattern.
 */
export function useShopBranch(options: UseShopBranchOptions = {}): UseShopBranchReturn {
  const { fetchBranches = true, autoLoad = true } = options;

  const [shops,     setShops]     = useState<Shop[]>([]);
  const [shopId,    setShopIdRaw] = useState<string>('');
  const [branches,  setBranches]  = useState<Branch[]>([]);
  const [branchId,  setBranchId]  = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [tick,      setTick]      = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Load shops list
  useEffect(() => {
    if (!autoLoad) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetchWithAuth(`${API_URL}/api/v1/me/shops`)
      .then(async (res) => {
        if (cancelled) return;
        if (!res.ok) { setError('โหลดข้อมูลร้านไม่สำเร็จ'); return; }
        const json = await res.json() as { data?: Shop[] };
        const list = json.data ?? [];
        setShops(list);
        if (list.length > 0) setShopIdRaw(list[0].id);
      })
      .catch(() => { if (!cancelled) setError('เชื่อมต่อไม่ได้'); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad, tick]);

  // Load branches when shopId changes
  useEffect(() => {
    if (!shopId || !fetchBranches) return;
    let cancelled = false;

    fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/branches`)
      .then(async (res) => {
        if (cancelled || !res.ok) return;
        const json = await res.json() as { data?: Branch[] };
        const list = json.data ?? [];
        setBranches(list);
        // Auto-select first active branch
        const first = list.find((b) => b.is_active !== false);
        if (first) setBranchId(first.id);
      })
      .catch(() => {/* silent */});

    return () => { cancelled = true; };
  }, [shopId, fetchBranches]);

  const setShopId = useCallback((id: string) => {
    setShopIdRaw(id);
    setBranches([]);
    setBranchId('');
  }, []);

  return { shops, shopId, setShopId, branches, branchId, setBranchId, isLoading, error, reload };
}
