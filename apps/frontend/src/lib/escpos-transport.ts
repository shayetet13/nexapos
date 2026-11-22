/**
 * ESC/POS transport helpers — Bluetooth / USB / Network senders.
 * Standalone (no React) so the dev tuning tab and any other caller can connect to a
 * printer and send raw bytes without duplicating the chunked-write logic.
 *
 * NOTE: the POS page (POSContent.tsx) keeps its own connection lifecycle (auto-reconnect,
 * status pills). These helpers are for one-off test prints from the dev tab.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const BT_PROFILES = [
  { s: 'e7810a71-73ae-499d-8c15-faa9aef0c3f2', c: 'bef8d6c9-9c21-4c9e-b632-bd58c1009f9f' },
  { s: '000018f0-0000-1000-8000-00805f9b34fb', c: '00002af1-0000-1000-8000-00805f9b34fb' },
  { s: '49535343-fe7d-4ae5-8fa9-9fafd205e455', c: '49535343-8841-43f4-a8d4-ecbe34729bb3' },
  { s: '0000ff00-0000-1000-8000-00805f9b34fb', c: '0000ff02-0000-1000-8000-00805f9b34fb' },
];

export const hasBluetooth = typeof navigator !== 'undefined' && 'bluetooth' in navigator;
export const hasUsb = typeof navigator !== 'undefined' && 'usb' in navigator;

/** A connected Bluetooth printer characteristic (write target). */
export interface BtPrinter { device: any; characteristic: any; }

/** Find a writable characteristic on a connected GATT server. */
async function findWritableChar(server: any): Promise<any> {
  for (const p of BT_PROFILES) {
    try { const svc = await server.getPrimaryService(p.s); return await svc.getCharacteristic(p.c); }
    catch { /* try next */ }
  }
  // Fallback: scan all services for any writable characteristic
  try {
    const svcs: any[] = await server.getPrimaryServices();
    for (const svc of svcs) {
      const chars: any[] = await svc.getCharacteristics();
      for (const c of chars) {
        if (c.properties.write || c.properties.writeWithoutResponse) return c;
      }
    }
  } catch { /* ignore */ }
  return null;
}

/** Prompt the user to pick a Bluetooth printer and connect to it. */
export async function connectBluetoothPrinter(): Promise<BtPrinter> {
  if (!hasBluetooth) throw new Error('เบราว์เซอร์ไม่รองรับ Web Bluetooth (ต้องใช้ HTTPS + Chrome/Edge)');
  const bt = (navigator as any).bluetooth;
  const device = await bt.requestDevice({ acceptAllDevices: true, optionalServices: BT_PROFILES.map(p => p.s) });
  const server = await device.gatt.connect();
  const characteristic = await findWritableChar(server);
  if (!characteristic) throw new Error('ไม่พบ service สำหรับพิมพ์บนอุปกรณ์นี้');
  try { localStorage.setItem('pos_bt_printer_name', device.name ?? ''); } catch { /* ignore */ }
  return { device, characteristic };
}

/** Try to silently reconnect to a previously granted Bluetooth printer (no user gesture). */
export async function reconnectBluetoothPrinter(): Promise<BtPrinter | null> {
  if (!hasBluetooth) return null;
  try {
    const devices: any[] = await (navigator as any).bluetooth?.getDevices?.() ?? [];
    if (!devices.length) return null;
    const savedName = localStorage.getItem('pos_bt_printer_name');
    const device = savedName ? (devices.find((d: any) => d.name === savedName) ?? devices[0]) : devices[0];
    if (!device) return null;
    const server = await device.gatt.connect();
    const characteristic = await findWritableChar(server);
    if (!characteristic) return null;
    return { device, characteristic };
  } catch {
    return null;
  }
}

/** Send bytes to a Bluetooth characteristic in 512-byte chunks. */
export async function sendBluetooth(printer: BtPrinter, data: Uint8Array): Promise<boolean> {
  try {
    const CHUNK = 512;
    for (let i = 0; i < data.length; i += CHUNK) {
      await printer.characteristic.writeValue(data.slice(i, i + CHUNK));
      await new Promise(r => setTimeout(r, 30));
    }
    return true;
  } catch {
    return false;
  }
}

export interface UsbPrinter { device: any; ep: number; }

/** Prompt the user to pick a USB printer and claim its OUT endpoint. */
export async function connectUsbPrinter(): Promise<UsbPrinter> {
  if (!hasUsb) throw new Error('เบราว์เซอร์ไม่รองรับ WebUSB (ต้องใช้ Chrome/Edge)');
  const device: any = await (navigator as any).usb.requestDevice({ filters: [{ classCode: 7 }] });
  await device.open();
  if (device.configuration === null) await device.selectConfiguration(1);
  const iface = device.configuration?.interfaces.find((i: any) => i.alternates[0]?.interfaceClass === 7);
  if (!iface) throw new Error('ไม่พบ USB Printer interface');
  await device.claimInterface(iface.interfaceNumber);
  const outEp = iface.alternates[0]?.endpoints.find((e: any) => e.direction === 'out');
  if (!outEp) throw new Error('ไม่พบ USB OUT endpoint');
  return { device, ep: outEp.endpointNumber };
}

/** Send bytes to a USB printer endpoint in 16KB chunks. */
export async function sendUsb(printer: UsbPrinter, data: Uint8Array): Promise<boolean> {
  try {
    const CHUNK = 16_384;
    for (let i = 0; i < data.length; i += CHUNK) await printer.device.transferOut(printer.ep, data.slice(i, i + CHUNK));
    return true;
  } catch {
    return false;
  }
}

/** Send bytes to a network printer relay over WebSocket (ws/wss → ip:port). */
export async function sendNetwork(ip: string, port: string, data: Uint8Array): Promise<boolean> {
  if (!ip) return false;
  return new Promise((resolve) => {
    const proto = typeof location !== 'undefined' && location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${ip}:${port || 9100}`);
    ws.binaryType = 'arraybuffer';
    const t = setTimeout(() => { ws.close(); resolve(false); }, 8000);
    ws.onopen = () => { clearTimeout(t); ws.send(data); setTimeout(() => { ws.close(); resolve(true); }, 600); };
    ws.onerror = () => { clearTimeout(t); resolve(false); };
  });
}
