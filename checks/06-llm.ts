/** PRD check 06 (optional): one structured-output call that turns a brief into policy JSON. SKIP without a key. */
import { llmConfigFromEnv, parseBriefWithLlm, parseBriefWithRules } from "@coop/agents/brief";
import { loadEnv } from "@coop/agents/config";
import { Report, errorText } from "./lib.js";

loadEnv();
const report = new Report("06 LLM brief parsing (optional)");
const config = llmConfigFromEnv();

if (!config) {
  report.skip("LLM_BASE_URL / LLM_API_KEY / LLM_MODEL not all set", "the deterministic rules parser is used; this is a supported mode");
  process.exit(report.finish());
}

const briefs = [
  "buy 3 API credits if the price drops below 0.6",
  "need 2 credits now, up to 1.1",
  "I only want to buy 5 credits when the group gets a real discount, never above 0.75 each",
];
for (const brief of briefs) {
  try {
    const policy = await parseBriefWithLlm(brief, config);
    const rules = (() => {
      try {
        return parseBriefWithRules(brief).policy;
      } catch {
        return null;
      }
    })();
    const agrees = rules ? rules.units === policy.units && rules.max_unit_price === policy.max_unit_price : null;
    report.pass(`"${brief}"`, `llm: ${policy.archetype}, ${policy.units} units, max ${policy.max_unit_price} yocto${agrees === null ? "" : agrees ? "; matches the rules parser" : "; differs from the rules parser"}`);
  } catch (e) {
    report.fail(`"${brief}"`, errorText(e));
  }
}
process.exit(report.finish());
