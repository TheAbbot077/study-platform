"use client";

import Image from "next/image";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#0f0b1c] text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(233,190,103,0.18),_transparent_24%),radial-gradient(circle_at_top_right,_rgba(62,44,116,0.34),_transparent_28%),radial-gradient(circle_at_bottom_left,_rgba(38,28,77,0.36),_transparent_34%)]" />
      <div className="absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] [background-size:42px_42px]" />

      <section className="relative mx-auto flex min-h-screen max-w-7xl flex-col justify-center px-6 py-12 lg:px-10">
        <div className="grid items-center gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(380px,0.9fr)]">
          <div className="max-w-3xl">
            <div className="inline-flex rounded-full border border-[#caa04f]/40 bg-[#1d1635]/90 px-4 py-2 text-sm font-medium tracking-[0.16em] text-[#e7c780] uppercase shadow-[0_0_20px_rgba(202,160,79,0.12)]">
              Abbot Study
            </div>

            <h1 className="mt-7 max-w-4xl text-5xl font-semibold leading-tight tracking-tight text-[#fbf7ee] sm:text-6xl">
              A study space that feels like a private library and teaches with direction.
            </h1>

            <p className="mt-6 max-w-2xl text-lg leading-8 text-[#cfc7e6]">
              Turn your own learning materials into structured subjects, guided
              syllabi, and tutor-led lessons that keep the flow moving one topic at a
              time.
            </p>

            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                href="/signup"
                className="rounded-2xl bg-[#caa04f] px-7 py-3.5 text-sm font-semibold text-[#1f1637] transition hover:bg-[#e0b86a]"
              >
                Sign up
              </Link>

              <Link
                href="/login"
                className="rounded-2xl border border-[#8b6f35] bg-[#1b1530]/90 px-7 py-3.5 text-sm font-semibold text-[#f4dfae] transition hover:bg-[#251c42]"
              >
                Login
              </Link>
            </div>

            <div className="mt-12 grid gap-4 sm:grid-cols-3">
              <div className="rounded-3xl border border-[#d0a95b]/18 bg-[linear-gradient(180deg,_rgba(34,25,58,0.92)_0%,_rgba(22,17,36,0.96)_100%)] p-5 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b369]">
                  Organize
                </p>
                <p className="mt-3 text-sm leading-6 text-[#ddd4f0]">
                  Build subjects from your own books, notes, and study packs.
                </p>
              </div>

              <div className="rounded-3xl border border-[#d0a95b]/18 bg-[linear-gradient(180deg,_rgba(34,25,58,0.92)_0%,_rgba(22,17,36,0.96)_100%)] p-5 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b369]">
                  Learn
                </p>
                <p className="mt-3 text-sm leading-6 text-[#ddd4f0]">
                  Follow a clear tutor-led sequence instead of guessing what comes next.
                </p>
              </div>

              <div className="rounded-3xl border border-[#d0a95b]/18 bg-[linear-gradient(180deg,_rgba(34,25,58,0.92)_0%,_rgba(22,17,36,0.96)_100%)] p-5 backdrop-blur-sm">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b369]">
                  Track
                </p>
                <p className="mt-3 text-sm leading-6 text-[#ddd4f0]">
                  See progress across subjects and return to the exact point you left off.
                </p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-[radial-gradient(circle,_rgba(202,160,79,0.3),_transparent_58%)] blur-2xl" />
            <div className="relative overflow-hidden rounded-[2rem] border border-[#d1a85d]/35 bg-[linear-gradient(180deg,_rgba(28,21,49,0.98)_0%,_rgba(14,10,25,0.98)_100%)] p-4 shadow-[0_20px_80px_rgba(0,0,0,0.45)]">
              <div className="rounded-[1.6rem] border border-white/10 bg-[#120f23] p-3">
                <Image
                  src="/library-shelves-hero.svg"
                  alt="Illustration of library shelves with warm gold lighting"
                  width={960}
                  height={1180}
                  priority
                  className="h-auto w-full rounded-[1.2rem]"
                />
              </div>

              <div className="mt-4 rounded-[1.4rem] border border-[#d0a95b]/18 bg-[#1d1636]/94 px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#d7b369]">
                  Structured study
                </p>
                <p className="mt-2 text-sm leading-6 text-[#ddd4f0]">
                  Upload material, build a syllabus, and let the tutor guide the
                  lesson from foundations to mastery.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
