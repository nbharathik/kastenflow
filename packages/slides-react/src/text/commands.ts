// The commands of the editor that a host reaches without an open editor, through `runOnText`.

export { BULLET_SIZES, backspaceStart, enter, indent, moveParagraphs, setAlign, setBulletColor, setBulletSize, setIndents, setLineSpacing, setParagraphSpacing, softBreak, withParagraphs } from "./block-commands.ts";
export { type CaseMode, changeCase, convertCase } from "./case-commands.ts";
export { applyListStyle, canRestart, continuePreviousList, continuedNumber, restartNumbering, setList, setStartNumber, toggleList } from "./list-commands.ts";
export { type Command, clearFormatting, setFlag, setLink, setValueMark, stepFontSize, toggleFlag, toggleScript } from "./mark-commands.ts";
export { formatOfText, runOnText } from "./headless.ts";
