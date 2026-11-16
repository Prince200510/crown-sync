import { useCallback, useEffect, useState } from 'react';
import { User, signOut } from 'firebase/auth';
import { CheckCircle2, RefreshCw, Send, ShieldAlert, Smartphone } from 'lucide-react';
import { auth } from '../lib/firebase';
import { CrownSyncBridge, InstalledApp, PermissionStatus } from '../lib/bridge';
import { getOrCreateDeviceId, registerAndroidDevice } from '../lib/device';

interface Props {
  user: User;
}

export function PhoneSetup({ user }: Props) {
  const [perms, setPerms] = useState<PermissionStatus>({
    notificationAccess: false,
    phoneState: false,
    postNotifications: false,
    batteryOptimizationIgnored: false,
  });
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [allowed, setAllowed] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const p = await CrownSyncBridge.getPermissionsStatus();
      setPerms(p);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to check permissions.');
    }
  }, []);

  useEffect(() => {
    const deviceId = getOrCreateDeviceId();
    registerAndroidDevice(user.uid)
      .then(async () => {
        const idToken = await user.getIdToken();
        return CrownSyncBridge.syncAuthConfig({ deviceId, uid: user.uid, idToken });
      })
      .catch((err) => setErrorMsg(err instanceof Error ? err.message : 'Failed to sync device.'));

    refreshStatus();

    Promise.all([CrownSyncBridge.getInstalledApps(), CrownSyncBridge.getAllowedApps()])
      .then(([installedRes, allowedRes]) => {
        setApps(installedRes.apps);
        setAllowed(new Set(allowedRes.packages));
      })
      .catch(() => {
        // Ignore if running in web preview
      });
  }, [user.uid, refreshStatus]);

  async function toggleApp(pkg: string) {
    const next = new Set(allowed);
    if (next.has(pkg)) {
      next.delete(pkg);
    } else {
      next.add(pkg);
    }
    setAllowed(next);
    try {
      await CrownSyncBridge.setAllowedApps({ packages: Array.from(next) });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save app selection.');
    }
  }

  async function handleTestConnection() {
    setErrorMsg('');
    setStatusMsg('');
    setBusy(true);
    try {
      const res = await CrownSyncBridge.sendTestEvent();
      setStatusMsg(`Native relay test: ${res.status}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Native test failed.');
    } finally {
      setBusy(false);
    }
  }

  const filteredApps = apps.filter(
    (a) =>
      a.appName.toLowerCase().includes(search.toLowerCase()) ||
      a.packageName.toLowerCase().includes(search.toLowerCase())
  );

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
        <div className="row-between">
          <h2>1. Required Permissions</h2>
          <button className="btn secondary" onClick={refreshStatus}>
            <RefreshCw size={15} /> Refresh
          </button>
        </div>

        <div className="perm-list">
          <div className="perm-item">
            <div>
              <strong>Notification Access</strong>
              <div className="muted small">Reads posted/updated/removed notifications natively.</div>
            </div>
            {perms.notificationAccess ? (
              <span className="badge ok">
                <CheckCircle2 size={14} /> Granted
              </span>
            ) : (
              <button
                className="btn primary"
                onClick={() => CrownSyncBridge.openNotificationListenerSettings()}
              >
                Enable
              </button>
            )}
          </div>

          <div className="perm-item">
            <div>
              <strong>Phone State (READ_PHONE_STATE)</strong>
              <div className="muted small">
                Detects cellular ringing &amp; call-ended transitions. Caller number is optional.
              </div>
            </div>
            {perms.phoneState ? (
              <span className="badge ok">
                <CheckCircle2 size={14} /> Granted
              </span>
            ) : (
              <button
                className="btn primary"
                onClick={() => CrownSyncBridge.requestPhoneStatePermission().then(refreshStatus)}
              >
                Allow
              </button>
            )}
          </div>

          <div className="perm-item">
            <div>
              <strong>Battery Optimization</strong>
              <div className="muted small">
                Helps keep background capture alive when the screen is locked.
              </div>
            </div>
            {perms.batteryOptimizationIgnored ? (
              <span className="badge ok">
                <CheckCircle2 size={14} /> Unrestricted
              </span>
            ) : (
              <button
                className="btn secondary"
                onClick={() =>
                  CrownSyncBridge.requestBatteryOptimizationExemption().then(refreshStatus)
                }
              >
                Exempt
              </button>
            )}
          </div>
        </div>

        <div className="alert info">
          <ShieldAlert size={16} />
          <span>
            <strong>Internet Calls (WhatsApp, Telegram, etc.):</strong> Cellular call-state APIs do
            not detect VoIP calls. To receive those, enable those apps in the allowlist below.
          </span>
        </div>
      </section>

      <section className="card">
        <h2>2. Connection Test</h2>
        <p className="muted">
          Tests native Android upload to the Cloud Function and Web Push delivery to your laptop.
        </p>
        <button className="btn primary" onClick={handleTestConnection} disabled={busy}>
          <Send size={16} /> {busy ? 'Sending...' : 'Send Native Test Event'}
        </button>
        {statusMsg && <div className="alert success">{statusMsg}</div>}
        {errorMsg && <div className="alert error">{errorMsg}</div>}
      </section>

      <section className="card">
        <h2>3. Apps to Forward ({allowed.size} selected)</h2>
        <input
          type="search"
          className="search-input"
          placeholder="Search installed apps..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="app-list">
          {filteredApps.map((app) => (
            <label key={app.packageName} className="app-item">
              <input
                type="checkbox"
                checked={allowed.has(app.packageName)}
                onChange={() => toggleApp(app.packageName)}
              />
              <div>
                <strong>{app.appName}</strong>
                <div className="muted small">{app.packageName}</div>
              </div>
            </label>
          ))}
          {filteredApps.length === 0 && (
            <p className="muted">
              <Smartphone size={14} /> No matching apps found.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
