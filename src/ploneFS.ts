/*---------------------------------------------------------------------------------------------
 *  TODO: add license
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as vscode from 'vscode';
import * as path from 'path';
import * as http from 'http';
import * as https from 'https';
import * as querystring from 'querystring';
import * as mime from 'mime/lite';

export type Credentials = {
	username: string;
	password: string;
};

export type CredentialStore = {
	[key: string]: Credentials;
};

abstract class PloneObject implements vscode.FileStat {
	type: vscode.FileType;
	ctime: number;
	mtime: number;
	size: number;

	private _uri: vscode.Uri;
	get uri() {
		return this._uri;
	}
	set uri(uri: vscode.Uri) {
		this._uri = uri;
		this._path = path.posix.parse(uri.path);
	}
	private _path: path.ParsedPath;
	get path() {
		return this._path;
	}
	name: string;

	loading: boolean;
	loaded: boolean;
	loadingPromise: Promise<boolean>;
	abstract load(string?): Promise<boolean>;

	exists: boolean;

	constructor(uri: vscode.Uri, exists = false) {
		this.ctime = this.mtime = Date.now();
		this.size = 0;
		this.uri = uri;
		this.name = this.path.base;

		this.loading = false;
		this.loaded = false;

		this.exists = exists;
	}

	async getNewSavePath(cookie: string) {
		return new Promise<string>((resolve, reject) => {
			const options = {
				host: this.uri.authority,
				path: this.path.dir + '/createObject?type_name=' + this.constructor.name,
				headers: {
					"Cookie": cookie,
				},
			};
			http.get(options, response => {
				if (response.statusCode === 302) {
					const location = response.headers['location'];
					if (location) {
						const locationPath = path.posix.parse(location);
						if (locationPath.base.startsWith('edit')) {
							resolve(locationPath.dir);
						}
						else {
							reject('bad location');
						}
					}
					else {
						reject('no location');
					}
				}
				else {
					reject(response.statusMessage);
				}
			});
		});
	}

	async save(cookie: string) {
		// if doesn't exist, create
		const savePath = this.exists ? this.uri.path : await this.getNewSavePath(cookie);
		return new Promise<boolean>((resolve, reject) => {
			const postData = Buffer.from(querystring.stringify({
				id: this.name,
				title: this.name,
				'form.submitted': 1,
			}));
			const options = {
				method: 'post',
				host: this.uri.authority,
				path: savePath + '/atct_edit',
				headers: {
					"Cookie": cookie,
					"Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
					"Content-Length": postData.length,
				},
			};
			const request = https.request(options, response => {
				if (response.statusCode === 302) {
					// in case of rename
					this.uri = this.uri.with({ path: this.path.dir + '/' + this.name })
					resolve(this.exists = true);
				}
				else {
					throw new Error(`${response.statusCode}: ${response.statusMessage}`);
				}
			});
			request.on('error', error => {
				throw error;
			});
			request.end(postData);
		});
	}
}

export class File extends PloneObject {
	data: Uint8Array;
	saved: boolean;

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
			const request = http.get({
				host: this.uri.authority,
				path: this.uri.path + '/at_download/file',
				headers: {
					Cookie: cookie,
				}
			}, response => {
				if (response.statusCode === 200) {
					let buffers: Buffer[] = [];
					response.on('data', (chunk: Buffer) => buffers.push(chunk));
					response.on('end', () => {
						this.data = Buffer.concat(buffers);
						this.loading = false;
						resolve(this.loaded = true);
					});
				}
				else {
					this.loading = false;
					reject(`${response.statusCode}: ${response.statusMessage}`);
				}
			});
			request.end();
		});
	}

	async save(cookie: string) {
		let savePath = this.uri.path;
		if (!this.exists) {
			//return await this.create(cookie);
			// plone does not allow empty files
			this.data = Buffer.from('\n');
			savePath = await this.getNewSavePath(cookie);
		}
		// Plone cannot update with empty data
		if (!this.data.length) {
			return false;
		}
		const postData = {
			id: this.name,
			title: this.name,
			'form.submitted': '1',
			file_file: {
				filename: this.name,
				data: this.data,
			}
		};
		const options = {
			host: this.uri.authority,
			path: savePath + '/atct_edit',
			headers: {
				"Cookie": cookie,
			},
		};
		const response = await this.post(options, postData);
		if (response.statusCode === 302) {
			return this.exists = true;
		}
		else {
			throw new Error(`${response.statusCode}: ${response.statusMessage}`);
		}
	}

	async create(cookie: string) {
		const options = {
			host: this.uri.authority,
			path: this.path.dir + '/tinymce-upload',
			headers: {
				"Cookie": cookie,
			},
		};
		const contentType = mime.getType(this.name) || 'text/plain';
		const postData = {
			uploadfile: {
				filename: this.name,
				data: Buffer.from(contentType), //this.data,
				contentType, // if the type is text/* plone will create a page, not a file
			},
			uploadtitle: this.name,
			uploaddescription: '',
		}
		const response = await this.post(options, postData);
		if (response.statusCode === 200) {
			return this.exists = true;
		}
		else {
			throw new Error(`${response.statusCode}: ${response.statusMessage}`);
		}
	}

	private async post(options: http.RequestOptions, postData: { [name: string]: string | { filename: string, data: Uint8Array, contentType?: string } }) {
		return new Promise<http.IncomingMessage>(resolve => {
			const lineEnd = '\r\n';
			const twoHyphens = '--';
			const boundary = '*****' + Date.now().toString(36);
			options = {
				...options,
				method: 'POST',
				headers: {
					...options.headers,
					'Content-Type': 'multipart/form-data; charset=utf-8; boundary=' + boundary,
					// "Content-Length": ???
				}
			}
			const request = http.request(options, response => {
				resolve(response);
			});
			for (const name in postData) {
				const value = postData[name];
				request.write(twoHyphens + boundary + lineEnd);
				if (typeof value === 'string') {
					request.write(`Content-Disposition: form-data; name="${name}"`);
					request.write(lineEnd + lineEnd);
					request.write(value.toString());
				}
				else {
					const filename = value.filename;
					const contentType = value.contentType || mime.getType(filename) || 'text/plain';
					request.write(`Content-Disposition: form-data; name="${name}"; filename="${filename}"`);
					request.write(lineEnd);
					request.write(`Content-Type: ${contentType}`);
					request.write(lineEnd + lineEnd);
					request.write(value.data);
				}
				request.write(lineEnd);
			}
			request.end(twoHyphens + boundary + twoHyphens + lineEnd);
		});
	}
}
export class Document extends PloneObject {
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
				// TODO: can't use this because doesn't get resolveuid
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
						let buffer = Buffer.concat(buffers);
						let lineStart: number, lineEnd: number, nextLineStart = 0;
						let map = new Map<string, string>(), key: string | undefined, value = '';
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
						let readingValue = false;
						let ignoreNextLine = false;
						while (mode !== Mode.Content && (lineEnd = buffer.indexOf(newline, nextLineStart)) !== -1) {
							lineStart = nextLineStart;
							nextLineStart = lineEnd + 1;
							// check for \r\n
							if (buffer[lineEnd - 1] === creturn) {
								lineEnd--;
							}
							// check for multiline value
							if (readingValue) {
								// multiline values start with two spaces
								if (buffer[lineStart] === space) {
									// multiline values leave every other line blank, so skip after reading a value
									if (ignoreNextLine) {
										ignoreNextLine = false;
									}
									else {
										value += '\n' + buffer.slice(lineStart + 2, lineEnd).toString();
										ignoreNextLine = true;
									}
									continue;
								}
								else {
									if (key) {
										map.set(key, value);
										readingValue = false;
									}
								}
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
									nextLineStart += 5;
									lineEnd = buffer.indexOf(newline, nextLineStart)
									value += '\n' + buffer.slice(nextLineStart, lineEnd).toString();
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
		return new Promise<boolean>((resolve, reject) => {
			const postData = querystring.stringify({
				fieldname: 'text',
				text: this.data.toString(),
			});
			const options = {
				method: 'POST',
				host: this.uri.authority,
				path: this.uri.path + '/tinymce-save',
				headers: {
					"Cookie": cookie,
					"Content-Type": "application/x-www-form-urlencoded; charset=utf-8",
					"Content-Length": Buffer.byteLength(postData)
				},
			};

			const request = https.request(options, response => {
				let buffers: Buffer[] = [];
				response.on('data', (chunk: Buffer) => buffers.push(chunk));
				response.on('end', () => {
					const text = Buffer.concat(buffers).toString();
					resolve(this.exists = text === 'saved');
				});
			});
			request.on('error', error => {
				reject(error)
			});
			request.end(postData);
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

export class Folder extends PloneObject {

	entries: Map<string, Entry>;

	constructor(uri: vscode.Uri, exists = false) {
		super(uri, exists);
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

			const request = https.request(options, response => {
				let buffers: Buffer[] = [];
				response.on('data', (chunk: Buffer) =>
					buffers.push(chunk))
					;
				response.on('end', () => {
					//const buffer = Buffer.from(data);
					//const string = buffer.toString();
					const json: Listing = JSON.parse(Buffer.concat(buffers).toString());
					json.path[0] // TODO: check if really root?
					json.upload_allowed // TODO: check this to know if can save?
					for (const item of json.items) {
						switch (item.normalized_type) {
							case 'folder':
								this.entries.set(item.id, new Folder(vscode.Uri.parse(item.url), true));
								break;
							case 'document':
								this.entries.set(item.id, new Document(vscode.Uri.parse(item.url), true));
								break;
							case 'file':
								this.entries.set(item.id, new File(vscode.Uri.parse(item.url), true));
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

export type Entry = Folder | Document | File;

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
		let basename = path.posix.basename(uri.path);
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
