import Image from "next/image";
import { NAV } from "./content";

export function Footer() {
  return (
    <footer className="lp-footer">
      <div className="lp-container">
        <div className="lp-footer__grid">
          <div className="lp-footer__brand">
            <Image src="/valmet-logo.webp" alt="Valmet" width={112} height={32} className="lp-brand__logo" />
            <p>
              ABB Bailey INFI 90 Migration Studio — decoding legacy controller data into engineering deliverables.
            </p>
          </div>

          <nav className="lp-footer__col" aria-label="Footer">
            <h2 className="lp-footer__heading">Platform</h2>
            {NAV.map((item) => (
              <a key={item.href} href={item.href}>
                {item.label}
              </a>
            ))}
            <a href="#studio">Open Studio</a>
          </nav>

          <div className="lp-footer__col">
            <h2 className="lp-footer__heading">Contact</h2>
            <a href="mailto:valmet.intern@gmail.com">valmet.intern@gmail.com</a>
            <a href="https://www.valmet.com" target="_blank" rel="noreferrer">
              www.valmet.com
            </a>
          </div>

          <address className="lp-footer__col">
            <h2 className="lp-footer__heading">Headquarters</h2>
            <span>Valmet Technologies Private Limited, 301, Global Port, Mumbai - Bangalore Highway, Baner, Pune 411045</span>
          </address>
        </div>

        <div className="lp-footer__base">
          <p>© {new Date().getFullYear()} Valmet · ABB Bailey INFI 90 Migration Studio</p>        </div>
      </div>
    </footer>
  );
}
