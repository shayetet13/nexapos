import { describe, it, expect } from 'vitest';
import { crc16Ccitt, verifyPromptPayPayload } from '../lib/promptpay-qr.js';

// ตัวสร้างเดียวกับของ platform (services/linebot-platform/apps/api/src/promptpay.ts) เพื่อเทียบรูปแบบ
function tag(id: string, value: string): string {
  return `${id}${String(value.length).padStart(2, '0')}${value}`;
}
function build(subTag: string, target: string, amount: string, extra = ''): string {
  const body = tag('00', '01') + tag('01', '12')
    + tag('29', tag('00', 'A000000677010111') + tag(subTag, target) + extra)
    + tag('53', '764') + tag('54', amount) + tag('58', 'TH') + '6304';
  return body + crc16Ccitt(body);
}

const PHONE = { type: 'phone' as const, promptPayId: '0812345678', amountSatang: 12_550 };
const PHONE_QR = build('01', '0066812345678', '125.50');

describe('verifyPromptPayPayload', () => {
  it('accepts the payload the platform builds for the shop phone and amount', () => {
    expect(verifyPromptPayPayload(PHONE_QR, PHONE)).toBe(true);
  });

  it('accepts national id and e-wallet targets', () => {
    expect(verifyPromptPayPayload(build('02', '1234567890123', '10.00'),
      { type: 'national_id', promptPayId: '1234567890123', amountSatang: 1000 })).toBe(true);
    expect(verifyPromptPayPayload(build('03', '123456789012345', '0.50'),
      { type: 'ewallet', promptPayId: '123456789012345', amountSatang: 50 })).toBe(true);
  });

  it('rejects a payload that pays a different account', () => {
    expect(verifyPromptPayPayload(build('01', '0066899999999', '125.50'), PHONE)).toBe(false);
  });

  it('rejects a different amount', () => {
    expect(verifyPromptPayPayload(build('01', '0066812345678', '125.51'), PHONE)).toBe(false);
    expect(verifyPromptPayPayload(PHONE_QR, { ...PHONE, amountSatang: 12_500 })).toBe(false);
  });

  it('rejects a corrupted CRC', () => {
    const bad = PHONE_QR.slice(0, -4) + (PHONE_QR.endsWith('0000') ? '1111' : '0000');
    expect(verifyPromptPayPayload(bad, PHONE)).toBe(false);
  });

  it('rejects a tampered body even if the CRC is recomputed over a different account', () => {
    // ผู้โจมตีคำนวณ CRC ใหม่ได้ แต่บัญชีปลายทางยังไม่ตรงกับร้าน
    expect(verifyPromptPayPayload(build('01', '0066811111111', '125.50'), PHONE)).toBe(false);
  });

  it('rejects an extra target sub-tag smuggled into tag 29', () => {
    expect(verifyPromptPayPayload(build('01', '0066812345678', '125.50', tag('02', '1234567890123')), PHONE)).toBe(false);
  });

  it('rejects the wrong id type for the same digits', () => {
    expect(verifyPromptPayPayload(PHONE_QR, { ...PHONE, type: 'national_id', promptPayId: '0812345678' })).toBe(false);
  });

  it.each(['', '6304', 'not a qr', '00020101021229'])('rejects malformed payload "%s"', (payload) => {
    expect(verifyPromptPayPayload(payload, PHONE)).toBe(false);
  });
});
