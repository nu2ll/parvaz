'use strict';
// Minimal service worker: makes the web app installable; always goes to the network (no stale chats).
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
