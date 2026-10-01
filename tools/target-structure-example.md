<!--
  Target-structure markdown format (see tools/build-target-structure-from-markdown.mjs):

  - A heading line (any level, "#" through "######") starts a new TOP-LEVEL
    department. Heading level is ignored -- any "#..." line just means "start
    a fresh depth-0 folder". Bold/italics inside it are stripped.

  - Every deeper folder is a line "/ Name", indented with SPACES ONLY, 2 spaces
    per depth level below its department (0 spaces = a direct child of the
    heading, 2 spaces = a grandchild, 4 = great-grandchild, and so on --
    however deep you need). Bold/italics around the name are stripped, so
    "**/ Name**" and "/ Name" are equivalent -- use bold or not, purely for
    your own readability while editing.

  - Blank lines are ignored -- add them freely for readability, they carry no
    structural meaning.

  - Anything else (plain prose, comments, this very block) is ignored, not an
    error -- so you can leave notes in the file.

  - Indentation must increase by exactly one level at a time (no skipping),
    must be a clean multiple of 2 spaces, and sibling names must be unique
    under their parent -- the tool checks all of this and reports the exact
    line number if something's off, rather than silently misplacing a folder.
-->

## Auto Financing
  / 01 - Shortcut to EdenPark brand documents
  / 02 - Strategy
    / 2026 Planning
    / Personas
  / Marketing Automation
    / Promotional
      / [Campaign name] ie. IQ Abandoned Cart
        / [Variation] ie. 2605_MayNoPay
          / [Channel] ie. Email or SMS
            / Content
            / Creative
    / Transactional
      / [Campaign name] ie. IQ Abandoned Cart
        / [Variation] ie. 2605_BAU
          / [Channel] ie. Email or SMS
            / Content
            / Creative
  / Events
  / Organic Social Media
  / Sales Enablement
  / Website
    / Content
    / Creative
    / Development

## Credit Cards
  / Home Trust Equityline Visa
  / Home Trust Preferred Visa
  / Walmart Reward Mastercard

## Cross-Functional
  / Same as current
