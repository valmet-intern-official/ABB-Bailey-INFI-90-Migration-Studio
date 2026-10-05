import { Section, SectionHeader } from "./primitives";
import { TraceabilityExplorer } from "./TraceabilityExplorer";

export function TraceabilitySection() {
  return (
    <Section id="traceability" labelledBy="traceability-title">
      <SectionHeader
        id="traceability-title"
        index="07"
        label="Source traceability"
        title="Every output value leads back to the file it came from"
        lead="Records keep the sheet, block and channel they were read from. In the workspace, a loop row expands to its member records and opens the CAD sheet behind each one."
      />
      <TraceabilityExplorer />
    </Section>
  );
}
