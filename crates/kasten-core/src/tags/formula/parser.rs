//! Tokens to a checked syntax tree. Names, argument counts and the kind of
//! each argument are checked here, so a formula that parses cannot fail for
//! being shaped wrong when it is read.

use super::FormulaError;
use super::lexer::{Token, lex};

/// Deepest nesting of calls, and most pieces in one formula.
pub const MAX_DEPTH: usize = 8;
pub const MAX_NODES: usize = 60;

/// The functions and how many values each takes.
pub const FUNCTIONS: [(&str, usize); 8] = [
    ("days_until", 1),
    ("days_since", 1),
    ("count", 1),
    ("count_backlinks", 0),
    ("sum", 1),
    ("min", 1),
    ("max", 1),
    ("if_empty", 2),
];

/// Functions whose value is a property's name, not a computed value.
fn takes_property(name: &str) -> bool {
    matches!(name, "count" | "sum" | "min" | "max")
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Number(f64, usize),
    Text(String, usize),
    /// A property, `key`, or `relation.key` inside sum, min and max.
    Prop(String, usize),
    Call {
        name: String,
        pos: usize,
        args: Vec<Expr>,
    },
}

impl Expr {
    pub fn pos(&self) -> usize {
        match self {
            Expr::Number(_, p) | Expr::Text(_, p) | Expr::Prop(_, p) => *p,
            Expr::Call { pos, .. } => *pos,
        }
    }

    /// Every property the formula names, with where it is named.
    pub fn props<'a>(&'a self, out: &mut Vec<(&'a str, usize)>) {
        match self {
            Expr::Prop(name, pos) => out.push((name, *pos)),
            Expr::Call { args, .. } => args.iter().for_each(|a| a.props(out)),
            _ => {}
        }
    }

    pub fn calls(&self, wanted: &str) -> bool {
        match self {
            Expr::Call { name, args, .. } => name == wanted || args.iter().any(|a| a.calls(wanted)),
            _ => false,
        }
    }
}

struct Parser {
    tokens: Vec<(Token, usize)>,
    at: usize,
    nodes: usize,
}

pub fn parse(source: &str) -> Result<Expr, FormulaError> {
    if source.trim().is_empty() {
        return Err(FormulaError::at(1, "the formula is empty"));
    }
    let mut p = Parser {
        tokens: lex(source)?,
        at: 0,
        nodes: 0,
    };
    let expr = p.expr(1)?;
    let (token, pos) = p.peek();
    if *token != Token::End {
        return Err(FormulaError::at(
            pos,
            format!(
                "unexpected {} after the end of the formula",
                token.describe()
            ),
        ));
    }
    no_dots(&expr)?;
    Ok(expr)
}

fn no_dots(expr: &Expr) -> Result<(), FormulaError> {
    match expr {
        Expr::Prop(name, pos) if name.contains('.') => Err(FormulaError::at(
            *pos,
            "a name with a dot, like related.points, works only inside sum, min and max",
        )),
        _ => Ok(()),
    }
}

impl Parser {
    fn peek(&self) -> (&Token, usize) {
        let (token, pos) = &self.tokens[self.at.min(self.tokens.len() - 1)];
        (token, *pos)
    }

    fn next(&mut self) -> (Token, usize) {
        let item = self.tokens[self.at.min(self.tokens.len() - 1)].clone();
        self.at += 1;
        item
    }

    fn expr(&mut self, depth: usize) -> Result<Expr, FormulaError> {
        self.nodes += 1;
        let (token, pos) = self.next();
        if self.nodes > MAX_NODES {
            return Err(FormulaError::at(
                pos,
                format!("a formula can have at most {MAX_NODES} parts"),
            ));
        }
        match token {
            Token::Number(n) => Ok(Expr::Number(n, pos)),
            Token::Text(t) => Ok(Expr::Text(t, pos)),
            Token::Name(name) => {
                if *self.peek().0 == Token::Open {
                    self.call(name, pos, depth)
                } else {
                    if name.split('.').count() > 2 || name.split('.').any(str::is_empty) {
                        return Err(FormulaError::at(
                            pos,
                            format!("“{name}” is not a property; write key or relation.key"),
                        ));
                    }
                    Ok(Expr::Prop(name, pos))
                }
            }
            other => Err(FormulaError::at(
                pos,
                format!("expected a value, found {}", other.describe()),
            )),
        }
    }

    fn call(&mut self, name: String, pos: usize, depth: usize) -> Result<Expr, FormulaError> {
        if depth > MAX_DEPTH {
            return Err(FormulaError::at(
                pos,
                format!("calls can be nested at most {MAX_DEPTH} deep"),
            ));
        }
        let Some(&(_, arity)) = FUNCTIONS.iter().find(|(n, _)| *n == name) else {
            let all: Vec<&str> = FUNCTIONS.iter().map(|(n, _)| *n).collect();
            return Err(FormulaError::at(
                pos,
                format!(
                    "unknown function “{name}”; the functions are {}",
                    all.join(", ")
                ),
            ));
        };
        self.next(); // the "("
        let mut args = Vec::new();
        if *self.peek().0 != Token::Close {
            loop {
                args.push(self.expr(depth + 1)?);
                let (token, at) = self.next();
                match token {
                    Token::Comma => {}
                    Token::Close => break,
                    other => {
                        return Err(FormulaError::at(
                            at,
                            format!("expected “,” or “)”, found {}", other.describe()),
                        ));
                    }
                }
            }
        } else {
            self.next();
        }
        if args.len() > arity {
            return Err(FormulaError::at(
                args[arity].pos(),
                format!(
                    "{name} takes {arity} value{}, not {}",
                    plural(arity),
                    args.len()
                ),
            ));
        }
        if args.len() < arity {
            let at = self.tokens[self.at - 1].1;
            return Err(FormulaError::at(
                at,
                format!(
                    "{name} takes {arity} value{}, not {}",
                    plural(arity),
                    args.len()
                ),
            ));
        }
        for arg in &args {
            if takes_property(&name) {
                if !matches!(arg, Expr::Prop(..)) {
                    return Err(FormulaError::at(
                        arg.pos(),
                        format!("{name} needs the name of a property"),
                    ));
                }
                if name == "count" {
                    no_dots(arg)?;
                }
            } else {
                no_dots(arg)?;
            }
        }
        Ok(Expr::Call { name, pos, args })
    }
}

fn plural(n: usize) -> &'static str {
    if n == 1 { "" } else { "s" }
}
