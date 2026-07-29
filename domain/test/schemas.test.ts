import { describe, it, expect } from 'vitest';
import {
  CompetitorSchema,
  StrategicBriefSchema,
  CampaignSchema,
  CampaignConceptSchema,
  ApprovalSchema,
  PermissionSchema,
  WorkspaceRoleSchema,
  hasPermission,
  permissionsForWorkspaceRole,
} from '../src/index';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const now = new Date(0).toISOString();

describe('runtime validation (the required layer for API/MCP/model-generated data)', () => {
  it('accepts a well-formed Competitor and rejects a malformed one', () => {
    const good = CompetitorSchema.safeParse({
      id: crypto.randomUUID(),
      workspaceId: WORKSPACE_ID,
      name: 'Rival Co',
      profile: { keyMessages: [] },
      createdAt: now,
      updatedAt: now,
      recentMoves: [],
      gaps: [],
    });
    expect(good.success).toBe(true);

    // Missing workspaceId — exactly the shape a buggy caller (or a
    // model hallucinating a payload) would produce.
    const missingWorkspace = CompetitorSchema.safeParse({
      id: crypto.randomUUID(),
      name: 'Rival Co',
      profile: {},
      createdAt: now,
      updatedAt: now,
    });
    expect(missingWorkspace.success).toBe(false);
  });

  it('rejects a StrategicBrief missing a required strategic field rather than silently defaulting it', () => {
    const result = StrategicBriefSchema.safeParse({
      id: crypto.randomUUID(),
      workspaceId: WORKSPACE_ID,
      objective: 'Grow trials',
      productOrService: 'Website builder',
      audienceId: crypto.randomUUID(),
      awarenessStage: 'solution_aware',
      currentCustomerBelief: 'AI builders produce generic templates',
      desiredCustomerBelief: 'AI builders can produce distinctive sites',
      coreProblem: 'Template fatigue',
      valueProposition: 'Every site looks different',
      reasonToBelieve: 'Visibly different layouts per generation',
      primaryMessage: 'Not another template',
      campaignAngle: 'Show, don\'t tell',
      measurementPlan: { primaryMetric: 'Qualified trial conversion rate' },
      // campaignHypothesis intentionally omitted — required by Prompt 6.
      approvalState: 'draft',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    expect(result.success).toBe(false);
  });

  it('enforces the "structured campaign requires a strategic brief ID" rule via the discriminated union', () => {
    const structuredWithoutBrief = CampaignSchema.safeParse({
      kind: 'structured',
      id: crypto.randomUUID(),
      workspaceId: WORKSPACE_ID,
      name: 'Q3 launch',
      approvalState: 'draft',
      createdAt: now,
      updatedAt: now,
      version: 1,
      // strategicBriefId intentionally omitted
    });
    expect(structuredWithoutBrief.success).toBe(false);

    const unstructuredDraftWithoutBrief = CampaignSchema.safeParse({
      kind: 'unstructured_draft',
      id: crypto.randomUUID(),
      workspaceId: WORKSPACE_ID,
      name: 'Quick test post',
      approvalState: 'draft',
      createdAt: now,
      updatedAt: now,
      version: 1,
    });
    expect(unstructuredDraftWithoutBrief.success).toBe(true);
  });

  it('bounds ad concept scores to 0-10 and rejects an out-of-range score', () => {
    const base = {
      id: crypto.randomUUID(),
      workspaceId: WORKSPACE_ID,
      campaignId: crypto.randomUUID(),
      audienceId: crypto.randomUUID(),
      awarenessStage: 'solution_aware',
      objective: 'Drive trials',
      hook: 'Nobody tells you templates all look the same',
      headline: 'Not another template',
      cta: 'Try it free',
      visualConcept: 'Split-screen: generic vs distinctive site',
      strategicRationale: 'Directly counters the #1 objection',
      testingHypothesis: 'Visual proof reduces skepticism more than copy alone',
      platform: 'Instagram',
      format: 'square',
      approvalState: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    expect(CampaignConceptSchema.safeParse(base).success).toBe(true);
    expect(
      CampaignConceptSchema.safeParse({ ...base, score: { audienceRelevance: 15 } }).success
    ).toBe(false);
  });

  it('Approval decision defaults are explicit, not inferred from absence', () => {
    const result = ApprovalSchema.safeParse({
      id: crypto.randomUUID(),
      workspaceId: WORKSPACE_ID,
      requestedByUserId: crypto.randomUUID(),
      actionType: 'campaign.publish',
      proposedPayload: { campaignId: crypto.randomUUID() },
      humanReadableSummary: 'Publish Q3 launch campaign to LinkedIn',
      decision: 'pending',
      createdAt: now,
      updatedAt: now,
    });
    expect(result.success).toBe(true);
  });

  it('role -> permission mapping never lets editor exceed owner (owner is a strict superset)', () => {
    const editorPermissions = new Set(permissionsForWorkspaceRole('editor'));
    const ownerPermissions = new Set(permissionsForWorkspaceRole('owner'));
    for (const permission of editorPermissions) {
      expect(ownerPermissions.has(permission)).toBe(true);
    }
    expect(hasPermission('editor', 'campaigns:publish')).toBe(false);
    expect(hasPermission('owner', 'campaigns:publish')).toBe(true);
  });

  it('the Permission enum is the same vocabulary usable for MCP connection scopes', () => {
    const parsed = PermissionSchema.safeParse('businessbrain:read');
    expect(parsed.success).toBe(true);
    expect(PermissionSchema.safeParse('not_a_real_scope').success).toBe(false);
  });

  it('WorkspaceRole matches exactly what intelligence_profile_members enforces (CHECK (role IN (\'owner\',\'editor\',\'viewer\')))', () => {
    expect(WorkspaceRoleSchema.options).toEqual(['owner', 'editor', 'viewer']);
  });
});
