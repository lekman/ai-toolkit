---
paths:
  - "**/*.tsx"
  - "**/*.ts"
---

# React App Layer

The app holds state, handles events, makes requests and binds their answers to design-system views. It renders no layout of its own.

## What an App Component Contains

Write one component per screen or panel, named for what it connects (`OrdersLive`, `CustomerList`). It does four things.

1. reads data through the request client and `useRead`;
2. maps the answer to the view's props with a pure function beside it (`ordersFigures`, `rows`);
3. keeps the screen's state (`useState`) and turns user actions into requests or state changes;
4. returns one design-system view, or composes design-system components into a page.

```tsx
export function OrdersLive(): ReactNode {
  const api = useShopApi();
  const orders = useRead(() => api.orders(), [api]);
  return <OrdersPanel load={rows(Answers.read(orders))} onDownload={(id) => void api.invoice(id)} />;
}
```

It never contains:

- `Box`, `sx`, `className`, or HTML elements used for layout;
- `fetch` or `useEffect` for a request. Use the request client and `useRead`;
- a business rule written inline. Call the logic layer;
- a type that describes a server answer. Import it from the contracts.

`useEffect` stays for browser events the app owns, such as listening to the address bar's hash.

## Requests

- One request client implements an interface with one method per route (for example `IShopApi`). Its implementation is a `*.system.ts` class that takes the fetch function in its constructor, because the token comes from the session. A static class cannot hold it.
- Every method returns a result value and never throws. A refusal, an unreachable server and an answer that breaks its contract are values the screen draws.
- Every answer is parsed with its contract's schema before it is returned.
- `useRead(read, deps)` runs a read on mount and when `deps` change, and drops an answer that arrives too late. It is the only place the request effect is written.
- A pure static class maps a result to the view's `Load` (`Answers.read`), so 503 means "not configured" in every screen.

## Binding

- The mapping from contract data to view props is a pure exported function, tested without a browser.
- Where the view's props match the contract field for field, pass the data through and let the compiler check that it fits.
- Identifiers and other sensitive values travel in request bodies, never in a URL, and never reach a log line.
