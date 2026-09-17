# What belongs in README.md

The README exists to get somebody running, and it is finished when it does. It
holds the commands and nothing else: no rationale, no gotchas, no section
announcing a file that is already discoverable on its own.

When a change adds a capability or a trap, the reflex to reach for the README is
the wrong one. Explanations go where the thing they explain lives: a short
comment beside the code, or a file in `.agents/`. Fixing a README command that
is actually wrong is always in scope; growing the README around it is not.

Comments follow the same rule. One or two lines, and only for what the code
cannot say itself. The long version goes in the commit message.
