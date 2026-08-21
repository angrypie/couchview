# Couchview

Couchview is a local-first workspace for reviewing and managing changes in Git repositories.

## Language

**Repository**:
A Git working tree registered with Couchview as an independently reviewable unit. Each linked Git worktree is a separate Repository.
_Avoid_: Project, Checkout

**File Change**:
A review item that represents the current difference for one file between `HEAD` and the Repository's working tree. It combines staged and unstaged content.
_Avoid_: Changed File, Diff

**Review Mark**:
A user confirmation that the current form of a File Change has been inspected. It becomes invalid when that File Change changes; it does not approve or stage the change.
_Avoid_: Approval, Review State, Reviewed File

**Review Queue**:
The ordered collection of File Changes currently present in a Repository. Review Marks and staging do not remove an item; it leaves when it no longer differs from `HEAD`.
_Avoid_: File List, Changed Files
