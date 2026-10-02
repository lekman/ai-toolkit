---
paths:
  - "**/*.ts"
  - "**/*.tsx"
---

# React Business Logic

Business rules are plain TypeScript that runs without React, a browser or a network, so a unit test can check each rule directly.

## Rules

- A rule is a pure function of its inputs: a status from figures, a rate from counts, an overdue flag from dates and targets. Pass `now` in, never read the clock inside a rule.
- New logic goes in a static class in its own file, named for the domain (for example `Answers`), with its types in `types.ts`, as the clean-architecture rule describes where the project has it. An existing module of pure functions is fine until it is next changed.
- Logic files import contracts and other logic, never React, a component, or the design system's components. A design-system type such as a status tone is the one allowed import, because it names the view's vocabulary.

## I/O

- Anything that calls out (HTTP, storage, the DOM for a download, the clock where it matters) lives in a `*.system.ts` file behind an interface in `interfaces.ts`.
- Business logic and app code take the interface. The production class is the default, and a test passes its own.
- A `*.system.ts` file holds no rule. It translates between the outside world and values.

## Where It Is Called

- The app calls logic to map contract data into view props.
- The server calls the same logic where it builds an answer.
- A view never calls logic. It receives the result as a prop.
