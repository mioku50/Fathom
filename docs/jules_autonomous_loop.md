# Fathom Jules Autonomous Development Loop

This document defines how Jules/Codex should develop Fathom step by step without drifting into unrelated work.

## Goal

Jules should keep Fathom moving toward production through small, reviewable PRs:

```text
read README.md
  -> inspect agent_tasks.json
  -> select one safe task
  -> implement one bounded change
  -> add or update tests
  -> update agent_tasks.json
  -> open PR
  -> wait for CI / review
  -> continue with next task
Main Rule

Do not ask the user what to do next while safe work exists in agent_tasks.json.

Ask the user only for:

high or critical risk changes;
production secrets;
payment verification changes;
deployment permissions;
ambiguous product decisions.
Source Priority
README.md
agent_tasks.json
AGENTS.md
docs/architecture.md
docs/codex_worker_plan.md
CI failures
TODO/FIXME comments
Task Selection

Choose the first task with status todo, unless it is:

high or critical risk;
claimed by another worker;
too broad for one PR;
missing clear acceptance criteria.

If the task is too broad, split it into smaller prerequisite tasks.

Risk Gates

Autonomous allowed:

docs;
schemas;
pure modules;
deterministic pricing helpers;
confidence scoring helpers;
tests;
bounded refactors.

Human review required:

.github/workflows/**;
package manager files;
deployment files;
secrets/env handling;
x402 payment verification;
RPC provider changes;
auto-merge permissions.
PR Shape

Every PR must:

cover one task id;
stay inside allowed paths;
avoid unrelated refactors;
update agent_tasks.json;
include validation commands in the PR body.
Failure Loop

If CI fails:

Do not start a new feature.
Fix the failing area first.
Keep the diff small.
Add a regression test when possible.
Done Criteria

A task is done only when:

acceptance criteria are met;
tests or validation pass;
task status is updated;
new discovered work is added as new todo tasks.
