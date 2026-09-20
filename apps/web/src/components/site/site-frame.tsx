import Link from "next/link";
import type { Route } from "next";
import { AmbientField } from "@/components/ambient-field";
import { CiraWordmark } from "@/components/shell/mark";

/**
 * The frame for Cira's public pages: what someone sees before they have an
 * account.
 *
 * The same ground and the same type as the product, because the first screen
 * should not be a different thing wearing the same name. One thin header, one
 * narrow column, and a foot carrying the things a company checks before it
 * signs anything - what Cira runs on, and what it promises.
 */
export function SiteFrame({
  children,
  wide = false,
}: {
  children: React.ReactNode;
  /** Pricing needs the width; prose does not. */
  wide?: boolean;
}) {
  return (
    <>
      <AmbientField />
      <div className="flex min-h-dvh flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-panel/70 backdrop-blur-xl">
          <div className="mx-auto flex h-14 w-full max-w-[980px] items-center gap-6 px-5">
            <Link href="/" aria-label="Cira" title="Cira" className="shrink-0">
              <CiraWordmark className="h-[15px] w-auto text-ink" />
            </Link>
            <nav className="flex flex-1 items-center gap-5 text-[13px]">
              {[
                { label: "Pricing", href: "/pricing" },
                { label: "Docs", href: "/docs" },
              ].map((item) => (
                <Link
                  key={item.href}
                  href={item.href as Route}
                  className="text-ink-muted transition-colors duration-150 hover:text-ink"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <Link href="/sign-in" className="btn btn-secondary h-[30px] px-3">
              Sign in
            </Link>
          </div>
        </header>

        <main className="flex-1">
          <div
            className={`mx-auto w-full px-5 py-14 ${wide ? "max-w-[980px]" : "max-w-[720px]"}`}
          >
            {children}
          </div>
        </main>

        <footer className="border-t border-line">
          <div className="mx-auto flex w-full max-w-[980px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-6 text-[12px] text-ink-subtle">
            <span>Cira</span>
            {[
              { label: "Pricing", href: "/pricing" },
              { label: "Docs", href: "/docs" },
              { label: "Security", href: "/legal/security" },
              { label: "Subprocessors", href: "/legal/subprocessors" },
              { label: "Privacy", href: "/legal/privacy" },
              { label: "Terms", href: "/legal/terms" },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href as Route}
                className="transition-colors duration-150 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </div>
        </footer>
      </div>
    </>
  );
}

/** A heading and its prose, the shape every public page is made of. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <div className="mt-2 flex flex-col gap-3 text-[13.5px] leading-relaxed text-ink-muted">
        {children}
      </div>
    </section>
  );
}
