# Multi-Repository Workspace

The parent directory
`/Users/vadimnechaev/Workspace/obsidian-plugins` is a project workspace, not a
Git repository. Each child directory, including this one, has independent Git
history, worktrees, tags, and GitHub Releases.

The parent-level `AGENTS.md`, `PROJECT.md`, and `rules/` contain cross-repository
defaults. This repository's `agents.md` and the documents in this directory are
the authoritative plugin-specific instructions.

## Agent workflow

- Create a dedicated worktree and branch per independent change.
- Keep write scopes disjoint between agents.
- Route coordination through direct agent messages; do not write plans, reports,
  or messages into a repository file.
- Review a commit in the worktree that produced it, then merge it into this
  repository's target branch.
- Re-run the complete quality gates after merge and before tagging.

Do not run `git` commands from the parent directory expecting repository state.
Always enter the exact child repository first and verify its branch and remote.
