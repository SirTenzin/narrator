# Changesets

Every pull request that changes a published package should include a changeset. Run `bun changeset`, pick the packages you changed, choose patch, minor or major, and write one sentence for the changelog. Commit the generated file with your change.

On master, the Release workflow collects the changesets into a "Version packages" pull request. Merging that pull request publishes only the packages whose version went up.
