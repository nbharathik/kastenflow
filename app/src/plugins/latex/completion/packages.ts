// Package and class names for `\usepackage{` and `\documentclass{`: the ones
// people reach for. Others can still be typed.

export const PACKAGES: readonly string[] = [
  "amsmath", "amssymb", "amsthm", "mathtools", "bm", "physics", "siunitx", "graphicx", "xcolor", "tikz", "pgfplots", "caption", "subcaption", "float", "wrapfig",
  "booktabs", "multirow", "tabularx", "longtable", "array", "makecell", "colortbl", "hyperref", "cleveref", "url", "natbib", "biblatex", "babel", "polyglossia", "inputenc",
  "fontenc", "fontspec", "lmodern", "microtype", "geometry", "fancyhdr", "setspace", "parskip", "enumitem", "titlesec", "tocloft", "appendix", "lipsum", "csquotes",
  "listings", "minted", "algorithm", "algpseudocode", "algorithm2e", "todonotes", "soul", "ulem", "cancel", "tcolorbox", "framed", "mdframed", "pdfpages", "rotating",
  "lscape", "pdflscape", "adjustbox", "epstopdf", "glossaries", "makeidx", "imakeidx", "authblk", "verbatim", "xspace", "etoolbox", "ifthen", "calc", "comment", "afterpage",
];

export const CLASSES: readonly string[] = ["article", "report", "book", "letter", "beamer", "memoir", "scrartcl", "scrreprt", "scrbook", "amsart", "amsbook", "IEEEtran", "revtex4-2", "elsarticle", "llncs", "standalone", "minimal", "moderncv"];
