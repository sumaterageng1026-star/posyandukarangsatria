'use strict';

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL('./#keluarga/notifikasi', self.registration.scope);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const page = windows.find(client => {
      const url = new URL(client.url);
      return url.origin === target.origin && url.pathname === target.pathname;
    });
    if (page) {
      try {
        await page.navigate(target.href);
        await page.focus();
        return;
      } catch {
        // If the page just closed, open the reminder in a new tab.
      }
    }
    await self.clients.openWindow(target.href);
  })());
});
