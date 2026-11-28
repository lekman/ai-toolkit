# Prototypes

[ai-toolkit](../../README.md) / [Practices](../README.md) / [Engineering with Agents](README.md)

Explore with small, cheap prototypes. Then build the production version from
the specification, using engineering patterns a person chose. The prototype
teaches you what to build, and its code is thrown away.

## The Practice

Describing software in plain language and accepting what the agent produces,
often called vibe coding, is a fast way to find out what you want. It is a
poor way to build what you will operate for years. Keep the two activities
apart.

### Explore Cheaply

Pick the cheapest tool that answers the question.

| Question                                   | Tool                                                           |
| ------------------------------------------ | -------------------------------------------------------------- |
| How do the parts relate?                   | A whiteboard or a diagram                                      |
| What should the screen look and feel like? | An artifact, a single page the model builds that you can click |
| Does this library or API do what we need?  | A throwaway script                                             |
| Will users understand the flow?            | A clickable mock shown to two users                            |

A prototype has no tests, no architecture and no error handling, and that is
correct for its purpose. Set a time limit before starting, measured in hours.

### Carry the Learning Forward

When the prototype has answered its question, write down what it showed.

- Scenarios for the behaviour you now know you want. See
  [Goals and Specifications](goals-and-specs.md).
- Decisions it settled, such as which library, and the reason.
- Questions it raised that the specification must answer.

Then archive or delete the prototype.

### Build Production Code from the Specification

Production work starts from the scenarios with the structure decided in
advance. A person chooses the layers, the contracts between them, the error
handling and the test approach, and encodes them as rules and checks. The
[Rules](../../rules/README.md) folder holds one example set, for a React
application split into layers.

Do not ask the agent to turn the prototype into production code. It will keep
the prototype's structure, because that structure is the strongest signal in
its context.

## Why

A prototype is cheap because it skips everything that makes software
dependable. That saving is real only if the prototype stays small and is not
shipped. An agent makes it easy to keep going, adding one more feature to the
prototype until it is the product, with no decision recorded on the way.

Agents also follow patterns well and choose them badly. Given a clear
structure and a check that enforces it, an agent produces consistent code.
Given a blank repository, it invents a structure per session.

## The Failure It Prevents

- A prototype that became the product, with structure nobody chose.
- Weeks of agent time spent on a direction a one-hour mock would have ruled
  out.
- Production code where each feature follows a different pattern.

## How It Is Enforced

- Prototypes live outside the production repository, or on a branch with a
  name that branch protection refuses to merge.
- The production repository has its structure checks in place before the
  first feature, so prototype code pasted in fails the build. See
  [Mechanical Checks](mechanical-checks.md).
- The specification links the prototype as a reference and states that its
  code was not reused.
