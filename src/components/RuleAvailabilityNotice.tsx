import { Link } from "react-router-dom";

export default function RuleAvailabilityNotice() {
  return (
    <aside className="premium-card my-6 text-sm text-muted-foreground" aria-label="Rules and availability">
      <p>Purchases remain closed. The approved new-account schedule uses USD balances, static maximum loss and a 22:00 UTC daily reset year-round. Touching a loss floor is allowed; falling below it records a breach. Best-day profit must be no more than 40% of total net phase profit.</p>
      <p className="mt-2">Forex is the planned scope. Pairs, leverage, trading costs and sessions still require broker verification. Crypto is unavailable. Overnight and weekend holding require confirmed instrument and account terms; selecting Swing does not grant permission.</p>
      <Link className="mt-2 inline-block underline" to="/rules">Review targets and loss limits for each program</Link>
    </aside>
  );
}
