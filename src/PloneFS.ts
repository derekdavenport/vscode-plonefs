/*---------------------------------------------------------------------------------------------
 * Copyright (c) 2018 Derek Davenport.
 * this file is based on
 * https://github.com/Microsoft/vscode-extension-samples/blob/master/fsprovider-sample/src/fileSystemProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import { get, post } from './library/util';

import { Folder, BaseFile, Document, File, Entry } from './library/plone';
import { RequestOptions } from 'https';

export type Credentials = {
	username: string;
	password: string;
};

export type Cookie = string;

export type CookieStore = {
	[uri: string]: Cookie;
};

type RootStore = {
	folder: Folder,
	cookie: Cookie,
}

type Roots = {
	[uri: string]: RootStore,
};

export default class PloneFS implements vscode.FileSystemProvider {
	private roots: Roots;

	constructor(cookieStore: CookieStore) {
		this.roots = {};
		for (const rootUriValue of Object.keys(cookieStore)) {
			const uri = vscode.Uri.parse('plone://' + rootUriValue);
			this.roots[rootUriValue] = {
				folder: new Folder(uri, true, true),
				cookie: cookieStore[rootUriValue],
			};
		}
	}

	getRoot(uri: vscode.Uri): RootStore & { path: string } {
		const uriValue = uri.authority + uri.path;
		// sort longest to shortest
		const rootUriValues = Object.keys(this.roots).sort((a, b) => b.length - a.length);
		for (const rootUriValue of rootUriValues) {
			if (uriValue.indexOf(rootUriValue) === 0) {
				return {
					...this.roots[rootUriValue],
					path: uriValue.substring(rootUriValue.length),
				}
			}
		}
		// not found
		throw vscode.FileSystemError.FileNotFound('no root folder found for ' + uriValue);
	}

	_debug_expireCookies() {
		for (const uriValue in this.roots) {
			this.roots[uriValue].cookie = '';
		}
	}

	// --- manage file metadata

	stat(uri: vscode.Uri): Promise<Entry> {
		return this._lookup(uri, false);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const entry = await this._lookupAsFolder(uri, false);
		const loadedEntries = await entry.loadEntries(this.getRoot(uri).cookie);
		if (!loadedEntries) {
			throw vscode.FileSystemError.Unavailable('could not load');
		}
		// return Array.from(entry.entries).map(([name, child]) => [name, child.type] as [string, vscode.FileType]);
		let result: [string, vscode.FileType][] = [];
		for (const [name, child] of entry.entries) {
			result.push([name, child.type]);
		}
		return result;
	}

	// --- manage file contents

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const file = await this._lookupAsFile(uri, false);
		try {
			await file.load(this.getRoot(uri).cookie);
		}
		catch (error) {
			if (error instanceof vscode.FileSystemError) {
				console.log(error.name);
			}
		}
		if (!file.loaded) {
			throw vscode.FileSystemError.Unavailable('unable to load file');
			// todo: try again?
		}
		return file.data;
	}

	async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		let file = await this._lookupAsFile(uri, true);
		if (!file && !options.create) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		if (file && options.create && !options.overwrite) {
			throw vscode.FileSystemError.FileExists(uri);
		}
		if (!file) {
			let basename = path.posix.basename(uri.path);
			let parent = await this._lookupParentFolder(uri);
			// files will have an extension
			const extname = path.posix.extname(uri.path);
			file = extname ? new File(uri) : new Document(uri);
			parent.entries.set(basename, file);
			this._fireSoon({ type: vscode.FileChangeType.Created, uri });
		}
		file.mtime = Date.now();
		file.size = content.byteLength;
		file.data = content;

		const saved = await file.save(this.getRoot(uri).cookie);
		if (saved) {
			this._fireSoon({ type: vscode.FileChangeType.Changed, uri });
		}
		else {
			throw vscode.FileSystemError.Unavailable(uri);
		}
	}

	// --- manage files/directories

	async copy(source: vscode.Uri, destination: vscode.Uri, options: { overwrite: boolean }): Promise<void> {
		const entry = await this._lookup(source, false);
		//let newName = path.posix.basename(destination.path);
		const cookie = this.getRoot(source).cookie;
		const copyCookie = await entry.copy(cookie);
		const newParent = await this._lookupParentFolder(destination);
		await newParent.paste(cookie + '; ' + copyCookie);
		const copy = Object.assign(Object.create(Object.getPrototypeOf(entry)), entry);
		// if new folder already has entry with this name
		// plone will automatically prefix the new file with 'copy[n]_of_'
		// if the file already has the prefix 'copy[n]_of_' it will increment n
		// if n is 1, it is omitted
		const match = entry.name.match(/copy(\d*)_of_(.*)/);
		let copyNumber, copyName;
		if (match) {
			copyNumber = parseInt(match[1]);
			copyName = match[2];
		}
		else {
			copyNumber = 1;
			copyName = copy.name;
		}
		while (newParent.entries.has(copy.name)) {
			const copySuffix = copyNumber === 1 ? '' : copyNumber;
			copy.name = `copy${copySuffix}_of_${copyName}`;
			copyNumber++;
		}
		copy.uri = destination.with({ path: copy.path.dir + '/' + copy.name });
		newParent.entries.set(copy.name, copy);

		this._fireSoon(
			{ type: vscode.FileChangeType.Created, uri: copy.uri },
		);
	}

	async rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean }) {
		if (!options.overwrite && await this._lookup(newUri, true)) {
			throw vscode.FileSystemError.FileExists(newUri);
		}

		const entry = await this._lookup(oldUri, false);
		const oldParent = await this._lookupParentFolder(oldUri);
		const oldName = entry.name;

		const newParent = await this._lookupParentFolder(newUri);

		const cookie = this.getRoot(oldUri).cookie;

		if (oldParent === newParent) {
			// rename!
			entry.name = path.posix.basename(newUri.path);
			await entry.save(cookie);
		}
		else {
			// move!
			const cutCookie: Cookie = await entry.cut(cookie);
			await newParent.paste(cookie + '; ' + cutCookie);

			const match = entry.name.match(/copy(\d*)_of_(.*)/);
			let copyNumber, copyName;
			if (match) {
				copyNumber = parseInt(match[1]);
				copyName = match[2];
			}
			else {
				copyNumber = 1;
				copyName = entry.name;
			}
			while (newParent.entries.has(entry.name)) {
				const copySuffix = copyNumber === 1 ? '' : copyNumber;
				entry.name = `copy${copySuffix}_of_${copyName}`;
				copyNumber++;
			}
			entry.uri = newUri.with({ path: entry.path.dir + '/' + entry.name });
		}
		oldParent.entries.delete(oldName);
		newParent.entries.set(entry.name, entry);

		this._fireSoon(
			{ type: vscode.FileChangeType.Deleted, uri: oldUri },
			{ type: vscode.FileChangeType.Created, uri: entry.uri },
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
		let basename = path.posix.basename(uri.path);
		let dirname = uri.with({ path: path.posix.dirname(uri.path), query: '' });
		let parent = await this._lookupAsFolder(dirname, false);

		if (parent.entries.has(basename)) {
			throw vscode.FileSystemError.FileExists(uri);
		}
		let entry = new Folder(uri);
		const saved = await entry.save(this.getRoot(uri).cookie);
		if (!saved) {
			throw vscode.FileSystemError.Unavailable(uri);
		}
		parent.entries.set(entry.name, entry);
		parent.mtime = Date.now();
		parent.size += 1;
		this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { type: vscode.FileChangeType.Created, uri });
	}

	static async login(uri: vscode.Uri, { username, password }: Credentials): Promise<string> {
		const options: RequestOptions = {
			host: uri.authority,
			path: uri.path + '/login_form',
		};
		const postData = {
			__ac_name: username,
			__ac_password: password,
			'form.submitted': 1,
		};
		const response = await post(options, postData);
		const cookieHeaders = response.headers['set-cookie'];
		if (cookieHeaders) {
			const cookieHeader = cookieHeaders[0];
			if (cookieHeader && cookieHeader.startsWith('__ac=')) {
				return cookieHeader.split(';')[0];
			}
		}
		throw vscode.FileSystemError.NoPermissions(uri);
	}

	static async checkCookie(uri: vscode.Uri, cookie: Cookie): Promise<boolean> {
		const response = await get({
			host: uri.authority,
			path: uri.path + '/edit',
			headers: { cookie },
		});
		// should be 302 if cookie not accepted, 200 if accepted
		return response.statusCode === 200;
	}

	// --- lookup

	private async _lookup(uri: vscode.Uri, silent: false): Promise<Entry>;
	private async _lookup(uri: vscode.Uri, silent: boolean): Promise<Entry | undefined>;
	private async _lookup(uri: vscode.Uri, silent: boolean): Promise<Entry | undefined> {
		let returnLocalCss = false;
		if (uri.query === 'localCss' && /[/.]local\.css/.test(uri.path)) {
			uri = uri.with({ path: uri.path.slice(0, -10), query: '' });
			returnLocalCss = true;
		}
		//let parts = uri.path.split('/').slice(1);
		const root = this.getRoot(uri);
		let entry: Entry = root.folder;
		let parts = root.path.split('/').slice(1);
		for (const part of parts) {
			if (!part) {
				continue;
			}
			let child: Entry | undefined;
			if (entry instanceof Folder) {
				// this can happen when VSCode restores a saved workspace with open folders
				if (!entry.loadedEntries) {
					await entry.loadEntries(this.getRoot(uri).cookie);
				}
				child = entry.entries.get(part);
			}
			if (!child) {
				if (!silent) {
					throw vscode.FileSystemError.FileNotFound(uri);
				} else {
					return;
				}
			}
			entry = child;
		}
		if (returnLocalCss) {
			return entry.localCss;
		}
		return entry;
	}

	private async _lookupAsFolder(uri: vscode.Uri, silent: false): Promise<Folder>;
	private async _lookupAsFolder(uri: vscode.Uri, silent: boolean): Promise<Folder | undefined>;
	private async _lookupAsFolder(uri: vscode.Uri, silent: boolean): Promise<Folder | undefined> {
		const entry = await this._lookup(uri, silent);
		if (entry instanceof BaseFile) {
			throw vscode.FileSystemError.FileNotADirectory(uri);
		}
		return entry;
	}

	private async _lookupAsFile(uri: vscode.Uri, silent: false): Promise<BaseFile>;
	private async _lookupAsFile(uri: vscode.Uri, silent: boolean): Promise<BaseFile | undefined>;
	private async _lookupAsFile(uri: vscode.Uri, silent: boolean): Promise<BaseFile | undefined> {
		const entry = await this._lookup(uri, silent);
		if (entry instanceof Folder) {
			throw vscode.FileSystemError.FileIsADirectory(uri);
		}
		return entry;
	}

	private async _lookupParentFolder(uri: vscode.Uri): Promise<Folder> {
		const dirname = uri.with({ path: path.posix.dirname(uri.path), query: '' });
		return await this._lookupAsFolder(dirname, false);
	}

	// --- manage file events

	private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
	private _bufferedEvents: vscode.FileChangeEvent[] = [];
	private _fireSoonHandle!: NodeJS.Timer;

	readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

	watch(/*resource: vscode.Uri, options: { recursive: boolean; excludes: string[] }*/): vscode.Disposable {
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
