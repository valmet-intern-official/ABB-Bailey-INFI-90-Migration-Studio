import Image from "next/image";
import Link from "next/link";
import { NAV } from "./content";
import { MobileMenu } from "./MobileMenu";

export function SiteHeader() {
  return (
    <header className="lp-header">
      <div className="lp-header__inner">
        <Link href="/" className="lp-brand" aria-label="ABB Bailey INFI 90 Migration Studio — home">
          <Image src="/valmet-logo.webp" alt="Valmet" width={112} height={32} className="lp-brand__logo" priority />
          <span className="lp-brand__rule" aria-hidden />
          <span className="lp-brand__name">
            ABB Bailey INFI 90 <span>Migration Studio</span>
          </span>
        </Link>

        <nav className="lp-nav" aria-label="Primary">
          {NAV.map((item) => (
            <a key={item.href} href={item.href} className="lp-nav__link">
              {item.label}
            </a>
          ))}
        </nav>

        <div className="lp-header__end">
          <a href="#studio" className="lp-btn lp-btn--primary lp-btn--compact">
            Open Studio
          </a>
          <MobileMenu />
        </div>
      </div>
    </header>
  );
}
