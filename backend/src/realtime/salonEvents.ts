type SalonListener = (event: SalonRealtimeEvent) => void;

export type SalonRealtimeEvent = {
  type: 'bookings_changed';
  at: string;
};

/**
 * In-process SSE fan-out per salon.
 * Works for a single Railway instance (typical MVP). Multi-instance needs Redis later.
 */
const listeners = new Map<string, Set<SalonListener>>();

export function subscribeSalon(salonId: string, listener: SalonListener): () => void {
  let set = listeners.get(salonId);
  if (!set) {
    set = new Set();
    listeners.set(salonId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (set!.size === 0) listeners.delete(salonId);
  };
}

export function publishSalonBookingsChanged(salonId: string): void {
  const set = listeners.get(salonId);
  if (!set?.size) return;
  const event: SalonRealtimeEvent = {
    type: 'bookings_changed',
    at: new Date().toISOString(),
  };
  for (const listener of set) {
    try {
      listener(event);
    } catch (err) {
      console.error('salonEvents listener failed', err);
    }
  }
}
