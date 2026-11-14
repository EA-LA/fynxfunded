// Local preview only: run the page on a Wednesday afternoon (UTC) so the forex market is open, whatever the real day is.
const shift = Date.parse("2026-11-11T14:00:00Z") - Date.now();
const RealDate = Date;
class PreviewDate extends RealDate {
  constructor(...args: unknown[]) { if (args.length) super(...(args as [number])); else super(RealDate.now() + shift); }
  static now() { return RealDate.now() + shift; }
}
if (new URLSearchParams(location.search).get("clock") !== "real") (globalThis as { Date: DateConstructor }).Date = PreviewDate as unknown as DateConstructor;
export {};
