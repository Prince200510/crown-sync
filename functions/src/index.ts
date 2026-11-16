import { initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { getMessaging, MulticastMessage } from 'firebase-admin/messaging';
import { HttpsError, onCall } from 'firebase-functions/v2/https';

initializeApp();

const db = getFirestore();
const messaging = getMessaging();

type EventType =
  | 'notification_posted'
  | 'notification_removed'
  | 'call_ringing'
  | 'call_ended'
  | 'test_notification';

interface RelayPayload {
  eventId: string;
  eventType: EventType;
  timestamp: number;
  sourceDeviceId: string;
  notificationKey?: string;
  appName?: string;
  title?: string;
  body?: string;
  callId?: string;
  callSeq?: number;
}

const ALLOWED_EVENT_TYPES = new Set<EventType>([
  'notification_posted',
  'notification_removed',
  'call_ringing',
  'call_ended',
  'test_notification',
]);

const CALL_EVENT_MAX_AGE_MS = 30_000;
const GENERAL_EVENT_MAX_AGE_MS = 120_000;
const MAX_FUTURE_SKEW_MS = 15_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_EVENTS = 60;

function sanitizeStr(val: unknown, maxLen: number): string {
  if (typeof val !== 'string') return '';
  return val.trim().slice(0, maxLen);
}

function validatePayload(data: unknown): RelayPayload {
  if (!data || typeof data !== 'object') {
    throw new HttpsError('invalid-argument', 'Payload must be an object.');
  }
  const raw = data as Record<string, unknown>;

  const eventId = sanitizeStr(raw.eventId, 128);
  const eventType = raw.eventType as EventType;
  const sourceDeviceId = sanitizeStr(raw.sourceDeviceId, 128);
  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : Number(raw.timestamp);

  if (!eventId || !sourceDeviceId || !ALLOWED_EVENT_TYPES.has(eventType)) {
    throw new HttpsError('invalid-argument', 'Missing or invalid eventId, sourceDeviceId, or eventType.');
  }
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    throw new HttpsError('invalid-argument', 'Invalid timestamp.');
  }

  return {
    eventId,
    eventType,
    timestamp,
    sourceDeviceId,
    notificationKey: sanitizeStr(raw.notificationKey, 256),
    appName: sanitizeStr(raw.appName, 80),
    title: sanitizeStr(raw.title, 150),
    body: sanitizeStr(raw.body, 500),
    callId: sanitizeStr(raw.callId, 128),
    callSeq: typeof raw.callSeq === 'number' ? raw.callSeq : undefined,
  };
}

export const relayEvent = onCall({ region: 'us-central1', maxInstances: 10 }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const uid = request.auth.uid;
  const payload = validatePayload(request.data);
  const now = Date.now();

  // 1. Reject stale or far-future events
  const ageMs = now - payload.timestamp;
  if (ageMs < -MAX_FUTURE_SKEW_MS) {
    throw new HttpsError('invalid-argument', 'Event timestamp is too far in the future.');
  }
  const maxAge =
    payload.eventType === 'call_ringing' ? CALL_EVENT_MAX_AGE_MS : GENERAL_EVENT_MAX_AGE_MS;
  if (ageMs > maxAge) {
    return { status: 'dropped_stale', eventId: payload.eventId };
  }

  const userRef = db.collection('users').doc(uid);

  // 2. Verify device ownership
  const sourceDeviceSnap = await userRef.collection('devices').doc(payload.sourceDeviceId).get();
  if (!sourceDeviceSnap.exists) {
    throw new HttpsError('permission-denied', 'Source device is not registered to this user.');
  }

  // 3. Basic per-user rate limiting
  const rateRef = userRef.collection('rateLimit').doc('relay');
  const rateAllowed = await db.runTransaction(async (tx) => {
    const snap = await tx.get(rateRef);
    const data = snap.data();
    if (!data || now - (data.windowStart as number) > RATE_LIMIT_WINDOW_MS) {
      tx.set(rateRef, { windowStart: now, count: 1 });
      return true;
    }
    const count = (data.count as number) + 1;
    if (count > RATE_LIMIT_MAX_EVENTS) {
      return false;
    }
    tx.update(rateRef, { count });
    return true;
  });

  if (!rateAllowed) {
    throw new HttpsError('resource-exhausted', 'Rate limit exceeded. Try again shortly.');
  }

  // 4. Deduplication (stores only eventId & timestamp, never notification body)
  const dedupRef = userRef.collection('dedup').doc(payload.eventId);
  const isDuplicate = await db.runTransaction(async (tx) => {
    const snap = await tx.get(dedupRef);
    if (snap.exists) return true;
    tx.set(dedupRef, { createdAt: now });
    return false;
  });

  if (isDuplicate) {
    return { status: 'dropped_duplicate', eventId: payload.eventId };
  }

  // 5. Out-of-order protection for call events
  if (
    (payload.eventType === 'call_ringing' || payload.eventType === 'call_ended') &&
    payload.callId &&
    typeof payload.callSeq === 'number'
  ) {
    const callRef = userRef.collection('calls').doc(payload.callId);
    const isOutOfOrder = await db.runTransaction(async (tx) => {
      const snap = await tx.get(callRef);
      const lastSeq = snap.exists ? (snap.data()?.lastSeq as number) : 0;
      if (payload.callSeq! <= lastSeq) {
        return true;
      }
      tx.set(callRef, { lastSeq: payload.callSeq, updatedAt: now });
      return false;
    });

    if (isOutOfOrder) {
      return { status: 'dropped_out_of_order', eventId: payload.eventId };
    }
  }

  // 6. Fetch user's registered web browser tokens
  const webDevicesSnap = await userRef
    .collection('devices')
    .where('platform', '==', 'web')
    .get();

  const tokenToDocId = new Map<string, string>();
  webDevicesSnap.forEach((doc) => {
    const token = doc.data().fcmToken;
    if (typeof token === 'string' && token.length > 0) {
      tokenToDocId.set(token, doc.id);
    }
  });

  const tokens = Array.from(tokenToDocId.keys());
  if (tokens.length === 0) {
    return { status: 'no_web_devices', eventId: payload.eventId };
  }

  const isCall = payload.eventType === 'call_ringing' || payload.eventType === 'call_ended';
  const ttlSeconds = isCall ? '30' : '120';

  const message: MulticastMessage = {
    tokens,
    data: {
      eventId: payload.eventId,
      eventType: payload.eventType,
      timestamp: String(payload.timestamp),
      notificationKey: payload.notificationKey ?? '',
      appName: payload.appName ?? '',
      title: payload.title ?? '',
      body: payload.body ?? '',
      callId: payload.callId ?? '',
      callSeq: payload.callSeq !== undefined ? String(payload.callSeq) : '',
    },
    webpush: {
      headers: {
        TTL: ttlSeconds,
        Urgency: isCall ? 'high' : 'normal',
      },
    },
  };

  const response = await messaging.sendEachForMulticast(message);

  // 7. Clean up invalid/expired tokens
  const cleanupPromises: Promise<unknown>[] = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success && resp.error) {
      const code = resp.error.code;
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        const badToken = tokens[idx];
        const docId = tokenToDocId.get(badToken);
        if (docId) {
          cleanupPromises.push(
            userRef.collection('devices').doc(docId).update({
              fcmToken: FieldValue.delete(),
              tokenInvalidatedAt: now,
            })
          );
        }
      }
    }
  });

  if (cleanupPromises.length > 0) {
    await Promise.allSettled(cleanupPromises);
  }

  return {
    status: 'relayed',
    eventId: payload.eventId,
    successCount: response.successCount,
    failureCount: response.failureCount,
  };
});
