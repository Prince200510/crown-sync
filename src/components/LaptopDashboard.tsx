import { useEffect, useState } from 'react';
import { User, signOut } from 'firebase/auth';
import { getToken, onMessage } from 'firebase/messaging';
import { Bell, CheckCircle2, Laptop, Send, Smartphone, Trash2, AlertTriangle } from 'lucide-react';
import { auth, getMessagingIfSupported, relayEventFn } from '../lib/firebase';
import {
  getOrCreateDeviceId,
  RegisteredDevice,
  registerWebDevice,
  removeDevice,
  subscribeDevices,
} from '../lib/device';

interface Props {
  user: User;
}

export function LaptopDashboard({ user }: Props) {
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'default'
  );
  const [fcmToken, setFcmToken] = useState<string>('');
  const [devices, setDevices] = useState<RegisteredDevice[]>([]);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [busy, setBusy] = useState(false);

  const currentDeviceId = getOrCreateDeviceId();

  useEffect(() => {
    const unsub = subscribeDevices(user.uid, (list) => {
      setDevices(list);
      const mine = list.find((d) => d.id === currentDeviceId);
      if (mine && !mine.fcmToken && fcmToken) {
        setErrorMsg('Your browser push token was invalidated or expired. Click "Enable Notifications" to refresh it.');
        setFcmToken('');
      }
    });
    return unsub;
  }, [user.uid, currentDeviceId, fcmToken]);

  useEffect(() => {
    let unsubMsg: (() => void) | undefined;
    getMessagingIfSupported().then((messaging) => {
      if (!messaging) return;
      unsubMsg = onMessage(messaging, (payload) => {
        const type = payload.data?.eventType || 'event';
        setStatusMsg(`Received ${type} (${new Date().toLocaleTimeString()})`);
      });
    });
    return () => {
      if (unsubMsg) unsubMsg();
    };
  }, []);

  async function enableNotifications() {
    setErrorMsg('');
    setStatusMsg('');
    setBusy(true);
    try {
      if (typeof Notification === 'undefined') {
        throw new Error('This browser does not support Web Notifications.');
      }

      const result = await Notification.requestPermission();
      setPermission(result);
      if (result !== 'granted') {
        throw new Error(
          'Notification permission was denied. Allow notifications in your browser site settings and try again.'
        );
      }

      const messaging = await getMessagingIfSupported();
      if (!messaging) {
        throw new Error('Firebase Cloud Messaging is not supported in this browser.');
      }

      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
        scope: '/',
      });

      const vapidKey = import.meta.env.VITE_FIREBASE_VAPID_KEY;
      if (!vapidKey) {
        throw new Error('Missing VITE_FIREBASE_VAPID_KEY in environment configuration.');
      }

      const token = await getToken(messaging, {
        vapidKey,
        serviceWorkerRegistration: swReg,
      });

      if (!token) {
        throw new Error('Failed to obtain Web Push token.');
      }

      await registerWebDevice(user.uid, token);
      setFcmToken(token);
      setStatusMsg('Web Push enabled. Notifications will arrive even when this tab is closed.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to enable notifications.');
    } finally {
      setBusy(false);
    }
  }

  async function sendTestNotification() {
    setErrorMsg('');
    setStatusMsg('');
    setBusy(true);
    try {
      if (!fcmToken && !devices.some((d) => d.id === currentDeviceId && d.fcmToken)) {
        throw new Error('Enable notifications on this laptop first.');
      }
      await relayEventFn({
        eventId: crypto.randomUUID(),
        eventType: 'test_notification',
        timestamp: Date.now(),
        sourceDeviceId: currentDeviceId,
        appName: 'Crown Sync',
        title: 'Test Notification',
        body: 'Your laptop is receiving Web Push events from Crown Sync.',
      });
      setStatusMsg('Test notification sent.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send test notification.');
    } finally {
      setBusy(false);
    }
  }

  async function handleRemoveDevice(deviceId: string) {
    setErrorMsg('');
    try {
      await removeDevice(user.uid, deviceId);
      if (deviceId === currentDeviceId) {
        setFcmToken('');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to remove device.');
    }
  }

  const isThisLaptopRegistered = devices.some((d) => d.id === currentDeviceId && Boolean(d.fcmToken));

  return (
    <div className="container">
      <header className="topbar">
        <div className="brand">
          <img src="/logo.png" alt="Crown Sync" className="brand-logo" />
          <div>
            <h1>Crown Sync</h1>
            <p className="muted small">{user.email}</p>
          </div>
        </div>
        <button className="btn secondary" onClick={() => signOut(auth)}>
          Sign Out
        </button>
      </header>

      <section className="card">
        <h2>Laptop Web Push Setup</h2>
        <div className="status-row">
          <span className={`badge ${permission === 'granted' && isThisLaptopRegistered ? 'ok' : 'warn'}`}>
            {permission === 'granted' && isThisLaptopRegistered ? (
              <>
                <CheckCircle2 size={16} /> Connected &amp; Ready
              </>
            ) : permission === 'denied' ? (
              <>
                <AlertTriangle size={16} /> Permission Denied
              </>
            ) : (
              <>
                <Bell size={16} /> Setup Required
              </>
            )}
          </span>
        </div>

        <p className="muted">
          Allow browser notifications so incoming calls and selected phone notifications appear as
          normal system notifications—even when this tab is closed (subject to browser/OS
          background rules).
        </p>

        <div className="actions">
          <button className="btn primary" onClick={enableNotifications} disabled={busy}>
            <Bell size={16} /> {isThisLaptopRegistered ? 'Refresh Push Token' : 'Enable Notifications'}
          </button>
          <button
            className="btn secondary"
            onClick={sendTestNotification}
            disabled={busy || !isThisLaptopRegistered}
          >
            <Send size={16} /> Send Test Notification
          </button>
        </div>

        {statusMsg && <div className="alert success">{statusMsg}</div>}
        {errorMsg && <div className="alert error">{errorMsg}</div>}
      </section>

      <section className="card">
        <h2>Registered Devices ({devices.length})</h2>
        {devices.length === 0 ? (
          <p className="muted">No devices registered yet.</p>
        ) : (
          <ul className="device-list">
            {devices.map((device) => (
              <li key={device.id} className="device-item">
                <div className="device-info">
                  {device.platform === 'android' ? <Smartphone size={18} /> : <Laptop size={18} />}
                  <div>
                    <strong>
                      {device.name} {device.id === currentDeviceId ? '(This browser)' : ''}
                    </strong>
                    <div className="muted small">
                      {device.platform === 'web'
                        ? device.fcmToken
                          ? 'Web Push active'
                          : 'Token missing or expired'
                        : 'Android companion'}
                    </div>
                  </div>
                </div>
                <button
                  className="btn icon-danger"
                  title="Remove device"
                  onClick={() => handleRemoveDevice(device.id)}
                >
                  <Trash2 size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
