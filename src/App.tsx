import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { onAuthStateChanged, User } from 'firebase/auth';
import { auth } from './lib/firebase';
import { AuthCard } from './components/AuthCard';
import { LaptopDashboard } from './components/LaptopDashboard';
import { PhoneSetup } from './components/PhoneSetup';

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="center-screen">
        <p className="muted">Loading Crown Sync...</p>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="center-screen">
        <AuthCard />
      </div>
    );
  }

  const isPhone =
    Capacitor.isNativePlatform() ||
    new URLSearchParams(window.location.search).get('mode') === 'phone';

  return isPhone ? <PhoneSetup user={user} /> : <LaptopDashboard user={user} />;
}

export default App;
