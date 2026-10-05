import type { Metadata } from "next";
import { ProcessingView } from "@/components/processing/ProcessingView";

export const metadata: Metadata = {
  title: "Decoding · ABB Bailey INFI 90 Migration Studio",
  robots: { index: false },
};

export default function ProcessingPage() {
  return <ProcessingView />;
}
