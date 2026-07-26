import { DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import {
  Booking,
  Master,
  Room,
  GRID_SLOT_MINUTES,
  GRID_START_HOUR,
  getGridTimeSlots,
  localDateStr,
} from '../api';
import { bookingNeedsAttention, bookingTone } from '../utils/bookingVisuals';
import {
  DEFAULT_SALON_TIMEZONE,
  minutesSinceMidnight,
  zonedDateKey,
  zonedTimeHm,
} from '../utils/datetime';

export type ScheduleViewMode = 'master' | 'room';

export type ScheduleAddDraft = {
  masterId: string;
  roomId?: string | null;
  time: string;
};

export type ScheduleRescheduleTarget = {
  time: string;
  masterId?: string;
  roomId?: string | null;
};

interface Props {
  bookings: Booking[];
  masters: Master[];
  rooms?: Room[];
  viewMode?: ScheduleViewMode;
  date: string;
  timeZone?: string;
  slotMinutes?: number;
  mobileColumnIndex?: number;
  onBookingClick: (b: Booking) => void;
  onAddClick: (draft: ScheduleAddDraft) => void;
  onNoteSave: (booking: Booking, notes: string) => Promise<void>;
  onReschedule?: (booking: Booking, target: ScheduleRescheduleTarget) => Promise<void>;
}

const SLOT_HEIGHT = 56;

function initials(booking: Booking) {
  return (
    booking.client_initials ||
    booking.client_name
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join('')
      .toUpperCase()
  );
}

function intervalsOverlap(aStart: number, aDur: number, bStart: number, bDur: number): boolean {
  return aStart < bStart + bDur && bStart < aStart + aDur;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function ScheduleGrid({
  bookings,
  masters,
  rooms = [],
  viewMode = 'master',
  date,
  timeZone = DEFAULT_SALON_TIMEZONE,
  slotMinutes = GRID_SLOT_MINUTES,
  mobileColumnIndex = 0,
  onBookingClick,
  onAddClick,
  onNoteSave,
  onReschedule,
}: Props) {
  const timeSlots = useMemo(() => getGridTimeSlots(slotMinutes), [slotMinutes]);
  const [isMobile, setIsMobile] = useState(() => window.matchMedia('(max-width: 767px)').matches);
  const [noteBooking, setNoteBooking] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [conflictIds, setConflictIds] = useState<string[]>([]);
  const [dropTime, setDropTime] = useState<string | null>(null);
  const [rescheduling, setRescheduling] = useState(false);
  const suppressClickRef = useRef(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 767px)');
    const update = () => setIsMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const activeRooms = useMemo(() => rooms.filter((room) => room.is_active), [rooms]);
  const dayBookings = useMemo(
    () => bookings.filter((b) => zonedDateKey(b.datetime, timeZone) === date && b.status !== 'cancelled'),
    [bookings, date, timeZone]
  );
  const timelineHeight = `calc(${timeSlots.length} * var(--schedule-slot-h))`;
  const bookingById = useMemo(() => new Map(dayBookings.map((b) => [b.id, b])), [dayBookings]);

  const masterById = useMemo(() => new Map(masters.map((master) => [master.id, master])), [masters]);

  function effectiveRoomId(booking: Booking): string | null {
    if (booking.room_id) return booking.room_id;
    return masterById.get(booking.master_id)?.default_room_id ?? null;
  }

  const columns = useMemo(() => {
    if (viewMode === 'room') {
      return activeRooms.map((room) => ({
        id: room.id,
        title: room.name,
        subtitle: 'Кабінет',
        photoUrl: null as string | null,
        // Prefer booking.room_id; if empty, fall back to master's default cabinet.
        filter: (booking: Booking) => effectiveRoomId(booking) === room.id,
        onAdd: (time: string) =>
          onAddClick({
            masterId:
              masters.find((m) => m.is_active && m.default_room_id === room.id)?.id ??
              masters.find((m) => m.is_active)?.id ??
              masters[0]?.id ??
              '',
            roomId: room.id,
            time,
          }),
        showDoctor: true,
      }));
    }
    return masters.map((master) => ({
      id: master.id,
      title: master.name,
      subtitle: master.position || 'Спеціаліст',
      photoUrl: master.photo_url,
      filter: (booking: Booking) => booking.master_id === master.id,
      onAdd: (time: string) =>
        onAddClick({
          masterId: master.id,
          roomId: master.default_room_id ?? null,
          time,
        }),
      showDoctor: false,
    }));
  }, [viewMode, activeRooms, masters, onAddClick, masterById]);

  const displayColumns = isMobile ? [columns[mobileColumnIndex]].filter(Boolean) : columns;
  const dayStartMinute = GRID_START_HOUR * 60;

  function slotIndexForTime(timeHm: string): number {
    const exact = timeSlots.indexOf(timeHm);
    if (exact >= 0) return exact;
    const minutes = timeToMinutes(timeHm);
    return Math.max(
      0,
      Math.min(timeSlots.length - 1, Math.round((minutes - dayStartMinute) / slotMinutes))
    );
  }

  function position(booking: Booking, columnBookings: Booking[]) {
    const timeHm = zonedTimeHm(booking.datetime, timeZone);
    const startMinute = minutesSinceMidnight(booking.datetime, timeZone);
    const slotIndex = slotIndexForTime(timeHm);
    const rowSpan = Math.max(1, Math.ceil(booking.duration_minutes / slotMinutes));
    const endMinute = startMinute + booking.duration_minutes;
    const overlaps = columnBookings
      .filter((item) => {
        const itemStart = minutesSinceMidnight(item.datetime, timeZone);
        return itemStart < endMinute && itemStart + item.duration_minutes > startMinute;
      })
      .sort((a, b) => a.datetime.localeCompare(b.datetime) || a.id.localeCompare(b.id));
    const width = 100 / overlaps.length;
    return {
      // Keep in sync with CSS --schedule-slot-h so labels and cards share one row height.
      top: `calc(${slotIndex} * var(--schedule-slot-h))`,
      height: `calc(${rowSpan} * var(--schedule-slot-h) - 4px)`,
      left: width * overlaps.findIndex((item) => item.id === booking.id),
      width,
    };
  }

  function clearDragState() {
    setDraggingId(null);
    setConflictIds([]);
    setDropTime(null);
  }

  function findConflicts(moving: Booking, columnBookings: Booking[], time: string): string[] {
    const start = timeToMinutes(time);
    return columnBookings
      .filter(
        (item) =>
          item.id !== moving.id &&
          intervalsOverlap(
            start,
            moving.duration_minutes,
            minutesSinceMidnight(item.datetime, timeZone),
            item.duration_minutes
          )
      )
      .map((item) => item.id);
  }

  function buildTarget(columnId: string, time: string, moving: Booking): ScheduleRescheduleTarget {
    if (viewMode === 'room') {
      return {
        time,
        masterId: moving.master_id,
        roomId: columnId,
      };
    }
    return {
      time,
      masterId: columnId,
      roomId: moving.room_id ?? null,
    };
  }

  function onCardDragStart(event: DragEvent, booking: Booking) {
    if (!onReschedule || rescheduling) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData('text/booking-id', booking.id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggingId(booking.id);
    setConflictIds([]);
    suppressClickRef.current = false;
  }

  function onSlotDragOver(event: DragEvent, columnBookings: Booking[], time: string) {
    if (!draggingId || !onReschedule) return;
    const moving = bookingById.get(draggingId);
    if (!moving) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTime(time);
    setConflictIds(findConflicts(moving, columnBookings, time));
  }

  function onCardDragOver(event: DragEvent, target: Booking, columnBookings: Booking[]) {
    if (!draggingId || draggingId === target.id || !onReschedule) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const moving = bookingById.get(draggingId);
    if (!moving) return;
    const time = zonedTimeHm(target.datetime, timeZone);
    setDropTime(time);
    const conflicts = new Set(findConflicts(moving, columnBookings, time));
    conflicts.add(target.id);
    setConflictIds([...conflicts]);
  }

  async function finishDrop(columnId: string, columnBookings: Booking[], time: string) {
    if (!draggingId || !onReschedule || rescheduling) return;
    const moving = bookingById.get(draggingId);
    if (!moving) {
      clearDragState();
      return;
    }

    const conflicts = findConflicts(moving, columnBookings, time);
    if (conflicts.length) {
      setConflictIds(conflicts);
      setDropTime(time);
      suppressClickRef.current = true;
      return;
    }

    const currentTime = zonedTimeHm(moving.datetime, timeZone);
    const sameColumn =
      viewMode === 'room' ? moving.room_id === columnId : moving.master_id === columnId;
    if (sameColumn && currentTime === time) {
      clearDragState();
      return;
    }

    setRescheduling(true);
    suppressClickRef.current = true;
    try {
      await onReschedule(moving, buildTarget(columnId, time, moving));
      clearDragState();
    } catch {
      setConflictIds(findConflicts(moving, columnBookings, time));
    } finally {
      setRescheduling(false);
    }
  }

  return (
    <div className="schedule-shell" style={{ ['--schedule-slot-h' as string]: `${SLOT_HEIGHT}px` }}>
      <div className="schedule-grid" style={{ minWidth: `${72 + displayColumns.length * 220}px` }}>
        <div className="schedule-time-column">
          <div className="schedule-corner">Час</div>
          {timeSlots.map((time) => (
            <div className="schedule-time" key={time}>
              {time}
            </div>
          ))}
        </div>
        {displayColumns.map((column) => {
          const columnBookings = dayBookings.filter(column.filter);
          return (
            <div className="master-day" key={column.id}>
              <div className="master-header">
                {column.photoUrl ? (
                  <img src={column.photoUrl} alt="" />
                ) : (
                  <span className="master-avatar">{column.title.slice(0, 1)}</span>
                )}
                <span>
                  <b>{column.title}</b>
                  <small>{column.subtitle}</small>
                </span>
              </div>
              <div
                className="master-timeline"
                style={{
                  height: timelineHeight,
                  display: 'grid',
                  gridTemplateRows: `repeat(${timeSlots.length}, var(--schedule-slot-h))`,
                }}
              >
                {timeSlots.map((time, rowIndex) => (
                  <button
                    type="button"
                    className={`empty-slot${dropTime === time && draggingId ? ' drop-target' : ''}`}
                    key={time}
                    style={{ gridRow: rowIndex + 1 }}
                    onClick={() => column.onAdd(time)}
                    onDragOver={(event) => onSlotDragOver(event, columnBookings, time)}
                    onDrop={(event) => {
                      event.preventDefault();
                      void finishDrop(column.id, columnBookings, time);
                    }}
                  >
                    <span>+ запис</span>
                  </button>
                ))}
                {columnBookings.map((booking) => {
                  const pos = position(booking, columnBookings);
                  const time = zonedTimeHm(booking.datetime, timeZone);
                  const attention = bookingNeedsAttention(booking);
                  const isConflict = conflictIds.includes(booking.id);
                  const isDragging = draggingId === booking.id;
                  return (
                    <article
                      key={booking.id}
                      draggable={Boolean(onReschedule) && !rescheduling}
                      className={[
                        'booking-card',
                        bookingTone(booking),
                        attention ? 'booking-attention' : '',
                        isConflict ? 'booking-drop-conflict' : '',
                        isDragging ? 'booking-dragging' : '',
                      ]
                        .filter(Boolean)
                        .join(' ')}
                      style={{
                        top: pos.top,
                        height: pos.height,
                        left: `calc(${pos.left}% + 2px)`,
                        width: `calc(${pos.width}% - 4px)`,
                      }}
                      onClick={() => {
                        if (suppressClickRef.current) {
                          suppressClickRef.current = false;
                          return;
                        }
                        onBookingClick(booking);
                      }}
                      onDragStart={(event) => onCardDragStart(event, booking)}
                      onDragEnd={clearDragState}
                      onDragOver={(event) => onCardDragOver(event, booking, columnBookings)}
                      onDrop={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        // Drop on existing booking = attention only, no move.
                        if (draggingId && draggingId !== booking.id) {
                          setConflictIds((prev) =>
                            prev.includes(booking.id) ? prev : [...prev, booking.id]
                          );
                          suppressClickRef.current = true;
                        }
                      }}
                    >
                      <div className="booking-time">{time}</div>
                      <div className="booking-card-head">
                        <span className="client-initials">{initials(booking)}</span>
                        <strong>{booking.client_name}</strong>
                        <span className="booking-icons">
                          {attention || isConflict ? '⚠' : ''}
                          {booking.files_count ? ` 📎${booking.files_count}` : ''}
                        </span>
                      </div>
                      {column.showDoctor && (
                        <div className="booking-meta">{booking.master_name || 'Лікар'}</div>
                      )}
                      <div className="booking-service">{booking.service_name}</div>
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
                      >
                        ✎
                      </button>
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
                            <button type="button" onClick={() => setNoteBooking(null)}>
                              Скасувати
                            </button>
                            <button type="submit" disabled={savingNote}>
                              Зберегти
                            </button>
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
        {!displayColumns.length && (
          <div className="schedule-empty">
            {viewMode === 'room'
              ? 'Додайте активний кабінет, щоб вести розклад по кабінетах.'
              : 'Додайте активного спеціаліста, щоб вести розклад.'}
          </div>
        )}
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
  const [year, month, day] = date.split('-').map(Number);
  const d = new Date(year, month - 1, day + days);
  return localDateStr(d);
}

export function todayStr(): string {
  return zonedDateKey(new Date(), DEFAULT_SALON_TIMEZONE);
}
