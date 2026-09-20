import Image from "next/image";
import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="brand">
          <Image
            src="/valmet-logo.webp"
            alt="Valmet"
            width={140}
            height={40}
            className="brand__logo"
            priority
          />
          <span className="brand__divider" aria-hidden>
            |
          </span>
          <span className="brand__product">ABB Bailey INFI 90 Migration Studio</span>
        </Link>
        <nav className="site-nav" aria-label="Primary">
          <a href="#upload">Services</a>
          <a href="#capabilities">Capabilities</a>
          <a href="#workflow">Workflow</a>
          <a href="#contact">Contact</a>
        </nav>
        <a href="#upload" className="btn btn-sm">
          Get Started
        </a>
      </div>
    </header>
  );
}
