import * as vscode from 'vscode';
import { get, getBuffer, post } from '../util';
import PloneObject from './PloneObject';

export default class Document extends PloneObject {
	data: Uint8Array;
	settings: Map<string, string>;
	static readonly savedText = Buffer.from('saved');

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		this.type = vscode.FileType.File;
	}

	load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this._load(cookie);
	}

	private async _load(cookie: string): Promise<boolean> {
		const externalEditPath = this.path.dir + '/externalEdit_/' + this.name;
		const response = await get({
			host: this.uri.authority,
			path: Document.escapePath(externalEditPath),
			headers: {
				Cookie: cookie,
			}
		});
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		const buffer = await getBuffer(response);
		this.parseExternalEdit(buffer);
		return this.loaded = true;
	}

	async save(cookie: string): Promise<boolean> {
		if (!this.exists) {
			return super.save(cookie);
		}
		const postData = {
			fieldname: 'text',
			text: this.data.toString(),
		};
		const options = {
			host: this.uri.authority,
			path: Document.escapePath(this.uri.path) + '/tinymce-save',
			headers: {
				"Cookie": cookie,
			},
		};
		const response = await post(options, postData);
		const buffer = await getBuffer(response);
		return this.exists = buffer.equals(Document.savedText);
	}

	private parseExternalEdit(buffer: Buffer): void {
		this.settings = new Map<string, string>();
		let lineStart: number, lineEnd: number, nextLineStart = 0;
		let key: string | undefined, value = '';
		enum Mode {
			Header,
			Python,
			Content,
		}
		const newline = '\n'.charCodeAt(0);
		const creturn = '\r'.charCodeAt(0);
		const colon = ':'.charCodeAt(0);
		const space = ' '.charCodeAt(0);
		// Header uses ':', Python uses ': '
		const valueStartOffsets = {
			[Mode.Header]: ':'.length,
			[Mode.Python]: ': '.length,
		};
		let mode: Mode = Mode.Header;
		while (mode !== Mode.Content && (lineEnd = buffer.indexOf(newline, nextLineStart)) !== -1) {
			lineStart = nextLineStart;
			nextLineStart = lineEnd + 1;
			// backtrack 1 if \r\n used
			if (buffer[lineEnd - 1] === creturn) {
				lineEnd--;
			}
			// blank line signals format change
			if (lineStart === lineEnd) {
				switch (mode) {
					case Mode.Header:
						mode = Mode.Python;
						break;
					case Mode.Python:
						mode = Mode.Content;
						break;
				}
			}
			else {
				let colonIndex = buffer.indexOf(colon, lineStart);
				key = buffer.slice(lineStart, colonIndex).toString();
				value = buffer.slice(colonIndex + valueStartOffsets[mode], lineEnd).toString();
				// check for multiline value
				while (buffer[nextLineStart] === space) {
					lineStart = nextLineStart + 5;
					lineEnd = buffer.indexOf(newline, lineStart);
					nextLineStart = lineEnd + 1;
					value += '\n' + buffer.slice(lineStart, lineEnd).toString();
				}
				this.settings.set(key, value);
			}
		}
		this.data = buffer.slice(nextLineStart);
	}
}