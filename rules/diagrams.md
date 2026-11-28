---
paths:
  - "**/*.md"
  - "**/*.svg"
---

# Diagrams

When a markdown page needs a diagram, hold it to these checks. Worked
examples of each type are in the ai-toolkit repository, under `practices/`.
This rule holds every value needed to draw one without them.

## Choose the Form

- A diagram of up to about eight boxes is an SVG file laid out by hand and
  saved beside the page that uses it.
- Mermaid is for diagrams with many nodes or ones that change often, where
  laying out by hand costs more than it returns.

## Choose the Type

Pick the type from what the diagram has to show. Do not draw an arrow where
there is no order.

| Type       | Shows                                             | Layout                                                         | Numbered | Example in ai-toolkit            |
| ---------- | ------------------------------------------------- | -------------------------------------------------------------- | -------- | -------------------------------- |
| Workflow   | Steps in order, with or without a loop            | Rows of three, and a cycle reads clockwise                     | Yes      | `engineering/workflow.svg`       |
| Groups     | Separate questions, each with its own options     | One band for each group, with cards inside                     | No       | `isolation-questions.svg`        |
| Routes     | Inputs that take different paths to one result    | One row for each route, meeting a result on the right          | No       | `retrieval-routes.svg`           |
| Comparison | The same stages set side by side for two subjects | One row for each subject under shared column heads             | No       | `prose-and-code.svg`             |
| Budget     | Parts of a whole, drawn to scale                  | One bar split in proportion, with a line for a limit           | No       | `local-models/memory-budget.svg` |
| Layers     | Controls or scopes that sit one inside another    | Nested bands, the widest outside and the subject in the middle | No       | `docs/control-layers.svg`        |

When none of the six fits, add a type to this table before drawing it, so
the next diagram of that kind looks the same.

## Draw the SVG

- Give each box a label in capitals, a title of up to three words and at
  most two lines of description.
- Let colour mean one thing in a diagram. In a workflow it is who owns the
  step. In the other types it is the group, the route or the row. Write the
  same thing in the box's label, so colour is never the only signal.
- Draw the main path solid. Draw optional inputs and feedback dashed, each
  with a short label.
- Use a `viewBox` 900 units wide. Titles are 20px, descriptions 15px, and no
  text is smaller than 12px.
- Use the system font stack. Load no external fonts, images or scripts.
- Keep the styles inside the file, with a `prefers-color-scheme: dark` block.
  Every box and band carries its own fill, and arrows and loose labels use a
  mid grey, so the diagram holds on a light or a dark page.
- Include `<title>` and `<desc>` elements.

Each type adds a few rules of its own.

- **Workflow.** Number the steps in reading order, with each number in a
  filled circle at the top left of its box. Add a legend along the bottom.
- **Groups.** Give each band a heading and one line under it that says what
  the group decides or costs. Join two bands with a line of text when they
  are independent, and with an arrow only when one follows the other. The
  cards in a band may form a short sequence of their own.
- **Routes.** Keep each route on one row and in one colour. Give the result
  its own colour and place it level with the middle of the rows. Routes may
  also start from one box and split.
- **Comparison.** Put a heading in capitals above each column. Keep each
  subject on one row and in one colour.
- **Budget.** Make each part as wide as its share of the whole, and write its
  amount as the title. Mark a limit with a dashed line and a label, and put
  the scale under the bar.
- **Layers.** Draw each layer as a band inside the one that encloses it, 24
  in from every side, and give each its own colour. Put its name and one
  line at the top left, and what makes it fail at the top right. Place the
  subject in the middle as a neutral box.

## Use These Values

Sizes are in `viewBox` units.

| Part                       | Value                                                       |
| -------------------------- | ----------------------------------------------------------- |
| Box                        | 250 wide, 124 tall, corner radius 10, 2 px border           |
| Gap between boxes          | 45 across, 88 down in a workflow, 24 down between rows      |
| Margin                     | 30 at each side                                             |
| Number circle              | Radius 13, number 14px bold                                 |
| Box label                  | 12.5px bold, capitals, letter spacing 1.2px                 |
| Column heading             | The same as a box label, in the loose label colour          |
| Band                       | Corner radius 12, 1.5 px border, 24 padding                 |
| Band heading and its line  | 18px bold, then 14px                                        |
| Card inside a band         | 84 tall, a title and one line, no label                     |
| Cards across a band        | Three at 248 wide, or four at 174 wide                      |
| Arrows                     | 2.5 px line, dashes of 7 and 5 for optional paths           |
| Arrows and loose labels    | `#6f7780` on light, `#9198a1` on dark                       |
| Title and description text | `#1f2328` and `#32383f`, or `#f0f6fc` and `#d1d9e0` on dark |
| Band fill and border       | `#f6f8fa` and `#d0d7de`, or `#151b23` and `#3d444d` on dark |

There are three colours. Each has a fill, a border and a label colour, in a
light and a dark set. Use them in this order. A box that belongs to no
group, such as a start, a shared result or an unused share, is neutral. It
uses the band fill with a border of `#8c959f`, or `#656d76` on dark.

| Colour | In a workflow | Light fill, border, label       | Dark fill, border, label        |
| ------ | ------------- | ------------------------------- | ------------------------------- |
| First  | Person        | `#ddf4ff`, `#0969da`, `#0550ae` | `#121d2f`, `#4493f8`, `#79c0ff` |
| Second | Agent         | `#fff8c5`, `#9a6700`, `#7d4e00` | `#2a2111`, `#d29922`, `#e3b341` |
| Third  | Machine       | `#dafbe1`, `#1a7f37`, `#116329` | `#12261e`, `#3fb950`, `#56d364` |

## Place It on the Page

- The heading above the diagram names what it is, such as "Workflow".
- Embed it with an alt text of one to three words. Do not write a sentence
  of alt text.
- Do not put an explanatory paragraph under the diagram. For a workflow, put
  the step by step text in a collapsed `<details>` block with a `<summary>`,
  as a numbered list that matches the numbers in the diagram.
- For any other type, every amount and name in the diagram must also be in
  the page's text, in the section around it, in a table or in a collapsed
  `<details>` block. A reader who cannot see the image must lose nothing.

## Check It

- Render the file on a light background and on a dark one, and read every
  label, before it is committed.
