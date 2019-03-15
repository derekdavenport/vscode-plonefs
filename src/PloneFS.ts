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
import { copyMatch } from './library/util';

import { Folder, BaseFile, Page, File, Entry, isWithLocalCss, PortletUrls, isWithPortlets, BaseFolder, Document } from './library/plone';
import { Roots } from './extension';

export type Credentials = {
	username: string;
	password: string;
};

export type Cookie = string;

export type CookieStore = {
	[uri: string]: Cookie;
};

type Root = {
	folder: Folder,
}

export default class PloneFS implements vscode.FileSystemProvider {
	private roots: Roots;

	constructor(roots: Roots) {
		this.roots = roots;
	}

	private getRootFolderFor(uri: vscode.Uri): Folder {
		const uriValue = uri.authority + uri.path;
		// sort longest to shortest
		const rootUriValues = Object.keys(this.roots).sort((a, b) => b.length - a.length);
		for (const rootUriValue of rootUriValues) {
			if (uriValue.indexOf(rootUriValue) === 0) {
				return this.roots[rootUriValue];
			}
		}
		// not found
		throw vscode.FileSystemError.FileNotFound('no root folder found for ' + uriValue);
	}

	getRoot(uri: vscode.Uri): Root & { path: string } {
		const uriValue = uri.authority + uri.path;
		// sort longest to shortest
		const rootUriValues = Object.keys(this.roots).sort((a, b) => b.length - a.length);
		for (const rootUriValue of rootUriValues) {
			if (uriValue.indexOf(rootUriValue) === 0) {
				return {
					folder: this.roots[rootUriValue],
					path: uriValue.substring(rootUriValue.length),
				}
			}
		}
		// not found
		throw vscode.FileSystemError.FileNotFound('no root folder found for ' + uriValue);
	}

	// --- manage file metadata

	stat(uri: vscode.Uri): Promise<Entry> {
		return this._lookup(uri, false);
	}

	async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
		const folder = await this._lookupAsFolder(uri, false);
		await folder.loadEntries();
		// return [...entry.entries()].map(([name, child]) => [name, child.type] as [string, vscode.FileType]);
		let result: [string, vscode.FileType][] = [];
		for (const [name, child] of folder.entries) {
			result.push([name, child.type]);
		}
		return result;
	}

	// --- manage file contents

	async readFile(uri: vscode.Uri): Promise<Uint8Array> {
		const file = await this._lookupAsFile(uri, false);
		try {
			await file.load();
		}
		catch (error) {
			if (error instanceof vscode.FileSystemError) {
				console.log(error.name);
			}
			else {
				throw error;
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
		const events: vscode.FileChangeEvent[] = [];
		if (!file && !options.create) {
			throw vscode.FileSystemError.FileNotFound(uri);
		}
		if (file && options.create && !options.overwrite) {
			throw vscode.FileSystemError.FileExists(uri);
		}
		if (!file) {
			// TODO: check for restricted name: location
			let basename = path.posix.basename(uri.path);
			let parent = await this._lookupParentFolder(uri);
			// files will have an extension
			const extname = path.posix.extname(uri.path);
			file = extname ? new File({client: parent.client, uri}) : new Page({client: parent.client, uri});
			// TODO: do not add until save confirmed
			parent.entries.set(basename, file);
			events.push({ type: vscode.FileChangeType.Created, uri });
		}
		file.mtime = Date.now();
		file.size = content.byteLength;
		file.data = content;

		await file.save();
		events.push({ type: vscode.FileChangeType.Changed, uri })
		this._fireSoon(...events);
	}

	// --- manage files/directories

	async copy(source: vscode.Uri, destination: vscode.Uri, /* options: { overwrite: boolean } */): Promise<void> {
		const entry = await this._lookup(source, false);
		//let newName = path.posix.basename(destination.path);
		await entry.copy();
		const newParent = await this._lookupParentFolder(destination) as Folder;
		await newParent.paste();
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

		const newParent = await this._lookupParentFolder(newUri) as Folder;

		if (oldParent === newParent) {
			// rename!
			entry.name = path.posix.basename(newUri.path);
			//entry.uri = newUri;
			await entry.save();
		}
		else {
			// move!
			await entry.cut();
			await newParent.paste();

			const match = copyMatch(entry.name);
			let copyNumber: number, copyName: string;
			if (match) {
				copyNumber = parseInt(match[1]);
				copyName = match[2];
			}
			else {
				copyNumber = 1;
				copyName = entry.name;
			}
			let testName = entry.name;
			while (newParent.entries.has(testName)) {
				const copySuffix = copyNumber === 1 ? '' : copyNumber;
				testName = `copy${copySuffix}_of_${copyName}`;
				copyNumber++;
			}
			entry.uri = newUri.with({ path: newParent.uri.path + '/' + testName });
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
		let entry = new Folder({ client: parent.client, uri });
		await entry.save();
		parent.entries.set(entry.name, entry);
		parent.mtime = Date.now();
		parent.size += 1;
		this._fireSoon({ type: vscode.FileChangeType.Changed, uri: dirname }, { type: vscode.FileChangeType.Created, uri });
	}

	async checkOut<P extends Page>(page: P): Promise<P> {
		const newUriValue = await page.checkOut();
		const parent = await this._lookupParentFolder(page.uri);
		const copy = Object.assign<P, P>(Object.create(Object.getPrototypeOf(page)), page);
		copy.mtime = Date.now();
		copy.uri = vscode.Uri.parse(newUriValue).with({ scheme: 'plone' });
		parent.entries.set(copy.path.base, copy);
		parent.mtime = Date.now();
		parent.size += 1;

		this._fireSoon(
			{ type: vscode.FileChangeType.Created, uri: copy.uri },
		);
		return copy;
	}

	async cancelCheckOut(page: Page): Promise<void> {
		await page.cancelCheckOut();
		this._fireSoon(
			{ type: vscode.FileChangeType.Deleted, uri: page.uri },
		);
	}

	async checkIn<P extends Page>(page: P, message: string): Promise<void> {
		const originalUriValue = await page.checkIn(message);
		const originalUri = vscode.Uri.parse(originalUriValue).with({ scheme: 'plone' });
		const textDocuments = vscode.workspace.textDocuments;
		// if original is open, update contents
		const originalDocument = textDocuments.find(document => document.uri.authority === originalUri.authority && document.uri.path === originalUri.path);
		if (originalDocument) {
			const range = new vscode.Range(originalDocument.lineAt(0).range.start, originalDocument.lineAt(originalDocument.lineCount - 1).range.end);
			const workspaceEdit = new vscode.WorkspaceEdit();
			workspaceEdit.set(originalUri, [new vscode.TextEdit(range, page.data.toString())]);
			// this marks the file as dirty
			await vscode.workspace.applyEdit(workspaceEdit);
			// TODO: fake the save?
			//originalDocument.save();
			//this.writeFile(originalUri, document.data, { create: false, overwrite: true });
		}

		this._fireSoon(
			{ type: vscode.FileChangeType.Changed, uri: originalUri },
			{ type: vscode.FileChangeType.Deleted, uri: page.uri },
		);
	}

	// --- lookup

	private async _lookup(uri: vscode.Uri, silent: false): Promise<Entry>;
	private async _lookup(uri: vscode.Uri, silent: boolean): Promise<Entry | undefined>;
	private async _lookup(uri: vscode.Uri, silent: boolean): Promise<Entry | undefined> {
		let returnLocalCss = false;
		const localCssRegEx = /[/.]local\.css/;
		if (uri.query === 'localCss' && localCssRegEx.test(uri.path)) {
			uri = uri.with({ path: uri.path.slice(0, -10), query: '' });
			returnLocalCss = true;
		}
		//let parts = uri.path.split('/').slice(1);
		const root = this.getRootFolderFor(uri);
		let parts = root.relativizePath(uri.path).split('/').slice(1);
		let entry: Entry = root;
		for (const part of parts) {
			if (!part) {
				continue;
			}
			let child: Entry | undefined;
			// portlet support
			// TODO: after a portlet is opened, vscode will check the containing folder
			// it will need to see the portlet in that folder or will label the portlet as deleted
			// probably need to fake the folder somehow
			// make a PortletFolder class that gets returned here
			if (part in PortletUrls && isWithPortlets(entry)) {
				const portletSide = PortletUrls[part as keyof typeof PortletUrls];
				// TODO: don't return the portlet,
				// set child to PortletFolder and keep going
				// maybe move loadPortlets from PloneObject into PortletFolder
				child = entry.portletManagers[portletSide]; //.get(parts.pop()!);
			}
			else if (entry instanceof BaseFolder) {
				// this can happen when VSCode restores a saved workspace with open folders
				if (!entry.loadedEntries) {
					await entry.loadEntries();
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
		if (returnLocalCss && isWithLocalCss(entry)) {
			return entry.localCss;
		}
		return entry;
	}

	private async _lookupAsFolder(uri: vscode.Uri, silent: false): Promise<BaseFolder>;
	private async _lookupAsFolder(uri: vscode.Uri, silent: boolean): Promise<BaseFolder | undefined>;
	private async _lookupAsFolder(uri: vscode.Uri, silent: boolean): Promise<BaseFolder | undefined> {
		const entry = await this._lookup(uri, silent);
		if (entry instanceof BaseFile) {
			throw vscode.FileSystemError.FileNotADirectory(uri);
		}
		return entry;
	}

	private async _lookupAsFile(uri: vscode.Uri, silent: false): Promise<BaseFile | Document>;
	private async _lookupAsFile(uri: vscode.Uri, silent: boolean): Promise<BaseFile | undefined>;
	private async _lookupAsFile(uri: vscode.Uri, silent: boolean): Promise<BaseFile | undefined> {
		const entry = await this._lookup(uri, silent);
		if (!(entry instanceof BaseFile)) {
			throw vscode.FileSystemError.FileIsADirectory(uri);
		}
		return entry;
	}

	private async _lookupParentFolder(uri: vscode.Uri): Promise<BaseFolder> {
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
