'use strict';
import * as vscode from 'vscode';
import * as path from 'path';
import { get, post } from '../util';

export default abstract class PloneObject implements vscode.FileStat {
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
		const options = {
			host: this.uri.authority,
			path: PloneObject.escapePath(this.path.dir) + '/createObject?type_name=' + this.constructor.name,
			headers: {
				"Cookie": cookie,
			},
		};
		const response = await get(options);
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

	async save(cookie: string) {
		// if doesn't exist, create
		const savePath = this.exists ? this.uri.path : await this.getNewSavePath(cookie);
		const options = {
			host: this.uri.authority,
			path: PloneObject.escapePath(savePath) + '/atct_edit',
			headers: {
				"Cookie": cookie,
			},
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

	static escapePath(path: string): string {
		return path.replace(/([\u0000-\u0020])/g, $1 => '%' + $1.charCodeAt(0).toString(16));
	}
}