/* Heimdall Wallet Watch: shows push notifications and opens the wallet's report when one is tapped. */
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: "Heimdall", body: event.data ? event.data.text() : "" }; }
  event.waitUntil(self.registration.showNotification(d.title || "Heimdall Wallet Watch", {
    body: d.body || "Something changed on a wallet you watch.",
    icon: "/apple-icon.png",
    badge: "/apple-icon.png",
    tag: d.tag || "heimdall-watch",
    data: { url: d.url || "/check" },
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/check";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) if (c.url.includes(new URL(url, self.location.origin).pathname) && "focus" in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
