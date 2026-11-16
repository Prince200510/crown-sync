import { collection, deleteDoc, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from './firebase';

const DEVICE_ID_KEY = 'crown_sync_device_id';

export interface RegisteredDevice {
  id: string;
  name: string;
  platform: 'web' | 'android';
  fcmToken?: string;
  updatedAt?: unknown;
}

export function getOrCreateDeviceId(): string {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

export async function registerWebDevice(uid: string, fcmToken: string): Promise<string> {
  const deviceId = getOrCreateDeviceId();
  const ua = navigator.userAgent;
  const browser = ua.includes('Edg/') ? 'Edge' : ua.includes('Chrome/') ? 'Chrome' : 'Browser';
  await setDoc(
    doc(db, 'users', uid, 'devices', deviceId),
    {
      name: `Laptop (${browser})`,
      platform: 'web',
      fcmToken,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return deviceId;
}

export async function registerAndroidDevice(uid: string): Promise<string> {
  const deviceId = getOrCreateDeviceId();
  await setDoc(
    doc(db, 'users', uid, 'devices', deviceId),
    {
      name: 'Android Phone',
      platform: 'android',
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  return deviceId;
}

export async function removeDevice(uid: string, deviceId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', uid, 'devices', deviceId));
}

export function subscribeDevices(
  uid: string,
  onUpdate: (devices: RegisteredDevice[]) => void
): () => void {
  return onSnapshot(collection(db, 'users', uid, 'devices'), (snap) => {
    const list: RegisteredDevice[] = [];
    snap.forEach((d) => {
      const data = d.data();
      list.push({
        id: d.id,
        name: (data.name as string) || d.id,
        platform: (data.platform as 'web' | 'android') || 'web',
        fcmToken: data.fcmToken as string | undefined,
        updatedAt: data.updatedAt,
      });
    });
    onUpdate(list);
  });
}
