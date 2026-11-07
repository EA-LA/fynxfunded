import { forexMarketOpen } from "./instruments";

/**
 * The four main forex trading centres and their usual business hours in local
 * time. Approximate: liquidity starts and ends gradually and brokers publish
 * their own hours. Local time zones handle daylight saving automatically.
 */
export interface TradingCentre {
  id: string;
  city: string;
  timeZone: string;
  openHour: number;
  closeHour: number;
}

export const TRADING_CENTRES: TradingCentre[] = [
  { id: "sydney", city: "Sydney", timeZone: "Australia/Sydney", openHour: 7, closeHour: 16 },
  { id: "tokyo", city: "Tokyo", timeZone: "Asia/Tokyo", openHour: 9, closeHour: 18 },
  { id: "london", city: "London", timeZone: "Europe/London", openHour: 8, closeHour: 17 },
  { id: "new-york", city: "New York", timeZone: "America/New_York", openHour: 8, closeHour: 17 },
];

export interface CentreStatus {
  centre: TradingCentre;
  open: boolean;
  /** Local clock time, e.g. "14:05". */
  localTime: string;
  /** Minutes until the centre closes (when open) or opens later the same local day; null otherwise. */
  minutesToChange: number | null;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function localParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(get("hour")) % 24, minute = Number(get("minute"));
  return { weekday: WEEKDAYS.indexOf(get("weekday")), hour, minute };
}

export function centreStatus(centre: TradingCentre, now: Date): CentreStatus {
  const { weekday, hour, minute } = localParts(now, centre.timeZone);
  const minutes = hour * 60 + minute, openAt = centre.openHour * 60, closeAt = centre.closeHour * 60;
  const businessDay = weekday >= 1 && weekday <= 5;
  const open = businessDay && minutes >= openAt && minutes < closeAt && forexMarketOpen(now);
  const minutesToChange = open ? closeAt - minutes : businessDay && minutes < openAt ? openAt - minutes : null;
  return { centre, open, localTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`, minutesToChange };
}

export const formatMinutes = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m`);
