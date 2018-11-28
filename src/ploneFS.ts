/*---------------------------------------------------------------------------------------------
 *  TODO: add license
 *--------------------------------------------------------------------------------------------*/

'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import * as https from 'https';
import * as querystring from 'querystring';

import { Folder, Document, File, Entry } from './library/plone';

export type Credentials = {
	username: string;
	password: string;
};

export type CredentialStore = {
	[uri: string]: Credentials;
};


export default class PloneFS implements vscode.FileSystemProvider {
	private readonly credentialStore: CredentialStore;

	rootFolder: Folder;// = new Folder(vscode.Uri.parse('plone:/'));
	cookie: Promise<string>;

	constructor(credentialStore: CredentialStore) {
		this.credentialStore = credentialStore;
	}

	// --- manage file metadata

	async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
		let entry: Entry;
		// first call to stat will be root folder
		if (!this.rootFolder) {
			const credentials = this.credentialStore[uri.authority + uri.path];
			if (credentials) {
				// TODO: test login success
				this.rootFolder = new Folder(uri);
				this.cookie = this.login(credentials);
				await this.cookie;
				entry = this.rootFolder;
			}
			else {
				throw vscode.FileSystemError.NoPermissions('no credentials');
			}
		}
		else {
			// extension is making more stat calls before login finishes and loads root
			await this.cookie;
			entry = await this.myLookup(uri);
		}
		return entry;
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const entry = await this._lookupAsFolder(uri, false);
		const loaded = await entry.load(await this.cookie);
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
		const loaded = await entry.load(await this.cookie);
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

		const saved = await entry.save(await this.cookie);
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
			await entry.save(await this.cookie);
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

	async createDirectory(uri: vscode.Uri) {
		// let basename = path.posix.basename(uri.path);
		let dirname = uri.with({ path: path.posix.dirname(uri.path) });
		let parent = await this._lookupAsFolder(dirname, false);
		// check if exists

		let entry = new Folder(uri);
		const saved = await entry.save(await this.cookie);
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

	async login({ username, password }: Credentials): Promise<string> {
		return new Promise<string>((resolve, reject) => {
			const postData = querystring.stringify({
				"__ac_name": username,
				"__ac_password": password,
				"form.submitted": 1,
			});
			const options = {
				method: 'POST',
				host: this.rootFolder.uri.authority,
				path: this.rootFolder.uri.path + '/login_form',
				headers: {
					"Content-Type": "application/x-www-form-urlencoded",
					'Content-Length': Buffer.byteLength(postData),
				},
			};
			const request = https.request(options);
			request.on('response', response => {
				const cookie = response.headers["set-cookie"][0];
				resolve(cookie);
			});
			request.on('error', error => reject(error));
			request.end(postData);
		});
	}

	private async myLookup(uri: vscode.Uri): Promise<Entry> {
		const relativePathValue = path.posix.relative(this.rootFolder.uri.path, uri.path);
		const relativePath = path.posix.parse(relativePathValue);
		if (!relativePath.base) {
			return this.rootFolder;
		}
		let folder = this.rootFolder;
		if (relativePath.dir) {
			const parts = relativePath.dir.split('/');
			for (const part of parts) {
				if (!folder.loaded) {
					await folder.load(await this.cookie);
				}
				// TODO: divide entries into folder entries and other entries?
				const tempEntry = folder.entries.get(part);
				if (!(tempEntry instanceof Folder)) {
					throw new Error('not a folder');
				}
				folder = tempEntry;
			}
		}
		let entry: Entry | undefined;
		if (!folder.loaded) {
			await folder.load(await this.cookie);
		}
		entry = folder.entries.get(relativePath.base);
		if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
		return entry;
	}

	// --- lookup

	private async _lookup(uri: vscode.Uri, silent: false): Promise<Entry>;
	private async _lookup(uri: vscode.Uri, silent: boolean): Promise<Entry | undefined>;
	private async _lookup(uri: vscode.Uri, silent: boolean): Promise<Entry | undefined> {
		let parts = uri.path.split('/').splice(1);
		let entry: Entry | undefined;
		for (const part of parts) {
			if (!part) {
				continue;
			}
			let child: Entry | undefined;
			if (!entry && this.rootFolder && part == this.rootFolder.name) {
				child = this.rootFolder;
			}
			else if (entry instanceof Folder) {
				// this can happen when VSCode restores a saved workspace with open folders
				if (!entry.loaded) {
					await entry.load(await this.cookie);
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
