# Notices

Forge Character Builder's own code is licensed under the MIT licence (see
`LICENSE`). The MIT licence covers the code only: the following third-party
material is included under its own terms, which travel with it.

## Rules content

- **System Reference Document 5.1** — Wizards of the Coast, Inc., under the
  Open Game License v 1.0a. The licence and its Section 15 copyright notice
  ship with the client at `/legal/`.
- **System Reference Document 5.2.1** — Wizards of the Coast LLC, under the
  Creative Commons Attribution 4.0 International License
  (https://creativecommons.org/licenses/by/4.0/legalcode). The material is
  reproduced as a subset, converted to this project's content data format and
  reorganised for the builder; the modifications are not endorsed by Wizards
  of the Coast.
- The content XML files are generated from the public elements corpus at
  https://github.com/AuroraLegacy/elements (pinned commit and sha256 manifest
  under `third-party/elements`), which is fetched at build time and is not
  redistributed by this repository beyond the SRD subsets above.

## Character file format

The `.dnd5e` character file format and the content XML format are documented
interoperability formats; this project implements them independently so that
characters and content move between tools that read them. The exporter writes
the header comment other readers of the format key on.

## Typography and page ornaments

`apps/client/public/homebrewery-assets` reproduces fonts and ornaments from
Homebrewery (https://github.com/naturalcrit/homebrewery, MIT License). The
5e-style typefaces bundled with it — Bookinsanity, Mr Eaves Small Caps, Nodesto
Caps Condensed, Scaly Sans and Solbera Imitation Tweak — are by Solbera under
the Creative Commons Attribution-ShareAlike 4.0 International License; Overpass
is by Delve Fonts and Walter Turncoat by Sideshow, both under the SIL Open Font
License 1.1.

The character sheets can be set in the typefaces under
`apps/client/public/sheets/fonts` — Cinzel and Cinzel Decorative (Natanael
Gama), Spectral (the Spectral Project Authors), Alegreya Sans and Almendra
(Huerta Tipográfica), MedievalSharp (Wojciech Kalinowski), Uncial Antiqua
(Astigmatic) and Pirata One (Rodrigo Fuenzalida & Nicolas Massi) — all under the
SIL Open Font License 1.1, with each family's licence text beside its files.
Only the glyphs a sheet uses are embedded in its PDF.

## Software

Runtime dependencies are listed in the `package.json` files and carry their own
licences (notably pdf-lib and PDF.js for character sheets, fflate for
packages, React for the client).

This project is not affiliated with, endorsed, sponsored, or approved by
Wizards of the Coast.
