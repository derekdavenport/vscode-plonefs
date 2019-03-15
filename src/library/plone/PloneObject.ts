'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as url from 'url';
import * as Form from 'form-data';
import { linefeed, Mode, endOfLineSequences, valueStartOffsets, colon, singleLineKeys, indent, blankLine } from '../util';
import { State, StateAction, ActionState } from '.';
import * as got from 'got';

export interface PloneObjectOptions {
	client: got.GotFn;
	uri: vscode.Uri;
	exists?: boolean;
}

export default abstract class PloneObject implements vscode.FileStat {
	static readonly type_name: string | undefined;

	static readonly EMPTY_BUFFER = Buffer.from('');
	static readonly LINEFEED_BUFFER = Buffer.from('\n');
	static readonly TRUE_BUFFER = Buffer.from('True');
	static readonly SAVED_BUFFER = Buffer.from('saved');;

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
	set name(name: string) {
		this._name = name;
	}
	title: string;
	description: string;
	excludeFromNav: boolean;

	loading: boolean;
	loaded: boolean;
	loadingPromise: Promise<void>;

	protected abstract _load(): Promise<void>;

	exists: boolean;

	state: State | null;

	settings: Map<string, Buffer>;

	client: got.GotFn;

	constructor(options: PloneObjectOptions) {
		this.client = options.client;
		this.type = vscode.FileType.Unknown;
		this.ctime = this.mtime = Date.now();
		this.size = 0;
		this.uri = options.uri;
		// TODO: move title and description out of settings
		this.title = this.name;
		this.description = '';
		this.excludeFromNav = false;

		this.loading = false;
		this.loaded = false;
		this.loadingPromise = Promise.resolve();

		this.state = null;

		this.exists = options.exists || false;
		this.settings = new Map<string, Buffer>();
	}
	protected async _changeState(stateAction: StateAction) {
		const requestPath = this.uri.path + '/content_status_modify?workflow_action=' + stateAction;
		const response = await this.client(requestPath);
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable();
		}
		this.state = ActionState[stateAction];
	}
	load(): Promise<void> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = this._load()
			.then(() => { this.loading = false; this.loaded = true; })
			.catch(() => { this.loading = false });
	}

	async loadDetails(): Promise<void> {
		type Details = {
			title: string;
			description: string;
		};
		const response = await this.client(this.uri.path + '/tinymce-jsondetails', { json: true });//.json();
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(this.uri);
		}
		const details: Details = response.body;
		this.title = details.title;
		this.description = details.description;
	}

	async loadExcludeFromNav() {
		const response = await this.client(this.uri.path + '/exclude_from_nav');
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(this.uri);
		}
		this.excludeFromNav = response.body.equals(PloneObject.TRUE_BUFFER);
	}

	protected async _loadExternalBuffer(): Promise<Buffer> {
		const externalEditPath = this.path.dir + '/externalEdit_/' + this.path.base;
		const response = await this.client(externalEditPath);
		this.loading = false;
		if (response.statusCode !== 200) {
			throw vscode.FileSystemError.Unavailable(`${response.statusCode}: ${response.statusMessage}`);
		}
		return response.body;
	}

	async saveSetting(settingName: string): Promise<boolean> {
		if (!this.exists) {
			throw vscode.FileSystemError.Unavailable('does not exist');
		}
		const setting = this.settings.get(settingName);
		if (setting === undefined) {
			throw vscode.FileSystemError.Unavailable('no setting ' + settingName);
		}
		const body = new Form();
		body.append('fieldname', settingName)
		body.append('text', setting);
		const response = await this.client.post(this.uri.path + '/tinymce-save', { body });
		const success = response.body.equals(PloneObject.SAVED_BUFFER);
		if (!success) {
			throw vscode.FileSystemError.Unavailable(response.body.toString());
		}
		// changes will only show on View page unless reindexed
		this.client(this.uri.path + '/reindexObject');
		return success;
	}

	// saveDescription(cookie: Cookie) {
	// 	post({
	// 		host: this.uri.authority,
	// 		path: this.uri.path + '/setDescription',
	// 		headers: { cookie },
	// 	},
	// 		{
	// 			value: this.description,
	// 		}
	// 	);
	// }

	async getNewSavePath() {
		const createPath = this.path.dir + '/createObject?type_name=' + ((this.constructor as typeof PloneObject).type_name || this.constructor.name);
		const response = await this.client(createPath);
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		const location = response.headers['location'];
		if (!location) {
			throw vscode.FileSystemError.Unavailable('no location');
		}
		const locationPathValue = url.parse(location).pathname;
		if (!locationPathValue) {
			throw vscode.FileSystemError.Unavailable('no path');
		}
		const locationPath = path.posix.parse(locationPathValue);
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
		const pythonEndIndex = buffer.indexOf(modeSwitch, pythonStartIndex); // buffer.lastIndexOf(modeSwitch);
		const contentStartIndex = pythonEndIndex + modeSwitch.length;
		const headerBuffer = buffer.slice(headerStartIndex, headerEndIndex);
		const pythonBuffer = buffer.slice(pythonStartIndex, pythonEndIndex);
		const contentBuffer = buffer.slice(contentStartIndex);
		this.parseExternalEditSection(headerBuffer, Mode.Header);
		this.parseExternalEditSection(pythonBuffer, Mode.Python);
		return contentBuffer;
	}

	protected parseExternalEditSection(buffer: Buffer, mode: Mode.Header | Mode.Python) {
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
			if (key === 'title') {
				this.title = value.toString();
			}
			else if (key === 'description') {
				this.description = value.toString();
			}
			this.settings.set(key, value);
		}
	}

	async save() {
		// if doesn't exist, create
		const savePath = this.exists ? this.uri.path : await this.getNewSavePath();
		const body = new Form();
		body.append('id', this.name);
		body.append('title', this.title || this.name);
		body.append('form.submitted', 1);
		const response = await this.client.post(savePath + '/atct_edit', { body });
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
		// in case of rename
		// TODO: make newName a param or something?
		this.uri = this.uri.with({ path: this.path.dir + '/' + this.name });
		this.exists = true
	}

	private async _cutCopy(action: 'cut' | 'copy'): Promise<void> {
		const response = await this.client(this.uri.path + '/object_' + action);
		// 302 should mean success
		if (response.statusCode !== 302) {
			throw vscode.FileSystemError.Unavailable(response.statusCode + ' ' + response.statusMessage);
		}
	}

	cut(): Promise<void> {
		return this._cutCopy('cut');
	}

	copy(): Promise<void> {
		return this._cutCopy('copy');
	}
}