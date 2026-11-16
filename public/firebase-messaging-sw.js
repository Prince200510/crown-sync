/* eslint-disable no-undef */
const recentEventIds = new Set();

function trackEventId(eventId) {
  if (!eventId) return false;
  if (recentEventIds.has(eventId)) return true;
  recentEventIds.add(eventId);
  if (recentEventIds.size > 200) {
    const first = recentEventIds.values().next().value;
    recentEventIds.delete(first);
  }
  return false;
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  const data = payload.data || payload;
  const eventId = data.eventId || '';
  if (trackEventId(eventId)) {
    return;
  }

  const eventType = data.eventType || '';
  const timestamp = Number(data.timestamp || 0);
  const now = Date.now();

  // Drop stale incoming call alerts on the client side as well
  if (eventType === 'call_ringing' && timestamp > 0 && now - timestamp > 35000) {
    return;
  }

  event.waitUntil(handlePushEvent(data));
});

async function handlePushEvent(data) {
  const eventType = data.eventType;

  if (eventType === 'call_ringing') {
    const callId = data.callId || 'active-call';
    const tag = `call-${callId}`;
    const caller = data.title && data.title.trim() ? data.title.trim() : 'Incoming call';
    const body =
      caller === 'Incoming call'
        ? 'Your phone is ringing'
        : `Incoming call: ${caller}`;

    await self.registration.showNotification('Incoming call', {
      body,
      tag,
      renotify: false,
      requireInteraction: true,
      data: { eventType, callId },
    });
    return;
  }

  if (eventType === 'call_ended') {
    const callId = data.callId || 'active-call';
    const tag = `call-${callId}`;
    const existing = await self.registration.getNotifications({ tag });
    existing.forEach((n) => n.close());
    return;
  }

  if (eventType === 'notification_removed') {
    const key = data.notificationKey || '';
    if (!key) return;
    const tag = `notif-${key}`;
    const existing = await self.registration.getNotifications({ tag });
    existing.forEach((n) => n.close());
    return;
  }

  if (eventType === 'notification_posted' || eventType === 'test_notification') {
    const appName = data.appName || 'Crown Sync';
    const title = data.title ? `${appName}: ${data.title}` : appName;
    const body = data.body || (eventType === 'test_notification' ? 'Test notification received.' : '');
    const tag = data.notificationKey ? `notif-${data.notificationKey}` : `event-${data.eventId}`;

    await self.registration.showNotification(title, {
      body,
      tag,
      renotify: true,
      requireInteraction: false,
      data: { eventType },
    });
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
      return undefined;
    })
  );
});
