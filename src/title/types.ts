export type TitleProposalTrigger =
	| 'untitled'
	| 'content-mismatch';

export type TitleProposalStatus = 'pending' | 'accepted' | 'rejected';

export interface TitleProposal {
	id: string;
	sourceNotePath: string;
	currentTitle: string;
	proposedTitle: string;
	trigger: TitleProposalTrigger;
	reasoning: string;
	createdAt: string;
	status: TitleProposalStatus;
}
