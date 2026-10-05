import { Section, SectionHeader } from "./primitives";
import { WorkflowStepper } from "./WorkflowStepper";

export function WorkflowSection() {
  return (
    <Section id="workflow" labelledBy="workflow-title" tone="alt">
      <SectionHeader
        id="workflow-title"
        index="03"
        label="How it works"
        title="One pass, five stages, the same result every time"
        lead="Every session runs the same rule-based sequence on the uploaded package, so the same input yields the same deliverables. Results stay with that session, not in a shared project library."
      />
      <WorkflowStepper />
    </Section>
  );
}
