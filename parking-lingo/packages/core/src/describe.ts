/** Human-readable labels for panels and schedules. */
import type { PanelKind, PaymentMethod, Schedule, SignPanel } from "./schema";
import { formatClock, formatDate, formatDays, parseLocalDateTime, parseTimeOfDay } from "./time";

export const KIND_LABEL: Record<PanelKind, string> = {
  no_stopping: "No stopping",
  no_parking: "No parking",
  clearway: "Clearway",
  timed_parking: "Parking",
  loading_zone: "Loading zone",
  bus_zone: "Bus zone",
  taxi_zone: "Taxi zone",
  permit_zone: "Permit zone",
  disabled_only: "Disability parking",
  works_zone: "Works zone",
  mail_zone: "Mail zone",
  truck_zone: "Truck zone",
  motorcycle_only: "Motorbike parking",
  car_share: "Car share bay",
  ev_charging: "EV charging bay",
  bus_lane: "Bus lane",
  transit_lane: "Transit lane",
  special_event: "Special event clearway",
  other: "Unrecognised sign",
};

/** 15 -> "1/4P", 30 -> "1/2P", 120 -> "2P", 90 -> "90 min". */
export function limitLabel(minutes: number): string {
  if (minutes === 15) return "1/4P";
  if (minutes === 30) return "1/2P";
  if (minutes % 60 === 0) return `${minutes / 60}P`;
  return `${minutes} min`;
}

export const PAYMENT_LABEL: Record<PaymentMethod, string> = {
  none: "",
  meter: "Meter",
  ticket: "Ticket",
  pay_by_phone: "Pay by phone",
  paid_unspecified: "Paid",
};

export const PAYMENT_INSTRUCTION: Record<Exclude<PaymentMethod, "none">, string> = {
  meter: "Pay at the meter.",
  ticket: "Buy a ticket and display it.",
  pay_by_phone: "Pay by app or phone.",
  paid_unspecified: "Payment required.",
};

/** Short panel label, e.g. "2P Meter", "Clearway", "Temporary no stopping", "Loading zone 30 min". */
export function panelLabel(p: SignPanel): string {
  let base: string;
  if (p.kind === "timed_parking") {
    base = p.timeLimitMinutes != null ? limitLabel(p.timeLimitMinutes) : "P";
    if (p.payment !== "none") base += ` ${PAYMENT_LABEL[p.payment]}`;
  } else {
    base = KIND_LABEL[p.kind];
    if (p.timeLimitMinutes != null) {
      base += p.timeLimitMinutes < 60 ? ` ${p.timeLimitMinutes} min` : ` ${limitLabel(p.timeLimitMinutes)}`;
    }
    if (p.payment !== "none") base += ` ${PAYMENT_LABEL[p.payment]}`;
  }
  if (p.temporary) {
    // Keep sign codes like "P", "2P", "1/4P", "EV" in capitals.
    const keepCase = /^[A-Z0-9/]+\b/.test(base) && !/^[A-Z][a-z]/.test(base);
    base = `Temporary ${keepCase ? base : base.charAt(0).toLowerCase() + base.slice(1)}`;
  }
  return base;
}

export function scheduleText(s: Schedule): string {
  const st = parseTimeOfDay(s.start);
  const en = parseTimeOfDay(s.end);
  const allDay = (st === 0 && en === 1440) || st === en;
  const time = allDay ? "all day" : `${formatClock(st)}–${formatClock(en)}`;
  let txt = `${time} ${formatDays(s.days)}`;
  if (s.publicHolidays === "included") txt += " incl. public holidays";
  if (s.publicHolidays === "excluded") txt += " except public holidays";
  return txt;
}

export function panelTimesText(p: SignPanel): string {
  let txt = p.schedules.length === 0 ? "at all times" : p.schedules.map(scheduleText).join("; ");
  if (p.effectiveDates && (p.effectiveDates.start || p.effectiveDates.end)) {
    const fmt = (v: string | null): string => {
      if (!v) return "?";
      const { date, minutes } = parseLocalDateTime(v);
      return minutes == null ? formatDate(date) : `${formatDate(date)} ${formatClock(minutes)}`;
    };
    txt += ` (${fmt(p.effectiveDates.start)} – ${fmt(p.effectiveDates.end)})`;
  }
  return txt;
}

/** "2P Meter, 8:00 am–6:00 pm Mon–Fri" */
export function describePanel(p: SignPanel): string {
  let txt = `${panelLabel(p)}, ${panelTimesText(p)}`;
  if (p.permitExempt) {
    txt += p.permitExempt.areaCode
      ? `, permit holders excepted (area ${p.permitExempt.areaCode})`
      : ", permit holders excepted";
  }
  return txt;
}
