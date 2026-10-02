---
paths:
  - "**/*.tsx"
  - "**/*.stories.tsx"
---

# React Design System

The design system draws. Everything a user sees comes from it, so the whole product can be reviewed in Storybook without a server or a sign-in.

## What a View Contains

A view is a function of its props. It may hold UI state: an open panel, an expanded cell, a sort a grid keeps in the browser.

It contains:

- props typed as the view needs them, named for the view and not for the server (`figures`, `boxes`, `load`);
- JSX composed from the design system's own components;
- the words on the screen, and the formatting of numbers and times for display;
- callbacks for each user action (`onOpen`, `onDownload`, `onRun`), with no knowledge of what they do.

It never contains:

- `fetch`, a request client, a session or a token;
- a server contract type or schema (see `react-contracts.md`);
- a business rule, such as a threshold, a status rule or an eligibility check. The app passes the result (see `react-logic.md`);
- routing, or reading the address bar.

## Loading States

A view that shows data takes its state as one discriminated union, and draws loading, data, not configured and failed in the same way as every other view.

```ts
type Load<T> = { kind: "loading" } | { kind: "ok"; data: T } | { kind: "unconfigured" } | { kind: "failed"; status: number; message?: string };
```

Every case gets a story.

## Stories Are the Tests

- Every component and every page has stories, and each story has a `play` function that checks what a reader would check.
- Story tests run in a real browser with accessibility checks that fail the build.
- Story data is synthetic and inline. No real customer, patient or person.
- A page story composes the page as the app does, with the state passed in, so the whole screen is reviewable.

## Styling

- Colour, type, radii and fonts come from theme tokens. A literal in a component is a defect.
- A view styles itself. The app passes no `sx`, `className` or style.
