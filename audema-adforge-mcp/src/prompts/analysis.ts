import type { AdBrief } from '../types.js';

/**
 * Guidance returned by create_ad_brief, instructing the calling model on
 * exactly how to analyse the customer before any ad angle can be written.
 * Analysis is submitted back via submit_customer_analysis.
 */
export function buildCustomerAnalysisGuidance(brief: AdBrief): string {
  return `# Customer Analysis Required

**Business description provided:**
${brief.businessDescription}

Before generating any ad concepts, analyse this business and produce a specific, non-generic customer analysis. Think like a strategist who has actually read the description above — not a template.

Answer each of these with specifics, not categories:

1. **Target customer** — Who exactly buys this? Not "small business owners" — describe their situation, what they're doing right before they'd search for this, what they're afraid of getting wrong.
2. **Pain points** (list 3-5) — What specifically frustrates this customer today? Use language they'd actually use, not marketing abstractions like "inefficiency" or "lack of visibility".
3. **Offer** — What is this business actually selling in this campaign? Be concrete (a product, a service tier, a promotion) — not a mission statement.
4. **Objections** (list 2-4) — Why would this specific customer hesitate? Price, trust, timing, "I can do it myself", past bad experience with a competitor — be specific to this business/category.
5. **Desired action** — The ONE thing this ad should get someone to do. Not "raise awareness" — a concrete next step: call, book, buy, sign up, visit.

Submit your analysis with \`submit_customer_analysis\` using briefId = "${brief.id ?? '<this brief id>'}".`;
}
