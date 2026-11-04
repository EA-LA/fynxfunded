import type { TimeZoneMode } from "@/lib/tradeTiming";
import { timeZoneLabel } from "@/lib/tradeTiming";

/** Two-button switch between the viewer's local time and UTC. */
export default function TimeZoneToggle({ mode, onChange, label = "Show times in" }: { mode: TimeZoneMode; onChange: (m: TimeZoneMode) => void; label?: string }) {
  const local = timeZoneLabel("local");
  return (
    <div className="flex rounded-lg border p-1" role="group" aria-label={label}>
      {([["local", `Local (${local})`], ["utc", "UTC"]] as const).map(([m, text]) => (
        <button key={m} type="button" aria-pressed={mode === m} onClick={() => onChange(m)}
          className={`rounded-md px-3 py-1.5 text-xs ${mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
          {text}
        </button>
      ))}
    </div>
  );
}
