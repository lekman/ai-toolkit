---
paths:
  - "**/*.tsx"
  - "**/*.ts"
---

# React Layers

A React app here has four layers. Each has one job, and code that does another layer's job is moved, not tolerated. The other `react-*` rules give the detail of each layer.

| Layer         | Holds                                                         | Never holds                                                    | Rule                     |
| ------------- | ------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------ |
| Design system | Every view, panel, table and page frame, with stories         | Requests, server contracts, business rules                     | `react-design-system.md` |
| App           | State, events, routing, requests, and binding data to views   | Layout, styling, JSX beyond composing design-system components | `react-app.md`           |
| Contracts     | One zod schema per API answer, with the type inferred from it | React, I/O, defaults the server does not send                  | `react-contracts.md`     |
| Logic         | Business rules as pure code, and I/O behind interfaces        | React, the DOM in rule code, fetch outside `*.system.ts`       | `react-logic.md`         |

Dependencies point one way, so no layer imports from a layer above it.

```text
app ──▶ design system
 │
 ├───▶ logic ──▶ contracts
 └───▶ contracts ◀── server
```

The design system imports none of the others. A view takes view-shaped props, and the app maps a contract's data to them.

Start a new screen in the design system, with its stories, and connect it from the app afterwards. Packages are split only on the triggers in `react-packages.md`.
