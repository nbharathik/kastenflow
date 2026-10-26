// The LaTeX document the demo opens: a short derivation, plain text.

export const DEMO_TITLE = "Notes on a derivation";
export const DEMO_FOLDER = "latex/derivation";
export const DEMO_MAIN = `${DEMO_FOLDER}/main.tex`;

export const DEMO_SOURCE = String.raw`\documentclass{article}
\usepackage{amsmath}
\title{Notes on a Derivation}
\author{Maya Chen}
\date{October 2026}

\begin{document}
\maketitle

\begin{abstract}
We recover the quadratic formula by completing the square, then check what
its discriminant says about the roots.
\end{abstract}

\section{The equation}
A quadratic equation has the form
\begin{equation}
  a x^2 + b x + c = 0, \qquad a \neq 0.
\end{equation}
Dividing by $a$ and completing the square gives
\begin{equation}
  \left(x + \frac{b}{2a}\right)^2 = \frac{b^2 - 4ac}{4a^2}.
\end{equation}

\section{The solution}
Taking square roots on both sides,
\begin{equation}
  x = \frac{-b \pm \sqrt{b^2 - 4ac}}{2a}.
\end{equation}
The sign of $b^2 - 4ac$ decides the roots:
\begin{itemize}
\item If it is positive there are two real roots.
\item If it is zero there is exactly one.
\item If it is negative the roots are complex.
\end{itemize}
\end{document}
`;

/** A starting point for a document the demo makes. */
export const blankSource = (title: string): string => String.raw`\documentclass{article}
\title{${title}}
\author{Maya Chen}
\date{October 2026}

\begin{document}
\maketitle

\section{Introduction}
Start writing here.
\end{document}
`;
