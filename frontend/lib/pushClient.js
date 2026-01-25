import { subscribeToAlerts } from './api';

const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export async function registerPush() {
  if (typeof window === 'undefined') return;
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('Push not supported in this browser');
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register('/service-worker.js');
    const existing = await registration.pushManager.getSubscription();
    if (existing) return existing;

    if (!vapidKey || vapidKey.includes('REPLACE_WITH')) {
      console.warn('Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY; skipping push registration');
      return;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey)
    });
    await subscribeToAlerts(subscription);
    return subscription;
  } catch (error) {
    console.error('Push registration failed', error);
    return null;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
