import type { CSSProperties } from 'react';
import {
  Booking,
  Master,
  getGridTimeSlots,
  durationToRowSpan,
  bookingToRowStart,
  statusMark,
  localDateStr,
} from '../api';

interface Props {
  bookings: Booking[];
  masters: Master[];
  date: string;
  mobileMasterIndex?: number;
  onBookingClick: (b: Booking) => void;
  onAddClick: (masterId: string, time: string) => void;
}

const STATUS_CLASS: Record<string, string> = {
  pending: 'status-pending',
  confirmed: 'status-confirmed',
  cancelled: 'status-cancelled',
  completed: 'status-completed',
};

export function ScheduleGrid({
  bookings,
  masters,
  date,
  mobileMasterIndex = 0,
  onBookingClick,
  onAddClick,
}: Props) {
  const timeSlots = getGridTimeSlots();
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;
  const displayMasters = isMobile ? [masters[mobileMasterIndex]].filter(Boolean) : masters;
  const cols = displayMasters.length;

  const dayBookings = bookings.filter((b) => b.datetime.startsWith(date));

  const occupiedCells = new Set<string>();

  dayBookings.forEach((b) => {
    const masterIdx = displayMasters.findIndex((m) => m.id === b.master_id);
    if (masterIdx < 0) return;
    const rowStart = bookingToRowStart(b.datetime);
    const span = durationToRowSpan(b.duration_minutes);
    for (let r = 0; r < span; r++) {
      occupiedCells.add(`${masterIdx}-${rowStart + r}`);
    }
  });

  return (
    <div
      className="schedule-grid overflow-x-auto bg-white rounded-xl border border-gray-200"
      style={{ '--cols': cols } as CSSProperties & Record<'--cols', number>}
    >
      {/* Header row */}
      <div className="grid-cell bg-gray-50 font-medium text-sm flex items-center justify-center sticky left-0 z-10">
        Час
      </div>
      {displayMasters.map((m) => (
        <div
          key={m.id}
          className="grid-cell bg-gray-50 font-medium text-sm flex items-center justify-center px-2 text-center"
        >
          {m.photo_url ? (
            <img src={m.photo_url} alt="" className="w-6 h-6 rounded-full mr-1 inline" />
          ) : (
            '👤 '
          )}
          {m.name}
        </div>
      ))}

      {/* Time rows */}
      {timeSlots.map((time, rowIdx) => {
        const gridRow = rowIdx + 2;
        return (
          <div key={time} className="contents">
            <div
              className="grid-cell bg-gray-50 text-xs text-gray-500 flex items-center justify-center sticky left-0 z-10"
              style={{ gridRow }}
            >
              {time}
            </div>
            {displayMasters.map((master, colIdx) => {
              const cellKey = `${colIdx}-${gridRow}`;
              if (occupiedCells.has(cellKey)) {
                const booking = dayBookings.find((b) => {
                  if (b.master_id !== master.id) return false;
                  const rowStart = bookingToRowStart(b.datetime);
                  const span = durationToRowSpan(b.duration_minutes);
                  return gridRow >= rowStart && gridRow < rowStart + span;
                });

                if (booking && gridRow === bookingToRowStart(booking.datetime)) {
                  const span = durationToRowSpan(booking.duration_minutes);
                  return (
                    <div
                      key={cellKey}
                      className={`booking-block ${STATUS_CLASS[booking.status]}`}
                      style={{ gridRow: `${gridRow} / span ${span}`, gridColumn: colIdx + 2 }}
                      onClick={() => onBookingClick(booking)}
                    >
                      <div className="font-semibold truncate">
                        {statusMark(booking.status)} {booking.client_name}
                      </div>
                      <div className="truncate">{booking.service_name}</div>
                      {booking.client_phone && (
                        <div className="truncate opacity-70">📞 {booking.client_phone}</div>
                      )}
                      <div className="opacity-70">{booking.duration_minutes}хв</div>
                    </div>
                  );
                }
                return null;
              }

              return (
                <div
                  key={cellKey}
                  className="grid-cell grid-cell-add"
                  style={{ gridRow, gridColumn: colIdx + 2 }}
                  onClick={() => onAddClick(master.id, time)}
                >
                  + додати
                </div>
              );
            })}
          </div>
        );
      })}
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
