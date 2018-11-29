import * as vscode from 'vscode';
import * as http from 'http';
import { post } from '../util';
import PloneObject from './PloneObject';

export default class Document extends PloneObject {
	data: Uint8Array;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
		this.type = vscode.FileType.File;
	}

	async load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = new Promise<boolean>((resolve, reject) => {
			const path = this.path.dir + '/externalEdit_/' + this.name;
			const request = http.get({
				host: this.uri.authority,
				path,
				headers: {
					Cookie: cookie,
				}
			}, response => {
				if (response.statusCode !== 200) {
					reject(response.statusMessage);
				}
				else {
					let buffers: Buffer[] = [];
					response.on('data', (chunk: Buffer) => buffers.push(chunk));
					response.on('end', () => {
						const buffer = Buffer.concat(buffers);
						const map = new Map<string, string>();
						let lineStart: number, lineEnd: number, nextLineStart = 0;
						let key: string | undefined, value = '';
						enum Mode {
							Header = 0,
							Python = 1,
							Content = 2,
						}
						const newline = '\n'.charCodeAt(0);
						const creturn = '\r'.charCodeAt(0);
						const colon = ':'.charCodeAt(0);
						const space = ' '.charCodeAt(0);
						// Header uses ':', Python uses ': '
						const valueStartOffsets = [':'.length, ': '.length];
						let mode: Mode = Mode.Header;
						while (mode !== Mode.Content && (lineEnd = buffer.indexOf(newline, nextLineStart)) !== -1) {
							lineStart = nextLineStart;
							nextLineStart = lineEnd + 1;
							// check for \r\n
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
								map.set(key, value);
								//readingValue = true;
								//ignoreNextLine = true;
							}
						}
						this.data = buffer.slice(nextLineStart);
						resolve(this.loaded = true);
					});
				}
			});
			request.end();
		});
	}

	async save(cookie: string): Promise<boolean> {
		if (!this.exists) {
			return super.save(cookie);
		}
		return new Promise<boolean>(async (resolve, reject) => {
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

			try {
				const response = await post(options, postData);
				let buffers: Buffer[] = [];
				response.on('data', (chunk: Buffer) => buffers.push(chunk));
				response.on('end', () => {
					const text = Buffer.concat(buffers).toString();
					resolve(this.exists = text === 'saved');
				});
			}
			catch (error) {
				reject(error);
			}
		});
	}

	/*
	private formatPage(buffers: Buffer[]) {
		// remove doctype, html, and body tags (leave \n before and after)
		let buffer = Buffer.concat(buffers).slice(68, - 18);
		let index: number, offset = 1, count = 0;
		// unindent 4 spaces
		while ((index = buffer.indexOf(10, offset)) !== -1) {
			buffer.copyWithin(offset - count * 4, offset + 4, index + 1);
			offset = index + 1;
			count++;
		}
		// remove first \n and end garbage
		this.data = buffer.slice(1, count * -4);
		//resolve(this.loaded = true);
	}
	*/
}