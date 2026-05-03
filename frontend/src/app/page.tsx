"use client";

import Image from "next/image";
import Link from "next/link";

const featureItems = [
  {
    label: "Structured subjects",
    description: "Turn books and notes into subject pathways that actually feel teachable.",
  },
  {
    label: "Tutor-led flow",
    description: "Move from progress page to tutor with a lesson that already knows what comes next.",
  },
  {
    label: "Continuity saved",
    description: "Return to concept history, checkpoints, and mastery without losing your place.",
  },
];

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#f6f1e6] px-4 py-8 text-white sm:px-6 lg:px-10">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(217,178,87,0.18),_transparent_22%),radial-gradient(circle_at_bottom_right,_rgba(16,35,88,0.5),_transparent_36%),linear-gradient(180deg,_#0f2250_0%,_#101d43_100%)]" />
      <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] [background-size:40px_40px]" />

      <section className="relative mx-auto max-w-7xl">
        <div className="rounded-[2.75rem] border border-white/18 bg-[linear-gradient(180deg,_rgba(13,23,51,0.95)_0%,_rgba(7,13,29,0.98)_100%)] p-3 shadow-[0_40px_120px_rgba(0,0,0,0.45)] sm:p-4 lg:p-5">
          <div className="overflow-hidden rounded-[2.2rem] border border-white/10 bg-[#08152f]">
            <div className="flex items-center justify-between gap-4 bg-[#0f2250] px-5 py-4 sm:px-7">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-full border-2 border-[#d7b369] bg-[#10295d] text-xl font-black text-[#f1d188] shadow-[0_0_22px_rgba(215,179,105,0.22)]">
                  A
                </div>
                <div>
                  <p className="text-xl font-bold tracking-tight text-[#fff8e8]">
                    Abbot Study
                  </p>
                  <p className="text-xs uppercase tracking-[0.22em] text-[#d6c9a3]">
                    Guided learning
                  </p>
                </div>
              </div>

              <div className="hidden items-center gap-3 text-sm font-medium text-[#e8dfc8] md:flex">
                <span className="rounded-full border border-white/10 bg-white/8 px-4 py-2">
                  Structured subjects
                </span>
                <span className="rounded-full border border-white/10 bg-white/8 px-4 py-2">
                  Tutor continuity
                </span>
                <span className="rounded-full border border-white/10 bg-white/8 px-4 py-2">
                  Progress tracking
                </span>
              </div>

              <div className="flex items-center gap-3">
                <Link
                  href="/login"
                  className="rounded-full border border-[#d7b369]/45 bg-[#10295d] px-4 py-2 text-sm font-semibold text-[#f6e4b4] transition hover:bg-[#17306b]"
                >
                  Login
                </Link>
                <Link
                  href="/signup"
                  className="rounded-full bg-[#d7b369] px-4 py-2 text-sm font-semibold text-[#122551] transition hover:bg-[#ebc97b]"
                >
                  Sign up
                </Link>
              </div>
            </div>

            <div className="relative">
              <div className="relative h-[19rem] overflow-hidden sm:h-[24rem] lg:h-[28rem]">
                <Image
                  src="/library-hero-real.jpg"
                  alt="Books on library shelves with a graduation cap resting on stacked books"
                  fill
                  priority
                  className="object-cover"
                />
                <div className="absolute inset-0 bg-[linear-gradient(180deg,_rgba(9,16,35,0.1)_0%,_rgba(8,16,39,0.2)_45%,_rgba(8,14,31,0.65)_100%)]" />
                <div className="absolute inset-x-0 bottom-7 flex justify-center px-4">
                  <div className="w-full max-w-2xl rounded-[2rem] border border-white/12 bg-[linear-gradient(180deg,_rgba(31,58,122,0.68)_0%,_rgba(23,44,96,0.84)_100%)] px-6 py-5 text-center shadow-[0_24px_60px_rgba(0,0,0,0.32)] backdrop-blur-md sm:px-8 sm:py-6">
                    <p className="text-lg font-medium tracking-[0.04em] text-[#f6edd7] sm:text-2xl">
                      learn anything
                    </p>
                    <h1 className="mt-2 text-3xl font-black tracking-tight text-white sm:text-5xl">
                      anywhere anytime
                    </h1>
                    <p className="mt-3 text-sm leading-6 text-[#d7def4] sm:text-base">
                      Build subjects from your own materials and move through a tutor-led lesson flow that already knows what comes next.
                    </p>
                  </div>
                </div>
              </div>

              <div className="relative bg-[#f8f5ef] px-5 pb-10 pt-16 text-[#14244b] sm:px-8 sm:pb-12 sm:pt-20">
                <div className="absolute inset-x-0 -top-11 h-24 overflow-hidden">
                  <svg
                    viewBox="0 0 1200 180"
                    preserveAspectRatio="none"
                    className="h-full w-full"
                    aria-hidden="true"
                  >
                    <path
                      d="M0,90 C130,155 250,18 410,74 C565,129 684,156 820,100 C949,47 1051,34 1200,102 L1200,180 L0,180 Z"
                      fill="#d8b461"
                    />
                    <path
                      d="M0,108 C162,70 294,125 457,108 C650,88 800,18 988,55 C1082,73 1144,89 1200,74 L1200,180 L0,180 Z"
                      fill="#f8f5ef"
                    />
                  </svg>
                </div>

                <div className="mx-auto max-w-4xl text-center">
                  <p className="text-xs font-semibold uppercase tracking-[0.28em] text-[#977538]">
                    Adaptive study from your own library
                  </p>
                  <h2 className="mt-4 text-4xl font-black tracking-tight text-[#122551] sm:text-5xl">
                    Start with the materials you already trust
                  </h2>
                  <p className="mx-auto mt-4 max-w-2xl text-sm leading-7 text-[#53617f] sm:text-base">
                    Sign up, upload your study material, open a subject, and let the tutor guide you from syllabus to concept to mastery without losing continuity.
                  </p>

                  <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
                    <Link
                      href="/signup"
                      className="min-w-[12rem] rounded-full bg-[#0f2250] px-8 py-4 text-sm font-bold text-[#f4dfae] shadow-[0_16px_35px_rgba(15,34,80,0.24)] transition hover:bg-[#17306b]"
                    >
                      Sign up now
                    </Link>
                    <Link
                      href="/login"
                      className="min-w-[12rem] rounded-full border border-[#0f2250]/15 bg-white px-8 py-4 text-sm font-bold text-[#122551] transition hover:bg-[#f5efe3]"
                    >
                      Log in
                    </Link>
                  </div>
                </div>

                <div className="mx-auto mt-10 grid max-w-5xl gap-4 md:grid-cols-3">
                  {featureItems.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-[1.8rem] border border-[#d2c6af] bg-white/80 p-5 text-left shadow-[0_16px_35px_rgba(18,37,81,0.08)] backdrop-blur-sm"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#977538]">
                        {item.label}
                      </p>
                      <p className="mt-3 text-sm leading-7 text-[#485674]">
                        {item.description}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
