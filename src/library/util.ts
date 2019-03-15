'use strict';

export function copyMatch(name: string): RegExpMatchArray | null {
	return name.match(/copy(\d*)_of_(.*)/);
}

// for external edit parsing
export enum Mode {
	Header,
	Python,
	Content,
}
export const linefeed = 10; // '\n'
export const creturn = 13; // '\r'
export const colon = 58; // ':'
export const indent = '  ';
// between every line in multiline values
export const blankLine = '  \r\n  ';
// except these keys
export const singleLineKeys = ['locallyAllowedTypes', 'immediatelyAddableTypes'];
export const endOfLineSequences = {
	[Mode.Header]: Buffer.from([linefeed]),
	[Mode.Python]: Buffer.from([creturn, linefeed]),
};
// between key and value
export const valueStartOffsets = {
	[Mode.Header]: 1, // ':'
	[Mode.Python]: 2, // ': '
};