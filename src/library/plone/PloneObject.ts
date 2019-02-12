'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import { get, post, getBuffer } from '../util';
import { RequestOptions } from 'https';
import { LocalCss } from '.';
import { Cookie } from '../../PloneFS';

enum Mode {
	Header,
	Python,
	Content,
}
const linefeed = 10; // '\n'
const creturn = 13; // '\r'
const colon = 58; // ':'
const indent = '  ';
// between every line in multiline values
const blankLine = '  \r\n  ';
// except these keys
const singleLineKeys = ['locallyAllowedTypes', 'immediatelyAddableTypes'];
const endOfLineSequences = {
	[Mode.Header]: Buffer.from([linefeed]),
	[Mode.Python]: Buffer.from([creturn, linefeed]),
};
// between key and value
const valueStartOffsets = {
	[Mode.Header]: 1, // ':'
	[Mode.Python]: 2, // ': '
};

export type State = 'internal' | 'external' | 'internally_published' | 'internally_restricted' | 'private' | 'pending' | null;

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
		this._name = this._path.base;
	}
	private _path!: path.ParsedPath;
	get path() {
		return this._path;
	}
	private _name!: string;
	get name() {
		return this._name;
	}

	loading: boolean;
	loaded: boolean;
	loadingPromise: Promise<boolean>;
	// TODO: write load here that handles setting loading (false when fail) and return promise
	// abstract protected _load 
	abstract load(cookie: string): Promise<boolean>;

	exists: boolean;

	state: State;

	settings: Map<string, Buffer>;
	hasLocalCss = false;
	localCss: LocalCss | undefined;

	constructor(uri: vscode.Uri, exists = false) {
		this.type = vscode.FileType.Unknown;
		this.ctime = this.mtime = Date.now();
		this.size = 0;
		this.uri = uri;

		this.loading = false;
		this.loaded = false;
		this.loadingPromise = Promise.resolve(false);

		this.state = 'internal';

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
		const modeSwitch = Buffer.from([linefeed, linefeed]);
		const headerStartIndex = 0;
		const headerEndIndex = buffer.indexOf(modeSwitch);
		const pythonStartIndex = headerEndIndex + modeSwitch.length;
		const pythonEndIndex = buffer.lastIndexOf(modeSwitch);
		const contentStartIndex = pythonEndIndex + modeSwitch.length;
		const headerBuffer = buffer.slice(headerStartIndex, headerEndIndex);
		const pythonBuffer = buffer.slice(pythonStartIndex, pythonEndIndex);
		const contentBuffer = buffer.slice(contentStartIndex);
		this.parseExternalEditSection(headerBuffer, Mode.Header);
		this.parseExternalEditSection(pythonBuffer, Mode.Python);
		return contentBuffer;
	}

	private parseExternalEditSection(buffer: Buffer, mode: Mode.Header | Mode.Python) {
		let lineStart: number, lineEnd: number, nextLineStart = 0;
		let key: string | undefined, value: Buffer;
		const eol = endOfLineSequences[mode];
		const valueStartOffset = valueStartOffsets[mode];
		while (nextLineStart < buffer.length) {
			lineEnd = buffer.indexOf(eol, nextLineStart);
			if (lineEnd === -1) {
				lineEnd = buffer.length;
			}
			lineStart = nextLineStart;
			nextLineStart = lineEnd + eol.length;
			let colonIndex = buffer.indexOf(colon, lineStart);
			key = buffer.slice(lineStart, colonIndex).toString();
			value = buffer.slice(colonIndex + valueStartOffset, lineEnd);
			// these keys don't insert blank lines between lines of multiline values
			const nextLineStartOffset = singleLineKeys.includes(key) ? indent.length : blankLine.length
			// check for multiline value
			while (buffer.indexOf(indent, nextLineStart) === nextLineStart) {
				lineStart = nextLineStart + nextLineStartOffset;
				lineEnd = buffer.indexOf(eol, lineStart);
				nextLineStart = lineEnd + eol.length;
				value = Buffer.concat([value, eol, buffer.slice(lineStart, lineEnd)]);
			}
			this.settings.set(key, value);
		}
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
		// TODO: make newName a param or something?
		this.uri = this.uri.with({ path: this.path.dir + '/' + this.name });
		return this.exists = true;
	}

	private async _cutCopy(cookie: Cookie, action: 'cut' | 'copy'): Promise<Cookie> {
		const options: RequestOptions = {
			host: this.uri.authority,
			path: this.uri.path + '/object_' + action,
			headers: { cookie },
		};
		const response = await get(options);
		// 302 should mean success
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		// need __cp cookie which identifies what was cut
		const cookieHeaders = response.headers['set-cookie'];
		if (!cookieHeaders) {
			throw vscode.FileSystemError.Unavailable('no cookies');
		}
		for (const cookieHeader of cookieHeaders) {
			if (cookieHeader && cookieHeader.startsWith('__cp=')) {
				return cookieHeader.split(';')[0];
			}
		}
		throw vscode.FileSystemError.Unavailable('no ' + action + ' cookie');

	}

	cut(cookie: Cookie): Promise<Cookie> {
		return this._cutCopy(cookie, 'cut');
	}

	copy(cookie: Cookie): Promise<Cookie> {
		return this._cutCopy(cookie, 'copy');
	}
}