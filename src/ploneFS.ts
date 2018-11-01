/*---------------------------------------------------------------------------------------------
 *  TODO: add license
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as http from 'https';
import * as querystring from 'querystring';

abstract class PloneObject implements vscode.FileStat {
	type: vscode.FileType;
	ctime: number;
	mtime: number;
	size: number;

	uri: vscode.Uri;
	name: string;
	title: string;
	excludeFromNav: boolean;

	loading: boolean;
	loaded: boolean;
	loadingPromise: Promise<boolean>;
	abstract load(string?): Promise<boolean>;

	constructor(uri: vscode.Uri, title: string, excludeFromNav: boolean) {
		this.ctime = this.mtime = Date.now();
		this.size = 0;
		this.uri = uri;
		this.name = path.basename(uri.path);
		this.title = title;
		this.excludeFromNav = excludeFromNav;

		this.loading = false;
		this.loaded = false;
	}
}

export class File extends PloneObject {
	data: Uint8Array;

	constructor(uri: vscode.Uri, title: string = '', excludeFromNav: boolean = false) {
		super(uri, title, excludeFromNav);
		this.type = vscode.FileType.File;
	}

	async load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = new Promise<boolean>(resolve => {
			const request = http.get({
				host: this.uri.authority,
				path: this.uri.path,
				headers: {
					Cookie: cookie,
				}
			}, response => {
				let buffers: Buffer[] = [];
				response.on('data', (chunk: Buffer) => buffers.push(chunk));
				response.on('end', () => {
					this.data = Buffer.concat(buffers);
					this.loading = false;
					resolve(this.loaded = true);
				});
			});
			request.end();
		});
	}
}
export class Page extends PloneObject {
	data: Uint8Array;

	constructor(uri: vscode.Uri, title: string = '', excludeFromNav: boolean = false) {
		super(uri, title, excludeFromNav);
		this.type = vscode.FileType.File;
	}

	async load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = new Promise<boolean>(resolve => {
			const request = http.get({
				host: this.uri.authority,
				path: this.uri.path + '/getText',
				headers: {
					Cookie: cookie,
				}
			}, response => {
				let buffers: Buffer[] = [];
				response.on('data', (chunk: Buffer) => buffers.push(chunk));
				response.on('end', () => {
					// TODO: remove html and body tags and unindent each line
					this.data = Buffer.concat(buffers);
					this.loading = false;
					resolve(this.loaded = true);
				});
			});
			request.end();
		});
	}
}

export class Folder extends PloneObject {

	entries: Map<string, Page | Folder>;

	constructor(uri: vscode.Uri, title: string = '', excludeFromNav: boolean = false) {
		super(uri, title, excludeFromNav);
		this.type = vscode.FileType.Directory;
		this.entries = new Map();
	}

	async load(cookie: string): Promise<boolean> {
		if (this.loading) {
			return this.loadingPromise;
		}
		this.loading = true;
		return this.loadingPromise = new Promise<boolean>((resolve, reject) => {
			this.loaded = false;
			const postData = querystring.stringify({
				rooted: 'True',
				document_base_url: '/',
			});
			const options = {
				method: 'POST',
				host: this.uri.authority,
				path: this.uri.path + '/tinymce-jsonlinkablefolderlisting',
				headers: {
					"Cookie": cookie,
					"Content-Type": "application/x-www-form-urlencoded;  charset=UTF-8",
					"Content-Length": Buffer.byteLength(postData)
				},
			};

			const request = http.request(options, response => {
				let buffers: Buffer[] = [];
				response.on('data', (chunk: Buffer) =>
					buffers.push(chunk))
					;
				response.on('end', () => {

					//const buffer = Buffer.from(data);
					//const string = buffer.toString();
					const json: Listing = JSON.parse(Buffer.concat(buffers).toString());
					json.path[0] // check if really root?
					json.upload_allowed // check this to know if can save?
					for (const item of json.items) {
						switch (item.normalized_type) {
							case 'folder':
								this.entries.set(item.id, new Folder(vscode.Uri.parse(item.url), item.title));
								break;
							case 'document':
								this.entries.set(item.id, new Page(vscode.Uri.parse(item.url), item.title));
								break;
							case 'file':
							this.entries.set(item.id, new File(vscode.Uri.parse(item.url), item.title));
								break;
						}
					}
					this.loading = false;
					resolve(this.loaded = true);
				});
			});
			request.on('error', error => {
				this.loading = false;
				reject(error)
			});
			request.end(postData);
		});
	}
}

export type Entry = Page | Folder;

type Headers = { [key: string]: string };

type Listing = {
	parent_url: string;
	path: Item[];
	upload_allowed: boolean;
	items: Item[];
}

type Item = {
	description: string;
	uid: string;
	title: string;
	url: string;
	is_folderish: boolean;
	review_state: boolean;
	icon: string;
	portal_type: 'Folder' | 'Document';
	id: string;
	normalized_type: 'folder' | 'document' | 'file';
}

export class PloneFS implements vscode.FileSystemProvider {

	root: Folder;
	loginPromise: Promise<string>;

	public constructor(uri: vscode.Uri, username, password) {
		this.root = new Folder(uri);
		this.loginPromise = this.login(username, password);
	}

	// --- manage file metadata

	stat(uri: vscode.Uri): vscode.FileStat {
		return this._lookup(uri, false);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const entry = this._lookupAsFolder(uri, false);
		if (!entry.loaded) {
			const loaded = await entry.load(await this.loginPromise);
			if (!loaded) {
				throw new Error('could not load');
			}
		}
		let result: [string, vscode.FileType][] = [];
		for (const [name, child] of entry.entries) {
			result.push([name, child.type]);
		}
		return result;
	}

	// --- manage file contents

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const entry = this._lookupAsFile(uri, false);
		if (!entry.loaded) {
			const loaded = await entry.load(await this.loginPromise);
			if (!loaded) {
				throw new Error('could not load');
			}
		}
		return entry.data;
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		let basename = path.posix.basename(uri.path);
		let parent = this._lookupParentFolder(uri);
		let entry = parent.entries.get(basename);
		if (entry instanceof Folder) {
			throw vscode.FileSystemError.FileIsADirectory(uri);
		}
		if (!entry && !options.create) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		if (entry && options.create && !options.overwrite) {
			throw vscode.FileSystemError.FileExists(uri);
		}
		if (!entry) {
			entry = new Page(uri);
			parent.entries.set(basename, entry);
			this._fireSoon({ type: vscode.FileChangeType.Created, uri });
		}
		entry.mtime = Date.now();
		entry.size = content.byteLength;
		entry.data = content;

		this._fireSoon({ type: vscode.FileChangeType.Changed, uri });

		// TODO: save to plone here?
	}

	// --- manage files/directories

	rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }): void {

		if (!options.overwrite && this._lookup(newUri, true)) {
			throw vscode.FileSystemError.FileExists(newUri);
		}

		let entry = this._lookup(oldUri, false);
		let oldParent = this._lookupParentFolder(oldUri);

		let newParent = this._lookupParentFolder(newUri);
		let newName = path.posix.basename(newUri.path);

		oldParent.entries.delete(entry.name);
		entry.name = newName;
		newParent.entries.set(newName, entry);

		this._fireSoon(
			{ type: vscode.FileChangeType.Deleted, uri: oldUri },
			{ type: vscode.FileChangeType.Created, uri: newUri }
		);
	}

	delete(uri: vscode.Uri): void {
		let dirname = uri.with({ path: path.posix.dirname(uri.path) });
		let basename = path.posix.basename(uri.path);
		let parent = this._lookupAsFolder(dirname, false);
		if (!parent.entries.has(basename)) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		parent.entries.delete(basename);
		parent.mtime = Date.now();
		parent.size -= 1;
		this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { uri, type: vscode.FileChangeType.Deleted });
	}

	createDirectory(uri: vscode.Uri): void {
		let basename = path.posix.basename(uri.path);
		let dirname = uri.with({ path: path.posix.dirname(uri.path) });
		let parent = this._lookupAsFolder(dirname, false);

		let entry = new Folder(uri);
		parent.entries.set(entry.name, entry);
		parent.mtime = Date.now();
		parent.size += 1;
		this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { type: vscode.FileChangeType.Created, uri });
	}

	async login(username: string, password: string): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const postData = querystring.stringify({
				"__ac_name": username,
				"__ac_password": password,
				"form.submitted": "1",
			});
			const options = {
				method: 'POST',
				host: this.root.uri.authority,
				path: this.root.uri.path + '/login_form',
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					'Content-Length': Buffer.byteLength(postData),
				},
			};
			const request = http.request(options);
			request.on('response', response => {
				const cookie = response.headers["set-cookie"][0];
				resolve(cookie);
			});
			request.on('error', error => reject(error));
			request.end(postData);
		});
	}

	// --- lookup

	private _lookup(uri: vscode.Uri, silent: false): Entry;
	private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined;
	private _lookup(uri: vscode.Uri, silent: boolean): Entry | undefined {
		let parts = uri.path.split('/').splice(1);
		let entry: Entry | undefined;
		for (const part of parts) {
			if (!part) {
				continue;
			}
			let child: Entry | undefined;
			if (!entry && part == this.root.name) {
				child = this.root;
			}
			else if (entry instanceof Folder) {
				child = entry.entries.get(part);
			}
			if (!child) {
				if (!silent) {
					throw vscode.FileSystemError.FileNotFound(uri);
				} else {
					return undefined;
				}
			}
			entry = child;
		}
		return entry;
	}

	private _lookupAsFolder(uri: vscode.Uri, silent: boolean): Folder {
		let entry = this._lookup(uri, silent);
		if (entry instanceof Folder) {
			return entry;
		}
		throw vscode.FileSystemError.FileNotADirectory(uri);
	}

	private _lookupAsFile(uri: vscode.Uri, silent: boolean): Page {
		let entry = this._lookup(uri, silent);
		if (entry instanceof File || entry instanceof Page) {
			return entry;
		}
		throw vscode.FileSystemError.FileIsADirectory(uri);
	}

	private _lookupParentFolder(uri: vscode.Uri): Folder {
		const dirname = uri.with({ path: path.posix.dirname(uri.path) });
		return this._lookupAsFolder(dirname, false);
	}

	// --- manage file events

	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _bufferedEvents: vscode.FileChangeEvent[] = [];
	private _fireSoonHandle: NodeJS.Timer;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	watch(resource: vscode.Uri, opts): vscode.Disposable {
		// ignore, fires for all changes...
		return new vscode.Disposable(() => { });
	}

	private _fireSoon(...events: vscode.FileChangeEvent[]): void {
		this._bufferedEvents.push(...events);
		clearTimeout(this._fireSoonHandle);
		this._fireSoonHandle = setTimeout(() => {
			this._emitter.fire(this._bufferedEvents);
			this._bufferedEvents.length = 0;
		}, 5);
	}
}
