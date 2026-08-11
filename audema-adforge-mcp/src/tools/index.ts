import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerBrandTools } from './brandTools.js';
import { registerBriefTools } from './briefTools.js';
import { registerAngleTools } from './angleTools.js';
import { registerConceptTools } from './conceptTools.js';
import { registerCopyTools } from './copyTools.js';
import { registerLayoutTools } from './layoutTools.js';
import { registerExportTools } from './exportTools.js';
import { registerCampaignTools } from './campaignTools.js';
import { registerCampaignDraftTools } from './campaignDraftTools.js';
import { registerOptimizationTools } from './optimizationTools.js';
import { registerDcoTools } from './dcoTools.js';
import { registerComplianceTools } from './complianceTools.js';
import { registerCalibrationTools } from './calibrationTools.js';
import { registerTeardownTools } from './teardownTools.js';
import { registerAbTestTools } from './abTestTools.js';

export function registerAllTools(server: McpServer) {
  registerBrandTools(server);
  registerBriefTools(server);
  registerAngleTools(server);
  registerConceptTools(server);
  registerCopyTools(server);
  registerLayoutTools(server);
  registerExportTools(server);
  registerCampaignTools(server);
  registerCampaignDraftTools(server);
  registerOptimizationTools(server);
  registerDcoTools(server);
  registerComplianceTools(server);
  registerCalibrationTools(server);
  registerTeardownTools(server);
  registerAbTestTools(server);
}
