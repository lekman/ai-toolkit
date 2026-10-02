---
paths:
  - "**/contracts/**/*.ts"
  - "**/server/**/*.ts"
  - "**/api/**/*.ts"
---

# React Contracts

A contract is the shape of one API answer, written once as a zod schema. The server builds to it and the browser parses with it, so a change on one side that the other does not follow fails a test or shows an error. Without it, the page quietly draws wrong data.

## Where Contracts Live

- One folder, shared by the server and the browser: `shared/contracts/`, one file per area, with an `index.ts` barrel.
- One schema per answer, named for the route (`ordersAnswer`, `orderDetailAnswer`), and its type inferred from it: `export type OrdersAnswer = z.infer<typeof ordersAnswer>;`.
- Never write an `interface` for an answer beside its schema. Inferring the type is what keeps the two from drifting.
- Contracts import zod and each other only: no React, no I/O, no server code.

## Using Them

- The server types what it sends with the contract: a builder returns the inferred type, and an inline answer ends in `satisfies FooAnswer`.
- The browser parses every 2xx answer with `safeParse` in the request client, and nowhere else.
- A failed parse is a result (`reason: "mismatch"`), shown as an error the reader can act on. It is never thrown and never ignored.
- Log a mismatch with each issue's path and code only. Never log the value: answers can carry personal data.
- Unknown keys are stripped (zod's default). Do not make objects strict: an added server field must not break an older page.
- Test the server's real builders against the schemas (`expect(schema.safeParse(built).success).toBe(true)`), and test one drift the schema must reject.

## What Not to Put in a Contract

- View props. The design system has its own types (`react-design-system.md`).
- Defaults or transforms that change values. A contract describes what is sent, and mapping belongs in the app.
- Fields the server does not send, as "optional just in case".

Validate where data crosses into the system from code you do not own, such as another service's answer or a file another team writes. Parse it with a schema at that boundary too.
