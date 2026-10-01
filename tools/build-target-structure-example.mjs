// Converts 2607_MarketingFolderStructure.md into the tool's target-structure JSON
// schema ({name, children}). The source doc is inconsistently formatted (headings,
// bold, and "/" don't reliably map to depth; some lines cram several sibling
// names together; some lines repeat/contradict across departments) -- this is a
// best-effort, human-reasoned transcription for a TEST/EXAMPLE file, not a
// mechanical parse. Ambiguous spots are resolved by matching the clearer of two
// near-duplicate patterns in the doc (e.g. the Awareness/In House/Partners tree
// appears twice, once compressed and once with clear "-" indentation) and by
// preserving the source's own inconsistencies (e.g. hyphen vs en-dash in "01 -
// Shortcut..." labels, Templates/Testing/UGC nested under Performance Marketing
// in some departments but siblings of it in others) rather than silently
// "fixing" them.

import { writeFileSync } from "node:fs";

const leaf = (name) => ({ name });
const node = (name, children) => ({ name, children });

// Shared building blocks -- these exact same sub-trees appear (with only minor
// line-formatting differences) in Auto Financing, Deposits > Oaken, Direct
// Lending, and Mortgages.

function brandKit() {
  return [
    leaf("01 - Logos"),
    leaf("02 - Brand Guide"),
    leaf("Design Assets"),
    leaf("Legal"),
    leaf("Messaging Framework"),
    leaf("PPT Templates"),
    leaf("Signage"),
    leaf("Stationary"),
  ];
}

function campaignChannel(campaignName, variationName) {
  return node(campaignName, [
    node(variationName, [node("[Channel] ie. Email or SMS", [leaf("Content"), leaf("Creative")])]),
  ]);
}

function marketingAutomation() {
  return node("Marketing Automation", [
    node("Promotional", [campaignChannel("[Campaign name] ie. IQ Abandoned Cart", "[Variation] ie. 2605_MayNoPay")]),
    node("Transactional", [campaignChannel("[Campaign name] ie. IQ Abandoned Cart", "[Variation] ie. 2605_BAU")]),
  ]);
}

function awareness() {
  return node("Awareness", [
    node("In House", [leaf("Amazon Ads"), node("DV360", [leaf("Audio"), leaf("Banner"), leaf("CTV"), leaf("YouTube")])]),
    node("Partners", [leaf("Cluep"), leaf("EQ Works"), leaf("MiQ"), leaf("Quantcast"), leaf("VDX.TV"), leaf("Yahoo")]),
    node("ToF Social", [leaf("Pinterest"), leaf("Snapchat")]),
    leaf("TikTok"),
  ]);
}

function performanceMarketing(extraChildren = []) {
  return node("Performance Marketing", [
    leaf("~Archive"),
    leaf("Admin"),
    awareness(),
    leaf("Budget"),
    leaf("Integrated"),
    node("Paid Search", [leaf("Google"), leaf("Microsoft")]),
    leaf("Planning"),
    leaf("Reporting"),
    node("Social Advertising", [leaf("Facebook"), leaf("Instagram")]),
    ...extraChildren,
  ]);
}

function strategy2026() {
  return node("02 - Strategy", [leaf("2026 Planning"), leaf("Personas"), leaf("Research")]);
}
function strategy2026EnDash() {
  return node("02 – Strategy", [leaf("2026 Planning"), leaf("Personas"), leaf("Research")]);
}

const root = node("Marketing", [
  node("01 - Administration", [
    leaf("Briefing Templates"),
    node("Budget", [leaf("~Archive"), leaf("2025"), leaf("2026"), leaf("Marketing Dashboard")]),
    node("London Office", [leaf("Fire Plan"), leaf("Invoices")]),
    leaf("Recruitment"),
    leaf("Team Meetings"),
    leaf("Toronto Office"),
    node("Training Documents", [leaf("Design")]),
    leaf("Vendor Management"),
  ]),

  node("02 - Brand Documents", [
    node("Co-branded", [
      leaf("01 - Logos"),
      leaf("Legal"),
      leaf("PPT Templates"),
      leaf("Signage"),
      leaf("Stationary"),
      leaf("Values"),
    ]),
    node("EdenPark", brandKit()),
    node("Fairstone", [
      leaf("01 - Logos"),
      leaf("02 - Brand Guide"),
      leaf("Design Assets"),
      leaf("Legal"),
      leaf("Messaging Framework"),
      leaf("PPT Templates"),
      leaf("Retail Financing"),
      leaf("Signage"),
      leaf("Stationary"),
    ]),
    node("Fairstone Bank", brandKit()),
    node("Home Trust", brandKit()),
    node("Oaken", brandKit()),
  ]),

  node("03 - Shared Asset Library", [
    leaf("Fonts"),
    leaf("Icon Library"),
    leaf("Image Library"),
    leaf("Video Library"),
    leaf("Audio Library"),
  ]),

  node("Auto Financing", [
    leaf("01 - Shortcut to EdenPark brand documents"),
    strategy2026(),
    marketingAutomation(),
    leaf("Events"),
    leaf("Organic Social Media"),
    leaf("Sales Enablement"),
    node("Website", [leaf("Content"), leaf("Creative"), leaf("Development")]),
  ]),

  node("Credit Cards", [
    leaf("Home Trust Equityline Visa"),
    leaf("Home Trust Preferred Visa"),
    leaf("Walmart Reward Mastercard"),
  ]),

  node("Cross-Functional", [leaf("Same as current")]),

  node("Deposits", [
    leaf("Broker Deposits"),
    leaf("01 – Shortcut to Home Trust brand documents"),
    leaf("APEX"),
    node("Oaken", [
      leaf("01 – Shortcut to Oaken brand documents"),
      strategy2026EnDash(),
      node("Campaigns", [leaf("YYMM_CampaignName")]),
      marketingAutomation(),
      leaf("Organic Social Media"),
      performanceMarketing([leaf("Templates"), leaf("Testing"), leaf("UGC")]),
      node("Sales Enablement", [leaf("Forms")]),
      node("Store Materials", [leaf("Brochures"), leaf("Rate Cards")]),
      node("Website", [leaf("Content"), leaf("Creative"), leaf("Development"), leaf("Landing Pages")]),
      leaf("Videos"),
    ]),
  ]),

  node("Direct Lending", [
    leaf("01 – Shortcut to Fairstone brand documents"),
    strategy2026EnDash(),
    leaf("Affiliates"),
    node("Branch Network", [
      leaf("Branch Management"),
      node("NBOs, OANs, Directory", [leaf("Branch Requests"), leaf("DM Calls")]),
      node("Guides", [leaf("Merchandising")]),
      leaf("OLM Letters"),
      leaf("Signage"),
      leaf("Surveys"),
    ]),
    node("Campaigns", [leaf("YYMM_CampaignName")]),
    leaf("Digital Branch"),
    node("Direct Mail", [
      leaf("Budget"),
      leaf("Canada Post"),
      node("Creative Packages", [leaf("Flight Processing"), leaf("IWCO")]),
      leaf("Schedules"),
    ]),
    marketingAutomation(),
    leaf("Organic Social Media"),
    performanceMarketing(),
    leaf("Templates"),
    leaf("Testing"),
    leaf("UGC"),
    node("Product", [
      leaf("1-Click Renewals"),
      leaf("Branch OAM"),
      leaf("Contact Engine"),
      leaf("Debt Relief Plan"),
      leaf("Instant Quote"),
      leaf("Rules Engine"),
    ]),
    node("Website", [
      node("Fairstone.ca", [leaf("Content"), leaf("Creative"), leaf("Development"), leaf("Landing Pages")]),
      node("FairstoneBank.ca", [leaf("Content"), leaf("Creative"), leaf("Development")]),
      node("Branch Pages", [leaf("Content"), leaf("Creative"), leaf("Development")]),
    ]),
    leaf("Videos"),
  ]),

  node("Mortgages", [
    leaf("01 – Shortcut to Home Trust brand assets"),
    strategy2026EnDash(),
    node("Campaigns", [leaf("YYMM_CampaignName")]),
    marketingAutomation(),
    node("Events", [leaf("Broker Appreciation"), leaf("MPC"), leaf("Tom Trenouth")]),
    leaf("Organic Social Media"),
    node("Product Documents", [
      leaf("All Products Brochure"),
      leaf("Broker Playbook"),
      leaf("Accelerator Mortgages"),
      leaf("Classic Mortgages"),
      leaf("Commercial Mortgages"),
      leaf("Reverse Mortgages"),
      leaf("Spire"),
    ]),
    node("Sales Platforms", [leaf("Concierge"), leaf("LOFT")]),
    node("Website", [leaf("Content"), leaf("Creative"), leaf("Development")]),
  ]),

  node("Retail Financing", [leaf("01 - Shortcut to Fairstone brand assets")]),
]);

const outPath = process.argv[2] || "target-structure-example.json";
writeFileSync(outPath, JSON.stringify(root, null, 2));
console.log(`Wrote ${outPath}`);

// Quick self-check: no duplicate names among any node's direct children
// (would trip the tool's sibling-collision validator on load).
function checkDuplicates(n, path) {
  if (!n.children) return;
  const seen = new Map();
  for (const c of n.children) {
    const lower = c.name.toLowerCase();
    if (seen.has(lower)) {
      console.warn(`DUPLICATE sibling name "${c.name}" under ${path || "(root)"}`);
    }
    seen.set(lower, true);
    checkDuplicates(c, `${path}/${c.name}`);
  }
}
checkDuplicates(root, "");

function countNodes(n) {
  return 1 + (n.children ?? []).reduce((sum, c) => sum + countNodes(c), 0);
}
console.log(`Total nodes (including discarded root wrapper): ${countNodes(root)}`);
