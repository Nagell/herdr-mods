# Herdr Mods

Independent mods for [Herdr Desktop](https://herdr.dev/), by [Tawsif Aqib](https://github.com/munza).

Install an individual mod by pointing your agent at its folder. Each package has its own source, recipe, preview, and tests. Installing one package does not install the others.

| Mod | Description |
| --- | --- |
| [Better Changes](better-changes/) | Tree/flat Git changes, stage/unstage controls, and one reusable diff tab with inline or side-by-side views. |

![Better Changes](better-changes/preview.png)

## Install Better Changes

Tell your Herdr agent:

> Install only Better Changes from https://github.com/munza/herdr-mods/tree/main/better-changes. Read its RECIPE.md and every source file first, then add it to my existing layout. Preserve my other mods and key bindings.

The mod runs Git in the selected repository and reads changed files. Staging, unstaging, and committing run only when requested through its controls. There is no GitHub API integration or helper binary in this package.

## Test

Requires Node.js for development tests:

```sh
cd better-changes
node --test tests/*.test.cjs
```

The mod itself uses Herdr's native JavaScript runtime and Git, without Node.js at runtime.

## License

[Apache-2.0](LICENSE). See [NOTICE](NOTICE) for upstream attribution.
