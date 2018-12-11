'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import { get, post, getBuffer } from '../util';
import { RequestOptions } from 'https';

export default abstract class PloneObject implements vscode.FileStat {
	static readonly savedText = Buffer.from('saved');

	type: vscode.FileType;
	ctime: number;
	mtime: number;
	size: number;

	private _uri!: vscode.Uri;
	get uri() {
		return this._uri;
	}
	set uri(uri: vscode.Uri) {
		this._uri = uri;
		this._path = path.posix.parse(uri.path);
	}
	private _path!: path.ParsedPath;
	get path() {
		return this._path;
	}
	name: string;

	loading: boolean;
	loaded: boolean;
	loadingPromise: Promise<boolean>;
	abstract load(cookie: string): Promise<boolean>;

	exists: boolean;

	settings: Map<string, Buffer>;

	constructor(uri: vscode.Uri, exists = false) {
		this.type = vscode.FileType.Unknown;
		this.ctime = this.mtime = Date.now();
		this.size = 0;
		this.uri = uri;
		this.name = this.path.base;

		this.loading = false;
		this.loaded = false;
		this.loadingPromise = Promise.resolve(false);

		this.exists = exists;
		this.settings = new Map<string, Buffer>();
	}

	async saveSetting(settingName: string, cookie: string): Promise<boolean> {
		if (!this.exists) {
			throw vscode.FileSystemError.Unavailable('does not exist');
		}
		const setting = this.settings.get(settingName);
		if (setting === undefined) {
			throw vscode.FileSystemError.Unavailable('no setting ' + settingName);
		}
		const options: RequestOptions = {
			host: this.uri.authority,
			path: this.uri.path + '/tinymce-save',
			headers: { cookie },
		};
		const postData = {
			fieldname: settingName,
			text: setting.toString(), // TODO: support buffer?
		};
		const response = await post(options, postData);
		const buffer = await getBuffer(response);
		return buffer.equals(PloneObject.savedText);
	}

	async getNewSavePath(cookie: string) {
		const response = await get({
			host: this.uri.authority,
			path: this.path.dir + '/createObject?type_name=' + this.constructor.name,
			headers: { cookie },
		});
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		const location = response.headers['location'];
		if (!location) {
			throw vscode.FileSystemError.Unavailable('no location');
		}
		const locationPath = path.posix.parse(location);
		if (!locationPath.base.startsWith('edit')) {
			throw vscode.FileSystemError.Unavailable('bad location');
		}
		return locationPath.dir;
	}

	protected parseExternalEdit(buffer: Buffer): Buffer {
		this.settings.clear();
		let lineStart: number, lineEnd: number, nextLineStart = 0;
		let key: string | undefined, value: Buffer;
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
				value = buffer.slice(colonIndex + valueStartOffsets[mode], lineEnd);
				// check for multiline value
				while (buffer[nextLineStart] === space) {
					// TODO: locallyAllowedTypes does not have extra blank line
					lineStart = nextLineStart + '  \r\n  '.length;
					// this section should always use \r\n
					lineEnd = buffer.indexOf(creturn, lineStart);
					nextLineStart = lineEnd + '\r\n'.length;
					value = Buffer.concat([value, Buffer.from('\n'), buffer.slice(lineStart, lineEnd)]);
				}
				this.settings.set(key, value);
			}
		}
		return buffer.slice(nextLineStart);
	}

	async save(cookie: string) {
		// if doesn't exist, create
		const savePath = this.exists ? this.uri.path : await this.getNewSavePath(cookie);
		const options: RequestOptions = {
			host: this.uri.authority,
			path: savePath + '/atct_edit',
			headers: { cookie },
		};
		const postData = {
			id: this.name,
			title: this.name,
			'form.submitted': 1,
		};
		const response = await post(options, postData);
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		// in case of rename
		this.uri = this.uri.with({ path: this.path.dir + '/' + this.name });
		return this.exists = true;
	}
}