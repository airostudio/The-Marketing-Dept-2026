/**
 * audema-domain-contracts — public barrel export.
 *
 * See docs/audema-mcp/DATA_MODEL.md for the human-readable version of every
 * schema exported here, and docs/audema-mcp/DECISIONS.md for why the shapes
 * below look the way they do (particularly Organisation/Workspace).
 */

export * from './ids';
export * from './enums';
export * from './base';
export * from './workspaceIsolation';
export * from './agencyIsolation';

export * from './entities/organisation';
export * from './entities/workspace';
export * from './entities/user';
export * from './entities/workspaceMembership';
export * from './entities/role';
export * from './entities/permission';
export * from './entities/brandProfile';
export * from './entities/audience';
export * from './entities/offer';
export * from './entities/competitor';
export * from './entities/marketSignal';
export * from './entities/strategicBrief';
export * from './entities/campaign';
export * from './entities/campaignConcept';
export * from './entities/creativeSpecification';
export * from './entities/creativeAsset';
export * from './entities/approval';
export * from './entities/experiment';
export * from './entities/performanceSnapshot';
export * from './entities/campaignLearning';
export * from './entities/mcpConnection';
export * from './entities/mcpToolInvocation';

// Agency Edition (docs/audema-agency/)
export * from './entities/agency';
export * from './entities/agencyMember';
export * from './entities/agencyInvitation';
export * from './entities/clientMemberAccess';
export * from './entities/agencySubscription';
export * from './entities/auditLog';
export * from './billing/agencyPricing';
