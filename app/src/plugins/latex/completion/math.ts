// Math commands for the completion list (specs as in `commands.ts`).

const OPERATORS = [
  "frac{numerator}{denominator}", "dfrac{numerator}{denominator}", "tfrac{numerator}{denominator}", "sqrt[n]{expression}", "sum", "prod", "coprod", "int", "iint", "iiint", "oint",
  "bigcup", "bigcap", "bigoplus", "bigotimes", "bigvee", "bigwedge", "lim", "limsup", "liminf", "max", "min", "sup", "inf", "argmax", "argmin", "log", "ln", "lg", "exp",
  "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan", "sinh", "cosh", "tanh", "coth", "det", "dim", "ker", "deg", "gcd", "arg", "Pr", "hom",
  "hat{x}", "widehat{x}", "tilde{x}", "widetilde{x}", "bar{x}", "overline{x}", "vec{x}", "dot{x}", "ddot{x}", "check{x}", "breve{x}", "acute{x}", "grave{x}",
  "overrightarrow{x}", "overleftarrow{x}", "overbrace{x}", "underbrace{x}", "boldsymbol{x}", "mathbf{x}", "mathbb{x}", "mathcal{x}", "mathrm{x}", "mathit{x}",
  "mathsf{x}", "mathtt{x}", "mathfrak{x}", "mathscr{x}", "mathnormal{x}", "bm{x}", "text{text}", "operatorname{name}", "operatorname*{name}", "left", "right", "middle",
  "big", "Big", "bigg", "Bigg", "binom{n}{k}", "dbinom{n}{k}", "choose", "stackrel{top}{bottom}", "overset{top}{bottom}", "underset{bottom}{top}", "substack{lines}",
  "xrightarrow[below]{above}", "xleftarrow[below]{above}", "tag{label}", "tag*{label}", "nonumber", "notag", "intertext{text}", "shortintertext{text}", "boxed{expression}",
  "cancel{expression}", "mod", "bmod", "pmod{n}", "pod{n}", "displaystyle", "textstyle", "scriptstyle", "limits", "nolimits", "not", "mathop{x}", "mathrel{x}", "mathbin{x}",
  "mathord{x}", "mathpunct{x}", "mathopen{x}", "mathclose{x}", "norm{x}", "abs{x}", "set{x}", "qty{x}", "dv{f}{x}", "pdv{f}{x}", "ket{x}", "bra{x}", "braket{x}{y}",
];

const SYMBOLS = [
  "partial", "nabla", "infty", "forall", "exists", "nexists", "in", "notin", "ni", "subset", "subseteq", "supset", "supseteq", "subsetneq", "cup", "cap", "setminus",
  "emptyset", "varnothing", "times", "cdot", "cdots", "vdots", "ddots", "div", "pm", "mp", "ast", "star", "circ", "bullet", "oplus", "otimes", "ominus", "odot", "wedge",
  "vee", "land", "lor", "lnot", "neg", "leq", "geq", "neq", "approx", "equiv", "sim", "simeq", "cong", "propto", "ll", "gg", "prec", "succ", "preceq", "succeq",
  "to", "gets", "rightarrow", "leftarrow", "leftrightarrow", "Rightarrow", "Leftarrow", "Leftrightarrow", "mapsto", "longrightarrow", "longleftarrow", "longmapsto",
  "implies", "impliedby", "iff", "uparrow", "downarrow", "nearrow", "searrow", "hookrightarrow", "rightharpoonup", "langle", "rangle", "lceil", "rceil", "lfloor",
  "rfloor", "lvert", "rvert", "lVert", "rVert", "hbar", "ell", "Re", "Im", "aleph", "wp", "angle", "triangle", "perp", "parallel", "mid", "nmid", "top", "bot",
  "therefore", "because", "square", "Box", "Diamond", "prime", "dagger", "ddagger", "S", "P", "copyright", "pounds", "checkmark", "textdegree", "degree", "bigstar", "surd",
];

const GREEK = [
  "alpha", "beta", "gamma", "delta", "epsilon", "varepsilon", "zeta", "eta", "theta", "vartheta", "iota", "kappa", "lambda", "mu", "nu", "xi", "pi", "varpi", "rho",
  "varrho", "sigma", "varsigma", "tau", "upsilon", "phi", "varphi", "chi", "psi", "omega", "Gamma", "Delta", "Theta", "Lambda", "Xi", "Pi", "Sigma", "Upsilon", "Phi", "Psi", "Omega",
];

export const MATH = { operators: OPERATORS, symbols: SYMBOLS, greek: GREEK };
