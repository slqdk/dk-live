// subscribe(url, intervalMs, onData, onError) — one timer per URL, many subscribers.
const feeds = new Map();

export function subscribe(url, intervalMs, onData, onError) {
  let f = feeds.get(url);
  if (!f) {
    f = { subs: [], timer: null };
    feeds.set(url, f);
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
        const data = await res.json();
        f.subs.forEach((s) => s.onData(data));
      } catch (err) {
        f.subs.forEach((s) => s.onError?.(err));
      }
    };
    tick();
    f.timer = setInterval(tick, intervalMs);
  }
  f.subs.push({ onData, onError });
}
