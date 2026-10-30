//! Formula text to tokens. Positions are 1-based character counts, so a
//! person can count to the mistake in the text they typed.

use super::FormulaError;

/// Longest formula, in characters. Longer text is refused before it is read.
pub const MAX_CHARS: usize = 400;

#[derive(Debug, Clone, PartialEq)]
pub enum Token {
    Name(String),
    Number(f64),
    Text(String),
    Open,
    Close,
    Comma,
    End,
}

impl Token {
    /// How the token reads in an error sentence.
    pub fn describe(&self) -> String {
        match self {
            Token::Name(n) => format!("“{n}”"),
            Token::Number(n) => format!("the number {n}"),
            Token::Text(t) => format!("the text “{t}”"),
            Token::Open => "“(”".to_owned(),
            Token::Close => "“)”".to_owned(),
            Token::Comma => "“,”".to_owned(),
            Token::End => "the end of the formula".to_owned(),
        }
    }
}

fn starts_name(c: char) -> bool {
    c.is_alphabetic() || c == '_'
}

fn in_name(c: char) -> bool {
    c.is_alphanumeric() || matches!(c, '_' | '-' | '.')
}

/// Every token with the position it starts at; the last is `End`.
pub fn lex(source: &str) -> Result<Vec<(Token, usize)>, FormulaError> {
    let chars: Vec<char> = source.chars().collect();
    if chars.len() > MAX_CHARS {
        return Err(FormulaError::at(
            MAX_CHARS + 1,
            format!("a formula can be at most {MAX_CHARS} characters long"),
        ));
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let pos = i + 1;
        match c {
            c if c.is_whitespace() => {
                i += 1;
                continue;
            }
            '(' | ')' | ',' => {
                let token = match c {
                    '(' => Token::Open,
                    ')' => Token::Close,
                    _ => Token::Comma,
                };
                out.push((token, pos));
                i += 1;
            }
            '"' => {
                let mut text = String::new();
                let mut j = i + 1;
                loop {
                    match chars.get(j) {
                        None => {
                            return Err(FormulaError::at(
                                pos,
                                "this text is missing its closing “\"”",
                            ));
                        }
                        Some('"') => break,
                        Some('\\') => match chars.get(j + 1) {
                            Some(&e @ ('"' | '\\')) => {
                                text.push(e);
                                j += 2;
                            }
                            _ => {
                                return Err(FormulaError::at(
                                    j + 1,
                                    "a backslash in text must be followed by “\"” or “\\”",
                                ));
                            }
                        },
                        Some(&other) => {
                            text.push(other);
                            j += 1;
                        }
                    }
                }
                out.push((Token::Text(text), pos));
                i = j + 1;
            }
            c if c.is_ascii_digit() => {
                let mut j = i;
                while chars.get(j).is_some_and(char::is_ascii_digit) {
                    j += 1;
                }
                if chars.get(j) == Some(&'.') && chars.get(j + 1).is_some_and(char::is_ascii_digit)
                {
                    j += 1;
                    while chars.get(j).is_some_and(char::is_ascii_digit) {
                        j += 1;
                    }
                }
                if chars.get(j).is_some_and(|c| starts_name(*c)) {
                    return Err(FormulaError::at(j + 1, "a number cannot run into letters"));
                }
                let text: String = chars[i..j].iter().collect();
                let value = text
                    .parse::<f64>()
                    .ok()
                    .filter(|v| v.is_finite())
                    .ok_or_else(|| FormulaError::at(pos, "this number is too large"))?;
                out.push((Token::Number(value), pos));
                i = j;
            }
            c if starts_name(c) => {
                let mut j = i;
                while chars.get(j).is_some_and(|c| in_name(*c)) {
                    j += 1;
                }
                out.push((Token::Name(chars[i..j].iter().collect()), pos));
                i = j;
            }
            other => {
                return Err(FormulaError::at(
                    pos,
                    format!("“{other}” is not used in formulas"),
                ));
            }
        }
    }
    out.push((Token::End, chars.len() + 1));
    Ok(out)
}
