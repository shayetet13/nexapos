'use client';

import React from 'react';
import Link from 'next/link';

interface UpgradeGateProps {
  /** Feature key to label the locked message */
  featureName: string;
  /** shopId to pre-fill the subscription link */
  shopId?: string | null;
  /** Show as an inline banner (default) or a full overlay */
  variant?: 'banner' | 'overlay';
  children?: React.ReactNode;
}

/**
 * Renders an "upgrade required" prompt.
 * Wrap a section in this component when `!hasFeature(key)`.
 *
 * @example
 * ```tsx
 * {!hasFeature('reports_advanced') ? (
 *   <UpgradeGate featureName="รายงานกำไร/ขาดทุน" shopId={shopId} />
 * ) : (
 *   <PnlReportContent />
 * )}
 * ```
 */
export function UpgradeGate({ featureName, shopId, variant = 'banner', children }: UpgradeGateProps) {
  const href = `/subscription${shopId ? `?shopId=${shopId}` : ''}`;

  if (variant === 'overlay') {
    return (
      <div className="upgrade-gate upgrade-gate--overlay">
        {children && <div className="upgrade-gate__blur">{children}</div>}
        <div className="upgrade-gate__badge">
          <span className="upgrade-gate__lock">🔒</span>
          <p className="upgrade-gate__title">ต้องการแผน Pro</p>
          <p className="upgrade-gate__desc">{featureName} ใช้ได้เฉพาะแผน Pro</p>
          <Link href={href} className="upgrade-gate__btn">Upgrade เป็น Pro</Link>
        </div>
      </div>
    );
  }

  // default: banner
  return (
    <div className="upgrade-gate upgrade-gate--banner">
      <span className="upgrade-gate__lock">🔒</span>
      <div className="upgrade-gate__info">
        <span className="upgrade-gate__title">{featureName}</span>
        <span className="upgrade-gate__desc">ฟีเจอร์นี้ต้องการแผน Pro</span>
      </div>
      <Link href={href} className="upgrade-gate__btn">Upgrade →</Link>
    </div>
  );
}
