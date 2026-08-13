---
name: write
description: Apply the house documentation tone to any written deliverable. Use when writing, editing, or reviewing markdown documents, READMEs, Word documents, PDFs, HTML pages, reports, or technical documentation of any kind. Does not cover blog posts for lekman.com (the lekman-blog skill owns that voice) or conversational replies.
---

# Documentation Tone

Rules for the prose in every documentation deliverable. Format mechanics
(building the .docx, .pdf, or .pptx file) belong to the format skills; this
skill governs what the words do once they are on the page.

## Scope and Precedence

- **Applies to:** markdown files, READMEs, Word documents, PDFs, HTML pages,
  reports, runbooks, and any other documentation output.
- **Does not apply to:** blog posts for lekman.com (use the `lekman-blog`
  skill), chat replies, commit messages, or code.
- **Exempt content:** code blocks, terminal output, logs, direct quotes, and
  YAML front matter are never altered to satisfy a tone rule.
- **Accuracy wins.** Technical and factual correctness always supersede tone
  and formatting rules. Never truncate or simplify content into being wrong.

## Voice

- **Plain language.** Assume the reader has no prior knowledge of the topic
  and may not use English as a first language. Define terms and acronyms at
  first use.
- **Brevity.** Keep explanations short and to the point. Prefer short
  sentences; split multi-clause sentences rather than joining them.
- **Active voice.** "Run the test suite", not "the test suite should be
  executed".
- **Measured confidence.** Acknowledge trade-offs. State what is fact, what
  is inference, and what is untested. Do not oversell.
- **UK English** spelling throughout.

## Banned Constructions

- **Empty modifiers.** Never use adjectives or adverbs that add no
  information: comprehensive, detailed, extensive, thorough, robust, seamless,
  powerful, cutting-edge.
- **Filler phrases.** Never open with or pad using: "It's worth noting
  that...", "As we can see...", "In today's fast-paced world...", or any
  sentence that restates the heading above it.
- **Em dashes.** Never use the em dash character. Replace with a colon, a
  full stop, a comma, or restructure the sentence.
- **Hyphenated emphasis.** No "must-have" or "well-known pattern". Rewrite so
  plain words carry the weight.

## Structure

- **Reader first.** Name the intended reader early when the document is
  longer than a page. Do not over-explain basics to that reader, and do not
  under-explain to everyone else.
- **Foundations before depth.** Define key concepts in plain terms before
  building on them. A diagram often beats a paragraph here.
- **Title case headings.** Capitalise each word except binding words (a, an,
  the, and, or, but, for, in, on, at, to, with, of, by, from), unless first
  or last in the heading. Acronyms and code identifiers keep their casing.
- **At most three heading levels** below the document title. Flatten deeper
  nesting into lists or tables.
- **One idea per chunk.** A paragraph, list, table, or callout carries one
  topic. Convert any series of three or more items into a list. Use a table
  when the reader must compare items across shared attributes.
- **Link text is the target's title**, never a filename or path. Read the
  target's H1 to find it.
- **End with actions where the document asks for them.** Takeaways are
  specific and actionable, not abstract.

## Export Safety

These rules exist because markdown is often the source for Word and PDF:

- **No horizontal rules** (`---`, `***`, `___`) as section dividers; they
  become page breaks on export. Heading structure provides the separation.
  Front matter delimiters at the top of the file are the one exception.
- **Kebab-case file names** for markdown other than `README.md`.
- Keep heading wording identical between any table of contents and the
  section it points to.

## Quality Check

Before presenting a document, verify:

- [ ] No em dashes, no hyphenated emphasis, no empty modifiers, no filler
- [ ] UK English throughout
- [ ] Headings in title case, at most three levels deep
- [ ] No horizontal rules outside front matter
- [ ] Acronyms defined at first use
- [ ] Code blocks, quotes, and front matter untouched by tone edits
- [ ] The reader can name what they are able to do after reading
