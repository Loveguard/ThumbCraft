# Legal & publishing notes

This is not legal advice. If you plan to sell ThumbCraft, have a lawyer review it.

- **No Mojang files are distributed.** Textures, models, fonts and sounds are read at runtime from the user's own
  game install. The dedicated server jar and the obfuscation mappings (for mob export) are downloaded from Mojang's
  own servers on the user's machine, after they accept the [Minecraft EULA](https://www.minecraft.net/eula), and
  are never redistributed. This is the same pattern used by widely distributed tools like Blockbench, Mineways
  and Chunky.
- **Required disclaimer:** "NOT AN OFFICIAL MINECRAFT PRODUCT. NOT APPROVED BY OR ASSOCIATED WITH MOJANG OR
  MICROSOFT." It is shown on the start screen; also put it on the download page.
- **Naming and branding:** don't use "Minecraft" in the product name, logo or icon, or the Minecraft logo anywhere.
  "ThumbCraft, a thumbnail maker for Minecraft creators" is the allowed descriptive use. The name contains "Craft"; it is a common English word and isn't the dominant part of the name, but keep the logo and styling clearly original (no Minecraft logo font, no grass-block icon) so it can't be confused with an official product.
- **Users' thumbnails** are fine to publish: Mojang's [Usage Guidelines](https://www.minecraft.net/usage-guidelines)
  allow screenshots and videos (thumbnails included), including monetised ones.
- **Charging money:** free is the safe route. The guidelines restrict selling things that use Minecraft content,
  and a paid tool that only reads the user's own files is a grey area. Donations or sponsorships are the usual
  approach.
- **Third-party code:** three.js and React (MIT), lucide (ISC), Inter, Anton, Bebas Neue, Bungee, Lilita One, Russo One and Titan One (SIL OFL), Luckiest Guy (Apache 2.0), MediaPipe Tasks Vision and its selfie segmentation model (Apache 2.0). Their licences ship with the app in `THIRD_PARTY_NOTICES.md`.
- **Player skins** come from Mojang's public session API on demand and aren't stored or shared beyond the user's
  own project files.
- **Distribution:** releases are unsigned for now (see Installing). No Mojang files ship with the app: the game
  jar and Java are read from the user's computer or downloaded straight from Mojang and Adoptium on request.
