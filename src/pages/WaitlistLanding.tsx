import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, LockKeyhole, Sparkles } from "lucide-react";

const previewKey = import.meta.env.VITE_PLATFORM_PREVIEW_KEY ?? "fynx-preview";

function enablePlatformPreview() {
  window.localStorage.setItem("fynx-platform-preview", "enabled");
  window.location.href = import.meta.env.BASE_URL || "/";
}

export default function WaitlistLanding() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [joined, setJoined] = useState(false);
  const params = new URLSearchParams(window.location.search);
  const canEnablePreview = params.get("preview") === previewKey;

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const waitlistEntry = {
      name: name.trim(),
      email: email.trim(),
      joinedAt: new Date().toISOString(),
    };

    const existingEntries = JSON.parse(window.localStorage.getItem("fynx-waitlist") ?? "[]");
    window.localStorage.setItem("fynx-waitlist", JSON.stringify([...existingEntries, waitlistEntry]));
    setJoined(true);
  };

  return (
    <main className="min-h-screen overflow-hidden bg-[#030303] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(255,255,255,0.14),transparent_28%),radial-gradient(circle_at_80%_0%,rgba(255,255,255,0.08),transparent_22%),linear-gradient(135deg,rgba(255,255,255,0.08)_0,transparent_28%)]" />
      <div className="absolute inset-0 dot-grid opacity-40" />
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/60 to-transparent" />

      <section className="relative z-10 mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white text-sm font-black tracking-tight text-black shadow-[0_0_40px_rgba(255,255,255,0.18)]">
              FX
            </div>
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.38em] text-white">FYNX</p>
              <p className="text-xs uppercase tracking-[0.24em] text-white/45">Funded</p>
            </div>
          </div>
          <div className="hidden items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-4 py-2 text-xs uppercase tracking-[0.22em] text-white/60 sm:flex">
            <LockKeyhole size={13} /> Private beta
          </div>
        </header>

        <div className="grid flex-1 items-center gap-14 py-16 lg:grid-cols-[1.08fr_0.92fr] lg:py-10">
          <div className="max-w-3xl">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-4 py-2 text-xs font-medium uppercase tracking-[0.24em] text-white/60 backdrop-blur">
              <Sparkles size={14} className="text-white" /> Institutional-style funding is being built
            </div>
            <h1 className="text-balance text-5xl font-semibold tracking-[-0.06em] text-white md:text-7xl lg:text-8xl">
              FYNX Funded is coming soon
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-white/62 md:text-xl">
              We are building a premium, institutional-style funded trading platform with disciplined evaluations,
              transparent risk controls, trader dashboards, and a refined payout experience.
            </p>
            <div className="mt-10 grid max-w-2xl gap-3 text-sm text-white/58 sm:grid-cols-3">
              {["Black-and-white execution", "Risk-first challenge design", "Private platform build"].map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur">
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[2rem] border border-white/12 bg-white/[0.055] p-2 shadow-[0_30px_120px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="rounded-[1.5rem] border border-white/10 bg-black/70 p-6 md:p-8">
              {joined ? (
                <div className="py-10 text-center">
                  <CheckCircle2 className="mx-auto h-12 w-12 text-white" />
                  <h2 className="mt-6 text-2xl font-semibold tracking-tight">You are on the waitlist.</h2>
                  <p className="mt-3 text-sm leading-6 text-white/56">
                    Thank you for joining. We will share private launch updates as FYNX Funded gets closer to release.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-[0.28em] text-white/42">Join the waitlist</p>
                    <h2 className="mt-3 text-2xl font-semibold tracking-tight">Get launch access first.</h2>
                    <p className="mt-3 text-sm leading-6 text-white/55">
                      Leave your details and we will notify you when the public platform opens.
                    </p>
                  </div>
                  <label className="block text-sm text-white/70">
                    Name <span className="text-white/35">(optional)</span>
                    <input
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition placeholder:text-white/28 focus:border-white/40"
                      placeholder="Your name"
                    />
                  </label>
                  <label className="block text-sm text-white/70">
                    Email
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      className="mt-2 h-12 w-full rounded-xl border border-white/10 bg-white/[0.04] px-4 text-white outline-none transition placeholder:text-white/28 focus:border-white/40"
                      placeholder="you@example.com"
                    />
                  </label>
                  <button className="group flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/88">
                    Join Waitlist <ArrowRight size={16} className="transition group-hover:translate-x-0.5" />
                  </button>
                </form>
              )}

              {canEnablePreview && (
                <button
                  onClick={enablePlatformPreview}
                  className="mt-5 w-full rounded-xl border border-white/10 px-4 py-3 text-xs font-medium uppercase tracking-[0.18em] text-white/58 transition hover:border-white/30 hover:text-white"
                >
                  Enable admin platform preview
                </button>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
