import { ConnectivitySection } from "@/components/landing/ConnectivitySection";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { Footer } from "@/components/landing/Footer";
import { Hero } from "@/components/landing/Hero";
import { OutputsSection } from "@/components/landing/OutputsSection";
import { PlatformSection } from "@/components/landing/PlatformSection";
import { ReconstructionSection } from "@/components/landing/ReconstructionSection";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { TraceabilitySection } from "@/components/landing/TraceabilitySection";
import { ValidationSection } from "@/components/landing/ValidationSection";
import { WorkflowSection } from "@/components/landing/WorkflowSection";

export default function HomePage() {
  return (
    <div className="lp">
      <a href="#main" className="lp-skip">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">
        <Hero />
        <PlatformSection />
        <WorkflowSection />
        <ReconstructionSection />
        <ConnectivitySection />
        <OutputsSection />
        <TraceabilitySection />
        <ValidationSection />
        <FinalCTA />
      </main>
      <Footer />
    </div>
  );
}
