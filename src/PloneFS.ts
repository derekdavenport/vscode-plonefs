/*---------------------------------------------------------------------------------------------
 *  TODO: add license
 *--------------------------------------------------------------------------------------------*/

'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import { get, post } from './library/util';

import { Folder, Document, File, Entry } from './library/plone';

export type Credentials = {
	username: string;
	password: string;
};

export type Cookie = string;

export type CookieStore = {
	[uri: string]: Cookie;
};


export default class PloneFS implements vscode.FileSystemProvider {
	private cookieStore: CookieStore;
	private roots: { [host: string]: Folder } = {};

	// haven't figured out how to just pass in the root uri and cookie
	// so I pass in all cookies then use first stat call to set root uri and get the cookie
	constructor(sites: vscode.Uri[], cookieStore: CookieStore) {
		this.cookieStore = cookieStore;
		for (const uri of sites) {
			//const uri = vscode.Uri.parse('plone://' + uriValue);

			if (!this.roots[uri.authority]) {
				this.roots[uri.authority] = new Folder(uri.with({ path: '/' }));
			}

			const parts = uri.path.split('/').slice(1);
			let parent = this.roots[uri.authority];
			parent.loaded = true;
			for (const part of parts) {
				const parentPath = parent.uri.path;
				const myPath = path.posix.resolve(parentPath, part);
				const myUri = parent.uri.with({ path: myPath });
				const folder = new Folder(myUri);
				folder.loaded = true;
				parent.entries.set(part, folder);
				parent = folder;
			}
			// last folder is not loaded
			parent.loaded = false;
		}
	}

	// --- manage file metadata

	// since I haven't figured out how to load PloneFS before opening the workspace
	// first call to stat gives the root folder uri
	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		return this._lookup(uri, false);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const entry = await this._lookupAsFolder(uri, false);
		const loaded = await entry.load(this.cookieStore[uri.authority]);
		if (!loaded) {
			throw vscode.FileSystemError.Unavailable('could not load');
		}
		let result: [string, vscode.FileType][] = [];
		for (const [name, child] of entry.entries) {
			result.push([name, child.type]);
		}
		return result;
	}

	// --- manage file contents

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const entry = await this._lookupAsFile(uri, false);
		const loaded = await entry.load(this.cookieStore[uri.authority]);
		if (!loaded) {
			throw vscode.FileSystemError.Unavailable('unable to load file');
			// todo: try again?
		}
		return entry.data;
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		let basename = path.posix.basename(uri.path);
		let parent = await this._lookupParentFolder(uri);
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
			// files will have an extension
			const extname = path.posix.extname(uri.path);
			entry = extname ? new File(uri) : new Document(uri);
			parent.entries.set(basename, entry);
			this._fireSoon({ type: vscode.FileChangeType.Created, uri });
		}
		entry.mtime = Date.now();
		entry.size = content.byteLength;
		entry.data = content;

		const saved = await entry.save(this.cookieStore[uri.authority]);
		if (saved) {
			this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
		}
		else {
			throw vscode.FileSystemError.Unavailable(uri);
		}
	}

	// --- manage files/directories

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }) {

		if (!options.overwrite && await this._lookup(newUri, true)) {
			throw vscode.FileSystemError.FileExists(newUri);
		}

		let entry = await this._lookup(oldUri, false);
		let oldParent = await this._lookupParentFolder(oldUri);

		let newParent = await this._lookupParentFolder(newUri);
		let newName = path.posix.basename(newUri.path);

		if (oldParent === newParent) {
			// rename!
			entry.name = newName;
			await entry.save(this.cookieStore[newUri.authority]);
		}
		else {
			throw vscode.FileSystemError.Unavailable('not implemented');
		}


		oldParent.entries.delete(entry.name);
		entry.name = newName;
		newParent.entries.set(newName, entry);

		this._fireSoon(
			{ type: vscode.FileChangeType.Deleted, uri: oldUri },
			{ type: vscode.FileChangeType.Created, uri: newUri }
		);
	}

	async delete(uri: vscode.Uri): Promise<void> {
		throw vscode.FileSystemError.Unavailable('not implemented');
		let dirname = uri.with({ path: path.posix.dirname(uri.path) });
		let basename = path.posix.basename(uri.path);
		let parent = await this._lookupAsFolder(dirname, false);
		if (!parent.entries.has(basename)) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		parent.entries.delete(basename);
		parent.mtime = Date.now();
		parent.size -= 1;
		this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { uri, type: vscode.FileChangeType.Deleted });
	}

	async createDirectory(uri: vscode.Uri): Promise<void> {
		// let basename = path.posix.basename(uri.path);
		let dirname = uri.with({ path: path.posix.dirname(uri.path) });
		let parent = await this._lookupAsFolder(dirname, false);
		// check if exists

		let entry = new Folder(uri);
		const saved = await entry.save(this.cookieStore[uri.authority]);
		if (saved) {
			parent.entries.set(entry.name, entry);
			parent.mtime = Date.now();
			parent.size += 1;
			this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { type: vscode.FileChangeType.Created, uri });
		}
		else {
			throw vscode.FileSystemError.Unavailable(uri);
		}
	}

	static async login(uri: vscode.Uri, { username, password }: Credentials): Promise<string> {
		const options = {
			host: uri.authority,
			// TODO: escape path or have
			path: uri.path + '/login_form',
		};
		const postData = {
			__ac_name: username,
			__ac_password: password,
			'form.submitted': 1,
		};
		const response = await post(options, postData);
		if (response.headers['set-cookie'] && response.headers['set-cookie'][0].startsWith('__ac=')) {
			return response.headers['set-cookie'][0];
		}
		else {
			throw vscode.FileSystemError.NoPermissions(uri);
		}
	}

	static async checkCookie(uri: vscode.Uri, cookie: Cookie): Promise<boolean> {
		const response = await get({
			host: uri.authority,
			path: Document.escapePath(uri.path) + '/edit',
			headers: {
				Cookie: cookie,
			}
		});
		// should be 302 if cookie not accepted, 200 if accepted
		return response.statusCode === 200;
	}

	private async myLookup(uri: vscode.Uri): Promise<Entry> {
		return this._lookup(uri, false);
		// const relativePathValue = path.posix.relative(this.rootFolder.uri.path, uri.path);
		// const relativePath = path.posix.parse(relativePathValue);
		// if (!relativePath.base) {
		// 	return this.rootFolder;
		// }
		// let folder = this.rootFolder;
		// if (relativePath.dir) {
		// 	const parts = relativePath.dir.split('/');
		// 	for (const part of parts) {
		// 		if (!folder.loaded) {
		// 			await folder.load(this.cookieStore[uri.authority]);
		// 		}
		// 		// TODO: divide entries into folder entries and other entries?
		// 		const tempEntry = folder.entries.get(part);
		// 		if (!(tempEntry instanceof Folder)) {
		// 			throw new Error('not a folder');
		// 		}
		// 		folder = tempEntry;
		// 	}
		// }
		// let entry: Entry | undefined;
		// if (!folder.loaded) {
		// 	await folder.load(this.cookieStore[uri.authority]);
		// }
		// entry = folder.entries.get(relativePath.base);
		// if (!entry) {
		// 	throw vscode.FileSystemError.FileNotFound(uri);
		// }
		// return entry;
	}

	// --- lookup

	// TODO: support multiple roots
	private async _lookup(uri: vscode.Uri, silent: false): Promise<Entry>;
	private async _lookup(uri: vscode.Uri, silent: boolean): Promise<Entry | undefined>;
	private async _lookup(uri: vscode.Uri, silent: boolean): Promise<Entry | undefined> {
		let parts = uri.path.split('/').slice(1);
		let entry: Entry = this.roots[uri.authority];
		for (const part of parts) {
			if (!part) {
				continue;
			}
			let child: Entry | undefined;
			if (entry instanceof Folder) {
				// this can happen when VSCode restores a saved workspace with open folders
				if (!entry.loaded) {
					await entry.load(this.cookieStore[uri.authority]);
				}
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

	private async _lookupAsFolder(uri: vscode.Uri, silent: boolean): Promise<Folder> {
		const entry = await this._lookup(uri, silent);
		if (entry instanceof Folder) {
			return entry;
		}
		throw vscode.FileSystemError.FileNotADirectory(uri);
	}

	private async _lookupAsFile(uri: vscode.Uri, silent: boolean): Promise<Document | File> {
		const entry = await this._lookup(uri, silent);
		if (entry instanceof Document || entry instanceof File) {
			return entry;
		}
		throw vscode.FileSystemError.FileIsADirectory(uri);
	}

	private async _lookupParentFolder(uri: vscode.Uri): Promise<Folder> {
		const dirname = uri.with({ path: path.posix.dirname(uri.path) });
		return await this._lookupAsFolder(dirname, false);
	}

	// --- manage file events

	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _bufferedEvents: vscode.FileChangeEvent[] = [];
	private _fireSoonHandle: NodeJS.Timer;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	watch(/*resource: vscode.Uri, opts*/): vscode.Disposable {
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
