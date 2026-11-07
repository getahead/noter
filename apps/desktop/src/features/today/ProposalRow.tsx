import type { ProposalRow as Proposal } from "../../core/bindings";

// @cpt-component:cpt-noter-component-ui-proposal-row:p1
/** One proposal waiting, read-only in M2: its title with the reason under it (Accept and Reject arrive with Activity in M5). */
export function ProposalRow({ proposal }: { proposal: Pick<Proposal, "title" | "reason"> }) {
  return (
    <div data-component="cpt-noter-component-ui-proposal-row" data-variant="compact" data-state="waiting" className="td-prop">
      <div className="td-prop__text">
        <div className="td-prop__title">{proposal.title}</div>
        <div className="td-prop__why">{proposal.reason}</div>
      </div>
    </div>
  );
}
