import { useEffect, useMemo, useState } from 'react';
import {
  Booking,
  Master,
  GRID_END_HOUR,
  GRID_SLOT_MINUTES,
  GRID_START_HOUR,
  getGridTimeSlots,
  localDateStr,
} from '../api';
import { bookingNeedsAttention, bookingTone } from '../utils/bookingVisuals';

interface Props {
  bookings: Booking[];
  masters: Master[];
  date: string;
  mobileMasterIndex?: number;
  onBookingClick: (b: Booking) => void;
  onAddClick: (masterId: string, time: string) => void;
  onNoteSave: (booking: Booking, notes: string) => Promise<void>;
}

const SLOT_HEIGHT = 56;

function initials(booking: Booking) {
  return booking.client_initials || booking.client_name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

export function ScheduleGrid({
  bookings,
  masters,
  date,
  mobileMasterIndex = 0,
  onBookingClick,
  onAddClick,
  onNoteSave,
}: Props) {
  const timeSlots = getGridTimeSlots();
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [noteBooking, setNoteBooking] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const displayMasters = isMobile ? [masters[mobileMasterIndex]].filter(Boolean) : masters;
  const dayBookings = useMemo(() => bookings.filter((b) => b.datetime.startsWith(date)), [bookings, date]);
  const timelineHeight = timeSlots.length * SLOT_HEIGHT;

  function position(booking: Booking, masterBookings: Booking[]) {
    const start = new Date(booking.datetime);
    const startMinute = start.getHours() * 60 + start.getMinutes();
    const dayStart = GRID_START_HOUR * 60;
    const top = Math.max(0, ((startMinute - dayStart) / GRID_SLOT_MINUTES) * SLOT_HEIGHT);
    const endMinute = startMinute + booking.duration_minutes;
    const overlaps = masterBookings
      .filter((item) => {
        const itemStartDate = new Date(item.datetime);
        const itemStart = itemStartDate.getHours() * 60 + itemStartDate.getMinutes();
        return itemStart < endMinute && itemStart + item.duration_minutes > startMinute;
      })
      .sort((a, b) => a.datetime.localeCompare(b.datetime) || a.id.localeCompare(b.id));
    const width = 100 / overlaps.length;
    return {
      top,
      height: Math.max(48, (booking.duration_minutes / GRID_SLOT_MINUTES) * SLOT_HEIGHT - 4),
      left: width * overlaps.findIndex((item) => item.id === booking.id),
      width,
    };
  }

  return (
    <div className="schedule-shell">
      <div className="schedule-grid" style={{ minWidth: `${72 + displayMasters.length * 220}px` }}>
        <div className="schedule-time-column">
          <div className="schedule-corner">Час</div>
          {timeSlots.map((time) => <div className="schedule-time" key={time}>{time}</div>)}
        </div>
        {displayMasters.map((master) => {
          const masterBookings = dayBookings.filter((booking) => booking.master_id === master.id);
          return (
            <div className="master-day" key={master.id}>
              <div className="master-header">
                {master.photo_url
                  ? <img src={master.photo_url} alt="" />
                  : <span className="master-avatar">{master.name.slice(0, 1)}</span>}
                <span><b>{master.name}</b><small>{master.position || 'Спеціаліст'}</small></span>
              </div>
              <div className="master-timeline" style={{ height: timelineHeight }}>
                {timeSlots.map((time) => (
                  <button className="empty-slot" key={time} onClick={() => onAddClick(master.id, time)}>
                    <span>+ запис</span>
                  </button>
                ))}
                {masterBookings.map((booking) => {
                  const pos = position(booking, masterBookings);
                  const time = new Date(booking.datetime).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
                  const attention = bookingNeedsAttention(booking);
                  return (
                    <article
                      key={booking.id}
                      className={`booking-card ${bookingTone(booking)} ${attention ? 'booking-attention' : ''}`}
                      style={{
                        top: pos.top,
                        height: pos.height,
                        left: `calc(${pos.left}% + 2px)`,
                        width: `calc(${pos.width}% - 4px)`,
                      }}
                      onClick={() => onBookingClick(booking)}
                    >
                      <div className="booking-card-head">
                        <span className="client-initials">{initials(booking)}</span>
                        <strong>{booking.client_name}</strong>
                        <span className="booking-icons">{attention ? '⚠' : ''}{booking.files_count ? ` 📎${booking.files_count}` : ''}</span>
                      </div>
                      <div className="booking-meta"><b>{time}</b> · {booking.service_name}</div>
                      {booking.notes && <div className="booking-note">{booking.notes}</div>}
                      {booking.client_phone && <div className="booking-phone">{booking.client_phone}</div>}
                      <button
                        type="button"
                        className="booking-note-button"
                        title="Редагувати нотатку"
                        onClick={(event) => {
                          event.stopPropagation();
                          setNoteBooking(booking.id);
                          setNote(booking.notes ?? '');
                        }}
                      >✎</button>
                      {noteBooking === booking.id && (
                        <form
                          className="inline-note"
                          onClick={(event) => event.stopPropagation()}
                          onSubmit={async (event) => {
                            event.preventDefault();
                            setSavingNote(true);
                            try {
                              await onNoteSave(booking, note);
                              setNoteBooking(null);
                            } finally {
                              setSavingNote(false);
                            }
                          }}
                        >
                          <textarea
                            value={note}
                            onChange={(event) => setNote(event.target.value)}
                            autoFocus
                            placeholder="Enter — зберегти, Shift+Enter — новий рядок"
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                event.currentTarget.form?.requestSubmit();
                              }
                            }}
                          />
                          <div>
                            <button type="button" onClick={() => setNoteBooking(null)}>Скасувати</button>
                            <button type="submit" disabled={savingNote}>Зберегти</button>
                          </div>
                        </form>
                      )}
                    </article>
                  );
                })}
              </div>
            </div>
          );
        })}
        {!displayMasters.length && <div className="schedule-empty">Додайте активного спеціаліста, щоб вести розклад.</div>}
      </div>
    </div>
  );
}

export function formatDisplayDate(date: string): string {
  return new Date(date + 'T12:00:00').toLocaleDateString('uk-UA', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

export function shiftDate(date: string, days: number): string {
  const d = new Date(date + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayStr(): string {
  return localDateStr();
}
