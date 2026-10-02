---
paths:
  - "**/package.json"
  - "**/*.tsx"
  - "**/*.ts"
---

# React Packages

Start with folders, and split one into a package only when a trigger below holds. A package adds a manifest, build settings, export paths and another place to look. It pays only when something outside the app needs the boundary.

## Default Layout

```text
packages/design-system/     the views, with stories (a package from the start: Storybook and its tests need their own build)
apps/<app>/src/             app layer: screens, the request client, useRead
apps/<app>/src/api/         request client (interfaces.ts, *.system.ts) and answer mapping
apps/<app>/shared/contracts/  zod contracts, shared by the app's server and browser code
apps/<app>/shared/          other code both sides use
```

## Triggers for a Separate Package

Move contracts, logic or shared code into `packages/<name>` when at least one of these holds:

1. a second consumer outside the app needs it, such as another app, a CLI or a worker;
2. it must be versioned or released apart from the app;
3. a boundary has to be enforced that a folder cannot hold, such as forbidding React in contracts when a lint rule is not available;
4. it is generated from another source (an OpenAPI document, another service's schema) and regenerated on its own schedule.

When a trigger holds, record which one in the package's README.

## Not Triggers

- The folder has grown. Split it into files instead.
- It "might be reused". Wait for the second consumer.
- The server and the browser both use it. They are one app, and `shared/` exists for that.

Moving a folder to a package later is mechanical: add the manifest and change the import paths. Do not do it early to save that step.
