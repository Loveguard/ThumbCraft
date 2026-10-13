# Contributing to ThumbCraft

Thanks for helping make ThumbCraft better! Bug reports, ideas and pull requests are all welcome.

## Reporting a bug or idea

Use the [issue forms](https://github.com/Loveguard/ThumbCraft/issues/new/choose). For bugs, a screenshot plus your
ThumbCraft and Minecraft versions make most problems quick to fix. Security problems go through
[a private advisory](https://github.com/Loveguard/ThumbCraft/security/advisories/new) instead (see
[SECURITY.md](SECURITY.md)).

## Making a change

1. For anything big, open an issue first so we can agree on the approach.
2. Set up the project (Node.js 22):

   ```bash
   git clone https://github.com/Loveguard/ThumbCraft.git
   cd ThumbCraft
   npm install
   npm run dev
   ```

3. Before opening a pull request, run the same checks CI does:

   ```bash
   npm run typecheck
   npm run format:check
   npm test
   ```

The project layout, how terrain and models are produced, and how releases work are in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md).

## Ground rules

- Never commit Minecraft's own files (textures, models, jars). ThumbCraft reads them from the user's install; see
  [docs/LEGAL.md](docs/LEGAL.md).
- Keep pull requests focused on one change.
- Be kind. This project follows the [Code of Conduct](CODE_OF_CONDUCT.md).
