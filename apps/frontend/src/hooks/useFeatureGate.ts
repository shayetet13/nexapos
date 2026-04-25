'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchWithAuth } from '@/lib/supabase';
import { API_URL } from '@/lib/config';

interface TrialInfo {
  is_trial:   boolean;
  ends_at:    string | null;
  days_left:  number | null;
  trial_days: number;
  is_expired: boolean;
}

interface FeatureGateState {
  features:     string[];
  planId:       string;
  planName:     string;
  loading:      boolean;
  isTrial:      boolean;
  trialDaysLeft: number | null;
  trialEndsAt:  string | null;
  trialExpired: boolean;
  hasFeature:   (key: string) => boolean;
}

const DEFAULT_STATE: FeatureGateState = {
  features:     [],
  planId:       'free',
  planName:     'ฟรี',
  loading:      true,
  isTrial:      false,
  trialDaysLeft: null,
  trialEndsAt:  null,
  trialExpired: false,
  hasFeature:   () => false,
};

interface SubResponse {
  data: {
    plan_config: { id: string; name: string; features: string[] };
    subscription: { status: string; expires_at: string | null } | null;
    trial: TrialInfo;
  };
}

export function useFeatureGate(shopId: string | null): FeatureGateState {
  const [features,      setFeatures]      = useState<string[]>([]);
  const [planId,        setPlanId]        = useState('free');
  const [planName,      setPlanName]      = useState('ฟรี');
  const [loading,       setLoading]       = useState(true);
  const [isTrial,       setIsTrial]       = useState(false);
  const [trialDaysLeft, setTrialDaysLeft] = useState<number | null>(null);
  const [trialEndsAt,   setTrialEndsAt]   = useState<string | null>(null);
  const [trialExpired,  setTrialExpired]  = useState(false);

  useEffect(() => {
    if (!shopId) { setLoading(false); return; }
    let cancelled = false;

    fetchWithAuth(`${API_URL}/api/v1/shops/${shopId}/subscription`)
      .then(async (res) => {
        if (!res.ok || cancelled) return;
        const json = (await res.json()) as SubResponse;
        if (cancelled) return;
        const cfg   = json.data?.plan_config;
        const trial = json.data?.trial;
        setFeatures(cfg?.features ?? []);
        setPlanId(cfg?.id ?? 'free');
        setPlanName(cfg?.name ?? 'ฟรี');
        if (trial) {
          setIsTrial(trial.is_trial);
          setTrialDaysLeft(trial.days_left);
          setTrialEndsAt(trial.ends_at);
          setTrialExpired(trial.is_expired);
        }
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [shopId]);

  const hasFeature = useCallback(
    (key: string) => features.includes(key),
    [features],
  );

  return { features, planId, planName, loading, isTrial, trialDaysLeft, trialEndsAt, trialExpired, hasFeature };
}
